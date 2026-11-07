# 紹介動画（社内公開用）

このアプリで何ができるか、なぜローカル AI を使うのか、AI の限界と、利用者が最終的に責任を持って棚卸しをすることを伝える約 5 分の動画です。

| ファイル | 内容 |
|---|---|
| `script.json` | 台本。場面ごとの画面の内容と、ナレーション（字幕と同じ文）。`readings` は読み上げ音声が読み違える語の読み方 |
| `build.mjs` | 台本から動画を組み立てる。各セリフを 1 枚の画面（HTML を Chrome で画像にしたもの）と macOS の読み上げ音声（Kyoko）にして、ffmpeg でつなぐ |
| `capture.mjs` | アプリの画面を撮る（dev サーバを Chrome のヘッドレスで開く）。架空のテストデータだけを写し、ホームのパスのユーザー名は表示だけ置き換える |
| `shots/` | 撮ったアプリの画面（架空のテストデータの棚卸し結果） |
| `out/` | 出力（`intro.mp4` と字幕の `intro.srt`）。git には入れない |

## 作り直す

必要なもの: macOS（`say`）、Google Chrome、ffmpeg。

```bash
node docs/video/build.mjs            # 動画を作る（2〜3 分）。docs/video/out/intro.mp4 と intro.srt
node docs/video/build.mjs --frames   # 画面だけを作る（見た目の確認用）。docs/video/out/work/*.png
```

アプリの画面を撮り直すとき（dev サーバを起動し、`testdata/sample-files` を棚卸ししておく）:

```bash
node docs/video/capture.mjs picker              # フォルダの選択画面
node docs/video/capture.mjs progress <scanId>   # 処理中（棚卸しの途中で撮る）
node docs/video/capture.mjs todo <scanId>       # やることリスト
node docs/video/capture.mjs detail <scanId> <fileId>   # ファイルの詳細
```

台本を直したら、読み上げの読み違いがないかを確かめてください（このマシンでは whisper-server で書き起こして確認しました。「AI」を「アイ」、「済」を「さい」、「身分証」を「みぶんあかし」と読み違えたため、`readings` で直しています）。
