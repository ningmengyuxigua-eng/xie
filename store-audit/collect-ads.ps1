$auditCli='C:\Users\Administrator\AppData\Roaming\npm\node_modules\@ziniao-open\cli\bin\ziniao-cli.exe'
$captureScript=Get-Content -LiteralPath 'D:\xiapi\store-audit\capture-table.js' -Raw
$lastFirst=''
for ($auditPage=15; $auditPage -le 100; $auditPage++) {
 $rawResult=& $auditCli page exec --store-id 27857268786685 --script $captureScript
 $parsedResult=($rawResult -join "`n") | ConvertFrom-Json
 if (!$parsedResult.ok -or $parsedResult.data.data.exceptionDetails) { throw 'Page read failed' }
 $pageData=$parsedResult.data.data.result | ConvertFrom-Json
 $bodyTables=@($pageData.tables | Where-Object cls -eq 'eds-table__body')
 if (!$bodyTables.Count -or !$bodyTables[0].rows.Count) { throw 'Empty ads table' }
 if ($auditPage -ne [int]$pageData.page) { throw ('Unexpected page '+$pageData.page) }
 if ($lastFirst -eq $bodyTables[0].rows[0].links[0].href) { throw 'Repeated page data' }
 $lastFirst=$bodyTables[0].rows[0].links[0].href
 $parsedResult.data.data.result | Set-Content -LiteralPath ('D:\xiapi\store-audit\2026-10-06\ads-full-'+$auditPage+'.json') -Encoding UTF8
 Write-Output ('Captured ads page '+$pageData.page+'/'+$pageData.total+' rows '+$bodyTables[0].rows.Count)
 if ($pageData.nextDisabled -or [int]$pageData.page -ge [int]$pageData.total) { break }
 & $auditCli page click --store-id 27857268786685 --selector '.eds-pager__button-next' | Out-Null
 Start-Sleep -Milliseconds 900
}
