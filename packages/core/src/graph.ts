/**
 * 知识点图谱的纯函数部分。
 *
 * 图谱在本项目里有**两种身份**，都靠这几个函数：
 * - 引导：agent 设计题目时查前置闭包，挑合法的知识点组合；
 * - 闸门：越界检测（用未学的知识 → 拒绝）。
 */

export interface KnowledgeNode {
  /** 前置知识点：必须先学过这些，才能学本节点 */
  prerequisites?: readonly string[]
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
