param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [string]$CloudRoot=''
)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($CloudRoot)){
  if([string]::IsNullOrWhiteSpace($env:OneDrive)){throw 'OneDrive path is not configured.'}
  $CloudRoot=Join-Path $env:OneDrive 'ShopOps-Backup'
}
$latest=Join-Path $CloudRoot 'latest'
$manifestPath=Join-Path $latest 'manifest.json'
$archivePath=Join-Path $latest 'shopops-data-latest.zip'
if(-not(Test-Path -LiteralPath $manifestPath)){throw "Missing cloud manifest: $manifestPath"}
if(-not(Test-Path -LiteralPath $archivePath)){throw "Missing cloud archive: $archivePath"}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
$actualHash=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if($actualHash-ne$manifest.sha256){throw 'Cloud archive checksum mismatch. Restore stopped.'}
$destinationPath=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $destinationPath){
  if((Get-ChildItem -LiteralPath $destinationPath -Force|Select-Object -First 1)){throw 'Destination is not empty. Use a new folder to avoid overwriting local data.'}
}else{New-Item -ItemType Directory -Path $destinationPath -Force|Out-Null}
Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath
$verify=Join-Path $destinationPath 'verify-new-pc.ps1'
if(-not(Test-Path -LiteralPath $verify)){throw 'Restored package does not contain verify-new-pc.ps1.'}
$result=& $verify|ConvertFrom-Json
if(-not$result.ok){throw 'Restored package validation failed.'}
[ordered]@{restored=$true;destination=$destinationPath;version=$manifest.applicationVersion;schemaVersion=$manifest.databaseSchemaVersion;sha256=$actualHash;validation=$result}|ConvertTo-Json -Depth 6
