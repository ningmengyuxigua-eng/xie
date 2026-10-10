[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][datetime]$DateFrom,
  [Parameter(Mandatory=$true)][datetime]$DateTo,
  [string]$StoreId = '27857268786685',
  [string]$ExpectedStoreName = 'xie1',
  [int]$PageSize = 20,
  [int]$MaxPages = 0,
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\product-traffic\raw')
)

$ErrorActionPreference = 'Stop'
if ($DateTo.Date -lt $DateFrom.Date) { throw 'DateTo must be on or after DateFrom.' }
if ($PageSize -lt 1 -or $PageSize -gt 20) { throw 'PageSize must be between 1 and 20.' }

$checkpointPath = Join-Path (Split-Path $OutputRoot -Parent) 'checkpoint.json'
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

function Invoke-Ziniao([string[]]$Arguments) {
  $raw = & ziniao-cli.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw "ziniao-cli failed: $($Arguments -join ' ')" }
  return ($raw -join "`n")
}

function Invoke-PageJson([string]$Script) {
  $raw = Invoke-Ziniao @('page','exec','--store-id',$StoreId,'--script',$Script,'--timeout','45000')
  $outer = $raw | ConvertFrom-Json
  if (-not $outer.ok) {
    $message = if ($outer.error.message) { [string]$outer.error.message } else { 'page exec failed' }
    throw $message
  }
  $payload = $outer.data.data.result
  if ([string]::IsNullOrWhiteSpace([string]$payload)) { throw 'page exec returned an empty payload' }
  return ($payload | ConvertFrom-Json -Depth 100)
}

function Save-JsonAtomic([object]$Value, [string]$Path) {
  $tmp = "$Path.tmp"
  $Value | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-Epoch([datetime]$Date) {
  $offset = [DateTimeOffset]::new($Date.Year,$Date.Month,$Date.Day,0,0,0,[TimeSpan]::FromHours(8))
  return $offset.ToUnixTimeSeconds()
}

$resolvedRaw = Invoke-Ziniao @('store','resolve','--id',$StoreId)
$resolved = $resolvedRaw | ConvertFrom-Json
if (-not $resolved.ok -or [string]$resolved.data.storeId -ne $StoreId) {
  throw "Store verification failed for $ExpectedStoreName ($StoreId)."
}
$openRaw = Invoke-Ziniao @('store','open','--id',$StoreId,'--expected-name',$ExpectedStoreName,'--url','https://seller.shopee.tw/datacenter/product/traffic')
$open = $openRaw | ConvertFrom-Json
if (-not $open.ok -or [string]$open.data.name -ne $ExpectedStoreName -or [string]$open.data.storeId -ne $StoreId) {
  throw "Opened store did not match $ExpectedStoreName ($StoreId)."
}
Invoke-Ziniao @('page','wait-element','--store-id',$StoreId,'--selector','section','--timeout','30000') | Out-Null

if (Test-Path -LiteralPath $checkpointPath) {
  $checkpoint = Get-Content -LiteralPath $checkpointPath -Raw | ConvertFrom-Json -AsHashtable
  if ($DateFrom.ToString('yyyy-MM-dd') -lt $checkpoint.dateFrom) { $checkpoint.dateFrom = $DateFrom.ToString('yyyy-MM-dd') }
  if ($DateTo.ToString('yyyy-MM-dd') -gt $checkpoint.dateTo) { $checkpoint.dateTo = $DateTo.ToString('yyyy-MM-dd') }
} else {
  $checkpoint = [ordered]@{
    schemaVersion = 1
    storeId = $StoreId
    storeDisplayName = '拾味廚房雜貨鋪'
    sourceStoreName = $ExpectedStoreName
    dateFrom = $DateFrom.ToString('yyyy-MM-dd')
    dateTo = $DateTo.ToString('yyyy-MM-dd')
    pageSize = $PageSize
    days = [ordered]@{}
    updatedAt = (Get-Date).ToString('o')
  }
}

$date = $DateFrom.Date
while ($date -le $DateTo.Date) {
  $dateKey = $date.ToString('yyyy-MM-dd')
  $dayDir = Join-Path $OutputRoot $dateKey
  New-Item -ItemType Directory -Force -Path $dayDir | Out-Null
  if (-not $checkpoint.days.Contains($dateKey)) {
    $checkpoint.days[$dateKey] = [ordered]@{ status='pending'; total=$null; expectedPages=$null; completedPages=@(); startedAt=(Get-Date).ToString('o'); completedAt=$null; lastError=$null }
  }
  $dayState = $checkpoint.days[$dateKey]
  if ($dayState.status -eq 'complete' -and $MaxPages -eq 0) {
    Write-Host "$dateKey already complete; skipped"
    $date = $date.AddDays(1)
    continue
  }

  $start = Get-Epoch $date
  $end = Get-Epoch $date.AddDays(1)
  try {
    $overviewPath = Join-Path $dayDir 'overview.json'
    if (-not (Test-Path -LiteralPath $overviewPath)) {
      $overviewScript = "(async function(){var u='/api/mydata/v1/product/traffic/overview/?start_time=$start&end_time=$end&period=day&order_type=confirmed';var r=await fetch(u,{credentials:'include'});var j=await r.json();return JSON.stringify({httpStatus:r.status,metricDate:'$dateKey',sourceUrl:u,response:j,collectedAt:new Date().toISOString()})})()"
      $overview = Invoke-PageJson $overviewScript
      if ($overview.response.code -ne 0) { throw "overview API error: $($overview.response.msg)" }
      Save-JsonAtomic $overview $overviewPath
    }

    $page = 1
    $expectedPages = if ($dayState.expectedPages) { [int]$dayState.expectedPages } else { 0 }
    while ($expectedPages -eq 0 -or $page -le $expectedPages) {
      if ($MaxPages -gt 0 -and $page -gt $MaxPages) { break }
      $pagePath = Join-Path $dayDir ("page-{0:D3}.json" -f $page)
      if ($dayState.completedPages -contains $page -and (Test-Path -LiteralPath $pagePath)) {
        $page++
        continue
      }
      $pageScript = "(async function(){var u='/api/mydata/v1/product/traffic/item-list/?keyword=&order_by=&page_size=$PageSize&page_num=$page&category_type=shopee&category_id=-1&l1_source=psd_label_product_card&start_time=$start&end_time=$end&period=day&order_type=confirmed';var r=await fetch(u,{credentials:'include'});var j=await r.json();return JSON.stringify({httpStatus:r.status,metricDate:'$dateKey',page:$page,pageSize:$PageSize,sourceUrl:u,response:j,collectedAt:new Date().toISOString()})})()"
      $payload = Invoke-PageJson $pageScript
      if ($payload.response.code -ne 0) { throw "item-list API error on page $page`: $($payload.response.msg)" }
      Save-JsonAtomic $payload $pagePath
      $total = [int]$payload.response.result.total
      $expectedPages = [Math]::Ceiling($total / $PageSize)
      $dayState.total = $total
      $dayState.expectedPages = $expectedPages
      $dayState.completedPages = @($dayState.completedPages + $page | Sort-Object -Unique)
      $dayState.status = 'partial'
      $dayState.lastError = $null
      $checkpoint.updatedAt = (Get-Date).ToString('o')
      Save-JsonAtomic $checkpoint $checkpointPath
      $page++
    }

    if ($MaxPages -eq 0 -and $dayState.completedPages.Count -ge $expectedPages) {
      $dayState.status = 'complete'
      $dayState.completedAt = (Get-Date).ToString('o')
      $checkpoint.updatedAt = (Get-Date).ToString('o')
      Save-JsonAtomic $checkpoint $checkpointPath
      Write-Host ("{0} complete: {1} products, {2} pages" -f $dateKey,$dayState.total,$expectedPages)
    } else {
      Write-Host ("{0} partial: {1}/{2} pages" -f $dateKey,$dayState.completedPages.Count,$expectedPages)
    }
  } catch {
    $dayState.status = 'failed'
    $dayState.lastError = $_.Exception.Message
    $checkpoint.updatedAt = (Get-Date).ToString('o')
    Save-JsonAtomic $checkpoint $checkpointPath
    throw
  }
  $date = $date.AddDays(1)
}

Write-Host "checkpoint: $checkpointPath"
