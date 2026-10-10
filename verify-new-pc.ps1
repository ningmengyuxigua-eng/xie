$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$issues = [System.Collections.Generic.List[string]]::new()

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeVersion = $null
if (-not $nodeCommand) {
  $issues.Add('Node.js was not found. Install Node.js 24.x.')
} else {
  $nodeVersion = (& node -p "process.versions.node").Trim()
  $parts = $nodeVersion.Split('.')
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
    $issues.Add("Node.js $nodeVersion is unsupported. Version 22.5 is the minimum; 24.x is recommended.")
  }
}

$requiredFiles = @(
  'VERSION',
  'shopops.cmd',
  'store-audit\shopops.cjs',
  'store-audit\db\store-audit.sqlite',
  'store-audit\config\store-profile.json',
  'store-audit\config\pickup-message-policy.json'
)
foreach ($relative in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
    $issues.Add("Required file is missing: $relative")
  }
}

$ziniaoAvailable = [bool](Get-Command ziniao-cli.cmd -ErrorAction SilentlyContinue)
$databaseCheck = $null
if ($nodeCommand -and (Test-Path -LiteralPath (Join-Path $root 'store-audit\shopops.cjs'))) {
  try {
    $output = & node (Join-Path $root 'store-audit\shopops.cjs') validate
    $databaseCheck = $output | ConvertFrom-Json
    if (-not $databaseCheck.ok) { $issues.Add('SQLite integrity or foreign-key validation failed.') }
  } catch {
    $issues.Add("Database validation failed: $($_.Exception.Message)")
  }
}

[ordered]@{
  ok = ($issues.Count -eq 0)
  projectRoot = $root
  nodeVersion = $nodeVersion
  ziniaoCliAvailable = $ziniaoAvailable
  database = $databaseCheck
  issues = $issues
  nextStep = if (-not $ziniaoAvailable) { 'Install and configure ziniao-cli, then verify the default store.' } else { 'Verify the default store name, then resume incremental collection.' }
} | ConvertTo-Json -Depth 5
