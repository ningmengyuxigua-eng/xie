import csv
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

overall_path = Path(sys.argv[1])
groups_path = Path(sys.argv[2])
out_dir = Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)

def load(path):
    raw = path.read_bytes()
    rows = [row for row in csv.reader(raw.decode("utf-8-sig").splitlines()) if any(c.strip() for c in row)]
    header_index = max(range(min(20, len(rows))), key=lambda i: len(rows[i]))
    header = rows[header_index]
    data = [dict(zip(header, row + [""] * (len(header) - len(row)))) for row in rows[header_index + 1:]]
    metadata = {row[0]: row[1] for row in rows[:header_index] if len(row) >= 2}
    return raw, metadata, data

def number(value):
    text = str(value or "").replace(",", "").replace("NT$", "").replace("%", "").strip()
    if text in ("", "-"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0

overall_raw, overall_meta, overall = load(overall_path)
groups_raw, groups_meta, groups = load(groups_path)

def totals(rows):
    return {
        "impressions": int(sum(number(r.get("瀏覽數")) for r in rows)),
        "clicks": int(sum(number(r.get("點擊數")) for r in rows)),
        "conversions": int(sum(number(r.get("轉換數")) for r in rows)),
        "salesCount": int(sum(number(r.get("銷售數")) for r in rows)),
        "spend": round(sum(number(r.get("花費")) for r in rows), 2),
        "revenue": round(sum(number(r.get("銷售金額")) for r in rows), 2),
    }

ad_totals = totals(overall)
ad_totals["ctr"] = round(ad_totals["clicks"] / ad_totals["impressions"], 4) if ad_totals["impressions"] else 0
ad_totals["roas"] = round(ad_totals["revenue"] / ad_totals["spend"], 2) if ad_totals["spend"] else 0

ad_rows = []
for row in overall:
    spend = number(row.get("花費"))
    revenue = number(row.get("銷售金額"))
    conversions = int(number(row.get("轉換數")))
    ad_rows.append({
        "name": row.get("廣告名稱", ""), "status": row.get("狀態", ""), "type": row.get("廣告類型", ""),
        "productId": row.get("商品 ID", ""), "impressions": int(number(row.get("瀏覽數"))),
        "clicks": int(number(row.get("點擊數"))), "conversions": conversions,
        "spend": round(spend, 2), "revenue": round(revenue, 2),
        "roas": round(revenue / spend, 2) if spend else 0,
    })

product_rows = [row for row in groups if re.fullmatch(r"\d+", str(row.get("商品 ID", "")).strip())]
products = defaultdict(lambda: {"name": "", "impressions": 0, "clicks": 0, "conversions": 0, "salesCount": 0, "spend": 0.0, "revenue": 0.0, "rowCount": 0})
for row in product_rows:
    pid = str(row["商品 ID"]).strip()
    item = products[pid]
    item["name"] = row.get("廣告/商品名稱", "") or item["name"]
    item["impressions"] += int(number(row.get("瀏覽數")))
    item["clicks"] += int(number(row.get("點擊數")))
    item["conversions"] += int(number(row.get("轉換數")))
    item["salesCount"] += int(number(row.get("銷售數")))
    item["spend"] += number(row.get("花費"))
    item["revenue"] += number(row.get("銷售金額"))
    item["rowCount"] += 1

product_items = []
for pid, item in products.items():
    item.update({"productId": pid, "spend": round(item["spend"], 2), "revenue": round(item["revenue"], 2)})
    item["roas"] = round(item["revenue"] / item["spend"], 2) if item["spend"] else 0
    product_items.append(item)

summary = {
    "storeId": "27857268786685",
    "displayName": overall_meta.get("賣場名稱", "拾味廚房雜貨鋪"),
    "marketplaceShopId": overall_meta.get("賣場ID"),
    "range": overall_meta.get("期間"),
    "exportedAt": overall_meta.get("報表匯出時間"),
    "sourceGranularity": "range_aggregate",
    "dailyGranularityAvailable": False,
    "sources": [
        {"path": str(overall_path), "sha256": hashlib.sha256(overall_raw).hexdigest(), "rows": len(overall)},
        {"path": str(groups_path), "sha256": hashlib.sha256(groups_raw).hexdigest(), "rows": len(groups)},
    ],
    "adLevel": {
        "rows": len(overall), "statusCounts": dict(Counter(r.get("狀態", "") for r in overall)),
        "adsWithSpend": sum(1 for r in ad_rows if r["spend"] > 0),
        "adsWithConversion": sum(1 for r in ad_rows if r["conversions"] > 0),
        "totals": ad_totals,
    },
    "productLevel": {
        "sourceRows": len(product_rows), "distinctProducts": len(products),
        "productsWithSpend": sum(1 for x in product_items if x["spend"] > 0),
        "productsWithConversion": sum(1 for x in product_items if x["conversions"] > 0),
    },
    "topSpendNoConversion": sorted([x for x in product_items if x["spend"] > 0 and x["conversions"] == 0], key=lambda x: x["spend"], reverse=True)[:20],
    "topRevenueProducts": sorted([x for x in product_items if x["revenue"] > 0], key=lambda x: x["revenue"], reverse=True)[:20],
    "topAdSpendNoConversion": sorted([x for x in ad_rows if x["spend"] > 0 and x["conversions"] == 0], key=lambda x: x["spend"], reverse=True)[:20],
}

json_path = out_dir / "range-summary.json"
json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

def short(text):
    return " ".join(str(text).split()[:4])

lines = [
    f"# {summary['displayName']}｜30天廣告匯出初步摘要", "",
    f"- 期間：{summary['range']}",
    f"- 匯出時間：{summary['exportedAt']}",
    "- 粒度：30天區間合計；報表沒有每日日期欄，不能當作每日趨勢資料。",
    f"- 廣告層：{summary['adLevel']['rows']}筆；有花費{summary['adLevel']['adsWithSpend']}筆；有轉換{summary['adLevel']['adsWithConversion']}筆。",
    f"- 合計：曝光{ad_totals['impressions']:,}、點擊{ad_totals['clicks']:,}、花費NT${ad_totals['spend']:,.2f}、銷售額NT${ad_totals['revenue']:,.2f}、ROAS {ad_totals['roas']:.2f}。",
    f"- 商品層：{summary['productLevel']['distinctProducts']}個不同商品；實際有花費{summary['productLevel']['productsWithSpend']}個；有轉換{summary['productLevel']['productsWithConversion']}個。",
    "", "## 高花費但零轉換商品（前20）", "",
    "| 商品ID | 商品 | 花費 | 曝光 | 點擊 |", "|---|---|---:|---:|---:|",
]
for item in summary["topSpendNoConversion"]:
    lines.append(f"| {item['productId']} | {short(item['name'])} | NT${item['spend']:.2f} | {item['impressions']} | {item['clicks']} |")
lines += ["", "## 限制", "", "- 報表是區間合計，只能做30天總體與商品排行。", "- 每日趨勢仍需逐日匯出或逐日頁面回填。", "- 超過14天前已刪除的廣告，以及從廣告移除超過14天的商品，官方報表可能不包含。", "- 沒有商品成本，因此不判定盈利。", ""]
md_path = out_dir / "range-summary.md"
md_path.write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({"json": str(json_path), "markdown": str(md_path), "adRows": len(overall), "productRows": len(product_rows), "productsWithSpend": summary["productLevel"]["productsWithSpend"], "totals": ad_totals}, ensure_ascii=True))
