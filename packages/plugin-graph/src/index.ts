import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { GraphApi, KnowledgeGraph } from '@examharness/core'
import { closureOf, missingFor, prerequisitesOf } from '@examharness/core'
import z from 'schemastery'

/**
 * 知识点图谱。它不是内部数据结构，而是产品的一张脸：
 * - 引导：命题 agent 设计时查合法组合与前置闭包；
 * - 闸门：越界检测（用了未学的知识 → 拒绝）。
 */

export const name = 'graph'

export const Config = z.object({
  /** 图谱文件（相对 ctx.baseUrl 或 cwd） */
  path: z.string().default('seed/knowledge.json'),
  /** 已学知识点集合；不在其中的前置知识 = 超纲 */
  learned: z.array(z.string()).default([]),
})

export interface GraphConfig {
  path: string
  learned: string[]
}

export class GraphService extends Service implements GraphApi {
  static Config = Config

  private readonly data: KnowledgeGraph
  private readonly learned: ReadonlySet<string>

  constructor(ctx: Context, config: GraphConfig) {
    super(ctx, 'graph')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.data = JSON.parse(readFileSync(resolve(base, config.path), 'utf8')) as KnowledgeGraph
    this.learned = new Set(config.learned)
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
}

export function apply(ctx: Context, config: GraphConfig): void {
  ctx.plugin(GraphService, config)
}
