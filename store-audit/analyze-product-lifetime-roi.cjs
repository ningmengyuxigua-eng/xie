const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const productId = String(process.argv[2] || '').trim();
if (!/^\d+$/.test(productId)) throw new Error('Usage: node analyze-product-lifetime-roi.cjs PRODUCT_ID');

const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const product = db.prepare(`
  SELECT store_id storeId, product_id productId, product_name productName,
         seller_sku sellerSku, current_status currentStatus,
         first_seen_at firstSeenAt, last_seen_at lastSeenAt,
         listed_at listedAt, listed_at_source listedAtSource,
         lifecycle_status lifecycleStatus
  FROM product_master WHERE store_id=? AND product_id=?
`).get(storeId, productId);
if (!product) throw new Error(`Product not found: ${productId}`);

const versions = db.prepare(`
  SELECT valid_from validFrom, valid_to validTo, source_status sourceStatus,
         price_min priceMin, price_max priceMax
  FROM product_versions WHERE store_id=? AND product_id=? ORDER BY valid_from
`).all(storeId, productId);
const observations = db.prepare(`
  SELECT observation_date observationDate, window_type windowType, window_days windowDays,
         views_value views, sales_value sales, sold_total soldTotal, stock
  FROM product_observations WHERE store_id=? AND product_id=? ORDER BY observation_date
`).all(storeId, productId);
const directAds = db.prepare(`
  SELECT ad_id adId, ad_name adName, ad_type adType, current_status currentStatus,
         daily_budget dailyBudget, target_roas targetRoas, first_seen_at firstSeenAt
  FROM ad_master WHERE store_id=? AND product_id=? ORDER BY first_seen_at
`).all(storeId, productId);
const dailyProduct = db.prepare(`
  SELECT metric_date metricDate, ad_id adId, impressions, clicks, spend,
         conversions, sales_count salesCount, revenue
  FROM ad_product_daily_fact
  WHERE store_id=? AND product_id=? ORDER BY metric_date, ad_id
`).all(storeId, productId);
db.close();

let rangeRecord = null;
const activeDir = path.join(root, 'analysis', 'active-ads');
if (fs.existsSync(activeDir)) {
  const dated = fs.readdirSync(activeDir).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().reverse();
  for (const date of dated) {
    const file = path.join(activeDir, date, 'active-group-product-decisions.json');
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const group of data.groups || []) {
      const hit = (group.products || []).find(x => String(x.productId) === productId);
      if (hit) {
        rangeRecord = { range:data.range, adId:group.adId, adName:group.adName, ...hit };
        break;
      }
    }
    if (rangeRecord) break;
  }
}

let groupAd = null;
if (rangeRecord?.adId) {
  const metaDb = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'), { readOnly:true });
  const master = metaDb.prepare(`
    SELECT ad_id adId, ad_name adName, ad_type adType, current_status currentStatus,
           first_seen_at firstSeenAt, last_seen_at lastSeenAt
    FROM ad_master WHERE store_id=? AND ad_id=?
  `).get(storeId, rangeRecord.adId);
  const exported = metaDb.prepare(`
    SELECT MIN(NULLIF(start_date,'')) startDate, MIN(metric_date) firstMetricDate,
           MAX(metric_date) lastMetricDate
    FROM ad_export_daily_staging WHERE store_id=? AND matched_ad_id=?
  `).get(storeId, rangeRecord.adId);
  groupAd = { ...master, ...exported };
  metaDb.close();
}

const money = x => Number(Number(x || 0).toFixed(2));
const rangeEnd = rangeRecord?.range?.match(/_to_(\d{4}-\d{2}-\d{2})$/)?.[1] || null;
const incremental = dailyProduct.filter(x => !rangeEnd || x.metricDate > rangeEnd);
const total = {
  impressions: Number(rangeRecord?.impressions || 0) + incremental.reduce((s,x)=>s+Number(x.impressions||0),0),
  clicks: Number(rangeRecord?.clicks || 0) + incremental.reduce((s,x)=>s+Number(x.clicks||0),0),
  spend: money(Number(rangeRecord?.spend || 0) + incremental.reduce((s,x)=>s+Number(x.spend||0),0)),
  conversions: Number(rangeRecord?.conversions || 0) + incremental.reduce((s,x)=>s+Number(x.conversions||0),0),
  salesCount: Number(rangeRecord?.salesCount || 0) + incremental.reduce((s,x)=>s+Number(x.salesCount||0),0),
  revenue: money(Number(rangeRecord?.revenue || 0) + incremental.reduce((s,x)=>s+Number(x.revenue||0),0)),
};
total.ctrPct = total.impressions ? Number((total.clicks / total.impressions * 100).toFixed(2)) : 0;
total.cpc = total.clicks ? money(total.spend / total.clicks) : null;
total.roas = total.spend ? Number((total.revenue / total.spend).toFixed(2)) : null;
total.acosPct = total.revenue ? Number((total.spend / total.revenue * 100).toFixed(2)) : null;
total.adOnlyReturnPct = total.spend ? Number(((total.revenue - total.spend) / total.spend * 100).toFixed(2)) : null;

const latestObservation = observations.at(-1) || null;
const latestVersion = versions.at(-1) || null;
const effectiveStart = product.listedAt || product.firstSeenAt;
const startQuality = product.listedAt ? 'official_or_detail_timestamp' : 'first_seen_only';
const output = {
  generatedAt:new Date().toISOString(), storeId, displayName, product,
  effectiveStart, startQuality, latestVersion, latestObservation,
  advertising: { groupAd, rangeRecord, incrementalDaily:incremental, directAds, lifetimeKnown:total },
  roi: {
    status:'unavailable_without_cost_fees_and_complete_order_margin',
    adRoas:total.roas,
    trueRoi:null,
    formula:'(商品收入 - 商品成本 - 平台費 - 物流補貼/增量運費 - 廣告費 - 退款損失) / 全部投入成本',
    missing:['unit_cost','platform_fee','shipping_subsidy_or_incremental_shipping','refund_loss','complete_product_order_revenue'],
  },
};

const outDir = path.join(root, 'analysis', 'products', productId);
fs.mkdirSync(outDir, {recursive:true});
const jsonPath = path.join(outDir, 'lifetime-roi.json');
const mdPath = path.join(outDir, 'lifetime-roi.md');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const taipei = value => new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const startLabel = product.listedAt ? `${taipei(product.listedAt)}（${product.listedAtSource || '商品詳情'}）` : `${taipei(product.firstSeenAt)}（首次發現，不能當作正式上架日）`;
const priceLabel = latestVersion?.priceMin == null ? '未取得' : latestVersion.priceMin === latestVersion.priceMax ? `NT$${latestVersion.priceMin}` : `NT$${latestVersion.priceMin}–${latestVersion.priceMax}`;
const lines = [
  `# ${displayName}｜商品 ${productId} 上架至今投入產出`, '',
  `- 商品：${product.productName}`, `- 主商品貨號：${product.sellerSku || '未取得'}`,
  `- 上架／可確認起點：${startLabel}`, `- 目前價格：${priceLabel}`,
  `- 商品狀態：${product.currentStatus || product.lifecycleStatus || '未知'}`, '',
  `- 所在廣告群組：${groupAd ? `${groupAd.adId}｜${groupAd.adName}；廣告開始日 ${groupAd.startDate || groupAd.firstMetricDate || '未取得'}` : '未取得'}`, '',
  '## 可確認的廣告投入產出', '',
  '| 指標 | 數值 |', '|---|---:|',
  `| 廣告曝光 | ${total.impressions} |`, `| 點擊 | ${total.clicks} |`,
  `| CTR | ${total.ctrPct.toFixed(2)}% |`, `| 廣告花費 | NT$${total.spend.toFixed(2)} |`,
  `| 平均CPC | ${total.cpc == null ? '—' : `NT$${total.cpc.toFixed(2)}`} |`,
  `| 廣告轉換 | ${total.conversions} |`, `| 廣告銷售數 | ${total.salesCount} |`,
  `| 廣告營收 | NT$${total.revenue.toFixed(2)} |`, `| 廣告ROAS | ${total.roas == null ? '—' : total.roas.toFixed(2)} |`,
  `| 僅計廣告費的回報率 | ${total.adOnlyReturnPct == null ? '—' : `${total.adOnlyReturnPct.toFixed(2)}%`} |`, '',
  '## 判斷', '',
  total.revenue === 0
    ? `- 已有 ${total.impressions} 次廣告曝光與 ${total.clicks} 次點擊，但沒有歸因營收；目前廣告ROAS為0。`
    : `- 廣告ROAS為${total.roas.toFixed(2)}，需再與損益平衡ROAS比較。`,
  `- 商品頁最近觀測：近30日瀏覽 ${latestObservation?.views ?? '未取得'}、銷量 ${latestObservation?.sales ?? '未取得'}、累計售出 ${latestObservation?.soldTotal ?? '未取得'}。`,
  '- 真正ROI目前不能可靠計算，因為尚缺商品成本、平台費、物流／補貼、退款損失與完整自然訂單收入。',
  '- 只用廣告營收減廣告費計算時，回報率為 -100%；這是廣告費回收結果，不代表完整商品ROI。',
  `- 所在廣告群組於 ${groupAd?.startDate || groupAd?.firstMetricDate || '未知日期'} 開始；商品層資料已覆蓋到最新回補日，不把缺失日期推算成0。`,
  '- 目前可確定的是廣告效率，而不是整體商品利潤。', '',
  '## 建議', '',
  '- 目前保留原群組先觀察，不立即關閉或移出。',
  '- 首圖直接呈現摺疊前後、瀝水使用方式與尺寸；標題前段保留「摺疊瀝水籃／洗菜籃」。',
  '- D+3歸因完成後，再決定是否進行單一商品微調；每次調整後觀察3天。',
  '- 重新測試時累積至少1000曝光或10次點擊後再判斷。',
  '- 若重新測試仍無加購、無訂單，先列入待調整清單，再人工決定是否停止。',
];
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({jsonPath,mdPath,productId,effectiveStart,startQuality,groupAd,total,latestObservation,latestVersion,directAds:directAds.length,incrementalRows:incremental.length}));
