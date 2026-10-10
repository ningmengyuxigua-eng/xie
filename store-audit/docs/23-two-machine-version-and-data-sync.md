# 兩台電腦的版本合併與資料同步

## 建議架構

目前採用單寫入者模式。指定一台電腦為主機，另一台為副機：

| 項目 | 主機 | 副機 |
|---|---|---|
| 店鋪即時採集 | 開啟 | 關閉 |
| SQLite寫入 | 允許 | 只讀快照 |
| 定時任務 | 開啟 | 關閉 |
| 聊聊發送 | 唯一允許 | 禁止 |
| 分析與報表 | 允許 | 允許 |
| 程式開發 | 允許 | 允許 |

這可以避免同一訂單重複提醒、兩台電腦同時修改廣告，以及SQLite互相覆蓋。

## 程式版本如何合併

程式碼、規格及報表模板使用私有Git倉庫。兩台電腦各自在自己的branch修改，完成後合併到`main`；只有`main`可以更新`VERSION`、`CHANGELOG.md`並產生正式ZIP。

專案已使用私有 GitHub 倉庫。開始修改前必須執行 `scripts/start-version-update.ps1`；它會抓取 `origin/main`，確認本機 Commit 與版本等於遠端最新版，並確認目標版本是上一版的直接語意版本後繼。不符合時禁止開始更新。

修改完成後執行 `scripts/record-version-update.ps1` 產生可提交的版本日誌。日誌記錄基線版本、目標版本、基線 Commit、機器 ID、開始與完成時間及驗證結果。發布使用 `scripts/publish-version.ps1`；若另一台電腦已先更新遠端基線，發布會被阻止，必須先同步及重新建立更新鎖。

如果暫時不使用Git，則只能指定一台電腦修改程式；另一台只能安裝其產生的正式版本包。兩邊同時修改後直接覆蓋ZIP無法可靠合併。

## 店鋪資料如何同步

SQLite以主機為唯一正式資料。同步到副機前先暫停主機採集並完成資料庫檢查，再產生關閉狀態的快照；副機只用快照分析。副機產生的PPT、分析文件或程式修改可以回傳主機，副機SQLite、取件提醒狀態及排程狀態不得覆蓋主機。

正式資料快照使用 `scripts/backup-to-onedrive.ps1`，保存到 OneDrive `ShopOps-Backup/daily/<日期>`，並更新 `latest`。每份快照包含 manifest 與 SHA256；另一台電腦只下載完整快照到本機再開啟。

Codex 定時任務屬於執行電腦與本地聊天環境，不納入 Git 或資料快照。換主機時先將舊機所有任務設為暫停，再在新主機依版本庫中的排程規格重建並啟用。主機角色檔 `machine-profile.json` 必須為 `primary/read_write` 才能啟用採集；副機保持 `secondary/read_only` 且不啟用相同任務。

不得把正在使用的SQLite放進OneDrive、Dropbox、Google Drive或NAS同步資料夾讓兩台同時開啟。檔案同步工具無法合併SQLite交易，可能產生鎖定、回退或損壞。

## 每台電腦的本機設定

將`config/machine-profile.example.json`複製為`config/machine-profile.json`：

- 主機設定`role=primary`、`databaseMode=read_write`。
- 副機設定`role=secondary`、`databaseMode=read_only`。

`machine-profile.json`是本機檔案，不可互相覆蓋，也不進Git。

## 換主機流程

1. 舊主機暫停所有採集、排程及傳訊。
2. 執行`shopops validate`並建立最新搬機包或資料快照。
3. 新主機還原並核對版本、資料庫、storeId及賣場名稱。
4. 新主機執行一次小批量只讀採集。
5. 將新主機改為primary並啟用排程。
6. 舊主機改為secondary後，才可繼續用於分析。

## 未來需要兩台同時採集時

屆時須改成中央資料庫或增量同步服務。每筆資料必須包含`source_machine_id`、`observed_at`及穩定業務KEY，匯入採冪等upsert；同一欄位衝突時按來源時間與資料可信度處理。即使採集器有兩台，聊聊發送仍只能指定一台執行。
