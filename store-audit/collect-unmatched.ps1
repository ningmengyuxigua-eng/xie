$auditCli='C:\Users\Administrator\AppData\Roaming\npm\node_modules\@ziniao-open\cli\bin\ziniao-cli.exe'
$ads=Get-Content -LiteralPath 'D:\xiapi\store-audit\2026-10-06\unmatched-ads.json' -Raw | ConvertFrom-Json
$results=@()
foreach($ad in $ads) {
 & $auditCli page visit --store-id 27857268786685 --url $ad.url --wait-until networkidle --timeout 60000 2>&1 | Out-Null
 Start-Sleep -Milliseconds 800
 $raw=& $auditCli page exec --store-id 27857268786685 --script "JSON.stringify({url:location.href,products:Array.from(document.querySelectorAll('a.product-url')).map(e=>e.href),text:document.body.innerText.slice(0,2000)})"
 $parsed=($raw -join "`n") | ConvertFrom-Json
 $d=$parsed.data.data.result | ConvertFrom-Json
 $results+=@{adUrl=$ad.url;detail=$d}
 $results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath 'D:\xiapi\store-audit\2026-10-06\unmatched-resolved.json' -Encoding UTF8
 Write-Output ('Resolved '+$results.Count+'/'+$ads.Count)
}
