const fs = require('node:fs');
const path = require('node:path');
const storeProfile = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'store-profile.json'), 'utf8'));

const ROOT = __dirname;
const SOURCE_DATE = process.argv[2] || '2026-10-06';
const dir = path.join(ROOT, SOURCE_DATE);
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''));
const asNumber = (value) => Number(String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
const asMetric = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  const number = asNumber(text);
  return text.includes('k') ? number * 1000 : number;
};
const round = (value) => Math.round(value);

function parsePriceRange(raw) {
  const head = String(raw || '').split(/\n(?=[^\n]+\n商品選項貨號:)/)[0];
  const match = head.match(/NT\$\s*([\d,]+)(?:\s*-\s*NT?\$?\s*([\d,]+))?/i);
  if (!match) return { minPrice: null, maxPrice: null };
  const first = asNumber(match[1]);
  const second = match[2] ? asNumber(match[2]) : first;
  return { minPrice: Math.min(first, second), maxPrice: Math.max(first, second) };
}

function parseStock(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const priceIndex = lines.findIndex((line) => /^NT\$[\d,]+(?:\s*-\s*NT?\$?[\d,]+)?$/i.test(line));
  const amsIndex = lines.findIndex((line) => line.includes('AMS'));
  const start = priceIndex >= 0 ? priceIndex + 1 : amsIndex + 1;
  if (start <= 0) return null;
  for (let i = start; i < Math.min(lines.length, start + 4); i += 1) {
    if (/^\d[\d,]*$/.test(lines[i])) return asNumber(lines[i]);
  }
  return null;
}

const FAMILY_RULES = [
  ['cleaning', /清潔|海綿|刷|刮水|抹布|菜瓜布|除塵|拖把|洗碗/],
  ['kitchen', /廚房|料理|削皮|刨|刀|砧板|鍋|保鮮|水餃|食材|烘焙|開瓶|隔熱/],
  ['bathroom', /浴室|洗手台|馬桶|蓮蓬頭|沐浴|肥皂|牙刷/],
  ['storage', /收納|置物|掛勾|掛鉤|整理|層架|衣架|鞋架|盒|袋/],
  ['laundry', /洗衣|曬衣|衣架|晾衣|洗衣袋/],
  ['beauty', /美妝|化妝|粉撲|眉|睫毛|美甲|梳|髮/],
  ['stationery', /文具|筆|貼紙|剪刀|尺|膠帶|文件|書籤/],
  ['electronics', /充電|手機|耳機|傳輸線|支架|USB|燈|電池/],
  ['pet', /寵物|貓|狗|飼料|逗貓|毛孩/],
  ['travel', /旅行|行李|護照|盥洗|分裝|收納袋/],
  ['dining', /餐桌|餐具|杯|吸管|筷|湯匙|叉|開瓶/],
];

const USE_RULES = [
  ['baking_mold', /蛋糕模|烤盤|甜甜圈模|糕點模|餅乾模|吐司模|三明治.*模|燒賣.*模|水餃.*模/],
  ['baking_prep', /烘焙|擀麵|揉麵|打蛋|撒粉|粉篩|糖粉篩|麵團|披薩.*刀|麵包刀/],
  ['meat_prep', /肉|牛排|雞胸|雞腿|嫩肉|鬆肉|烤肉|燒烤/],
  ['seafood_prep', /魚|海鮮|水產|魚鱗/],
  ['produce_prep', /蔬果|水果|蔬菜|削皮|刨絲|切條|去核|剝皮|大蒜/],
  ['cutting_board', /砧板|切菜板|料理板|菜板/],
  ['food_storage', /保鮮|食材.*盒|食材.*袋|密封.*盒|冷凍.*盒|冷凍.*袋|便當盒|餐盒|米桶|米缸/],
  ['seasoning', /調味|香料|醬汁|佐料|擠醬/],
  ['tableware', /餐具|筷|湯匙|叉子|飯勺|飯匙/],
  ['tableware_storage', /筷子.*盒|筷.*筒|筷籠|餐具收納|餐具.*架|飯勺.*架/],
  ['cookware_storage', /鍋蓋架|刀架|刀具收納|菜板架|砧板架|廚具置物/],
  ['wall_storage', /掛勾|掛鉤|壁掛|毛巾架|掛桿|門後收納/],
  ['cleaning_tool', /清潔|海綿|洗碗刷|鍋刷|刮水|抹布|菜瓜布/],
  ['can_opener', /開罐|罐頭刀/],
  ['bottle_opener', /開瓶|開酒|海馬刀/],
];

const USE_COMPLEMENTS = new Map(Object.entries({
  'baking_mold:baking_prep': 10,
  'baking_prep:cutting_board': 8,
  'meat_prep:seasoning': 9,
  'meat_prep:food_storage': 8,
  'meat_prep:cutting_board': 9,
  'seafood_prep:cleaning_tool': 9,
  'seafood_prep:cutting_board': 9,
  'produce_prep:food_storage': 8,
  'produce_prep:cutting_board': 9,
  'tableware:tableware_storage': 8,
  'cookware_storage:tableware': 8,
  'wall_storage:cleaning_tool': 9,
  'seasoning:food_storage': 7,
  'can_opener:food_storage': 9,
  'bottle_opener:tableware': 8,
}));

const COMPLEMENTS = new Set([
  'cleaning:kitchen', 'cleaning:bathroom', 'cleaning:storage',
  'kitchen:storage', 'kitchen:dining', 'bathroom:storage',
  'laundry:storage', 'beauty:storage', 'stationery:storage',
  'electronics:storage', 'travel:storage', 'pet:cleaning',
]);

function families(name) {
  const found = FAMILY_RULES.filter(([, re]) => re.test(name)).map(([family]) => family);
  return [...new Set(found)];
}

function uses(name) {
  return [...new Set(USE_RULES.filter(([, re]) => re.test(name)).map(([tag]) => tag))];
}

function relationScore(a, b) {
  let score = 0;
  const reasons = [];
  for (const left of a.families) {
    for (const right of b.families) {
      if (left === right) {
        score = Math.max(score, 2);
        reasons.push(`同場景:${left}`);
      }
      if (COMPLEMENTS.has(`${left}:${right}`) || COMPLEMENTS.has(`${right}:${left}`)) {
        score = Math.max(score, 3);
        reasons.push(`互補場景:${left}+${right}`);
      }
    }
  }
  for (const left of a.uses) {
    for (const right of b.uses) {
      const complementScore = USE_COMPLEMENTS.get(`${left}:${right}`) || USE_COMPLEMENTS.get(`${right}:${left}`);
      if (complementScore) {
        score = Math.max(score, complementScore);
        reasons.unshift(`功能互補:${left}+${right}`);
      } else if (left === right && ['baking_prep', 'meat_prep', 'produce_prep'].includes(left)) {
        score = Math.max(score, 4);
        reasons.unshift(`同用途:${left}`);
      }
    }
  }
  return { score, reason: [...new Set(reasons)].slice(0, 2).join('、') };
}

function extractPromotionIds(file) {
  if (!fs.existsSync(path.join(dir, file))) return [];
  const data = read(file);
  const text = JSON.stringify(data);
  return [...new Set([...text.matchAll(/商品ID:\s*(\d+)/g)].map((match) => match[1]))];
}

const products = read('product-analysis.json').map((item) => {
  const price = parsePriceRange(item.raw);
  return {
    productId: String(item.productId),
    name: item.name,
    sku: item.sku || null,
    ...price,
    stock: parseStock(item.raw),
    sales30: asMetric(item.sales30),
    views30: asMetric(item.views30),
    soldTotal: asMetric(item.sold),
    activeAds: asNumber(item.activeAds),
    families: families(item.name),
    uses: uses(item.name),
    priceSource: price.minPrice ? 'list_snapshot' : null,
  };
});

const detailPath = path.join(ROOT, 'analysis', 'candidate-product-details.jsonl');
const detailMap = new Map();
if (fs.existsSync(detailPath)) {
  for (const line of fs.readFileSync(detailPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const detail = JSON.parse(line);
    if (!detail.error && detail.minPrice) detailMap.set(String(detail.productId), detail);
  }
}
for (const product of products) {
  const detail = detailMap.get(product.productId);
  if (!detail) continue;
  product.minPrice = detail.minPrice;
  product.maxPrice = detail.maxPrice;
  const sorted = detail.prices.slice().sort((a, b) => a - b);
  product.referencePrice = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  product.priceSource = 'product_detail';
  product.activePromotionText = detail.promotionText || null;
}

const promoIds = new Set([
  ...extractPromotionIds('promotion-detail-combo.json'),
  ...extractPromotionIds('promotion-detail-full-reduction.json'),
]);
if (fs.existsSync(path.join(ROOT, '2026-10-07', 'discount-validation.json'))) {
  const discount = JSON.parse(fs.readFileSync(path.join(ROOT, '2026-10-07', 'discount-validation.json'), 'utf8'));
  for (const row of discount.rows || []) promoIds.add(String(row.productId));
}
for (const product of products) product.promotionConflict = promoIds.has(product.productId);

const eligible = products.filter((p) => p.families.length && !p.promotionConflict);
const pricedEligible = eligible.filter((p) => p.priceSource === 'product_detail');
const anchors = pricedEligible
  .filter((p) => p.sales30 > 0 || p.views30 >= 50 || p.activeAds > 0)
  .sort((a, b) => (b.sales30 * 20 + b.views30 + b.activeAds * 30) - (a.sales30 * 20 + a.views30 + a.activeAds * 30));

const addonCandidates = [];
for (const anchor of anchors.slice(0, 200)) {
  let best = null;
  for (const addon of pricedEligible) {
    if (addon.productId === anchor.productId) continue;
    if (addon.referencePrice >= anchor.referencePrice * 0.60 || addon.referencePrice < anchor.referencePrice * 0.08) continue;
    const relation = relationScore(anchor, addon);
    if (relation.score < 4) continue;
    const priceFit = 1 - Math.abs((addon.referencePrice / anchor.referencePrice) - 0.25);
    const demand = Math.min(2, addon.sales30 / 5) + Math.min(1, addon.views30 / 200);
    const score = relation.score * 10 + priceFit * 4 + demand;
    if (!best || score > best.score) best = { addon, relation, score };
  }
  if (!best) continue;
  const base = best.addon.referencePrice;
  addonCandidates.push({
    type: 'addon',
    anchor: pick(anchor),
    addon: pick(best.addon),
    reason: best.relation.reason,
    confidence: best.relation.score >= 3 ? 'medium' : 'low',
    pricing: [5, 10, 15].map((discountPct) => ({ discountPct, testPrice: round(base * (1 - discountPct / 100)) })),
    priceStatus: 'needs_cost_and_promotion_validation',
  });
}

const bundleCandidates = [];
for (const anchor of anchors.slice(0, 120)) {
  let best = null;
  for (const mate of pricedEligible) {
    if (mate.productId === anchor.productId) continue;
    if (mate.referencePrice > anchor.referencePrice * 1.5 || mate.referencePrice < anchor.referencePrice * 0.2) continue;
    const relation = relationScore(anchor, mate);
    if (relation.score < 4) continue;
    const balance = 1 - Math.min(1, Math.abs(anchor.referencePrice - mate.referencePrice) / Math.max(anchor.referencePrice, mate.referencePrice));
    const score = relation.score * 10 + balance * 5 + Math.min(2, mate.sales30 / 5);
    if (!best || score > best.score) best = { mate, relation, score };
  }
  if (!best) continue;
  const combined = anchor.referencePrice + best.mate.referencePrice;
  bundleCandidates.push({
    type: 'bundle',
    items: [pick(anchor), pick(best.mate)],
    reason: best.relation.reason,
    confidence: best.relation.score >= 3 ? 'medium' : 'low',
    combinedCurrentPrice: combined,
    pricing: [3, 5, 8].map((discountPct) => ({ discountPct, testPrice: round(combined * (1 - discountPct / 100)) })),
    priceStatus: 'needs_cost_and_promotion_validation',
  });
}

function pick(product) {
  return {
    productId: product.productId,
    name: product.name,
    minPrice: product.minPrice,
    maxPrice: product.maxPrice,
    referencePrice: product.referencePrice || product.minPrice,
    stock: product.stock,
    sales30: product.sales30,
    views30: product.views30,
    activeAds: product.activeAds,
    activePromotion: Boolean(product.activePromotionText),
  };
}

function uniquePairs(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const ids = row.type === 'addon' ? [row.anchor.productId, row.addon.productId] : row.items.map((x) => x.productId);
    const key = ids.slice().sort().join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function diversify(rows, limit) {
  const usage = new Map();
  const selected = [];
  for (const row of uniquePairs(rows)) {
    const ids = row.type === 'addon' ? [row.anchor.productId, row.addon.productId] : row.items.map((x) => x.productId);
    if (ids.some((id) => (usage.get(id) || 0) >= 2)) continue;
    selected.push(row);
    for (const id of ids) usage.set(id, (usage.get(id) || 0) + 1);
    if (selected.length === limit) break;
  }
  return selected;
}

const output = {
  generatedAt: new Date().toISOString(),
  storeId: '27857268786685',
  storeName: storeProfile.displayName,
  sourceDate: SOURCE_DATE,
  status: 'preliminary_candidates',
  pricingPolicy: {
    addonDiscountTestsPct: [5, 10, 15],
    bundleDiscountTestsPct: [3, 5, 8],
    finalPriceFloor: 'sum(unit_cost) + platform_fees + incremental_shipping + minimum_contribution',
    warning: 'No cost data is available and sampled products are already in a discount campaign. Test prices are not approved profit-safe prices.',
  },
  quality: {
    productCount: products.length,
    eligibleCount: eligible.length,
    promotionConflictCount: products.filter((p) => p.promotionConflict).length,
    detailPricedCount: pricedEligible.length,
    activePromotionDetailCount: products.filter((p) => p.activePromotionText).length,
    missingPriceCount: products.filter((p) => !p.minPrice).length,
    missingStockCount: products.filter((p) => p.stock == null).length,
    uncategorizedCount: products.filter((p) => !p.families.length).length,
    missingInputs: ['unit_cost', 'platform_fee_rate_or_amount', 'incremental_shipping', 'minimum_contribution', 'order_item_co_purchase_history', 'variation_level_price_mapping'],
  },
  addonCandidates: diversify(addonCandidates, 10),
  bundleCandidates: diversify(bundleCandidates, 10),
};

const outDir = path.join(ROOT, 'analysis');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'bundle-addon-candidates.json'), JSON.stringify(output, null, 2));
fs.writeFileSync(path.join(outDir, 'product-catalog-compact.json'), JSON.stringify({ sourceDate: SOURCE_DATE, products }, null, 2));
console.log(JSON.stringify({
  productCount: output.quality.productCount,
  eligibleCount: output.quality.eligibleCount,
  promotionConflictCount: output.quality.promotionConflictCount,
  missingPriceCount: output.quality.missingPriceCount,
  missingStockCount: output.quality.missingStockCount,
  uncategorizedCount: output.quality.uncategorizedCount,
  addonCandidates: output.addonCandidates.length,
  bundleCandidates: output.bundleCandidates.length,
}));
