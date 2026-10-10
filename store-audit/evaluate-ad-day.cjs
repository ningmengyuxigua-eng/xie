const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const metricDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate || '')) throw new Error('Usage: node evaluate-ad-day.cjs YYYY-MM-DD');

const storeId = '27857268786685';
const ruleVersion = '1.0.0-draft';
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const outDir = path.join(root, 'ad-daily', metricDate);
const checkpointPath = path.join(outDir, 'ad-level-checkpoint.json');
const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8').replace(/^\uFEFF/, '')) : null;
const rows = db.prepare(`
  SELECT f.*, m.ad_name, m.ad_type, m.target_roas, m.product_id
  FROM ad_daily_fact f
  JOIN ad_master m ON m.store_id=f.store_id AND m.ad_id=f.ad_id
  WHERE f.store_id=? AND f.metric_date=?
`).all(storeId, metricDate);
const activeMasterRows = Number(db.prepare(`SELECT COUNT(*) AS count FROM ad_master WHERE store_id=? AND current_status='進行中'`).get(storeId).count);
const expectedActiveAds = checkpoint?.status === 'complete' && Number.isFinite(Number(checkpoint.totalDatabaseRows))
  ? Number(checkpoint.totalDatabaseRows) : activeMasterRows;
const staleActiveMasterRows = Math.max(0, activeMasterRows - rows.length);
const isComplete = checkpoint?.status === 'complete' && rows.length === expectedActiveAds;

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const medians = Object.fromEntries([...new Set(rows.map((row) => row.ad_type))].map((type) => [
  type,
  median(rows.filter((row) => row.ad_type === type && row.impressions >= 200).map((row) => row.ctr)),
]));

function evaluate(row) {
  const evidence = {
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    spend: row.spend,
    conversions: row.conversions,
    revenue: row.revenue,
    roas: row.roas,
    targetRoas: row.target_roas,
    typeMedianCtr: medians[row.ad_type],
    dataStatus: row.data_status,
    profitability: 'unavailable_without_cost',
  };

  if (row.ad_type === 'single_product' && !row.product_id) {
    return ['mapping_issue', 5, '補齊廣告與商品 ID 映射後再判斷', evidence, true];
  }
  if (row.impressions === 0) {
    return ['observe_zero_impression_day_1', 2, '等待第二個完整日；連續兩日無曝光再查投放', evidence, false];
  }
  if (row.conversions > 0) {
    if (row.target_roas > 0 && row.roas >= row.target_roas) {
      return ['effective_scale_candidate', 1, '效果高於廣告目標；核對毛利後再考慮增加預算', evidence, true];
    }
    if (row.target_roas > 0 && row.roas >= row.target_roas * 0.8) {
      return ['effective_hold', 1, '接近目標，維持並觀察完成歸因結果', evidence, false];
    }
    return ['conversion_below_target', 3, '已有轉換但低於目標 ROAS；結合近 7 天及成本判斷', evidence, false];
  }
  if (row.clicks >= 20) {
    return ['clicks_no_conversion', 5, '點擊已達高優先門檻；檢查價格、促銷與商品頁', evidence, true];
  }
  if (row.clicks >= 15) {
    return ['clicks_no_conversion', 4, '點擊達警告門檻但無轉換；暫不自動停用', evidence, true];
  }
  const typeMedian = medians[row.ad_type];
  if (row.impressions >= 200 && typeMedian && row.ctr < typeMedian * 0.5) {
    return ['low_ctr', 3, 'CTR 低於同類廣告中位數一半；檢查主圖、標題或受眾', evidence, true];
  }
  return ['observe_low_sample', 1, '樣本不足，繼續累積數據', evidence, false];
}

const upsert = db.prepare(`
  INSERT INTO ad_evaluation(
    store_id, metric_date, ad_id, product_id_or_zero, rule_version,
    evaluation_status, priority, evidence_json, recommendation,
    requires_human_action, evaluated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(store_id, metric_date, ad_id, product_id_or_zero, rule_version) DO UPDATE SET
    evaluation_status=excluded.evaluation_status,
    priority=excluded.priority,
    evidence_json=excluded.evidence_json,
    recommendation=excluded.recommendation,
    requires_human_action=excluded.requires_human_action,
    evaluated_at=excluded.evaluated_at
`);

const evaluations = [];
const now = new Date().toISOString();
db.exec('BEGIN IMMEDIATE');
try {
  for (const row of rows) {
    const [status, priority, recommendation, evidence, action] = evaluate(row);
    const productKey = row.product_id || '0';
    upsert.run(storeId, metricDate, row.ad_id, productKey, ruleVersion, status, priority, JSON.stringify(evidence), recommendation, action ? 1 : 0, now);
    evaluations.push({
      adId: row.ad_id,
      adName: row.ad_name,
      adType: row.ad_type,
      productId: row.product_id,
      status,
      priority,
      recommendation,
      evidence,
    });
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const counts = {};
for (const item of evaluations) counts[item.status] = (counts[item.status] || 0) + 1;
const ranked = [...evaluations].sort((a, b) => b.priority - a.priority || b.evidence.spend - a.evidence.spend);
const totals = rows.reduce((sum, row) => ({
  impressions: sum.impressions + (row.impressions || 0),
  clicks: sum.clicks + (row.clicks || 0),
  spend: sum.spend + (row.spend || 0),
  revenue: sum.revenue + (row.revenue || 0),
  conversions: sum.conversions + (row.conversions || 0),
}), { impressions: 0, clicks: 0, spend: 0, revenue: 0, conversions: 0 });
const output = {
  generatedAt: now,
  storeId,
  metricDate,
  ruleVersion,
  scope: isComplete ? 'all_active_ads' : 'partial_active_ads',
  completeness: { collectedRows: rows.length, expectedActiveAds, checkpointStatus: checkpoint?.status || 'missing', activeMasterRows, staleActiveMasterRows },
  profitabilityStatus: 'unavailable_without_cost',
  totals,
  counts,
  actionItems: ranked.filter((item) => item.priority >= 3).slice(0, 20),
  effectiveItems: ranked.filter((item) => item.status === 'effective_scale_candidate').slice(0, 20),
  items: ranked.slice(0, 20),
};
fs.writeFileSync(path.join(outDir, 'ad-evaluation.json'), JSON.stringify(output, null, 2));
db.close();

console.log(JSON.stringify({ scope: output.scope, rows: rows.length, expectedActiveAds, totals, counts, actionItems: output.actionItems.length, effectiveItems: output.effectiveItems.length }));
