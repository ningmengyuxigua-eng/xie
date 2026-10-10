const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'), { readOnly: true });
const schemaVersion = db.prepare('SELECT MAX(version) version FROM schema_version').get().version;
const products = db.prepare('SELECT COUNT(*) count FROM product_master').get().count;
const listedKnown = db.prepare('SELECT COUNT(*) count FROM product_master WHERE listed_at IS NOT NULL').get().count;
const lifecycle = db.prepare('SELECT lifecycle_status status,COUNT(*) count FROM product_master GROUP BY lifecycle_status ORDER BY lifecycle_status').all();
const lifecycleEvents = db.prepare('SELECT COUNT(*) count FROM product_lifecycle_event').get().count;
const detailQueue = db.prepare('SELECT status,COUNT(*) count FROM product_detail_queue GROUP BY status ORDER BY status').all();
const reports = db.prepare('SELECT enabled,COUNT(*) count FROM report_definition GROUP BY enabled ORDER BY enabled').all();
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();

const context = {
  generatedAt: new Date().toISOString(),
  identity: { displayName: '拾味廚房雜貨鋪', storeId: '27857268786685', platform: 'Shopee台灣本土' },
  purpose: '以商品為中心分析流量、廣告與促銷，提出組合銷售、加價購及人工下架候選，提高客單價。',
  database: { schemaVersion, integrity, products, productsWithListedAt: listedKnown, lifecycle, lifecycleEvents, detailQueue },
  operatingRules: [
    '商品Key固定為store_id + product_id。',
    '每日增量已知商品不重讀詳情、不重寫未變更內容；新商品才入詳情佇列。',
    '每批最多20筆，原始資料保存在本機，對話只載入摘要與最多20筆行動項。',
    'listed_at優先使用first_publish_time，其次create_time；不得用first_seen_at冒充。',
    '下架保留商品及全部歷史，狀態變更寫入product_lifecycle_event；禁止自動下架。',
    '定時任務、通知及店鋪修改目前關閉。'
  ],
  modules: {
    productBaseline: 'complete', productCollector: 'reserved_disabled', productLifecycle: 'implemented',
    advertising: 'implemented_for_active_ads_and_history', bundleAddon: 'prototype_ready',
    pickupAlert: 'prototype_ready_scheduler_disabled', reportCenter: reports,
  },
  nextStep: '待需要時實作並驗證每日最新上架商品採集器。',
  entryPoint: 'D:\\xiapi\\shopops.cmd',
};

const stateDir = path.join(root, 'state');
fs.mkdirSync(stateDir, { recursive: true });
const jsonPath = path.join(stateDir, 'project-context.json');
const mdPath = path.join(stateDir, 'project-context.md');
fs.writeFileSync(jsonPath, JSON.stringify(context, null, 2));
const markdown = [
  '# 拾味廚房雜貨鋪｜專案精簡上下文', '',
  `更新：${context.generatedAt}`, '',
  `- 資料庫版本：${schemaVersion}；完整性：${integrity}`,
  `- 商品：${products}；已知正式上架時間：${listedKnown}；生命週期事件：${lifecycleEvents}`,
  `- 採集器：保留、未啟用`, '',
  '## 固定規則', '', ...context.operatingRules.map(x => `- ${x}`), '',
  '## 下一步', '', context.nextStep, ''
].join('\n');
fs.writeFileSync(mdPath, markdown);
console.log(JSON.stringify({ jsonPath, mdPath, characters: markdown.length, products, schemaVersion }));
