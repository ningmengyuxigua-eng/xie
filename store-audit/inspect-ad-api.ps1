param([string]$StoreId = '27857268786685')

$ErrorActionPreference = 'Stop'
$script = @'
JSON.stringify([...new Set(performance.getEntriesByType('resource').map(x=>x.name).filter(x=>x.includes('/api/')).filter(x=>/ads|pas|campaign|report|marketing/i.test(x)))])
'@
$raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
$response = ($raw -join "`n") | ConvertFrom-Json
if (-not $response.ok) { throw 'page exec failed' }
$urls = $response.data.data.result | ConvertFrom-Json
$out = 'D:\xiapi\store-audit\analysis\ad-api-resources.json'
$urls | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $out -Encoding utf8
Write-Output (([ordered]@{ resources = @($urls).Count; output = $out }) | ConvertTo-Json -Compress)
