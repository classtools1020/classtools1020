# -*- coding: utf-8 -*-
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

doc = Document()

# 預設字型（中文）
style = doc.styles['Normal']
style.font.name = 'Microsoft JhengHei'
style.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
style.font.size = Pt(11)

def shade(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), color)
    tcPr.append(sh)

def set_cn(run, bold=False, size=11, color=None):
    run.font.name = 'Microsoft JhengHei'
    run._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft JhengHei')
    run.font.size = Pt(size); run.font.bold = bold
    if color: run.font.color.rgb = color

# ---- 標題 ----
h = doc.add_paragraph(); h.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = h.add_run('🍦 冰淇淋邊界大冒險 ｜ 第三節教學逐字稿'); set_cn(r, True, 18, RGBColor(0xC0,0x39,0x2B))
sub = doc.add_paragraph(); sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run('國中特教班・社會科｜45 分鐘｜主題：身體界線・身體自主權'); set_cn(r, False, 11, RGBColor(0x55,0x55,0x55))

# ---- 上台前小語 ----
box = doc.add_paragraph()
r = box.add_run('💛 上台前 30 秒，先對自己說：')
set_cn(r, True, 12, RGBColor(0x1F,0x61,0x8C))
box2 = doc.add_paragraph()
r = box2.add_run('「我準備得很充分，今天只要陪他們玩。學生答錯也沒關係，我笑笑帶過就好。」')
set_cn(r, False, 12)
for p in (box, box2):
    p.paragraph_format.left_indent = Inches(0.1)

# ---- 表格 ----
cols = ['環節（時間）', '🎬 投影片', '🗣️ 你說（台詞）', '🙆 你做 / 學生']
widths = [1.3, 1.2, 3.4, 2.0]
table = doc.add_table(rows=1, cols=4)
table.alignment = WD_TABLE_ALIGNMENT.CENTER
table.style = 'Table Grid'
hdr = table.rows[0].cells
for i, t in enumerate(cols):
    shade(hdr[i], '4CAF50')
    p = hdr[i].paragraphs[0]; p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_cn(p.add_run(t), True, 11, RGBColor(0xFF,0xFF,0xFF))

rows = [
 ('① 開場導入\n約2分', '封面〜冰淇淋學邊界',
  '「上課～今天老師帶了祕密武器，等一下請大家吃冰淇淋！🍦 但要先學會一個本領才能吃喔～」\n「今天用冰淇淋，學一個詞叫『邊界』。」',
  '手比圈圈圍住自己'),
 ('② 暖身影片\n約2分', '《讓孩子做身體的主人》',
  '「先看一小段影片，想一個問題：誰可以決定要不要被碰？」\n看完問：「誰決定？對～自己！」',
  '播影片→提問'),
 ('③ 冰淇淋三層\n約4分', '三層・紅綠燈',
  '「冰淇淋有三層，像紅綠燈：🟢綠燈＝家人好友可以抱；🟡黃燈＝同學留一個手臂距離；🔴紅燈＝陌生人大聲說不要！」\n「就算綠燈的人，你不想要，也可以說不！」',
  '伸手示範手臂距離'),
 ('④ 等你下課判斷\n約5分', '影片＋題目／答案頁',
  '「放一首你們聽過的歌～周杰倫！邊聽邊想：男生在哪一層？」\n（題目頁）「女生不理他，他還一直跟。尊重🟢還是越界🔴？猜猜看！」\n（按下一頁）「🔴越界＝騷擾！不尊重邊界就是騷擾。」',
  '播《等你下課》\n學生舉手猜\n按下一頁揭曉'),
 ('⑤ 情境闖關×5\n約10分', '5組題目／答案頁',
  '節奏：問→猜→翻頁揭曉→一句重點\n①同學坐旁邊→🟡黃燈\n②有人一直跟→🔴騷擾\n③訊息一天一條vs每秒50條→50條＝騷擾\n④陌生人靠近→🔴說不要、跑向大人\n⑤「再看一眼」看100遍→騷擾要求救',
  '每題按下一頁揭曉\n答對說：「太聰明了！拍拍手👏」'),
 ('⑥ 求助5步驟\n約2分', '5步驟＋113',
  '「有人越過邊界，記住5步驟：認出來→說不要→走開→告訴大人→打113。」',
  '全班一起比手勢念一次'),
 ('⑦ 🍦冰淇淋感受杯\n約15分（重頭戲）', '動手做',
  '「吃冰淇淋時間！黃金規則：想要別人的配料，一定要先問『可以給我一個嗎？』對方說好才能拿。說不要呢？對～我們尊重他！」\n（分享）「誰綠燈最多？誰有紅燈想說說看？」',
  '發冰淇淋＋三色料\n巡桌、蓋章、微笑納涼☕'),
 ('⑧ 收尾金句\n約2分', '從今天開始',
  '「記得四件事：尊重別人的冰淇淋、保護自己的、勇敢說不、遇到事敢求救。」\n「下課～你們今天超棒！」',
  '全班大聲喊：\n「我的身體、我的感受，我做主！」'),
]

for i, (seg, slide, say, do) in enumerate(rows):
    cells = table.add_row().cells
    data = [seg, slide, say, do]
    for j, txt in enumerate(data):
        cell = cells[j]
        if j == 0: shade(cell, 'E8F5E9')
        cell.paragraphs[0].text = ''
        first = True
        for line in txt.split('\n'):
            p = cell.paragraphs[0] if first else cell.add_paragraph()
            first = False
            set_cn(p.add_run(line), bold=(j==0), size=10)

for i, w in enumerate(widths):
    for cell in table.columns[i].cells:
        cell.width = Inches(w)

# ---- 結尾提醒 ----
doc.add_paragraph()
tip = doc.add_paragraph()
set_cn(tip.add_run('💪 你只要「問問題＋按下一頁＋發冰淇淋」，其他學生會自己接。穩穩的，加油！'),
       True, 12, RGBColor(0xC0,0x39,0x2B))

out = '/home/user/classtools1020/冰淇淋邊界大冒險_第三節教案逐字稿.docx'
doc.save(out)
print('saved', out)
