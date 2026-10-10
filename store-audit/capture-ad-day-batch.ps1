param(
  [string]$MetricDate = '2026-10-06',
  [int]$ExpectedPage = 1,
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "ad-daily\$MetricDate"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$null = & (Join-Path $root 'open-ad-day.ps1') -MetricDate $MetricDate -StoreId $StoreId
$filterScript = "document.querySelector('[data-testid=campaign-list-status-ongoing]').click()"
$filterReady = $false
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  $null = & ziniao-cli.cmd page exec --store-id $StoreId --script $filterScript --timeout 30000
  Start-Sleep -Milliseconds 1800
  $verifyRaw = & ziniao-cli.cmd page exec --store-id $StoreId --script "JSON.stringify({checked:document.querySelector('[data-testid=campaign-list-status-ongoing]').classList.contains('checked')})" --timeout 30000
  try {
    $verifyResponse = ($verifyRaw -join "`n") | ConvertFrom-Json
    $verify = $verifyResponse.data.data.result | ConvertFrom-Json
    if ($verifyResponse.ok -and $verify.checked) { $filterReady = $true; break }
  } catch {}
}
if (-not $filterReady) { throw 'Ongoing filter did not become active after 3 attempts' }

$captureScript = @'
JSON.stringify((()=>{const t=Array.from(document.querySelectorAll('table'));const h=Array.from(t[1].querySelectorAll('th')).map(x=>x.innerText.trim()).filter(Boolean);const n=Array.from(t[2].querySelectorAll('tr')).map(r=>({text:r.innerText.trim(),url:(r.querySelector('a')||{}).href||''}));const v=Array.from(t[3].querySelectorAll('tr')).map(r=>Array.from(r.querySelectorAll('td')).map(c=>c.innerText.trim()));const rows=n.map((x,i)=>({adText:x.text,url:x.url,metrics:Object.fromEntries(h.map((k,j)=>[k,(v[i][j]||'').split('\n')[0]]))}));const p=(document.querySelector('.eds-pager')||{}).innerText||'';const m=p.match(/(\d+)\s*\/\s*(\d+)/);return {url:location.href,page:m?Number(m[1]):null,total:m?Number(m[2]):null,rows};})())
'@
$raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $captureScript --timeout 30000
$response = ($raw -join "`n") | ConvertFrom-Json
if (-not $response.ok -or $response.data.data.exceptionDetails) { throw 'Page capture failed' }
$page = $response.data.data.result | ConvertFrom-Json
$maxRows = @($page.rows).Count
if ($maxRows -gt 20) { throw "Batch row limit exceeded: $maxRows" }
if ([int]$page.page -ne $ExpectedPage) { throw "Unexpected page $($page.page)" }
if ([int]$page.total -gt 20) { throw "Unexpected active-ad page count $($page.total); filter may be inactive" }

$output = Join-Path $outDir "ad-level-page-$ExpectedPage.json"
$page | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $output -Encoding utf8
$checkpoint = [ordered]@{
  storeId = $StoreId
  metricDate = $MetricDate
  scope = 'active_ad_level'
  lastCompletedPage = $ExpectedPage
  pageCount = [int]$page.total
  batchRowCount = [int]$maxRows
  status = 'partial'
  updatedAt = (Get-Date).ToString('o')
}
$checkpointPath = Join-Path $outDir 'ad-level-checkpoint.json'
$checkpoint | ConvertTo-Json | Set-Content -LiteralPath $checkpointPath -Encoding utf8
Write-Output (($checkpoint + @{ output = $output; checkpoint = $checkpointPath }) | ConvertTo-Json -Compress)
