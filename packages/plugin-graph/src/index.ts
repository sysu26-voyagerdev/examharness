import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  FusionView,
  GraphApi,
  KnowledgeFusion,
  KnowledgeGraph,
  KnowledgeGraphView,
  KnowledgeMatch,
  KnowledgeNeighbors,
  KnowledgeNodeView,
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
  private readonly generatedBy: Record<string, unknown> | undefined

  constructor(ctx: Context, config: GraphConfig) {
    super(ctx, 'graph')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    // 多个文件合并：同名节点把前置关系并起来（不同来源对同一知识点的说法可能互补）；
    // 其余字段（年级/章节/依据…）以**先读到的**为准——主文件是权威。
    const nodes: Record<string, KnowledgeNodeRecord> = {}
    let meta: Record<string, unknown> | undefined
    for (const relative of [config.path, ...config.paths]) {
      try {
        const part = JSON.parse(readFileSync(resolve(base, relative), 'utf8')) as KnowledgeGraph & {
          generatedBy?: Record<string, unknown>
        }
        // 生成信息只在主文件上取一次：它是"这张图怎么来的"，追加文件不该覆盖它
        if (meta === undefined) meta = part.generatedBy
        for (const [key, node] of Object.entries(part.nodes)) {
          const merged = new Set([...(nodes[key]?.prerequisites ?? []), ...(node.prerequisites ?? [])])
          nodes[key] = { ...node, ...nodes[key], prerequisites: [...merged] }
        }
      } catch {
        // 追加文件缺失/格式错不该拖垮启动；主文件的问题会在校验阶段暴露
      }
    }
    this.data = { nodes }
    this.generatedBy = meta
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

  /**
   * 整张图的一次性快照（界面用）。
   *
   * 为什么放在服务里而不是让界面自己拼：反向连线、层数、章节内序号这三样都要通盘算一遍，
   * 界面逐个节点去问会把同一件事算 N 遍（113 个节点就是 113 遍），而且算法散到两个地方。
   * 这里算一次、按界面要读的顺序排好，界面只管画。
   */
  overview(): KnowledgeGraphView {
    const keys = Object.keys(this.data.nodes)
    const successors = new Map<string, string[]>()
    const dangling: { key: string; missing: string }[] = []
    let edges = 0
    for (const [key, node] of Object.entries(this.data.nodes)) {
      for (const prerequisite of node.prerequisites ?? []) {
        edges += 1
        if (this.data.nodes[prerequisite] === undefined) dangling.push({ key, missing: prerequisite })
        const list = successors.get(prerequisite) ?? []
        list.push(key)
        successors.set(prerequisite, list)
      }
    }

    const chapterIndex = new Map<string, number>()
    {
      const byChapter = new Map<string, string[]>()
      for (const key of keys) {
        const record = this.data.nodes[key] ?? {}
        const chapter = `${textOf(record['grade'])}\u0000${textOf(record['chapter'])}`
        const list = byChapter.get(chapter) ?? []
        list.push(key)
        byChapter.set(chapter, list)
      }
      for (const list of byChapter.values()) {
        list.toSorted((a, b) => a.localeCompare(b, 'zh-Hans-CN')).forEach((key, index) => chapterIndex.set(key, index + 1))
      }
    }

    const nodes: KnowledgeNodeView[] = keys.toSorted((a, b) => a.localeCompare(b, 'zh-Hans-CN')).map((key) => {
      const record = this.data.nodes[key] ?? {}
      const view: KnowledgeNodeView = {
        key,
        prerequisites: [...(record.prerequisites ?? [])],
        successors: (successors.get(key) ?? []).toSorted((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
        depth: Math.max(0, closureOf(this.data, [key]).length - 1),
        chapterIndex: chapterIndex.get(key) ?? 0,
        learned: this.learned.has(key),
      }
      // 可选字段逐个赋值（不用展开）：少了就不带，界面按"缺了就不画"处理。
      // 展开写法在这里既慢又难看懂哪个字段来自哪儿。
      const optional: [keyof KnowledgeNodeView, unknown][] = [
        ['grade', record['grade']],
        ['chapter', record['chapter']],
        ['domain', record['domain']],
        ['kind', record['kind']],
        ['evidenceLevel', this.evidenceOf(record)['level']],
        // 常见问法是**人工归纳**的，来自融合统计那份产物（不是现算的）
        ['ask', this.fusionData?.nodes[key]?.ask],
      ]
      const aliases = record['aliases']
      if (Array.isArray(aliases)) view.aliases = aliases.map(String)
      const sources = record['sources']
      if (Array.isArray(sources)) view.sources = sources.map(String)
      const basis = this.basisOf(record)
      if (basis !== undefined) view.prerequisiteBasis = basis
      const zhenti = this.zhentiOf(record)
      if (zhenti !== undefined) view.zhenti = zhenti
      for (const [field, raw] of optional) {
        if (typeof raw === 'string' && raw !== '') Object.assign(view, { [field]: raw })
      }
      return view
    })

    return {
      total: nodes.length,
      edges,
      learned: [...this.learned],
      nodes,
      dangling,
      ...(this.generatedBy === undefined ? {} : { generatedBy: this.generatedBy }),
    }
  }

  /** `evidence` 是个对象（层级/课标条目/真题统计都在这儿），不是就直接当空 */
  private evidenceOf(record: Record<string, unknown>): Record<string, unknown> {
    const evidence = record['evidence']
    return typeof evidence === 'object' && evidence !== null ? (evidence as Record<string, unknown>) : {}
  }

  /**
   * 前置依据：值必须是「知识点名 → 一句话依据」的字典。
   * 这里**逐条挑字符串**而不是整体塞进去：产物里混进一个非字符串，整个卡片就画不出来，
   * 而它只是图谱的一个注释字段——不该有这种权力。
   */
  private basisOf(record: Record<string, unknown>): Record<string, string> | undefined {
    const basis = record['prerequisiteBasis']
    if (typeof basis !== 'object' || basis === null) return undefined
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(basis)) {
      if (typeof value === 'string' && value !== '') out[key] = value
    }
    return Object.keys(out).length === 0 ? undefined : out
  }

  /** 真题统计藏在 `evidence.zhenti` 里（构建脚本写的），没有就返回 undefined */
  private zhentiOf(record: Record<string, unknown>): { papers: number; questions: number } | undefined {
    const zhenti = this.evidenceOf(record)['zhenti']
    if (typeof zhenti !== 'object' || zhenti === null) return undefined
    const papers = (zhenti as Record<string, unknown>)['papers']
    if (typeof papers !== 'number') return undefined
    const questions = (zhenti as Record<string, unknown>)['questions']
    return { papers, questions: typeof questions === 'number' ? questions : 0 }
  }
}

/** 取字符串，不是字符串就当空——图谱允许缺字段 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 合并时用的形状：图谱文件里除 prerequisites 之外还有一批构建脚本写入的字段 */
type KnowledgeNodeRecord = KnowledgeGraph['nodes'][string]

export function apply(ctx: Context, config: GraphConfig): void {
  ctx.plugin(GraphService, config)
}
