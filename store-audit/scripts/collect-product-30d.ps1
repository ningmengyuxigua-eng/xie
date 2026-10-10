$ErrorActionPreference = 'Stop'

$storeId = '27857268786685'
$targetId = '581333E01764DE09A1754BE2B201A79D'
$outputDir = Join-Path $PSScriptRoot '..\product-report\2026-10-09'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$products = @(
  @{ id='51015333377'; name='冰箱除霜鏟'; stock=600 },
  @{ id='44234203144'; name='瓦斯爐清潔針'; stock=999 },
  @{ id='55815332702'; name='矽膠清潔刷'; stock=997 },
  @{ id='40833362961'; name='抽繩垃圾袋'; stock=800 },
  @{ id='43783615430'; name='手動磨刀器'; stock=800 },
  @{ id='43884447020'; name='陶瓷瀝油烤盤'; stock=800 },
  @{ id='45867873256'; name='不鏽鋼拔毛夾'; stock=800 },
  @{ id='47368244100'; name='矽膠隔熱墊'; stock=800 },
  @{ id='52368555753'; name='寵物拾便袋'; stock=600 },
  @{ id='55167661781'; name='嬰兒接飯圍兜'; stock=600 },
  @{ id='57515648295'; name='免插電炒冰機'; stock=600 },
  @{ id='44434356078'; name='氣炸鍋矽膠烤盤'; stock=400 },
  @{ id='47017872807'; name='微波爐蒸籠'; stock=400 },
  @{ id='53367755237'; name='兔子饅頭模具'; stock=400 },
  @{ id='53367939557'; name='嬰兒副食品剪刀'; stock=400 },
  @{ id='56067231377'; name='洗碗海綿'; stock=400 },
  @{ id='56367714834'; name='304不鏽鋼瀝油盤'; stock=400 },
  @{ id='57318155140'; name='不鏽鋼瀝油盤'; stock=400 },
  @{ id='57468109537'; name='手動檸檬榨汁器'; stock=299 },
  @{ id='42534833434'; name='披薩滾刀兩件組'; stock=200 }
)

function Invoke-Ziniao([string[]]$arguments) {
  $raw = & ziniao-cli.cmd @arguments
  if ($LASTEXITCODE -ne 0) { throw "ziniao-cli failed: $($arguments -join ' ')" }
  return ($raw -join "`n")
}

function Match-Number([string]$text, [string]$pattern) {
  $m = [regex]::Match($text, $pattern)
  if (-not $m.Success) { return $null }
  return [decimal]::Parse(($m.Groups[1].Value -replace ',', ''), [Globalization.CultureInfo]::InvariantCulture)
}

$results = @()
$index = 0
foreach ($product in $products) {
  $index++
  $url = "https://seller.shopee.tw/datacenter/product/performance/details?id=$($product.id)"
  Invoke-Ziniao @('page','visit','--store-id',$storeId,'--target-id',$targetId,'--url',$url,'--wait-until','domcontentloaded','--timeout','30000') | Out-Null
  Invoke-Ziniao @('page','wait-element','--store-id',$storeId,'--target-id',$targetId,'--selector','.bi-date-input','--timeout','30000') | Out-Null

  $selectScript = "(function(){var a=document.querySelectorAll('.eds-date-shortcut-item');if(a.length<3)return 'missing';a[2].click();return a[2].innerText;})()"
  Invoke-Ziniao @('page','exec','--store-id',$storeId,'--target-id',$targetId,'--script',$selectScript,'--timeout','30000') | Out-Null
  Start-Sleep -Milliseconds 1200

  $contentRaw = Invoke-Ziniao @('page','content','--store-id',$storeId,'--target-id',$targetId,'--content-format','text','--timeout','30000')
  $contentObj = $contentRaw | ConvertFrom-Json
  $text = $contentObj.data.data.content
  $rawPath = Join-Path $outputDir ("product-$($product.id)-30d.txt")
  Set-Content -LiteralPath $rawPath -Value $text -Encoding UTF8

  $result = [ordered]@{
    itemId = $product.id
    displayName = $product.name
    stockSnapshot = $product.stock
    periodStart = '2026-09-09'
    periodEnd = '2026-10-08'
    cardViews = Match-Number $text '商品卡瀏覽數\s+([\d,]+)'
    productClicks = Match-Number $text '商品點擊數\s+([\d,]+)'
    productPageVisitors = Match-Number $text '商品頁的訪客數\s+([\d,]+)'
    productPageViews = Match-Number $text '商品頁瀏覽數\s+([\d,]+)'
    ctrPct = Match-Number $text '點擊率\s+([\d,.]+)%'
    orderConversionPct = Match-Number $text '訂單轉換率\s+([\d,.]+)%'
    salesTwd = Match-Number $text '銷售額\s+NT\$([\d,]+)'
    orders = Match-Number $text '訂單數\s+([\d,]+)'
    units = Match-Number $text '件數\s+([\d,]+)'
    buyers = Match-Number $text '買家數\s+([\d,]+)'
    hasAdEntry = $text.Contains('View Ad')
    collectedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    source = $url
    status = if ($text.Contains('過去 30 天 2026-09-09 - 2026-10-08')) { 'complete' } else { 'date_window_unverified' }
  }
  $results += [pscustomobject]$result
  Write-Host ("[{0}/20] {1} {2}: views={3}, clicks={4}, orders={5}" -f $index,$product.id,$product.name,$result.cardViews,$result.productClicks,$result.orders)
}

$summary = [ordered]@{
  storeDisplayName = '拾味廚房雜貨鋪'
  storeId = $storeId
  platform = 'Shopee Taiwan'
  periodStart = '2026-09-09'
  periodEnd = '2026-10-08'
  generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  itemCount = $results.Count
  items = $results
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'candidate-products-30d.json') -Encoding UTF8

$progress = @"
# 商品資料整合進度

- 店鋪：拾味廚房雜貨鋪
- 來源：蝦皮賣家數據中心／商品表現詳情
- 資料期間：2026-09-09 至 2026-10-08
- 完成範圍：20 個候選商品
- 下一步：整合廣告、商品狀態、價格與促銷，再生成正式 PPT。
"@
Set-Content -LiteralPath (Join-Path $outputDir 'progress.md') -Value $progress -Encoding UTF8

