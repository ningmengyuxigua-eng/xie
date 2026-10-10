from pathlib import Path
from datetime import date
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(r"D:\xiapi\store-audit")
OUT = ROOT / "review"
ASSETS = OUT / "assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)
DOCX = OUT / "拾味廚房雜貨鋪營運決策系統藍圖與原型審核文件-v0.5.docx"

FONT = r"C:\Windows\Fonts\msjh.ttc"
FONT_B = r"C:\Windows\Fonts\msjhbd.ttc"
if not Path(FONT_B).exists():
    FONT_B = FONT

NAVY = "17365D"
BLUE = "2F75B5"
PALE_BLUE = "DDEBF7"
PALE_GREEN = "E2F0D9"
PALE_ORANGE = "FCE4D6"
PALE_GRAY = "F2F2F2"
MID_GRAY = "666666"
BORDER = "D9D9D9"
BLACK = "000000"
WHITE = "FFFFFF"

def font(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)

def rounded(draw, box, fill, outline="#A6A6A6", width=3, radius=22):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def arrow(draw, p1, p2, color="#5B6573", width=5):
    draw.line([p1, p2], fill=color, width=width)
    import math
    ang = math.atan2(p2[1]-p1[1], p2[0]-p1[0])
    ln = 18
    for delta in (2.55, -2.55):
        q = (p2[0] + ln*math.cos(ang+delta), p2[1] + ln*math.sin(ang+delta))
        draw.line([p2, q], fill=color, width=width)

def center_text(draw, box, text, size=30, bold=False, fill="#1F1F1F", spacing=8):
    f = font(size, bold)
    lines = text.split("\n")
    heights = [draw.textbbox((0, 0), x, font=f)[3] for x in lines]
    total = sum(heights) + spacing*(len(lines)-1)
    y = box[1] + (box[3]-box[1]-total)/2
    for line, h in zip(lines, heights):
        bbox = draw.textbbox((0, 0), line, font=f)
        x = box[0] + (box[2]-box[0]-(bbox[2]-bbox[0]))/2
        draw.text((x, y), line, font=f, fill=fill)
        y += h + spacing

def make_architecture(path):
    im = Image.new("RGB", (1600, 1050), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 35), "系統總體架構", font=font(42, True), fill="#111111")
    rows = [
        ("資料來源", ["商品與規格", "進行中廣告", "促銷活動", "已出貨訂單"]),
        ("分批採集", ["紫鳥店鋪瀏覽器", "每批最多 20 筆", "頁碼與 checkpoint", "失敗保留進度"]),
        ("本機資料層", ["原始快照按日期保存", "SQLite 主鍵去重", "版本與觀測分離", "日表與月彙總"]),
        ("分析模組", ["廣告有效性", "組合與加價購", "未取件提醒", "商品生命週期"]),
        ("決策輸出", ["最多 20 個行動項", "證據與限制", "人工審核", "效果回看"]),
    ]
    colors = ["#DDEBF7", "#E2F0D9", "#FFF2CC", "#FCE4D6", "#EDEDED"]
    y = 110
    for idx, (label, items) in enumerate(rows):
        label_box = (70, y, 290, y+130)
        rounded(d, label_box, "#17365D", outline="#17365D")
        center_text(d, label_box, label, 31, True, "white")
        x = 330
        for item in items:
            box = (x, y, x+275, y+130)
            rounded(d, box, colors[idx])
            center_text(d, box, item, 25, False)
            x += 300
        if idx < len(rows)-1:
            arrow(d, (800, y+138), (800, y+178))
        y += 185
    im.save(path, quality=95)

def make_ad_flow(path):
    im = Image.new("RGB", (1600, 980), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 35), "每日廣告分析流程", font=font(42, True), fill="#111111")
    steps = [
        ("1", "計算台灣時間 D-1", "固定 00:00 至 23:59"),
        ("2", "讀取進行中廣告", "81 單品加 45 群組"),
        ("3", "20 筆分批落庫", "頁碼及筆數逐批核對"),
        ("4", "無成本規則評估", "CTR 點擊 轉換 ROAS"),
        ("5", "目標群組商品下鑽", "只展開異常或有效群組"),
        ("6", "輸出每日報告", "最多 20 個行動項"),
        ("7", "D-3 回補", "吸收延遲歸因"),
        ("8", "累積 7 日背景", "連續異常才建議調整"),
    ]
    positions = [(80,140),(450,140),(820,140),(1190,140),(1190,520),(820,520),(450,520),(80,520)]
    boxes=[]
    for i,(num,title,sub) in enumerate(steps):
        x,y=positions[i]; box=(x,y,x+310,y+210); boxes.append(box)
        rounded(d,box,"#DDEBF7" if i<4 else "#E2F0D9",outline="#2F75B5")
        d.ellipse((x+18,y+18,x+72,y+72),fill="#17365D")
        center_text(d,(x+18,y+18,x+72,y+72),num,25,True,"white")
        center_text(d,(x+25,y+70,x+285,y+135),title,27,True)
        center_text(d,(x+25,y+132,x+285,y+190),sub,21,False,"#555555")
    for i in range(3): arrow(d,(boxes[i][2]+10,245),(boxes[i+1][0]-10,245))
    arrow(d,(1345,360),(1345,500))
    for i in range(4,7): arrow(d,(boxes[i][0]-10,625),(boxes[i+1][2]+10,625))
    arrow(d,(235,510),(235,370))
    d.text((525,875),"所有自動調整 預算變更與停用動作目前保持關閉",font=font(26,True),fill="#C00000")
    im.save(path,quality=95)

def make_lifecycle_flow(path):
    im = Image.new("RGB", (1600, 980), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 35), "商品零瀏覽與下架候選流程", font=font(42, True), fill="#111111")
    nodes = [
        ((90,140,410,290),"每週商品快照\n近 30 天瀏覽 銷量 庫存","#DDEBF7"),
        ((640,140,960,290),"資料完整且商品已上架\n排除讀取失敗與新商品","#FFF2CC"),
        ((1190,140,1510,290),"零瀏覽 零銷量\n且仍有庫存","#FCE4D6"),
        ((1190,430,1510,580),"檢查訂單 廣告\n促銷與策略保留","#FFF2CC"),
        ((640,430,960,580),"先改善主圖 標題\n分類或組合曝光","#E2F0D9"),
        ((90,430,410,580),"繼續觀察\n第二個完整窗口","#DDEBF7"),
        ((90,720,410,870),"累積至少 60 天\n仍無流量與貢獻","#FCE4D6"),
        ((640,720,960,870),"產生下架候選\n保存原因與快照","#FCE4D6"),
        ((1190,720,1510,870),"人工確認後執行\n系統不自動下架","#EDEDED"),
    ]
    for box,text,fill in nodes:
        rounded(d,box,fill,outline="#7F8C8D")
        center_text(d,box,text,25,True)
    arrows=[((420,215),(630,215)),((970,215),(1180,215)),((1350,300),(1350,420)),((1180,505),(970,505)),((630,505),(420,505)),((250,590),(250,710)),((420,795),(630,795)),((970,795),(1180,795))]
    for a,b in arrows: arrow(d,a,b)
    im.save(path,quality=95)

def make_rules_flow(path):
    im = Image.new("RGB", (1600, 720), "white")
    d = ImageDraw.Draw(im)
    d.text((60, 35), "蝦皮台灣規則與分析決策閘門", font=font(42, True), fill="#111111")
    nodes = [
        ((70,190,350,430), "官方規則庫\n商品 刊登 定價\n履約 服務", "#DDEBF7"),
        ((440,190,720,430), "規則檢查\n阻擋 警告\n情境註記", "#FFF2CC"),
        ((810,190,1090,430), "營運分析\n流量 廣告 轉換\n客單與毛利", "#E2F0D9"),
        ((1180,190,1460,430), "建議輸出\n理由 風險 價格\n人工審核", "#FCE4D6"),
    ]
    for box,text,fill in nodes:
        rounded(d,box,fill,outline="#2F75B5")
        center_text(d,box,text,27,True)
    for i in range(3): arrow(d,(nodes[i][0][2]+10,310),(nodes[i+1][0][0]-10,310))
    d.text((190,540), "官方未公開搜尋排名公式與權重；系統只記錄官方規則、可觀測指標與本店實證，禁止虛構官方權重。", font=font(27, True), fill="#C00000")
    im.save(path,quality=95)

def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd'); tcPr.append(shd)
    shd.set(qn('w:fill'), fill)

def set_cell_border(cell, color=BORDER, size="6"):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = tcPr.first_child_found_in('w:tcBorders')
    if borders is None:
        borders = OxmlElement('w:tcBorders'); tcPr.append(borders)
    for edge in ('top','left','bottom','right','insideH','insideV'):
        tag = 'w:' + edge
        el = borders.find(qn(tag))
        if el is None:
            el = OxmlElement(tag); borders.append(el)
        el.set(qn('w:val'),'single'); el.set(qn('w:sz'),size); el.set(qn('w:color'),color)

def set_cell_margins(cell, top=100, start=100, bottom=100, end=100):
    tc = cell._tc; tcPr = tc.get_or_add_tcPr(); tcMar = tcPr.first_child_found_in('w:tcMar')
    if tcMar is None:
        tcMar = OxmlElement('w:tcMar'); tcPr.append(tcMar)
    for m,v in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        node = tcMar.find(qn('w:'+m))
        if node is None: node=OxmlElement('w:'+m); tcMar.append(node)
        node.set(qn('w:w'),str(v)); node.set(qn('w:type'),'dxa')

def keep_row_together(row):
    trPr = row._tr.get_or_add_trPr()
    cant = OxmlElement('w:cantSplit'); trPr.append(cant)

def add_table(doc, headers, rows, widths=None):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    hdr = table.rows[0]
    for i,h in enumerate(headers):
        cell=hdr.cells[i]; cell.text=str(h); set_cell_shading(cell,NAVY); set_cell_border(cell); set_cell_margins(cell)
        cell.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for p in cell.paragraphs:
            p.alignment=WD_ALIGN_PARAGRAPH.CENTER
            for r in p.runs: r.font.bold=True; r.font.color.rgb=RGBColor(255,255,255); r.font.size=Pt(9.5)
        if widths: cell.width=Inches(widths[i])
    keep_row_together(hdr)
    for ridx,row in enumerate(rows):
        cells=table.add_row().cells
        for i,val in enumerate(row):
            cells[i].text=str(val); set_cell_border(cells[i]); set_cell_margins(cells[i],90,110,90,110)
            cells[i].vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if ridx%2: set_cell_shading(cells[i],"F7F9FC")
            for p in cells[i].paragraphs:
                p.alignment=WD_ALIGN_PARAGRAPH.CENTER if i==0 or len(str(val))<18 else WD_ALIGN_PARAGRAPH.LEFT
                p.paragraph_format.space_after=Pt(0)
                for r in p.runs: r.font.size=Pt(9)
            if widths: cells[i].width=Inches(widths[i])
        keep_row_together(table.rows[-1])
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return table

def add_bullet(doc, text, level=0):
    p=doc.add_paragraph(style='List Bullet' if level==0 else 'List Bullet 2')
    p.add_run(text)
    return p

def add_heading(doc, text, level=1):
    p=doc.add_heading(text, level=level)
    p.paragraph_format.keep_with_next=True
    return p

def set_repeat_table_header(row):
    trPr=row._tr.get_or_add_trPr(); tblHeader=OxmlElement('w:tblHeader'); tblHeader.set(qn('w:val'),'true'); trPr.append(tblHeader)

def page_field(paragraph):
    paragraph.alignment=WD_ALIGN_PARAGRAPH.CENTER
    run=paragraph.add_run()
    fldChar1=OxmlElement('w:fldChar'); fldChar1.set(qn('w:fldCharType'),'begin')
    instrText=OxmlElement('w:instrText'); instrText.set(qn('xml:space'),'preserve'); instrText.text=' PAGE '
    fldChar2=OxmlElement('w:fldChar'); fldChar2.set(qn('w:fldCharType'),'end')
    run._r.extend([fldChar1,instrText,fldChar2])

make_architecture(ASSETS / "architecture.png")
make_ad_flow(ASSETS / "ad_flow.png")
make_lifecycle_flow(ASSETS / "lifecycle_flow.png")
make_rules_flow(ASSETS / "rules_flow.png")

doc=Document()
sec=doc.sections[0]
sec.top_margin=Inches(0.68); sec.bottom_margin=Inches(0.65); sec.left_margin=Inches(0.72); sec.right_margin=Inches(0.72)

styles=doc.styles
styles['Normal'].font.name='Microsoft JhengHei'; styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft JhengHei'); styles['Normal'].font.size=Pt(10.5)
styles['Normal'].paragraph_format.space_after=Pt(6); styles['Normal'].paragraph_format.line_spacing=1.18
for sname,size in [('Title',28),('Heading 1',18),('Heading 2',14),('Heading 3',11.5)]:
    s=styles[sname]; s.font.name='Microsoft JhengHei'; s._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft JhengHei'); s.font.size=Pt(size); s.font.color.rgb=RGBColor(0,0,0); s.font.bold=True
styles['Heading 1'].paragraph_format.space_before=Pt(14); styles['Heading 1'].paragraph_format.space_after=Pt(8)
styles['Heading 2'].paragraph_format.space_before=Pt(10); styles['Heading 2'].paragraph_format.space_after=Pt(5)

footer=sec.footer.paragraphs[0]
footer.add_run('拾味廚房雜貨鋪營運決策系統  審核版  |  ')
for r in footer.runs: r.font.size=Pt(8); r.font.color.rgb=RGBColor(100,100,100)
page_field(footer)

# Cover
p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(95)
p=doc.add_paragraph(style='Title'); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
p.add_run('Shopee 店鋪營運決策系統\n藍圖與原型審核文件')
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before=Pt(18)
r=p.add_run('賣場 拾味廚房雜貨鋪    Store ID 27857268786685    Shopee 台灣本土'); r.font.size=Pt(12); r.font.color.rgb=RGBColor(80,80,80)
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_before=Pt(30)
r=p.add_run('版本 0.4 operational prototype\n審核日期 2026 年 10 月 7 日'); r.font.size=Pt(11)
p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(70)
p.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=p.add_run('本文件用於確認系統範圍 資料規則 原型完成度及下一階段上線條件'); r.font.size=Pt(10.5); r.font.bold=True
doc.add_page_break()

add_heading(doc,'1 審核結論',1)
doc.add_paragraph('核心藍圖已確定，廣告分析與未取件提醒原型已完成可重複執行的驗證。組合銷售、加價購和商品生命週期模組已有規則及候選資料，但正式定價、盈利判斷、連續零瀏覽判斷與自動排程仍受成本、歷史窗口和通知方式限制。第一版應維持只讀分析與人工確認，不直接修改店鋪。')
add_heading(doc,'1.1 審核建議',2)
add_table(doc,['項目','建議狀態','審核重點'],[
    ['系統總體架構','可確認','本機分批採集 SQLite 增量分析及人工審核流程已形成'],
    ['每日廣告分析','可進入連續觀測','D-1 已跑通 126 筆進行中廣告及目標群組商品下鑽'],
    ['未取件提醒','可保留人工觸發','4 天規則及去重已驗證 排程與自動傳訊保持關閉'],
    ['組合與加價購','條件式確認','先補成本 平台費 運費和活動疊加規則'],
    ['商品下架候選','先累積歷史','至少 60 天及兩個完整窗口後才產生強候選'],
    ['自動操作','暫不批准','不自動停廣告 改預算 發聊聊或下架商品'],
], [1.15,1.15,4.30])
add_heading(doc,'1.2 本次需要審核的決策',2)
for text in [
    '是否確認第一版以分析 建議 人工確認為邊界。',
    '是否接受商品全量表現每週同步 廣告每日同步的頻率。',
    '是否同意成本資料完成前不輸出盈利 虧損或正式促銷價。',
    '是否同意至少累積 7 個廣告日和 60 個商品觀測日後再評估自動化。',
]: add_bullet(doc,text)
doc.add_page_break()

add_heading(doc,'2 系統目的與範圍',1)
doc.add_paragraph('系統以商品為中心，聯合分析商品表現、廣告投入、促銷配置及履約狀態。目標是提升客單價和每單件數，減少無效廣告消耗，及時發現長時間未取件訂單，並逐步清理長期沒有流量與銷售貢獻的商品。')
add_heading(doc,'2.1 第一版包含',2)
for text in [
    '商品身份 規格 售價 庫存 近 30 天銷量與瀏覽量。',
    '進行中單品廣告與廣告群組的 D-1 指標及商品層下鑽。',
    '主商品 加購商品與組合銷售候選及測試價格。',
    '包裹到達取件門市滿 4 天仍未送達的提醒候選。',
    '長期零瀏覽 零銷量商品的人工下架候選。',
]: add_bullet(doc,text)
add_heading(doc,'2.2 第一版不執行',2)
for text in ['自動停用廣告或修改預算與目標 ROAS。','自動建立促銷或修改售價。','自動向買家傳送聊聊訊息。','自動下架商品。']: add_bullet(doc,text)
add_heading(doc,'2.3 核心操作原則',2)
doc.add_paragraph('所有模組遵循觀測 診斷 建議 人工確認 執行 效果追蹤。資料先保存在本機，模型只讀摘要和最多 20 個行動項。任何需要寫入店鋪的動作都必須在具體結果可審核後另行確認。')
doc.add_page_break()

add_heading(doc,'3 系統總體架構',1)
doc.add_picture(str(ASSETS/'architecture.png'),width=Inches(6.7))
cap=doc.add_paragraph('圖 1 系統從店鋪資料開始 依序完成分批採集 本機保存 分析與人工決策')
cap.alignment=WD_ALIGN_PARAGRAPH.CENTER; cap.runs[0].font.size=Pt(9); cap.runs[0].font.italic=True
add_heading(doc,'3.1 防止資料增長拖慢系統',2)
for text in [
    '每批最多 20 筆，成功一批便保存 checkpoint。',
    '大量 JSON 與頁面內容保存在 store audit 目錄，不寫入對話上下文。',
    '每日資料用複合主鍵 upsert，同一商品或廣告重複修改不產生重複事實。',
    '月報只讀月彙總，半年分析只讀 6 筆月彙總。',
    '瀏覽器錯誤最多重試 3 次，失敗時保留已完成頁面，不宣稱資料完整。',
]: add_bullet(doc,text)
add_heading(doc,'3.2 蝦皮台灣官方規則層',2)
doc.add_picture(str(ASSETS/'rules_flow.png'),width=Inches(6.7))
cap=doc.add_paragraph('圖 2 官方規則先形成合規閘門，再進入營運效果分析與人工決策')
cap.alignment=WD_ALIGN_PARAGRAPH.CENTER; cap.runs[0].font.size=Pt(9); cap.runs[0].font.italic=True
doc.add_paragraph('規則庫目前納入商品刊登與關鍵字準確性、重複刊登、誤導定價、禁限售商品、智慧財產權、訂單不成立率、遲延出貨率、聊聊表現及休假模式搜尋影響。來源只採蝦皮台灣官方說明中心並保存檢查日期與適用模組。蝦皮未公開完整搜尋排名公式與各因素權重，因此系統將官方合規與本店實證成效分開，不宣稱任何自訂分數為官方權重。')
doc.add_page_break()

add_heading(doc,'4 資料模型與唯一鍵',1)
doc.add_paragraph('身份資料、可變設定和期間指標分開保存。名稱、售價、廣告狀態或促銷內容改變時，以版本或觀測時間保留歷史，不用名稱作唯一鍵。')
add_table(doc,['資料實體','唯一鍵','用途','目前狀態'],[
    ['商品身份','store id + product id','穩定識別商品','商品快照已驗證'],
    ['商品規格價格','store id + product id + variation id + effective from','保存規格 售價與成本版本','35 個規格已完成優先樣本'],
    ['商品觀測','store id + product id + observed at + window','保存近 30 天瀏覽與銷量','快照已有 歷史表待匯入'],
    ['廣告主檔','store id + ad id','廣告名稱 類型 狀態與設定','已建立'],
    ['廣告日表','store id + metric date + ad id','保存廣告 D-1 指標','已建立並驗證 126 筆'],
    ['群組商品日表','store id + metric date + ad id + product id','保存群組內商品成效','已建立並驗證 150 筆'],
    ['訂單','store id + order internal id','保存未結案履約狀態','增量原型已驗證'],
    ['提醒去重','store id + order internal id + pickup ready at','避免重複提醒','已驗證'],
], [1.05,1.75,2.55,1.25])
add_heading(doc,'4.1 指標語意',2)
doc.add_paragraph('商品 views30 表示商品近 30 天瀏覽量。廣告 impressions 表示廣告曝光量。兩者不能互相替代。D-1 廣告資料標記 provisional，D-3 回補後如有變化則更新同一日期紀錄並保存修訂時間。')
doc.add_page_break()

add_heading(doc,'5 原型完成度',1)
add_table(doc,['模組','已完成證據','缺口','判定'],[
    ['商品與規格','1,338 商品建索引 15 個詳情補價 7 商品 35 規格','成本 建立時間 完整狀態歷史','部分可運行'],
    ['未取件提醒','兩頁 24 筆已出貨 1 筆滿 4 天提醒及去重','排程 通知方式 其他物流文字','原型可運行'],
    ['組合與加價購','12 組高關聯候選 前 4 組固定角色','成本 平台費 運費 活動疊加','候選原型完成'],
    ['每日廣告分析','126 比 126 筆全量 81 單品 45 群組','7 日背景 D-3 回補','原型可運行'],
    ['群組商品分析','5 個目標群組 150 個商品 5 個行動項','擴展至每日動態目標','原型可運行'],
    ['商品生命週期','1,338 商品 views30 完整 1,233 零瀏覽','至少 60 天歷史與排除欄位','規則已定'],
    ['自動排程與通知','接口保留','尚未批准啟用','關閉'],
], [1.05,2.30,2.30,0.95])
add_heading(doc,'5.1 已驗證的廣告日結果',2)
add_table(doc,['日期','進行中廣告','曝光','點擊','花費顯示值','銷售額顯示值','轉換'],[
    ['2026 10 06','126','8,596','234','NT$421','NT$876','4'],
], [1.15,1.0,0.8,0.8,1.15,1.25,0.8])
doc.add_paragraph('廣告列表會縮寫千位曝光並將部分金額顯示為整數。群組商品詳情頁保留精確花費並用於群組內對帳。沒有成本時只判斷流量與轉換效率。')
doc.add_page_break()

add_heading(doc,'6 每日廣告分析模組',1)
doc.add_picture(str(ASSETS/'ad_flow.png'),width=Inches(6.7))
cap=doc.add_paragraph('圖 3 每日廣告採集 評估 商品下鑽及延遲歸因回補流程')
cap.alignment=WD_ALIGN_PARAGRAPH.CENTER; cap.runs[0].font.size=Pt(9); cap.runs[0].font.italic=True
add_heading(doc,'6.1 初始判斷規則',2)
add_table(doc,['狀態','初始條件','處理方式'],[
    ['有效候選','有轉換且 ROAS 高於目標','核對毛利後再考慮增加預算'],
    ['低樣本','曝光 點擊或花費不足','繼續累積 不操作'],
    ['低 CTR','至少 200 曝光且低於同類中位數一半','檢查主圖 標題或受眾'],
    ['點擊無轉換','15 次點擊警告 20 次高優先','檢查價格 優惠 商品頁與受眾'],
    ['無曝光','連續 2 個完整日','檢查預算 競價 審核與庫存'],
], [1.25,3.2,2.55])
add_heading(doc,'6.2 本次商品層下鑽',2)
doc.add_paragraph('5 個有異常或有效訊號的廣告群組共取得 150 筆商品日資料。找到 5 個需優先檢查商品與 1 個有效銷售貢獻商品。四格調味盒商品 ID 56615648425 產生 NT$373 銷售額；雞骨剪商品 ID 46665677957 消耗群組約 98% 花費但沒有轉換。')
doc.add_page_break()

add_heading(doc,'7 組合銷售與加價購模組',1)
doc.add_paragraph('本模組用有流量或銷量的主商品帶動互補商品，提升客單價。組合候選先依商品場景 庫存 價格比例 廣告與促銷衝突篩選；取得共同購買訂單明細後才提升為行為驗證候選。')
add_table(doc,['階段','規則','目前輸出'],[
    ['候選生成','商品 ID 去重 庫存 場景 流量 銷量及促銷衝突','12 組高關聯候選'],
    ['角色判定','主商品負責引流 加購品負責提高件數與客單','前 4 組角色已固定'],
    ['測試定價','加價購測試 5% 10% 15% 組合測試 3% 5% 8%','僅測試價 不標記盈利'],
    ['利潤閘門','成本 平台費 增量運費 最低貢獻毛利','待成本資料'],
], [1.25,3.35,2.4])
add_heading(doc,'7.1 售價配置與限制',2)
doc.add_paragraph('目前台灣站售價生成配置為採集售價乘以 900% 再加 TWD 20，也就是採集售價乘以 9 加 20。此配置只解釋目前售價來源，不等於成本。正式促銷價不得低於成本合計 平台費 增量運費及最低貢獻毛利。')
add_heading(doc,'7.2 首輪推薦組合與價格',2)
add_table(doc,['優先','情境','做法','主商品 ID','搭配商品 ID','推薦價','理由與風險'],[
    ['1','海鮮處理','組合','40834145983','47265353153','兩件 589','魚鱗刨負責引流 砧板接續分切；總價較高且尚無共同購買證據，先小流量測試並確認毛利。'],
    ['2','蔬果備料','加價購','53515625140','53715625113','加購 59','切條器是入口 砧板低價且規格單純；砧板近 30 天無銷量，需驗證需求並確認活動疊加。'],
    ['3','烘焙製作','加價購','51015333358','46565646410','加購 66','撒粉器流量較高 蛋糕模低價互補。撒粉器含非目標規格 必須限制 variation。'],
    ['4','戶外烤肉','組合','43184145393','52865621381','兩件 510','工具組與香料盒完成同一烤肉流程。兩商品都有配件規格 必須限定完整套裝。'],
], [0.45,0.8,0.7,1.05,1.05,0.7,2.35])
doc.add_paragraph('推薦價以目前活動價計算：加價購先測加購品九折，組合先測兩件合計九五折。所有價格均須通過成本 平台費 增量運費 最低貢獻毛利與蝦皮誤導定價規則後才可發布。')
add_heading(doc,'7.3 附件商品的原型判斷',2)
doc.add_paragraph('使用者提供的三格陶瓷分隔碗外觀與商品 ID 50967235710 的陶瓷電鍋蒸盤描述高度相符。該商品 2026 年 10 月 6 日有 119 次廣告曝光 7 次點擊 花費 NT$2.69 且沒有轉換。現階段不建議增加廣告投入，可保留為電鍋用品或蒸煮工具的加價購測試候選。')
doc.add_page_break()

add_heading(doc,'8 未取件提醒模組',1)
doc.add_paragraph('提醒基準從包裹送達取件門市的時間開始計算。訂單仍為已出貨且滿 4 天時才提示；訂單變成已送達 已完成 取消 退回或退款後解除。不同物流商原始文字先標準化為 pickup ready，不依賴單一狀態字串。')
add_table(doc,['步驟','處理'],[
    ['1','只讀運送中分頁中仍為已出貨的訂單 已送達在列表階段排除'],
    ['2','每批最多 20 筆 保存訂單編碼 內部 ID 最新事件代碼與時間'],
    ['3','pickup ready at 加 4 天已到期才產生提醒'],
    ['4','以訂單 ID 加到店時間去重 避免同一事件重複通知'],
    ['5','產生可人工確認的聊聊文案 不自動傳送'],
], [0.7,6.3])
add_heading(doc,'8.1 原型驗證',2)
doc.add_paragraph('已完成兩頁共 24 筆已出貨訂單同步，找到 1 筆滿 4 天提醒並寫入去重狀態。下載銷售訂單報表需要短信驗證，因此原型改用只讀頁面分批同步。定時任務和通知仍保持關閉。')
doc.add_page_break()

add_heading(doc,'9 商品瀏覽與下架候選',1)
doc.add_picture(str(ASSETS/'lifecycle_flow.png'),width=Inches(6.7))
cap=doc.add_paragraph('圖 4 商品零瀏覽診斷 改善 觀察與人工下架流程')
cap.alignment=WD_ALIGN_PARAGRAPH.CENTER; cap.runs[0].font.size=Pt(9); cap.runs[0].font.italic=True
add_heading(doc,'9.1 現有快照',2)
add_table(doc,['指標','數量','解讀'],[
    ['商品總數','1,338','全部具有近 30 天瀏覽欄位'],
    ['近 30 天零瀏覽','1,233','只是一個窗口 不能直接下架'],
    ['零瀏覽且有庫存','599','需要檢查商品狀態與上架時間'],
    ['零瀏覽 有庫存 累計售出 0','529','可先進入觀察與優化池'],
], [2.0,1.0,4.0])
doc.add_paragraph('強下架候選至少需要 60 個日曆日，且兩個相隔至少 30 天的完整窗口均為零瀏覽與零銷量。同時必須排除近期訂單 廣告貢獻 促銷 組合商品 季節商品 新商品和人工保留商品。')
doc.add_page_break()

add_heading(doc,'10 效能 穩定性與錯誤控制',1)
add_table(doc,['風險','控制方式','驗證結果'],[
    ['上下文過大','原始資料本機保存 對話只顯示摘要與最多 20 個項目','廣告 126 筆與商品 150 筆均未灌入對話'],
    ['重複資料','複合主鍵 upsert 名稱與設定變更保存版本','重跑第一頁仍維持相同筆數'],
    ['頁面未完成渲染','驗證頁碼 首列 ID 商品列與分頁器','修正兩個空群組後補齊 150 筆'],
    ['CDP target 失效','避免巢狀 PowerShell 重新轉義 失敗最多 3 次','訂單同步改由目前 PowerShell 直接執行後成功'],
    ['瀏覽器元素不可點擊','改用頁面內 DOM 觸發並核對頁碼','廣告 7 頁完整讀取'],
    ['長期資料變慢','日表增量 月彙總 半年只讀 6 筆月資料','架構已定 待累積月份驗證'],
], [1.55,3.15,2.35])
add_heading(doc,'10.1 錯誤處理原則',2)
doc.add_paragraph('若再次發生 remote compact 串流錯誤，立即停止大量讀取，保留本機資料與 checkpoint，不把網路錯誤宣稱為已修復。任何批次只有在頁碼 筆數 身份與資料庫累計一致時才標記 complete。')
add_heading(doc,'10.2 近三個月歷史回填',2)
doc.add_paragraph('歷史資料按模組及日期窗口回填，不一次載入。廣告優先按月取得明細並保存原始粒度；訂單按 7 天窗口和每頁最多 20 筆讀取；促銷按活動 ID 建版本。每批寫入 manifest 內容雜湊與 checkpoint，重跑使用複合主鍵 upsert。商品近 30 天瀏覽若平台不提供更早歷史，不反推每日值，缺失保持 null 並從目前快照開始累積。半年分析只讀月彙總，不讀全量明細。')
doc.add_page_break()

add_heading(doc,'11 下一階段與上線閘門',1)
add_table(doc,['優先級','工作','完成條件'],[
    ['A','三個月歷史回填','按月或 7 天窗口續跑 原始檔 manifest 與資料庫筆數一致'],
    ['A','每週同步官方規則','來源 日期 內容雜湊與受影響模組可追溯'],
    ['A','連續收集廣告日資料','至少 7 個完整 D-1 日 並完成 D-3 回補'],
    ['A','建立商品觀測歷史','商品快照正式匯入 product observations 每週續增'],
    ['A','取得成本與費率','product id variation id 成本 生效時間 平台費與增量運費可追溯'],
    ['B','補促銷疊加規則','確認折扣 組合 加價購和優惠券互斥或疊加方式'],
    ['B','完成訂單商品關係','取得訂單商品 ID 規格 ID 及折扣分攤'],
    ['C','評估排程與通知','連續運行穩定且人工報告準確後另行批准'],
], [0.8,2.6,3.65])
add_heading(doc,'11.1 啟用自動化前必須通過',2)
for text in [
    '廣告連續異常至少兩個完成歸因日，且成本閘門可計算。',
    '提醒器能正確排除已送達 取消 退回及退款訂單。',
    '商品下架候選覆蓋至少 60 天並完成保留清單核對。',
    '每一種店鋪寫入動作都有可回復方案 審核紀錄與明確責任人。',
]: add_bullet(doc,text)
doc.add_page_break()

add_heading(doc,'12 審核表',1)
doc.add_paragraph('請在每一項選擇確認 修改或暫緩，並在意見欄記錄需要調整的規則或門檻。')
add_table(doc,['審核項目','確認','修改','暫緩','審核意見'],[
    ['第一版系統邊界','□','□','□',''],
    ['資料 KEY 與版本策略','□','□','□',''],
    ['每日廣告流程與門檻','□','□','□',''],
    ['群組商品下鑽策略','□','□','□',''],
    ['組合與加價購定價閘門','□','□','□',''],
    ['未取件滿 4 天規則','□','□','□',''],
    ['商品零瀏覽與下架規則','□','□','□',''],
    ['同步頻率與資料保留','□','□','□',''],
    ['自動化保持關閉','□','□','□',''],
], [2.05,0.55,0.55,0.55,2.95])
add_heading(doc,'12.1 總體審核結果',2)
add_table(doc,['結果','選擇','說明'],[
    ['通過進入資料累積階段','□',''],
    ['修改後再審','□',''],
    ['暫緩','□',''],
], [2.4,0.8,4.1])
doc.add_paragraph('\n審核人 ____________________    日期 ____________________')
add_heading(doc,'附錄 主要原型輸出',1)
for text in [
    'store audit db store audit sqlite  廣告原型資料庫',
    'ad daily 2026 10 06 daily report md  廣告日報',
    'ad daily 2026 10 06 group product report md  群組商品分析報告',
    'docs 05 pickup alert md  未取件提醒規則',
    'docs 07 bundle addon module md  組合與加價購規則',
    'docs 10 product lifecycle md  商品生命週期規則',
    'run ad day ps1  人工廣告分析入口',
]: add_bullet(doc,text)

doc.core_properties.title='Shopee 店鋪營運決策系統 藍圖與原型審核文件'
doc.core_properties.subject='拾味廚房雜貨鋪系統藍圖 原型完成度 流程與審核決策'
doc.core_properties.author=''
doc.core_properties.comments=''
doc.save(DOCX)
print(DOCX)
