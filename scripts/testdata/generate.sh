#!/usr/bin/env bash
# デモ用テストデータを生成する（すべて架空データ）
set -euo pipefail
cd "$(dirname "$0")/../.."
VENV=scripts/testdata/.venv
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r scripts/testdata/requirements.txt
fi
"$VENV/bin/python" scripts/testdata/generate.py "${1:-testdata/sample-files}"
