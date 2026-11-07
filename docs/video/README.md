# 紹介動画（社内公開用）

このアプリで何ができるか、なぜローカル AI を使うのか、AI の限界と、利用者が最終的に責任を持って棚卸しをすることを伝える約 6 分の動画です。実際の操作画面に、セリフに合わせて注目点（オレンジの枠と吹き出し）を重ね、小さな表示は拡大して見せます。アプリの「紹介動画」の画面（`/guide`）で再生できます。

| ファイル | 内容 |
|---|---|
| `script.json` | 台本。場面ごとの画面の内容とセリフ（字幕と読み上げに使う）。操作画面の場面は、セリフごとに `focus`（枠を付ける部品）と `zoom`（拡大する部品）を指定する。`tts` は読み上げの設定、`readings` は読み違える語の読み方（エンジンごと） |
| `build.mjs` | 台本から動画を組み立てる。各セリフを 1 枚の画面（HTML を Chrome で画像にしたもの）と読み上げ音声にして、ffmpeg でつなぐ |
| `capture.mjs` | アプリの画面を撮る（dev サーバを Chrome のヘッドレスで開く）。部品の位置を `shots/<名前>.json` に書き出す。架空のテストデータだけを写し、ホームのパスのユーザー名は表示だけ置き換える |
| `shots/` | 撮ったアプリの画面と部品の位置（架空のテストデータの棚卸し結果） |
| `out/` | 出力（`intro.mp4`、字幕の `intro.srt`、トップ画面のサムネイル `intro.jpg`）。git には入れない |

## 作り直す

必要なもの: Google Chrome、ffmpeg、VOICEVOX のエンジン（または macOS の `say`）。

```bash
node docs/video/build.mjs            # VOICEVOX で作る（3〜4 分）。docs/video/out/intro.mp4 と intro.srt
node docs/video/build.mjs --tts=say  # macOS の読み上げ音声で作る
node docs/video/build.mjs --frames   # 画面だけを作る（見た目の確認用）。docs/video/out/work/*.png
```

### 読み上げ（VOICEVOX）

- 既定は VOICEVOX のエンジン（`http://127.0.0.1:50021`）、話者は No.7（アナウンス、ID 30）、速さ 1.1 倍です。`script.json` の `tts` で変えられます（話者の一覧は `curl http://127.0.0.1:50021/speakers`）。
- VOICEVOX の音声を使うときは、利用規約に従って画面の右上に「音声：VOICEVOX:キャラクター名」を表示します。話者を変えたら `tts.speakerName` も変えてください。キャラクターごとの利用規約も確認してください。
- 台本を直したら、読み違いがないかを確かめてください。このマシンでは whisper-server で書き起こして確認しました（VOICEVOX は「済」を別の読みにすることがあったため、`readings.voicevox` で「すみ」と指定しています。macOS の音声は「AI」「済」「身分証」を読み違えました）。

### アプリの画面を撮り直す

dev サーバを起動し、`testdata/sample-files` を棚卸ししておきます（処理中の画面は、棚卸しの途中で撮ります）。

```bash
node docs/video/capture.mjs home                     # 開始画面
node docs/video/capture.mjs picker                   # フォルダの選択画面
node docs/video/capture.mjs progress <scanId>        # 処理中
node docs/video/capture.mjs todo <scanId>            # やることリスト
node docs/video/capture.mjs bottom <scanId>          # やることリストの下（問題が見つからなかったファイル）
node docs/video/capture.mjs detail <scanId> <fileId> # ファイルの詳細（顧客名簿_2025.xlsx を使っている）
node docs/video/capture.mjs preview <scanId> <fileId># 詳細の中身のプレビュー
```

画面の作りが変わって部品が見つからないときは、`capture.mjs` が「見つからない部品」を表示し、`build.mjs` は止まります。`capture.mjs` の部品の見つけ方を直してください。
