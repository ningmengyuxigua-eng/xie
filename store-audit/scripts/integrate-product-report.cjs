const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'product-report', '2026-10-09');
const traffic = JSON.parse(fs.readFileSync(path.join(reportDir, 'candidate-products-30d.json'), 'utf8').replace(/^\uFEFF/, ''));
const current = JSON.parse(fs.readFileSync(path.join(reportDir, 'candidate-product-current-facts.json'), 'utf8').replace(/^\uFEFF/, ''));
const legacy = JSON.parse(fs.readFileSync(path.join(root, '2026-10-06', 'product-analysis.json'), 'utf8').replace(/^\uFEFF/, ''));
const adDaily = JSON.parse(fs.readFileSync(path.join(root, 'ad-daily', '2026-10-08', 'ad-evaluation.json'), 'utf8').replace(/^\uFEFF/, ''));

const currentMap = new Map(current.map(x => [String(x.itemId), x]));
const legacyMap = new Map(legacy.map(x => [String(x.productId), x]));
const ids = new Set(traffic.items.map(x => String(x.itemId)));

function money(text) {
  if (text == null) return 0;
  return Number(String(text).replace(/[^0-9.-]/g, '')) || 0;
}

const d1Rows = [];
for (const item of adDaily.items || []) {
  if (item.productId && ids.has(String(item.productId))) {
    d1Rows.push({
      source: 'single_product', adId: String(item.adId), adName: item.adName,
      productId: String(item.productId), impressions: Number(item.evidence?.impressions || 0),
      clicks: Number(item.evidence?.clicks || 0), spend: Number(item.evidence?.spend || 0),
      conversions: Number(item.evidence?.conversions || 0), revenue: Number(item.evidence?.revenue || 0),
    });
  }
}

const groupsRoot = path.join(root, 'ad-daily', '2026-10-08', 'groups');
if (fs.existsSync(groupsRoot)) {
  for (const groupId of fs.readdirSync(groupsRoot)) {
    const dir = path.join(groupsRoot, groupId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter(x => /^page-\d+\.json$/.test(x))) {
      const page = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''));
      for (const row of page.rows || []) {
        const productId = String(row.productId || '');
        if (!ids.has(productId)) continue;
        d1Rows.push({
          source: 'group', adId: String(page.adId || groupId), adName: null, productId,
          productName: row.productName,
          impressions: money(row.metrics?.['瀏覽數']), clicks: money(row.metrics?.['點擊數']),
          spend: money(row.metrics?.['花費']), conversions: money(row.metrics?.['轉換數']),
          revenue: money(row.metrics?.['銷售額']),
        });
      }
    }
  }
}

function diagnosis(x) {
  if (Number(x.orders) > 0) return '已成交，保留並優化';
  if (Number(x.cardViews) >= 300 && Number(x.ctrPct) < 2) return '高曝光低點擊';
  if (Number(x.productClicks) >= 15) return '有點擊但未成交';
  if (Number(x.cardViews) < 100) return '低曝光，先查索引與需求';
  return '有曝光，樣本或轉換不足';
}

function action(x) {
  const d = diagnosis(x);
  if (d === '已成交，保留並優化') return '保留；控制廣告成本，測試關聯加購';
  if (d === '高曝光低點擊') return '優先改主圖、標題首段與價格呈現';
  if (d === '有點擊但未成交') return '檢查規格、信任資訊、運費與優惠承接';
  if (d === '低曝光，先查索引與需求') return '核對類目、屬性與台灣搜尋詞，做小額測試';
  return '累積樣本，避免立即下架';
}

const items = traffic.items.map(t => {
  const id = String(t.itemId);
  const c = currentMap.get(id) || {};
  const l = legacyMap.get(id) || {};
  const ads = d1Rows.filter(r => r.productId === id);
  const d1 = ads.reduce((a, r) => ({
    impressions: a.impressions + r.impressions,
    clicks: a.clicks + r.clicks,
    spend: +(a.spend + r.spend).toFixed(2),
    conversions: a.conversions + r.conversions,
    revenue: +(a.revenue + r.revenue).toFixed(2),
  }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 });
  return {
    ...t,
    fullName: l.name || t.displayName,
    sku: l.sku || null,
    active: c.active,
    priceMinTwd: c.priceMinTwd,
    priceMaxTwd: c.priceMaxTwd,
    promotionText: c.promotionText,
    listingAgeDays: c.inferredListingAgeDays,
    lifecycleEvidence: c.newProductDaysRemaining == null ? '上架日待補' : `新品期剩餘 ${c.newProductDaysRemaining} 天`,
    legacyAdSnapshot: {
      date: '2026-10-06', activeMappings: Number(l.activeAds || 0), spend: Number(l.adExpense || 0),
      revenue: Number(l.adRevenue || 0), roas: Number(l.adExpense || 0) > 0 ? +(Number(l.adRevenue || 0) / Number(l.adExpense || 0)).toFixed(2) : null,
      assessment: l.assessment || null,
    },
    adD1: { date: '2026-10-08', rows: ads, ...d1 },
    diagnosis: diagnosis(t),
    action: action(t),
  };
});

const totals = items.reduce((a, x) => ({
  cardViews: a.cardViews + Number(x.cardViews || 0), productClicks: a.productClicks + Number(x.productClicks || 0),
  orders: a.orders + Number(x.orders || 0), salesTwd: a.salesTwd + Number(x.salesTwd || 0),
  adD1Impressions: a.adD1Impressions + x.adD1.impressions, adD1Clicks: a.adD1Clicks + x.adD1.clicks,
  adD1Spend: +(a.adD1Spend + x.adD1.spend).toFixed(2),
}), { cardViews: 0, productClicks: 0, orders: 0, salesTwd: 0, adD1Impressions: 0, adD1Clicks: 0, adD1Spend: 0 });
totals.weightedCtrPct = totals.cardViews ? +(totals.productClicks / totals.cardViews * 100).toFixed(2) : 0;

const diagnosisCounts = Object.entries(items.reduce((a, x) => { a[x.diagnosis] = (a[x.diagnosis] || 0) + 1; return a; }, {}))
  .map(([label, count]) => ({ label, count }));

const bundles = [
  {
    priority: 1, theme: '瓦斯爐清潔組', type: '加價購',
    mainItemId: '55815332702', main: '矽膠清潔刷', mainPrice: 162,
    addonItemId: '44234203144', addon: '瓦斯爐清潔針', addonPrice: 84,
    recommendedPrice: '加購 NT$69，合計 NT$231',
    reason: '兩件都已成交，清潔情境相連；主商品 CTR 6.05%，適合承接加購。',
    risk: '清潔針需保留關閉瓦斯與冷卻後使用的安全提醒；成本未接入前先限量測試。',
  },
  {
    priority: 2, theme: '副食品用餐組', type: '組合銷售',
    mainItemId: '53367939557', main: '嬰兒副食品剪刀', mainPrice: 445,
    addonItemId: '55167661781', addon: '嬰兒接飯圍兜', addonPrice: 268,
    recommendedPrice: '組合 NT$659 起',
    reason: '同一餵食場景；剪刀 1,362 次曝光、43 次點擊，組合可補足使用情境並提高客單。',
    risk: '兩件都未成交，需先補食品接觸材質、年齡與尺寸資訊；不可把高流量誤當已證實需求。',
  },
  {
    priority: 3, theme: '氣炸鍋防燙組', type: '加價購',
    mainItemId: '44434356078', main: '氣炸鍋矽膠烤盤', mainPrice: 270,
    addonItemId: '47368244100', addon: '矽膠隔熱墊', addonPrice: 68,
    recommendedPrice: '加購 NT$59，合計 NT$329',
    reason: '烹調與端取流程相連；低價隔熱墊能跨過滿額門檻並提高客單。',
    risk: '主商品 CTR 只有 1.27%，應先修主圖與尺寸適配；需確認耐熱說明與食品接觸用途。',
  },
  {
    priority: 4, theme: '夏季冰飲組', type: '組合銷售',
    mainItemId: '57515648295', main: '免插電炒冰機', mainPrice: 424,
    addonItemId: '57468109537', addon: '手動檸檬榨汁器', addonPrice: 92,
    recommendedPrice: '組合 NT$489 起',
    reason: '冰品與果汁同屬夏季甜點情境；榨汁器已有成交，可替未成交主商品增加用途展示。',
    risk: '季節性高；炒冰機近 30 天 16 次點擊仍無訂單，需先用影片驗證操作難度與期待落差。',
  },
];

const quality = {
  traffic30d: { status: 'complete', itemCount: items.length, period: '2026-09-09 to 2026-10-08' },
  currentProductFacts: { status: current.every(x => x.status === 'complete') ? 'complete' : 'partial', itemCount: current.length, collectedOn: '2026-10-09' },
  adD1: { status: 'partial', metricDate: '2026-10-08', note: '只整合已完成下鑽的單品與群組商品列；仍有未下鑽群組。' },
  naturalTraffic: { status: 'not_separated', note: '商品表現頁的商品卡瀏覽未證實為純自然流量，因此本報告標為商品卡總流量。' },
  traffic60d: { status: 'not_applicable', note: '店鋪 2026-08-14 開店，至 2026-10-09 尚未形成完整 60 天觀察窗。' },
  margin: { status: 'missing', note: '未接入採購成本、平台費與運費補貼，促銷價格屬測試價，啟用前需通過毛利底線。' },
};

const result = {
  storeDisplayName: '拾味廚房雜貨鋪', storeId: traffic.storeId,
  generatedAt: new Date().toISOString(), analysisPeriod: traffic.periodStart + ' to ' + traffic.periodEnd,
  totals, diagnosisCounts, quality, bundles, items,
  officialRules: [
    { topic: '加價購', url: 'https://help.shopee.tw/portal/4/article/79884-%5B%E4%BF%83%E9%8A%B7%E5%84%AA%E6%83%A0%5D-%E4%BB%80%E9%BA%BC%E6%98%AF%E5%8A%A0%E5%83%B9%E8%B3%BC%EF%BC%9F', rule: '加價購商品可設優惠價與購買數量限制。' },
    { topic: '促銷組合', url: 'https://help.shopee.tw/portal/4/article/79889', rule: '賣家可設定組合條件；限時特賣商品不套用促銷組合價。' },
    { topic: '商品管理', url: 'https://help.shopee.tw/portal/4/article/146385', rule: '行銷活動中的部分商品可能無法編輯或下架；商品刪除後無法復原。' },
    { topic: '刊登規範', url: 'https://help.shopee.tw/portal/4/article/77364', rule: '禁止同樣商品重複上架，也禁止誤導或不實標價。' },
  ],
};

fs.writeFileSync(path.join(reportDir, 'integrated-product-analysis.json'), JSON.stringify(result, null, 2));

const csv = [
  ['item_id','name','views_30d','clicks_30d','ctr_pct','orders_30d','sales_twd','price_min','price_max','stock','listing_age_days','diagnosis','action'],
  ...items.map(x => [x.itemId,x.displayName,x.cardViews,x.productClicks,x.ctrPct,x.orders,x.salesTwd,x.priceMinTwd,x.priceMaxTwd,x.stockSnapshot,x.listingAgeDays,x.diagnosis,x.action]),
].map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
fs.writeFileSync(path.join(reportDir, 'integrated-product-analysis.csv'), '\uFEFF' + csv);

console.log(JSON.stringify({ itemCount: items.length, totals, diagnosisCounts, d1MatchedRows: d1Rows.length, bundleCount: bundles.length, quality }, null, 2));
