param(
  [string]$MetricDate,
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $MetricDate) {
  $taipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Taipei Standard Time')
  $MetricDate = $taipei.ToString('yyyy-MM-dd')
}
$outDir = Join-Path $root "ad-daily\$MetricDate"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

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
$ready = $false
for ($attempt = 1; $attempt -le 3; $attempt += 1) {
  try { $null = Invoke-PageJson -Script $filterScript -MaxAttempts 1 } catch {}
  Start-Sleep -Milliseconds 1200
  try { if ((Invoke-PageJson -Script $verifyScript -MaxAttempts 1).checked) { $ready = $true; break } } catch {}
}
if (-not $ready) { throw 'Ongoing filter did not become active' }

$captureScript = @'
JSON.stringify((()=>{const tables=Array.from(document.querySelectorAll('table'));const rows=Array.from((tables[2]||document).querySelectorAll('tr')).map(r=>{const text=r.innerText.trim();const href=(r.querySelector('a')||{}).href||'';const id=href.match(/\/(\d+)(?:\?|$)/)?.[1]||'';const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);const name=lines.find(x=>!/^\.{3}$/.test(x)&&!/(全站推廣|商品搜尋廣告|無結束日期|進行中|加速推廣中|ROAS達成率)/.test(x))||'';return {adId:id,adName:name,accelerated:text.includes('加速推廣中')};}).filter(x=>x.adId);const pager=(document.querySelector('.eds-pager')||{}).innerText||'';const m=pager.match(/(\d+)\s*\/\s*(\d+)/);return {page:m?Number(m[1]):null,total:m?Number(m[2]):null,rowCount:rows.length,matches:rows.filter(x=>x.accelerated).map(({adId,adName})=>({adId,adName}))};})())
'@

$first = Invoke-PageJson -Script $captureScript
$totalPages = [int]$first.total
if ($totalPages -lt 1 -or $totalPages -gt 20) { throw "Unexpected page count: $totalPages" }
$matches = @()
$totalRows = 0
for ($pageNumber=1; $pageNumber -le $totalPages; $pageNumber+=1) {
  $page = if ($pageNumber -eq 1) { $first } else { Invoke-PageJson -Script $captureScript }
  if ([int]$page.page -ne $pageNumber) { throw "Expected page $pageNumber, got $($page.page)" }
  if ([int]$page.rowCount -gt 20) { throw "Row limit exceeded on page $pageNumber" }
  $totalRows += [int]$page.rowCount
  $matches += @($page.matches)
  Write-Output ("page {0}/{1}: rows={2}, accelerated={3}" -f $pageNumber,$totalPages,$page.rowCount,@($page.matches).Count)
  if ($pageNumber -lt $totalPages) {
    $clicked = Invoke-PageJson -Script "JSON.stringify((()=>{const b=document.querySelector('.eds-pager__button-next');if(!b||b.disabled)return {clicked:false};b.click();return {clicked:true};})())"
    if (-not $clicked.clicked) { throw "Next page failed at $pageNumber" }
    Start-Sleep -Milliseconds 1400
  }
}

$unique = @($matches | Group-Object adId | ForEach-Object { $_.Group[0] })
$result = [ordered]@{
  storeId = $StoreId
  displayName = '拾味廚房雜貨鋪'
  observedDate = $MetricDate
  scope = 'ongoing_ads'
  ongoingAds = $totalRows
  acceleratedAds = $unique.Count
  items = $unique
  status = 'complete'
  observedAt = (Get-Date).ToString('o')
}
$path = Join-Path $outDir 'accelerated-ads.json'
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8
Write-Output (([ordered]@{status='complete';ongoingAds=$totalRows;acceleratedAds=$unique.Count;output=$path}) | ConvertTo-Json -Compress)

