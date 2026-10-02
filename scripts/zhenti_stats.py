#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""中考真题（.docx）批量抽取 + 结构统计 + 知识点分布 + 建议蓝图生成。

为什么要自己解 zip 而不直接用 python-docx：
    中考卷里的数学式大量是 Word 公式（OMML，`<m:t>`），有的还是 OLE 图片。
    python-docx 的 `paragraph.text` 只能拿到 `<w:t>`，公式全部丢失，
    导致"下列计算正确的是（ ）"后面的选项变成空白，结构判断和知识点归类都会崩。
    所以这里直接读 `word/document.xml`，用正则按文档顺序把 `<w:t>` 与 `<m:t>`
    的文字拼回同一段落；段落边界严格按 `<w:p>` 保留，题目之间不会粘连。
    图片（`<w:drawing>` / `<w:object>`）拿不到，正文里的图形题会缺图——
    这是已知损失，报告里如实说明；不影响题号、分值、题型的统计。

用法（在仓库根目录执行，Python 用 .venv/bin/python3）：

    # 1) 抽出全部 docx 文本 -> data/zhenti/txt/*.txt （外加 _index.json 索引）
    scripts/../.venv/bin/python3 scripts/zhenti_stats.py extract

    # 2) 解析每份卷子的结构 -> data/zhenti/structure.json
    .venv/bin/python3 scripts/zhenti_stats.py parse

    # 3) 出统计报告 + 建议蓝图
    .venv/bin/python3 scripts/zhenti_stats.py report

    # 4) 一条龙（extract -> parse -> report），默认就是这个
    .venv/bin/python3 scripts/zhenti_stats.py all

常用可选参数：
    --src DIR       真题根目录（默认 data/zhenti/近三年全国各省、直辖市数学中考试题）
    --txt DIR       文本输出目录（默认 data/zhenti/txt）
    --out-dir DIR   产物目录（默认 data/zhenti）
    --limit N       只处理前 N 份（调试用）
    --verbose       打印每份卷子的解析摘要

产物：
    data/zhenti/txt/<年>_<地区>[__N].txt   每份卷子的纯文本（_index.json 记录来源路径）
    data/zhenti/structure.json             每份卷子的结构（机器可读）
    data/zhenti/report.md                  统计报告（中文）
    data/zhenti/suggested-blueprint.json   建议蓝图（与仓库现有蓝图同格式）

约束：只读 docx，只写 data/zhenti/ 下的产物；不联网、不调用任何大模型 API。
"""

from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

# ---------------------------------------------------------------------------
# 0. 常量：课标领域/主题词（取自 data/curriculum/课标2022.requirements.jsonl 的
#    "第四学段（7～9年级）" section，不自己发明词）
# ---------------------------------------------------------------------------

# 课标第四学段的一级领域 -> 二级主题（原样来自课标文件）
CURRICULUM_DOMAINS = [
    ("数与代数", "数与式"),
    ("数与代数", "方程与不等式"),
    ("数与代数", "函数"),
    ("图形与几何", "图形的性质"),
    ("图形与几何", "图形的变化"),
    ("图形与几何", "图形与坐标"),
    ("统计与概率", "抽样与数据分析"),
    ("统计与概率", "随机事件的概率"),
    ("综合与实践", ""),
]

# 关键词 -> (一级领域, 二级主题)。权重 = 关键词长度（越长的词越具体，命中时更能定性）。
# 说明：这些词都是初中数学教材/课标里的常规名词，按题干里出现即计分。
KEYWORD_RULES: list[tuple[str, str, str]] = [
    # ---- 数与式 ----
    ("有理数", "数与代数", "数与式"),
    ("无理数", "数与代数", "数与式"),
    ("相反数", "数与代数", "数与式"),
    ("倒数", "数与代数", "数与式"),
    ("绝对值", "数与代数", "数与式"),
    ("数轴", "数与代数", "数与式"),
    ("科学记数法", "数与代数", "数与式"),
    ("实数", "数与代数", "数与式"),
    ("平方根", "数与代数", "数与式"),
    ("算术平方根", "数与代数", "数与式"),
    ("立方根", "数与代数", "数与式"),
    ("二次根式", "数与代数", "数与式"),
    ("根式", "数与代数", "数与式"),
    ("代数式", "数与代数", "数与式"),
    ("整式", "数与代数", "数与式"),
    ("单项式", "数与代数", "数与式"),
    ("多项式", "数与代数", "数与式"),
    ("同类项", "数与代数", "数与式"),
    ("合并同类项", "数与代数", "数与式"),
    ("同底数幂", "数与代数", "数与式"),
    ("幂的乘方", "数与代数", "数与式"),
    ("积的乘方", "数与代数", "数与式"),
    ("完全平方公式", "数与代数", "数与式"),
    ("平方差公式", "数与代数", "数与式"),
    ("因式分解", "数与代数", "数与式"),
    ("分解因式", "数与代数", "数与式"),
    ("分式", "数与代数", "数与式"),
    ("约分", "数与代数", "数与式"),
    ("通分", "数与代数", "数与式"),
    ("化简求值", "数与代数", "数与式"),
    ("先化简", "数与代数", "数与式"),
    ("代入求值", "数与代数", "数与式"),
    ("列代数式", "数与代数", "数与式"),
    ("正数和负数", "数与代数", "数与式"),
    ("正负数", "数与代数", "数与式"),
    ("相反意义的量", "数与代数", "数与式"),
    ("估算", "数与代数", "数与式"),
    ("有效数字", "数与代数", "数与式"),
    ("近似数", "数与代数", "数与式"),
    ("整数指数幂", "数与代数", "数与式"),
    ("零指数", "数与代数", "数与式"),
    ("负整数指数", "数与代数", "数与式"),
    # ---- 方程与不等式 ----
    ("一元一次方程", "数与代数", "方程与不等式"),
    ("一元二次方程", "数与代数", "方程与不等式"),
    ("二元一次方程", "数与代数", "方程与不等式"),
    ("三元一次方程", "数与代数", "方程与不等式"),
    ("分式方程", "数与代数", "方程与不等式"),
    ("方程组", "数与代数", "方程与不等式"),
    ("不等式组", "数与代数", "方程与不等式"),
    ("不等式", "数与代数", "方程与不等式"),
    ("解方程", "数与代数", "方程与不等式"),
    ("解不等式", "数与代数", "方程与不等式"),
    ("判别式", "数与代数", "方程与不等式"),
    ("根与系数", "数与代数", "方程与不等式"),
    ("韦达定理", "数与代数", "方程与不等式"),
    ("两个相等的实数根", "数与代数", "方程与不等式"),
    ("实数根", "数与代数", "方程与不等式"),
    ("增根", "数与代数", "方程与不等式"),
    ("列方程", "数与代数", "方程与不等式"),
    ("打折", "数与代数", "方程与不等式"),
    ("进价", "数与代数", "方程与不等式"),
    ("等量关系", "数与代数", "方程与不等式"),
    ("配套问题", "数与代数", "方程与不等式"),
    ("工程问题", "数与代数", "方程与不等式"),
    ("行程问题", "数与代数", "方程与不等式"),
    # ---- 函数 ----
    ("二次函数", "数与代数", "函数"),
    ("一次函数", "数与代数", "函数"),
    ("正比例函数", "数与代数", "函数"),
    ("反比例函数", "数与代数", "函数"),
    ("三角函数", "图形与几何", "图形的变化"),  # 锐角三角函数归"图形的变化"
    ("函数图象", "数与代数", "函数"),
    ("函数值", "数与代数", "函数"),
    ("自变量", "数与代数", "函数"),
    ("抛物线", "数与代数", "函数"),
    ("顶点坐标", "数与代数", "函数"),
    ("对称轴", "数与代数", "函数"),
    ("待定系数法", "数与代数", "函数"),
    ("解析式", "数与代数", "函数"),
    ("函数", "数与代数", "函数"),
    ("图象经过", "数与代数", "函数"),
    ("随的增大而", "数与代数", "函数"),
    # ---- 图形的性质 ----
    ("三角形", "图形与几何", "图形的性质"),
    ("四边形", "图形与几何", "图形的性质"),
    ("平行四边形", "图形与几何", "图形的性质"),
    ("矩形", "图形与几何", "图形的性质"),
    ("菱形", "图形与几何", "图形的性质"),
    ("正方形", "图形与几何", "图形的性质"),
    ("梯形", "图形与几何", "图形的性质"),
    ("多边形", "图形与几何", "图形的性质"),
    ("内角和", "图形与几何", "图形的性质"),
    ("外角", "图形与几何", "图形的性质"),
    ("圆的", "图形与几何", "图形的性质"),
    ("圆", "图形与几何", "图形的性质"),
    ("圆心角", "图形与几何", "图形的性质"),
    ("圆周角", "图形与几何", "图形的性质"),
    ("切线", "图形与几何", "图形的性质"),
    ("割线", "图形与几何", "图形的性质"),
    ("弦", "图形与几何", "图形的性质"),
    ("弧长", "图形与几何", "图形的性质"),
    ("扇形", "图形与几何", "图形的性质"),
    ("圆锥", "图形与几何", "图形的性质"),
    ("圆柱", "图形与几何", "图形的性质"),
    ("全等", "图形与几何", "图形的性质"),
    ("等腰", "图形与几何", "图形的性质"),
    ("等边三角形", "图形与几何", "图形的性质"),
    ("直角三角形", "图形与几何", "图形的性质"),
    ("勾股定理", "图形与几何", "图形的性质"),
    ("角平分线", "图形与几何", "图形的性质"),
    ("垂直平分线", "图形与几何", "图形的性质"),
    ("中线", "图形与几何", "图形的性质"),
    ("中位线", "图形与几何", "图形的性质"),
    ("平行线", "图形与几何", "图形的性质"),
    ("相交线", "图形与几何", "图形的性质"),
    ("对顶角", "图形与几何", "图形的性质"),
    ("余角", "图形与几何", "图形的性质"),
    ("补角", "图形与几何", "图形的性质"),
    ("三视图", "图形与几何", "图形的性质"),
    ("主视图", "图形与几何", "图形的性质"),
    ("俯视图", "图形与几何", "图形的性质"),
    ("左视图", "图形与几何", "图形的性质"),
    ("展开图", "图形与几何", "图形的性质"),
    ("正方体", "图形与几何", "图形的性质"),
    ("几何体", "图形与几何", "图形的性质"),
    ("尺规作图", "图形与几何", "图形的性质"),
    ("作图", "图形与几何", "图形的性质"),
    ("证明", "图形与几何", "图形的性质"),
    # ---- 图形的变化 ----
    ("轴对称图形", "图形与几何", "图形的变化"),
    ("轴对称", "图形与几何", "图形的变化"),
    ("中心对称图形", "图形与几何", "图形的变化"),
    ("中心对称", "图形与几何", "图形的变化"),
    ("旋转", "图形与几何", "图形的变化"),
    ("平移", "图形与几何", "图形的变化"),
    ("相似三角形", "图形与几何", "图形的变化"),
    ("相似", "图形与几何", "图形的变化"),
    ("位似", "图形与几何", "图形的变化"),
    ("投影", "图形与几何", "图形的变化"),
    ("锐角", "图形与几何", "图形的变化"),
    ("正弦", "图形与几何", "图形的变化"),
    ("余弦", "图形与几何", "图形的变化"),
    ("正切", "图形与几何", "图形的变化"),
    ("坡度", "图形与几何", "图形的变化"),
    ("坡角", "图形与几何", "图形的变化"),
    ("仰角", "图形与几何", "图形的变化"),
    ("俯角", "图形与几何", "图形的变化"),
    ("方向角", "图形与几何", "图形的变化"),
    ("折叠", "图形与几何", "图形的变化"),
    ("翻折", "图形与几何", "图形的变化"),
    # ---- 图形与坐标 ----
    ("平面直角坐标系", "图形与几何", "图形与坐标"),
    ("直角坐标系", "图形与几何", "图形与坐标"),
    ("象限", "图形与几何", "图形与坐标"),
    ("关于原点对称", "图形与几何", "图形与坐标"),
    ("关于轴对称", "图形与几何", "图形与坐标"),
    ("点的坐标", "图形与几何", "图形与坐标"),
    ("坐标为", "图形与几何", "图形与坐标"),
    ("坐标是", "图形与几何", "图形与坐标"),
    # ---- 抽样与数据分析 ----
    ("平均数", "统计与概率", "抽样与数据分析"),
    ("中位数", "统计与概率", "抽样与数据分析"),
    ("众数", "统计与概率", "抽样与数据分析"),
    ("方差", "统计与概率", "抽样与数据分析"),
    ("标准差", "统计与概率", "抽样与数据分析"),
    ("极差", "统计与概率", "抽样与数据分析"),
    ("加权", "统计与概率", "抽样与数据分析"),
    ("频数", "统计与概率", "抽样与数据分析"),
    ("频率分布", "统计与概率", "抽样与数据分析"),
    ("直方图", "统计与概率", "抽样与数据分析"),
    ("扇形统计图", "统计与概率", "抽样与数据分析"),
    ("条形统计图", "统计与概率", "抽样与数据分析"),
    ("折线统计图", "统计与概率", "抽样与数据分析"),
    ("统计图", "统计与概率", "抽样与数据分析"),
    ("统计表", "统计与概率", "抽样与数据分析"),
    ("抽样调查", "统计与概率", "抽样与数据分析"),
    ("全面调查", "统计与概率", "抽样与数据分析"),
    ("普查", "统计与概率", "抽样与数据分析"),
    ("样本", "统计与概率", "抽样与数据分析"),
    ("总体", "统计与概率", "抽样与数据分析"),
    ("估计", "统计与概率", "抽样与数据分析"),
    ("数据", "统计与概率", "抽样与数据分析"),
    # ---- 随机事件的概率 ----
    ("概率", "统计与概率", "随机事件的概率"),
    ("随机事件", "统计与概率", "随机事件的概率"),
    ("不可能事件", "统计与概率", "随机事件的概率"),
    ("必然事件", "统计与概率", "随机事件的概率"),
    ("树状图", "统计与概率", "随机事件的概率"),
    ("列表法", "统计与概率", "随机事件的概率"),
    ("摸出", "统计与概率", "随机事件的概率"),
    ("摸到", "统计与概率", "随机事件的概率"),
    ("不放回", "统计与概率", "随机事件的概率"),
    ("放回", "统计与概率", "随机事件的概率"),
    ("转盘", "统计与概率", "随机事件的概率"),
    ("掷", "统计与概率", "随机事件的概率"),
    ("随机", "统计与概率", "随机事件的概率"),
    # ---- 综合与实践 ----
    ("综合与实践", "综合与实践", ""),
    ("项目式", "综合与实践", ""),
    ("课题学习", "综合与实践", ""),
    ("数学活动", "综合与实践", ""),
    ("方案设计", "综合与实践", ""),
    ("实践活动", "综合与实践", ""),
]

# 领域冲突时的偏好顺序（分数相同时靠前者胜）
DOMAIN_PRIORITY = [
    ("统计与概率", "随机事件的概率"),
    ("统计与概率", "抽样与数据分析"),
    ("数与代数", "函数"),
    ("数与代数", "方程与不等式"),
    ("数与代数", "数与式"),
    ("图形与几何", "图形的变化"),
    ("图形与几何", "图形与坐标"),
    ("图形与几何", "图形的性质"),
    ("综合与实践", ""),
]

DOMAIN_LABEL = {
    ("数与代数", "数与式"): "数与式",
    ("数与代数", "方程与不等式"): "方程与不等式",
    ("数与代数", "函数"): "函数",
    ("图形与几何", "图形的性质"): "图形的性质",
    ("图形与几何", "图形的变化"): "图形的变化",
    ("图形与几何", "图形与坐标"): "图形与坐标",
    ("统计与概率", "抽样与数据分析"): "抽样与数据分析",
    ("统计与概率", "随机事件的概率"): "随机事件的概率",
    ("综合与实践", ""): "综合与实践",
}

# ---------------------------------------------------------------------------
# 1. docx -> 段落文本（含 OMML 公式）
# ---------------------------------------------------------------------------

# 段落匹配：`<w:p ...>` 或 `<w:p/>`。注意 `<w:pPr>` / `<w:pict>` 不会误命中，
# 因为这里要求 `w:p` 后面紧跟空格或 `>`。
_PARA_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>|<w:p(?:\s[^>]*)?/>", re.S)
# 文本节点：普通文字 `<w:t>` + 公式文字 `<m:t>`，按出现顺序拼接 = 阅读顺序
_TEXT_RE = re.compile(r"<(w:t|m:t)(?:\s[^>]*)?>(.*?)</\1>", re.S)


def _unescape(s: str) -> str:
    return (
        s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
        .replace("&amp;", "&")
    )


def docx_paragraphs(path: str | Path) -> list[str]:
    """读 docx 的 word/document.xml，返回按文档顺序的段落文本列表。

    公式（OMML 的 <m:t>）会拼进所在段落，段落边界不丢。
    表格里的段落（w:tbl>w:tr>w:tc>w:p）也会按顺序被收录。
    """
    with zipfile.ZipFile(str(path)) as z:
        raw = z.read("word/document.xml").decode("utf-8", "replace")
    out: list[str] = []
    for m in _PARA_RE.finditer(raw):
        chunk = m.group(0)
        text = "".join(_unescape(t.group(2)) for t in _TEXT_RE.finditer(chunk))
        out.append(text)
    return out


# ---------------------------------------------------------------------------
# 2. 卷头解析：年份 / 地区 / 总分 / 时长
# ---------------------------------------------------------------------------

RE_YEAR = re.compile(r"(20\d{2})\s*年")

# “满分 150 分”“全卷满分150分”“试卷满分：120分”
RE_TOTAL_SCORE = [
    re.compile(r"(?:全卷|试卷|本卷|卷面|卷|试题卷)?\s*(?:满分|总分|满分为|满分是|满分值)\s*(?:为|是|：|:)?\s*(\d{2,3})\s*分"),
]
# “考试时间120分钟”“考试用时120分钟”“全卷考试时间共120分钟”
RE_MINUTES = [
    re.compile(r"(?:考试时间|考试用时|考试时限|作答时间|用时|时间)\s*(?:共|为|是|：|:)?\s*(\d{2,3})\s*分\s*钟"),
    re.compile(r"(?:考试时间|考试用时|考试时限|作答时间|用时|时间)\s*(?:共|为|是|：|:)?\s*(\d{2,3})\s*min", re.I),
]

# 卷头噪声：这些行不是题目，但可能以 “1.” 开头
HEADER_NOISE = re.compile(
    r"答题卡|准考证|考生须知|考生注意|姓名|考场号|座位号|条形码|试卷共|共\d+页|"
    r"一律|作答无效|用2B铅笔|签字笔|考试结束|监考|注意事项|请将答案|不得|计算器"
)


def parse_region_from_name(stem: str) -> tuple[str, str]:
    """从文件名取 (地区全称, 省级行政区)。取不到给 unknown。"""
    m = RE_YEAR.search(stem)
    rest = stem[m.end():] if m else stem
    # 去掉常见后缀词，剩下的就是地区
    rest = re.sub(r"（[^）]*）|\([^)]*\)", "", rest)
    m2 = re.match(
        r"^(.+?)(?:中考|初中学业水平|初中毕业|学业水平|数学|试题|试卷|真题|统考|联考)",
        rest,
    )
    region = (m2.group(1) if m2 else rest).strip(" 　_")
    region = re.sub(r"[（(]答案[）)]|答案|含答案|解析", "", region).strip(" 　_-")
    if not region:
        return "unknown", "unknown"

    # 省级切分：省级单位在前，市/州在后
    prov_pat = re.compile(
        r"^(北京市|上海市|天津市|重庆市|[^市]{2,8}?(?:省|自治区|特别行政区))"
    )
    mp = prov_pat.match(region)
    if mp:
        prov = mp.group(1)
        city = region[mp.end():].strip("省市区县州")
        return region, prov
    return region, region


def parse_paper_meta(paras: list[str], stem: str, head_end: int | None = None) -> dict:
    """解析卷头信息。找不到的字段如实给 None + 原因。

    head_end：第一个大题标题所在的段落下标；卷头只在这个位置之前找，
    否则会把“一、选择题（共40分）”里的 40 当成卷面总分（这是实际踩过的坑）。
    """
    nonempty_idx = [i for i, p in enumerate(paras) if p.strip()]
    nonempty = [paras[i].strip() for i in nonempty_idx]
    meta: dict = {"notes": []}

    m = RE_YEAR.search(stem)
    meta["year"] = int(m.group(1)) if m else None
    if meta["year"] is None:
        for p in nonempty[:10]:
            m = RE_YEAR.search(p)
            if m:
                meta["year"] = int(m.group(1))
                break
    if meta["year"] is None:
        meta["notes"].append("年份：文件名与卷头都没找到 20xx 年")

    region, prov = parse_region_from_name(stem)
    meta["region"] = region
    meta["province"] = prov

    # 卷头区域：第一道大题标题之前（封顶 60 段）
    if head_end is None:
        head_end = len(paras)
    head = "\n".join(p for i, p in zip(nonempty_idx, nonempty) if i < head_end)[:4000]
    # 全篇兜底（只看前 400 个非空段落，避免命中正文里的“满分”字样）
    full = "\n".join(nonempty[:400])

    total = None
    for rx in RE_TOTAL_SCORE:
        m = rx.search(head)
        if m:
            total = int(m.group(1))
            break
    if total is None:
        for rx in RE_TOTAL_SCORE:
            m = rx.search(full)
            if m:
                total = int(m.group(1))
                meta["notes"].append("总分：卷头段落里没找到，取自正文较早出现的“满分 N 分”")
                break
    if total is None:
        meta["notes"].append("总分：全卷没有“满分/总分 N 分”字样")
    meta["totalScore"] = total

    minutes = None
    for rx in RE_MINUTES:
        m = rx.search(head)
        if m:
            minutes = int(m.group(1))
            break
    if minutes is None:
        for rx in RE_MINUTES:
            m = rx.search(full)
            if m:
                minutes = int(m.group(1))
                meta["notes"].append("时长：卷头段落里没找到，取自正文较早出现的“N 分钟”")
                break
    if minutes is None:
        meta["notes"].append("时长：全卷没有“N 分钟”字样")
    meta["minutes"] = minutes

    if not head.strip():
        meta["notes"].append("卷头：第一个大题标题前没有文字（常见于只剩题目的整理稿）")
    return meta


# ---------------------------------------------------------------------------
# 3. 大题（题号区间 / 题型 / 分值）解析
# ---------------------------------------------------------------------------

TYPE_SELECT = "选择"
TYPE_BLANK = "填空"
TYPE_SOLVE = "解答"
TYPE_JUDGE = "判断"

TYPE_WORDS = [
    (TYPE_SELECT, ["单项选择题", "单项选择", "多项选择题", "多选题", "选择题", "单选题"]),
    (TYPE_BLANK, ["填空题", "填空"]),
    (TYPE_JUDGE, ["判断题", "判断"]),
    (TYPE_SOLVE, ["解答题", "解答", "计算题", "证明题", "作图题", "应用题", "综合题", "操作题", "实践题"]),
]

# 大题标题里的计数声明
RE_N_Q = re.compile(r"(?:共|有|含)\s*(\d{1,2})\s*(?:个)?\s*(?:小)?题")
RE_PER = re.compile(r"每\s*(?:小)?题\s*(\d{1,2}(?:\.\d)?)\s*分")
RE_SEC_TOTAL = re.compile(r"(?:共|满分|合计)\s*(?:为|是|：|:)?\s*(\d{1,3}(?:\.\d)?)\s*分")

# 大题标题前缀：一、 / 二． / （三） / 第Ⅱ卷/第Ⅰ部分 —— 必须真的存在
SEC_PREFIX_RE = re.compile(
    r"^\s*(?:(?:第\s*[一二三四五六七八九十]+\s*(?:部分|卷))|(?:[（(]?\s*[一二三四五六七八九十]{1,3}\s*[)）]?\s*[、.．,，:：]))"
)
# 没有序号、直接以题型词开头的标题（如“填空题（本题共6小题，每小题3分）”）
TYPE_START_RE = re.compile(
    r"^\s*[（(]?\s*(单项选择题|单项选择|多项选择题|多选题|选择题|单选题|"
    r"填空题|解答题|判断题|解答|计算题|证明题|作图题|应用题|综合题|操作题|实践题)"
)
# 标题里的计数声明（有的标题只写“本大题共5个小题，每小题8分，共40分。”不写题型）
RE_SECTION_STYLE = re.compile(r"(?:本大题|本题|本部分)")
# 明显是题目/数据行，不可能是标题
LOOKS_LIKE_QUESTION = re.compile(r"^\s*\d{1,2}\s*[.．、)）]|^\s*\d{1,2}\s+\S")


def detect_section(p: str) -> dict | None:
    """判断某段是不是大题标题；是则返回 {type, nQ, per, total, raw}。

    只有两种情形算标题：
      A. 段落以“一、/ 二、/ 第Ⅱ卷 / 第X部分”这类序号开头，且序号后紧跟题型词；
      B. 段落直接以题型词开头（“填空题（共6小题，每小题3分，共18分）”）。
    再加一条特例：序号开头 + “本大题共N小题，每小题M分”这种不带题型词的标题。
    这样可以把题干里的“判断”“解答”字样排除掉（这是实际踩过的坑）。
    """
    s = p.strip()
    if not s or len(s) > 180:
        return None
    if LOOKS_LIKE_QUESTION.match(s):
        return None
    if s.startswith(("参考答案", "答案", "解析", "【")):
        return None

    m_prefix = SEC_PREFIX_RE.match(s)
    has_prefix = bool(m_prefix)
    body = s[m_prefix.end():].strip() if has_prefix else s

    m_type = TYPE_START_RE.match(body)
    tname = None
    word = None
    if m_type:
        word = m_type.group(1)
        for t, words in TYPE_WORDS:
            if word in words:
                tname = t
                break
        body = body[m_type.end():]
    elif not (has_prefix and RE_SECTION_STYLE.search(s)):
        return None
    else:
        # 序号 + “本大题共…”：题型未知，靠题内容判定
        tname = None

    if tname is None and not has_prefix:
        return None

    # “非选择题”是对全卷第二部分的说明，不是大题（此时没有题型词，并且带“卷/部分”）
    if tname is None and re.search(r"非选择", s):
        return None

    nq = per = tot = None
    m = RE_N_Q.search(s)
    if m:
        nq = int(m.group(1))
    m = RE_PER.search(s)
    if m:
        per = float(m.group(1))
    cand = [float(x) for x in RE_SEC_TOTAL.findall(s)]
    if cand:
        tot = cand[-1]
    return {
        "type": tname,
        "word": word,
        "nQ": nq,
        "per": per,
        "total": tot,
        "raw": s,
    }


# ---------------------------------------------------------------------------
# 4. 题目切分
# ---------------------------------------------------------------------------

# 题号开头：1. / 1． / 1、 / 1) / “23 阅读下列材料”（有的卷子用空格分隔）
# 空格分隔这一支要求后面不是数字/小数点，避免把数据行“50.03  49.98”当成题号。
RE_QNUM = re.compile(
    r"^\s*(\d{1,2})\s*(?:[.．、)）]\s*|\s(?=[^\d.．]))"
)
# 题号后紧跟的分数标记：“（2分）”“(4分)”
RE_INLINE_SCORE = re.compile(r"[（(]\s*(\d{1,3}(?:\.\d)?)\s*分\s*[)）]")
# 明显不是题目的行（卷头须知 / 答案区）
NOT_QUESTION = re.compile(
    r"参考答案|答案与解析|试题解析|【分析】|【详解】|【解答】|【点评】|【答案】|"
    r"考生须知|考生注意|注意事项|答题卡|准考证|条形码|姓名|考场号|座位号|"
    r"试卷共|共\s*\d+\s*页|一律|无效|2B铅笔|签字笔|监考|计算器|"
    r"^第\s*[ⅠⅡⅢ一二三]\s*(?:部分|卷)|^[一二三四五六七八九十]\s*[、.．]|^[ABCD]\s*[.．、]"
)


# 选项标号：一行以 A. / A． / A、 / A) 开头（要求后面不是字母，避免命中变量名）
RE_OPTION_LINE = re.compile(r"(?:^|\n)\s*[ABCD]\s*[.．、)）]\s*(?=[^\w]|$)", re.M)
# 填空横线
RE_BLANK = re.compile(r"_{2,}|＿{2,}|—{3,}")


def guess_type_by_content(text: str) -> str:
    """不看大题标题，光看题目正文猜题型（作为标题缺失时的兜底与校验）。"""
    if len(RE_OPTION_LINE.findall(text)) >= 2:
        return TYPE_SELECT
    if RE_BLANK.search(text) and len(text) < 320:
        return TYPE_BLANK
    return TYPE_SOLVE


def split_questions(paras: list[str]) -> list[dict]:
    """把段落序列切成题目块。用“题号必须从 1 开始连续递增”来过滤卷头噪声。

    返回 [{no, score, text, start, end}]，text 含题干与选项。
    """
    candidates: list[tuple[int, int, str]] = []
    for i, p in enumerate(paras):
        s = p.strip()
        if not s or len(s) < 4:
            continue
        if NOT_QUESTION.search(s):
            continue
        m = RE_QNUM.match(s)
        if not m:
            continue
        candidates.append((i, int(m.group(1)), s))

    # 贪心找最长连续序列 1,2,3,...
    expected = 1
    picked: list[tuple[int, int, str]] = []
    for i, no, s in candidates:
        if no == expected:
            picked.append((i, no, s))
            expected += 1
    # 允许卷子从 1 开始但中间缺号（丢页/丢图）——上面的贪心只会停在第一个缺口，
    # 所以再做一轮“宽松续接”：缺口 <=2 时继续，接受最大数量。
    if picked:
        loose: list[tuple[int, int, str]] = []
        exp = 1
        for i, no, s in candidates:
            if no == exp or (exp < no <= exp + 2):
                loose.append((i, no, s))
                exp = no + 1
        if len(loose) > len(picked):
            picked = loose

    if not picked:
        return []

    # 收集每题的正文：从本题段落起，到下一题段落前
    out: list[dict] = []
    for k, (i, no, s) in enumerate(picked):
        j = picked[k + 1][0] if k + 1 < len(picked) else len(paras)
        block = [x.strip() for x in paras[i:j] if x.strip()]
        text = "\n".join(block)
        ms = RE_INLINE_SCORE.search(block[0][:80])
        out.append(
            {
                "no": no,
                "score": float(ms.group(1)) if ms else None,
                "text": text,
                "contentType": guess_type_by_content(text),
                "start": i,
                "end": j,
                "firstLine": block[0][:120],
            }
        )
    return out


# ---------------------------------------------------------------------------
# 5. 知识点归类
# ---------------------------------------------------------------------------

# 按关键词长度预排序（长的优先匹配，权重更高）
_KW_SORTED = sorted(KEYWORD_RULES, key=lambda x: -len(x[0]))


def classify_domain(text: str) -> tuple[tuple[str, str] | None, list[str]]:
    """把一道题归到课标领域+主题。返回 ((一级, 二级) 或 None, 命中的关键词)。

    规则：每个命中的关键词贡献 len(关键词) 分；取总分最高的领域；
    分数相同按 DOMAIN_PRIORITY 取靠前者；一分都没有 -> (None, []) 即 unknown。
    """
    scores: dict[tuple[str, str], int] = collections.defaultdict(int)
    hits: list[str] = []
    for kw, d1, d2 in _KW_SORTED:
        if kw in text:
            scores[(d1, d2)] += len(kw)
            hits.append(kw)
    if not scores:
        return None, []
    best = max(scores.values())
    for cand in DOMAIN_PRIORITY:
        if scores.get(cand, 0) == best:
            return cand, hits
    # 理论上到不了这里
    top = max(scores.items(), key=lambda kv: kv[1])[0]
    return top, hits


# ---------------------------------------------------------------------------
# 6. 单份卷子 -> 结构记录
# ---------------------------------------------------------------------------

# 目录名/文件名里出现这些词 => 是答案/解析版，不含卷面结构
ANSWER_HINT = re.compile(r"[（(]答案[)）]|答案|解析|详解")


def looks_like_answer_only(paras: list[str], stem: str) -> bool:
    """纯答案/解析文件：没有大题标题，且大量 【分析】【详解】 标记。"""
    txt = "\n".join(paras)
    n_analysis = txt.count("【分析】") + txt.count("【详解】") + txt.count("【解答】")
    n_sec = sum(1 for p in paras if detect_section(p))
    if n_analysis >= 5 and n_sec == 0:
        return True
    # 有“参考答案”且前面没有卷面（没有 一、选择题 这种）
    if n_sec == 0 and re.search(r"参考答案|答案与解析|试题解析", txt):
        return True
    return False


def parse_paper(path: str, txt_path: str | None = None) -> dict:
    stem = Path(path).stem
    paras = docx_paragraphs(path)
    # 先定位第一个大题标题，卷头解析只在它之前做
    first_sec_i = None
    for i, p in enumerate(paras):
        if detect_section(p):
            first_sec_i = i
            break
    meta = parse_paper_meta(paras, stem, head_end=first_sec_i)
    rec: dict = {
        "source": path,
        "fileName": Path(path).name,
        "txt": txt_path,
        "year": meta["year"],
        "region": meta["region"],
        "province": meta["province"],
        "totalScore": meta["totalScore"],
        "minutes": meta["minutes"],
        "isAnswerVersion": bool(ANSWER_HINT.search(stem)),
        "notes": list(meta["notes"]),
        "sections": [],
        "questions": [],
        "unknown": [],
    }

    if looks_like_answer_only(paras, stem):
        rec["isAnswerVersion"] = True
        rec["parseStatus"] = "answer-only"
        rec["notes"].append("解析失败：该文件是答案/解析版，不含卷面（无大题标题，只有【分析】【详解】）")
        rec["unknown"].append("整卷结构（答案版文件）")
        return rec

    questions = split_questions(paras)
    if not questions:
        rec["parseStatus"] = "no-questions"
        rec["notes"].append("解析失败：没能定位连续题号（可能题号在图片/OLE 里，或排版异常）")
        rec["unknown"].append("整卷结构（无题号）")
        return rec

    # --- 大题标题 ---
    secs: list[dict] = []
    for i, p in enumerate(paras):
        d = detect_section(p)
        if d:
            secs.append({"start": i, **d})

    # 把题目按段落位置分配到最近的大题下
    assigned: list[dict] = []
    si = -1
    for q in questions:
        while si + 1 < len(secs) and secs[si + 1]["start"] < q["start"]:
            si += 1
        sec = secs[si] if si >= 0 else None
        assigned.append({"q": q, "sec": sec})

    # --- 大题结构 ---
    groups: list[dict] = []
    for item in assigned:
        key = id(item["sec"])
        if not groups or groups[-1]["_key"] != key:
            sec = item["sec"]
            groups.append(
                {
                    "_key": key,
                    "type": sec["type"] if sec else "unknown",
                    "heading": sec["raw"] if sec else None,
                    "declaredCount": sec["nQ"] if sec else None,
                    "declaredPerScore": sec["per"] if sec else None,
                    "declaredTotal": sec["total"] if sec else None,
                    "questions": [],
                }
            )
        groups[-1]["questions"].append(item["q"])

    for g in groups:
        qs = g.pop("questions")
        g["qFrom"] = qs[0]["no"]
        g["qTo"] = qs[-1]["no"]
        g["detectedCount"] = len(qs)
        # 题型：标题写的优先；标题没写题型，就用题内容的多数类型
        content_types = collections.Counter(q["contentType"] for q in qs)
        g["contentTypes"] = dict(content_types)
        if g["type"] is None:
            g["type"] = content_types.most_common(1)[0][0]
            g["typeSource"] = "content"
        else:
            g["typeSource"] = "heading"
            if content_types.most_common(1)[0][0] != g["type"]:
                rec["notes"].append(
                    f"第{g['qFrom']}-{g['qTo']}题：标题写“{g['type']}题”，"
                    f"但题目内容更像“{content_types.most_common(1)[0][0]}题”"
                    f"（内容判定分布 {dict(content_types)}）"
                )
        # 题数以标题声明为准（标题是卷子的设计值），没有声明才用切出来的数量
        g["count"] = g["declaredCount"] or g["detectedCount"]
        scores = [q["score"] for q in qs if q["score"] is not None]
        g["scoresKnown"] = len(scores)
        if scores:
            uniq = sorted(set(scores))
            g["perScore"] = uniq[0] if len(uniq) == 1 else uniq
            if len(uniq) > 1 and g["declaredPerScore"] is None:
                rec["notes"].append(f"第{g['qFrom']}-{g['qTo']}题：每小题分值不唯一 {uniq}")
        else:
            g["perScore"] = g["declaredPerScore"]
        # 分值合计的优先级：标题声明的“共N分” > 逐题分值之和 > 每小题分×题数
        if g["declaredTotal"] is not None:
            g["scoreSum"] = g["declaredTotal"]
            g["scoreSumSource"] = "heading-total"
        elif scores and len(scores) == g["detectedCount"]:
            g["scoreSum"] = sum(scores)
            g["scoreSumSource"] = "inline-scores"
        elif g["declaredPerScore"] is not None and g["declaredCount"]:
            g["scoreSum"] = round(g["declaredPerScore"] * g["declaredCount"], 2)
            g["scoreSumSource"] = "per-x-count"
        elif scores:
            g["scoreSum"] = sum(scores)
            g["scoreSumSource"] = "partial-inline"
        else:
            g["scoreSum"] = None
            g["scoreSumSource"] = None
        if (
            g["declaredTotal"] is not None
            and scores
            and len(scores) == g["detectedCount"]
            and abs(g["declaredTotal"] - sum(scores)) > 0.01
        ):
            g["scoreMismatch"] = [sum(scores), g["declaredTotal"]]
        if g["declaredCount"] is not None and g["declaredCount"] != g["detectedCount"]:
            rec["notes"].append(
                f"第{g['qFrom']}-{g['qTo']}题：标题声明 {g['declaredCount']} 题，"
                f"实际切到 {g['detectedCount']} 题（缺号多为题目在图片/OLE 里）"
            )
        g.pop("_key", None)
        rec["sections"].append(g)

    # --- 总分兜底：卷头没有“满分 N 分”时，用各大题分值之和 ---
    sec_total = sum(g["scoreSum"] for g in rec["sections"] if g["scoreSum"] is not None)
    sec_total_known = all(g["scoreSum"] is not None for g in rec["sections"]) and rec["sections"]
    if rec["totalScore"] is None and sec_total_known:
        rec["totalScore"] = round(sec_total, 2)
        rec["notes"].append(
            f"总分：卷头没有满分字样，取各大题分值之和 = {round(sec_total, 2)} 分"
        )
    rec["sectionScoreSum"] = round(sec_total, 2) if sec_total_known else None

    # --- 题型统计 ---
    type_stat: dict[str, dict] = collections.defaultdict(lambda: {"count": 0, "score": 0.0})
    for g in rec["sections"]:
        t = g["type"] if g["type"] != "unknown" else "unknown"
        type_stat[t]["count"] += g["count"]
        type_stat[t]["score"] += g["scoreSum"] or 0
    rec["typeStat"] = {k: {"count": v["count"], "score": round(v["score"], 2)} for k, v in type_stat.items()}

    objective_q = sum(type_stat[t]["count"] for t in ("选择", "判断") if t in type_stat)
    objective_s = sum(type_stat[t]["score"] for t in ("选择", "判断") if t in type_stat)
    rec["objective"] = {
        "count": objective_q,
        "score": round(objective_s, 2),
        "ratio": round(objective_s / rec["totalScore"], 4) if rec["totalScore"] else None,
        "note": "客观题 = 选择题 + 判断题的题数与分值；填空题在本表里计入主观题"
        "（若按“填空属客观题”的算法，客观题分值 = 选择+判断+填空）",
    }
    fill_s = type_stat.get("填空", {}).get("score", 0)
    rec["objective"]["scoreWithBlank"] = round(objective_s + fill_s, 2)
    rec["objective"]["ratioWithBlank"] = (
        round((objective_s + fill_s) / rec["totalScore"], 4) if rec["totalScore"] else None
    )

    # --- 每题知识点 ---
    dom_counter: dict[str, dict] = collections.defaultdict(lambda: {"count": 0, "score": 0.0})
    for item in assigned:
        q = item["q"]
        sec = item["sec"]
        d, hits = classify_domain(q["text"])
        q["type"] = sec["type"] if sec else "unknown"
        q["domain"] = DOMAIN_LABEL.get(d, "unknown") if d else "unknown"
        q["domainPath"] = f"{d[0]}/{d[1]}" if d and d[1] else (d[0] if d else "unknown")
        q["keywords"] = hits[:12]
        sc = q["score"]
        if sc is None:
            g = next(
                (g for g in rec["sections"] if g["qFrom"] <= q["no"] <= g["qTo"]), None
            )
            per = g.get("perScore") if g else None
            sc = per if isinstance(per, (int, float)) else None
            q["scoreSource"] = "section"
        else:
            q["scoreSource"] = "inline"
        q["score"] = sc
        dom_counter[q["domain"]]["count"] += 1
        dom_counter[q["domain"]]["score"] += sc or 0
        # 精简落盘体积
        q.pop("text", None)
        q.pop("firstLine", None)
        rec["questions"].append(
            {
                "no": q["no"],
                "type": q["type"],
                "score": q["score"],
                "domain": q["domain"],
                "domainPath": q["domainPath"],
                "keywords": q["keywords"],
            }
        )
    rec["domainStat"] = {
        k: {"count": v["count"], "score": round(v["score"], 2)} for k, v in dom_counter.items()
    }

    # 总题数：优先用各大题声明题数之和（更接近卷面设计），否则用切出的题数
    rec["questionCount"] = len(questions)
    rec["questionCountDeclared"] = sum(g["count"] for g in rec["sections"])
    rec["sumOfQuestionScores"] = sum(q["score"] or 0 for q in rec["questions"])

    # --- 解析状态 ---
    problems = []
    if rec["totalScore"] is None:
        problems.append("总分 unknown")
    if rec["minutes"] is None:
        problems.append("时长 unknown")
    if any(g["type"] == "unknown" for g in rec["sections"]):
        problems.append("存在未识别题型的大题")
    if not all(g["scoreSum"] is not None for g in rec["sections"]):
        miss = [f"{g['qFrom']}-{g['qTo']}" for g in rec["sections"] if g["scoreSum"] is None]
        problems.append(f"大题分值 unknown：第{'、'.join(miss)}题段")
    if (
        rec["totalScore"]
        and rec["sectionScoreSum"]
        and abs(rec["totalScore"] - rec["sectionScoreSum"]) > 1
    ):
        problems.append(
            f"卷头总分 {rec['totalScore']} ≠ 大题分值合计 {rec['sectionScoreSum']}"
        )
    if rec["questionCountDeclared"] != rec["questionCount"]:
        problems.append(
            f"声明题数 {rec['questionCountDeclared']} ≠ 切出题数 {rec['questionCount']}"
        )
    rec["unknown"] = problems
    rec["parseStatus"] = "ok" if not problems else "partial"
    return rec


# ---------------------------------------------------------------------------
# 7. 抽取阶段：写 txt
# ---------------------------------------------------------------------------

def safe_slug(s: str) -> str:
    s = re.sub(r"[/\\:*?\"<>|\n\r\t]", "_", s).strip(" ._")
    return s[:120] or "untitled"


def cmd_extract(args) -> dict:
    src = Path(args.src)
    out = Path(args.txt)
    out.mkdir(parents=True, exist_ok=True)
    files = sorted(glob.glob(str(src / "**" / "*.docx"), recursive=True))
    if args.limit:
        files = files[: args.limit]
    index: dict[str, dict] = {}
    used: collections.Counter = collections.Counter()
    for f in files:
        p = Path(f)
        year = "0000"
        m = RE_YEAR.search(p.stem)
        if m:
            year = m.group(1)
        slug = f"{year}_{safe_slug(p.stem)}"
        used[slug] += 1
        if used[slug] > 1:
            slug = f"{slug}__{used[slug]}"
        txt_path = out / f"{slug}.txt"
        paras = docx_paragraphs(p)
        body = "\n".join(paras)
        txt_path.write_text(body, encoding="utf-8")
        index[txt_path.name] = {
            "source": str(p),
            "paragraphs": len(paras),
            "chars": len(body),
        }
    (out / "_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[extract] {len(files)} 份 docx -> {out} （索引 {out/'_index.json'}）")
    return index


# ---------------------------------------------------------------------------
# 8. 报告生成
# ---------------------------------------------------------------------------

def _pct(a: float, b: float) -> str:
    return f"{a/b*100:.1f}%" if b else "-"


def build_report(records: list[dict], struct_meta: dict) -> str:
    L: list[str] = []
    A = L.append

    papers = [
        r for r in records if r["parseStatus"] != "answer-only" and r.get("usedInStats", True)
    ]
    answer_only = [r for r in records if r["parseStatus"] == "answer-only"]
    superseded = [r for r in records if not r.get("usedInStats", True)]
    ok = [r for r in papers if r["parseStatus"] == "ok"]
    partial = [r for r in papers if r["parseStatus"] == "partial"]
    no_q = [r for r in papers if r["parseStatus"] == "no-questions"]

    A("# 近三年全国中考数学真题 · 卷面结构统计报告")
    A("")
    A(f"数据来源：`data/zhenti/近三年全国各省、直辖市数学中考试题/{{2023,2024,2025}}中考数学真题/**/*.docx`")
    A("")
    A("## 0. 样本与方法")
    A("")
    A(f"- 扫描 docx 总数：**{len(records)} 份**")
    A(f"- 其中答案/解析版（只有【分析】【详解】，不含卷面）：**{len(answer_only)} 份** → 不参与结构统计")
    A(
        f"- 另有 **{len(superseded)} 份**与试卷正文重复（同一份卷子的“（答案）”副本，"
        f"或同一文件放在两个目录里）→ 已按卷名去重，不重复计数"
    )
    A(f"- 进入结构统计的卷子：**{len(papers)} 份**（同一份卷子只算一次）")
    A(f"  - 完整解析（总分+时长+大题+分值能互相核对）：**{len(ok)} 份**")
    A(f"  - 部分解析（题号与题型拿到，个别字段缺或对不上）：**{len(partial)} 份**")
    A(f"  - 完全没切出题号：**{len(no_q)} 份**")
    A("")
    A("抽取方法：不装依赖，直接解压 docx 读 `word/document.xml`，")
    A("用正则按文档顺序把 `<w:t>`（正文）与 `<m:t>`（Word 公式 OMML）拼回同一段落，")
    A("段落边界严格按 `<w:p>` 保留，因此题干、选项（A. B. C. D.）、小题之间的边界都不丢。")
    A("")
    A("**已知损失**：① 以图片 / OLE 对象嵌入的数学式（很多卷子的图形题、部分选项）拿不到文字，")
    A("题干会出现“（    ）”空白，知识点归类会因此偏保守；② 图形本身拿不到，纯靠文字关键词判断。")
    A("")

    # --- 年份 × 解析状态 ---
    byyear: dict[int, dict] = collections.defaultdict(lambda: collections.Counter())
    for r in records:
        y = r["year"] or 0
        byyear[y]["total"] += 1
        byyear[y][r["parseStatus"]] += 1
        if not r.get("usedInStats", True) and r["parseStatus"] != "answer-only":
            byyear[y]["dedup"] += 1
        elif r.get("usedInStats", True) and r["parseStatus"] != "answer-only":
            byyear[y]["papers"] += 1
    A("### 样本与解析状态（按年份）")
    A("")
    A("| 年份 | docx 总数 | 去重后卷子 | 完整解析 | 部分解析 | 答案/解析版 | 无题号 |")
    A("|---|---|---|---|---|---|---|")
    for y in sorted(byyear):
        d = byyear[y]
        A(
            f"| {y or 'unknown'} | {d['total']} | {d['papers']} | {d['ok']} | "
            f"{d['partial']} | {d['answer-only']} | {d['no-questions']} |"
        )
    A("")

    # --- 分值制式分组 ---
    spec: dict[int, list[dict]] = collections.defaultdict(list)
    unknown_score = []
    for r in papers:
        if r["totalScore"]:
            spec[r["totalScore"]].append(r)
        else:
            unknown_score.append(r)
    A("### 分值制式分组（依据卷头“满分 N 分”）")
    A("")
    A("| 满分 | 卷数 | 占含卷面样本 | 常见时长 | 常见题数 |")
    A("|---|---|---|---|---|")
    for s in sorted(spec, key=lambda k: -len(spec[k])):
        rs = spec[s]
        mins = collections.Counter(r["minutes"] for r in rs if r["minutes"])
        qs = collections.Counter(r["questionCount"] for r in rs if r.get("questionCount"))
        mins_s = "、".join(f"{k}分钟({v})" for k, v in mins.most_common(3)) or "unknown"
        qs_s = "、".join(f"{k}题({v})" for k, v in qs.most_common(3)) or "unknown"
        A(f"| {s} | {len(rs)} | {_pct(len(rs), len(papers))} | {mins_s} | {qs_s} |")
    if unknown_score:
        A(f"| unknown | {len(unknown_score)} | {_pct(len(unknown_score), len(papers))} | - | - |")
    A("")

    # --- 典型结构：按 (满分, 题数序列) 分组 ---
    A("### 典型卷面结构（按“满分 + 各大题题数与分值”聚类）")
    A("")
    sig_counter: dict[tuple, list[dict]] = collections.defaultdict(list)
    for r in papers:
        if not r["sections"] or not r["totalScore"]:
            continue
        sig = tuple(
            (g["type"], g["count"], g.get("perScore") if not isinstance(g.get("perScore"), list) else "混")
            for g in r["sections"]
        )
        sig_counter[(r["totalScore"], sig)].append(r)

    def sig_str(sig) -> str:
        parts = []
        for t, c, per in sig:
            per_s = f"×{per}分" if per not in (None, "混") else "×(分值未知/混合)"
            parts.append(f"{t} {c} 题 {per_s}")
        return " + ".join(parts)

    A("只列出样本数 ≥ 2 的结构；单份独有的结构在 `structure.json` 里逐份可查。")
    A("")
    A("| # | 满分 | 结构 | 样本数 | 平均总题数 | 大题数 |")
    A("|---|---|---|---|---|---|")
    ranked = sorted(sig_counter.items(), key=lambda kv: -len(kv[1]))
    rank_no = 0
    for (ts, sig), rs in ranked:
        if len(rs) < 2:
            continue
        rank_no += 1
        avgq = sum(r["questionCount"] for r in rs) / len(rs)
        A(f"| {rank_no} | {ts} | {sig_str(sig)} | **{len(rs)}** | {avgq:.1f} | {len(sig)} |")
    A("")

    # --- 最常见结构详解（挑样本数最多的一个制式）---
    A("### 各分值制式下最常见结构的细目")
    A("")
    for s in sorted(spec, key=lambda k: -len(spec[k])):
        rs = spec[s]
        if len(rs) < 3:
            continue
        cnt = collections.Counter()
        for r in rs:
            if not r["sections"]:
                continue
            cnt[tuple((g["type"], g["count"]) for g in r["sections"])] += 1
        if not cnt:
            continue
        A(f"**{s} 分制（{len(rs)} 份卷子支持）**")
        A("")
        A("| 结构（题型 × 题数） | 卷数 |")
        A("|---|---|")
        for sig, c in cnt.most_common(6):
            A(f"| {' + '.join(f'{t}{n}' for t, n in sig)} | {c} |")
        A("")
        # 题型分值统计
        agg: dict[str, dict] = collections.defaultdict(lambda: {"n": 0, "score": 0.0, "q": 0})
        for r in rs:
            for g in r["sections"]:
                a = agg[g["type"]]
                a["n"] += 1
                a["score"] += g.get("scoreSum") or 0
                a["q"] += g["count"]
        A("| 题型 | 出现卷次数 | 平均每卷题数 | 平均每卷分值 | 平均每题分值 |")
        A("|---|---|---|---|---|")
        for t, a in sorted(agg.items(), key=lambda kv: -kv[1]["score"]):
            A(
                f"| {t} | {a['n']} | {a['q']/len(rs):.1f} | {a['score']/len(rs):.1f} | "
                f"{a['score']/a['q'] if a['q'] else 0:.2f} |"
            )
        A("")

    # --- 客观/主观 ---
    A("### 客观题与主观题比例")
    A("")
    ratios = [r for r in papers if r["totalScore"] and r.get("objective", {}).get("ratio") is not None]
    if ratios:
        def bucket(x):
            lo = int(x * 10) / 10
            return f"{lo:.1f}~{lo+0.1:.1f}"
        b1 = collections.Counter(bucket(r["objective"]["ratio"]) for r in ratios)
        b2 = collections.Counter(bucket(r["objective"]["ratioWithBlank"]) for r in ratios)
        A(f"样本：{len(ratios)} 份（卷头总分已知且题型已识别）")
        A("")
        A("客观题 = 选择题（+判断题）；口径二把填空题也算作客观题。")
        A("")
        A("| 客观题分值占比 | 卷数（口径一：选择+判断） | 卷数（口径二：+填空） |")
        A("|---|---|---|")
        for k in sorted(set(b1) | set(b2)):
            A(f"| {k} | {b1.get(k,0)} | {b2.get(k,0)} |")
        A("")
        A(
            f"口径一均值 {sum(r['objective']['ratio'] for r in ratios)/len(ratios)*100:.1f}%；"
            f"口径二均值 {sum(r['objective']['ratioWithBlank'] for r in ratios)/len(ratios)*100:.1f}%。"
        )
        A("")

    # --- 知识点分布 ---
    A("### 知识点（课标领域/主题）分布")
    A("")
    A("**归类规则**：对每道题的题干 + 全部选项文本做关键词匹配，")
    A("每个命中的关键词按**关键词字数**计分（词越长越具体、权重越高），")
    A("取总分最高的「领域/主题」；同分时按固定优先级取舍（概率 > 统计 > 函数 > 方程与不等式 >")
    A("数与式 > 图形的变化 > 图形与坐标 > 图形的性质）；一个关键词都没命中 → **unknown**，不硬塞。")
    A("关键词表见 `scripts/zhenti_stats.py` 顶部 `KEYWORD_RULES`（共 "
      f"{len(KEYWORD_RULES)} 个词），全部取自初中教材/课标的常规名词。")
    A("")
    dom_all: dict[str, dict] = collections.defaultdict(lambda: {"count": 0, "score": 0.0, "papers": set()})
    tot_q = 0
    tot_s = 0.0
    for r in papers:
        for q in r.get("questions", []):
            d = q["domain"]
            dom_all[d]["count"] += 1
            dom_all[d]["score"] += q["score"] or 0
            dom_all[d]["papers"].add(r["region"] + str(r["year"]))
            tot_q += 1
            tot_s += q["score"] or 0
    A(f"样本：{len(papers)} 份卷子、共 {tot_q} 道题（切出的题），其中分值可统计的合计 {tot_s:.0f} 分。")
    A("")
    A("| 领域/主题 | 题目数 | 题数占比 | 分值合计 | 分值占比 | 出现该领域的卷数 |")
    A("|---|---|---|---|---|---|")
    for d, v in sorted(dom_all.items(), key=lambda kv: -kv[1]["count"]):
        A(
            f"| {d} | {v['count']} | {_pct(v['count'], tot_q)} | {v['score']:.0f} | "
            f"{_pct(v['score'], tot_s)} | {len(v['papers'])} |"
        )
    A("")

    # 领域 × 题型
    A("**领域 × 题型（题数）**")
    A("")
    cross: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in papers:
        for q in r.get("questions", []):
            cross[q["domain"]][q["type"]] += 1
    types = ["选择", "填空", "解答", "判断", "unknown"]
    A("| 领域/主题 | " + " | ".join(types) + " |")
    A("|---" * (len(types) + 1) + "|")
    for d, c in sorted(cross.items(), key=lambda kv: -sum(kv[1].values())):
        A(f"| {d} | " + " | ".join(str(c.get(t, 0)) for t in types) + " |")
    A("")

    # 各领域在单卷中的常见题数（按最常见的 150/120/100 三档）
    A("**各分值制式下，每个领域的“每卷常见题数 / 分值”**")
    A("")
    for s in sorted(spec, key=lambda k: -len(spec[k])):
        rs = [r for r in spec[s] if r.get("questions")]
        if len(rs) < 3:
            continue
        A(f"*{s} 分制，{len(rs)} 份卷子*")
        A("")
        A("| 领域/主题 | 每卷平均题数 | 每卷题数中位数 | 每卷平均分值 | 占卷面分值 |")
        A("|---|---|---|---|---|")
        agg2: dict[str, list] = collections.defaultdict(list)
        for r in rs:
            per = collections.defaultdict(lambda: [0, 0.0])
            for q in r["questions"]:
                per[q["domain"]][0] += 1
                per[q["domain"]][1] += q["score"] or 0
            for d in set(list(per) + [x for x in dom_all]):
                agg2[d].append(per.get(d, [0, 0.0]))
        for d, vals in sorted(agg2.items(), key=lambda kv: -sum(v[0] for v in kv[1])):
            cnts = sorted(v[0] for v in vals)
            med = cnts[len(cnts) // 2]
            sc = sum(v[1] for v in vals) / len(vals)
            A(
                f"| {d} | {sum(cnts)/len(cnts):.1f} | {med} | {sc:.1f} | {_pct(sc, s)} |"
            )
        A("")

    # --- 题位 × 领域（最典型结构）---
    A("### 题位 × 领域（用样本数最多的结构做典型卷）")
    A("")
    if ranked:
        (ts, sig), rs = ranked[0]
        A(f"取样本数最多的结构：**{ts} 分制 / {sig_str(sig)}**（{len(rs)} 份卷子）")
        A("")
        pos: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
        posn: dict[int, int] = collections.Counter()
        for r in rs:
            for q in r.get("questions", []):
                pos[q["no"]][q["domain"]] += 1
                posn[q["no"]] += 1
        A("| 题号 | 覆盖卷数 | 最常出现的领域（次数） |")
        A("|---|---|---|")
        for no in sorted(pos):
            top = "、".join(f"{d}({c})" for d, c in pos[no].most_common(3))
            A(f"| {no} | {posn[no]} | {top} |")
        A("")

    # --- 未能解析的部分 ---
    A("### 解析不出来的部分（如实列出）")
    A("")
    reasons: collections.Counter = collections.Counter()
    for r in records:
        for n in r.get("notes", []):
            reasons[re.sub(r"\d+", "N", n)[:70]] += 1
    A("| 原因（数字已归一化） | 命中卷数 |")
    A("|---|---|")
    for n, c in reasons.most_common(25):
        A(f"| {n} | {c} |")
    A("")
    A("清单：")
    A("")
    for r in records:
        if r["parseStatus"] != "ok":
            A(f"- `{r['fileName']}` → **{r['parseStatus']}**；" + "；".join(r.get("notes", [])[:3] or ["-"])[:220])
    A("")

    A("### 方法与局限")
    A("")
    A("1. **题号连续性**是切题主依据：要求题号从 1 开始连续递增（允许 ≤2 的缺口），")
    A("   以此排除“1.本试卷共6页”这类须知行。若某卷题号被放在图片里，则会切不出题。")
    A("2. **图片 / OLE 公式拿不到**：图形题、部分选择题选项在原文里是图片，")
    A("   抽取后变成空白，知识点归类只能靠残余文字，会偏保守（表现为 unknown 偏多）。")
    A("3. **分值来源**有两条：题目自带的“（N分）”标记（新卷常见）和大题标题里的")
    A("   “每小题N分”，都没有时该题分值记 unknown；逐题分值合计与卷头总分不一致会在")
    A("   `structure.json` 的 `notes` 里标出。")
    A("4. **知识点归类是关键词法**，不是语义判断：跨领域综合题（例如“二次函数与几何综合”）")
    A("   会被判给命中最强的那个领域，可能与命题老师的口径不同。")
    A("5. 年份/地区取自文件名，卷头文字仅作兜底；个别文件名不含地市信息的记为 unknown。")
    A("")

    return "\n".join(L)


# ---------------------------------------------------------------------------
# 9. 建议蓝图
# ---------------------------------------------------------------------------

def build_blueprint(records: list[dict], papers: list[dict]) -> dict:
    """挑样本数最多的分值制式，按其最常见的大题结构生成建议蓝图。

    difficulty 区间是**按题位给出的经验区间（得分率/难度系数）**，不是从本数据集测出来的
    —— 真题里没有考生作答数据，这一点在报告与文件里都写明。
    """
    spec: dict[int, list[dict]] = collections.defaultdict(list)
    for r in papers:
        if r["totalScore"] and r["sections"]:
            spec[r["totalScore"]].append(r)
    best_score = max(spec, key=lambda s: len(spec[s]))
    rs = spec[best_score]

    # 该制式下最常见的“大题题数序列 + 每小题分值”
    sig_counter: dict[tuple, list[dict]] = collections.defaultdict(list)
    for r in rs:
        sig = tuple((g["type"], g["count"]) for g in r["sections"])
        sig_counter[sig].append(r)
    best_sig, best_rs = max(sig_counter.items(), key=lambda kv: len(kv[1]))

    # 每个大题常见的每小题分值
    per_of: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
    for r in best_rs:
        for g in r["sections"]:
            if isinstance(g.get("perScore"), (int, float)):
                per_of[(g["type"], g["count"])][g["perScore"]] += 1

    # 每个题位最常考的领域（用该制式下全部卷子，样本更大）
    pos_domain: dict[tuple[str, int], collections.Counter] = collections.defaultdict(collections.Counter)
    for r in rs:
        occ: collections.Counter = collections.Counter()
        for g in r["sections"]:
            for q in r.get("questions", []):
                if g["qFrom"] <= q["no"] <= g["qTo"] and q["domain"] != "unknown":
                    occ[(g["type"], q["no"] - g["qFrom"] + 1)][q["domain"]] += 1
        for k, v in occ.items():
            for d, c in v.items():
                pos_domain[k][d] += c

    # 题位 -> 难度区间（经验规则：得分率区间，越靠后越难）
    def difficulty_for(t: str, idx: int, total: int) -> list[float]:
        r = idx / max(total, 1)
        if t == "选择":
            if r <= 0.3:
                return [0.85, 0.98]
            if r <= 0.65:
                return [0.7, 0.9]
            if r <= 0.85:
                return [0.55, 0.8]
            return [0.35, 0.6]
        if t == "填空":
            if r <= 0.4:
                return [0.75, 0.92]
            if r <= 0.75:
                return [0.55, 0.8]
            return [0.35, 0.6]
        if t in ("解答", "判断"):
            if r <= 0.2:
                return [0.75, 0.9]
            if r <= 0.5:
                return [0.6, 0.82]
            if r <= 0.75:
                return [0.45, 0.7]
            if r <= 0.9:
                return [0.3, 0.55]
            return [0.15, 0.4]
        return [0.3, 0.8]

    bp: list[dict] = []
    key_i = 0
    for t, count in best_sig:
        per_counter = per_of.get((t, count))
        per = per_counter.most_common(1)[0][0] if per_counter else None
        if per is None:
            # 用该制式同题型的众数分值兜底
            allper = collections.Counter(
                g["perScore"]
                for r in rs
                for g in r["sections"]
                if g["type"] == t and isinstance(g.get("perScore"), (int, float))
            )
            per = allper.most_common(1)[0][0] if allper else 0
        for idx in range(1, count + 1):
            key_i += 1
            doms = pos_domain.get((t, idx))
            if doms:
                know = [d for d, _ in doms.most_common(2)]
                support = sum(doms.values())
            else:
                know = ["数与式"]
                support = 0
            bp.append(
                {
                    "key": f"S{key_i}",
                    "knowledge": know,
                    "cognitive": (
                        "了解" if idx <= max(1, count // 4)
                        else "理解" if idx <= max(2, count // 2)
                        else "掌握" if idx <= max(3, count * 3 // 4)
                        else "运用"
                    ),
                    "type": t,
                    "count": 1,
                    "difficulty": difficulty_for(t, idx, count),
                    "score": per,
                    "_evidence": {
                        "basis": f"{best_score}分制下该题位最常归入的课标领域/主题",
                        "supportPapers": support,
                        "positionDomainCounts": dict(doms.most_common(5)) if doms else {},
                    },
                }
            )

    # 时长：该制式下卷头时长的众数
    mins_c = collections.Counter(r["minutes"] for r in rs if r["minutes"])
    minutes = mins_c.most_common(1)[0][0] if mins_c else None

    def has_domain(d: str) -> bool:
        return any(d in b["knowledge"] for b in bp)

    forbid = [d for d in ["综合与实践"] if not has_domain(d)]

    return {
        "paper": {
            "title": f"中考数学模拟卷 · {best_score}分制（依据 {len(best_rs)}/{len(rs)} 份真题的最常见结构）",
            "totalScore": best_score,
            "minutes": minutes,
            "className": "初三(1)班",
        },
        "blueprint": bp,
        "constraints": {"forbidKnowledge": forbid},
        "meta": {
            "generatedBy": "scripts/zhenti_stats.py",
            "basis": {
                "paperCount": len(papers),
                "sameScorePapers": len(rs),
                "structureSupport": len(best_rs),
                "structure": " + ".join(f"{t}{c}题" for t, c in best_sig),
                "structureSamples": len(best_rs),
            },
            "difficultyNote": (
                "difficulty 是按题位的经验区间（得分率），不是本数据集的实测难度："
                "真题里没有考生得分数据。区间随题位后移而下降，规则写在 "
                "scripts/zhenti_stats.py 的 difficulty_for()。"
            ),
            "evidenceNote": "每条 blueprint 的 _evidence 保留了该题位在真题里最常出现的领域与支持卷数。",
        },
    }


# ---------------------------------------------------------------------------
# 10. CLI
# ---------------------------------------------------------------------------

def load_records(struct_file: Path) -> tuple[list[dict], dict]:
    data = json.loads(struct_file.read_text(encoding="utf-8"))
    return data["papers"], data.get("meta", {})


def paper_key(file_name: str) -> str:
    """把“xxx（答案）.docx”和“xxx.docx”归到同一个 key，用于去重。"""
    s = Path(file_name).stem
    s = re.sub(r"[（(]\s*(答案|含答案|参考答案|解析|详解|教师版|学生版)\s*[)）]", "", s)
    s = re.sub(r"(答案|含答案|参考答案|解析|详解)$", "", s)
    return re.sub(r"[\s_（）()]", "", s)


def dedupe_answer_versions(records: list[dict]) -> list[dict]:
    """同一份卷子既有试卷版又有答案版时，只保留解析质量最好的那一份。

    被丢弃的记录不会被删掉，而是打上 supersededBy 字段，仍可在 structure.json 里查到。
    """
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for r in records:
        groups[paper_key(r["fileName"])].append(r)

    def rank(r: dict) -> tuple:
        # 优先：非答案版 > 解析状态（ok > partial > no-questions）
        status_rank = {"ok": 0, "partial": 1, "error": 2, "no-questions": 3, "answer-only": 4}
        return (1 if r["isAnswerVersion"] else 0, status_rank.get(r["parseStatus"], 9))

    for key, rs in groups.items():
        if len(rs) == 1:
            rs[0]["paperKey"] = key
            continue
        rs_sorted = sorted(rs, key=rank)
        keep = rs_sorted[0]
        for r in rs_sorted:
            r["paperKey"] = key
            r["duplicateGroupSize"] = len(rs)
        for r in rs_sorted[1:]:
            r["supersededBy"] = keep["fileName"]
            r["usedInStats"] = False
        keep["usedInStats"] = True
    return records


def cmd_parse(args) -> list[dict]:
    src = Path(args.src)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    txt_dir = Path(args.txt)
    idx_file = txt_dir / "_index.json"
    index = json.loads(idx_file.read_text(encoding="utf-8")) if idx_file.exists() else {}
    # txt 名 -> 源文件
    by_source: dict[str, str] = {}
    for name, v in index.items():
        by_source[v["source"]] = str(txt_dir / name)

    files = sorted(glob.glob(str(src / "**" / "*.docx"), recursive=True))
    if args.limit:
        files = files[: args.limit]
    records = []
    for i, f in enumerate(files, 1):
        try:
            rec = parse_paper(f, by_source.get(f))
        except Exception as e:  # 单份失败不影响全局
            rec = {
                "source": f,
                "fileName": Path(f).name,
                "year": None,
                "region": "unknown",
                "province": "unknown",
                "totalScore": None,
                "minutes": None,
                "questionCount": 0,
                "isAnswerVersion": bool(ANSWER_HINT.search(Path(f).stem)),
                "parseStatus": "error",
                "notes": [f"解析异常：{type(e).__name__}: {e}"],
                "sections": [],
                "questions": [],
                "unknown": ["整卷结构（异常）"],
            }
        records.append(rec)
        if args.verbose or i % 40 == 0:
            print(
                f"[parse] {i}/{len(files)} {rec['parseStatus']:12s} "
                f"{rec.get('totalScore')}分 {rec.get('questionCount')}题 {rec['fileName'][:40]}"
            )
    records = dedupe_answer_versions(records)
    payload = {
        "meta": {
            "generatedBy": "scripts/zhenti_stats.py",
            "source": str(src),
            "fileCount": len(records),
            "uniquePaperCount": len({r["paperKey"] for r in records}),
            "generatedAtNote": "由脚本离线生成，未联网",
        },
        "papers": records,
    }
    (out_dir / "structure.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"[parse] 写入 {out_dir/'structure.json'}（{len(records)} 份）")
    return records


def cmd_report(args) -> None:
    out_dir = Path(args.out_dir)
    records, meta = load_records(out_dir / "structure.json")
    papers = [r for r in records if r["parseStatus"] != "answer-only"]
    md = build_report(records, meta)
    (out_dir / "report.md").write_text(md, encoding="utf-8")
    bp = build_blueprint(records, papers)
    (out_dir / "suggested-blueprint.json").write_text(
        json.dumps(bp, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[report] 写入 {out_dir/'report.md'} 与 {out_dir/'suggested-blueprint.json'}")
    print(f"[report] 建议蓝图依据：{bp['meta']['basis']}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="中考真题 docx 批量抽取 + 结构/知识点统计 + 建议蓝图",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "cmd",
        nargs="?",
        default="all",
        choices=["extract", "parse", "report", "all"],
        help="extract=抽文本；parse=解析结构；report=出报告+蓝图；all=全流程（默认）",
    )
    root = Path(__file__).resolve().parent.parent
    ap.add_argument(
        "--src",
        default=str(root / "data/zhenti/近三年全国各省、直辖市数学中考试题"),
        help="真题根目录",
    )
    ap.add_argument("--txt", default=str(root / "data/zhenti/txt"), help="txt 输出目录")
    ap.add_argument("--out-dir", default=str(root / "data/zhenti"), help="产物目录")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 份（调试）")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    if args.cmd in ("extract", "all"):
        cmd_extract(args)
    if args.cmd in ("parse", "all"):
        cmd_parse(args)
    if args.cmd in ("report", "all"):
        cmd_report(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
