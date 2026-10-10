const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const storeId = '27857268786685';
const displayName = '拾味廚房雜貨鋪';
const snapshotDate = process.argv[2] || '2026-10-08';
const sourcePath = path.join(root, 'analysis', 'active-ads', snapshotDate, 'active-group-product-decisions.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const aggregated = new Map();
for (const group of source.groups || []) {
  for (const product of group.products || []) {
    const id = String(product.productId || '');
    if (!id) continue;
    const row = aggregated.get(id) || {
      productId:id, productName:product.productName, groupIds:[], groupNames:[],
      impressions:0, clicks:0, spend:0, conversions:0, salesCount:0, revenue:0,
    };
    if (!row.groupIds.includes(group.adId)) row.groupIds.push(group.adId);
    if (!row.groupNames.includes(group.adName)) row.groupNames.push(group.adName);
    for (const field of ['impressions','clicks','spend','conversions','salesCount','revenue']) {
      row[field] += Number(product[field] || 0);
    }
    aggregated.set(id, row);
  }
}

const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const productMeta = db.prepare(`
  SELECT p.product_id productId, p.current_status currentStatus, p.lifecycle_status lifecycleStatus,
         p.listed_at listedAt,
         (SELECT v.price_min FROM product_versions v WHERE v.store_id=p.store_id AND v.product_id=p.product_id
          ORDER BY v.valid_from DESC LIMIT 1) priceMin,
         (SELECT v.price_max FROM product_versions v WHERE v.store_id=p.store_id AND v.product_id=p.product_id
          ORDER BY v.valid_from DESC LIMIT 1) priceMax,
         (SELECT o.views_value FROM product_observations o WHERE o.store_id=p.store_id AND o.product_id=p.product_id
          AND o.window_type='rolling' AND o.window_days=30 ORDER BY o.observation_date DESC LIMIT 1) views30,
         (SELECT o.sales_value FROM product_observations o WHERE o.store_id=p.store_id AND o.product_id=p.product_id
          AND o.window_type='rolling' AND o.window_days=30 ORDER BY o.observation_date DESC LIMIT 1) sales30
  FROM product_master p WHERE p.store_id=?
`).all(storeId);
const singleAds = db.prepare(`
  SELECT product_id productId, ad_id adId, ad_name adName, current_status currentStatus,
         daily_budget dailyBudget, target_roas targetRoas
  FROM ad_master WHERE store_id=? AND ad_type='single_product' AND product_id IS NOT NULL
`).all(storeId);
const yesterdayRows = db.prepare(`
  SELECT product_id productId, SUM(impressions) impressions, SUM(clicks) clicks,
         SUM(spend) spend, SUM(conversions) conversions, SUM(revenue) revenue,
         COUNT(DISTINCT ad_id) groupCount
  FROM ad_product_daily_fact WHERE store_id=? AND metric_date=? GROUP BY product_id
`).all(storeId, snapshotDate);
db.close();
const metaById = new Map(productMeta.map(x => [String(x.productId), x]));
const adsByProduct = new Map();
for (const ad of singleAds) {
  const id = String(ad.productId);
  if (!adsByProduct.has(id)) adsByProduct.set(id, []);
  adsByProduct.get(id).push(ad);
}
const yesterdayByProduct = new Map(yesterdayRows.map(x => [String(x.productId), x]));
const isActive = status => /進行中|active|ongoing/i.test(String(status || ''));
const money = value => Number(Number(value || 0).toFixed(2));

const rows = [...aggregated.values()].map(row => {
  row.spend = money(row.spend); row.revenue = money(row.revenue);
  row.ctrPct = row.impressions ? Number((row.clicks / row.impressions * 100).toFixed(2)) : 0;
  row.roas = row.spend ? Number((row.revenue / row.spend).toFixed(2)) : null;
  row.cvrPct = row.clicks ? Number((row.conversions / row.clicks * 100).toFixed(2)) : 0;
  const meta = metaById.get(row.productId) || {};
  const ads = adsByProduct.get(row.productId) || [];
  const yd = yesterdayByProduct.get(row.productId);
  const yesterday = yd ? {
    impressions:Number(yd.impressions||0), clicks:Number(yd.clicks||0),
    ctrPct:Number(yd.impressions ? (yd.clicks/yd.impressions*100).toFixed(2) : 0),
    spend:money(yd.spend), conversions:Number(yd.conversions||0), revenue:money(yd.revenue), groupCount:Number(yd.groupCount||0),
  } : null;
  const activeSingleAds = ads.filter(x => isActive(x.currentStatus));
  let decision = 'keep_in_group';
  let reason = '尚未形成足夠的獨立成交證據。';
  let risk = '過早單開會分散流量並增加管理成本。';
  if (activeSingleAds.length) {
    decision = 'already_has_single_ad';
    reason = '已有進行中單品廣告，不應重複建立。';
    risk = '重複廣告可能造成內部競價與歸因分散。';
  } else if (row.conversions >= 2 && row.clicks >= 5 && row.roas >= 5) {
    decision = 'open_standalone';
    reason = '至少2次轉換、5次點擊且群組商品ROAS至少5，已有獨立投放證據。';
    risk = '離開群組後競價和流量結構會改變；先用小預算測試3天。';
  } else if (row.conversions >= 2 && row.clicks >= 5 && row.roas >= 3) {
    decision = 'open_standalone_cautious';
    reason = '已有重複轉換且ROAS至少3，可用保守預算驗證獨立成效。';
    risk = '轉換量仍低，單開後可能無法維持同等ROAS。';
  } else if (row.conversions === 1 && row.clicks >= 4 && row.impressions >= 80 && row.roas >= 5) {
    decision = 'standalone_test';
    reason = '已有1次轉換、基本流量與較高ROAS，可進入小額獨立測試。';
    risk = '只有1次轉換，可能是偶發訂單；不能直接擴量。';
  } else if (row.conversions === 0 && (row.clicks >= 10 || row.spend >= 20)) {
    decision = 'do_not_open';
    reason = '已有明顯點擊或花費但沒有轉換，不適合再單開。';
    risk = '單開可能把群組內的低效花費放大。';
  }
  return {...row, ...meta, activeSingleAds, yesterday, decision, reason, risk};
});

const order = {open_standalone:0,open_standalone_cautious:1,standalone_test:2,already_has_single_ad:3,do_not_open:4,keep_in_group:5};
rows.sort((a,b) => order[a.decision]-order[b.decision] || b.conversions-a.conversions || (b.roas||0)-(a.roas||0) || b.revenue-a.revenue);
const candidates = rows.filter(x => ['open_standalone','open_standalone_cautious','standalone_test'].includes(x.decision));
const existing = rows.filter(x => x.decision === 'already_has_single_ad' && x.conversions > 0);
const rejected = rows.filter(x => x.decision === 'do_not_open').sort((a,b)=>b.spend-a.spend).slice(0,20);
const launchCandidates = candidates.filter(x=>x.decision==='open_standalone').map(x => ({
  ...x,
  launchScore:Number((x.conversions*30 + Math.min(x.clicks,40) + Math.min(x.roas||0,20) + (x.yesterday?.ctrPct||0)*2 + (x.yesterday?.clicks||0)*2).toFixed(2)),
})).sort((a,b)=>b.launchScore-a.launchScore);
const counts = rows.reduce((a,x)=>(a[x.decision]=(a[x.decision]||0)+1,a),{});

const output = {
  generatedAt:new Date().toISOString(), storeId, displayName, snapshotDate,
  sourceRange:source.range, completeness:{activeGroups:source.activeGroups,matchedGroups:source.matchedGroups,missingGroups:source.missingGroups,uniqueProducts:rows.length},
  thresholds:{open_standalone:'conversions>=2, clicks>=5, ROAS>=5',cautious:'conversions>=2, clicks>=5, ROAS>=3',test:'conversions=1, clicks>=4, impressions>=80, ROAS>=5'},
  counts,candidates,launchOrder:launchCandidates,existingSingleAdWinners:existing,rejectedTop:rejected,allItems:rows,
};
const outDir = path.join(root, 'analysis', 'active-ads', snapshotDate);
const jsonPath = path.join(outDir, 'standalone-ad-candidates.json');
const mdPath = path.join(outDir, 'standalone-ad-candidates.md');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const label={open_standalone:'值得單開',open_standalone_cautious:'保守單開',standalone_test:'小額測試'};
const short = name => String(name||'').replaceAll('|','/').replace(/^[^\p{L}\p{N}]*/u,'').slice(0,32);
const table = list => list.length ? list.map((x,i)=>`| ${i+1} | ${x.productId} | ${short(x.productName)} | ${x.groupIds.join(', ')} | ${x.impressions} | ${x.clicks} | ${x.ctrPct.toFixed(2)}% | ${x.conversions} | NT$${x.spend.toFixed(2)} | NT$${x.revenue.toFixed(2)} | ${x.roas?.toFixed(2) ?? '—'} | ${label[x.decision] || x.decision} |`).join('\n') : '| — | — | 無 | — | 0 | 0 | 0% | 0 | 0 | 0 | — | — |';
const yesterdayTable = list => list.map((x,i)=>`| ${i+1} | ${x.productId} | ${short(x.productName)} | ${x.yesterday?.impressions ?? '未下鑽'} | ${x.yesterday?.clicks ?? '—'} | ${x.yesterday ? `${x.yesterday.ctrPct.toFixed(2)}%` : '—'} | ${x.yesterday ? `NT$${x.yesterday.spend.toFixed(2)}` : '—'} | ${x.yesterday?.conversions ?? '—'} |`).join('\n');
const price = x => x.priceMin == null ? '未取得' : x.priceMin === x.priceMax ? `NT$${x.priceMin}` : `NT$${x.priceMin}–${x.priceMax}`;
const launchTable = list => list.map((x,i)=>`| ${i+1} | ${x.productId} | ${short(x.productName)} | ${price(x)} | ${x.conversions} | ${x.roas?.toFixed(2) ?? '—'} | ${x.yesterday ? `${x.yesterday.ctrPct.toFixed(2)}%` : '未下鑽'} | ${i<3?'第一批':'第二批'} |`).join('\n');
const lines=[
  `# ${displayName}｜商品群組單品獨立投放候選`, '',
  `資料區間：${source.range.replace('_to_',' 至 ')}；進行中群組${source.activeGroups}個，成功匹配${source.matchedGroups}個，商品去重後${rows.length}個。`, '',
  '## 值得單開／測試', '',
  '| 排名 | 商品ID | 商品 | 來源群組ID | 曝光 | 點擊 | CTR | 轉換 | 花費 | 營收 | ROAS | 建議 |',
  '|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|', table(candidates), '',
  '## 強候選的昨日商品層驗證', '',
  '| 排名 | 商品ID | 商品 | 昨日曝光 | 昨日點擊 | 昨日CTR | 昨日花費 | 昨日轉換 |',
  '|---:|---:|---|---:|---:|---:|---:|---:|', yesterdayTable(candidates.filter(x=>x.decision==='open_standalone')), '',
  '## 建議單開順序', '',
  '| 順序 | 商品ID | 商品 | 目前價格 | 區間轉換 | 區間ROAS | 昨日CTR | 批次 |',
  '|---:|---:|---|---:|---:|---:|---:|---|', launchTable(launchCandidates), '',
  '## 已有單品廣告的成交商品', '',
  '這些商品已有單品廣告，不重複建立；應比較群組與單品廣告後保留效率較好的入口。', '',
  '| 排名 | 商品ID | 商品 | 來源群組ID | 曝光 | 點擊 | CTR | 轉換 | 花費 | 營收 | ROAS | 建議 |',
  '|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|', table(existing), '',
  '## 單開測試規則', '',
  '- 目前先觀察，不一次性關閉、移出或新建多個廣告。',
  '- 等D+3歸因完成後，第一輪只選1個商品微調；同一批最多3個。',
  '- 每次調整後至少觀察3天，再進行下一批，確保變化能追溯到單一調整。',
  '- 未進入正式測試前，候選商品及原群組保持現狀。',
  '- 若後續啟用單品廣告，再決定是否將該商品移出原群組，避免內部競價與歸因混淆。',
  '- 累積至少1000曝光或10次點擊後判斷CTR；轉換需等待D+3歸因。',
  '- 單開後若只有流量、沒有加購與轉換，先列入待調整清單；是否停止或放回群組需依D+3結果與原群組歷史成效判斷。',
  '- 真正擴量仍需商品成本、平台費和物流成本，以損益平衡ROAS作最後閘門。',
  '- 目前沒有自動建立或修改任何蝦皮廣告。',
];
fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({jsonPath,mdPath,completeness:output.completeness,counts,candidates:candidates.length,existingWinners:existing.length,rejected:rejected.length}));
