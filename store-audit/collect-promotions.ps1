$auditCli='C:\Users\Administrator\AppData\Roaming\npm\node_modules\@ziniao-open\cli\bin\ziniao-cli.exe'
$captureScript=Get-Content -LiteralPath 'D:\xiapi\store-audit\capture-table.js' -Raw
$targets=@(@{page=1;row=1;name='quality'},@{page=1;row=2;name='combo'},@{page=1;row=4;name='full-reduction'},@{page=1;row=6;name='discount42'},@{page=2;row=2;name='discount40b'},@{page=2;row=3;name='discount40'})
foreach($t in $targets){
 & $auditCli page visit --store-id 27857268786685 --url 'https://seller.shopee.tw/portal/marketing/list/discount' --wait-until networkidle 2>&1 | Out-Null
 Start-Sleep -Milliseconds 700
 if($t.page -eq 2){& $auditCli page click --store-id 27857268786685 --selector '.eds-react-pagination-pager__button-next' 2>&1 | Out-Null; Start-Sleep -Milliseconds 700}
 $sel='tbody tr:nth-child('+$t.row+') td:last-child button:first-of-type'
 $qr=& $auditCli page query --store-id 27857268786685 --selector $sel
 $q=($qr -join "`n") | ConvertFrom-Json
 if($q.data.data.count -ne 1 -or $q.data.data.items[0].text -ne '編輯活動'){throw 'Unexpected promotion control'}
 & $auditCli page click --store-id 27857268786685 --selector $sel --wait-nav 2>&1 | Out-Null
 Start-Sleep -Milliseconds 1200
 $raw=& $auditCli page exec --store-id 27857268786685 --script $captureScript
 $parsed=($raw -join "`n") | ConvertFrom-Json
 $parsed.data.data.result | Set-Content -LiteralPath ('D:\xiapi\store-audit\2026-10-06\promotion-detail-'+$t.name+'.json') -Encoding UTF8
 $d=$parsed.data.data.result | ConvertFrom-Json
 Write-Output $t.name
 Write-Output $d.text.Substring(0,[Math]::Min(2200,$d.text.Length))
}
