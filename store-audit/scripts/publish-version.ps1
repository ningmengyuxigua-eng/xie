param([string]$Remote='origin',[string]$Branch='main')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')); Set-Location $projectRoot
if((git status --porcelain).Count-ne 0){throw 'Working tree must be clean before publishing.'}
$version=(Get-Content -LiteralPath VERSION -Raw).Trim(); $recordPath=Join-Path $projectRoot "store-audit\version-history\v$version.json"
if(-not(Test-Path -LiteralPath $recordPath)){throw "Missing version history record for v$version."}; $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
function Invoke-GitChecked([string[]]$Arguments){
  $output=& git @Arguments
  if($LASTEXITCODE-ne 0){throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."}
  return $output
}
$oldHttp=$env:HTTP_PROXY; $oldHttps=$env:HTTPS_PROXY; $oldAll=$env:ALL_PROXY
try{
  $env:HTTP_PROXY='';$env:HTTPS_PROXY='';$env:ALL_PROXY=''
  Invoke-GitChecked @('fetch',$Remote,$Branch,'--quiet')|Out-Null
  $remoteCommit=(Invoke-GitChecked @('rev-parse',"$Remote/$Branch")).Trim()
  $remoteVersion=(Invoke-GitChecked @('show',"$Remote/$Branch`:VERSION")).Trim()
  $localCommit=(Invoke-GitChecked @('rev-parse','HEAD')).Trim()
  if($remoteCommit-ne$localCommit){
    if($record.baseCommit-ne$remoteCommit-or$record.baseVersion-ne$remoteVersion){throw "Remote baseline changed. Expected $($record.baseVersion)/$($record.baseCommit), found $remoteVersion/$remoteCommit."}
    Invoke-GitChecked @('push',$Remote,"HEAD:$Branch")|Out-Null
  }elseif($remoteVersion-ne$version){throw "Remote commit matches local, but VERSION differs: remote=$remoteVersion local=$version"}
  $tagName="v$version"
  $remoteTagLines=@(Invoke-GitChecked @('ls-remote','--tags',$Remote,"refs/tags/$tagName","refs/tags/$tagName^{}"))
  $remoteTagCommit=$null
  foreach($line in $remoteTagLines){
    if($line -match '^([0-9a-f]{40})\s+refs/tags/.+\^\{\}$'){$remoteTagCommit=$Matches[1];break}
    if($line -match '^([0-9a-f]{40})\s+refs/tags/'){$remoteTagCommit=$Matches[1]}
  }
  if($remoteTagCommit -and $remoteTagCommit-ne$localCommit){throw "Remote tag $tagName already points to $remoteTagCommit, not $localCommit."}
  $localTag=(Invoke-GitChecked @('tag','--list',$tagName))
  if($localTag){
    $localTagCommit=(Invoke-GitChecked @('rev-parse',"$tagName^{}" )).Trim()
    if($localTagCommit-ne$localCommit){
      if($remoteTagCommit){throw "Published tag $tagName cannot be moved."}
      Invoke-GitChecked @('tag','-d',$tagName)|Out-Null
      $localTag=$null
    }
  }
  if(-not$localTag){Invoke-GitChecked @('tag','-a',$tagName,'-m',"ShopOps v$version")|Out-Null}
  Invoke-GitChecked @('push',$Remote,$tagName)|Out-Null
  [ordered]@{published=$true;version=$version;commit=$localCommit;remote=$Remote;branch=$Branch}|ConvertTo-Json
}finally{$env:HTTP_PROXY=$oldHttp;$env:HTTPS_PROXY=$oldHttps;$env:ALL_PROXY=$oldAll}
