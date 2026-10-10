param([string]$Summary='')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')); Set-Location $projectRoot
$lockPath=Join-Path $projectRoot 'store-audit\state\version-update-lock.json'
if(-not(Test-Path -LiteralPath $lockPath)){throw 'No version update lock. Run start-version-update.ps1 before editing.'}
$lock=Get-Content -LiteralPath $lockPath -Raw|ConvertFrom-Json
$current=(Get-Content -LiteralPath VERSION -Raw).Trim(); if($current-ne$lock.targetVersion){throw "VERSION $current does not match locked target $($lock.targetVersion)."}
$validation=& node store-audit\shopops.cjs validate|ConvertFrom-Json; if(-not$validation.ok){throw 'Validation failed.'}
$historyDir=Join-Path $projectRoot 'store-audit\version-history'; New-Item -ItemType Directory -Path $historyDir -Force|Out-Null
$record=[ordered]@{baseVersion=$lock.baseVersion;targetVersion=$lock.targetVersion;baseCommit=$lock.baseCommit;machineId=$lock.machineId;startedAt=$lock.startedAt;recordedAt=(Get-Date).ToString('o');summary=$Summary;validation=$validation}
$recordPath=Join-Path $historyDir ("v{0}.json" -f $current); $record|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $recordPath -Encoding utf8
$record|ConvertTo-Json -Depth 5
