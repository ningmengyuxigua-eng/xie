const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node evaluate-group-products.cjs YYYY-MM-DD');

const storeId = '27857268786685';
const ruleVersion = '1.0.0-draft';
const outDir = path.join(root, 'ad-daily', metricDate);
const checkpoint = JSON.parse(fs.readFileSync(path.join(outDir, 'groups', 'checkpoint.json'), 'utf8').replace(/^\uFEFF/, ''));
if (checkpoint.status !== 'complete') throw new Error('Target group checkpoint is not complete');
const targets = checkpoint.targetGroups.map(String);
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const groupQuery = db.prepare(`
  SELECT f.*, m.ad_name
  FROM ad_daily_fact f JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=? AND f.ad_id=?
`);
const productQuery = db.prepare(`
  SELECT * FROM ad_product_daily_fact
  WHERE store_id=? AND metric_date=? AND ad_id=?
  ORDER BY spend DESC, clicks DESC, impressions DESC
`);
const upsert = db.prepare(`
  INSERT INTO ad_evaluation(
    store_id, metric_date, ad_id, product_id_or_zero, rule_version,
    evaluation_status, priority, evidence_json, recommendation,
    requires_human_action, evaluated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id, metric_date, ad_id, product_id_or_zero, rule_version) DO UPDATE SET
    evaluation_status=excluded.evaluation_status, priority=excluded.priority,
    evidence_json=excluded.evidence_json, recommendation=excluded.recommendation,
    requires_human_action=excluded.requires_human_action, evaluated_at=excluded.evaluated_at
`);

function classify(row, group) {
  const spendShare = group.spend > 0 ? row.spend / group.spend : 0;
  const evidence = {
    impressions: row.impressions, clicks: row.clicks, ctr: row.ctr,
    spend: row.spend, spendShare, conversions: row.conversions,
    revenue: row.revenue, roas: row.roas, dataStatus: row.data_status,
    profitability: 'unavailable_without_cost',
  };
  if (row.conversions > 0 || row.revenue > 0) {
    return ['effective_product_contributor', 2, '此商品產生群組銷售；核對毛利後保留並觀察 7 日穩定性', evidence, false];
  }
  if (row.clicks >= 5) {
    return ['product_clicks_no_conversion', row.clicks >= 10 ? 5 : 4, '商品已有多次點擊但無轉換；檢查售價、優惠、主圖與商品頁', evidence, true];
  }
  if (row.spend >= 3 && spendShare >= 0.25) {
    return ['product_spend_concentration_no_conversion', 3, '商品占群組花費較高但無轉換；繼續累積至警告門檻並檢查商品頁', evidence, true];
  }
  if (row.impressions >= 200 && row.clicks === 0) {
    return ['product_high_impressions_no_click', 3, '曝光較高但無點擊；優先檢查主圖與標題', evidence, true];
  }
  return ['observe_product_low_sample', 1, '單日樣本不足，繼續觀察', evidence, false];
}

const now = new Date().toISOString();
const groups = [];
const actions = [];
const contributors = [];
db.exec('BEGIN IMMEDIATE');
try {
  for (const adId of targets) {
    const group = groupQuery.get(storeId, metricDate, adId);
    if (!group) throw new Error(`Missing ad-level row for ${adId}`);
    const products = productQuery.all(storeId, metricDate, adId);
    const totals = products.reduce((sum, row) => ({
      impressions: sum.impressions + row.impressions,
      clicks: sum.clicks + row.clicks,
      spend: sum.spend + row.spend,
      conversions: sum.conversions + row.conversions,
      revenue: sum.revenue + row.revenue,
    }), { impressions: 0, clicks: 0, spend: 0, conversions: 0, revenue: 0 });
    const reconciliation = {
      adListImpressions: group.impressions,
      productExactImpressions: totals.impressions,
      impressionsStatus: totals.impressions === group.impressions
        ? 'exact'
        : (group.impressions >= 1000 && Math.abs(totals.impressions - group.impressions) <= 50 ? 'consistent_with_rounded_k_display' : 'mismatch'),
      clicksMatch: totals.clicks === group.clicks,
      conversionsMatch: totals.conversions === group.conversions,
      adListSpend: group.spend,
      productExactSpend: Number(totals.spend.toFixed(2)),
      adListRevenue: group.revenue,
      productExactRevenue: Number(totals.revenue.toFixed(2)),
    };
    const summary = { adId, adName: group.ad_name, productRows: products.length, adLevel: group, productTotals: totals, reconciliation };
    groups.push(summary);
    for (const row of products) {
      const [status, priority, recommendation, evidence, action] = classify(row, totals);
      upsert.run(storeId, metricDate, adId, row.product_id, ruleVersion, status, priority, JSON.stringify(evidence), recommendation, action ? 1 : 0, now);
      const item = { adId, adName: group.ad_name, productId: row.product_id, productName: row.product_name, status, priority, recommendation, evidence };
      if (action) actions.push(item);
      if (status === 'effective_product_contributor') contributors.push(item);
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();

actions.sort((a, b) => b.priority - a.priority || b.evidence.spend - a.evidence.spend);
contributors.sort((a, b) => b.evidence.revenue - a.evidence.revenue || b.evidence.roas - a.evidence.roas);
const output = {
  generatedAt: now, storeId, metricDate, ruleVersion,
  scope: 'target_group_product_daily', profitabilityStatus: 'unavailable_without_cost',
  completeness: { targetGroups: targets.length, completedGroups: groups.length, productRows: groups.reduce((n, g) => n + g.productRows, 0) },
  groups: groups.map((g) => ({ adId: g.adId, adName: g.adName, productRows: g.productRows, productTotals: g.productTotals, reconciliation: g.reconciliation })),
  actionItems: actions.slice(0, 20),
  effectiveContributors: contributors.slice(0, 20),
};
fs.writeFileSync(path.join(outDir, 'group-product-evaluation.json'), JSON.stringify(output, null, 2));

const money = (v) => Number(v || 0).toFixed(2);
const taipeiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isCurrentDay = metricDate === taipeiDate;
const lines = [
  `# ${metricDate} 目標廣告群組商品層分析`, '',
  `- 已完成群組：${groups.length}/${targets.length}`,
  `- 商品日資料：${output.completeness.productRows} 筆`,
  `- 需優先檢查商品：${actions.length} 筆，報告最多列 20 筆`,
  `- 有效銷售貢獻商品：${contributors.length} 筆`, '',
  '## 群組核對', '',
  '| 廣告 ID | 群組 | 商品數 | 曝光核對 | 點擊核對 | 轉換核對 | 商品精確花費 | 商品精確銷售額 |',
  '|---|---|---:|---|---|---|---:|---:|',
  ...groups.map((g) => `| ${g.adId} | ${g.adName} | ${g.productRows} | ${g.reconciliation.impressionsStatus === 'exact' ? '一致' : g.reconciliation.impressionsStatus === 'consistent_with_rounded_k_display' ? '一致（列表千位縮寫）' : '不一致'} | ${g.reconciliation.clicksMatch ? '一致' : '不一致'} | ${g.reconciliation.conversionsMatch ? '一致' : '不一致'} | NT$${money(g.productTotals.spend)} | NT$${money(g.productTotals.revenue)} |`),
  '', '## 優先檢查商品', '',
  ...output.actionItems.map((x) => `- ${x.adId} / ${x.productId}｜${x.productName}｜${x.status}｜曝光 ${x.evidence.impressions}、點擊 ${x.evidence.clicks}、花費 NT$${money(x.evidence.spend)}、銷售額 NT$${money(x.evidence.revenue)}。${x.recommendation}`),
  '', '## 有效貢獻商品', '',
  ...output.effectiveContributors.map((x) => `- ${x.adId} / ${x.productId}｜${x.productName}｜轉換 ${x.evidence.conversions}、花費 NT$${money(x.evidence.spend)}、銷售額 NT$${money(x.evidence.revenue)}、ROAS ${Number(x.evidence.roas || 0).toFixed(2)}。${x.recommendation}`),
  '', '## 判斷限制', '',
  `- ${isCurrentDay ? '當日暫定資料' : 'D-1 資料'}仍可能有延遲歸因，需於 D-3 回補。`,
  '- 沒有成本資料，因此不判定盈利，也不自動刪除商品或調整群組。',
];
fs.writeFileSync(path.join(outDir, 'group-product-report.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ groups: groups.length, productRows: output.completeness.productRows, actionItems: actions.length, contributors: contributors.length, reportItems: output.actionItems.length }));
