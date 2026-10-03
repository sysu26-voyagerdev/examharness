/**
 * 知识点图谱的纯函数部分。
 *
 * 图谱在本项目里有**两种身份**，都靠这几个函数：
 * - 引导：agent 设计题目时查前置闭包，挑合法的知识点组合；
 * - 闸门：越界检测（用未学的知识 → 拒绝）。
 *
 * 另外还有两件"痛过的事"长出来的能力：
 * - `searchKnowledge`：agent 以前必须**一字不差**写对知识点名，写错就白跑一轮；
 * - `fusionViewOf`：多知识点融合的证据（常一起考的知识点、支持卷数）——
 *   没有它，agent 只能凭感觉把两个知识点凑在一起。
 */

export interface KnowledgeNode {
  /** 前置知识点：必须先学过这些，才能学本节点 */
  prerequisites?: readonly string[]
  /** 同义词/别名：`searchKnowledge` 靠它兜底 */
  aliases?: readonly string[]
  /**
   * 其余字段（grade / chapter / domain / kind / sources / prerequisiteBasis / evidence / parts…）
   * 由 `scripts/graph-build.mjs` 从课标与真题统计写入。图谱的算法部分不依赖它们，
   * 但工具与报告要读，所以这里留一个开放形状，而不是把它们都塞进类型里。
   */
  [key: string]: unknown
}

export interface KnowledgeGraph {
  readonly nodes: Readonly<Record<string, KnowledgeNode>>
}

/** 直接前置（去重、保序） */
export function prerequisitesOf(graph: KnowledgeGraph, knowledge: readonly string[]): string[] {
  const out: string[] = []
  for (const key of knowledge) {
    for (const prerequisite of graph.nodes[key]?.prerequisites ?? []) {
      if (!out.includes(prerequisite)) out.push(prerequisite)
    }
  }
  return out
}

/** 前置闭包：一路向上取到根，含传入的知识点本身 */
export function closureOf(graph: KnowledgeGraph, knowledge: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...knowledge]
  while (queue.length > 0) {
    const key = queue.shift()
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    for (const prerequisite of graph.nodes[key]?.prerequisites ?? []) queue.push(prerequisite)
  }
  return [...seen]
}

/**
 * 越界检测：返回**不在已学集合里**的知识点。
 * 返回空数组表示这组知识点的前置闭包完全合法。
 */
export function missingFor(
  graph: KnowledgeGraph,
  knowledge: readonly string[],
  learned: ReadonlySet<string>,
): string[] {
  return closureOf(graph, knowledge).filter((key) => !learned.has(key))
}

// ---------------------------------------------------------------------------
// 找知识点：谁都不该被迫一字不差地背下 27（现在是 113）个名字
// ---------------------------------------------------------------------------

/** 一次命中：`matchedBy` 说清是"名字相等""别名相等"还是"包含" */
export interface KnowledgeMatch {
  key: string
  matchedBy: 'name' | 'alias' | 'contains'
  /** 命中的那个写法（名字或别名，用于告诉 agent "你写的是这个"） */
  literal: string
  score: number
}

/**
 * 按名字/别名模糊找知识点。
 *
 * 排序：名字相等 > 别名相等 > 名字包含 > 别名包含 > 名字被查询包含；
 * 同分时**短名字优先**（写"二次函数"时，"二次函数图象"比"二次函数系数与图象"更该排前面），
 * 再同分按名字排（保证结果稳定，agent 两次调用看到同一个顺序）。
 */
export function searchKnowledge(
  graph: KnowledgeGraph,
  text: string,
  limit = 10,
): KnowledgeMatch[] {
  const query = text.trim().toLowerCase()
  if (query === '') return []
  const best = new Map<string, KnowledgeMatch>()
  for (const [key, node] of Object.entries(graph.nodes)) {
    const literals: readonly (readonly [string, 'name' | 'alias'])[] = [
      [key, 'name'],
      ...(node.aliases ?? []).map((alias) => [alias, 'alias'] as const),
    ]
    for (const [literal, kind] of literals) {
      const low = literal.toLowerCase()
      let score = 0
      if (low === query) score = kind === 'name' ? 100 : 92
      else if (low.includes(query)) score = (kind === 'name' ? 80 : 70) - Math.min(20, low.length - query.length)
      else if (query.includes(low)) score = kind === 'name' ? 60 : 50
      if (score <= 0) continue
      const previous = best.get(key)
      if (previous !== undefined && previous.score >= score) continue
      best.set(key, { key, matchedBy: score >= 90 ? kind : 'contains', literal, score })
    }
  }
  return [...best.values()]
    .toSorted((a, b) => (b.score - a.score) || (a.key.length - b.key.length) || (a.key < b.key ? -1 : 1))
    .slice(0, Math.max(1, limit))
}

/** 一个知识点在图谱上的邻居：前置（学过它才能学本节点）与后继（学完本节点才轮得到） */
export interface KnowledgeNeighbors {
  key: string
  prerequisites: readonly string[]
  successors: readonly string[]
}

export function neighborsOf(graph: KnowledgeGraph, key: string): KnowledgeNeighbors | undefined {
  const node = graph.nodes[key]
  if (node === undefined) return undefined
  const successors = Object.entries(graph.nodes)
    .filter(([, other]) => (other.prerequisites ?? []).includes(key))
    .map(([name]) => name)
    .toSorted()
  return { key, prerequisites: [...(node.prerequisites ?? [])], successors }
}

// ---------------------------------------------------------------------------
// 多知识点融合：常一起考的知识点与支持卷数（证据来自真题统计，见 docs/知识图谱构建报告.md）
// ---------------------------------------------------------------------------

export interface FusionScoreStat {
  common: readonly number[]
  median: number | null
  min: number | null
  max: number | null
  /** 分值缺失的题数（有些卷子只在题干里给分，抽不到）——如实记着 */
  unknown: number
}

export interface FusionSubQuestionStat {
  common: readonly number[]
  /** 分问数 → 题数 */
  dist: Readonly<Record<string, number>>
  /** 能从真题原文里数出分问数的比例（公式丢过，所以不是 1） */
  coverage: number
}

export interface FusionCooccurrence {
  nodes: readonly string[]
  papers: number
  questions: number
}

/** 一个知识点在真题里的样子 */
export interface FusionNodeStat {
  questions: number
  /** 支持卷数：有多少份真题考过它 */
  supportPapers: number
  typeDist: Readonly<Record<string, number>>
  score: FusionScoreStat
  subQuestions: FusionSubQuestionStat
  /** 统计用的匹配词（想知道统计是怎么来的，看它） */
  matchKeywords: readonly string[]
  /** 常见问法：人工归纳的一句话，不是统计出来的 */
  ask: string
  role?: string
  note?: string
  with?: readonly { with: string; papers: number; questions: number }[]
  with3?: readonly { with: readonly string[]; papers: number; questions: number }[]
}

export interface KnowledgeFusion {
  method?: Readonly<Record<string, unknown>>
  nodes: Readonly<Record<string, FusionNodeStat>>
  pairs?: readonly FusionCooccurrence[]
  triples?: readonly FusionCooccurrence[]
}

/** `fusion(key)` 的返回：这个知识点的真题样子 + 常和谁一起考 */
export interface FusionView {
  key: string
  stat: FusionNodeStat | undefined
  /** 常一起考的知识点（按支持卷数排序，最多 8 条） */
  together: readonly { with: string; papers: number; questions: number }[]
  /** 三个知识点一起出现过的组合 */
  triples: readonly FusionCooccurrence[]
}

export function fusionViewOf(
  fusion: KnowledgeFusion | undefined,
  key: string,
  limit = 8,
): FusionView {
  const stat = fusion?.nodes[key]
  const together = stat?.with ?? []
  const triples = (fusion?.triples ?? [])
    .filter((triple) => triple.nodes.includes(key))
    .slice(0, 3)
  return { key, stat, together: together.slice(0, limit), triples }
}
