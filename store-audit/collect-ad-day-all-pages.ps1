param(
  [string]$MetricDate = '2026-10-06',
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root "ad-daily\$MetricDate"
$checkpointPath = Join-Path $outDir 'ad-level-checkpoint.json'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$captureScript = @'
JSON.stringify((()=>{const t=Array.from(document.querySelectorAll('table'));const h=Array.from(t[1].querySelectorAll('th')).map(x=>x.innerText.trim()).filter(Boolean);const n=Array.from(t[2].querySelectorAll('tr')).map(r=>({text:r.innerText.trim(),url:(r.querySelector('a')||{}).href||''}));const v=Array.from(t[3].querySelectorAll('tr')).map(r=>Array.from(r.querySelectorAll('td')).map(c=>c.innerText.trim()));const rows=n.map((x,i)=>({adText:x.text,url:x.url,metrics:Object.fromEntries(h.map((k,j)=>[k,(v[i][j]||'').split('\n')[0]]))}));const p=(document.querySelector('.eds-pager')||{}).innerText||'';const m=p.match(/(\d+)\s*\/\s*(\d+)/);return {url:location.href,page:m?Number(m[1]):null,total:m?Number(m[2]):null,rows};})())
'@

function Invoke-PageJson([string]$Script, [int]$MaxAttempts = 3) {
  $lastError = ''
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    try {
      $raw = & ziniao-cli.cmd page exec --store-id $StoreId --script $Script --timeout 30000
      $response = ($raw -join "`n") | ConvertFrom-Json
      if (-not $response.ok -or $response.data.data.exceptionDetails) { throw 'page exec returned an error' }
      return ($response.data.data.result | ConvertFrom-Json)
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Milliseconds 1200
    }
  }
  throw "Page exec failed after $MaxAttempts attempts: $lastError"
}

$null = & (Join-Path $root 'open-ad-day.ps1') -MetricDate $MetricDate -StoreId $StoreId
$filterScript = "document.querySelector('[data-testid=campaign-list-status-ongoing]').click();JSON.stringify(true)"
$verifyScript = "JSON.stringify({checked:document.querySelector('[data-testid=campaign-list-status-ongoing]').classList.contains('checked')})"
$filterReady = $false
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  try { $null = Invoke-PageJson -Script $filterScript -MaxAttempts 1 } catch {}
  Start-Sleep -Milliseconds 1500
  try {
    $verify = Invoke-PageJson -Script $verifyScript -MaxAttempts 1
    if ($verify.checked) { $filterReady = $true; break }
  } catch {}
}
if (-not $filterReady) { throw 'Ongoing filter did not become active after 3 attempts' }

$first = Invoke-PageJson -Script $captureScript
if ($first.page -ne 1) { throw "Expected page 1, got $($first.page)" }
$totalPages = [int]$first.total
if ($totalPages -gt 20) { throw "Unexpected active-ad page count $totalPages" }

$lastFirstUrl = ''
for ($pageNumber = 1; $pageNumber -le $totalPages; $pageNumber += 1) {
  $page = if ($pageNumber -eq 1) { $first } else { Invoke-PageJson -Script $captureScript }
  if ([int]$page.page -ne $pageNumber) { throw "Expected page $pageNumber, got $($page.page)" }
  $rowCount = @($page.rows).Count
  if ($rowCount -gt 20) { throw ("Batch row limit exceeded on page {0}: {1}" -f $pageNumber, $rowCount) }
  if ($rowCount -eq 0) { throw "Empty page $pageNumber" }
  $firstUrl = [string]$page.rows[0].url
  if ($firstUrl -eq $lastFirstUrl) { throw "Repeated page data at page $pageNumber" }
  $lastFirstUrl = $firstUrl

  $output = Join-Path $outDir "ad-level-page-$pageNumber.json"
  $page | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $output -Encoding utf8
  $importRaw = & node (Join-Path $root 'import-ad-day-page.cjs') $MetricDate $pageNumber
  if ($LASTEXITCODE -ne 0) { throw "Database import failed on page $pageNumber" }
  $import = ($importRaw -join "`n") | ConvertFrom-Json

  $checkpoint = [ordered]@{
    storeId = $StoreId
    metricDate = $MetricDate
    scope = 'active_ad_level'
    lastCompletedPage = $pageNumber
    pageCount = $totalPages
    batchRowCount = $rowCount
    totalDatabaseRows = $import.summary.rows
    status = if ($pageNumber -eq $totalPages) { 'complete' } else { 'partial' }
    updatedAt = (Get-Date).ToString('o')
  }
  $checkpoint | ConvertTo-Json | Set-Content -LiteralPath $checkpointPath -Encoding utf8
  Write-Output ("completed page {0}/{1}: batch={2}, databaseRows={3}" -f $pageNumber, $totalPages, $rowCount, $import.summary.rows)

  if ($pageNumber -lt $totalPages) {
    $clicked = $false
    $nextScript = "JSON.stringify((()=>{const b=document.querySelector('.eds-pager__button-next');if(!b||b.disabled||b.classList.contains('disabled'))return {clicked:false};b.click();return {clicked:true};})())"
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
      try {
        $clickResult = Invoke-PageJson -Script $nextScript -MaxAttempts 1
        if ($clickResult.clicked) { $clicked = $true; break }
      } catch {}
      Start-Sleep -Milliseconds 1200
    }
    if (-not $clicked) { throw "Next-page click failed after 3 attempts on page $pageNumber" }
    Start-Sleep -Milliseconds 1600
  }
}

Write-Output ($checkpoint | ConvertTo-Json -Compress)
