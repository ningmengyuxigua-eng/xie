param(
  [string]$MetricDate,
  [switch]$SkipCollect,
  [switch]$SkipGroupCollect
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $MetricDate) {
  $taipei = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'Taipei Standard Time')
  $MetricDate = $taipei.AddDays(-1).ToString('yyyy-MM-dd')
}
if ($MetricDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'MetricDate must be YYYY-MM-DD' }

if (-not $SkipCollect) {
  & (Join-Path $root 'collect-ad-day-all-pages.ps1') -MetricDate $MetricDate
  if ($LASTEXITCODE -ne 0) { throw 'Ad collection failed' }
}

& node (Join-Path $root 'evaluate-ad-day.cjs') $MetricDate
if ($LASTEXITCODE -ne 0) { throw 'Ad evaluation failed' }
& node (Join-Path $root 'summarize-ad-day.cjs') $MetricDate
if ($LASTEXITCODE -ne 0) { throw 'Ad summary failed' }
if (-not $SkipGroupCollect) {
  & (Join-Path $root 'collect-target-group-products.ps1') -MetricDate $MetricDate
  if ($LASTEXITCODE -ne 0) { throw 'Target group product collection failed' }
}
& node (Join-Path $root 'evaluate-group-products.cjs') $MetricDate
if ($LASTEXITCODE -ne 0) { throw 'Target group product evaluation failed' }

Write-Output ("Daily ad analysis complete: {0}" -f $MetricDate)
