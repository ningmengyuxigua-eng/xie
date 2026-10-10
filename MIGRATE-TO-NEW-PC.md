# 搬移到新電腦

## 解壓縮

將`shopops-portable-v1.3.0.zip`完整解壓縮到本機資料夾，例如`D:\xiapi`。系統使用相對路徑，也可放在其他磁碟；請勿直接在ZIP內執行。

## 安裝環境

- Windows 10或Windows 11。
- PowerShell 5.1以上。
- Node.js 24.x建議版本；最低需22.5。
- 安裝紫鳥／ZClaw、`ziniao-cli`和本專案使用的ziniao skills。

紫鳥登入狀態、Cookies、API Key、Codex skills及定時任務屬於電腦環境，不會放入壓縮包。請在新電腦另行登入或按CLI指引恢復設定，不要把憑證寫入專案。

## 驗證

在解壓縮後的專案目錄執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\verify-new-pc.ps1
.\shopops.cmd version
.\shopops.cmd validate
```

SQLite完整性應為`ok`，外鍵錯誤為`0`；storeId應為`27857268786685`，實際賣場名稱應為「拾味廚房雜貨鋪」。

## 恢復即時採集

確認紫鳥中的預設店鋪仍為`xie1`、storeId為`27857268786685`。先執行一次只讀取店鋪名稱的連線測試，再逐項恢復商品、廣告及訂單採集。

原電腦上的Codex定時任務不會隨ZIP搬移。新電腦驗證手動採集正常後，再重新建立每日廣告分析及商品流量任務。聊聊自動傳訊目前維持關閉。

若舊電腦仍繼續使用，請依`store-audit/docs/23-two-machine-version-and-data-sync.md`設定一台primary及一台secondary。只有primary可以採集、寫入SQLite、執行排程及發送聊聊。

## 包含與排除

可攜包包含SQLite、歷史廣告資料、分析結果、PPT／報表、規格、進度、取件提醒狀態及執行腳本。為控制體積，不包含重複備份、完整瀏覽器頁面、舊分發包或任何登入憑證。
