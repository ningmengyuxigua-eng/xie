# v1.3.0 升級與可攜包

- 應用程式版本：1.3.0
- SQLite Schema：7
- 升級前備份：`store-audit/backups/pre-update-2026-10-10T06-40-21-102Z-v1.2.0-to-v1.3.0`
- 可攜包：`store-audit/dist/shopops-portable-v1.3.0.zip`
- SHA-256：`3a309860bb6f93da3c534ca99d6cae26390f9d044c1cffea67fbb65efcc0975b`
- 包含檔案：3,250 個
- 包含內容：程式、Schema 7 遷移、SQLite、商品流量歷史、廣告歷史、checkpoint、報表與文件
- 驗證：解壓後 `verify-new-pc.ps1`、`shopops version`、`shopops validate` 全部通過
- 小批量驗證：紫鳥商品流量 20 筆只讀採集通過
- 排程：驗證後已恢復三個既有 heartbeat

中央版本庫尚未建立。建議使用 GitHub 私有儲存庫保存程式碼、規則、遷移及文件；SQLite 與原始資料採單一主機寫入及版本化快照，不進行雙向 Git 合併。
