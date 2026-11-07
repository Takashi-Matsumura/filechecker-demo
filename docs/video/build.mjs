// 紹介動画を組み立てる（社内公開用）。実行: node docs/video/build.mjs [--frames] [--tts=voicevox|say]
//   台本（script.json）の各セリフを、1枚の画面（HTML を Chrome で画像にしたもの）と読み上げ音声にして、ffmpeg でつなぐ。
//   字幕は画面に焼き込み、別に SRT も書き出す。--frames は画面だけを作る（見た目の確認用）。
//   読み上げは VOICEVOX（台本の tts。エンジンを起動しておく）が既定。--tts=say で macOS の読み上げ音声にする。
// 必要なもの: Google Chrome、ffmpeg、VOICEVOX のエンジン（または macOS の say）。出力は docs/video/out/（git には入れない）
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, "out");
const work = path.join(out, "work");
fs.mkdirSync(work, { recursive: true });
const script = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf8"));
const framesOnly = process.argv.includes("--frames");
const ttsArg = process.argv.find((a) => a.startsWith("--tts="))?.slice(6);
const engine = ttsArg ?? script.tts?.engine ?? "say";
if (!["voicevox", "say"].includes(engine)) throw new Error(`--tts は voicevox か say を指定してください: ${engine}`);
// VOICEVOX の音声を使うときは、利用規約に従って「VOICEVOX:キャラクター名」を画面に表示する
const credit = engine === "voicevox" ? `音声：VOICEVOX:${script.tts.speakerName}` : "";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- 画面（HTML）

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; }
body { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif; background: #f6f4f0; color: #1c1917; word-break: auto-phrase; }
.stage { position: absolute; inset: 0 0 150px 0; padding: 80px 120px 40px; display: flex; flex-direction: column; }
.caption { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; background: #1c1917; color: #fafaf9;
  display: flex; align-items: center; justify-content: center; padding: 0 140px; font-size: 40px; line-height: 1.45;
  text-align: center; font-weight: 500; letter-spacing: .02em; text-wrap: balance; }
.brand { position: absolute; top: 34px; right: 56px; font-size: 22px; color: #78716c; letter-spacing: .08em; }
.brand b { color: #0f766e; font-weight: 700; }
.credit { position: absolute; right: 56px; top: 74px; font-size: 20px; color: #78716c; }
/* 画面写真の注目点 */
.view { position: relative; overflow: hidden; }
.hl { position: absolute; border: 6px solid #f97316; border-radius: 14px; box-shadow: 0 0 0 5px rgba(249,115,22,.28); }
.hl.solo { box-shadow: 0 0 0 5px rgba(249,115,22,.28), 0 0 0 4000px rgba(28,25,23,.38); }
.hl span { position: absolute; left: -6px; white-space: nowrap; background: #f97316; color: #fff; font-size: 28px; font-weight: 800;
  padding: 6px 18px; border-radius: 10px; box-shadow: 0 6px 16px rgba(28,25,23,.25); }
.hl span.above { bottom: calc(100% + 12px); }
.hl span.below { top: calc(100% + 12px); }
.hl span.right { left: auto; right: -6px; }
h1 { font-size: 66px; font-weight: 800; letter-spacing: .01em; line-height: 1.25; text-wrap: balance; }
.bar { width: 120px; height: 10px; border-radius: 5px; background: #0f766e; margin: 28px 0 56px; }
ul.bullets { list-style: none; display: flex; flex-direction: column; gap: 34px; }
ul.bullets li { font-size: 48px; font-weight: 600; display: flex; align-items: center; gap: 30px; line-height: 1.35; }
ul.bullets li::before { content: ""; flex: none; width: 22px; height: 22px; border-radius: 50%; background: #0f766e; }
/* タイトル */
.title { align-items: center; justify-content: center; text-align: center; }
.title .kicker { font-size: 30px; color: #0f766e; font-weight: 700; letter-spacing: .3em; margin-bottom: 36px; }
.title h1 { font-size: 92px; }
.title .sub { margin-top: 44px; font-size: 48px; color: #0f766e; font-weight: 700; }
/* 手順 */
.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 36px; margin-top: 20px; }
.step { background: #fff; border-radius: 28px; padding: 48px 36px; box-shadow: 0 10px 30px rgba(28,25,23,.08); min-height: 440px; }
.step .n { width: 84px; height: 84px; border-radius: 50%; background: #0f766e; color: #fff; font-size: 46px; font-weight: 800;
  display: flex; align-items: center; justify-content: center; }
.step h2 { font-size: 46px; margin: 40px 0 24px; font-weight: 800; line-height: 1.3; }
.step p { font-size: 34px; color: #57534e; line-height: 1.5; font-weight: 500; }
/* 画面 */
.screen { padding: 56px 120px 36px; }
.chip { align-self: flex-start; background: #0f766e; color: #fff; font-size: 44px; font-weight: 800; padding: 16px 40px; border-radius: 999px; }
.shot { flex: 1; margin-top: 34px; display: flex; align-items: center; justify-content: center; min-height: 0; }
.window { border-radius: 22px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(28,25,23,.18);
  display: flex; flex-direction: column; border: 1px solid #e7e5e4; }
.window .top { height: 44px; background: #e7e5e4; display: flex; align-items: center; gap: 12px; padding: 0 20px; flex: none; }
.window .top i { width: 16px; height: 16px; border-radius: 50%; background: #a8a29e; display: block; }
.window .view { background-repeat: no-repeat; }
/* ローカル AI */
.local { display: grid; grid-template-columns: 900px 1fr; gap: 60px; align-items: center; flex: 1; }
.diagram { position: relative; height: 560px; }
.pc { position: absolute; left: 0; top: 70px; width: 470px; height: 420px; border: 8px solid #0f766e; border-radius: 34px; background: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; }
.pc .label { position: absolute; top: -36px; left: 30px; background: #f6f4f0; padding: 0 16px; font-size: 34px; font-weight: 800; color: #0f766e; }
.pill { font-size: 36px; font-weight: 800; padding: 22px 34px; border-radius: 20px; }
.pill.ai { background: #ccfbf1; color: #115e59; }
.pill.file { background: #f5f5f4; color: #44403c; }
.cloud { position: absolute; left: 650px; top: 205px; width: 230px; height: 150px; border: 6px dashed #a8a29e; border-radius: 80px;
  display: flex; align-items: center; justify-content: center; font-size: 28px; color: #78716c; font-weight: 700; text-align: center; line-height: 1.3; }
.cross { position: absolute; left: 515px; top: 215px; font-size: 96px; color: #dc2626; font-weight: 900; }
.local ul.bullets li { font-size: 40px; text-wrap: balance; }
/* 二段構え */
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; margin-top: 10px; }
.col { background: #fff; border-radius: 28px; padding: 50px 56px; box-shadow: 0 10px 30px rgba(28,25,23,.08); }
.col h2 { font-size: 46px; font-weight: 800; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 4px solid #e7e5e4; }
.col.ai h2 { color: #0f766e; }
.col ul { list-style: none; display: flex; flex-direction: column; gap: 26px; }
.col li { font-size: 40px; font-weight: 600; padding-left: 44px; position: relative; line-height: 1.4; }
.col li::before { content: "✓"; position: absolute; left: 0; color: #0f766e; font-weight: 900; }
/* 注意 */
body.caution { background: #fffbeb; }
.caution .warn { display: flex; align-items: center; gap: 34px; }
.caution .icon { flex: none; width: 110px; height: 110px; border-radius: 28px; background: #d97706; color: #fff; font-size: 74px; font-weight: 900;
  display: flex; align-items: center; justify-content: center; }
.caution h1 { color: #78350f; }
.caution .bar { background: #d97706; }
.caution ul.bullets li::before { background: #d97706; }
/* 番号つき */
ol.numbered { list-style: none; display: flex; flex-direction: column; gap: 36px; }
ol.numbered li { display: flex; align-items: center; gap: 36px; font-size: 48px; font-weight: 700; line-height: 1.35; }
ol.numbered li span { flex: none; width: 80px; height: 80px; border-radius: 50%; background: #0f766e; color: #fff; font-size: 42px;
  display: flex; align-items: center; justify-content: center; font-weight: 800; }
`;

function stage(scene, line) {
  switch (scene.type) {
    case "title":
      return `<div class="stage title"><div class="kicker">社内向けのご紹介</div><h1>${esc(scene.title)}</h1><div class="sub">${esc(scene.subtitle)}</div></div>`;
    case "slide":
      return `<div class="stage"><h1>${esc(scene.title)}</h1><div class="bar"></div><ul class="bullets">${scene.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`;
    case "steps":
      return `<div class="stage"><h1>${esc(scene.title)}</h1><div class="bar"></div><div class="steps">${scene.steps
        .map((s, i) => `<div class="step"><div class="n">${i + 1}</div><h2>${esc(s.head)}</h2><p>${esc(s.body)}</p></div>`)
        .join("")}</div></div>`;
    case "screen": {
      // 画面写真の見せたい部分（crop、元の画像の px）を、場面の枠に収まる大きさで映す
      const file = path.join(dir, scene.image);
      const png = fs.readFileSync(file);
      const [iw, ih] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      // 部品の位置（capture.mjs が画面写真と同じ名前の JSON に書き出したもの）
      const boxesFile = file.replace(/\.png$/, ".json");
      const boxes = fs.existsSync(boxesFile) ? JSON.parse(fs.readFileSync(boxesFile, "utf8")) : {};
      for (const name of [...(line.focus ?? []), ...(line.zoom ? [line.zoom] : [])]) {
        if (!boxes[name]) throw new Error(`${scene.id}: 部品 ${name} の位置がありません（capture.mjs で撮り直してください）`);
      }
      const c = line.zoom ? zoomCrop(boxes[line.zoom], iw, ih) : (scene.crop ?? { x: 0, y: 0, w: iw, h: ih });
      const scale = Math.min(1680 / c.w, 680 / c.h);
      const vw = Math.round(c.w * scale);
      const vh = Math.round(c.h * scale);
      const view = `width:${vw}px;height:${vh}px;background-image:url('${file}');` +
        `background-size:${Math.round(iw * scale)}px ${Math.round(ih * scale)}px;background-position:-${Math.round(c.x * scale)}px -${Math.round(c.y * scale)}px;`;
      const focus = line.focus ?? [];
      const marks = focus
        .map((name, i) => {
          const b = boxes[name];
          const pad = 8;
          const x = (b.x - c.x) * scale - pad;
          const y = (b.y - c.y) * scale - pad;
          const w = b.w * scale + pad * 2;
          const h = b.h * scale + pad * 2;
          const label = scene.labels?.[name];
          // 吹き出しは、上に余白があれば上、なければ下。枠が複数なら、重ならないよう 2 つ目は下にする。右寄りの部品は右端にそろえる
          const vertical = focus.length > 1 && i % 2 === 1 ? "below" : y > 70 ? "above" : "below";
          const pos = `${vertical}${x + w / 2 > vw * 0.6 ? " right" : ""}`;
          return `<div class="hl ${focus.length === 1 ? "solo" : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">${label ? `<span class="${pos}">${esc(label)}</span>` : ""}</div>`;
        })
        .join("");
      return `<div class="stage screen"><div class="chip">${esc(scene.title)}</div><div class="shot"><div class="window"><div class="top"><i></i><i></i><i></i></div><div class="view" style="${view}">${marks}</div></div></div></div>`;
    }
    case "local":
      return `<div class="stage"><h1>${esc(scene.title)}</h1><div class="bar"></div><div class="local"><div class="diagram">
        <div class="pc"><div class="label">この PC</div><div class="pill ai">ローカル AI</div><div class="pill file">棚卸しするファイル</div></div>
        <div class="cross">✕</div><div class="cloud">インターネット<br>（社外の AI）</div></div>
        <ul class="bullets">${scene.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div></div>`;
    case "columns":
      return `<div class="stage"><h1>${esc(scene.title)}</h1><div class="bar"></div><div class="columns">${scene.columns
        .map((c, i) => `<div class="col ${i === 1 ? "ai" : ""}"><h2>${esc(c.head)}</h2><ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`)
        .join("")}</div></div>`;
    case "caution":
      return `<div class="stage caution"><div class="warn"><div class="icon">!</div><h1>${esc(scene.title)}</h1></div><div class="bar"></div><ul class="bullets">${scene.bullets
        .map((b) => `<li>${esc(b)}</li>`)
        .join("")}</ul></div>`;
    case "numbered":
      return `<div class="stage"><h1>${esc(scene.title)}</h1><div class="bar"></div><ol class="numbered">${scene.items
        .map((x, i) => `<li><span>${i + 1}</span>${esc(x)}</li>`)
        .join("")}</ol></div>`;
    default:
      throw new Error(`未対応の場面: ${scene.type}`);
  }
}

/** 部品を拡大して見せるときの切り抜き（部品の周りに余白をとり、場面の枠の縦横比にそろえる） */
function zoomCrop(b, iw, ih) {
  const aspect = 1680 / 680;
  let w = b.w + 240;
  let h = b.h + 240;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  w = Math.min(w, iw);
  h = Math.min(h, ih);
  const x = Math.min(Math.max(0, b.x + b.w / 2 - w / 2), iw - w);
  const y = Math.min(Math.max(0, b.y + b.h / 2 - h / 2), ih - h);
  return { x, y, w, h };
}

function page(scene, line) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body class="${scene.type === "caution" ? "caution" : ""}"><div class="brand"><b>ファイル棚卸しアシスタント</b></div>${stage(scene, line)}${
    credit ? `<div class="credit">${esc(credit)}</div>` : ""
  }<div class="caption">${esc(line.text)}</div></body></html>`;
}

function renderFrame(html, png) {
  const file = png.replace(/\.png$/, ".html");
  fs.writeFileSync(file, html);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1920,1080", `--screenshot=${png}`, `file://${file}`], {
    stdio: "ignore",
  });
}

// ---------------------------------------------------------------- 音声と動画

const duration = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** セリフを読み上げて音声ファイルにする。返すのはファイルのパス */
async function speak(text, base) {
  // 読み上げ音声が読み違える語は、台本の readings（エンジンごと）で読み方を指定する（字幕は表記のまま）
  let spoken = text;
  for (const [word, yomi] of Object.entries(script.readings?.[engine] ?? {})) spoken = spoken.split(word).join(yomi);
  if (engine === "say") {
    execFileSync("say", ["-v", script.say.voice, "-r", String(script.say.rate), "-o", `${base}.aiff`, spoken]);
    return `${base}.aiff`;
  }
  const { url, speaker, speedScale } = script.tts;
  // エンジンが接続を切ることがあるので、少し待って 3 回まで試し直す
  const call = async (pathAndQuery, init) => {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${url}${pathAndQuery}`, { method: "POST", ...init });
        if (res.ok) return res;
        last = new Error(`HTTP ${res.status}`);
      } catch (e) {
        last = e;
      }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    throw new Error(`VOICEVOX のエンジン（${url}）を呼べません（${last?.message ?? last}）。起動するか、--tts=say を指定してください`);
  };
  const query = await (await call(`/audio_query?${new URLSearchParams({ text: spoken, speaker: String(speaker) })}`)).json();
  query.speedScale = speedScale ?? 1;
  query.prePhonemeLength = 0.1;
  query.postPhonemeLength = 0.1;
  const r = await call(`/synthesis?speaker=${speaker}`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  fs.writeFileSync(`${base}.wav`, Buffer.from(await r.arrayBuffer()));
  return `${base}.wav`;
}

// 前回の出力（音声ファイル）が混ざらないよう、作業フォルダを空にしてから作る
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const segments = [];
const srt = [];
let t = 0;
for (const [si, scene] of script.scenes.entries()) {
  for (const [li, raw] of scene.lines.entries()) {
    // セリフは文字列か、{ text, focus（枠を付ける部品）, zoom（拡大する部品） }
    const line = typeof raw === "string" ? { text: raw } : raw;
    const base = path.join(work, `${String(si).padStart(2, "0")}-${scene.id}-${li}`);
    renderFrame(page(scene, line), `${base}.png`);
    if (framesOnly) continue;
    const shown = line.text;
    const audio = await speak(shown, base);
    const speech = duration(audio);
    // セリフの後の間。場面の最後は長めにとる
    const pad = li === scene.lines.length - 1 ? 0.9 : 0.35;
    const len = speech + pad;
    execFileSync("ffmpeg", [
      "-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", `${base}.png`, "-i", audio,
      "-filter_complex", `[1:a]apad=pad_dur=${pad},aresample=48000[a]`, "-map", "0:v", "-map", "[a]", "-t", len.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "160k", "-ac", "2", `${base}.mp4`,
    ]);
    segments.push(`${base}.mp4`);
    srt.push(`${srt.length + 1}\n${srtTime(t)} --> ${srtTime(t + speech)}\n${shown}\n`);
    t += len;
  }
  console.log(`場面 ${si + 1}/${script.scenes.length}: ${scene.id}`);
}

if (!framesOnly) {
  const list = path.join(work, "list.txt");
  fs.writeFileSync(list, segments.map((s) => `file '${s}'`).join("\n"));
  const video = path.join(out, "intro.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", video]);
  fs.writeFileSync(path.join(out, "intro.srt"), srt.join("\n"));
  console.log(`できました: ${video}（${Math.round(t)} 秒、音声: ${engine}）`);
}
