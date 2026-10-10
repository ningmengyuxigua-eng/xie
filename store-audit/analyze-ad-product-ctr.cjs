const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) {
  throw new Error('Usage: node analyze-ad-product-ctr.cjs YYYY-MM-DD');
}

const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const single = db.prepare(`
  SELECT m.ad_id adId, m.product_id productId, m.ad_name productName,
         f.impressions, f.clicks, f.ctr, f.spend, f.conversions, f.revenue,
         (SELECT po.views_value FROM product_observations po
          WHERE po.store_id=m.store_id AND po.product_id=m.product_id
            AND po.window_type='rolling' AND po.window_days=30
          ORDER BY po.observation_date DESC LIMIT 1) views30,
         (SELECT po.sales_value FROM product_observations po
          WHERE po.store_id=m.store_id AND po.product_id=m.product_id
            AND po.window_type='rolling' AND po.window_days=30
          ORDER BY po.observation_date DESC LIMIT 1) sales30
  FROM ad_daily_fact f
  JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=? AND m.ad_type='single_product'
  ORDER BY f.impressions DESC, f.clicks DESC
`).all(storeId, metricDate);

const groupProducts = db.prepare(`
  SELECT p.ad_id adId, m.ad_name adName, p.product_id productId,
         p.product_name productName, p.impressions, p.clicks, p.ctr,
         p.spend, p.conversions, p.revenue,
         (SELECT po.views_value FROM product_observations po
          WHERE po.store_id=p.store_id AND po.product_id=p.product_id
            AND po.window_type='rolling' AND po.window_days=30
          ORDER BY po.observation_date DESC LIMIT 1) views30,
         (SELECT po.sales_value FROM product_observations po
          WHERE po.store_id=p.store_id AND po.product_id=p.product_id
            AND po.window_type='rolling' AND po.window_days=30
          ORDER BY po.observation_date DESC LIMIT 1) sales30
  FROM ad_product_daily_fact p
  LEFT JOIN ad_master m ON m.store_id=p.store_id AND m.ad_id=p.ad_id
  WHERE p.store_id=? AND p.metric_date=?
  ORDER BY p.impressions DESC, p.clicks DESC
`).all(storeId, metricDate);
db.close();

const n = (value, digits=2) => Number(Number(value || 0).toFixed(digits));
const pct = (clicks, impressions) => impressions ? n(clicks / impressions * 100) : 0;
const summarize = (rows) => {
  const totals = rows.reduce((a, x) => {
    a.impressions += Number(x.impressions || 0);
    a.clicks += Number(x.clicks || 0);
    a.spend += Number(x.spend || 0);
    a.conversions += Number(x.conversions || 0);
    a.revenue += Number(x.revenue || 0);
    return a;
  }, { impressions:0, clicks:0, spend:0, conversions:0, revenue:0 });
  totals.spend = n(totals.spend);
  totals.revenue = n(totals.revenue);
  totals.ctrPct = pct(totals.clicks, totals.impressions);
  return totals;
};
const normalize = (x) => ({ ...x, ctrPct:pct(x.clicks, x.impressions), spend:n(x.spend), revenue:n(x.revenue) });
const singleRows = single.map(normalize);
const groupRows = groupProducts.map(normalize);
const singleSummary = summarize(singleRows);
const groupSummary = summarize(groupRows);
const topSingle = singleRows.slice(0, 20);
const lowCtrSingle = singleRows.filter(x => x.impressions >= 100 && x.ctrPct < 1).sort((a,b) => b.impressions-a.impressions);
const zeroClickSingle = singleRows.filter(x => x.impressions >= 100 && x.clicks === 0).sort((a,b) => b.impressions-a.impressions);
const highCtrSingle = singleRows.filter(x => x.impressions >= 30 && x.clicks >= 2).sort((a,b) => b.ctrPct-a.ctrPct).slice(0, 15);
const lowCtrGroup = groupRows.filter(x => x.impressions >= 100 && x.ctrPct < 1).sort((a,b) => b.impressions-a.impressions);

const output = {
  generatedAt: new Date().toISOString(), storeId, displayName, metricDate,
  scope: {
    singleProductAds: 'complete_for_active_ads',
    groupProducts: groupRows.length ? 'collected_target_groups_only' : 'not_collected',
    note: '單品廣告可直接對應商品；商品群組必須逐組下鑽，本檔只含已完成下鑽的群組。',
  },
  singleProduct: {
    rows: singleRows.length, withImpressions:singleRows.filter(x=>x.impressions>0).length,
    withClicks:singleRows.filter(x=>x.clicks>0).length, totals:singleSummary,
    topByImpressions:topSingle, lowCtr:lowCtrSingle, zeroClick:zeroClickSingle, highCtr:highCtrSingle,
  },
  groupProduct: {
    rows: groupRows.length, groups:[...new Set(groupRows.map(x=>x.adId))], totals:groupSummary,
    topByImpressions:groupRows.slice(0,20), lowCtr:lowCtrGroup,
  },
};

const outDir = path.join(root, 'analysis', 'active-ads', metricDate);
fs.mkdirSync(outDir, { recursive:true });
const jsonPath = path.join(outDir, 'product-views-ctr.json');
const mdPath = path.join(outDir, 'product-views-ctr.md');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));

const safe = s => String(s || '').replaceAll('|', '/').replace(/\s+/g, ' ').trim();
const productTable = (rows) => rows.length ? rows.map(x =>
  `| ${x.productId || '未映射'} | ${safe(x.productName)} | ${x.views30 ?? '—'} | ${x.sales30 ?? '—'} | ${x.impressions} | ${x.clicks} | ${x.ctrPct.toFixed(2)}% | NT$${x.spend.toFixed(2)} | ${x.conversions} |`
).join('\n') : '| — | 無 | — | — | 0 | 0 | 0.00% | NT$0.00 | 0 |';

const lines = [
  `# ${displayName}｜${metricDate} 商品瀏覽量與廣告點擊率`, '',
  '> 「商品近30日瀏覽」來自商品清單滾動窗口；「昨日廣告曝光」來自蝦皮廣告，兩者口徑不同。', '',
  '## 完整度', '',
  `- 單品廣告：${singleRows.length} 個，已全部直接對應商品 ID。`,
  `- 商品群組：目前完成 ${output.groupProduct.groups.length} 個重點群組下鑽，共 ${groupRows.length} 個商品。其餘群組需分批下鑽，不能把群組曝光假設分配給商品。`, '',
  '## 單品廣告總覽', '',
  `- 商品數：${singleRows.length}；有曝光 ${output.singleProduct.withImpressions} 個；有點擊 ${output.singleProduct.withClicks} 個。`,
  `- 曝光 ${singleSummary.impressions}；點擊 ${singleSummary.clicks}；CTR ${singleSummary.ctrPct.toFixed(2)}%；花費 NT$${singleSummary.spend.toFixed(2)}；轉換 ${singleSummary.conversions}。`, '',
  '## 單品廣告瀏覽量前20', '',
  '| 商品ID | 商品 | 商品近30日瀏覽 | 商品近30日銷量 | 昨日廣告曝光 | 點擊 | CTR | 花費 | 轉換 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|', productTable(topSingle), '',
  '## 曝光至少100且CTR低於1%的單品', '',
  '| 商品ID | 商品 | 商品近30日瀏覽 | 商品近30日銷量 | 昨日廣告曝光 | 點擊 | CTR | 花費 | 轉換 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|', productTable(lowCtrSingle), '',
  '## 有一定樣本且CTR較高的單品', '',
  '| 商品ID | 商品 | 商品近30日瀏覽 | 商品近30日銷量 | 昨日廣告曝光 | 點擊 | CTR | 花費 | 轉換 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|', productTable(highCtrSingle), '',
  '## 已下鑽商品群組：商品瀏覽量前20', '',
  '| 商品ID | 商品 | 商品近30日瀏覽 | 商品近30日銷量 | 昨日廣告曝光 | 點擊 | CTR | 花費 | 轉換 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|', productTable(groupRows.slice(0,20)), '',
  '## 判讀規則', '',
  '- 曝光少於100時不因CTR低直接調整；先累積樣本。',
  '- 曝光至少100且CTR低於1%，優先檢查主圖、標題、價格展示及商品與搜尋意圖是否一致。',
  '- CTR高但沒有轉換，問題通常在價格、優惠、規格、評價、運費或商品頁成交力。',
  '- 群組商品必須使用商品層數據；不能用群組總曝光代替各商品瀏覽量。',
];
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ jsonPath, mdPath, singleRows:singleRows.length, singleSummary, lowCtrSingle:lowCtrSingle.length, groupRows:groupRows.length, groupSummary }));
