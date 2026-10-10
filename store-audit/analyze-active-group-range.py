import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

root = Path(__file__).resolve().parent
store_id = "27857268786685"
snapshot_date = sys.argv[1] if len(sys.argv) > 1 else "2026-10-07"
source = root / "backfill" / "raw" / "ads" / "2026-09_to_2026-10" / "shopee-ads-all-groups-2026-09-08_2026-10-07.csv"
decisions_path = root / "analysis" / "active-ads" / snapshot_date / "active-ad-decisions.json"
out_dir = root / "analysis" / "active-ads" / snapshot_date

def number(value):
    text = str(value or "").replace(",", "").replace("NT$", "").replace("%", "").strip()
    if text in ("", "-"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0

with source.open("r", encoding="utf-8-sig", newline="") as handle:
    rows = [row for row in csv.reader(handle) if any(cell.strip() for cell in row)]
header_index = max(range(min(20, len(rows))), key=lambda i: len(rows[i]))
header = rows[header_index]
records = [dict(zip(header, row + [""] * (len(header) - len(row)))) for row in rows[header_index + 1:]]

decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
active_groups = [x for x in decisions["allItems"] if x["adType"] == "manual_mpd"]
by_name = defaultdict(list)
for item in active_groups:
    by_name[item["adName"]].append(item)

groups = []
current = None
for row in records:
    product_id = row.get("商品 ID", "").strip()
    name = row.get("廣告/商品名稱", "").strip()
    if product_id in ("", "-"):
        current = None
        matches = by_name.get(name, [])
        if len(matches) == 1:
            current = {
                "adId": matches[0]["adId"],
                "adName": name,
                "parentDecision": matches[0]["status"],
                "parentPriority": matches[0]["priority"],
                "header": row,
                "products": [],
            }
            groups.append(current)
    elif current is not None:
        current["products"].append({
            "productId": product_id,
            "productName": name,
            "impressions": int(number(row.get("瀏覽數"))),
            "clicks": int(number(row.get("點擊數"))),
            "conversions": int(number(row.get("轉換數"))),
            "salesCount": int(number(row.get("銷售數"))),
            "spend": number(row.get("花費")),
            "revenue": number(row.get("銷售金額")),
        })

for group in groups:
    products = group["products"]
    totals = {
        "impressions": sum(x["impressions"] for x in products),
        "clicks": sum(x["clicks"] for x in products),
        "conversions": sum(x["conversions"] for x in products),
        "salesCount": sum(x["salesCount"] for x in products),
        "spend": round(sum(x["spend"] for x in products), 2),
        "revenue": round(sum(x["revenue"] for x in products), 2),
    }
    totals["roas"] = round(totals["revenue"] / totals["spend"], 2) if totals["spend"] else 0
    contributors = sorted(
        [x for x in products if x["conversions"] > 0 or x["revenue"] > 0],
        key=lambda x: (x["revenue"], x["conversions"]), reverse=True,
    )
    waste = sorted(
        [x for x in products if x["conversions"] == 0 and x["revenue"] == 0 and (x["spend"] >= 10 or x["clicks"] >= 5)],
        key=lambda x: (x["spend"], x["clicks"]), reverse=True,
    )
    contributor_revenue = sum(x["revenue"] for x in contributors)
    top_share = round(contributors[0]["revenue"] / contributor_revenue, 4) if contributors and contributor_revenue else 0
    decision = group["parentDecision"]
    if decision in ("pause_candidate", "reduce_candidate") and contributors:
        product_action = "prune_before_group_change"
        reason = "群組內仍有成交商品，先移除高花費無轉換商品，再決定是否調整整組。"
        risk = "直接停掉整組會同時失去仍在成交的商品流量。"
    elif decision in ("pause_candidate", "reduce_candidate"):
        product_action = "group_pause_confirmed" if totals["spend"] >= 50 else "insufficient_product_spend"
        reason = "商品層沒有成交貢獻；已有足夠花費時可列為整組暫停候選。"
        risk = "區間報表仍可能受延遲歸因及已刪除廣告省略影響。"
    elif decision == "scale_candidate" and contributors:
        product_action = "scale_winners_only"
        reason = "群組內已有成交商品，擴量應優先保留貢獻商品並限制無轉換商品。"
        risk = "若營收高度集中於單一商品，整組加預算可能把花費分配到低效商品。"
    else:
        product_action = "observe_or_optimize"
        reason = "依商品層花費與轉換繼續觀察，優先處理高花費無轉換商品。"
        risk = "樣本不足時過早移除商品可能造成誤判。"
    group["totals"] = totals
    group["productAction"] = product_action
    group["reason"] = reason
    group["risk"] = risk
    group["topContributorRevenueShare"] = top_share
    group["contributors"] = contributors[:10]
    group["wasteCandidates"] = waste[:10]
    group.pop("header", None)

groups.sort(key=lambda x: (-x["parentPriority"], -x["totals"]["spend"]))
counts = defaultdict(int)
for group in groups:
    counts[group["productAction"]] += 1

missing = [x["adId"] for x in active_groups if x["adId"] not in {g["adId"] for g in groups}]
output = {
    "generatedAt": decisions["generatedAt"],
    "storeId": store_id,
    "displayName": "拾味廚房雜貨鋪",
    "range": "2026-09-08_to_2026-10-07",
    "sourceGranularity": "range_product_aggregate",
    "activeGroups": len(active_groups),
    "matchedGroups": len(groups),
    "missingGroups": missing,
    "counts": dict(counts),
    "groups": groups,
}
json_path = out_dir / "active-group-product-decisions.json"
md_path = out_dir / "active-group-product-decisions.md"
json_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

lines = [
    "# 拾味廚房雜貨鋪進行中廣告群組商品層決策",
    "",
    f"30天區間：2026-09-08至2026-10-07；進行中群組{len(active_groups)}個，成功匹配{len(groups)}個。",
    "",
    "## 群組決策",
    "",
    "| 廣告ID | 群組 | 原判斷 | 商品層建議 | 商品數 | 花費 | 營收 | ROAS | 成交商品 | 高花費無轉換商品 | 理由 | 風險 |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|",
]
for group in groups[:20]:
    safe_name = group["adName"].replace("|", "/")
    lines.append(
        f"| {group['adId']} | {safe_name} | {group['parentDecision']} | {group['productAction']} | "
        f"{len(group['products'])} | {group['totals']['spend']:.2f} | {group['totals']['revenue']:.2f} | "
        f"{group['totals']['roas']:.2f} | {len(group['contributors'])} | {len(group['wasteCandidates'])} | "
        f"{group['reason']} | {group['risk']} |"
    )
lines += [
    "",
    "## 限制",
    "",
    "- 商品資料是30天區間合計，不拆成虛構每日商品數據。",
    "- 蝦皮可能省略刪除超過14天的廣告或已移除商品。",
    "- 未取得成本及平台費用，擴量或停投仍需人工確認。",
]
md_path.write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({
    "jsonPath": str(json_path),
    "mdPath": str(md_path),
    "activeGroups": len(active_groups),
    "matchedGroups": len(groups),
    "missingGroups": len(missing),
    "counts": dict(counts),
}, ensure_ascii=False))
