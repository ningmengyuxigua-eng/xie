const fs = require('node:fs');
const path = require('node:path');
const storeProfile = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'store-profile.json'), 'utf8'));

const root = __dirname;
const source = JSON.parse(fs.readFileSync(path.join(root, '2026-10-06', 'product-analysis.json'), 'utf8'));
const byId = new Map(source.map((item) => [String(item.productId), item]));
const metric = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  const n = Number.parseFloat(text) || 0;
  return text.includes('k') ? n * 1000 : n;
};

const definitions = [
  ['51015333358', '46565646410', 98, '烘焙裝飾', '撒粉／過篩後直接搭配蛋糕模具完成烘焙流程'],
  ['43184145393', '52865621381', 97, '戶外烤肉', '烤肉剪刀、食物夾、油刷與香料收納屬同一備料及烹調流程'],
  ['40834145983', '47265353153', 95, '海鮮處理', '刮魚鱗後需要砧板繼續分切處理'],
  ['53515625140', '53715625113', 94, '蔬果備料', '切條器與 PP 砧板共同完成沙拉及蔬果備料'],
  ['53565657394', '53415625170', 93, '米糧收納', '儲米桶與刻度量米勺是直接配套'],
  ['53515619218', '56067231377', 92, '水槽清潔', '水槽海綿架與洗碗海綿可一起使用及收納'],
  ['55315621293', '51065345147', 92, '廚衛清潔', '抹布掛架與吸水清潔抹布形成使用後收納組合'],
  ['47367247382', '47368244100', 91, '飲酒餐桌', '紅酒開瓶器與杯墊屬同一次餐桌使用情境'],
  ['53865619228', '43184145393', 91, '肉類烹調', '鬆肉錘完成前處理，烤肉工具組完成夾取、刷油與剪切'],
  ['53615337392', '51815619247', 90, '烹飪收納', '鍋鏟湯勺套組與鍋鏟接水收納架直接配套'],
  ['29245790758', '53515619231', 89, '雞胸備餐', '雞胸肉分絲器與冷凍備餐盒連接處理及分裝流程'],
  ['53815644367', '46565646410', 89, '蛋糕製作', '矽膠刮刀負責麵糊處理，蛋糕模負責成型烘烤'],
];

function compact(id) {
  const item = byId.get(id);
  if (!item) throw new Error(`Missing product ${id}`);
  return {
    productId: id,
    name: item.name,
    sales30: metric(item.sales30),
    views30: metric(item.views30),
    activeAds: Number(item.activeAds || 0),
  };
}

const candidates = definitions.map(([anchorId, mateId, associationScore, scenario, reason], index) => ({
  rank: index + 1,
  candidateKey: [anchorId, mateId].sort().join(':'),
  associationType: 'functional_semantic',
  associationScore,
  scenario,
  reason,
  anchor: compact(anchorId),
  mate: compact(mateId),
  objective: 'increase_aov',
  status: 'candidate_needs_variation_price_cost_and_promotion_reset',
}));

const result = {
  generatedAt: new Date().toISOString(),
  storeId: '27857268786685',
  storeName: storeProfile.displayName,
  sourceDate: '2026-10-06',
  scope: 'high functional affinity shortlist; no co-purchase claim',
  pricingConfigObserved: {
    basis: 'collected_selling_price',
    multiplierPct: 900,
    fixedAdditionCurrency: 'TWD',
    fixedAddition: 20,
    interpretedFormula: 'selling_price = collected_selling_price * 9 + 20 TWD',
    automaticFiveTimesSkuAdjustment: false,
  },
  candidates,
};

const output = path.join(root, 'analysis', 'high-affinity-bundles.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ candidates: candidates.length, allProductsResolved: true, output }));
