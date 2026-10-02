#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""课标扫描件 → 结构化数据（纯本地，不联网，不用大模型）。

为什么要有它：
    《义务教育数学课程标准》只有扫描 PDF（没有文字层），要拿它做题库/知识图谱的底料，
    就必须先把 189 页图片变成文本，再从文本里抽出「示例题」和「内容要求」两类条目。
    一次性脚本干这活，下次换一版课标（2025 修订版…）又得重写；所以固化成两条子命令。

用法：

    # 1) 整份 OCR（扫描件没有文字层时才需要）
    #    渲染单线程（pdfium 不是线程安全的），OCR 交给线程池（tesseract 是外部进程，能真并行）
    python3 scripts/curriculum.py ocr <pdf> --out <txt> [--workers 8] [--scale 3.0]
                                     [--lang chi_sim+eng] [--pages 1-20] [--psm 6]

    # 2) 从 OCR 文本抽结构，写 JSONL（每行一个 JSON 对象）
    python3 scripts/curriculum.py split --text <txt> --out <jsonl>
                                     [--source 名称] [--kind all|examples|requirements]

    # 3) OCR + 抽取一条龙（多本一起给也行）
    python3 scripts/curriculum.py build <pdf> [<pdf> ...] --outdir data/curriculum

产出（split / build）：
    每行一个 JSON 对象，用 "kind" 区分两类：
      {"kind": "example",     "source": ..., "page": N, "example_no": "例 1",
       "stem": "...", "answer": "..."?, "knowledge": [...]}
      {"kind": "requirement", "source": ..., "page": N, "section": "...",
       "requirement": "..."}
    抽不准的字段宁缺勿造：缺就整个字段不出现，绝不用空字符串占位。

约定：
    * OCR 文本里每页都插一行「（第 N 页）」标记 —— 页码定位靠它最稳（OCR 出来的页眉页码会认错）。
    * 依赖只有已装好的 pypdfium2 + 系统 tesseract；语言包默认用仓库的 data/tessdata。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# ---------------------------------------------------------------- 公共小工具

REPO_ROOT = Path(__file__).resolve().parent.parent

# 每页开头插的页码标记：split 阶段完全靠它还原页码
PAGE_MARK = "（第 {} 页）"
PAGE_MARK_RE = re.compile(r"^[（(]\s*第\s*(\d+)\s*页\s*[)）]\s*$")


def log(message: str) -> None:
    """进度写到 stderr：stdout 留给 JSON 结果，方便上层管道。"""
    print(message, file=sys.stderr, flush=True)


def tessdata_env() -> dict[str, str]:
    """tesseract 的运行环境。

    两件事：
      1. 仓库自带语言包（data/tessdata）优先——系统包装不了就得 sudo，这里不用。
      2. OMP_THREAD_LIMIT=1：tesseract 内部用 OpenMP 多线程，进程级并行时每个进程再开
         16 个线程会互相抢核，实测 8 页从 16.6s 掉到 3.0s。这是本脚本最快的那个开关。
    """
    env = dict(os.environ)
    env["OMP_THREAD_LIMIT"] = "1"
    if env.get("TESSDATA_PREFIX"):
        return env
    for candidate in (REPO_ROOT / "data" / "tessdata", Path.cwd() / "data" / "tessdata"):
        if candidate.is_dir():
            env["TESSDATA_PREFIX"] = str(candidate)
            break
    return env


def check_tesseract(notes: list[str]) -> list[str]:
    """确认 tesseract 在，并返回可用语言列表。"""
    binary = shutil.which("tesseract")
    if binary is None:
        raise RuntimeError("系统里没有 tesseract：apt install tesseract-ocr")
    out = subprocess.run(
        [binary, "--list-langs"], capture_output=True, text=True, timeout=30, env=tessdata_env()
    )
    langs = [line.strip() for line in out.stdout.splitlines()[1:] if line.strip()]
    if not langs:
        notes.append("tesseract 报告没有任何语言包；中文识别需要 data/tessdata 里的 chi_sim")
    return langs


def parse_pages(spec: str) -> tuple[int, int]:
    """把 "1-20" / "5" / "30-" 解析成 (起页, 止页)；止页 0 表示到末尾。"""
    spec = spec.strip()
    if "-" in spec:
        left, right = spec.split("-", 1)
        start = int(left) if left.strip() else 1
        end = int(right) if right.strip() else 0
    else:
        start = end = int(spec)
    if start < 1:
        start = 1
    if end and end < start:
        raise ValueError(f"页码范围写反了：{spec}")
    return start, end


# ---------------------------------------------------------------- 子命令 ocr

def cmd_ocr(args: argparse.Namespace) -> int:
    """扫描 PDF → 带页码标记的纯文本。"""
    import pypdfium2 as pdfium  # 延迟导入：只跑 split 时不该依赖它

    from concurrent.futures import ThreadPoolExecutor

    pdf_path = Path(args.pdf).expanduser()
    if not pdf_path.is_file():
        log(f"读不到文件：{pdf_path}")
        return 1

    notes: list[str] = []
    langs = check_tesseract(notes)
    for part in args.lang.split("+"):
        if part and part not in langs:
            notes.append(f"语言包 {part} 不在可用列表里（现有：{'、'.join(langs)}）")
    if not any(part in langs for part in args.lang.split("+") if part):
        log(f"没有可用的语言包，退出。现有：{'、'.join(langs)}")
        return 1

    workers = max(1, min(args.workers, 8))  # 上限 8：别把机器打满
    doc = pdfium.PdfDocument(str(pdf_path))
    total_pages = len(doc)
    start, end = parse_pages(args.pages) if args.pages else (1, total_pages)
    end = total_pages if end == 0 else min(end, total_pages)
    start = min(start, total_pages)
    indexes = list(range(start - 1, end))

    log(f"{pdf_path.name}：共 {total_pages} 页，本次 OCR 第 {start}–{end} 页（{len(indexes)} 页），"
        f"线程 {workers}，scale {args.scale}，lang {args.lang}")

    workdir = Path(tempfile.mkdtemp(prefix="curr-ocr-"))
    results: dict[int, str] = {}
    failed: list[int] = []

    def ocr_one(item: tuple[int, Path]) -> tuple[int, str, float]:
        """线程池里跑：只做 tesseract（外部进程），不碰 pdfium 对象。"""
        index, image_path = item
        started = time.time()
        try:
            proc = subprocess.run(
                ["tesseract", str(image_path), "-", "-l", args.lang,
                 "--psm", str(args.psm), "--dpi", str(int(72 * args.scale))],
                capture_output=True, text=True, timeout=600, env=tessdata_env(),
            )
            return index, proc.stdout, time.time() - started
        finally:
            image_path.unlink(missing_ok=True)

    pending: list = []
    ocr_seconds = 0.0
    render_started = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for index in indexes:
            # 渲染 + 存盘放主线程：pdfium 不是线程安全的
            page = doc[index]
            image = page.render(scale=args.scale).to_pil()
            image_path = workdir / f"p{index + 1:04d}.png"
            image.save(image_path)
            image.close()
            pending.append(pool.submit(ocr_one, (index, image_path)))
            # 限制在飞的图片数：别把 /tmp 塞满几百张 PNG
            if len(pending) >= workers * 3:
                index_done, text, seconds = pending.pop(0).result()
                results[index_done] = text
                ocr_seconds += seconds
        for future in pending:
            index_done, text, seconds = future.result()
            results[index_done] = text
            ocr_seconds += seconds
    render_seconds = time.time() - render_started

    # 按页拼装：页码标记独立成行，split 阶段靠它定位
    pieces: list[str] = []
    empty_pages: list[int] = []
    for index in indexes:
        text = results.get(index, "")
        if len(text.strip()) < 10:
            empty_pages.append(index + 1)
            failed.append(index + 1)
        pieces.append(f"{PAGE_MARK.format(index + 1)}\n{text.strip()}")
    body = "\n\n".join(pieces) + "\n"

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(body, encoding="utf-8")

    summary = {
        "ok": True,
        "step": "ocr",
        "pdf": str(pdf_path),
        "out": str(out_path),
        "pages_ocr": len(indexes),
        "pages_total": total_pages,
        "chars": len(body),
        "seconds": round(render_seconds, 1),
        "ocr_seconds_sum": round(ocr_seconds, 1),
        "workers": workers,
        "empty_pages": empty_pages,
        "notes": notes,
    }
    log(f"完成：{out_path}（{len(body)} 字符，{render_seconds:.1f}s，"
        f"没认出字的页：{empty_pages or '无'}）")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- 子命令 split

# 页码标记切页
def split_pages(text: str) -> list[tuple[int, list[str]]]:
    """把文本按「（第 N 页）」切成 [(页码, 该页的行列表), ...]。"""
    pages: list[tuple[int, list[str]]] = []
    current_no: int | None = None
    current_lines: list[str] = []
    for raw_line in text.splitlines():
        match = PAGE_MARK_RE.match(raw_line.strip())
        if match:
            if current_no is not None:
                pages.append((current_no, current_lines))
            current_no = int(match.group(1))
            current_lines = []
        elif current_no is not None:
            current_lines.append(raw_line)
    if current_no is not None:
        pages.append((current_no, current_lines))
    return pages


# 「例 1」「例93」：OCR 会把数字和"例"之间插空格的形态都保留，统一处理
EXAMPLE_RE = re.compile(r"^\s*例\s*(\d{1,3})\s*[.．、]?\s*(.*)$")

# 章节标题（课程内容里的大标题），用于给 requirement 打 section
SECTION_RE = re.compile(
    r"^\s*(?:[一二三四五六七八九十]+\s*[、.．]|第[一二三四五六七八九十]+学段|"
    r"[（(][一二三四五六七八九十]+[)）]|内容要求|学业要求|教学提示|课程内容|课程目标)"
)


def looks_like_section_title(line: str) -> bool:
    """粗判一行是不是小标题（短、没有句号、含"要求/提示/学段/领域名"）。"""
    stripped = line.strip()
    if not stripped or len(stripped) > 24:
        return False
    if stripped.endswith("。") or stripped.endswith("；"):
        return False
    return bool(re.search(r"(要求|提示|学段|年级|数与代数|图形与几何|统计与概率|综合与实践|"
                          r"课程内容|课程目标|核心素养|附录|前言|目录)", stripped))


def normalize_line(line: str) -> str:
    """清理 OCR 行内的噪声：多余空格、行首行尾符号。"""
    cleaned = line.replace("\u3000", " ").strip()
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned


# 条目序号：OCR 里常见 "1." / "1、" / "1．"
NUMBERED_RE = re.compile(r"^\s*(\d{1,2})\s*[.．、,]\s*(.+)$")


def is_noise_line(line: str) -> bool:
    """页眉、页码、纯符号行——不是内容。"""
    stripped = line.strip()
    if len(stripped) <= 1:
        return True
    if re.fullmatch(r"[\s\-—_=·．.,，、*+]+", stripped):
        return True
    # 页眉：只含书名/年号/页码
    if re.search(r"义务教育\s*数学\s*课程标准", stripped) and len(stripped) < 40:
        return True
    if re.fullmatch(r"[\dOoQ\s]{1,6}", stripped):
        return True
    return False


def join_wrapped(lines: list[str]) -> list[str]:
    """把被 OCR 拆成多行的段落接回一条：中文行末没有标点时，认为下一行是同一条。"""
    merged: list[str] = []
    buffer = ""
    for line in lines:
        if buffer == "":
            buffer = line
            continue
        ends_clause = buffer.endswith(("。", "；", "！", "？", "：", "”", "）"))
        starts_new = bool(EXAMPLE_RE.match(line)) or bool(NUMBERED_RE.match(line))
        if ends_clause or starts_new or len(buffer) < 12:
            merged.append(buffer)
            buffer = line
        else:
            buffer = buffer.rstrip() + line.lstrip()
    if buffer:
        merged.append(buffer)
    return merged


def extract_examples(page_no: int, lines: list[str], source: str) -> list[dict]:
    """从一页里抽「例 N」条目：例号所在行起，直到下一个例号/小标题为止。"""
    records: list[dict] = []
    blocks: list[tuple[str, list[str]]] = []  # (例号, 正文行)
    current_no: str | None = None
    current_body: list[str] = []
    for line in lines:
        match = EXAMPLE_RE.match(line)
        if match:
            if current_no is not None:
                blocks.append((current_no, current_body))
            current_no = f"例 {int(match.group(1))}"
            head = match.group(2).strip()
            current_body = [head] if head else []
        elif current_no is not None:
            # 遇到明显的下一节小标题就收尾（附录里例子之间不会夹小标题，保险起见）
            if looks_like_section_title(line) and len(line) < 16:
                blocks.append((current_no, current_body))
                current_no, current_body = None, []
            else:
                current_body.append(line)
    if current_no is not None:
        blocks.append((current_no, current_body))

    for example_no, body_lines in blocks:
        body = [normalize_line(x) for x in body_lines if not is_noise_line(x)]
        body = [x for x in body if x]
        if not body:
            continue
        text = "".join(body) if all(len(x) < 20 for x in body) else "\n".join(body)
        text = text.strip()
        if len(text) < 8:
            continue
        record: dict = {
            "kind": "example",
            "source": source,
            "page": page_no,
            "example_no": example_no,
            "stem": text,
        }
        records.append(record)
    return records


def extract_requirements(page_no: int, lines: list[str], source: str, section: str) -> tuple[list[dict], str]:
    """抽「内容要求」条目：编号段（1. …）或整段无编号的要求句。

    返回 (记录列表, 更新后的 section)。
    """
    records: list[dict] = []
    for line in join_wrapped(lines):
        stripped = normalize_line(line)
        if not stripped or is_noise_line(stripped):
            continue
        if looks_like_section_title(stripped):
            section = stripped
            continue
        match = NUMBERED_RE.match(stripped)
        if match and len(match.group(2).strip()) > 6:
            body = match.group(2).strip()
        else:
            # 无编号的整段要求（如"学业要求"下的散句）也算，但必须像一句完整的话
            body = stripped
        if len(body) < 10:
            continue
        if not re.search(r"[\u4e00-\u9fff]", body):
            continue
        # 只收「要求句」：含能愿/行为动词
        if not re.search(r"(能|会|理解|掌握|知道|认识|了解|经历|感悟|体验|探索|运用|形成|发展|"
                         r"初步|进一步|尝试|说明|解释|表达|解决)", body):
            continue
        record = {
            "kind": "requirement",
            "source": source,
            "page": page_no,
            "section": section,
            "requirement": body,
        }
        records.append(record)
    return records, section


def guess_source(text_path: Path, override: str | None) -> str:
    """来源名：默认用文件名去掉扩展名，够唯一也够可读。"""
    if override:
        return override
    return text_path.stem


def cmd_split(args: argparse.Namespace) -> int:
    text_path = Path(args.text).expanduser()
    if not text_path.is_file():
        log(f"读不到文件：{text_path}")
        return 1
    text = text_path.read_text(encoding="utf-8", errors="replace")
    pages = split_pages(text)
    if not pages:
        log("文本里没有「（第 N 页）」标记：先用 ocr 子命令生成，或用 extract.py --ocr 的产物")
    source = guess_source(text_path, args.source)

    examples: list[dict] = []
    requirements: list[dict] = []
    section = ""
    for page_no, lines in pages:
        if args.kind in ("all", "examples"):
            examples.extend(extract_examples(page_no, lines, source))
        if args.kind in ("all", "requirements"):
            found, section = extract_requirements(page_no, lines, source, section)
            requirements.extend(found)

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for record in examples + requirements:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    log(f"抽到示例题 {len(examples)} 条、内容要求 {len(requirements)} 条 → {out_path}")
    print(json.dumps({
        "ok": True,
        "step": "split",
        "text": str(text_path),
        "out": str(out_path),
        "pages": len(pages),
        "examples": len(examples),
        "requirements": len(requirements),
        "bytes": out_path.stat().st_size,
    }, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- 子命令 build

def cmd_build(args: argparse.Namespace) -> int:
    """OCR + 抽取一条龙；每本产出 <短名>.txt / <短名>.examples.jsonl / <短名>.requirements.jsonl。"""
    outdir = Path(args.outdir).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    reports = []
    for pdf in args.pdfs:
        pdf_path = Path(pdf).expanduser()
        stem = pdf_path.stem
        txt_path = outdir / f"{stem}.txt"
        ocr_args = argparse.Namespace(
            pdf=str(pdf_path), out=str(txt_path), workers=args.workers,
            scale=args.scale, lang=args.lang, pages=args.pages, psm=args.psm,
        )
        code = cmd_ocr(ocr_args)
        if code != 0:
            return code
        entry = {"pdf": str(pdf_path), "text": str(txt_path)}
        for kind, suffix in (("examples", ".examples.jsonl"), ("requirements", ".requirements.jsonl")):
            jsonl_path = outdir / f"{stem}{suffix}"
            split_args = argparse.Namespace(
                text=str(txt_path), out=str(jsonl_path), source=stem, kind=kind,
            )
            cmd_split(split_args)
            entry[kind] = str(jsonl_path)
        reports.append(entry)
    print(json.dumps({"ok": True, "step": "build", "outdir": str(outdir), "books": reports},
                     ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- 入口

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="curriculum.py",
        description="扫描版课标 PDF → 文本 → 示例题/内容要求 JSONL（本地 OCR，不联网）",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ocr = sub.add_parser("ocr", help="扫描 PDF 整份 OCR，输出带「（第 N 页）」标记的文本")
    p_ocr.add_argument("pdf")
    p_ocr.add_argument("--out", required=True)
    p_ocr.add_argument("--workers", type=int, default=8, help="OCR 线程数，上限 8（默认 8）")
    p_ocr.add_argument("--scale", type=float, default=3.0, help="渲染倍率，3.0≈216dpi（默认 3.0）")
    p_ocr.add_argument("--lang", default="chi_sim+eng")
    p_ocr.add_argument("--psm", type=int, default=6, help="tesseract 版面模式，6=整块文本（默认）")
    p_ocr.add_argument("--pages", default="", help='只处理部分页，如 "1-20"')
    p_ocr.set_defaults(func=cmd_ocr)

    p_split = sub.add_parser("split", help="从 OCR 文本抽示例题与内容要求，写 JSONL")
    p_split.add_argument("--text", required=True)
    p_split.add_argument("--out", required=True)
    p_split.add_argument("--source", default=None, help="来源名，默认取文件名")
    p_split.add_argument("--kind", choices=["all", "examples", "requirements"], default="all")
    p_split.set_defaults(func=cmd_split)

    p_build = sub.add_parser("build", help="OCR + 抽取一条龙")
    p_build.add_argument("pdfs", nargs="+")
    p_build.add_argument("--outdir", required=True)
    p_build.add_argument("--workers", type=int, default=8)
    p_build.add_argument("--scale", type=float, default=3.0)
    p_build.add_argument("--lang", default="chi_sim+eng")
    p_build.add_argument("--psm", type=int, default=6)
    p_build.add_argument("--pages", default="")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args(argv[1:])
    try:
        return args.func(args)
    except (RuntimeError, OSError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
