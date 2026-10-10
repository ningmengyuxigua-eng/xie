param(
  [string]$ScanDate = '2026-10-08',
  [int]$PageSize = 48
)

$ErrorActionPreference = 'Stop'
$storeId = '27857268786685'
$root = $PSScriptRoot
$runId = 'identity-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$runDir = Join-Path $root "$ScanDate\product-identity-scan\$runId"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$extractSource = Get-Content -LiteralPath (Join-Path $root 'extract-product-identities.js') -Raw
$extractBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($extractSource))
$extractScript = "eval(atob('$extractBase64'))"
$all = [System.Collections.Generic.List[object]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new()
$batchNumber = 0
$page = 1
$pageCount = $null
$total = $null

while ($null -eq $pageCount -or $page -le $pageCount) {
  $targetUrl = "https://seller.shopee.tw/portal/product/list/live/all?operationSortBy=recommend_v2&page=$page&size=$PageSize"
  $navigateSource = "location.href='$targetUrl';'navigating'"
  $navigateBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($navigateSource))
  $navigateScript = "eval(atob('$navigateBase64'))"
  $null = & ziniao-cli.cmd page exec --store-id $storeId --script $navigateScript

  $pageData = $null
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    Start-Sleep -Milliseconds 1200
    try {
      $raw = & ziniao-cli.cmd page exec --store-id $storeId --script $extractScript
      $wrapper = ($raw -join "`n") | ConvertFrom-Json
      if (-not $wrapper.ok -or $wrapper.data.data.exceptionDetails) { continue }
      $candidate = $wrapper.data.data.result | ConvertFrom-Json
      if ($candidate.url -match "[?&]page=$page(?:&|$)" -and @($candidate.items).Count -gt 0) {
        $pageData = $candidate
        break
      }
    } catch {}
  }
  if ($null -eq $pageData) { throw "Product identity page $page did not become ready" }
  if ($null -eq $total) {
    if ($null -eq $pageData.total -or [int]$pageData.total -le 0) { throw 'Product total was not detected' }
    $total = [int]$pageData.total
    $pageCount = [Math]::Ceiling($total / $PageSize)
  }

  $newOnPage = [System.Collections.Generic.List[object]]::new()
  foreach ($item in @($pageData.items)) {
    if ($seen.Add([string]$item.productId)) {
      $all.Add($item)
      $newOnPage.Add($item)
    }
  }
  for ($offset = 0; $offset -lt $newOnPage.Count; $offset += 20) {
    $batchNumber++
    $take = [Math]::Min(20, $newOnPage.Count - $offset)
    $batch = @($newOnPage.GetRange($offset, $take))
    $batchPath = Join-Path $runDir ('batch-{0:D4}.json' -f $batchNumber)
    $batch | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $batchPath -Encoding utf8
  }
  Write-Output ("page {0}/{1}: {2} identities, total unique {3}" -f $page,$pageCount,@($pageData.items).Count,$seen.Count)
  $page++
}

$allPath = Join-Path $runDir 'identities.json'
@($all) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $allPath -Encoding utf8
$checkpoint = [ordered]@{
  runId = $runId
  storeId = $storeId
  scanDate = $ScanDate
  status = 'complete'
  totalReported = $total
  uniqueIdentities = $seen.Count
  pageSize = $PageSize
  pageCount = $pageCount
  batchSize = 20
  batchCount = $batchNumber
  identitiesPath = $allPath
  finishedAt = (Get-Date).ToString('o')
}
$checkpointPath = Join-Path $runDir 'checkpoint.json'
$checkpoint | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $checkpointPath -Encoding utf8
Write-Output ($checkpoint | ConvertTo-Json -Compress)
