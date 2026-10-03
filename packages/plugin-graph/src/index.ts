import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  FusionView,
  GraphApi,
  KnowledgeFusion,
  KnowledgeGraph,
  KnowledgeMatch,
  KnowledgeNeighbors,
} from '@examharness/core'
import {
  closureOf,
  fusionViewOf,
  missingFor,
  neighborsOf,
  prerequisitesOf,
  searchKnowledge,
} from '@examharness/core'
import z from 'schemastery'

/**
 * 知识点图谱。它不是内部数据结构，而是产品的一张脸：
 * - 引导：命题 agent 设计时查合法组合与前置闭包；
 * - 闸门：越界检测（用了未学的知识 → 拒绝）。
 *
 * 图谱本身是**产物**：`scripts/graph-build.mjs` 从课标与 183 份真题结构统计里长出来
 * （`seed/knowledge.json` + `seed/knowledge-fusion.json`），不是手写的。
 */

export const name = 'graph'

export const Config = z.object({
  /** 主图谱文件（相对 ctx.baseUrl 或 cwd） */
  path: z.string().default('seed/knowledge.json'),
  /** 追加的图谱文件：课标整理的清单、教材目录整理件……后读到的会并入 */
  paths: z.array(z.string()).default([]),
  /**
   * **这个班学到哪儿了**（前沿，不是全集）。
   *
   * 写"二次函数图象"就够了——它的前置（平面直角坐标系、配方、一次函数…）由框架自动补齐，
   * 不然一个刚学到九上第 22 章的班会被判"有理数运算超纲"。
   * 不在闭包里的知识点仍然是未学，超纲闸门照旧拦得住。
   */
  learned: z.array(z.string()).default([]),
  /**
   * 多知识点融合证据（由 `scripts/graph-build.mjs` 生成）。
   * 缺失时 `fusion()` 返回空统计——图谱要能单独用，不该被一个可选文件拖死。
   */
  fusionPath: z.string().default('seed/knowledge-fusion.json'),
})

export interface GraphConfig {
  path: string
  paths: string[]
  learned: string[]
  fusionPath: string
}

export class GraphService extends Service implements GraphApi {
  static Config = Config

  private readonly data: KnowledgeGraph
  private readonly learned: ReadonlySet<string>
  private readonly fusionData: KnowledgeFusion | undefined

  constructor(ctx: Context, config: GraphConfig) {
    super(ctx, 'graph')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    // 多个文件合并：同名节点把前置关系并起来（不同来源对同一知识点的说法可能互补）；
    // 其余字段（年级/章节/依据…）以**先读到的**为准——主文件是权威。
    const nodes: Record<string, KnowledgeNodeRecord> = {}
    for (const relative of [config.path, ...config.paths]) {
      try {
        const part = JSON.parse(readFileSync(resolve(base, relative), 'utf8')) as KnowledgeGraph
        for (const [key, node] of Object.entries(part.nodes)) {
          const merged = new Set([...(nodes[key]?.prerequisites ?? []), ...(node.prerequisites ?? [])])
          nodes[key] = { ...node, ...nodes[key], prerequisites: [...merged] }
        }
      } catch {
        // 追加文件缺失/格式错不该拖垮启动；主文件的问题会在校验阶段暴露
      }
    }
    this.data = { nodes }
    // 配置里写的是**前沿**：补上前置闭包才是"已学"。语义写在这里，别让每个调用方各补一次。
    this.learned = new Set(closureOf(this.data, config.learned))
    this.fusionData = this.loadFusion(base, config.fusionPath)
  }

  private loadFusion(base: string, relative: string): KnowledgeFusion | undefined {
    try {
      return JSON.parse(readFileSync(resolve(base, relative), 'utf8')) as KnowledgeFusion
    } catch {
      // 融合证据是可选资产：没有它，图谱的引导与闸门照常工作
      return undefined
    }
  }

  /** 直接前置 */
  prerequisites(keys: readonly string[]): string[] {
    return prerequisitesOf(this.data, keys)
  }

  /** 前置闭包（含自身） */
  closure(keys: readonly string[]): string[] {
    return closureOf(this.data, keys)
  }

  /** 越界知识点：不在已学集合里的，空数组表示合法 */
  missing(keys: readonly string[]): string[] {
    return missingFor(this.data, keys, this.learned)
  }

  /** 图谱上的全部知识点 */
  nodes(): readonly string[] {
    return Object.keys(this.data.nodes)
  }

  /** 已学集合（只读视图） */
  learnedKeys(): readonly string[] {
    return [...this.learned]
  }

  /** 按名字/别名模糊找知识点（agent 不必一字不差） */
  search(text: string, limit = 10): readonly KnowledgeMatch[] {
    return searchKnowledge(this.data, text, limit)
  }

  /** 前置与后继 */
  neighbors(key: string): KnowledgeNeighbors | undefined {
    return neighborsOf(this.data, key)
  }

  /** 多知识点融合：常一起考的知识点与真题统计 */
  fusion(key: string): FusionView {
    return fusionViewOf(this.fusionData, key)
  }
}

/** 合并时用的形状：图谱文件里除 prerequisites 之外还有一批构建脚本写入的字段 */
type KnowledgeNodeRecord = KnowledgeGraph['nodes'][string]

export function apply(ctx: Context, config: GraphConfig): void {
  ctx.plugin(GraphService, config)
}
