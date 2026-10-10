param(
    [string]$StoreId = '27857268786685',
    [string]$TargetId = '581333E01764DE09A1754BE2B201A79D',
    [string]$OutputPath = 'D:\xiapi\store-audit\ad-daily\2026-10-09\acceleration-disable-bottom10.json'
)

$ErrorActionPreference = 'Continue'

$ads = @(
    [pscustomobject]@{ adId='405617553'; name='廚房用品9.26-10'; ctr30d=1.2465; alreadyDone=$true },
    [pscustomobject]@{ adId='405640602'; name='廚房用品9.26-17'; ctr30d=1.3776; alreadyDone=$false },
    [pscustomobject]@{ adId='405628783'; name='廚房用品9.26-13'; ctr30d=1.5030; alreadyDone=$false },
    [pscustomobject]@{ adId='405607779'; name='廚房用品9.26-2'; ctr30d=1.6920; alreadyDone=$false },
    [pscustomobject]@{ adId='405615164'; name='廚房用品9.26-6'; ctr30d=1.7559; alreadyDone=$false },
    [pscustomobject]@{ adId='405608738'; name='廚房用品9.26-4'; ctr30d=1.8282; alreadyDone=$false },
    [pscustomobject]@{ adId='405615698'; name='廚房用品9.26-7'; ctr30d=1.8734; alreadyDone=$false },
    [pscustomobject]@{ adId='405604330'; name='廚房用品9.26-1'; ctr30d=1.9058; alreadyDone=$false },
    [pscustomobject]@{ adId='405629275'; name='廚房用品9.26-14'; ctr30d=2.0359; alreadyDone=$false },
    [pscustomobject]@{ adId='395176437'; name='收納組'; ctr30d=2.1449; alreadyDone=$false }
)

$editSelector = "#manual-mp-page-detail [class*='boost'] i[class*='edit']"
$statusSelector = "#manual-mp-page-detail [class*='boost']"
$confirmSelector = "div:nth-of-type(6) > div > div > div > div:nth-of-type(3) > button:nth-of-type(2)"

function Invoke-JsonCli([string[]]$Arguments) {
    $raw = & ziniao-cli.cmd @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $raw.Trim() }
    return ($raw | ConvertFrom-Json)
}

function Invoke-Click([string]$Selector) {
    $raw = & ziniao-cli.cmd page click --store-id $StoreId --target-id $TargetId --selector $Selector --timeout 30000 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $raw.Trim() }
}

function Invoke-Visit([string]$Url) {
    $raw = & ziniao-cli.cmd page visit --store-id $StoreId --target-id $TargetId --url $Url --wait-until domcontentloaded --timeout 30000 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw $raw.Trim() }
}

function Get-Query([string]$Selector) {
    $r = Invoke-JsonCli @('page','query','--store-id',$StoreId,'--target-id',$TargetId,'--selector',$Selector,'--format','json','--timeout','30000')
    return $r.data.data
}

function Get-BoostState {
    $q = Get-Query $statusSelector
    $texts = @($q.items | Where-Object { $_.visible } | ForEach-Object { $_.text.Trim() })
    if ($texts -contains '開啟') { return '開啟' }
    if ($texts -contains '關閉') { return '關閉' }
    return '未知'
}

function Wait-UniqueVisible([string]$Selector, [int]$Attempts = 6) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        $q = Get-Query $Selector
        if ($q.count -eq 1 -and $q.items[0].visible) { return $q }
        Start-Sleep -Seconds 1
    }
    return $q
}

function Save-Checkpoint($results) {
    $payload = [ordered]@{
        storeName = '拾味廚房雜貨鋪'
        basis = '近30天CTR由低到高（2026-09-09至2026-10-08）'
        requestedCount = 10
        updatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
        results = @($results)
    }
    $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
}

$results = [System.Collections.Generic.List[object]]::new()

foreach ($ad in $ads) {
    $row = [ordered]@{
        adId = $ad.adId
        name = $ad.name
        ctr30dPercent = $ad.ctr30d
        before = $null
        after = $null
        result = 'pending'
        error = $null
        verifiedAt = $null
    }
    try {
        $url = "https://seller.shopee.tw/portal/marketing/pas/product/manual-mpd/$($ad.adId)?source_page_id=2"
        Invoke-Visit $url
        Start-Sleep -Seconds 2

        $before = Get-BoostState
        $row.before = if ($ad.alreadyDone -and $before -eq '關閉') { '開啟（已於本批次手動確認並關閉）' } else { $before }

        if ($before -eq '開啟') {
            $edit = Get-Query $editSelector
            if ($edit.count -ne 1 -or -not $edit.items[0].visible) { throw "加速編輯按鈕不唯一或不可見" }
            Invoke-Click $editSelector

            $openSwitch = Wait-UniqueVisible '.eds-switch--open'
            if ($openSwitch.count -ne 1 -or -not $openSwitch.items[0].visible) { throw "加速開關未處於開啟狀態" }
            Invoke-Click '.eds-switch--open'

            $closedSwitch = Wait-UniqueVisible '.eds-switch--close'
            if ($closedSwitch.count -ne 1 -or -not $closedSwitch.items[0].visible) { throw "開關切換後未顯示關閉" }

            $confirm = Wait-UniqueVisible $confirmSelector
            if ($confirm.count -ne 1 -or -not $confirm.items[0].visible -or $confirm.items[0].text -ne '確認') { throw "確認按鈕不唯一或不可見" }
            Invoke-Click $confirmSelector
            Start-Sleep -Seconds 2
        }

        $after = Get-BoostState
        $row.after = $after
        if ($after -ne '關閉') { throw "提交後加速狀態仍為 $after" }
        $row.result = if ($before -eq '關閉') { 'already_closed_or_verified' } else { 'disabled' }
        $row.verifiedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    }
    catch {
        $row.result = 'failed'
        $row.error = $_.Exception.Message
        $row.verifiedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    }
    $results.Add([pscustomobject]$row)
    Save-Checkpoint $results
    Write-Output ("{0} {1} -> {2}" -f $ad.adId, $row.result, $row.after)
}

$results





