param(
  [string]$MetricDate,
  [int]$MaxProducts = 20,
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
if ($MetricDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'MetricDate must be YYYY-MM-DD' }
if ($MaxProducts -gt 20) { throw 'MaxProducts cannot exceed 20' }

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $root "ad-daily\$MetricDate"
$evaluationPath = Join-Path $dir 'group-product-evaluation.json'
$outputPath = Join-Path $dir 'drilldown-product-details.jsonl'
$checkpointPath = Join-Path $dir 'drilldown-product-checkpoint.json'
$evaluation = Get-Content -LiteralPath $evaluationPath -Raw | ConvertFrom-Json

$productMap = [ordered]@{}
foreach ($row in @($evaluation.actionItems) + @($evaluation.effectiveContributors)) {
  $productMap[[string]$row.productId] = [string]$row.productName
}

$completed = @{}
if (Test-Path -LiteralPath $outputPath) {
  foreach ($line in Get-Content -LiteralPath $outputPath) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      $saved = $line | ConvertFrom-Json
      if (-not $saved.error) { $completed[[string]$saved.productId] = $true }
    }
  }
}

$script = @'
JSON.stringify((()=>{const t=document.body.innerText;const re=/售價:NT\$\s*([0-9,]+)/g;const prices=[...t.matchAll(re)].map(x=>Number(x[1].replace(/,/g,''))).filter(Boolean);const marker='目前的促銷活動';const i=t.indexOf(marker);return {url:location.href,title:document.title,prices:[...new Set(prices)],promotionText:i<0?'':t.slice(i,i+300),ready:t.includes('銷售資訊')&&prices.length>0};})())
'@

$processed = 0
$errors = 0
foreach ($entry in $productMap.GetEnumerator()) {
  if ($processed -ge $MaxProducts) { break }
  $productId = [string]$entry.Key
  if ($completed.ContainsKey($productId)) { continue }
  try {
    $url = "https://seller.shopee.tw/portal/product/$productId"
    $null = & ziniao-cli.cmd page visit --store-id $StoreId --url $url --wait-until domcontentloaded --timeout 30000
    Start-Sleep -Milliseconds 1800
    $detail = $null
    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
      $raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
      $response = ($raw -join "`n") | ConvertFrom-Json
      if (-not $response.ok) { throw 'page exec failed' }
      $detail = $response.data.data.result | ConvertFrom-Json
      if ($detail.ready -and @($detail.prices).Count) { break }
      Start-Sleep -Milliseconds 1800
    }
    if (-not $detail.ready) { throw 'product price did not finish loading' }
    $record = [ordered]@{
      observedAt = (Get-Date).ToString('o'); storeId = $StoreId; productId = $productId
      name = [string]$entry.Value; prices = @($detail.prices)
      minPrice = if (@($detail.prices).Count) { (@($detail.prices) | Measure-Object -Minimum).Minimum } else { $null }
      maxPrice = if (@($detail.prices).Count) { (@($detail.prices) | Measure-Object -Maximum).Maximum } else { $null }
      promotionText = $detail.promotionText; sourceUrl = $detail.url; error = $null
    }
  } catch {
    $errors += 1
    $record = [ordered]@{ observedAt = (Get-Date).ToString('o'); storeId = $StoreId; productId = $productId; name = [string]$entry.Value; prices = @(); minPrice = $null; maxPrice = $null; promotionText = ''; sourceUrl = "https://seller.shopee.tw/portal/product/$productId"; error = $_.Exception.Message }
  }
  ($record | ConvertTo-Json -Compress -Depth 6) | Add-Content -LiteralPath $outputPath -Encoding utf8
  $processed += 1
  Write-Output ("product {0}/{1}: {2}, prices={3}, error={4}" -f $processed, [Math]::Min($MaxProducts,$productMap.Count), $productId, @($record.prices).Count, [bool]$record.error)
}

$requested = [Math]::Min($MaxProducts,$productMap.Count)
$successful = @{}
if (Test-Path -LiteralPath $outputPath) {
  foreach ($line in Get-Content -LiteralPath $outputPath) {
    if (-not [string]::IsNullOrWhiteSpace($line)) {
      $saved = $line | ConvertFrom-Json
      if (-not $saved.error -and @($saved.prices).Count -gt 0) { $successful[[string]$saved.productId] = $true }
    }
  }
}
$checkpoint = [ordered]@{ storeId=$StoreId; metricDate=$MetricDate; requested=$requested; completed=$successful.Count; processedThisRun=$processed; errorsThisRun=$errors; status=if($successful.Count -ge $requested){'complete'}else{'partial'}; updatedAt=(Get-Date).ToString('o') }
$checkpoint | ConvertTo-Json | Set-Content -LiteralPath $checkpointPath -Encoding utf8
Write-Output ($checkpoint | ConvertTo-Json -Compress)
