// 紹介動画に使うアプリの画面を撮る。実行: node docs/video/capture.mjs <step> [scanId] [fileId]
//   step: picker（フォルダの選択画面） / progress（処理中） / todo（やることリスト） / detail（ファイルの詳細）
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

async function shoot(name) {
  await anonymize();
  await sleep(300);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`撮りました: shots/${name}.png`);
}

try {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 860, deviceScaleFactor: 1.5, mobile: false });
  if (step === "picker") {
    await open(BASE, "フォルダを選ぶ");
    // 入力欄にテストデータのフォルダを入れてから、選択画面を開く（React の入力欄なので、値の設定とイベントを両方行う）
    await evaluate(`(() => {
      const input = document.querySelector("input[type=text], input:not([type])");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, ${JSON.stringify(SAMPLE)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(300);
    await evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("フォルダを選ぶ")).click()`);
    for (let i = 0; i < 50 && !(await evaluate(`document.body.innerText.includes("このフォルダを選ぶ") && document.body.innerText.includes("営業部")`)); i++) await sleep(200);
    await shoot("folder-picker");
  } else if (step === "progress") {
    await open(`${BASE}/scans/${scanId}`, "処理");
    await sleep(2500);
    await shoot("progress");
  } else if (step === "todo") {
    await open(`${BASE}/scans/${scanId}`, "やること");
    await sleep(1500);
    await shoot("todo");
  } else if (step === "detail") {
    await open(`${BASE}/scans/${scanId}/files/${fileId}`, "プレビュー");
    await sleep(1500);
    await shoot("detail");
  } else {
    throw new Error("step には picker / progress / todo / detail のいずれかを指定してください");
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
