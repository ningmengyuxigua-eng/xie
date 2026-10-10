# Key 與欄位契約

## 通用規則

- 平台識別碼一律以 `TEXT` 保存，避免數字長度和格式轉換問題。
- 所有業務 Key 必須包含 `store_id`，防止未來接入其他店鋪時衝突。
- 時間保存為 UTC，同時記錄來源時區 `Asia/Taipei`。
- 金額保存為整數分或固定精度 decimal，不使用二進位浮點數作為正式金額。
- 原始字串與標準化數值分開，解析失敗時保留原值並進入驗證問題表。
- 名稱、SKU、狀態及頁面排序都不是穩定 Key。

## 實體 Key

| 實體 | 業務 Key | 狀態 | 說明 |
|---|---|---|---|
| 店鋪 | `store_id` | 已確認 | `27857268786685` |
| 商品 | `store_id + product_id` | 已確認 | 現有 1,338 筆商品 ID 全部非空且唯一 |
| 商品規格 | `store_id + product_id + variation_id` | 已確認 | 3,638 個關係無重複或跨商品衝突；禁止使用規格名稱或 SKU 代替 |
| 廣告 | `store_id + ad_id` | 已確認，部分廣告類型例外 | 單品及群組廣告可由網址取得 ID；類型保存為屬性 |
| 自動選品廣告 | `store_id + auto_campaign_id` | 待確認 | 固定字串 `auto-selection` 不能作為正式 Key |
| 廣告商品關係 | `store_id + ad_id + product_id` | 已確認 | 群組廣告可包含多個商品 |
| 折扣／組合活動 | `store_id + promotion_type + promotion_id` | 已確認 | 詳情網址包含活動類型和 ID；折扣及組合商品關係均已通過小樣本驗證 |
| 優惠券 | `store_id + voucher_id` | 待確認 | 優惠碼僅作屬性，不能先假定為永久 Key |
| 訂單 | `store_id + order_internal_id` | 已確認 | 詳情網址含穩定內部 ID；另對 `store_id + order_number` 建唯一約束，保留店鋪可見訂單編碼 |
| 訂單品項 | `store_id + order_id + order_line_id` | 待確認 | 若平台沒有行 ID，需使用商品、規格及穩定序號組合 |
| 同步批次 | `run_id` | 設計確定 | 系統產生 UUID |

## 商品資料粒度

### `products`

每個商品一筆目前狀態：

- `store_id`
- `product_id`
- `current_version_id`
- `first_seen_at`
- `last_seen_at`
- `lifecycle_status`

### `product_versions`

只有商品可變內容實際改變時新增：

- `product_version_id`
- `store_id`
- `product_id`
- `name`
- `seller_sku`
- `status`
- `price_min`
- `price_max`
- `content_hash`
- `valid_from`
- `valid_to`
- `run_id`

名稱和 SKU 改變不會改變商品身份。

### `product_observations`

每次觀測一筆，不將滾動指標誤當成單日事件：

- `store_id`
- `product_id`
- `observed_at`
- `window_type`
- `window_days`
- `window_start`
- `window_end`
- `sales_value`
- `views_value`
- `sold_total`
- `run_id`

目前的「過去 30 天銷量／瀏覽量」應保存為 `window_type=rolling`、`window_days=30`。

## 廣告資料粒度

### `ad_campaigns` 與 `ad_versions`

身份與可變設定分開：

- `store_id`
- `ad_id`
- `ad_type`
- `name`
- `status`
- `daily_budget`
- `target_roas`
- `valid_from`
- `valid_to`
- `content_hash`
- `run_id`

`ad_type` 第一版允許：

- `single_product`：單品廣告，預期只有一個有效商品關聯。
- `product_group`：廣告群組，可包含多個商品。
- `auto_selection`：自動選品廣告；在真實活動 ID 確認前只能進暫存區。
- `unknown`：無法可靠判斷類型，不能進入正式日常分析。

狀態同時保存來源文字和標準化值：

- `source_status`：例如「進行中」「暫停中」「已結束」「已刪除」。
- `status_normalized`：`active`、`paused`、`ended`、`deleted`、`unknown`。

日常分析預設只查詢 `status_normalized=active`。非進行中廣告仍保留身份和歷史，避免重新啟用時失去前後比較資料。

### `ad_metric_observations`

唯一性至少包含：

```text
store_id + ad_id + product_id/null + period_start + period_end + observed_at
```

欄位包括：

- impressions／views
- clicks
- click_through_rate
- spend
- attributed_revenue
- conversions
- units_sold
- conversion_rate
- roas
- cost_per_conversion
- source_period_label
- run_id

每筆指標增加 `metric_level`：

- `campaign`：整個廣告的總計。
- `product`：廣告內單一商品的明細。

單品廣告可同時出現廣告總計和商品明細，但分析時必須選定其中一個層級，禁止把兩層相加。廣告群組的廣告總計用於整體判斷，商品明細用於群組內商品比較。

## 廣告類型驗證規則

1. `single_product` 必須有且只有一個有效的 `ad_product_link`。
2. `product_group` 必須至少有一個有效商品關聯；商品數量可以隨時間改變。
3. 商品加入或移出群組時，關閉舊關聯的 `valid_to`，不刪除歷史。
4. 廣告類型不明時不得根據廣告名稱猜測，資料進隔離區。
5. 日常詳情擷取只處理 `active`；每週狀態核對負責發現重新啟用或結束。

同一廣告不同統計期間不得覆蓋或直接相加。

## 促銷資料粒度

### `promotions` 與 `promotion_versions`

- `store_id`
- `promotion_type`
- `promotion_id`
- `name`
- `status`
- `start_at`
- `end_at`
- `rule_type`
- `threshold_amount`
- `discount_amount`
- `discount_rate`
- `content_hash`
- `valid_from`
- `valid_to`
- `run_id`

### `promotion_product_links`

```text
store_id + promotion_type + promotion_id + product_id + variation_id/null
```

保存商品角色，例如 `eligible`、`main_product`、`add_on_product`。

## 訂單與加購資料粒度

為了計算同購和加購率，最低需要：

- 匿名 `order_id`
- `ordered_at`
- `product_id`
- `variation_id`
- `quantity`
- 原售價
- 成交單價
- 商品折扣分攤
- 優惠券分攤
- 活動 ID（若可取得）
- 訂單狀態

不需要買家姓名、電話或地址。

## 版本更新規則

1. 新資料先進暫存表。
2. 驗證 Key 非空、批次內唯一且類型正確。
3. 對標準化後的可變內容計算 `content_hash`。
4. Hash 相同時只更新 `last_seen_at`。
5. Hash 不同時關閉上一版本的 `valid_to`，新增版本。
6. 指標資料按觀測時間和統計期間新增，不覆蓋歷史。
7. 單次同步未看到商品時不立即標記刪除；需要完整核對或連續缺失後才改變生命週期狀態。
8. 驗證失敗資料進隔離區，不能進正式事實表。

## 目前禁止的關聯方式

- 禁止使用商品名稱作為正式商品與廣告關聯。
- 禁止使用 SKU 作為商品唯一 Key。
- 禁止使用頁面行號或頁碼作為資料 Key。
- 禁止將固定字串 `auto-selection` 當作多個自動選品活動的共同 Key。
- 禁止將相鄰兩次 30 天滾動數值之差直接當成精確單日銷量。
