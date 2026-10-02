import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  AssembleOptions,
  Blueprint,
  Item,
  Paper,
  PaperApi,
  PaperGap,
  PaperSlot,
  SlotSpec,
} from '@examharness/core'
import { fnv1a } from '@examharness/core'
import z from 'schemastery'

/**
 * 组卷。
 *
 * 原理（docs/agent/01）：「试卷是测量仪器」→ **组卷是约束求解，不是"生成 N 道题"**。
 * 所以这里做四件事，缺一不可：
 *   1. 按蓝图配额逐题位去凑（题位 = 局部重做的最小单位）；
 *   2. 凑不到就**报缺口**，绝不静默少给题；
 *   3. 结构性违规（超纲、构造器不覆盖）不再重试——那是蓝图的问题，不是运气问题；
 *   4. 由易到难排序、分值配平，并把尝试次数记下来（闸门拦了几次是可见的）。
 */

export const name = 'paper'
export const inject = ['bank', 'construct']

export const Config = z.object({
  /** 单个卷面题位的最大尝试次数 */
  maxAttempts: z.number().default(6),
})

export interface PaperConfig {
  maxAttempts: number
}

export class PaperService extends Service implements PaperApi {
  static Config = Config

  private readonly config: PaperConfig
  private latest: Paper | undefined

  constructor(ctx: Context, config: PaperConfig) {
    super(ctx, 'paper')
    this.config = config
  }

  current(): Paper | undefined {
    return this.latest
  }

  async assemble(blueprint: Blueprint, options: AssembleOptions = {}): Promise<Paper> {
    const maxAttempts = options.maxAttempts ?? this.config.maxAttempts
    const slots: PaperSlot[] = []
    const gaps: PaperGap[] = []
    let attempts = 0

    for (const row of blueprint.blueprint) {
      for (let index = 0; index < row.count; index += 1) {
        const key = `${row.key}-${index + 1}`
        const spec: SlotSpec = {
          key,
          knowledge: row.knowledge,
          cognitive: row.cognitive,
          type: row.type,
          difficulty: row.difficulty,
          score: row.score,
        }
        const seeds = options.seeds?.[key]
        let placed: PaperSlot | undefined
        let reason = '候选种子用尽，仍未凑到通过闸门的题'

        // **一个题位可以有几个题型**：入门小题过不了分量闸门时，接着试下一个题型
        // （题位是 9 分解答题，就该由多问的题型来出）。没有候选就如实报缺口。
        const slot = { ...row, key, count: 1 }
        const byKind = this.ctx.construct.generateWith?.bind(this.ctx.construct)
        const kinds = this.ctx.construct.candidates?.(slot)
        const usable = kinds === undefined || kinds.length === 0 ? [undefined] : kinds

        for (const kind of usable) {
          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            attempts += 1
            const seed = seeds?.[attempt] ?? Number.parseInt(fnv1a(`${key}|${attempt}`), 16)
            let item: Item
            try {
              item =
                kind === undefined || byKind === undefined
                  ? this.ctx.construct.generate(slot, seed)
                  : byKind(slot, seed, kind)
            } catch (error) {
              reason = `构造器不覆盖该题位：${error instanceof Error ? error.message : String(error)}`
              break
            }
            // 已入库的同 (题位, 种子) 题目直接复用：导出只读归档，不重跑（R3）
            if (this.ctx.bank.get(item.id) !== undefined) {
              placed = { key, spec, itemId: item.id }
              break
            }
            // 重试必须串行：下一次用什么种子，取决于上一次被哪道闸门拦下
            // oxlint-disable-next-line no-await-in-loop
            const result = await this.ctx.bank.submit(item)
            if (result.ok) {
              placed = { key, spec, itemId: result.id }
              break
            }
            reason = kind === undefined ? `${result.verdict.gate}：${result.verdict.reason}` : `${kind} 被 ${result.verdict.gate} 拦下：${result.verdict.reason}`
            // fixable=false 是结构性违规（超纲等）：换种子没用，必须改蓝图
            if (!result.verdict.fixable) break
          }
          if (placed !== undefined) break
          // 结构性违规换题型也没用（超纲是题位本身的问题）
          if (kinds !== undefined && kinds.length > 1 && reason.includes('verify-scope')) break
        }

        if (placed === undefined) gaps.push({ slot: key, missing: 1, reason })
        else slots.push(placed)
      }
    }

    const order = slots
      .map((slot) => slot.itemId)
      .toSorted((a, b) => this.difficultyMid(a) - this.difficultyMid(b))
    const totalScore = slots.reduce((sum, slot) => sum + slot.spec.score, 0)

    const paper: Paper = {
      blueprint,
      slots,
      gaps,
      order,
      totalScore,
      scoreGap: blueprint.paper.totalScore - totalScore,
      attempts,
    }
    this.latest = paper
    return paper
  }

  private difficultyMid(itemId: string): number {
    const item = this.ctx.bank.get(itemId)
    if (item === undefined) return 0
    return (item.slot.difficulty[0] + item.slot.difficulty[1]) / 2
  }
}

export function apply(ctx: Context, config: PaperConfig): void {
  ctx.plugin(PaperService, config)
}
