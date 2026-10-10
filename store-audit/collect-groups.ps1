$auditCli='C:\Users\Administrator\AppData\Roaming\npm\node_modules\@ziniao-open\cli\bin\ziniao-cli.exe'
$captureScript=Get-Content -LiteralPath 'D:\xiapi\store-audit\capture-table.js' -Raw
$ads=Get-Content -LiteralPath 'D:\xiapi\store-audit\2026-10-06\advertisements.json' -Raw | ConvertFrom-Json
$groups=@($ads | Where-Object {$_.url -like '*manual-mpd*'})
$groupIndex=0
foreach($groupAd in $groups) {
 $groupIndex++
 $groupId=[regex]::Match($groupAd.url,'manual-mpd/(\d+)').Groups[1].Value
 & $auditCli page visit --store-id 27857268786685 --url $groupAd.url --wait-until networkidle --timeout 60000 2>&1 | Out-Null
 Start-Sleep -Milliseconds 800
 for($gp=1;$gp -le 20;$gp++) {
  $raw=& $auditCli page exec --store-id 27857268786685 --script $captureScript
  $parsed=($raw -join "`n") | ConvertFrom-Json
  if(!$parsed.ok -or $parsed.data.data.exceptionDetails) { throw 'Read failed' }
  $d=$parsed.data.data.result | ConvertFrom-Json
  if($d.url -notlike ('*manual-mpd/'+$groupId+'*') -or $d.text -notmatch '商品表現') { throw ('Incomplete group '+$groupId) }
  $parsed.data.data.result | Set-Content -LiteralPath ('D:\xiapi\store-audit\2026-10-06\group-'+$groupId+'-'+$gp+'.json') -Encoding UTF8
  if(!$d.total -or $d.nextDisabled -or [int]$d.page -ge [int]$d.total) {break}
  & $auditCli page click --store-id 27857268786685 --selector '.eds-pager__button-next' 2>&1 | Out-Null
  Start-Sleep -Milliseconds 600
 }
 Write-Output ('Group '+$groupIndex+'/'+$groups.Count+' '+$groupId+' '+$gp+' pages')
}
