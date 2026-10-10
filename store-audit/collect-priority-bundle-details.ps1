param(
  [string]$StoreId = '27857268786685',
  [string[]]$ProductIds = @(
    '51015333358',
    '46565646410',
    '43184145393',
    '52865621381',
    '40834145983',
    '47265353153',
    '53515625140'
  ),
  [string]$OutputFile = 'priority-bundle-product-details.jsonl'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$output = Join-Path $root "analysis\$OutputFile"

$records = @()
foreach ($productId in $ProductIds) {
  try {
    $script = "fetch('/api/v3/product/get_product_info?product_id=$productId&is_draft=false').then(r=>r.json()).then(x=>{const p=x.data.product_info;const labels=(p.promotion_info.bundle_deal_label_list||[]).map(v=>v.value);return JSON.stringify({productId:String(p.id),name:p.name,parentSku:p.parent_sku,status:p.status,categoryPath:p.category_path_name_list,promotion:{campaignTypes:[...new Set(p.promotion_info.ongoing_campaign_list||[])],labels:[...new Set(labels)]},variations:p.model_list.map(m=>({variationId:String(m.id),name:m.name,sku:m.sku||null,normalPrice:Number(m.price_info.normal_price),promotionPrice:Number(m.price_info.promotion_price),currentPrice:Number(m.price_info.promotion_price)>0?Number(m.price_info.promotion_price):Number(m.price_info.normal_price),availableStatus:m.available_status,stock:m.stock_detail.total_available_stock,preOrder:Boolean(m.pre_order_info.pre_order),daysToShip:m.pre_order_info.days_to_ship}))});})"
    $raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
    $response = ($raw -join "`n") | ConvertFrom-Json
    if (-not $response.ok) { throw 'page exec failed' }
    $detail = $response.data.data.result | ConvertFrom-Json
    $record = [ordered]@{
      observedAt = (Get-Date).ToString('o')
      storeId = $StoreId
      productId = $detail.productId
      name = $detail.name
      parentSku = $detail.parentSku
      status = $detail.status
      categoryPath = @($detail.categoryPath)
      promotion = $detail.promotion
      variations = @($detail.variations)
      error = $null
    }
  } catch {
    $record = [ordered]@{
      observedAt = (Get-Date).ToString('o')
      storeId = $StoreId
      productId = $productId
      name = $null
      parentSku = $null
      status = $null
      categoryPath = @()
      promotion = $null
      variations = @()
      error = $_.Exception.Message
    }
  }
  $records += [pscustomobject]$record
  Write-Output ("read product={0}, variations={1}, error={2}" -f $productId, @($record.variations).Count, [bool]$record.error)
}

$records | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 10 } | Set-Content -LiteralPath $output -Encoding utf8
$errors = @($records | Where-Object error).Count
Write-Output (([ordered]@{ products = $records.Count; errors = $errors; output = $output }) | ConvertTo-Json -Compress)
