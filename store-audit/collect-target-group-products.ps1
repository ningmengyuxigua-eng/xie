param(
  [string]$MetricDate = '2026-10-06',
  [string]$StoreId = '27857268786685',
  [string[]]$TargetGroupIds,
  [switch]$AllSpendGroups,
  [int]$MaxGroups = 6,
  [int]$MaxPages = 20
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "ad-daily\$MetricDate\groups"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$evaluationPath = Join-Path $root "ad-daily\$MetricDate\ad-evaluation.json"
if (@($TargetGroupIds).Count -gt 0) {
  $targets = @($TargetGroupIds | ForEach-Object {
    $id = [string]$_
    if ($id -notmatch '^\d+$') { throw "Invalid target group ID: $id" }
    $id
  } | Sort-Object -Unique | Select-Object -First $MaxGroups)
} elseif ($AllSpendGroups) {
  $pendingPath = Join-Path $outDir 'pending-spend-groups.json'
  $null = & node (Join-Path $root 'count-ad-spend-products.cjs') $MetricDate $pendingPath
  if ($LASTEXITCODE -ne 0) { throw 'Unable to list pending spend groups' }
  $targets = @(Get-Content -LiteralPath $pendingPath -Raw -Encoding utf8 | ConvertFrom-Json | Select-Object -First $MaxGroups | ForEach-Object { [string]$_.adId })
} else {
  $evaluation = Get-Content -LiteralPath $evaluationPath -Raw -Encoding utf8 | ConvertFrom-Json
  $targets = @(
    @($evaluation.actionItems) + @($evaluation.effectiveItems) |
      Where-Object { $_.adType -eq 'manual_mpd' } |
      ForEach-Object { [string]$_.adId } |
      Sort-Object -Unique
  )
}
if ($targets.Count -eq 0) {
  $overall = [ordered]@{storeId=$StoreId;metricDate=$MetricDate;scope='target_group_product_daily';targetGroups=@();completedGroups=0;status='complete';updatedAt=(Get-Date).ToString('o')}
  $overall | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outDir 'checkpoint.json') -Encoding utf8
  Write-Output ($overall | ConvertTo-Json -Compress)
  exit 0
}

$start = [DateTimeOffset]::Parse("$MetricDate`T00:00:00+08:00")
$from = $start.ToUnixTimeSeconds()
$to = $start.AddDays(1).AddSeconds(-1).ToUnixTimeSeconds()

$captureScript = @'
JSON.stringify((()=>{const t=Array.from(document.querySelectorAll('table'));if(t.length<5)return {ready:false,url:location.href};const h=Array.from(t[1].querySelectorAll('th')).map(x=>x.innerText.trim()).filter(Boolean);const n=Array.from(t[3].querySelectorAll('tr'));const v=Array.from(t[4].querySelectorAll('tr'));const rows=[];for(let i=0;i<n.length;i++){const s=n[i].innerText.trim();const id=s.match(/ID:\s*(\d+)/)?.[1];if(!id)continue;const cells=Array.from(v[i].querySelectorAll('td')).map(c=>c.innerText.trim().split('\n')[0]);rows.push({productId:id,productName:s.split('\n')[0],metrics:Object.fromEntries(h.map((k,j)=>[k,cells[j]||'']))});}const p=(document.querySelector('.eds-pager')||{}).innerText||'';const m=p.match(/(\d+)\s*\/\s*(\d+)/);const a=location.pathname.match(/manual-mpd\/(\d+)/)?.[1]||'';return {ready:rows.length>0,url:location.href,adId:a,page:m?Number(m[1]):1,total:m?Number(m[2]):1,rows};})())
'@

function Invoke-PageJson([string]$Script, [int]$MaxAttempts = 3) {
  $lastError = ''
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    try {
      $raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $Script --timeout 30000
      $response = ($raw -join "`n") | ConvertFrom-Json
      if (-not $response.ok -or $response.data.data.exceptionDetails) { throw 'page exec returned an error' }
      return ($response.data.data.result | ConvertFrom-Json)
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds 1200
    }
  }
  throw "Page exec failed after $MaxAttempts attempts: $lastError"
}

$completedGroups = 0
$pagesProcessed = 0
foreach ($adId in $targets) {
  $groupDir = Join-Path $outDir $adId
  New-Item -ItemType Directory -Path $groupDir -Force | Out-Null
  $url = "https://seller.shopee.tw/portal/marketing/pas/product/manual-mpd/$adId`?source_page_id=2&from=$from&to=$to&group=custom"
  $safeUrl = $url.Replace('&', "'+String.fromCharCode(38)+'")
  $navigateScript = "location.assign('$safeUrl');JSON.stringify(true)"
  $null = Invoke-PageJson -Script $navigateScript
  Start-Sleep -Milliseconds 900

  $first = $null
  $lastCandidate = $null
  for ($readyAttempt = 1; $readyAttempt -le 5; $readyAttempt += 1) {
    $candidate = Invoke-PageJson -Script $captureScript
    $lastCandidate = $candidate
    if ($candidate.ready -and [string]$candidate.adId -eq $adId) { $first = $candidate; break }
    Start-Sleep -Milliseconds 1200
  }
  if (-not $first) {
    $debug = if ($lastCandidate) { $lastCandidate | ConvertTo-Json -Depth 3 -Compress } else { 'no candidate' }
    throw "Group page validation failed for $adId; last=$debug"
  }
  $totalPages = [int]$first.total
  if (($pagesProcessed + $totalPages) -gt $MaxPages) {
    Write-Output ("page budget reached before group {0}: used={1}, next={2}, limit={3}" -f $adId,$pagesProcessed,$totalPages,$MaxPages)
    break
  }
  $lastFirstProduct = ''
  for ($pageNumber = 1; $pageNumber -le $totalPages; $pageNumber += 1) {
    $page = if ($pageNumber -eq 1) { $first } else { Invoke-PageJson -Script $captureScript }
    if ([string]$page.adId -ne $adId -or [int]$page.page -ne $pageNumber) { throw "Page validation failed for group $adId page $pageNumber" }
    $rowCount = @($page.rows).Count
    if ($rowCount -gt 20) { throw ("Batch row limit exceeded for group {0} page {1}: {2}" -f $adId, $pageNumber, $rowCount) }
    if ($rowCount -gt 0) {
      $firstProduct = [string]$page.rows[0].productId
      if ($firstProduct -eq $lastFirstProduct) { throw "Repeated page data for group $adId page $pageNumber" }
      $lastFirstProduct = $firstProduct
    }
    $pagePath = Join-Path $groupDir "page-$pageNumber.json"
    $page | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pagePath -Encoding utf8
    $importRaw = & node (Join-Path $root 'import-ad-product-day-page.cjs') $MetricDate $adId $pageNumber
    if ($LASTEXITCODE -ne 0) { throw "Import failed for group $adId page $pageNumber" }
    $import = ($importRaw -join "`n") | ConvertFrom-Json
    $checkpoint = [ordered]@{storeId=$StoreId;metricDate=$MetricDate;adId=$adId;lastCompletedPage=$pageNumber;pageCount=$totalPages;batchRowCount=$rowCount;totalDatabaseRows=$import.databaseRows;status=if($pageNumber -eq $totalPages){'complete'}else{'partial'};updatedAt=(Get-Date).ToString('o')}
    $checkpoint | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $groupDir 'checkpoint.json') -Encoding utf8
    Write-Output ("group {0}: page {1}/{2}, batch={3}, databaseRows={4}" -f $adId,$pageNumber,$totalPages,$rowCount,$import.databaseRows)
    $pagesProcessed += 1

    if ($pageNumber -lt $totalPages) {
      $nextScript = "JSON.stringify((()=>{const b=document.querySelector('.eds-pager__button-next');if(!b||b.disabled||b.classList.contains('disabled'))return {clicked:false};b.click();return {clicked:true};})())"
      $clicked = Invoke-PageJson -Script $nextScript
      if (-not $clicked.clicked) { throw "Next-page click failed for group $adId page $pageNumber" }
      Start-Sleep -Milliseconds 800
    }
  }
  $completedGroups += 1
}

$scope = if (@($TargetGroupIds).Count -gt 0) { 'explicit_group_product_daily' } elseif ($AllSpendGroups) { 'all_spend_group_product_daily' } else { 'target_group_product_daily' }
$overall = [ordered]@{storeId=$StoreId;metricDate=$MetricDate;scope=$scope;targetGroups=$targets;completedGroups=$completedGroups;pagesProcessed=$pagesProcessed;status=if($completedGroups -eq $targets.Count){'complete'}else{'partial'};updatedAt=(Get-Date).ToString('o')}
$overall | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outDir 'checkpoint.json') -Encoding utf8
Write-Output ($overall | ConvertTo-Json -Compress)
