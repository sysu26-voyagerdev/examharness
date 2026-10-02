#!/usr/bin/env bash
# 虚拟环境：给 agent 的工作区准备一个「能干活」的 python。
#
#   pnpm venv              建 .venv 并装上清单里的库（默认清单见下）
#   pnpm venv:add pdfplumber  再装一个库（人的决定，不是 agent 的决定）
#   pnpm venv:status       看看现在有什么
#
# 为什么要有这个：真实资料是 PDF / docx / xlsx / 扫描件，标准库解不了；
# 而这些转换**不该写死在仓库里**（格式千奇百怪），交给 agent 在工作区里跑脚本更实在。
# 装什么是老师决定的：agent 默认不许 pip install（cordis.yml 的 workspace.allowInstall）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VENV="${EXAMHARNESS_VENV:-.venv}"
PY="${PYTHON:-python3}"

# 默认清单：体积小、纯 wheel、够处理常见教研资料
DEFAULT_PKGS=(
  pdfplumber     # PDF：有文字层的直接抽文本，还能读表格
  python-docx    # .docx：读段落与表格
  openpyxl       # .xlsx：读单元格
  chardet        # 编码猜一猜（老资料的 GBK/GB18030）
)

info() { printf '%s\n' "$*"; }

status() {
  if [ -x "$VENV/bin/python3" ]; then
    info "虚拟环境：$VENV"
    info "python：$("$VENV/bin/python3" -V 2>&1)"
    "$VENV/bin/pip" list --format=columns 2>/dev/null | sed -n '1,40p' || true
  else
    info "还没有虚拟环境（$VENV 不存在）。跑：pnpm venv"
  fi
}

ensure_venv() {
  if [ -x "$VENV/bin/python3" ]; then return; fi
  info "创建虚拟环境：$VENV（用 $PY）"
  "$PY" -m venv "$VENV"
  "$VENV/bin/python3" -m pip install --quiet --upgrade pip
}

case "${1:-}" in
  --status)
    status
    ;;
  --add)
    shift
    [ "$#" -gt 0 ] || { info "用法：pnpm venv:add <包名> [...]"; exit 1; }
    ensure_venv
    info "安装：$*"
    "$VENV/bin/pip" install "$@"
    ;;
  *)
    ensure_venv
    info "安装默认清单：${DEFAULT_PKGS[*]}"
    "$VENV/bin/pip" install "${DEFAULT_PKGS[@]}"
    info ""
    info "完成。agent 的 ws_run 里 python3 / pip 会优先用这个环境。"
    info "扫描件要 OCR 的话还要系统包（tesseract + tesseract-ocr-chi-sim），装好再用 pytesseract。"
    ;;
esac
