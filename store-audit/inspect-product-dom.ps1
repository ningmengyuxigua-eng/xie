param(
  [string]$ProductId = '51015333358',
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$url = "https://seller.shopee.tw/portal/product/$ProductId"
$null = & ziniao-cli.cmd page visit --store-id $StoreId --url $url --wait-until domcontentloaded --timeout 30000
Start-Sleep -Milliseconds 2200
$script = @'
JSON.stringify((()=>{const inputs=Array.from(document.querySelectorAll('input')).map((e,i)=>{const p=e.closest('tr');const c=p?p:e.parentElement.parentElement;return {i,value:e.value,type:e.type,placeholder:e.placeholder,cls:String(e.className),context:c?c.innerText.slice(0,180):''}}).filter(x=>Boolean(x.value)).slice(-80);const saleNodes=Array.from(document.querySelectorAll('*')).filter(e=>e.children.length===0&&e.textContent.includes('售價:')).slice(0,30).map(e=>({text:e.textContent,tag:e.tagName,cls:String(e.className),parent:e.parentElement?e.parentElement.outerHTML.slice(0,1400):''}));const resources=performance.getEntriesByType('resource').map(x=>x.name).filter(x=>/product|item|model|seller/i.test(x)).slice(-80);return {inputs,saleNodes,resources};})())
'@
$raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
$response = ($raw -join "`n") | ConvertFrom-Json
if (-not $response.ok) { throw 'page exec failed' }
$rows = $response.data.data.result | ConvertFrom-Json
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "analysis\dom-inputs-$ProductId.json"
$rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $out -Encoding utf8
Write-Output (([ordered]@{ productId = $ProductId; inputs = @($rows.inputs).Count; saleNodes = @($rows.saleNodes).Count; resources = @($rows.resources).Count; output = $out }) | ConvertTo-Json -Compress)
