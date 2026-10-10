const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const endDate = process.argv[2] || new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('End date must be YYYY-MM-DD');
const requestedStartDate = process.argv[3] || null;
if (requestedStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate)) throw new Error('Start date must be YYYY-MM-DD');

const storeId = '27857268786685';
const profile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'store-profile.json'), 'utf8'));
const db = new DatabaseSync(path.join(root, 'db', 'store-audit.sqlite'));
const day = (text) => new Date(`${text}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const end = day(endDate);
const start = requestedStartDate ? day(requestedStartDate) : new Date(end);
if (!requestedStartDate) start.setUTCDate(start.getUTCDate() - 29);
if (start > end) throw new Error('Start date must not be after end date');

const jobs = [];
for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const metricDate = iso(cursor);
  const checkpointPath = path.join(root, 'ad-daily', metricDate, 'ad-level-checkpoint.json');
  const checkpoint = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8').replace(/^\uFEFF/, '')) : null;
  const rows = db.prepare(`SELECT COUNT(*) AS n FROM ad_daily_fact WHERE store_id=? AND metric_date=?`).get(storeId, metricDate).n;
  const exportManifest = db.prepare(`
    SELECT row_count FROM backfill_manifest
    WHERE store_id=? AND module='advertising' AND period_start=? AND period_end=?
      AND source_granularity='daily_export' AND status='complete'
    ORDER BY imported_at DESC LIMIT 1
  `).get(storeId, metricDate, metricDate);
  const exportRows = exportManifest?.row_count || 0;
  const completeFromUi = checkpoint?.status === 'complete' && rows > 0;
  const completeFromExport = Boolean(exportManifest);
  jobs.push({
    sequence: jobs.length + 1,
    metricDate,
    module: 'ad_level_daily',
    maxPages: 20,
    maxRowsPerPage: 20,
    status: completeFromUi || completeFromExport ? 'complete' : 'pending',
    source: completeFromExport ? 'daily_export' : (completeFromUi ? 'daily_ui' : null),
    savedRows: rows,
    stagedExportRows: exportRows,
    lastCompletedPage: checkpoint?.lastCompletedPage || 0,
    checkpointPath: path.relative(root, checkpointPath).replaceAll('\\', '/'),
  });
}

const weeks = [];
for (let cursor = new Date(start); cursor <= end;) {
  const windowStart = new Date(cursor);
  const windowEnd = new Date(cursor); windowEnd.setUTCDate(windowEnd.getUTCDate() + 6);
  if (windowEnd > end) windowEnd.setTime(end.getTime());
  weeks.push({
    sequence: weeks.length + 1,
    rangeStart: iso(windowStart),
    rangeEnd: iso(windowEnd),
    module: 'selected_group_product_range',
    status: 'blocked_until_ad_level_complete',
    selection: 'Only groups selected by 30-day spend, conversion and anomaly summary; maximum 6 groups or 20 pages per run.',
  });
  cursor = new Date(windowEnd); cursor.setUTCDate(cursor.getUTCDate() + 1);
}

const output = {
  generatedAt: new Date().toISOString(),
  storeId,
  displayName: profile.displayName,
  rangeStart: iso(start),
  rangeEnd: endDate,
  days: jobs.length,
  strategy: 'export_first_then_daily_ui_fallback',
  limits: { maxPagesPerRun: 20, maxRowsPerPage: 20, concurrentBrowserJobs: 1, maxSameErrorRetries: 3 },
  stage0: {
    name: 'source_capability_probe',
    instructions: 'First test whether Shopee ad export provides daily rows for the selected 30-day range. Preserve source granularity and never fabricate daily rows from a range total.',
  },
  stage1AdLevelDaily: {
    estimatedRowsAtCurrentScale: 126 * jobs.length,
    estimatedUiPagesAtCurrentScale: 7 * jobs.length,
    completeDays: jobs.filter((job) => job.status === 'complete').length,
    pendingDays: jobs.filter((job) => job.status === 'pending').length,
    jobs,
  },
  stage2SelectedProductDrilldown: {
    reason: 'A full browser drilldown at today scale would be about 93 pages per day, so it is not the default backfill path.',
    windows: weeks,
  },
  modelReadContract: {
    defaultRows: 20,
    thirtyDayInput: '30 daily summary rows plus at most 20 anomalies',
    rawJsonInConversation: false,
  },
};

const outDir = path.join(root, 'backfill', 'ads', requestedStartDate ? `${requestedStartDate}_to_${endDate}` : endDate);
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'plan.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
db.close();
console.log(JSON.stringify({ outPath, rangeStart: output.rangeStart, rangeEnd: output.rangeEnd, completeDays: output.stage1AdLevelDaily.completeDays, pendingDays: output.stage1AdLevelDaily.pendingDays, estimatedUiPages: output.stage1AdLevelDaily.estimatedUiPagesAtCurrentScale, productDrilldownWindows: weeks.length }));
