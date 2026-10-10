# 拾味廚房雜貨鋪營運決策系統

專案統一入口：

```powershell
.\shopops.cmd status
.\shopops.cmd context
.\shopops.cmd validate
```

也可使用：

```powershell
npm run status
npm run context
npm run validate
```

商品增量匯入只新增未知`product_id`，已知商品不重讀詳情、不重寫未變更資料：

```powershell
.\shopops.cmd product-import --input <商品清單.json> --date <YYYY-MM-DD>
```

生命週期狀態變更：

```powershell
.\shopops.cmd product-status --product-id <ID> --status delisted --reason manual_review
```

精簡專案狀態位於`store-audit/state/project-context.json`，後續分析應優先讀取此檔案及資料庫彙總，避免載入整份原始資料。商品採集器目前保留但未啟用。

版本更新必須從 GitHub 最新 `main` 開始：

```powershell
.\store-audit\scripts\start-version-update.ps1 -TargetVersion 1.4.1
# 完成修改及驗證後
.\store-audit\scripts\record-version-update.ps1 -Summary "修改摘要"
```

資料快照備份到 OneDrive：

```powershell
.\store-audit\scripts\backup-to-onedrive.ps1
```

另一台電腦還原到新的空目錄：

```powershell
.\store-audit\scripts\restore-from-onedrive.ps1 -Destination D:\xiapi-restored
```
