$ErrorActionPreference = 'Stop'

$storeId = '27857268786685'
$targetId = '581333E01764DE09A1754BE2B201A79D'
$baseDir = Join-Path $PSScriptRoot '..\product-report\2026-10-09'
$candidatePath = Join-Path $baseDir 'candidate-products-30d.json'
$products = (Get-Content -Raw -Encoding UTF8 $candidatePath | ConvertFrom-Json).items

function Invoke-Ziniao([string[]]$arguments) {
  $raw = & ziniao-cli.cmd @arguments
  if ($LASTEXITCODE -ne 0) { throw "ziniao-cli failed: $($arguments -join ' ')" }
  return ($raw -join "`n")
}

$results = @()
$index = 0
foreach ($product in $products) {
  $index++
  $url = "https://seller.shopee.tw/portal/product/$($product.itemId)"
  Invoke-Ziniao @('page','visit','--store-id',$storeId,'--target-id',$targetId,'--url',$url,'--wait-until','domcontentloaded','--timeout','30000') | Out-Null

  $text = ''
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    Start-Sleep -Milliseconds 2000
    $raw = Invoke-Ziniao @('page','content','--store-id',$storeId,'--target-id',$targetId,'--content-format','text','--timeout','30000')
    $obj = $raw | ConvertFrom-Json
    $text = $obj.data.data.content
    if ($text.Length -gt 1800 -and $text.Contains('售價:') -and $text.Contains('商品描述')) { break }
  }

  Set-Content -LiteralPath (Join-Path $baseDir ("product-$($product.itemId)-current.txt")) -Value $text -Encoding UTF8
  $priceMatches = [regex]::Matches($text, '售價:NT\$([\d,]+)')
  $prices = @($priceMatches | ForEach-Object { [int](($_.Groups[1].Value) -replace ',', '') } | Sort-Object -Unique)
  $remaining = [regex]::Match($text, '剩餘\s+(\d+)\s+天')
  $promo = [regex]::Match($text, '目前的促銷活動\s+(.+?)\s+商品保存狀況')

  $results += [pscustomobject][ordered]@{
    itemId = [string]$product.itemId
    displayName = [string]$product.displayName
    active = ($text.Contains('下架') -and $text.Contains('更新'))
    priceMinTwd = if ($prices.Count) { ($prices | Measure-Object -Minimum).Minimum } else { $null }
    priceMaxTwd = if ($prices.Count) { ($prices | Measure-Object -Maximum).Maximum } else { $null }
    variantPriceCount = $prices.Count
    promotionText = if ($promo.Success) { $promo.Groups[1].Value.Trim() } else { $null }
    newProductDaysRemaining = if ($remaining.Success) { [int]$remaining.Groups[1].Value } else { $null }
    inferredListingAgeDays = if ($remaining.Success) { 90 - [int]$remaining.Groups[1].Value } else { $null }
    collectedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    source = $url
    status = if ($text.Length -gt 1800 -and $text.Contains('售價:')) { 'complete' } else { 'page_not_ready' }
  }
  Write-Host ("[{0}/20] {1}: price={2}-{3}, active={4}" -f $index,$product.displayName,$results[-1].priceMinTwd,$results[-1].priceMaxTwd,$results[-1].active)
}

$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $baseDir 'candidate-product-current-facts.json') -Encoding UTF8
