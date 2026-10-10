param(
  [string]$ProductId = '51015333358',
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$url = "https://seller.shopee.tw/portal/product/$ProductId"
$null = & ziniao-cli.cmd page visit --store-id $StoreId --url $url --wait-until domcontentloaded --timeout 30000
Start-Sleep -Milliseconds 1800
$script = "fetch('/api/v3/product/get_product_info?product_id=$ProductId&is_draft=false').then(r=>r.json()).then(x=>{const p=x.data.product_info;return JSON.stringify({id:p.id,name:p.name,parentSku:p.parent_sku,promotionInfo:p.promotion_info,tierVariation:p.tier_variation,modelSample:p.model_list[0]});})"
$raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
$response = ($raw -join "`n") | ConvertFrom-Json
if (-not $response.ok) { throw 'page exec failed' }
$result = $response.data.data.result | ConvertFrom-Json
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "analysis\product-api-shape-$ProductId.json"
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding utf8
Write-Output (([ordered]@{ productId = $ProductId; output = $out }) | ConvertTo-Json -Compress)
