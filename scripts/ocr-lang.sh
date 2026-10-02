#!/usr/bin/env bash
# 给 OCR 装中文语言包（不需要 sudo）。
#
# tesseract 只带 eng。中文要额外的 traineddata；系统包要 sudo，
# 所以这里把语言包下到 data/tessdata/（不进 Git），extract.py 会自动用它。
#
#   pnpm ocr:lang          简体 + 繁体 + 英文
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${EXAMHARNESS_TESSDATA:-$ROOT/data/tessdata}"
BASE="https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main"
mkdir -p "$DEST"

# 小文件 = 上次下载断了（语言包都在 2 MB 以上）：删掉重下，断点续传 + 重试
for lang in chi_sim chi_tra eng; do
  file="$DEST/$lang.traineddata"
  size=$(stat -c %s "$file" 2>/dev/null || echo 0)
  if [ "$size" -gt 500000 ]; then
    echo "已有 $lang（$((size / 1024)) KB）"
    continue
  fi
  rm -f "$file"
  echo "下载 $lang…"
  curl -fsSL --retry 3 --retry-delay 2 -C - "$BASE/$lang.traineddata" -o "$file"
  got=$(stat -c %s "$file" 2>/dev/null || echo 0)
  if [ "$got" -le 500000 ]; then
    echo "！$lang 只有 $((got / 1024)) KB，看起来没下完：网络太慢就再跑一次 pnpm ocr:lang" >&2
    exit 1
  fi
done

ls -lh "$DEST"
echo "完成。extract.py 会自动优先用这里的语言包（$DEST）。"
