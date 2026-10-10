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
