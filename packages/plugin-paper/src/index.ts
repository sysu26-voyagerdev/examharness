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
import { fnv1a, shapeOf } from '@examharness/core'
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
    /** 沿用了上一版的那几个题位（现造不出新的时才会有） */
    const reused: string[] = []
    let attempts = 0
    // **这次组卷的身份**：不同次组卷派不同的种子 → "再出一版"是**现造**一批新题。
    // （以前种子只由 (题位, 尝试) 决定，于是每次都派到同一个种子、把库里那批旧题捞回来，
    //   卷子越出越像。R3 的"复用"是给已冻结/已导出的版本用的，不是给"再出一版"用的。）
    const nonce = options.nonce ?? String(Date.now())
    // 这张会话已经用过的结构：优先避开（新卷子在结构上也该是新的，不只是换数字）
    const used = new Set(options.usedShapes ?? [])

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
        // **钉住的题位**（老师签过字的那道）：直接用指定的题，不重造——
        // 签的是那道题，重组卷不该把它换掉。
        const pinnedId = options.pinned?.[key]
        if (pinnedId !== undefined && this.ctx.bank.get(pinnedId) !== undefined) {
          slots.push({ key, spec, itemId: pinnedId })
          continue
        }
        const seeds = options.seeds?.[key]
        let placed: PaperSlot | undefined
        let fallback: PaperSlot | undefined
        let fallbackShape: string | undefined
        let reason = '候选种子用尽，仍未凑到通过闸门的题'
        // 每个题型各为什么不行：缺口原因要给老师看得懂的一句话，
        // 只留最后一条会误导（"被 verify-question 拦下"可能只是备选题型的事，首选是别的原因）
        const tried: string[] = []

        // **一个题位可以有几个题型**：入门小题过不了分量闸门时，接着试下一个题型
        // （题位是 9 分解答题，就该由多问的题型来出）。没有候选就如实报缺口。
        const slot = { ...row, key, count: 1 }
        const byKind = this.ctx.construct.generateWith?.bind(this.ctx.construct)
        const kinds = this.ctx.construct.candidates?.(slot)
        // **卷自记题型**：这个题位上一版用哪个题型，这一版还用它（题照样现造）。
        // 不然按注册顺序挑，agent 新写的题型永远轮不到——它做的活老师在卷子上看不见。
        const preferred = options.preferredKinds?.[key]
        const ordered =
          kinds === undefined || kinds.length === 0
            ? []
            : preferred !== undefined && kinds.includes(preferred)
              ? [preferred, ...kinds.filter((kind) => kind !== preferred)]
              : [...kinds]
        const usable = ordered.length === 0 ? [undefined] : ordered

        for (const kind of usable) {
          for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            attempts += 1
            const seed = seeds?.[attempt] ?? Number.parseInt(fnv1a(`${key}|${attempt}|${nonce}`), 16)
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
            // 已入库的同 (题位, 种子) 题目直接复用：导出只读归档，不重跑（R3）。
            // **但复用要有资格**：这道题的证据里每一道现役闸门都签过字才行——
            // 否则新加的闸门对旧题无效（真实后果：分量闸门上线后，
            // 卷子里还留着"9 分解答题 = 化简 √108"这类旧题）。
            const stored = this.ctx.bank.get(item.id)
            if (stored !== undefined && signedByAll(stored, this.ctx.bank.gates?.() ?? [])) {
              placed = { key, spec, itemId: item.id }
              break
            }
            // **结构偏好**：先攒下这一轮能过闸门的候选，优先挑这张会话没用过的结构；
            // 都没过或都用过时，退回"第一个过的"。
            // 为此把前几次尝试的通过项记下来，而不是一遇到通过就收手。
            // oxlint-disable-next-line no-await-in-loop
            const result = await this.ctx.bank.submit(item)
            if (result.ok) {
              const shape = shapeOf(item)
              if (!used.has(shape)) {
                placed = { key, spec, itemId: result.id }
                used.add(shape)
                break
              }
              // 用过的结构：先放着当备选，继续试下一个种子
              fallback ??= { key, spec, itemId: result.id }
              fallbackShape ??= shape
              reason = '这个题位的结构这张卷已经用过了，继续找新的'
              continue
            }
            reason = kind === undefined ? `${result.verdict.gate}：${result.verdict.reason}` : `${kind} 被 ${result.verdict.gate} 拦下：${result.verdict.reason}`
            tried.push(
              kind === undefined
                ? reason
                : `${kind} 被 ${result.verdict.gate} 拦下：${result.verdict.reason}`,
            )
            // fixable=false 是结构性违规（超纲等）：换种子没用，必须改蓝图
            if (!result.verdict.fixable) break
          }
          if (placed !== undefined) break
          // 结构性违规换题型也没用（超纲是题位本身的问题）
          if (kinds !== undefined && kinds.length > 1 && reason.includes('verify-scope')) break
        }
        // 新结构一个都没找到：用能过闸门的备选（宁可结构重复，也不要空题位）
        if (placed === undefined && fallback !== undefined) {
          placed = fallback
          used.add(fallbackShape ?? '')
        }

        // 最后一招：**沿用上一版这个题位的那道**。
        // 什么时候走到这里：这个题位的候选题型都造不出新的了（参数空间用尽 + 查重拦住），
        // 真实情况是库里攒到几百道之后必然发生。缺一道题比"少一点新意"严重得多，
        // 所以沿用——但要**如实记下来**（`reused`），版本说明里会写"这几道沿用了上一版"。
        if (placed === undefined && tried.length > 0) {
          reason = [...new Set(tried)].slice(0, 3).join('；')
        }

        if (placed === undefined) {
          const lastId = options.previous?.[key]
          const last = lastId === undefined ? undefined : this.ctx.bank.get(lastId)
          if (last !== undefined && signedByAll(last, this.ctx.bank.gates?.() ?? [])) {
            placed = { key, spec, itemId: lastId ?? '' }
            reused.push(key)
          }
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
      ...(reused.length === 0 ? {} : { reused }),
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

/** 这道题有没有被所有现役闸门签过字（见 BankApi.declareGate） */
function signedByAll(item: Item, gates: readonly string[]): boolean {
  return gates.every((gate) => item.evidence[gate] !== undefined)
}

export function apply(ctx: Context, config: PaperConfig): void {
  ctx.plugin(PaperService, config)
}
