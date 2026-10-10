# Shopee 店鋪營運決策系統：設計基準

## 系統目標

本系統以商品為中心，聯合分析商品表現、廣告投入與促銷配置，找出適合加購及組合銷售的商品，提升客單價、每單件數與單筆貢獻利潤。

系統遵循「觀測 → 診斷 → 建議 → 人工確認 → 執行 → 效果追蹤」流程。第一版只提供分析與建議，不自動修改 Shopee 店鋪。

## 第一版範圍

- 商品目前狀態、歷史版本及滾動期間指標。
- 商品與進行中廣告的可靠關聯。
- 進行中單品廣告及廣告群組的投入、點擊、轉換、銷售額及 ROAS。
- 折扣、組合促銷與優惠券資料。
- 主商品、加購商品與商品組合候選。
- 活動前後的客單價、每單件數及利潤變化。
- 包裹送達取件門市超過 4 天仍未變成已送達的訂單提醒，以及可人工確認的聊聊文案。
- 商品近 30 天瀏覽量、銷量與庫存觀測，以及長期零流量商品的人工下架候選。

暫不納入自動客服、訂單出貨、商品修圖及自動修改店鋪。

## 本階段交付物

- [01-data-sources.md](01-data-sources.md)：資料來源、取得方式與目前缺口。
- [02-key-field-contract.md](02-key-field-contract.md)：Key、資料粒度、版本及驗證規則。
- [03-performance-context-contract.md](03-performance-context-contract.md)：每日增量、效能和模型上下文限制。
- [04-key-validation-report.md](04-key-validation-report.md)：小樣本即時驗證結果與建庫阻塞項目。
- [field-mapping.json](field-mapping.json)：來源欄位到正式欄位的機器可讀映射。
- [validation-rules.md](validation-rules.md)：資料進入正式表前的驗證與隔離規則。
- [05-pickup-alert.md](05-pickup-alert.md)：送達取件門市超過 4 天的提醒規則。
- [06-open-order-incremental-sync.md](06-open-order-incremental-sync.md)：未結案訂單的分批同步與續跑契約。
- [10-product-lifecycle.md](10-product-lifecycle.md)：商品瀏覽量與安全下架候選規則。
- [11-history-backfill.md](11-history-backfill.md)：近三個月歷史資料的分段回填、續跑與去重策略。
- [12-shopee-tw-rules-layer.md](12-shopee-tw-rules-layer.md)：蝦皮台灣官方規則層與權重分析邊界。
- [13-ad-30day-backfill.md](13-ad-30day-backfill.md)：前三十天廣告分批回填與商品層選擇性下鑽方案。
- [17-future-modules-and-report-center.md](17-future-modules-and-report-center.md)：後續模塊、報表中心、輸出契約與防卡設計。
- [18-mvp-implementation-roadmap.md](18-mvp-implementation-roadmap.md)：原型確認後轉入正式MVP的階段、驗收及立即執行清單。
- [19-mvp-baseline-implementation.md](19-mvp-baseline-implementation.md)：MVP基線備份、資料庫遷移、正式報表及冪等驗證結果。
- [20-new-product-discovery.md](20-new-product-discovery.md)：每日新品發現、每週全量核對、商品詳情佇列及防漏規則。
- [21-project-package.md](21-project-package.md)：專案統一入口、精簡上下文及可攜式壓縮包。

## 當前狀態

- 設計基準版本：`1.0-mvp-baseline`
- 賣場：`拾味廚房雜貨鋪`
- 蝦皮帳號：`c8r501xjru`
- store ID：`27857268786685`
- 平台：Shopee 台灣本土
- 現有探索資料：241 個檔案，約 19.42 MB
- MVP資料庫：schema version 6，支援D-1廣告、商品增量發現、上架時間、生命週期事件、報表定義、報表執行及附件追溯。
- 商品基線：2026-10-06 的1,338個商品及近30天瀏覽／銷量已匯入；舊商品缺少可信上架時間時保留空值，不批量重查。
- 商品增量：已知商品跳過詳情與未變更寫入，只有新商品進入詳情佇列；每批最多20筆。
- 蝦皮台灣規則庫：已納入首批 9 條官方規則；每週核對來源與變更，未公開的搜尋排名權重不推測為官方數值。

早期探索腳本仍只作欄位證據；`db/migrations`、商品基線、`reporting`及標準報表輸出已進入MVP。每日新品列表採集與詳情佇列編排仍待啟用。

## 進入完整資料庫建設前的通過條件

1. [x] 商品規格的真實 `variation_id` 已確認。
2. [ ] 自動選品廣告的真實活動 ID 已確認，或已定義不衝突的替代 Key。
3. [ ] 訂單商品明細的商品 ID、規格 ID、折扣分攤及增量方式已確認。
4. [ ] 商品成本和物流成本來源已確認；平台費用目前只通過訂單層小樣本。
5. [ ] 商品、廣告及促銷指標的統計期間已逐來源確認。
6. [x] 所有不確定 Key 的資料只能進暫存或隔離區。

完整條件通過前，只能建立已驗證模組的最小原型；未通過的模組保持關閉。

## 廣告分析邊界

- 日常分析只處理來源狀態為「進行中」的廣告。
- 單品廣告與廣告群組分開建模，不能依名稱或商品數量臨時猜測類型。
- 暫停、已結束及已刪除廣告只保留身份、狀態變更和既有歷史，不進入預設決策清單。
- 每週執行一次輕量全狀態核對，用於發現廣告啟停和結束狀態；不每日讀取所有非進行中廣告的詳情。
