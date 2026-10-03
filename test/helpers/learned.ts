import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closureOf, type KnowledgeGraph } from '@examharness/core'

/**
 * 测试里的「已学集合」按**前置闭包**补齐。
 *
 * 为什么需要它：图谱现在是从课标里长出来的 DAG，前置一层套一层——
 * 「学过二次函数图象」必然意味着「学过平面直角坐标系」。
 * 各测试文件里写的是"这一卷讲到哪儿"的**前沿**（比如九上第 22 章），
 * 而闸门要的是闭包，所以在这里补齐一次，而不是把几十个基础知识点抄进十个文件。
 *
 * 注意：这里**只补前沿的前置**，不补别的——不在前沿里的知识点（例如「动点问题」）
 * 依然是未学，超纲闸门照旧拦得住（tests/knowledge-graph.test.ts 有回归项）。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

export function learnedClosure(frontier: readonly string[]): string[] {
  const graph = JSON.parse(
    readFileSync(resolve(ROOT, 'seed/knowledge.json'), 'utf8'),
  ) as KnowledgeGraph
  return closureOf(graph, frontier)
}
