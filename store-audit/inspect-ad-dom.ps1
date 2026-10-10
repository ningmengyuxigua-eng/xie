param([string]$StoreId = '27857268786685')
$ErrorActionPreference = 'Stop'
$script = @'
JSON.stringify(Array.from(document.querySelectorAll('table')).map((t,i)=>{const r=t.querySelector('tr');return {i,cls:String(t.className),rows:t.querySelectorAll('tr').length,first:r?r.innerText.slice(0,500):''}}))
'@
$raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
$response = ($raw -join "`n") | ConvertFrom-Json
if (-not $response.ok) { throw 'page exec failed' }
$result = $response.data.data.result | ConvertFrom-Json
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'D:\xiapi\store-audit\analysis\ad-table-shape.json' -Encoding utf8
Write-Output ($result | ConvertTo-Json -Depth 5)
