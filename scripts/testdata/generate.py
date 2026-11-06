"""デモ用のテストファイル群を生成する。

すべて架空のデータ。マイナンバーはチェックデジットだけ正しい架空番号、
カード番号は公開されているテスト番号、メールは example.* ドメインを使う。

使い方:
    scripts/testdata/generate.sh [出力先]   (既定: testdata/sample-files)
"""

from __future__ import annotations

import json
import os
import random
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

random.seed(20261106)

FONT_REGULAR = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
FONT_BOLD = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
PDF_FONT = "HeiseiKakuGo-W5"
pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT))


# ---------------------------------------------------------------- 架空データ

def mynumber(base11: str) -> str:
    """11桁からチェックデジット付き12桁の架空マイナンバーを作る。"""
    digits = [int(c) for c in base11]
    total = 0
    for n in range(1, 12):
        p = digits[11 - n]
        q = n + 1 if n <= 6 else n - 5
        total += p * q
    r = total % 11
    check = 0 if r <= 1 else 11 - r
    return base11 + str(check)


PEOPLE = [
    ("山田 太郎", "ヤマダ タロウ", "東京都千代田区架空町1-2-3", "03-1234-5678", "090-1111-2222", "taro.yamada@example.co.jp", mynumber("12345678901")),
    ("佐藤 花子", "サトウ ハナコ", "大阪府大阪市北区仮想2-4-6 サンプルビル301", "06-2345-6789", "080-3333-4444", "hanako.sato@example.com", mynumber("23456789012")),
    ("鈴木 一郎", "スズキ イチロウ", "愛知県名古屋市中区見本3-5-7", "052-345-6789", "070-5555-6666", "ichiro.suzuki@example.jp", mynumber("34567890123")),
    ("高橋 美咲", "タカハシ ミサキ", "福岡県福岡市博多区例示4-8-12", "092-456-7890", "090-7777-8888", "misaki.takahashi@example.co.jp", mynumber("45678901234")),
    ("田中 健", "タナカ ケン", "北海道札幌市中央区試験5-10-1", "011-567-8901", "080-9999-0000", "ken.tanaka@example.com", mynumber("56789012345")),
]
TEST_CARDS = ["4111 1111 1111 1111", "5555 5555 5555 4444", "3530 1113 3330 0000"]


# ---------------------------------------------------------------- ヘルパ

def set_mtime(path: Path, y: int, m: int, d: int) -> None:
    ts = time.mktime(datetime(y, m, d, 10, 0).timetuple())
    os.utime(path, (ts, ts))


def write_docx(path: Path, title: str, paragraphs: list[str]) -> None:
    doc = Document()
    doc.add_heading(title, level=1)
    for p in paragraphs:
        doc.add_paragraph(p)
    doc.save(path)


def write_text_pdf(path: Path, title: str, lines: list[str]) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    w, h = A4
    c.setFont(PDF_FONT, 18)
    c.drawString(60, h - 80, title)
    c.setFont(PDF_FONT, 11)
    y = h - 120
    for line in lines:
        c.drawString(60, y, line)
        y -= 20
    c.save()


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def scanned_look(img: Image.Image, angle: float) -> Image.Image:
    """スキャンした紙っぽく、傾き・ぼかし・ノイズを加える。"""
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(250, 249, 244))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    px = img.load()
    w, h = img.size
    for _ in range(w * h // 300):
        x, y = random.randrange(w), random.randrange(h)
        v = random.randint(150, 230)
        px[x, y] = (v, v, v)
    return img


def form_image(title: str, rows: list[tuple[str, str]], note: str, angle: float) -> Image.Image:
    w, h = 1240, 1754  # A4 / 150dpi
    img = Image.new("RGB", (w, h), (250, 249, 244))
    d = ImageDraw.Draw(img)
    d.text((w // 2, 110), title, font=font(52, True), fill=(20, 20, 20), anchor="mm")
    d.text((w - 90, 190), "受付日 2025年 4月 15日", font=font(26), fill=(30, 30, 30), anchor="rm")
    top, row_h, left, mid, right = 260, 110, 90, 380, w - 90
    for i, (label, value) in enumerate(rows):
        y = top + i * row_h
        d.rectangle([left, y, right, y + row_h], outline=(40, 40, 40), width=3)
        d.line([mid, y, mid, y + row_h], fill=(40, 40, 40), width=3)
        d.text((left + 20, y + row_h // 2), label, font=font(30, True), fill=(30, 30, 30), anchor="lm")
        # 手書き風に少し色と位置をずらす
        d.text((mid + 30 + random.randint(-4, 4), y + row_h // 2 + random.randint(-4, 4)),
               value, font=font(34), fill=(25, 35, 110), anchor="lm")
    y = top + len(rows) * row_h + 60
    d.text((left, y), note, font=font(24), fill=(60, 60, 60))
    d.ellipse([right - 170, y + 80, right - 30, y + 220], outline=(200, 40, 40), width=6)
    d.text((right - 100, y + 150), "印", font=font(48, True), fill=(200, 40, 40), anchor="mm")
    return scanned_look(img, angle)


def license_image(p) -> Image.Image:
    w, h = 1012, 638
    img = Image.new("RGB", (w, h), (232, 240, 228))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=(80, 120, 80), width=8)
    d.text((40, 40), "運転免許証（見本・架空）", font=font(40, True), fill=(30, 60, 30))
    photo_left = w - 300
    # 長い住所は写真の枠の手前で折り返す（枠の下に文字が隠れると、正解の文字が画像から読めなくなるため）
    address = f"住所  {p[2]}"
    address_lines = [address]
    if d.textlength(address, font=font(30)) > photo_left - 40 - 20 and " " in p[2]:
        head, tail = p[2].rsplit(" ", 1)
        address_lines = [f"住所  {head}", f"　　  {tail}"]
    lines = [
        f"氏名  {p[0]}",
        "生年月日  昭和60年 5月 20日生",
        *address_lines,
        "交付  令和 5年 6月 1日",
        "番号  第 123456789012 号",
    ]
    for i, t in enumerate(lines):
        d.text((40, 130 + i * 70), t, font=font(30), fill=(20, 20, 20))
    d.rectangle([photo_left, 130, w - 50, 450], fill=(200, 205, 210), outline=(90, 90, 90), width=3)
    d.text((w - 175, 290), "写真", font=font(36), fill=(90, 90, 90), anchor="mm")
    return scanned_look(img, -1.2)


# ---------------------------------------------------------------- 生成本体

def generate(out: Path) -> list[tuple[str, str]]:
    manifest: list[tuple[str, str]] = []

    def add(rel: str, desc: str) -> Path:
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        manifest.append((rel, desc))
        return p

    # --- 営業部 ---------------------------------------------------------
    p = add("営業部/顧客名簿_2025.xlsx", "個人情報: 氏名・住所・電話・メール（5名）")
    wb = Workbook(); ws = wb.active; ws.title = "顧客一覧"
    ws.append(["氏名", "フリガナ", "住所", "電話", "携帯", "メール"])
    for x in PEOPLE:
        ws.append([x[0], x[1], x[2], x[3], x[4], x[5]])
    wb.save(p)

    p = add("営業部/提案書_A社向け.pptx", "業務資料（個人情報なし）")
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = "業務効率化のご提案"
    s.placeholders[1].text = "株式会社サンプル 営業部"
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = "現状の課題"
    s.placeholders[1].text = "・紙の帳票が多い\n・ファイルの保管場所がばらばら\n・検索に時間がかかる"
    prs.save(p)

    p = add("営業部/商談メモ_B社.pptx", "個人情報: 先方担当者の携帯・メール")
    prs = Presentation()
    s = prs.slides.add_slide(prs.slide_layouts[5])
    s.shapes.title.text = "B社 商談メモ"
    tb = s.shapes.add_textbox(Inches(0.8), Inches(1.8), Inches(8), Inches(3)).text_frame
    tb.text = f"先方担当: {PEOPLE[2][0]} 様"
    for t in [f"携帯: {PEOPLE[2][4]}", f"メール: {PEOPLE[2][5]}", "次回: 見積提示（社外秘の価格表を使用）"]:
        para = tb.add_paragraph(); para.text = t; para.font.size = Pt(18)
    prs.save(p)

    p = add("営業部/見積書_2025-03.pdf", "業務資料（個人情報なし・テキストPDF）")
    write_text_pdf(p, "御見積書", ["株式会社サンプル 御中", "", "品名: ファイル整理支援サービス", "数量: 1式", "金額: 480,000円（税別）", "有効期限: 発行日より30日"])

    # --- 人事 -----------------------------------------------------------
    p = add("人事/社員名簿_最終版.xlsx", "個人情報: マイナンバー・住所・電話（5名）")
    wb = Workbook(); ws = wb.active; ws.title = "社員"
    ws.append(["社員番号", "氏名", "個人番号", "住所", "電話", "メール"])
    for i, x in enumerate(PEOPLE, 1):
        ws.append([f"E{1000 + i}", x[0], x[6], x[2], x[4], x[5]])
    wb.save(p)
    dup = add("人事/社員名簿_最終版(1).xlsx", "重複: 社員名簿_最終版.xlsx と同一内容")
    shutil.copyfile(p, dup)

    p = add("人事/給与振込口座一覧.csv", "個人情報: 氏名・銀行口座")
    lines = ["氏名,銀行,支店,種別,口座番号"]
    for i, x in enumerate(PEOPLE):
        lines.append(f"{x[0]},サンプル銀行,本店,普通,{1234560 + i * 7}")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    p = add("人事/マイナンバー提出書_スキャン.pdf", "スキャン(画像のみPDF): マイナンバー・住所・電話")
    x = PEOPLE[0]
    img = form_image("個人番号 提出書", [
        ("氏名", x[0]), ("フリガナ", x[1]), ("個人番号", " ".join([x[6][:4], x[6][4:8], x[6][8:]])),
        ("住所", x[2]), ("電話番号", x[4]), ("扶養家族", "1名"),
    ], "※本書は個人番号の提出のために使用します。取扱注意。", angle=0.8)
    img.save(p, "PDF", resolution=150)

    p = add("人事/身分証コピー/運転免許証_佐藤.jpg", "スキャン画像: 運転免許証（氏名・住所・生年月日）")
    license_image(PEOPLE[1]).save(p, quality=85)

    # --- 経理 -----------------------------------------------------------
    p = add("経理/請求書_2025-02.pdf", "個人情報/決済情報: カード番号・口座（テキストPDF）")
    write_text_pdf(p, "請求書", [
        f"請求先: {PEOPLE[3][0]} 様", f"住所: {PEOPLE[3][2]}", f"電話: {PEOPLE[3][3]}", "",
        "ご請求金額: 52,800円", f"お支払い方法: クレジットカード {TEST_CARDS[0]}",
        "振込先: サンプル銀行 本店 普通 7654321",
    ])

    p = add("経理/経費精算_スキャン.png", "スキャン画像: 領収書（個人情報は少なめ）")
    img = form_image("領 収 書", [
        ("宛名", "株式会社サンプル 様"), ("金額", "¥ 12,960-"), ("但し", "会議費として"),
        ("発行者", "架空商店"), ("電話", "03-9876-5432"),
    ], "上記正に領収いたしました。", angle=-1.5)
    img.save(p)

    # --- 法務 -----------------------------------------------------------
    p = add("法務/業務委託契約書_社外秘.docx", "機密: 「社外秘」「秘密保持」、契約金額")
    write_docx(p, "業務委託契約書（社外秘）", [
        "株式会社サンプル（以下「甲」という）と架空システム株式会社（以下「乙」という）は、以下のとおり契約を締結する。",
        "第1条（目的）甲は乙に対し、ファイル管理システムの開発を委託する。",
        "第2条（委託料）委託料は金12,000,000円（税別）とする。",
        "第3条（秘密保持）乙は本契約に関して知り得た甲の機密情報を第三者に開示してはならない。",
        "本書は社外秘につき、関係者以外への開示を禁ずる。",
    ])

    p = add("法務/NDA_ひな形.docx", "ひな形（機密キーワードは含むが実データなし）")
    write_docx(p, "秘密保持契約書（ひな形）", [
        "〔会社名〕（以下「開示者」という）と〔会社名〕（以下「受領者」という）は、秘密情報の取扱いについて次のとおり合意する。",
        "第1条（秘密情報の定義）本契約において秘密情報とは、開示者が秘密である旨を明示して開示した情報をいう。",
    ])

    # --- 共有 -----------------------------------------------------------
    p = add("共有/議事録_定例会_2025-04-10.docx", "業務資料（個人情報なし）")
    write_docx(p, "定例会 議事録", [
        "日時: 2025年4月10日 10:00-11:00", "参加者: 営業部、人事部、情報システム部",
        "議題1: 共有フォルダの整理方針について", "議題2: 次回までに各部署で不要ファイルを洗い出す",
    ])

    p = add("共有/メモ.txt", "個人情報: メモ書きの電話・メール")
    p.write_text(
        "来週の打ち合わせ\n"
        f"・{PEOPLE[4][0]}さんに連絡（{PEOPLE[4][4]}）\n"
        f"・資料は {PEOPLE[4][5]} に送付\n"
        "・会議室は3F\n", encoding="utf-8")

    p = add("共有/問い合わせエクスポート.csv", "個人情報: 問い合わせフォームの氏名・メール・電話")
    lines = ["日時,氏名,メール,電話,内容"]
    for i, x in enumerate(PEOPLE):
        lines.append(f"2025-0{i + 1}-15 14:2{i},{x[0]},{x[5]},{x[3]},資料請求")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    p = add("共有/古い資料/2019_展示会_来場者リスト.xlsx", "個人情報 + 古いファイル（2019年更新）")
    wb = Workbook(); ws = wb.active
    ws.append(["来場日", "氏名", "会社", "メール"])
    for x in PEOPLE[:3]:
        ws.append(["2019-10-02", x[0], "架空工業", x[5]])
    wb.save(p)
    set_mtime(p, 2019, 10, 5)

    p = add("共有/古い資料/2018_社内報.docx", "古いファイル（2018年更新・個人情報なし）")
    write_docx(p, "社内報 2018年夏号", ["今号の特集: 新オフィスへの移転", "部活動紹介: テニス部"])
    set_mtime(p, 2018, 7, 20)

    p = add("共有/古い資料/2018_社内報_コピー.docx", "重複 + 古いファイル")
    shutil.copyfile(out / "共有/古い資料/2018_社内報.docx", p)
    set_mtime(p, 2018, 7, 21)

    # --- デスクトップ整理前 ---------------------------------------------
    p = add("デスクトップ整理前/新しいフォルダー/申込書_スキャン.jpg", "スキャン画像: 申込書（氏名・住所・電話・カード番号）")
    x = PEOPLE[3]
    img = form_image("サービス利用申込書", [
        ("お名前", x[0]), ("ご住所", x[2]), ("電話番号", x[3]), ("メール", x[5]),
        ("カード番号", TEST_CARDS[1]), ("有効期限", "12 / 28"),
    ], "ご記入いただいた情報は本サービスの提供にのみ利用します。", angle=1.8)
    img.save(p, quality=80)

    p = add("デスクトップ整理前/無題.txt", "中身の薄いファイル（個人情報なし）")
    p.write_text("あとで整理する\n", encoding="utf-8")

    return manifest


# ---------------------------------------------------------------- 評価の正解

def expected() -> dict[str, dict]:
    """ファイルごとの正解（npm run eval で AI の性能を測るのに使う）。

    - types:   含まれる情報の種類（ルール検出の種類名）
    - names:   本文に書かれている氏名 / readings: 読み仮名
    - risk / recommendation: 受け入れてよい値（判断が分かれうるものは複数）
    - ocr:     画像から読み取れるべき文字列（空白は無視して照合）
    - skip_ai: アプリでは AI を呼ばないファイル（重複は原本の結果を流用する）
    - secrets: 伏せられるべき番号（ファイルに書かれた表記のまま。伏せたあとの本文に残っていないかを数える）
    """
    names = [x[0] for x in PEOPLE]
    readings = [x[1] for x in PEOPLE]
    none_ = {"types": [], "names": [], "readings": [], "risk": ["none", "low"], "recommendation": ["keep"]}
    e: dict[str, dict] = {
        "営業部/顧客名簿_2025.xlsx": {"types": ["phone", "email", "address"], "names": names, "readings": readings,
                                   "risk": ["high"], "recommendation": ["restrict"]},
        "営業部/提案書_A社向け.pptx": none_,
        "営業部/商談メモ_B社.pptx": {"types": ["phone", "email", "confidential"], "names": [names[2]], "readings": [],
                                 "risk": ["medium", "high"], "recommendation": ["restrict", "review"]},
        "営業部/見積書_2025-03.pdf": none_,
        "人事/社員名簿_最終版.xlsx": {"types": ["mynumber", "phone", "email", "address"], "names": names, "readings": [],
                                 "risk": ["high"], "recommendation": ["restrict"]},
        "人事/社員名簿_最終版(1).xlsx": {"skip_ai": True},
        "人事/給与振込口座一覧.csv": {"types": ["bank_account"], "names": names, "readings": [],
                                  "risk": ["high"], "recommendation": ["restrict"]},
        "人事/マイナンバー提出書_スキャン.pdf": {"types": ["mynumber", "phone", "address", "confidential"], "names": [names[0]],
                                         "readings": [readings[0]], "risk": ["high"], "recommendation": ["restrict"],
                                         "ocr": [names[0], readings[0], PEOPLE[0][6], PEOPLE[0][2], PEOPLE[0][4]]},
        "人事/身分証コピー/運転免許証_佐藤.jpg": {"types": ["id_document", "address", "birthdate"], "names": [names[1]], "readings": [],
                                          "risk": ["high"], "recommendation": ["restrict", "delete"],
                                          "ocr": [names[1], PEOPLE[1][2], "123456789012"]},
        "経理/請求書_2025-02.pdf": {"types": ["credit_card", "bank_account", "phone", "address"], "names": [names[3]], "readings": [],
                                "risk": ["high"], "recommendation": ["restrict", "delete"]},
        "経理/経費精算_スキャン.png": {"types": ["phone"], "names": [], "readings": [], "risk": ["low", "medium", "none"],
                                  "recommendation": ["keep", "archive", "review", "restrict"],
                                  "ocr": ["架空商店", "03-9876-5432", "12,960"]},
        "法務/業務委託契約書_社外秘.docx": {"types": ["confidential"], "names": [], "readings": [],
                                     "risk": ["medium", "high"], "recommendation": ["restrict"]},
        "法務/NDA_ひな形.docx": {"types": ["confidential"], "names": [], "readings": [], "risk": ["none", "low", "medium"],
                             "recommendation": ["keep", "review"]},
        "共有/議事録_定例会_2025-04-10.docx": none_,
        "共有/メモ.txt": {"types": ["phone", "email"], "names": [names[4]], "readings": [],
                       "risk": ["medium", "high"], "recommendation": ["restrict", "delete", "review"]},
        "共有/問い合わせエクスポート.csv": {"types": ["phone", "email"], "names": names, "readings": [],
                                     "risk": ["high"], "recommendation": ["restrict"]},
        "共有/古い資料/2019_展示会_来場者リスト.xlsx": {"types": ["email"], "names": names[:3], "readings": [],
                                               "risk": ["medium", "high"], "recommendation": ["delete", "restrict"]},
        "共有/古い資料/2018_社内報.docx": {**none_, "recommendation": ["archive", "delete"]},
        "共有/古い資料/2018_社内報_コピー.docx": {"skip_ai": True},
        "デスクトップ整理前/新しいフォルダー/申込書_スキャン.jpg": {"types": ["credit_card", "phone", "email", "address"], "names": [names[3]],
                                                   "readings": [], "risk": ["high"], "recommendation": ["restrict"],
                                                   "ocr": [names[3], PEOPLE[3][2], PEOPLE[3][3], PEOPLE[3][5], TEST_CARDS[1]]},
        "デスクトップ整理前/無題.txt": {**none_, "recommendation": ["keep", "archive", "delete"]},
    }
    return e


# ---------------------------------------------------------------- 難しいテストデータ（npm run eval 用）
#
# 標準のサンプル（デモ・画面写真に使う）とは別のフォルダに作る。
# 画像の劣化・表の崩れ・上限を超える人数・英語・番号の紛らわしさなど、AI やルールが間違えやすい形を集める。

HARD_PEOPLE = [
    ("森本 健司", "モリモト ケンジ", "神奈川県横浜市西区架空台7-8-9", "045-111-2233", "090-2468-1357", "kenji.morimoto@example.co.jp", mynumber("67890123456")),
    ("小川 由美", "オガワ ユミ", "京都府京都市中京区仮置町10-1", "075-222-3344", "080-1357-2468", "yumi.ogawa@example.com", mynumber("78901234567")),
    ("石井 誠", "イシイ マコト", "宮城県仙台市青葉区見本台2-3", "022-333-4455", "070-9876-5432", "makoto.ishii@example.jp", mynumber("89012345678")),
    ("木村 花", "キムラ ハナ", "兵庫県神戸市中央区例示通5-6", "078-444-5566", "090-1122-3344", "hana.kimura@example.co.jp", mynumber("90123456789")),
    ("松本 大輔", "マツモト ダイスケ", "広島県広島市中区試験町8-1", "082-555-6677", "080-5566-7788", "daisuke.matsumoto@example.com", mynumber("01234567890")),
    ("井上 彩", "イノウエ アヤ", "静岡県静岡市葵区架空町3-3", "054-666-7788", "070-3344-5566", "aya.inoue@example.jp", mynumber("11223344556")),
]

# 議事録に出す25人（AI が返せる氏名の上限 20 人を超える）
_SURNAMES = ["青木", "上田", "江口", "大野", "岡本", "片山", "川口", "北村", "久保", "小島", "斎藤", "坂本", "島田",
             "杉山", "関口", "高田", "竹内", "千葉", "辻", "中島", "西村", "野口", "橋本", "平野", "藤田"]
_GIVEN = ["直樹", "真理", "翔太", "恵子", "拓也", "智子", "亮", "美穂", "大樹", "沙織", "健太", "陽子", "誠一",
          "千尋", "隆", "愛", "秀樹", "由紀", "浩", "麻衣", "和也", "裕子", "剛", "舞", "悠斗"]
MEETING_PEOPLE = [f"{a} {b}" for a, b in zip(_SURNAMES, _GIVEN)]


def degrade(img: Image.Image, angle: float, blur: float, contrast: float, scale: float) -> Image.Image:
    """かすれたスキャン: 大きな傾き・強いぼかし・薄いコントラスト・解像度の低下・ノイズ。"""
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(236, 234, 226))
    img = ImageEnhance.Contrast(img).enhance(contrast)
    w, h = img.size
    img = img.resize((int(w * scale), int(h * scale)), Image.BILINEAR).resize((w, h), Image.BILINEAR)
    img = img.filter(ImageFilter.GaussianBlur(blur))
    px = img.load()
    for _ in range(w * h // 80):
        x, y = random.randrange(w), random.randrange(h)
        v = random.randint(120, 220)
        px[x, y] = (v, v, v)
    return img


def business_card_photo(p, romaji: str) -> Image.Image:
    """机の上で撮った名刺の写真（暗い背景・影・傾き）。"""
    card = Image.new("RGB", (910, 550), (252, 252, 250))
    d = ImageDraw.Draw(card)
    d.text((50, 50), "架空ソリューションズ株式会社", font=font(28), fill=(40, 40, 40))
    d.text((50, 95), "営業本部 第二営業部 課長", font=font(24), fill=(70, 70, 70))
    d.text((50, 170), p[0], font=font(64, True), fill=(20, 20, 20))
    d.text((52, 255), romaji, font=font(26), fill=(90, 90, 90))
    d.text((50, 330), f"〒220-0001 {p[2]}", font=font(22), fill=(50, 50, 50))
    d.text((50, 375), f"TEL {p[3]}  携帯 {p[4]}", font=font(24), fill=(50, 50, 50))
    d.text((50, 420), f"E-mail {p[5]}", font=font(24), fill=(50, 50, 50))
    bg = Image.new("RGB", (1400, 1000), (92, 78, 64))  # 木の机のような背景
    # 左上から右下へ暗くなる影
    shade = Image.linear_gradient("L").resize((1400, 1000)).point(lambda v: int(v * 0.55))
    bg = Image.composite(Image.new("RGB", bg.size, (30, 24, 18)), bg, shade)
    card = card.rotate(7, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    mask = Image.new("L", (910, 550), 255).rotate(7, resample=Image.BICUBIC, expand=True)
    bg.paste(card, (220, 180), mask)
    return degrade(bg, angle=0, blur=1.1, contrast=0.85, scale=0.6)


def generate_hard(out: Path) -> list[tuple[str, str]]:
    manifest: list[tuple[str, str]] = []

    def add(rel: str, desc: str) -> Path:
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        manifest.append((rel, desc))
        return p

    x = HARD_PEOPLE[0]
    p = add("かすれた申込書_スキャン.jpg", "強く劣化したスキャン: 氏名・フリガナ・住所・電話・メール")
    img = form_image("会員登録申込書", [
        ("お名前", x[0]), ("フリガナ", x[1]), ("ご住所", x[2]), ("電話番号", x[4]), ("メール", x[5]),
    ], "記入内容は会員管理にのみ利用します。", angle=0)
    degrade(img, angle=4.5, blur=1.4, contrast=0.55, scale=0.5).save(p, quality=35)

    x = HARD_PEOPLE[1]
    p = add("名刺_写真.jpg", "写真に撮った名刺（影・傾き）: 氏名・ローマ字・住所・電話・メール")
    business_card_photo(x, "Yumi Ogawa").save(p, quality=60)

    p = add("崩れた名簿.csv", "表記ゆれの名簿: 空白なしの氏名・半角カナ・全角数字の電話・空欄")
    rows = ["No,お名前,ﾌﾘｶﾞﾅ,TEL,メールアドレス,備考"]
    zen = str.maketrans("0123456789-", "０１２３４５６７８９－")
    full_kana = list("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンー")
    half_kana = list("ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｰ")
    table = dict(zip(full_kana, half_kana))
    # 濁点・半濁点つきの文字は、半角では2文字（ｶﾞ）になる
    table.update({d: table[b] + "ﾞ" for d, b in zip("ガギグゲゴザジズゼゾダヂヅデドバビブベボ", "カキクケコサシスセソタチツテトハヒフヘホ")})
    table.update({d: table[b] + "ﾟ" for d, b in zip("パピプペポ", "ハヒフヘホ")})
    half = str.maketrans(table)
    for i, y in enumerate(HARD_PEOPLE[2:6], 1):
        name = y[0].replace(" ", "") if i % 2 else y[0]
        kana = y[1].translate(half)
        tel = y[4].translate(zen) if i % 2 else y[4]
        mail = "" if i == 3 else y[5]
        rows.append(f"{i},{name},{kana},{tel},{mail},{'要確認' if i == 2 else ''}")
    p.write_text("\n".join(rows) + "\n", encoding="utf-8")

    p = add("全体会議_議事録.docx", "文章の中に25人の氏名（AI が返せる上限 20 人を超える）")
    paras = ["日時: 2025年5月20日 14:00-16:00", "出席者: " + "、".join(MEETING_PEOPLE[:13]) + " ほか"]
    for i in range(13, 25, 2):
        a = MEETING_PEOPLE[i]
        b = MEETING_PEOPLE[i + 1] if i + 1 < 25 else MEETING_PEOPLE[0]
        paras.append(f"{a}さんから進捗の報告があり、{b}さんが来月までに資料をまとめることになった。")
    write_docx(p, "全体会議 議事録", paras)

    x = HARD_PEOPLE[3]
    p = add("問い合わせメール.txt", "メール本文の署名欄: 氏名・郵便番号つき住所・電話・メール")
    p.write_text(
        "件名: 資料送付のお願い\n\n"
        "お世話になっております。先日の展示会でお話しした件について、資料をお送りいただけますでしょうか。\n"
        "よろしくお願いいたします。\n\n"
        "--\n"
        f"{x[0]}\n"
        "架空商事株式会社 総務部\n"
        f"〒650-0001 {x[2]}\n"
        f"TEL: {x[3]} / Mobile: {x[4]}\n"
        f"Mail: {x[5]}\n", encoding="utf-8")

    x = HARD_PEOPLE[4]
    p = add("Resume_英文.docx", "英語の履歴書: ローマ字の氏名・国際形式の電話・メール")
    write_docx(p, "Resume", [
        "Name: Daisuke Matsumoto",
        "Phone: +81-80-5566-7788",
        f"Email: {x[5]}",
        "Address: 8-1 Shiken-cho, Naka-ku, Hiroshima, Japan",
        "Career: 2015-2025 Sales Manager, Example Trading Co., Ltd.",
    ])

    x = HARD_PEOPLE[5]
    p = add("提出書類_2ページ.pdf", "スキャン2ページのPDF: 2ページ目に氏名・個人番号・住所・電話")
    cover = Image.new("RGB", (1240, 1754), (250, 249, 244))
    ImageDraw.Draw(cover).text((620, 300), "提出書類（表紙）", font=font(56, True), fill=(20, 20, 20), anchor="mm")
    ImageDraw.Draw(cover).text((620, 420), "人事部 御中", font=font(36), fill=(30, 30, 30), anchor="mm")
    cover = scanned_look(cover, 0.5)
    form = form_image("個人番号 届出書", [
        ("氏名", x[0]), ("個人番号", " ".join([x[6][:4], x[6][4:8], x[6][8:]])), ("住所", x[2]), ("電話番号", x[4]),
    ], "※取扱注意", angle=-1.0)
    cover.save(p, "PDF", resolution=150, save_all=True, append_images=[form])

    p = add("番号っぽいが個人情報ではない.txt", "紛らわしい番号（チェックデジットが合わない）: 個人情報なし")
    p.write_text(
        "出荷管理メモ\n"
        "受注番号: 1234 5678 9010\n"        # 12桁だがマイナンバーのチェックデジットが合わない
        "追跡番号: 4111 1111 1111 1112\n"   # 16桁だがカード番号の Luhn が合わない
        "製品コード: 0120-345-678-9\n"
        "ロット: 2025-0520-0001\n", encoding="utf-8")

    return manifest


def expected_hard() -> dict[str, dict]:
    """難しいテストデータの正解（形式は expected() と同じ）。"""
    hp = HARD_PEOPLE
    zen = str.maketrans("0123456789-", "０１２３４５６７８９－")
    # 崩れた名簿では、奇数行の電話番号を全角で書いている（generate_hard と同じ規則）
    roster_phones = [y[4].translate(zen) if i % 2 else y[4] for i, y in enumerate(hp[2:6], 1)]
    return {
        "かすれた申込書_スキャン.jpg": {"types": ["phone", "email", "address"], "names": [hp[0][0]], "readings": [hp[0][1]],
                                    "secrets": [hp[0][4]],
                                    "risk": ["medium", "high"], "recommendation": ["restrict"],
                                    "ocr": [hp[0][0], hp[0][1], hp[0][2], hp[0][4], hp[0][5]]},
        "名刺_写真.jpg": {"types": ["phone", "email", "address", "postal_code"], "names": [hp[1][0]], "readings": ["Yumi Ogawa"],
                       "secrets": [hp[1][3], hp[1][4]],
                       "risk": ["low", "medium"], "recommendation": ["keep", "restrict", "review"],
                       "ocr": [hp[1][0], "Yumi Ogawa", hp[1][3], hp[1][4], hp[1][5]]},
        "崩れた名簿.csv": {"types": ["phone", "email"], "names": [y[0] for y in hp[2:6]], "secrets": roster_phones,
                         "readings": [y[1] for y in hp[2:6]],  # 正解は全角で持つ（評価の照合では半角・全角の違いを無視する）
                         "risk": ["medium", "high"], "recommendation": ["restrict"]},
        "全体会議_議事録.docx": {"types": [], "names": MEETING_PEOPLE, "readings": [],
                             "risk": ["low", "medium"], "recommendation": ["keep", "review", "restrict"]},
        "問い合わせメール.txt": {"types": ["phone", "email", "address", "postal_code"], "names": [hp[3][0]], "readings": [],
                             "secrets": [hp[3][3], hp[3][4]],
                             "risk": ["medium"], "recommendation": ["restrict", "review", "delete"]},
        "Resume_英文.docx": {"types": ["phone", "email"], "names": ["Daisuke Matsumoto"], "readings": [],
                           "secrets": ["+81-80-5566-7788"],
                           "risk": ["medium", "high"], "recommendation": ["restrict", "review"]},
        "提出書類_2ページ.pdf": {"types": ["mynumber", "phone", "address", "confidential"], "names": [hp[5][0]], "readings": [],
                            "secrets": [hp[5][4]],
                            "risk": ["high"], "recommendation": ["restrict"],
                            "ocr": [hp[5][0], hp[5][6], hp[5][2], hp[5][4]]},
        "番号っぽいが個人情報ではない.txt": {"types": [], "names": [], "readings": [], "risk": ["none", "low"],
                                    "recommendation": ["keep", "archive", "review"]},
    }


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "testdata/sample-files").resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    manifest = generate(out)
    # README はスキャン対象に混ざらないよう、出力フォルダの外に置く
    readme = out.parent / "README_テストデータ.md"
    body = ["# テストデータ（すべて架空）", "",
            "このフォルダの個人情報・機密情報はすべて架空のデモ用データです。", "",
            "| ファイル | 想定している検出内容 |", "|---|---|"]
    body += [f"| {rel} | {desc} |" for rel, desc in manifest]
    readme.write_text("\n".join(body) + "\n", encoding="utf-8")
    # 評価の正解（npm run eval）。生成したファイルと正解の対応が崩れていないかも確かめる
    exp = expected()
    missing = sorted({rel for rel, _ in manifest} ^ set(exp))
    if missing:
        raise SystemExit(f"expected() と生成したファイルが一致しません: {missing}")
    (out.parent / "expected.json").write_text(json.dumps(exp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(manifest)} files -> {out}")
    for rel, desc in manifest:
        print(f"  {rel}  ({desc})")

    # 難しいテストデータ（評価用）。標準のサンプルとは別のフォルダに作る
    hard_out = out.parent / "hard-files"
    if hard_out.exists():
        shutil.rmtree(hard_out)
    hard_out.mkdir(parents=True)
    hard_manifest = generate_hard(hard_out)
    hard_exp = expected_hard()
    missing = sorted({rel for rel, _ in hard_manifest} ^ set(hard_exp))
    if missing:
        raise SystemExit(f"expected_hard() と生成したファイルが一致しません: {missing}")
    (out.parent / "expected-hard.json").write_text(json.dumps(hard_exp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    body += ["", "## 難しいテストデータ（hard-files、評価用）", "",
             "画像の劣化・表の崩れ・上限を超える人数・英語・紛らわしい番号など、AI やルールが間違えやすい形を集めたものです。", "",
             "| ファイル | 難しさ |", "|---|---|"]
    body += [f"| {rel} | {desc} |" for rel, desc in hard_manifest]
    readme.write_text("\n".join(body) + "\n", encoding="utf-8")
    print(f"generated {len(hard_manifest)} files -> {hard_out}")
    for rel, desc in hard_manifest:
        print(f"  {rel}  ({desc})")


if __name__ == "__main__":
    main()
