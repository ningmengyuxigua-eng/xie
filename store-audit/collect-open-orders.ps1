param(
  [ValidateRange(1, 20)]
  [int]$MaxOrders = 20,

  [ValidateRange(1, 100)]
  [int]$SourcePage = 1
)

$ErrorActionPreference = 'Stop'

$storeId = '27857268786685'
$storeName = 'xie1'
$cli = 'C:\Users\Administrator\AppData\Roaming\npm\ziniao-cli.cmd'
$root = 'D:\xiapi\store-audit'
$stateDir = Join-Path $root 'state'
$checkpointPath = Join-Path $stateDir 'open-orders-checkpoint.json'
$listScript = Get-Content -LiteralPath (Join-Path $root 'extract-open-order-batch.js') -Raw
$detailScript = Get-Content -LiteralPath (Join-Path $root 'extract-logistics-state.js') -Raw

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

function Invoke-PageExec {
  param([string]$Script, [string]$TargetId)
  $singleLineScript = $Script -replace "\r?\n", ' '
  $arguments = @('page', 'exec', '--store-id', $storeId, '--script', $singleLineScript)
  if ($TargetId) { $arguments += @('--target-id', $TargetId) }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $raw = & $cli @arguments 2>&1
    try { $response = ($raw -join "`n") | ConvertFrom-Json } catch { $response = $null }
    if ($response -and $response.ok -and !$response.data.data.exceptionDetails) {
      return $response
    }
    if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
  }
  throw 'Ziniao page exec failed after 3 attempts'
}

function Save-Checkpoint {
  param($Checkpoint)
  $temporaryPath = "$checkpointPath.tmp"
  $Checkpoint | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
  Move-Item -LiteralPath $temporaryPath -Destination $checkpointPath -Force
}

function Wait-ShippingListReady {
  param([string]$TargetId, [string]$ExpectedDifferentFrom = '')
  $probeScript = "(function(){var tab=document.querySelector('.eds-tabs__nav-tab.active');var links=Array.from(document.links).filter(function(a){return a.href.indexOf('/portal/sale/order/')>=0});var first=links.length?links[0].href.split('/').pop():'';return JSON.stringify({activeTab:tab?tab.innerText.trim():'',orderLinkCount:links.length,firstOrderId:first})})()"
  $previousSignature = ''
  for ($probe = 1; $probe -le 10; $probe++) {
    try {
      $raw = & $cli page exec --store-id $storeId --target-id $TargetId --script $probeScript 2>&1
      $response = ($raw -join "`n") | ConvertFrom-Json
      if (!$response.ok) { throw 'probe failed' }
      $state = $response.data.data.result | ConvertFrom-Json
      $isShipping = $state.activeTab -like '運送中*'
      $signature = ([string]$state.orderLinkCount) + '|' + ([string]$state.firstOrderId)
      $isStable = $state.orderLinkCount -gt 0 -and $signature -eq $previousSignature
      $isNewPage = !$ExpectedDifferentFrom -or $signature -ne $ExpectedDifferentFrom
      if ($isShipping -and $isStable -and $isNewPage) { return $signature }
      $previousSignature = $signature
    } catch {
      $previousSignature = ''
    }
    Start-Sleep -Seconds 1
  }
  throw 'Shipping order list did not become stable'
}

$checkpoint = $null
if (Test-Path -LiteralPath $checkpointPath) {
  $candidate = Get-Content -LiteralPath $checkpointPath -Raw | ConvertFrom-Json
  if (!$candidate.completed -and $candidate.nextIndex -lt $candidate.orders.Count) {
    $checkpoint = $candidate
  }
}

if (!$checkpoint) {
  & $cli store open --id $storeId --expected-name $storeName --url 'https://seller.shopee.tw/portal/sale/order' | Out-Null
  $initial = Invoke-PageExec -Script 'JSON.stringify({path:location.pathname})' -TargetId ''
  $targetId = $initial.data.data.targetId
  & $cli page click --store-id $storeId --target-id $targetId --selector '.eds-tabs__nav-tabs > .eds-tabs__nav-tab:nth-of-type(4)' --timeout 10000 | Out-Null
  try {
    $pageSignature = Wait-ShippingListReady -TargetId $targetId
    for ($pageIndex = 2; $pageIndex -le $SourcePage; $pageIndex++) {
      & $cli page click --store-id $storeId --target-id $targetId --selector '.eds-pager__button-next' --timeout 10000 | Out-Null
      $pageSignature = Wait-ShippingListReady -TargetId $targetId -ExpectedDifferentFrom $pageSignature
    }
    $listResponse = Invoke-PageExec -Script $listScript -TargetId $targetId
  } catch {
    [ordered]@{
      observedAt = (Get-Date).ToString('o')
      storeId = $storeId
      stage = 'read_shipping_list_after_tab_switch'
      errorType = 'CDP_ERROR'
      attempts = 3
      batchWritten = $false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'open-orders-last-failure.json') -Encoding utf8
    throw
  }
  $batch = $listResponse.data.data.result | ConvertFrom-Json
  if ($batch.rowCount -lt 1) { throw 'No open orders found in shipping tab' }

  $runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $datePartition = Get-Date -Format 'yyyy-MM-dd'
  $runDir = Join-Path $root "$storeId\shipment\$datePartition\$runId"
  New-Item -ItemType Directory -Path $runDir -Force | Out-Null
  $outputPath = Join-Path $runDir 'batch-0001.jsonl'
  $checkpoint = [pscustomobject]@{
    version = 1
    runId = $runId
    storeId = $storeId
    sourcePage = $SourcePage
    targetId = $targetId
    outputPath = $outputPath
    nextIndex = 0
    completed = $false
    createdAt = (Get-Date).ToString('o')
    updatedAt = (Get-Date).ToString('o')
    orders = @($batch.rows)
  }
  Save-Checkpoint $checkpoint
}

$processed = 0
$pickupReady = 0
$errors = 0
$targetId = $checkpoint.targetId

while ($checkpoint.nextIndex -lt $checkpoint.orders.Count -and $processed -lt $MaxOrders) {
  $order = $checkpoint.orders[$checkpoint.nextIndex]
  try {
    $eventCode = $order.sourceStatus
    $eventAt = $null

    $url = 'https://seller.shopee.tw/portal/sale/order/' + $order.orderInternalId
    & $cli page visit --store-id $storeId --target-id $targetId --url $url --wait-until networkidle --timeout 30000 | Out-Null
    & $cli page wait-element --store-id $storeId --target-id $targetId --selector '.status-log' --timeout 15000 | Out-Null
    $detailResponse = Invoke-PageExec -Script $detailScript -TargetId $targetId
    $detail = $detailResponse.data.data.result | ConvertFrom-Json
    $eventCode = $detail.latestEventCode
    $eventAt = $detail.latestEventAt
    if ($eventCode -eq 'pickup_ready') { $pickupReady += 1 }

    $record = [ordered]@{
      observedAt = (Get-Date).ToString('o')
      storeId = $storeId
      orderInternalId = [string]$order.orderInternalId
      orderNumber = if ($order.orderNumber) { [string]$order.orderNumber } else { $null }
      sourceStatus = [string]$order.sourceStatus
      latestEventCode = [string]$eventCode
      latestEventAt = $eventAt
    }
    ($record | ConvertTo-Json -Compress) | Add-Content -LiteralPath $checkpoint.outputPath -Encoding utf8
    $checkpoint.nextIndex += 1
    $checkpoint.updatedAt = (Get-Date).ToString('o')
    Save-Checkpoint $checkpoint
    $processed += 1
  } catch {
    $errors += 1
    if ($errors -ge 3) { break }
    $checkpoint.nextIndex += 1
    $checkpoint.updatedAt = (Get-Date).ToString('o')
    Save-Checkpoint $checkpoint
  }
}

if ($checkpoint.nextIndex -ge $checkpoint.orders.Count) {
  $checkpoint.completed = $true
  $checkpoint.updatedAt = (Get-Date).ToString('o')
  Save-Checkpoint $checkpoint
}

[ordered]@{
  runId = $checkpoint.runId
  processed = $processed
  pickupReady = $pickupReady
  errors = $errors
  batchSize = $checkpoint.orders.Count
  sourcePage = $checkpoint.sourcePage
  nextIndex = $checkpoint.nextIndex
  completed = $checkpoint.completed
  outputPath = $checkpoint.outputPath
  checkpointPath = $checkpointPath
} | ConvertTo-Json -Compress
