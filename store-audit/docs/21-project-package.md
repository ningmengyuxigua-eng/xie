# 專案級封裝與精簡上下文

## 使用入口

從`D:\xiapi`或其他目錄執行：

```powershell
D:\xiapi\shopops.cmd status
D:\xiapi\shopops.cmd context
D:\xiapi\shopops.cmd validate
```

入口會自動定位`store-audit`，不依賴目前工作目錄。

## 上下文壓縮

`shopops context`只從SQLite與設定檔產生精簡狀態，不讀取完整商品、廣告、訂單或HTML原始資料。輸出：

- `state/project-context.json`：供程序及模型讀取。
- `state/project-context.md`：供人工快速查看。

原始資料仍保存在本機，只在需要核對某個商品、日期或活動時按最多20筆載入。

## 可攜式壓縮包

執行`package-system.ps1`會生成`dist/shopops-portable-v1.2.0.zip`。搬機包包含統一入口、SQLite、歷史廣告資料、分析、PPT／報表、設定、進度、取件提醒狀態及執行腳本，並附帶manifest、SHA-256、搬機說明及新電腦驗證腳本。

不包含重複備份、完整瀏覽器HTML／頁面擷取、舊分發包、`node_modules`、紫鳥登入憑證、Cookies、API Key、Codex skills或桌面定時任務。這些電腦環境項目需在新電腦重新安裝或登入。

## 尚未啟用

- 每日新品採集器。
- 定時任務與通知。
- 自動修改商品、廣告、促銷或下架狀態。
