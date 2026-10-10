# 未結案訂單增量同步

## 範圍

第一版只讀取訂單頁「運送中」分頁中狀態仍為「已出貨」的訂單。已送達及其他狀態在列表階段直接排除，不進詳情讀取，也不佔每批 20 筆額度。每次先取得最多 20 筆已出貨訂單身份，再逐筆讀取最新物流事件；不保存完整頁面、商品內容、買家姓名、電話、地址、物流單號或取件門市名稱。

## 保存欄位

- `store_id`
- `order_internal_id`
- `order_number`
- `source_status`
- `latest_event_code`
- `latest_event_at`
- `observed_at`

原始物流文字在頁面內完成標準化，寫入本機前只保留事件代碼和時間。

## 中斷續跑

- 批次訂單身份保存在 checkpoint。
- 每成功處理一筆便追加一行 JSONL，然後原子更新 `nextIndex`。
- 中斷後復用同一批清單，從 `nextIndex` 繼續。
- 同一錯誤累計三次便停止當次執行並保存進度。
- 切換訂單分頁後不使用固定短延遲；必須確認目前分頁為「運送中」，並連續兩次取得相同且大於零的訂單連結數，確認表格停止重繪後才執行批次提取。

## 執行限制

- 單批硬上限 20 筆。
- 每次執行可用 `-MaxOrders` 進一步限制本次處理數量。
- 工具只輸出批次計數、checkpoint 和檔案路徑。
- 完成一批後，下一階段才處理下一頁。
- 先前追蹤的訂單若已不在「已出貨」集合，停止將其列入未取件提醒候選。

## Windows 執行方式

在目前的 PowerShell 7 工作階段直接執行：

```powershell
& 'D:\xiapi\store-audit\collect-open-orders.ps1' -SourcePage 1 -MaxOrders 20
```

不要使用 `powershell.exe -File` 再包一層 Windows PowerShell。巢狀 Windows PowerShell 會重新轉義傳給 `ziniao-cli.cmd page exec --script` 的 JavaScript 參數，可能使 ZClaw 回報 `CDP_ERROR`。同步器會在每次初始化時重新取得 target，並等待運送中列表穩定後才執行較長的提取腳本。

完成一頁後，下一次以 `-SourcePage 2` 前往下一頁。同步器會驗證第一筆訂單 ID 已變更且列表連續兩次穩定，避免把上一頁重複寫入新批次。

## 提醒計算

只有 `latest_event_code = pickup_ready` 且 `latest_event_at + 4 days` 已到期、訂單仍未變成 `delivered` 時，才交給 `pickup-alerts.cjs` 產生提醒。

完成一個 JSONL 批次後執行：

```powershell
node D:\xiapi\store-audit\evaluate-pickup-alerts-from-jsonl.cjs <batch-jsonl-path> --limit 20
```

評估結果寫在同一批次目錄的 `pickup-alert-evaluation.json`。確定提醒已顯示給使用者後，再加上 `--mark-notified` 寫入 `state/pickup-alert-state.json`，防止同一到店事件重複提示。
