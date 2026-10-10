param([string]$CloudRoot='', [switch]$SkipPackageBuild)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if([string]::IsNullOrWhiteSpace($CloudRoot)){
  if([string]::IsNullOrWhiteSpace($env:OneDrive)){throw 'OneDrive path is not configured.'}
  $CloudRoot=Join-Path $env:OneDrive 'ShopOps-Backup'
}
$validation=& node (Join-Path $projectRoot 'store-audit\shopops.cjs') validate|ConvertFrom-Json; if(-not$validation.ok){throw 'Database validation failed.'}
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim()
if(-not$SkipPackageBuild){$packageJson=& (Join-Path $projectRoot 'store-audit\package-system.ps1') -Version $version|Select-Object -Last 1;$package=$packageJson|ConvertFrom-Json}else{$archive=Join-Path $projectRoot "store-audit\dist\shopops-portable-v$version.zip";$package=[pscustomobject]@{archivePath=$archive;sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $archive).Length}}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$day=Get-Date -Format 'yyyy-MM-dd';$dailyDir=Join-Path $CloudRoot "daily\$day";$latestDir=Join-Path $CloudRoot 'latest';New-Item -ItemType Directory -Path $dailyDir,$latestDir -Force|Out-Null
$fileName="shopops-data-$stamp-v$version.zip";$target=Join-Path $dailyDir $fileName;Copy-Item -LiteralPath $package.archivePath -Destination $target -Force
$hash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant();if($hash-ne$package.sha256){throw 'Cloud copy checksum mismatch.'}
$manifest=[ordered]@{formatVersion=1;storeId='27857268786685';storeDisplayName='拾味廚房雜貨鋪';applicationVersion=$version;databaseSchemaVersion=$validation.schemaVersion;createdAt=(Get-Date).ToString('o');archiveName=$fileName;bytes=(Get-Item -LiteralPath $target).Length;sha256=$hash;sourceCommit=(git -C $projectRoot rev-parse HEAD).Trim();databaseMode='closed_snapshot';credentialsIncluded=$false}
$manifestPath=Join-Path $dailyDir 'manifest.json';$manifest|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $manifestPath -Encoding utf8
Copy-Item -LiteralPath $target -Destination (Join-Path $latestDir 'shopops-data-latest.zip') -Force;Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $latestDir 'manifest.json') -Force
$manifest|ConvertTo-Json -Depth 4
