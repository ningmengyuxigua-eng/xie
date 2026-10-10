import csv
import json
import sys
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parent
snapshot_date = sys.argv[1] if len(sys.argv) > 1 else "2026-10-08"
source = root / "analysis" / "active-ads" / snapshot_date / "active-group-product-decisions.json"
out_dir = source.parent
data = json.loads(source.read_text(encoding="utf-8"))

selected = [g for g in data["groups"] if g["productAction"] in ("prune_before_group_change", "scale_winners_only")]
rows = []
for group in selected:
    for product in group["products"]:
        spend = float(product.get("spend") or 0)
        revenue = float(product.get("revenue") or 0)
        conversions = int(product.get("conversions") or 0)
        clicks = int(product.get("clicks") or 0)
        roas = round(revenue / spend, 2) if spend else 0
        if conversions > 0 or revenue > 0:
            if group["productAction"] == "scale_winners_only" and conversions >= 2 and roas >= 3:
                action = "scale"
                reason = "至少產生2次轉換且商品ROAS至少3，適合作為群組擴量核心。"
                risk = "放大後點擊成本可能上升；預算每次增加10%至20%並觀察3天。"
            else:
                action = "keep"
                reason = "已產生轉換或營收，先保留以免中斷有效流量。"
                risk = "ROAS未達擴量門檻，保留期間仍需監控成本。"
        elif spend >= 10 or clicks >= 5:
            action = "remove"
            reason = "已有明顯花費或點擊但沒有轉換，優先從群組移除。"
            risk = "可能存在延遲歸因；執行前再次核對最近3天訂單歸因。"
        else:
            action = "observe"
            reason = "目前流量與花費不足，尚不能判定商品效率。"
            risk = "過早移除可能錯失尚未累積足夠曝光的商品。"
        rows.append({
            "adId": group["adId"],
            "adName": group["adName"],
            "groupAction": group["productAction"],
            "productId": product["productId"],
            "productName": product["productName"],
            "action": action,
            "impressions": product["impressions"],
            "clicks": clicks,
            "spend": round(spend, 2),
            "conversions": conversions,
            "revenue": round(revenue, 2),
            "roas": roas,
            "reason": reason,
            "risk": risk,
        })

order = {"remove": 0, "scale": 1, "keep": 2, "observe": 3}
rows.sort(key=lambda x: (x["adId"], order[x["action"]], -x["spend"], -x["revenue"]))
counts = Counter(x["action"] for x in rows)
group_counts = {g["adId"]: Counter(x["action"] for x in rows if x["adId"] == g["adId"]) for g in selected}

output = {
    "generatedAt": data["generatedAt"],
    "storeId": data["storeId"],
    "displayName": data["displayName"],
    "snapshotDate": snapshot_date,
    "sourceRange": data["range"],
    "selectedGroups": len(selected),
    "counts": dict(counts),
    "groups": [{
        "adId": g["adId"],
        "adName": g["adName"],
        "groupAction": g["productAction"],
        "counts": dict(group_counts[g["adId"]]),
    } for g in selected],
    "items": rows,
}
json_path = out_dir / "group-product-action-list.json"
csv_path = out_dir / "group-product-action-list.csv"
md_path = out_dir / "group-product-action-list.md"
json_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

fields = ["adId", "adName", "groupAction", "productId", "productName", "action", "impressions", "clicks", "spend", "conversions", "revenue", "roas", "reason", "risk"]
with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

labels = {"remove": "移除", "scale": "擴量", "keep": "保留", "observe": "觀察"}
lines = [
    "# 拾味廚房雜貨鋪重點廣告群組商品清單",
    "",
    f"狀態快照：{snapshot_date}；商品成效區間：2026-09-08至2026-10-07。",
    "",
    f"群組：{len(selected)}個；商品：{len(rows)}個；擴量{counts['scale']}個、保留{counts['keep']}個、移除{counts['remove']}個、觀察{counts['observe']}個。",
]
for group in selected:
    group_rows = [x for x in rows if x["adId"] == group["adId"]]
    lines += [
        "",
        f"## {group['adId']}｜{group['adName']}",
        "",
        f"群組策略：{group['productAction']}。",
        "",
        "| 分類 | 商品ID | 商品 | 花費 | 營收 | ROAS | 點擊 | 轉換 | 理由 | 風險 |",
        "|---|---|---|---:|---:|---:|---:|---:|---|---|",
    ]
    for item in group_rows:
        name = item["productName"].replace("|", "/")
        lines.append(
            f"| {labels[item['action']]} | {item['productId']} | {name} | {item['spend']:.2f} | "
            f"{item['revenue']:.2f} | {item['roas']:.2f} | {item['clicks']} | {item['conversions']} | "
            f"{item['reason']} | {item['risk']} |"
        )
lines += [
    "",
    "## 執行規則",
    "",
    "- 移除項目執行前，重新核對最近3天延遲歸因。",
    "- 擴量項目每次只增加10%至20%，至少觀察3天再調整。",
    "- 本清單沒有自動修改蝦皮廣告。",
]
md_path.write_text("\n".join(lines), encoding="utf-8")

print(json.dumps({
    "jsonPath": str(json_path),
    "csvPath": str(csv_path),
    "mdPath": str(md_path),
    "selectedGroups": len(selected),
    "productRows": len(rows),
    "counts": dict(counts),
}, ensure_ascii=False))
