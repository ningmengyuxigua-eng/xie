const fs = require('node:fs');
const path = require('node:path');
const storeProfile = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'store-profile.json'), 'utf8'));

const root = __dirname;
const SOURCE_DATE = process.argv[2] || '2026-10-06';
const detailFiles = ['priority-bundle-product-details.jsonl', 'alternate-cutting-boards.jsonl'];
const rows = detailFiles.flatMap((file) => fs.existsSync(path.join(root, 'analysis', file))
  ? fs.readFileSync(path.join(root, 'analysis', file), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse)
  : []);
const products = new Map(rows.map((row) => [String(row.productId), row]));

const definitions = [
  {
    rank: 1,
    scenario: '海鮮處理',
    promotionMode: 'bundle_sale',
    mainRole: 'left',
    secondaryRole: 'bundle_item',
    roleReason: '魚鱗刨有較高流量，作為入口商品；砧板價格高於魚鱗刨，不適合作為加價購。',
    left: ['40834145983', '316461869695'],
    right: ['47265353153', '177420918504'],
    alternatives: ['177420918505', '177420918506'],
    readiness: 'ready_for_cost_check',
    risk: '兩件現價合計較高，且目前只有功能關聯、尚無共同購買證據；先小流量測試並確認砧板顏色規格與毛利。',
  },
  {
    rank: 2,
    scenario: '蔬果備料',
    promotionMode: 'addon_purchase',
    mainRole: 'left',
    secondaryRole: 'addon_item',
    roleReason: '切條器是需求入口，PP 砧板價格僅為主商品約 39%，適合作為低門檻加購。',
    left: ['53515625140', '326335319719'],
    right: ['53715625113', '401335328007'],
    alternatives: [],
    readiness: 'ready_for_cost_check',
    risk: 'PP 砧板近 30 天尚無銷量，可能是商品頁或需求弱；先確認成本、運費與活動疊加，再以小樣本驗證加購率。',
  },
  {
    rank: 3,
    scenario: '烘焙製作',
    promotionMode: 'addon_purchase',
    mainRole: 'left',
    secondaryRole: 'addon_item',
    roleReason: '撒粉器的流量、銷量和價格均較高，以蛋糕模作為較低價加購品。',
    left: ['51015333358', '331313805715'],
    right: ['46565646410', '351335319675'],
    alternatives: ['351335319676'],
    readiness: 'needs_variation_exclusion',
    risk: '撒粉器商品內含「鏈條器」規格；若活動不能限定 variation，必須先拆分商品或放棄商品層級組合。',
  },
  {
    rank: 4,
    scenario: '戶外烤肉',
    promotionMode: 'bundle_sale',
    mainRole: 'left',
    secondaryRole: 'bundle_item',
    roleReason: '烤肉工具組承擔主要烹調功能；香料盒價格約為主商品 78%，更適合組合銷售而非低價加購。',
    left: ['43184145393', '386460918475'],
    right: ['52865621381', '336335347251'],
    alternatives: [],
    readiness: 'needs_variation_exclusion',
    risk: '兩個商品都含單件／配件規格；應限定完整工具組與完整香料盒套裝。',
  },
];

function getVariation([productId, variationId]) {
  const product = products.get(productId);
  if (!product) throw new Error(`Missing product ${productId}`);
  const variation = product.variations.find((item) => String(item.variationId) === variationId);
  if (!variation) throw new Error(`Missing variation ${variationId}`);
  return {
    productId,
    productName: product.name,
    variationId,
    variationName: variation.name,
    normalPrice: variation.normalPrice,
    currentPrice: variation.currentPrice,
    stock: variation.stock,
    promotionLabels: product.promotion.labels,
  };
}

const candidates = definitions.map((definition) => {
  const left = getVariation(definition.left);
  const right = getVariation(definition.right);
  const currentSum = left.currentPrice + right.currentPrice;
  const isAddon = definition.promotionMode === 'addon_purchase';
  const recommendedDiscountPct = isAddon ? 10 : 5;
  const recommendedPrice = isAddon
    ? Math.round(right.currentPrice * 0.90)
    : Math.round(currentSum * 0.95);
  return {
    ...definition,
    left,
    right,
    currentSum,
    existingAny2Price: Math.round(currentSum * 0.99),
    recommendedPrice,
    recommendedPriceMeaning: isAddon ? '加購商品價格' : '兩件組合總價',
    recommendedDiscountPct,
    recommendationBasis: isAddon
      ? '以加購商品目前活動價九折作為首輪測試，兼顧誘因與價格空間。'
      : '以兩件目前活動價合計九五折作為首輪測試，折扣明顯高於既有兩件九九折。',
    complianceChecks: ['活動頁清楚列出指定規格與數量', '折扣基準使用真實近期售價', '上線前通過成本與活動疊加檢查'],
    testPrices: [3, 5, 8].map((discountPct) => ({
      discountPct,
      bundlePrice: Math.round(currentSum * (1 - discountPct / 100)),
    })),
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  storeId: '27857268786685',
  storeName: storeProfile.displayName,
  keyContract: ['store_id', 'product_id', 'variation_id', 'effective_from'],
  currentPromotionFinding: 'All 7 sampled products expose campaign types 3 and 8 and a 2-item 1%-off label.',
  priceBasis: 'current promotion price returned by product detail API',
  candidates,
};

const out = path.join(root, 'analysis', 'priority-bundle-variant-analysis.json');
fs.writeFileSync(out, JSON.stringify(output, null, 2));
const modeLabel = (mode) => mode === 'addon_purchase' ? '加價購' : '組合銷售';
const shortName = (name) => String(name).replace(/^[^\p{L}\p{N}]*/u, '').split(/\s+/).slice(0, 3).join(' ');
const markdown = [
  `# ${storeProfile.displayName}｜組合銷售與加價購建議`,
  '',
  `- 資料日期：${SOURCE_DATE}`,
  '- 價格基準：商品詳情頁目前活動價。',
  '- 推薦價格是首輪測試價；取得單品成本、平台費與增量運費後才可核准上線。',
  '',
  '| 優先 | 情境／做法 | 主商品（ID） | 搭配商品（ID） | 目前價格 | 推薦價格 TWD | 推薦理由 | 主要風險 |',
  '|---:|---|---|---|---:|---:|---|---|',
  ...candidates.map((c) => {
    const current = c.promotionMode === 'addon_purchase'
      ? `加購品 ${c.right.currentPrice}`
      : `合計 ${c.currentSum}`;
    return `| ${c.rank} | ${c.scenario}／${modeLabel(c.promotionMode)} | ${shortName(c.left.productName)}（${c.left.productId}） | ${shortName(c.right.productName)}（${c.right.productId}） | ${current} | **${c.recommendedPrice}**（${c.recommendedPriceMeaning}） | ${c.roleReason}${c.recommendationBasis} | ${c.risk} |`;
  }),
  '',
  '## 上線共同檢查',
  '',
  '1. 促銷名稱、圖片及說明必須清楚列出指定規格、數量與實付價格。',
  '2. 不以虛高原價製造折扣；折扣基準保留近期真實售價證據。',
  '3. 同一 SKU 若已參加折扣、任選或其他活動，先確認是否可疊加及最終成交價。',
  '4. 價格下限＝單品成本合計＋平台費＋增量運費＋最低貢獻毛利；未通過即不發布。',
  '5. 每組先跑 7 天或達到最低流量樣本，再看加購率、組合轉換率、客單價與貢獻毛利。',
  '',
].join('\n');
const report = path.join(root, 'analysis', 'bundle-addon-recommendations.md');
fs.writeFileSync(report, markdown);
console.log(JSON.stringify({ candidates: candidates.length, variationsValidated: candidates.length * 2, output: out, report }));
