param([Parameter(Mandatory=$true)][string]$TargetVersion)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location $projectRoot
if ($TargetVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'TargetVersion must use major.minor.patch.' }
if ((git status --porcelain).Count -ne 0) { throw 'Working tree is not clean. Commit or discard changes before starting an update.' }
$oldHttp=$env:HTTP_PROXY; $oldHttps=$env:HTTPS_PROXY; $oldAll=$env:ALL_PROXY
try { $env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:ALL_PROXY=''; git fetch origin main --quiet } finally { $env:HTTP_PROXY=$oldHttp; $env:HTTPS_PROXY=$oldHttps; $env:ALL_PROXY=$oldAll }
$localCommit=(git rev-parse HEAD).Trim(); $remoteCommit=(git rev-parse origin/main).Trim()
if ($localCommit -ne $remoteCommit) { throw "Local HEAD is not the latest origin/main. local=$localCommit remote=$remoteCommit" }
$localVersion=(Get-Content -LiteralPath VERSION -Raw).Trim(); $remoteVersion=(git show origin/main:VERSION).Trim()
if ($localVersion -ne $remoteVersion) { throw "Local version $localVersion does not match remote version $remoteVersion." }
$a=$localVersion.Split('.')|ForEach-Object{[int]$_}; $b=$TargetVersion.Split('.')|ForEach-Object{[int]$_}
$valid=(($b[0]-eq $a[0]) -and ($b[1]-eq $a[1]) -and ($b[2]-eq $a[2]+1)) -or (($b[0]-eq $a[0]) -and ($b[1]-eq $a[1]+1) -and ($b[2]-eq 0)) -or (($b[0]-eq $a[0]+1) -and ($b[1]-eq 0) -and ($b[2]-eq 0))
if (-not $valid) { throw "Target $TargetVersion is not an immediate semantic successor of $localVersion." }
$profilePath=Join-Path $projectRoot 'store-audit\config\machine-profile.json'
$machineId=if(Test-Path -LiteralPath $profilePath){(Get-Content -LiteralPath $profilePath -Raw|ConvertFrom-Json).machineId}else{$env:COMPUTERNAME}
$lock=[ordered]@{baseVersion=$localVersion;targetVersion=$TargetVersion;baseCommit=$remoteCommit;machineId=$machineId;startedAt=(Get-Date).ToString('o');remote='origin';branch='main'}
$lockPath=Join-Path $projectRoot 'store-audit\state\version-update-lock.json'; New-Item -ItemType Directory -Path (Split-Path $lockPath -Parent) -Force|Out-Null
$lock|ConvertTo-Json|Set-Content -LiteralPath $lockPath -Encoding utf8
$lock|ConvertTo-Json
