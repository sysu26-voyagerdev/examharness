import type { Blueprint, BlueprintRow, Item, SlotSpec, Verdict } from './types.js'

// 必须真实导入被增强的模块：TS 只在模块已进入程序时才认这条声明合并
import '@deepseek-ai/cordis'

/**
 * 能力 seam：**接口定义放这里，实现放各插件包**。
 *
 * 这样做的原因很实际：闸门 A 只声明 `inject: ['bank']`，它不该（也不需要）
 * 依赖题库包的实现；但 TS 要知道 `ctx.bank` 长什么样。接口集中在 core，
 * 消费者只依赖 core，实现者各自实现 —— 与 DSH 的 capability seam 同构。
 */

export interface SearchQuery {
  knowledge?: readonly string[]
  difficulty?: readonly [number, number]
  limit?: number
}

/** 失败的判定（只可能是失败那一支） */
export type FailureVerdict = Extract<Verdict, { pass: false }>

/** 提交结果：拒绝时**必然**携带失败判定，类型层面就禁止"ok:false 但没有原因" */
export type SubmitResult =
  | { ok: true; id: string; verdict: Verdict }
  | { ok: false; verdict: FailureVerdict }

/** 题库：唯一写入口 submit()，它必然先跑闸门链 */
export interface BankApi {
  bySlot(key: string): readonly Item[]
  search(query?: SearchQuery): readonly Item[]
  fewShot(knowledge: readonly string[], count: number): readonly Item[]
  /** 结构指纹：构造器 + 参数（确定性） */
  fingerprint(item: Item): string
  /** 相似度：参数字面量 + 知识点的 Jaccard */
  similarity(a: Item, b: Item): number
  submit(item: Item): Promise<SubmitResult>
  get(id: string): Item | undefined
  all(): readonly Item[]
}

/** 知识点图谱：既是 agent 的设计工具（引导），也是闸门（越界检测） */
export interface GraphApi {
  prerequisites(keys: readonly string[]): string[]
  closure(keys: readonly string[]): string[]
  /** 越界知识点：不在已学集合里的（空数组 = 合法） */
  missing(keys: readonly string[]): string[]
  nodes(): readonly string[]
  learnedKeys(): readonly string[]
}

/** 构造器：题位 + 种子 → 一道题（同种子必须复现同一道题） */
export type Constructor = (slot: BlueprintRow, seed: number) => Item

/** 构造器注册表 */
export interface ConstructApi {
  register(kind: string, factory: Constructor): void
  kinds(): readonly string[]
  generate(slot: BlueprintRow, seed: number): Item
}

/** 卷面题位：蓝图题位 + 落在它上面的题 */
export interface PaperSlot {
  /** 卷面题位标识，例如 'S1-1'（蓝图行 key + 序号） */
  key: string
  spec: SlotSpec
  itemId: string
}

/** 缺口：没凑齐的题位与原因。**不许静默少给题** */
export interface PaperGap {
  slot: string
  missing: number
  reason: string
}

/** 一份卷子 */
export interface Paper {
  blueprint: Blueprint
  slots: readonly PaperSlot[]
  gaps: readonly PaperGap[]
  /** 由易到难排列的 itemId */
  order: readonly string[]
  totalScore: number
  /** 蓝图满分 − 实得满分（负值=超出） */
  scoreGap: number
  /** 组卷过程中提交了几次（可观测：闸门拦了几次） */
  attempts: number
}

export interface AssembleOptions {
  /** 每个卷面题位的候选种子；用尽即报缺口 */
  seeds?: Readonly<Record<string, readonly number[]>>
  /** 单题位最大尝试次数 */
  maxAttempts?: number
}

/** 组卷：把蓝图变成一份卷子。**是约束求解，不是"生成 N 道题"** */
export interface PaperApi {
  assemble(blueprint: Blueprint, options?: AssembleOptions): Promise<Paper>
  current(): Paper | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    bank: BankApi
    graph: GraphApi
    construct: ConstructApi
    paper: PaperApi
  }
}
