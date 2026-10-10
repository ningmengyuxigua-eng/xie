import csv
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
source = Path(sys.argv[1]).resolve()
metric_date = sys.argv[2]
if len(metric_date) != 10:
    raise SystemExit("Usage: import-ad-daily-export.py CSV YYYY-MM-DD")
store_id = "27857268786685"
raw = source.read_bytes()
source_hash = hashlib.sha256(raw).hexdigest()
rows = [row for row in csv.reader(raw.decode("utf-8-sig").splitlines()) if any(c.strip() for c in row)]
header_index = max(range(min(20, len(rows))), key=lambda i: len(rows[i]))
header = rows[header_index]
data = [dict(zip(header, row + [""] * (len(header) - len(row)))) for row in rows[header_index + 1:]]

def number(value):
    text = str(value or "").replace(",", "").replace("NT$", "").replace("%", "").strip()
    if text in ("", "-"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0

db = sqlite3.connect(root / "db" / "store-audit.sqlite")
now = datetime.now(timezone.utc).isoformat()
match_counts = {"matched_unique_name": 0, "unmatched": 0, "ambiguous": 0}
inserted = 0
updated = 0
duplicates = 0
for row_number, row in enumerate(data, start=1):
    ad_name = row.get("廣告名稱", "").strip()
    matches = db.execute("SELECT ad_id FROM ad_master WHERE store_id=? AND ad_name=?", (store_id, ad_name)).fetchall()
    if len(matches) == 1:
        match_status, matched_ad_id = "matched_unique_name", matches[0][0]
    elif len(matches) > 1:
        match_status, matched_ad_id = "ambiguous", None
    else:
        match_status, matched_ad_id = "unmatched", None
    existing = db.execute("""
      SELECT matched_ad_id,match_status FROM ad_export_daily_staging
      WHERE store_id=? AND metric_date=? AND source_hash=? AND row_number=?
    """, (store_id, metric_date, source_hash, row_number)).fetchone()
    db.execute("""
      INSERT INTO ad_export_daily_staging(
        store_id,metric_date,source_hash,row_number,ad_name,source_status,ad_type,product_id,
        bidding_mode,placement,start_date,end_date,impressions,clicks,add_to_cart,conversions,
        direct_conversions,sales_count,direct_sales_count,revenue,direct_revenue,spend,
        matched_ad_id,match_status,source_path,imported_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(store_id,metric_date,source_hash,row_number) DO UPDATE SET
        matched_ad_id=excluded.matched_ad_id,
        match_status=excluded.match_status,
        imported_at=excluded.imported_at
    """, (
      store_id, metric_date, source_hash, row_number, ad_name, row.get("狀態"), row.get("廣告類型"),
      None if row.get("商品 ID") in (None,"","-") else row.get("商品 ID"), row.get("出價模式"), row.get("版位"),
      row.get("開始日期"), row.get("結束日期"), int(number(row.get("瀏覽數"))), int(number(row.get("點擊數"))),
      int(number(row.get("加入購物車次數"))), int(number(row.get("轉換數"))), int(number(row.get("直接轉換數"))),
      int(number(row.get("銷售數"))), int(number(row.get("直接銷售數"))), number(row.get("銷售金額")),
      number(row.get("直接銷售金額")), number(row.get("花費")), matched_ad_id, match_status, str(source), now,
    ))
    if existing is None:
        inserted += 1
    elif existing[0] != matched_ad_id or existing[1] != match_status:
        updated += 1
    else:
        duplicates += 1
    match_counts[match_status] += 1
    if row_number % 20 == 0:
        db.commit()

db.execute("""
  INSERT OR IGNORE INTO backfill_manifest(
    store_id,module,period_start,period_end,source_granularity,source_path,content_hash,row_count,status,imported_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?)
""", (store_id, "advertising", metric_date, metric_date, "daily_export", str(source), source_hash, len(data), "complete", now))
db.commit()
db.close()
print(json.dumps({"metricDate": metric_date, "sourceHash": source_hash, "rows": len(data), "inserted": inserted, "updated": updated, "duplicates": duplicates, "matches": match_counts}, ensure_ascii=True))
