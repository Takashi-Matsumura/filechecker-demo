// 紹介動画に使うアプリの画面を撮る。実行: node docs/video/capture.mjs <step> [scanId] [fileId]
//   step: home（開始画面） / picker（フォルダの選択画面） / progress（処理中） / todo（やることリスト） /
//         bottom（やることリストの下） / detail（ファイルの詳細） / preview（詳細の中身のプレビュー）
// 撮った画面ごとに、動画で枠を付ける部品の位置（画像の px）を shots/<名前>.json に書き出す。
// 動いている dev サーバ（http://localhost:3000）を、Chrome（ヘッドレス）で開いて撮る。
// 撮る画面には架空のテストデータ（testdata/sample-files）だけを出す。ホームのパスに入るユーザー名は、撮る前に表示だけ置き換える。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(dir, "shots");
fs.mkdirSync(shots, { recursive: true });
const [step, scanId, fileId] = process.argv.slice(2);
const BASE = "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const HOME = os.homedir();
const SAMPLE = path.join(dir, "../../testdata/sample-files");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fc-capture-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1440,860", "about:blank"], { stdio: "ignore" });

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pageTarget = list.find((t) => t.type === "page");
      if (pageTarget) {
        ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r, { once: true }));
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(ev.data);
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        });
        return;
      }
    } catch {
      // Chrome の起動を待つ
    }
    await sleep(200);
  }
  throw new Error("Chrome に接続できません");
}

async function open(url, waitText) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (await evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(waitText)})`)) return;
  }
  throw new Error(`表示されません: ${waitText}`);
}

/** 画面のパスに入るユーザー名を、架空の名前に置き換える（表示だけ） */
const anonymize = () =>
  evaluate(`(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) if (n.nodeValue.includes(${JSON.stringify(HOME)})) n.nodeValue = n.nodeValue.split(${JSON.stringify(HOME)}).join("/Users/taro");
    for (const el of document.querySelectorAll("input")) if (el.value.includes(${JSON.stringify(HOME)})) el.value = el.value.split(${JSON.stringify(HOME)}).join("/Users/taro");
    // 開発用の表示（Next.js の印）は写さない
    for (const el of document.querySelectorAll("nextjs-portal")) el.remove();
  })()`);

const SCALE = 1.5;

/**
 * 画面を撮り、boxes（名前 → 部品を返す式）の部品の位置を JSON に書き出す。
 * 式の中では find(セレクタ, 文字) が使える（その文字を含む、いちばん内側の要素）
 */
async function shoot(name, boxes = {}) {
  await anonymize();
  await sleep(300);
  const found = await evaluate(`(() => {
    const find = (sel, text) => {
      const all = [...document.querySelectorAll(sel)].filter((el) => !text || el.innerText.includes(text));
      return all.find((el) => !all.some((o) => o !== el && el.contains(o))) ?? null;
    };
    const out = {};
    for (const [key, expr] of Object.entries(${JSON.stringify(boxes)})) {
      const el = eval(expr);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[key] = { x: Math.round(r.x * ${SCALE}), y: Math.round(r.y * ${SCALE}), w: Math.round(r.width * ${SCALE}), h: Math.round(r.height * ${SCALE}) };
    }
    return out;
  })()`);
  const missing = Object.keys(boxes).filter((k) => !found[k]);
  if (missing.length) console.warn(`見つからない部品: ${missing.join(", ")}`);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, "base64"));
  fs.writeFileSync(path.join(shots, `${name}.json`), JSON.stringify(found, null, 2) + "\n");
  console.log(`撮りました: shots/${name}.png（部品 ${Object.keys(found).length} 個）`);
}

/** 開始画面の入力欄に、テストデータのフォルダを入れる（React の入力欄なので、値の設定とイベントを両方行う） */
async function setFolder() {
  await evaluate(`(() => {
    const input = document.querySelector("input[type=text], input:not([type])");
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, ${JSON.stringify(SAMPLE)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(300);
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 860, deviceScaleFactor: SCALE, mobile: false });
  if (step === "home") {
    await open(BASE, "フォルダを選ぶ");
    await setFolder();
    await shoot("home", {
      folder: `find("button", "フォルダを選ぶ")`,
      start: `find("button", "棚卸しを開始")`,
      llm: `find("div,p", "ローカル LLM 接続中")`,
      local: `find("span", "完全ローカル処理")`,
    });
  } else if (step === "picker") {
    await open(BASE, "フォルダを選ぶ");
    await setFolder();
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("フォルダを選ぶ")).click()`);
    for (let i = 0; i < 50 && !(await evaluate(`document.body.innerText.includes("このフォルダを選ぶ") && document.body.innerText.includes("営業部")`)); i++) await sleep(200);
    await shoot("folder-picker", {
      roots: `document.querySelector('nav[aria-label="場所"]')`,
      folders: `find("ul", "営業部")`,
      select: `find("button", "このフォルダを選ぶ")`,
    });
  } else if (step === "progress") {
    await open(`${BASE}/scans/${scanId}`, "処理");
    await sleep(2500);
    await shoot("progress", {
      files: `document.querySelector('ul[aria-label="処理中のファイル"]')`,
      last: `find("p", "最後の動き")`,
      pause: `find("button", "中断")`,
      bar: `document.querySelector('[aria-label="解析の進み具合"]')`,
    });
  } else if (step === "todo") {
    await open(`${BASE}/scans/${scanId}`, "やること");
    await sleep(1500);
    await shoot("todo", {
      // 「まずこの N 件」の枠（その文字と「済」のボタンを両方含む、いちばん内側の要素）
      top3: `[...document.querySelectorAll("div")].filter((d) => d.innerText.includes("まずこの") && d.querySelector('button[aria-label="対応済みにする"]')).pop()`,
      filters: `document.querySelector('[aria-label="表示の絞り込み"]')`,
      done: `document.querySelector('button[aria-label="対応済みにする"]')`,
      skip: `document.querySelector('button[aria-label="対応しない"]')`,
      preview: `document.querySelector('a[title="詳細とプレビューを見る"]')`,
      reveal: `document.querySelector('button[aria-label^="Finder"], button[aria-label^="エクスプローラー"], button[aria-label^="フォルダを開く"]')`,
      badge: `find("span", "マイナンバー")`,
    });
  } else if (step === "bottom") {
    await open(`${BASE}/scans/${scanId}`, "やること");
    await sleep(1500);
    await evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await sleep(800);
    await shoot("bottom", { ok: `find("p", "問題が見つからなかったファイル")` });
  } else if (step === "detail") {
    await open(`${BASE}/scans/${scanId}/files/${fileId}`, "プレビュー");
    await sleep(1500);
    await shoot("detail", {
      ai: `[...document.querySelectorAll("div, section")].filter((d) => d.innerText.includes("AI の判断") && d.innerText.includes("推奨アクション") && !d.innerText.includes("検出された情報")).shift()`,
      recommend: `find("div", "推奨アクション")`,
      note: `find("p", "AI の判断は参考情報です")`,
      found: `[...document.querySelectorAll("div, section")].filter((d) => d.innerText.includes("検出された情報") && !d.innerText.includes("AI の判断")).shift()`,
      risk: `find("span", "高")`,
    });
  } else if (step === "preview") {
    await open(`${BASE}/scans/${scanId}/files/${fileId}`, "プレビュー");
    await sleep(1500);
    await evaluate(`document.getElementById("preview")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -24)`);
    await sleep(800);
    await shoot("preview", {
      chips: `find("div", "押すたびに")`,
      section: `document.getElementById("preview")`,
      saved: `find("p,span,div", "この内容は保存しません")`,
    });
  } else {
    throw new Error("step には home / picker / progress / todo / bottom / detail / preview のいずれかを指定してください");
  }
} finally {
  ws?.close();
  // Chrome が終わってから一時フォルダを消す（終わる前だと、書き込み中のファイルが残って消せない）
  await new Promise((r) => {
    chrome.once("exit", r);
    chrome.kill();
  });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
