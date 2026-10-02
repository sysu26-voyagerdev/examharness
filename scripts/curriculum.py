#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""课标扫描件 → 结构化数据（纯本地：pypdfium2 渲染 + tesseract OCR，不联网，不用大模型）。

为什么要有它：
    《义务教育数学课程标准》只有扫描 PDF（没有文字层），要拿它当题库/知识图谱的底料，
    就得先把 190 页图片变成文本，再从文本里抽出「示例题」和「内容要求」两类条目。
    一次性脚本干这活，下次换一版课标（2025 修订版…）又得重写；所以固化成子命令。

用法：

    # 1) 整份 OCR：渲染单线程（pdfium 不是线程安全的）+ tesseract 线程池
    python3 scripts/curriculum.py ocr <pdf> --out <txt> [--workers 8] [--scale 3.0]
                                     [--lang chi_sim+eng] [--psm 6] [--pages 1-20]

    # 2) 从 OCR 文本抽结构，写 JSONL（每行一个 JSON 对象）
    python3 scripts/curriculum.py split --text <txt> --out <jsonl>
                                     [--source 名称] [--kind all|examples|requirements]

    # 3) 回原文核对抽样记录（自检）
    python3 scripts/curriculum.py verify --jsonl <jsonl> --text <txt> [--sample 5] [--seed 7]

    # 4) 一条龙：OCR + 抽取 + 自检
    python3 scripts/curriculum.py build <pdf> [<pdf> ...] --outdir data/curriculum

产出（split / build），每行一个 JSON 对象，用 "kind" 区分：
  {"kind": "example",     "source": ..., "page": N, "example_no": "例 1",
   "title": "用算盘表示多位数"?, "stem": "...", "explanation": "..."?, "answer": "..."?,
   "knowledge": ["数与运算", ...]}
  {"kind": "requirement", "source": ..., "page": N, "section": "第四学段（7～9年级） / 数与代数 / 数与式",
   "requirement": "..."}

抽不准的字段宁缺勿造：抽不到就整个字段不出现，绝不用空串占位。

三条关键工程决定（踩过坑之后的）：
  1. tesseract 每个进程都设 OMP_THREAD_LIMIT=1。它内部用 OpenMP，8 个进程各开 16 线程
     会互相抢核：实测 8 页 16.6s → 3.0s。
  2. 每页文本前插一行「（第 N 页）」标记。扫描件的页眉页码 OCR 会认错（"33" 变 "8B"），
     自己插的标记才是可靠的页码来源。
  3. 附录里的「例 N」标题会被 OCR 打坏（例51→"例 S1"、例5→"Gls"、例57→"$157"）。
     所以用「严格命中 + 顺序锚定修复」：候选标题只有正好落在期望序号上才被采纳，
     宁可少一条，也不要错一号。

依赖：pypdfium2（渲染）、系统 tesseract + 语言包（默认用仓库 data/tessdata）。
"""

from __future__ import annotations

import argparse
import json
import os
import random
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
         十几个线程会互相抢核，实测 8 页从 16.6s 掉到 3.0s。这是本脚本最快的那个开关。
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
    import pypdfium2 as pdfium  # 延迟导入：只跑 split/verify 时不该依赖它

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

    def ocr_one(item: tuple[int, Path]) -> tuple[int, str, float]:
        """线程池里只做 tesseract（外部进程），绝不碰 pdfium 对象。"""
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
    started_at = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for index in indexes:
            # 渲染 + 存盘放主线程：pdfium 不是线程安全的
            page = doc[index]
            image = page.render(scale=args.scale).to_pil()
            image_path = workdir / f"p{index + 1:04d}.png"
            image.save(image_path)
            image.close()
            pending.append(pool.submit(ocr_one, (index, image_path)))
            # 限制在飞的图片数：别把 /tmp 塞满几百张 PNG（渲染顺带把 OCR 藏进流水线）
            if len(pending) >= workers * 3:
                index_done, text, seconds = pending.pop(0).result()
                results[index_done] = text
                ocr_seconds += seconds
        for future in pending:
            index_done, text, seconds = future.result()
            results[index_done] = text
            ocr_seconds += seconds
    elapsed = time.time() - started_at

    # 按页拼装：页码标记独立成行，split 阶段靠它定位
    pieces: list[str] = []
    empty_pages: list[int] = []
    for index in indexes:
        text = results.get(index, "")
        if len(text.strip()) < 10:
            empty_pages.append(index + 1)
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
        "seconds": round(elapsed, 1),
        "seconds_per_page": round(elapsed / max(1, len(indexes)), 3),
        "workers": workers,
        "scale": args.scale,
        "empty_pages": empty_pages,
        "notes": notes,
    }
    log(f"完成：{out_path}（{len(body)} 字符，{elapsed:.1f}s，"
        f"没认出字的页：{empty_pages or '无'}）")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


# ================================================================ 文本 → 结构
#
# 下面这一段是「split」的核心：把 OCR 文本当成人写的稿子去读——先认版式
# （学段 / 领域 / 主题 / 【内容要求】/「例 N」），再把被 OCR 拆断的行接回句子。

# 页眉页脚：OCR 常见的坏样子。含"课程标准/课程内容/年版"且很短 → 页眉
HEADER_HINT_RE = re.compile(r"(课程标准|课程内容|年版)")
# 单独成行的页码（"33"、"8B"、"1O"）
PAGE_NUMBER_RE = re.compile(r"^[0-9OoQIlSZBg]{1,4}$")
# 附录running head 的坏样子："附 ae" "附 0" "附 8" "附 iO" "附录中"
RUNNING_FOOT_RE = re.compile(r"^附\s*[录]?\s*[\u4e00-\u9fff]?[A-Za-z0-9]{0,3}$")

# 学段标题："第一学段 (1~2 FR)"、"第二学段 (3~4年级 )"
STAGE_RE = re.compile(r"^第\s*([一二三四])\s*学段\s*[（(]?\s*(\d)\s*[~～\-一]\s*(\d)")
# 学段标题被打坏的样子："BOR (3~4 FR)"、"1. BAR 〈1~2 年级)"——学段名没了，只剩年级段
STAGE_LOOSE_RE = re.compile(r"^.{0,8}[（(〈]?\s*(\d)\s*[~～\-一]\s*(\d)\s*[)）〉]?\s*(年级|FR|年)")
STAGE_CN = {"一": "第一学段", "二": "第二学段", "三": "第三学段", "四": "第四学段"}
# 领域标题："(一) 数与代数"
DOMAIN_RE = re.compile(r"^[（(]\s*([一二三四])\s*[)）]\s*([\u4e00-\u9fff]{2,10})\s*$")
DOMAIN_NAMES = {"数与代数", "图形与几何", "统计与概率", "综合与实践"}
# 主题标题："1. 数与运算"、"2. 图形的位置与运动"（短、无句号）
TOPIC_RE = re.compile(r"^(\d{1,2})\s*[.．、]\s*([\u4e00-\u9fff][\u4e00-\u9fff、与和]{1,15})\s*$")
# 块标记：【内容要求】【学业要求】【教学提示】（OCR 会在】前塞字，如"【教学提示了】"）
BLOCK_RE = re.compile(r"^[【\[]\s*(内容要求|学业要求|教学提示|说明)\s*了?\s*[】\]]?\s*(.*)$")
# 条目编号："(1) 在实际情境中…"；也有 "1. …" 当条目用的地方
ITEM_RE = re.compile(r"^[（(]\s*(\d{1,2})\s*[)）]\s*(.+)$")

# 附录里的示例题标题：严格命中（"例 12 标题"）
EXAMPLE_RE = re.compile(r"^\s*例\s*(\d{1,3})\s*[.．、,]?\s*(.*)$")
# 宽松命中 A：行首的"例"字活下来了，只是数字被打坏（"例 S1 身体上的尺子"、"例S56 寻找…"）
EXAMPLE_LOOSE_A_RE = re.compile(r"^\s*例\s*([0-9A-Za-z$]{1,4})\s+(.{1,30})$")
# 宽松命中 B：连"例"字都被打没了（"Gls 借助图形…"、"G53 纸的厚度"、"$157 …"）
EXAMPLE_LOOSE_B_RE = re.compile(r"^([A-Za-z$]{1,3}\s?[0-9A-Za-z$]{0,3})\s+([\u4e00-\u9fff“\"].{0,30})$")
# 弱宽松 C：纯数字打头，"例"字整个丢了（"53 纸的厚度"）——必须上下都是空行才算数
EXAMPLE_LOOSE_C_RE = re.compile(r"^(\d{1,3})\s+([\u4e00-\u9fff“\"].{0,28})$")
# 弱宽松 D：数字和"例"都没了，只剩个短 token（"A 尺规作图: 垂直平分线" 实为 例73）
EXAMPLE_LOOSE_D_RE = re.compile(r"^([A-Za-z\u4e00-\u9fff]{1,2})\s+([\u4e00-\u9fff“\"].{0,28})$")
# 标题行不该以这些收尾（句号/逗号说明它是正文；引号和括号不算，标题可能是"寻找“宝藏”"）
HEADING_TAIL = ("。", "；", "！", "？", "：", "，", "、", ")", "）")
# 学段标题的收尾判断更松：它本来就长成 "(3~4 FR)" 这样，右括号是正常结尾
SENTENCE_TAIL = ("。", "；", "！", "？", "：", "，", "、")
# 附录起止
APPENDIX_START_RE = re.compile(r"^附录\s*1?\s*[·・.．]?\s*(课程内容中的实例|.*实例)")
APPENDIX_END_RE = re.compile(r"^附录\s*2")

# 正文里对示例题的引用："（例 35）"、"(例 4 和例 5)"
CITATION_RE = re.compile(r"[（(〈<]\s*例\s*(\d{1,3})")

# 知识点词表：只在示例题原文里做**字面**匹配（不做任何推断），用于跨引用缺失时的兜底
KNOWLEDGE_TERMS = [
    "数与运算", "数量关系", "数与式", "方程与不等式", "函数", "图形与几何", "图形的认识",
    "图形的测量", "图形的位置与运动", "图形的性质", "图形的变化", "坐标", "统计与概率",
    "数据分类", "数据的收集", "整理与表达", "随机现象", "抽样与数据分析", "平均数", "百分数",
    "条形统计图", "扇形统计图", "折线统计图", "综合与实践", "主题活动", "项目学习",
    "有理数", "实数", "代数式", "整式", "分式", "二次根式", "一元一次方程", "二元一次方程组",
    "一元二次方程", "不等式", "一次函数", "反比例函数", "二次函数", "三角形", "四边形",
    "圆", "勾股定理", "相似", "全等", "轴对称", "平移", "旋转", "比例尺", "周长", "面积",
    "体积", "表面积", "长度单位", "量感", "数感", "符号意识", "运算能力", "几何直观",
    "空间观念", "推理意识", "数据意识", "模型意识", "应用意识", "创新意识",
]


def split_pages(text: str) -> list[tuple[int, list[str]]]:
    """把 OCR 文本按「（第 N 页）」切成 [(页码, 该页的行列表), ...]。"""
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


def flatten(pages: list[tuple[int, list[str]]]) -> list[tuple[int, str]]:
    """[(页码, 行)] 的扁平流：跨页接句要靠它。"""
    return [(page_no, line) for page_no, lines in pages for line in lines]


def normalize_line(line: str) -> str:
    cleaned = line.replace("\u3000", " ").strip()
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned


def is_noise(line: str) -> bool:
    """页眉、页码、纯符号行——不是内容。"""
    stripped = line.strip()
    if len(stripped) <= 1:
        return True
    if re.fullmatch(r"[\s\-—_=·．.,，、;；*+]+", stripped):
        return True
    if PAGE_NUMBER_RE.fullmatch(stripped):
        return True
    # 页眉：短 + 含"课程标准/课程内容/年版"。OCR 会把"数学"打成"205%"，所以不靠书名全文匹配
    if len(stripped) < 46 and HEADER_HINT_RE.search(stripped) and not stripped.endswith("。"):
        return True
    if len(stripped) <= 8 and RUNNING_FOOT_RE.match(stripped):
        return True
    return False


def classify(line: str) -> tuple[str, str]:
    """给一行打版式标签：(种类, 名称)。

    种类：noise / stage / domain / topic / block / example / text
    """
    if is_noise(line):
        return "noise", ""
    stage = STAGE_RE.match(line)
    if stage:
        return "stage", f"{STAGE_CN[stage.group(1)]}（{stage.group(2)}～{stage.group(3)}年级）"
    # 学段名被 OCR 吃掉时（"BOR (3~4 FR)"），只能靠年级段认——但要求行足够短，
    # 免得把正文里"在 1~2 年级……"这种句子当标题。
    if len(line) <= 22 and not line.endswith(SENTENCE_TAIL):
        loose_stage = STAGE_LOOSE_RE.match(line)
        if loose_stage:
            first, last = loose_stage.group(1), loose_stage.group(2)
            # 年级起点 → 学段（"五四"制的 3~5、6~7 也覆盖得到）
            number = {"1": "一", "2": "二", "3": "二", "4": "三",
                      "5": "三", "6": "三", "7": "四"}.get(first, "四")
            return "stage", f"{STAGE_CN[number]}（{first}～{last}年级）"
    domain = DOMAIN_RE.match(line)
    if domain and domain.group(2) in DOMAIN_NAMES:
        return "domain", domain.group(2)
    topic = TOPIC_RE.match(line)
    if topic:
        return "topic", topic.group(2)
    block = BLOCK_RE.match(line)
    if block and line.startswith(("【", "[")):
        return "block", block.group(1)
    return "text", ""


TERMINAL = ("。", "；", "！", "？", "：", "”", "）", ")", "】", "…", ".", ";")


def should_join(previous: str, line: str) -> bool:
    """被 OCR 拆断的句子接回去：上一行没结束标点、且不太短，就认为没说完。"""
    if not previous:
        return False
    if previous.endswith(TERMINAL):
        return False
    if len(previous) < 12:  # 太短的多半是表头/图注，别硬接
        return False
    if classify(line)[0] != "text":
        return False
    return True


def merge_paragraphs(stream: list[tuple[int, str]]) -> list[tuple[int, str, str]]:
    """把行流合并成段落流：[(页码, 版式种类, 文本)]。

    页码取该段**起始行**所在的页；跨页接句时归属上一页，便于回溯。
    """
    paragraphs: list[tuple[int, str, str]] = []
    buffer_page: int | None = None
    buffer_text = ""
    for page_no, raw in stream:
        line = normalize_line(raw)
        kind, name = classify(line)
        if kind == "noise":
            continue
        if kind != "text":
            if buffer_text:
                paragraphs.append((buffer_page or page_no, "text", buffer_text))
                buffer_text = ""
            paragraphs.append((page_no, kind, name if kind != "example" else line))
            continue
        if should_join(buffer_text, line):
            buffer_text += line
        else:
            if buffer_text:
                paragraphs.append((buffer_page or page_no, "text", buffer_text))
            buffer_page, buffer_text = page_no, line
    if buffer_text:
        paragraphs.append((buffer_page or 0, "text", buffer_text))
    return paragraphs


# ---------------------------------------------------------------- 内容要求抽取

REQUIREMENT_VERBS = re.compile(
    r"(能|会|理解|掌握|知道|认识|了解|经历|感悟|体验|探索|运用|形成|发展|"
    r"初步|进一步|尝试|说明|解释|表达|解决|通过|借助|结合|在)"
)


def extract_requirements(paragraphs: list[tuple[int, str, str]], source: str) -> list[dict]:
    """只抽【内容要求】块里的条目。

    为什么不抽【学业要求】/【教学提示】：前者是学段末的综合性描述，后者是教学建议，
    都不是"内容要求条目"；混进来会把知识图谱的键冲淡。要的话改 BLOCKS 常量即可。
    """
    records: list[dict] = []
    stage = ""
    domain = ""
    topic = ""
    in_block = False
    seen: set[tuple[int, str]] = set()
    for page_no, kind, text in paragraphs:
        if kind == "stage":
            # 课标的层级是 领域 → 学段 → 主题（"(一) 数与代数" 出现在 "第一学段" 之前），
            # 所以换学段只清主题，别把领域一起清了。
            stage, topic, in_block = text, "", False
            continue
        if kind == "domain":
            domain, topic = text, ""
            continue
        if kind == "topic":
            topic = text
            continue
        if kind == "block":
            in_block = text == "内容要求"
            continue
        if kind != "text" or not in_block:
            continue
        body = text.strip()
        item = ITEM_RE.match(body)
        if item:
            body = item.group(2).strip()
        if len(body) < 10 or not re.search(r"[\u4e00-\u9fff]", body):
            continue
        # 只留"要求句"：含行为/能愿动词。挡掉表格残渣和图注
        if not REQUIREMENT_VERBS.search(body):
            continue
        if re.fullmatch(r"[^\u4e00-\u9fff]*[\d\s.、]+", body):
            continue
        key = (page_no, body[:24])
        if key in seen:
            continue
        seen.add(key)
        section = " / ".join(part for part in (stage, domain, topic) if part)
        records.append({
            "kind": "requirement",
            "source": source,
            "page": page_no,
            "section": section,
            "requirement": body,
        })
    return records


# ---------------------------------------------------------------- 示例题抽取

# OCR 把数字认成字母的常见对应（用于生成"候选序号"，不是直接定案）
DIGIT_CONFUSION = str.maketrans({"S": "5", "s": "5", "I": "1", "l": "1", "O": "0",
                                 "o": "0", "B": "8", "g": "9", "Z": "2", "z": "2",
                                 "q": "9", "$": "", "G": "", "例": ""})
EXPLANATION_RE = re.compile(r"^[【\[]\s*说\s*明\s*了?\s*[】\]]?\s*(.*)$")
ANSWER_RE = re.compile(r"^[【\[]?\s*(?:参考)?答案\s*[：:】\]]\s*(.*)$")


def number_options(token: str) -> list[int]:
    """从一个被打坏的标题 token 里列出所有可能的序号。

    "51"→[51]；"S1"→[1,51]；"$157"→[157,57,7]（含所有后缀/前缀读法，交给顺序锚定去挑）
    """
    cleaned = token.strip()
    digits = re.sub(r"\D", "", cleaned)
    options: set[int] = set()
    for value in (digits, re.sub(r"\s", "", cleaned.translate(DIGIT_CONFUSION))):
        if not value.isdigit() or value == "":
            continue
        number = int(value)
        if 1 <= number <= 300:
            options.add(number)
        # 前缀/后缀读法：OCR 常把"例"打进数字里（$157 实为 57）
        for cut in range(1, len(value)):
            for piece in (value[cut:], value[:len(value) - cut]):
                if piece.isdigit() and piece:
                    small = int(piece)
                    if 1 <= small <= 300:
                        options.add(small)
    return sorted(options)


def pick_number(options: list[int], expected: int) -> int | None:
    """顺序锚定：优先正好等于期望序号，其次取不小于期望的最小候选。"""
    if not options:
        return None
    if expected in options:
        return expected
    bigger = [value for value in options if value > expected]
    if bigger:
        return min(bigger)
    return None  # 全部小于期望 → 不是一条题目录，丢掉


def collect_example_heads(stream: list[tuple[int, str]]) -> tuple[list[dict], int, int]:
    """在附录范围内找「例 N」标题，并用顺序锚定修复被 OCR 打坏的序号。

    三档候选，可靠性递减：
      0 严格：行首就是"例 12 标题"
      1 强宽松：行首 token 带字母/$（"Gls"、"G53"、"例 S1"）——OCR 把"例"或数字打成了字母
      2 弱宽松：纯数字打头（"53 纸的厚度"）或短 token（"A 尺规作图…"，"例73"整个丢了）
    第 2 档要求上下都是空行，且序号必须**正好**等于期望值；第 0/1 档才允许跳号。
    宁可少一条，也不要错一号。

    返回 (标题列表, 附录起始行号, 附录结束行号)。
    """
    # 目录里也有"附录1 课程内容中的实例"，所以取**最后**一处，并要求后面紧跟"例 1"。
    # 不这么做的话，目录/正文里的"1 数与运算"这类行会被当成示例题标题，序号一路跑偏。
    start = end = -1
    matches = [index for index, (_page, raw) in enumerate(stream)
               if APPENDIX_START_RE.match(normalize_line(raw))]
    for index in reversed(matches):
        window = [normalize_line(stream[j][1]) for j in range(index, min(index + 60, len(stream)))]
        if any(re.match(r"^例\s*1\b", line) for line in window) or index == matches[0]:
            start = index
            break
    if start >= 0:
        for index in range(start, len(stream)):
            if APPENDIX_END_RE.match(normalize_line(stream[index][1])):
                end = index
                break
    if start < 0:
        # 找不到附录标记：整篇按严格模式扫，不做顺序修复（宁可少，不可错）
        start, end = 0, len(stream)
    elif end < 0:
        end = len(stream)

    def blank(index: int) -> bool:
        return 0 <= index < len(stream) and normalize_line(stream[index][1]) == ""

    # ---- 第一遍：把"长得像标题"的行全收下来，先不定序号
    candidates: list[dict] = []
    for index in range(start, end):
        page_no, raw = stream[index]
        line = normalize_line(raw)
        strict = EXAMPLE_RE.match(line)
        if strict:
            candidates.append({"index": index, "page": page_no, "tier": 0,
                               "options": [int(strict.group(1))], "title": strict.group(2).strip()})
            continue
        if len(line) > 30 or line.endswith(HEADING_TAIL) or "【" in line or "】" in line \
                or re.match(r"^[图表]\s*\d", line):
            continue
        loose = EXAMPLE_LOOSE_A_RE.match(line) or EXAMPLE_LOOSE_B_RE.match(line)
        if loose:
            options = number_options(loose.group(1))
            if options:
                candidates.append({"index": index, "page": page_no, "tier": 1,
                                   "options": options, "title": loose.group(2).strip()})
            elif blank(index - 1) and blank(index + 1):
                # token 里一个数字都没有（"A 尺规作图…"）：只能靠位置填空，降到第 2 档
                candidates.append({"index": index, "page": page_no, "tier": 2,
                                   "options": [], "title": loose.group(2).strip()})
            continue
        weak = EXAMPLE_LOOSE_C_RE.match(line) or EXAMPLE_LOOSE_D_RE.match(line)
        if weak and blank(index - 1) and blank(index + 1):
            candidates.append({"index": index, "page": page_no, "tier": 2,
                               "options": number_options(weak.group(1)),
                               "title": weak.group(2).strip()})

    # ---- 第二遍：顺序锚定。期望序号从 1 开始，只能往前推
    heads: list[dict] = []
    expected = 1
    position = 0
    while position < len(candidates):
        candidate = candidates[position]
        chosen = pick_number(candidate["options"], expected)
        # 只有严格命中允许跳号；宽松/弱宽松必须**正好**落在期望序号上
        if chosen is not None and (candidate["tier"] == 0 or chosen == expected):
            candidate["no"] = chosen
            heads.append(candidate)
            expected = chosen + 1
            position += 1
            continue
        # 数字全丢的标题（"A 尺规作图…"）：只有后一条正好补上 expected+1，
        # 才能反推它就是 expected——这是唯一允许的"位置填空"
        following = candidates[position + 1] if position + 1 < len(candidates) else None
        if candidate["tier"] == 2 and not candidate["options"] and following:
            if pick_number(following["options"], expected) == expected + 1:
                candidate["no"] = expected
                heads.append(candidate)
                expected += 1
                position += 1
                continue
        position += 1
    return heads, start, end


def build_example_records(stream: list[tuple[int, str]], heads: list[dict], end: int,
                          source: str) -> list[dict]:
    """把每个标题到下一个标题之间的行，切成 题面 / 说明 / 答案 三块。"""
    records: list[dict] = []
    for position, head in enumerate(heads):
        stop = heads[position + 1]["index"] if position + 1 < len(heads) else end
        body_lines: list[str] = []
        for index in range(head["index"] + 1, stop):
            line = normalize_line(stream[index][1])
            if not line or is_noise(line):
                continue
            body_lines.append(line)

        # 题面与【说明】分开；说明标记本身常被 OCR 打坏，只认带括号/方括号的形式
        stem_lines: list[str] = []
        explanation_lines: list[str] = []
        answer_lines: list[str] = []
        target = stem_lines
        for line in body_lines:
            explanation = EXPLANATION_RE.match(line)
            answer = ANSWER_RE.match(line)
            if explanation:
                target = explanation_lines
                if explanation.group(1).strip():
                    explanation_lines.append(explanation.group(1).strip())
                continue
            if answer:
                target = answer_lines
                if answer.group(1).strip():
                    answer_lines.append(answer.group(1).strip())
                continue
            target.append(line)

        # 相邻行没有标点断句时接回去（OCR 把一行拆成两行）
        def tidy(lines: list[str]) -> str:
            out = ""
            for line in lines:
                if out and not out.endswith(TERMINAL) and len(out) >= 12:
                    out += line
                else:
                    out = f"{out}\n{line}" if out else line
            return out.strip()

        stem = tidy(stem_lines)
        explanation = tidy(explanation_lines)
        if not stem and explanation:
            # 有的例子只有【说明】没有题面（例1 就是），此时说明本身即内容，别再空着
            stem, explanation = explanation, ""
        if len(re.sub(r"\s", "", stem)) < 6:
            continue
        record: dict = {
            "kind": "example",
            "source": source,
            "page": head["page"],
            "example_no": f"例 {head['no']}",
        }
        if head["tier"] > 0:
            # 诚实标注：这条例号是根据上下文序号修复出来的（OCR 把标题打坏了）
            record["example_no_ocr"] = "repaired"
        # 标题必须是中文：OCR 常把标题打成"REA"这类纯拉丁噪声，那种宁可不写
        if head["title"] and re.search(r"[\u4e00-\u9fff]", head["title"]):
            record["title"] = head["title"]
        record["stem"] = stem
        if explanation:
            record["explanation"] = explanation
        answer = tidy(answer_lines)
        if answer:
            record["answer"] = answer
        records.append(record)
    return records


def attach_knowledge(examples: list[dict], requirements: list[dict]) -> int:
    """给示例题补 knowledge[]。

    两个来源，都是**字面证据**，不做推断：
      a) 正文引用：内容要求里写了"（例 35）"，就把那条要求所在的 领域/主题 当作知识点；
      b) 词表字面命中：示例题原文里出现了课标主题词（如"平均数"）就记下来。
    返回有引用的条数，便于在报告里说明覆盖率。
    """
    cited: dict[int, list[str]] = {}
    for record in requirements:
        numbers = CITATION_RE.findall(record["requirement"])
        labels = [part.strip() for part in record["section"].split("/") if part.strip()]
        tail = labels[1:] or labels  # 去掉学段，留下领域/主题
        for number in numbers:
            bucket = cited.setdefault(int(number), [])
            for label in tail:
                if label not in bucket:
                    bucket.append(label)

    from_citation = 0
    for record in examples:
        number = int(record["example_no"].split()[1])
        knowledge: list[str] = []
        if number in cited:
            knowledge.extend(cited[number])
            from_citation += 1
        haystack = f"{record.get('title', '')}{record['stem']}{record.get('explanation', '')}"
        for term in KNOWLEDGE_TERMS:
            if term in haystack and term not in knowledge:
                knowledge.append(term)
        record["knowledge"] = knowledge[:8]
    return from_citation


# ---------------------------------------------------------------- 子命令 split

def guess_source(text_path: Path, override: str | None) -> str:
    """来源名：默认用文件名去掉扩展名，够唯一也够可读。"""
    return override or text_path.stem


def cmd_split(args: argparse.Namespace) -> int:
    text_path = Path(args.text).expanduser()
    if not text_path.is_file():
        log(f"读不到文件：{text_path}")
        return 1
    text = text_path.read_text(encoding="utf-8", errors="replace")
    pages = split_pages(text)
    if not pages:
        log("文本里没有「（第 N 页）」标记：请先用 ocr 子命令生成产物")
        return 1
    source = guess_source(text_path, args.source)
    stream = flatten(pages)
    paragraphs = merge_paragraphs(stream)

    requirements = extract_requirements(paragraphs, source)
    examples: list[dict] = []
    heads: list[dict] = []
    if args.kind in ("all", "examples"):
        heads, start, end = collect_example_heads(stream)
        examples = build_example_records(stream, heads, end, source)
    # 知识点的第一个来源是"内容要求里引用了（例 N）"，所以要求永远要抽一遍（哪怕不写盘）
    from_citation = attach_knowledge(examples, requirements) if examples else 0

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload: list[dict] = []
    if args.kind in ("all", "examples"):
        payload.extend(examples)
    if args.kind in ("all", "requirements"):
        payload.extend(requirements)
    with out_path.open("w", encoding="utf-8") as handle:
        for record in payload:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    found = [head["no"] for head in heads]
    gaps = [value for value in range(1, (max(found) + 1) if found else 1) if value not in found]
    summary = {
        "ok": True,
        "step": "split",
        "text": str(text_path),
        "out": str(out_path),
        "pages": len(pages),
        "examples": len(examples),
        "requirements": len(requirements),
        "example_no_range": [min(found), max(found)] if found else None,
        "example_missing": gaps,
        "examples_with_citation": from_citation,
        "bytes": out_path.stat().st_size,
    }
    log(f"抽到示例题 {len(examples)} 条（序号 {summary['example_no_range']}，缺 {gaps or '无'}）、"
        f"内容要求 {len(requirements)} 条 → {out_path}")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


# ---------------------------------------------------------------- 子命令 verify

def strip_to_cjk(text: str) -> str:
    """只留汉字与字母数字：OCR 的空格/标点/弯引号差异不该影响核对。"""
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", text)


def cmd_verify(args: argparse.Namespace) -> int:
    """抽样回原文核对。

    两步，缺一不可：
      1. 记录的指纹（最长连续汉字串）必须能在整篇文本里找到——证明不是凭空造的；
      2. "例 N"这个标题必须落在记录标的页码上（允许落在邻页，跨页排版很常见）——证明页码可用。
    """
    jsonl_path = Path(args.jsonl).expanduser()
    text_path = Path(args.text).expanduser()
    records = [json.loads(line) for line in jsonl_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    examples = [record for record in records if record.get("kind") == "example"]
    if not examples:
        print(json.dumps({"ok": False, "error": "JSONL 里没有 example 记录"}, ensure_ascii=False))
        return 1

    raw_text = text_path.read_text(encoding="utf-8", errors="replace")
    original = strip_to_cjk(raw_text)
    page_text: dict[int, str] = {
        page_no: strip_to_cjk("\n".join(lines)) for page_no, lines in split_pages(raw_text)
    }

    rng = random.Random(args.seed)
    sample = rng.sample(examples, min(args.sample, len(examples)))
    results = []
    for record in sample:
        # 用"最长连续汉字串"当指纹：连续 8 字以上相同，基本不可能撞车
        runs = re.findall(r"[\u4e00-\u9fff]{8,}", record["stem"])
        fragment = max(runs, key=len) if runs else strip_to_cjk(record["stem"])[:12]
        probe = strip_to_cjk(fragment)[:20]
        in_text = probe != "" and probe in original
        page_no = record["page"]
        # 标题本身就是页码的证据：正文里"例 42"必须出现在第 42 条标的页上
        heading = record["example_no"].replace(" ", "")
        heading_pages = [candidate for candidate in (page_no - 1, page_no, page_no + 1)
                         if heading in page_text.get(candidate, "")]
        # 序号被修复过的记录（"例 S1"实为"例 51"）标题肯定搜不到，所以页码以**片段**为准
        fragment_pages = [candidate for candidate in (page_no - 1, page_no, page_no + 1)
                          if probe and probe in page_text.get(candidate, "")]
        on_page = page_no in fragment_pages
        heading_on_page = page_no in heading_pages
        if in_text and on_page:
            verdict = "ok"
        elif in_text and fragment_pages:
            verdict = "neighbor_page"
        else:
            verdict = "mismatch"
        results.append({
            "example_no": record["example_no"],
            "page": page_no,
            "fragment": fragment[:40],
            "found_in_text": in_text,
            "fragment_on_page": on_page,
            "fragment_pages": fragment_pages,
            "heading_on_page": heading_on_page,
            "verdict": verdict,
        })
    ok = sum(1 for item in results if item["verdict"] == "ok")
    print(json.dumps({
        "ok": True,
        "step": "verify",
        "source": jsonl_path.name,
        "sampled": len(results),
        "ok": ok,
        "results": results,
    }, ensure_ascii=False))
    log(f"核对 {len(results)} 条，完全命中（片段+页码）{ok} 条")
    return 0


# ---------------------------------------------------------------- 子命令 build

def cmd_build(args: argparse.Namespace) -> int:
    """OCR + 抽取 + 自检一条龙；每本产出 <短名>.txt / .examples.jsonl / .requirements.jsonl / .all.jsonl。"""
    outdir = Path(args.outdir).expanduser()
    outdir.mkdir(parents=True, exist_ok=True)
    reports = []
    for pdf in args.pdfs:
        pdf_path = Path(pdf).expanduser()
        stem = pdf_path.stem
        txt_path = outdir / f"{stem}.txt"
        code = cmd_ocr(argparse.Namespace(
            pdf=str(pdf_path), out=str(txt_path), workers=args.workers,
            scale=args.scale, lang=args.lang, pages=getattr(args, "pages", ""), psm=args.psm,
        ))
        if code != 0:
            return code
        entry: dict = {"pdf": str(pdf_path), "text": str(txt_path)}
        for kind, name in (("all", ".all.jsonl"), ("examples", ".examples.jsonl"),
                           ("requirements", ".requirements.jsonl")):
            jsonl_path = outdir / f"{stem}{name}"
            cmd_split(argparse.Namespace(
                text=str(txt_path), out=str(jsonl_path), source=stem, kind=kind,
            ))
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

    p_verify = sub.add_parser("verify", help="抽样回原文核对抽取结果")
    p_verify.add_argument("--jsonl", required=True)
    p_verify.add_argument("--text", required=True)
    p_verify.add_argument("--sample", type=int, default=5)
    p_verify.add_argument("--seed", type=int, default=7)
    p_verify.set_defaults(func=cmd_verify)

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
