import csv
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
raw = path.read_bytes()
text = None
encoding = None
for candidate in ("utf-8-sig", "utf-16", "big5", "cp950"):
    try:
        decoded = raw.decode(candidate)
        if "\x00" not in decoded[:200]:
            text = decoded
            encoding = candidate
            break
    except UnicodeDecodeError:
        pass
if text is None:
    raise SystemExit("Unsupported CSV encoding")

sample = text[:8192]
try:
    dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
except csv.Error:
    dialect = csv.excel
rows = list(csv.reader(text.splitlines(), dialect))
nonempty = [row for row in rows if any(str(cell).strip() for cell in row)]
header_index = max(range(min(20, len(nonempty))), key=lambda i: len(nonempty[i])) if nonempty else 0
header = [str(cell).strip() for cell in nonempty[header_index]] if nonempty else []
data = nonempty[header_index + 1:]

date_pattern = re.compile(r"^(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})$")
date_columns = []
for index, name in enumerate(header):
    values = [row[index].strip() for row in data[:500] if index < len(row) and row[index].strip()]
    matches = sorted({value for value in values if date_pattern.match(value)})
    if matches or any(token in name.lower() for token in ("date", "日期", "時間")):
        date_columns.append({"index": index, "name": name, "sampleValues": matches[:10]})

result = {
    "path": str(path),
    "bytes": len(raw),
    "encoding": encoding,
    "delimiter": dialect.delimiter,
    "nonemptyRows": len(nonempty),
    "headerIndex": header_index,
    "columnCount": len(header),
    "headers": header,
    "dateColumns": date_columns,
    "hasDailyGranularity": any(item["sampleValues"] for item in date_columns),
    "firstDataRows": data[:3],
}
print(json.dumps(result, ensure_ascii=True, indent=2))
