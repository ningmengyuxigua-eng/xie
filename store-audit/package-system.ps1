param(
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = (Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must use major.minor.patch format.' }

$distRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$stageRoot = [System.IO.Path]::GetFullPath((Join-Path $distRoot ".stage-shopops-portable-$Version"))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $distRoot "shopops-portable-v$Version.zip"))
if (-not $stageRoot.StartsWith($distRoot + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe staging path.' }

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

$rootFiles = @(
  '.gitignore', 'AGENTS.md', 'README.md', 'VERSION', 'CHANGELOG.md', 'MIGRATE-TO-NEW-PC.md',
  'verify-new-pc.ps1', 'shopops.cmd', 'package.json'
)
$dataDirectories = @(
  '27857268786685', 'ad-daily', 'analysis', 'backfill', 'config', 'db', 'docs',
  'product-report', 'product-traffic', 'progress', 'reporting', 'reports', 'review', 'scripts',
  'shop-health', 'state'
)

$sourceFiles = [System.Collections.Generic.List[string]]::new()
foreach ($relative in $rootFiles) {
  $source = Join-Path $projectRoot $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing package file: $relative" }
  $sourceFiles.Add($source)
}
Get-ChildItem -LiteralPath $projectRoot -File | Where-Object {
  $_.Length -gt 0 -and $_.Extension -in @('.md', '.txt')
} | ForEach-Object { $sourceFiles.Add($_.FullName) }
Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object {
  $_.Extension -in @('.cjs', '.js', '.ps1', '.py')
} | ForEach-Object { $sourceFiles.Add($_.FullName) }
foreach ($directory in $dataDirectories) {
  $sourceDirectory = Join-Path $PSScriptRoot $directory
  if (Test-Path -LiteralPath $sourceDirectory -PathType Container) {
    Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File | Where-Object {
      $_.Name -notlike '*.tmp' -and $_.Name -notlike '*.lock' -and
      $_.Name -notlike '*.sqlite-wal' -and $_.Name -notlike '*.sqlite-shm'
    } | ForEach-Object { $sourceFiles.Add($_.FullName) }
  }
}

$uniqueFiles = $sourceFiles | Sort-Object -Unique
foreach ($source in $uniqueFiles) {
  if (-not $source.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar)) {
    throw "Package source escaped project root: $source"
  }
  $relative = $source.Substring($projectRoot.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar)
  $target = Join-Path $stageRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$manifest = [ordered]@{
  package = 'shopops-portable'
  version = $Version
  createdAt = (Get-Date).ToString('o')
  storeId = '27857268786685'
  storeDisplayNameSource = 'store-audit/config/store-profile.json'
  entryPoint = 'shopops.cmd'
  verificationScript = 'verify-new-pc.ps1'
  databaseIncluded = $true
  historicalAdDataIncluded = $true
  historicalProductTrafficIncluded = $true
  analysisAndReportsIncluded = $true
  credentialsIncluded = $false
  includedFileCountBeforeManifest = $uniqueFiles.Count
  excluded = @(
    '.git and editor metadata',
    'store-audit/backups duplicate snapshots',
    'full browser HTML and page captures under dated raw folders',
    'previous distribution archives',
    'node_modules and caches',
    'Ziniao credentials, cookies and API keys',
    'Codex desktop scheduled automation registration'
  )
  requirements = [ordered]@{
    operatingSystem = 'Windows 10/11'
    powershell = '5.1 or later'
    node = '24.x recommended; 22.5 or later required for node:sqlite'
  }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stageRoot 'package-manifest.json') -Encoding utf8

$checksumLines = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($stageRoot.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
$checksumLines | Set-Content -LiteralPath (Join-Path $stageRoot 'CHECKSUMS.sha256') -Encoding utf8

$temporaryArchive = "$archivePath.tmp.zip"
if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive -Force }
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $temporaryArchive -CompressionLevel Optimal
Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$archiveSize = (Get-Item -LiteralPath $archivePath).Length
$finalFileCount = (Get-ChildItem -LiteralPath $stageRoot -Recurse -File).Count
$sidecarPath = "$archivePath.sha256"
"$archiveHash  $([System.IO.Path]::GetFileName($archivePath))" | Set-Content -LiteralPath $sidecarPath -Encoding ascii

Remove-Item -LiteralPath $stageRoot -Recurse -Force
[ordered]@{
  archivePath = $archivePath
  bytes = $archiveSize
  sha256 = $archiveHash
  sha256File = $sidecarPath
  includedFileCount = $finalFileCount
} | ConvertTo-Json -Compress
