#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在资料里做**模糊搜索**：按大意找题目/段落，容错错字与 OCR 噪声。

为什么不用 grep：老师说的是"二次函数 最值 应用题"，agent 需要的是**按意思找**，
而不是拿正则去撞原文——真题里有 OCR 噪声、有公式对象、有换行断句，
精确匹配十次里有八次找不到东西。

做法（零依赖、纯本地）：
  1. 把资料读成文本（.docx 走 zipfile 抽 w:t / m:t，含 Word 公式；.txt/.md/.jsonl 直读），
     缓存到 --cache 下，按"路径 + mtime + 大小"判断是否复用；
  2. 把文本切成块（默认 300 字），每块算与查询的分数：
       分数 = 0.6 × 关键词覆盖率 + 0.4 × 字符二元组 Jaccard
     二元组让"二次函数"能部分命中"二次函 数"这种被 OCR 拆开的写法；
  3. 返回命中片段（含文件、块序号、片段），按分数排序。

用法：
    material_search.py --root <目录> --query "二次函数 最值" [--limit 20] [--block 300]
                       [--cache <目录>] [--min-score 0.2] [--ext .docx,.txt,.md]

输出：{"ok": true, "scanned": N, "hits": [{"path","block","score","snippet"}...]}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

WORD_RE = re.compile(r"[\u4e00-\u9fa5]+")
DEFAULT_EXT = (".docx", ".txt", ".md", ".jsonl", ".csv")


def docx_text(path: Path) -> str:
    """抽 .docx 文本：w:t（正文）与 m:t（Word 公式）都收，段落之间换行。"""
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    except (OSError, KeyError, zipfile.BadZipFile):
        return ""
    # 段落边界先换成换行，再把两类文本节点抽出来
    xml = re.sub(r"</w:p>", "\n", xml)
    pieces = re.findall(r"<(?:w|m):t[^>]*>([^<]*)</(?:w|m):t>", xml)
    text = "".join(pieces)
    text = re.sub(r"<[^>]+>", "", text)
    return text


def file_text(path: Path) -> str:
    if path.suffix.lower() == ".docx":
        return docx_text(path)
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def cached_text(path: Path, cache: Path | None) -> str:
    if cache is None:
        return file_text(path)
    try:
        stamp = f"{path.stat().st_mtime_ns}-{path.stat().st_size}"
    except OSError:
        return ""
    # 文件名用短哈希：中文长路径 + 时间戳会超出文件系统上限（踩过）
    import hashlib

    digest = hashlib.sha1(f"{path}-{stamp}".encode("utf-8")).hexdigest()[:16]
    cached = cache / f"{digest}.txt"
    if cached.exists():
        return cached.read_text(encoding="utf-8", errors="replace")
    text = file_text(path)
    cache.mkdir(parents=True, exist_ok=True)
    cached.write_text(text, encoding="utf-8")
    return text


def bigrams(text: str) -> set[str]:
    chars = WORD_RE.sub(lambda m: m.group(0), text)
    chars = "".join(ch for ch in text if ch.strip() != "")
    return {chars[i : i + 2] for i in range(len(chars) - 1)}


def score_block(block: str, keywords: list[str], block_grams: set[str]) -> float:
    """
    三个信号合起来打分：**命中几个词**（覆盖）、**像不像**（二元组）、**出现得多不多**（密度）。
    只用前两个会饱和（一份卷子里两个词都出现就都是 1.000，排不出先后）。
    """
    if not keywords:
        return 0.0
    counts = [block.count(word) for word in keywords]
    covered = sum(1 for count in counts if count > 0)
    coverage = covered / len(keywords)
    query_grams: set[str] = set()
    for word in keywords:
        query_grams |= bigrams(word)
    overlap = len(query_grams & block_grams) / len(query_grams) if query_grams else coverage
    density = min(1.0, sum(counts) / (len(keywords) * 2))
    return round(0.4 * coverage + 0.3 * overlap + 0.3 * density, 4)


HEAD_RE = re.compile(r"(?m)(?:^|\n)\s*(?:[一二三四五六七八九十]+、[^\n]{0,20}|\d{1,2}\s*[.．、][^\n]{0,40})")


def nearest_head(text: str, position: int) -> str:
    """块前面最近的一个题号/大题标题：agent 靠它知道这条命中是哪一道题"""
    head = ""
    for match in HEAD_RE.finditer(text, 0, position + 1):
        head = match.group(0).strip()
    return head[:60]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="material_search.py")
    parser.add_argument("--root", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--block", type=int, default=300)
    parser.add_argument("--cache", default="")
    parser.add_argument("--min-score", type=float, default=0.2)
    parser.add_argument("--ext", default=",".join(DEFAULT_EXT))
    args = parser.parse_args(argv)

    root = Path(args.root).expanduser()
    if not root.is_dir():
        print(json.dumps({"ok": False, "error": f"不是目录：{root}"}, ensure_ascii=False))
        return 1

    extensions = tuple(part.strip().lower() for part in args.ext.split(",") if part.strip())
    keywords = [word for word in re.split(r"[\s,，、]+", args.query) if word.strip() != ""]
    cache = Path(args.cache).expanduser() if args.cache else None

    files = [p for p in sorted(root.rglob("*")) if p.is_file() and p.suffix.lower() in extensions]

    # 第一遍：把块读出来，并统计每个关键词出现在多少个块里（用来算 IDF）
    blocks: list[tuple[str, str, int, str]] = []  # (相对路径, 块, 起点, 全文)
    document_frequency = {word: 0 for word in keywords}
    scanned = 0
    step = max(1, args.block // 2)
    for path in files[:800]:
        text = cached_text(path, cache)
        if text.strip() == "":
            continue
        scanned += 1
        relative = str(path.relative_to(root))
        for start in range(0, max(1, len(text) - 1), step):
            block = text[start : start + args.block]
            if len(block) < 20:
                continue
            blocks.append((relative, block, start, text))
            for word in keywords:
                if word in block:
                    document_frequency[word] += 1

    # 关键词权重：到处都是的词（二次函数）权重低，稀有的词（最值/动点）权重高
    import math

    total_blocks = max(1, len(blocks))
    weight = {
        word: math.log(1 + total_blocks / (1 + document_frequency[word])) for word in keywords
    }
    weight_sum = sum(weight.values()) or 1.0

    hits: list[dict] = []
    for relative, block, start, text in blocks:
            counts = {word: block.count(word) for word in keywords}
            covered = sum(weight[word] for word, count in counts.items() if count > 0) / weight_sum
            matched = sum(weight[word] * min(count, 3) for word, count in counts.items()) / (weight_sum * 3)
            grams = bigrams(block)
            query_grams: set[str] = set()
            for word in keywords:
                query_grams |= bigrams(word)
            overlap = len(query_grams & grams) / len(query_grams) if query_grams else 0.0
            score = round(0.45 * covered + 0.35 * matched + 0.2 * overlap, 4)
            if score < args.min_score:
                continue
            hits.append(
                {
                    "path": str(path.relative_to(root)),
                    "block": start,
                    "score": score,
                    "head": nearest_head(text, start),
                    "snippet": re.sub(r"\s+", " ", block).strip()[:220],
                }
            )

    hits.sort(key=lambda hit: (-hit["score"], hit["path"], hit["block"]))
    # 同一文件最多给 3 条，避免一份卷子刷满结果
    limited: list[dict] = []
    per_file: dict[str, int] = {}
    for hit in hits:
        used = per_file.get(hit["path"], 0)
        if used >= 3:
            continue
        per_file[hit["path"]] = used + 1
        limited.append(hit)
        if len(limited) >= args.limit:
            break

    print(json.dumps({"ok": True, "scanned": scanned, "files": len(files), "hits": limited}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
