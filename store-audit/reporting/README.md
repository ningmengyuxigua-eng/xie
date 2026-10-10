# 報表中心模塊

本目錄保存報表契約、驗證器、模板及未來資料庫遷移。報表只消費正式表和彙總表，不負責抓取蝦皮頁面，也不直接執行店鋪操作。

## 入口與輸出

- 報表定義：`../config/report-registry.json`
- 預留資料表：`sql/001-reporting-schema.sql`
- 設定驗證：`node validate-report-registry.cjs`
- 正式輸出：`../reports/<report_key>/<period>/<run_id>/`

每次生成必須先建立`manifest.json`，保存報表Key、版本、期間、資料截止時間、狀態、規則版本、來源指紋和檔案雜湊。

商品分析報表必須同時遵守 `../config/product-analysis-report-contract.json`。生成器先判斷案例版、部分資料版或正式版；未通過正式版門檻時只輸出資料缺口，不生成正式 PPT／PDF 或可執行建議。

SQL檔目前只作審核用，不會由驗證器自動套用到現有資料庫。
