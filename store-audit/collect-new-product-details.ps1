param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$storeId = '27857268786685'
$rows = @(Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json)
if ($rows.Count -gt 20) { throw 'A detail batch cannot exceed 20 products' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$completed = 0

foreach ($row in $rows) {
  $productId = [string]$row.productId
  if ($productId -notmatch '^\d+$') { throw "Invalid product ID: $productId" }
  $source = "(async()=>{const r=await fetch('/api/v3/product/get_product_info?product_id=$productId&is_draft=false',{credentials:'include'});const j=await r.json();return JSON.stringify({http:r.status,body:j});})()"
  $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))
  $script = "eval(atob('$base64'))"
  $raw = & ziniao-cli.cmd page exec --store-id $storeId --script $script --timeout 30000
  $wrapper = ($raw -join "`n") | ConvertFrom-Json
  if (-not $wrapper.ok -or $wrapper.data.data.exceptionDetails) { throw "Detail read failed: $productId" }
  $result = $wrapper.data.data.result | ConvertFrom-Json
  if ([int]$result.http -ne 200) { throw "Detail HTTP $($result.http): $productId" }
  $result.body | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath (Join-Path $OutputDirectory "$productId.json") -Encoding utf8
  $completed++
  Write-Output ("detail {0}/{1}: {2}" -f $completed,$rows.Count,$productId)
}

[ordered]@{ status='complete'; requested=$rows.Count; completed=$completed; outputDirectory=$OutputDirectory; finishedAt=(Get-Date).ToString('o') } |
  ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $OutputDirectory 'checkpoint.json') -Encoding utf8
Write-Output ("completed $completed product details")
