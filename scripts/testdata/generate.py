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
from PIL import Image, ImageDraw, ImageFilter, ImageFont
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
    lines = [
        f"氏名  {p[0]}",
        "生年月日  昭和60年 5月 20日生",
        f"住所  {p[2]}",
        "交付  令和 5年 6月 1日",
        "番号  第 123456789012 号",
    ]
    for i, t in enumerate(lines):
        d.text((40, 130 + i * 70), t, font=font(30), fill=(20, 20, 20))
    d.rectangle([w - 300, 130, w - 50, 450], fill=(200, 205, 210), outline=(90, 90, 90), width=3)
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


if __name__ == "__main__":
    main()
