import type { BlueprintRow, Item, Verdict } from './types.js'

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

export type SubmitResult =
  | { ok: true; id: string; verdict: Verdict }
  | { ok: false; verdict: Verdict }

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

declare module '@deepseek-ai/cordis' {
  interface Context {
    bank: BankApi
    graph: GraphApi
    construct: ConstructApi
  }
}
