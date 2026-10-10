param(
  [string[]]$MetricDates,
  [int]$MaxDates = 5,
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$downloadRoot = 'C:\Users\Administrator\AppData\Roaming\ziniaobrowserdatas\ziniao browser\xie1'
$pythonExe = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Bundled Python not found: $pythonExe" }

if (-not $MetricDates -or $MetricDates.Count -eq 0) {
  $planPath = Join-Path $root 'backfill\ads\2026-10-07\plan.json'
  if (-not (Test-Path -LiteralPath $planPath)) { throw "Missing plan: $planPath" }
  $plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
  $MetricDates = @($plan.stage1AdLevelDaily.jobs | Where-Object status -eq 'pending' | Select-Object -First $MaxDates -ExpandProperty metricDate)
}
if ($MetricDates.Count -gt $MaxDates) { throw "Requested $($MetricDates.Count) dates; maximum per run is $MaxDates" }

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

function Wait-ReportReady([string]$DateToken) {
  $script = "JSON.stringify((function(){var items=Array.from(document.querySelectorAll('[data-testid=export-data-result-item]'));var r=items.find(function(x){return x.innerText.indexOf('$DateToken')>=0});return {found:Boolean(r),ready:Boolean(r&&r.querySelector('button'))};})())"
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    $state = Invoke-PageJson -Script $script
    if ($state.ready) { return $true }
    Start-Sleep -Milliseconds 1500
  }
  return $false
}

$results = @()
foreach ($metricDate in $MetricDates) {
  if ($metricDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw "Invalid date: $metricDate" }
  $month = $metricDate.Substring(0, 7)
  $targetDir = Join-Path $root "backfill\raw\ads\daily\$month"
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  $target = Join-Path $targetDir "$metricDate-overall.csv"
  $displayDate = $metricDate.Replace('-', '/')
  $displayName = "蝦皮廣告-總體-數據-$displayDate-$displayDate.csv"
  $downloadName = "蝦皮廣告-總體-數據-$($metricDate.Replace('-', '_'))-$($metricDate.Replace('-', '_')).csv"
  $source = Join-Path $downloadRoot $downloadName

  if (-not (Test-Path -LiteralPath $target)) {
    $null = & (Join-Path $root 'open-ad-day.ps1') -MetricDate $metricDate -StoreId $StoreId
    Start-Sleep -Milliseconds 800
    $null = Invoke-PageJson -Script "JSON.stringify((function(){var b=document.querySelector('[data-testid=export-data-dropdown-trigger]');if(!b)return {ok:false};b.click();return {ok:true};})())"
    Start-Sleep -Milliseconds 600
    $select = Invoke-PageJson -Script "JSON.stringify((function(){var b=document.querySelector('[data-testid=export-data-dropdown-item]');if(!b)return {ok:false};b.click();return {ok:true};})())"
    if (-not $select.ok) { throw "Could not request export for $metricDate" }
    $dateToken = "$displayDate-$displayDate"
    if (-not (Wait-ReportReady -DateToken $dateToken)) { throw "Export was not ready for $metricDate" }

    $click = Invoke-PageJson -Script "JSON.stringify((function(){var items=Array.from(document.querySelectorAll('[data-testid=export-data-result-item]'));var r=items.find(function(x){return x.innerText.indexOf('$dateToken')>=0});var b=r&&r.querySelector('button');if(!b)return {clicked:false};b.click();return {clicked:true};})())"

    $ready = $false
    for ($attempt = 1; $attempt -le 20; $attempt += 1) {
      if (Test-Path -LiteralPath $source) { $ready = $true; break }
      Start-Sleep -Milliseconds 1000
    }
    if (-not $ready) { throw "Downloaded file not found for $metricDate (click=$($click.clicked))" }
    Copy-Item -LiteralPath $source -Destination $target -Force
  }

  $importRaw = & $pythonExe (Join-Path $root 'import-ad-daily-export.py') $target $metricDate
  if ($LASTEXITCODE -ne 0) { throw "Import failed for $metricDate" }
  $import = ($importRaw -join "`n") | ConvertFrom-Json
  $results += [ordered]@{
    metricDate = $metricDate
    rows = $import.rows
    inserted = $import.inserted
    updated = $import.updated
    duplicates = $import.duplicates
    matched = $import.matches.matched_unique_name
    unmatched = $import.matches.unmatched
    ambiguous = $import.matches.ambiguous
    path = $target
  }
  Write-Output ("completed {0}: rows={1}, matched={2}, unmatched={3}" -f $metricDate, $import.rows, $import.matches.matched_unique_name, $import.matches.unmatched)
}

$resultPath = Join-Path $root 'backfill\ads\2026-10-07\latest-daily-export-batch.json'
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
Write-Output (($results | ConvertTo-Json -Compress -Depth 5))
