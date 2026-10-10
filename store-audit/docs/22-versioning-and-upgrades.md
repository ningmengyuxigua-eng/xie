# 版本更新與迭代

## 三種版本

1. `VERSION`及`package.json`記錄應用程式版本。
2. SQLite的`schema_version`記錄資料庫結構版本。
3. `package-manifest.json`記錄每一份可攜包的內容、建立時間及相容需求。

應用程式版本使用語意化版本：新模組升次版本、錯誤修正升修訂版本、不相容改版升主版本。資料庫結構只透過`store-audit/db/migrations`追加遷移，不覆寫既有歷史資料。

## 每次發布

1. 修改功能並完成對應驗證。
2. 更新`VERSION`、`package.json`、`config/version-policy.json`及根目錄`CHANGELOG.md`。
3. 資料庫結構有變更時，新增下一號migration並測試舊資料庫升級。
4. 執行`shopops.cmd validate`。
5. 執行`package-system.ps1 -Version <版本>`產生帶版本號的ZIP與SHA-256。
6. 保留上一版安裝包，出現問題時可還原程式；資料庫須使用升級前備份還原。

## 新電腦後續更新

更新時先關閉採集工作，備份`store-audit/db`、`state`及`config`。解壓新版程式後執行migration及validate，再恢復排程。程式更新不得清空SQLite、歷史廣告、商品生命週期或取件提醒狀態。

每次更新前先執行：

```powershell
.\shopops.cmd pre-update --target 1.3.0
```

此步只顯示技術檢查與人工確認清單，不會更新程式。完成紫鳥即時店鋪核對並暫停採集排程後，執行：

```powershell
.\shopops.cmd pre-update --target 1.3.0 --prepare --confirm-scheduler-paused --confirm-live-store
```

`readyToUpdate`必須為`true`才可進入更新。`--prepare`會建立SQLite、`config`及`state`的升級前備份；任何技術檢查失敗時禁止覆蓋程式。

紫鳥CLI、登入狀態、Codex skills及桌面定時任務屬於電腦環境，不隨應用程式版本包更新。
