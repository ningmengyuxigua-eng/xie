param(
  [string]$MetricDate = '2026-10-06',
  [string]$StoreId = '27857268786685'
)

$ErrorActionPreference = 'Stop'
$date = [DateTimeOffset]::Parse("${MetricDate}T00:00:00+08:00")
$from = $date.ToUnixTimeSeconds()
$to = $date.AddDays(1).AddSeconds(-1).ToUnixTimeSeconds()
$url = "https://seller.shopee.tw/portal/marketing/pas/index?from=$from&to=$to&type=new_cpc_homepage&group=custom"
$amp = 'String.fromCharCode(38)'
$script = "location.assign('https://seller.shopee.tw/portal/marketing/pas/index?from=$from'+$amp+'to=$to'+$amp+'type=new_cpc_homepage'+$amp+'group=custom')"
$null = & ziniao-cli.cmd page exec --store-id $StoreId --script $script --timeout 30000
Start-Sleep -Milliseconds 2500
Write-Output (([ordered]@{ metricDate = $MetricDate; from = $from; to = $to; url = $url }) | ConvertTo-Json -Compress)
