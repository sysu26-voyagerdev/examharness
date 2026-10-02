import type { Context } from '@deepseek-ai/cordis'
import type { Item, Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 分量闸门：**题位的分量要对得上题的分量**。
 *
 * 为什么要它：真实中考卷里，一道 8–10 分的解答题是**多问**的
 * （先求解析式、再求顶点、再求面积；或先化简、再代入求值）——
 * 这是"分量"的体现。我们一开始没管这件事，于是出现了
 * "9 分的解答题 = 化简 √108"（一句话题占 9 分），卷子读起来轻飘飘。
 *
 * 判据是**可核对的事实**：题型声明的 `goals`（分几问）有几条。
 * 回译闸门已经保证"题面真的分成这么多问"，所以这里数它是有意义的。
 *
 * 阈值刻意保守（8 分以上两问、12 分以上三问），且**只查解答题**：
 * 选择题、填空题一句话问完本来就是常态。
 */

export const name = 'verify-parts'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'parts'

export const Config = z.object({
  /** 多少分以上的解答题至少两问 */
  twoPartFrom: z.number().default(8),
  /** 多少分以上的解答题至少三问 */
  threePartFrom: z.number().default(12),
})

export interface PartsConfig {
  twoPartFrom: number
  threePartFrom: number
}

/** 这道题分几问（题型声明的分条 goals，退回单条 goal） */
export function partsOf(item: Item): number {
  const goals = item.instance.goals
  if (goals !== undefined && goals.length > 0) return goals.filter((goal) => goal.trim() !== '').length
  return item.instance.goal.trim() === '' ? 0 : 1
}

/** 这个题位最少要几问 */
export function requiredParts(item: Item, config: PartsConfig): number {
  if (item.slot.type !== '解答') return 1
  if (item.slot.score >= config.threePartFrom) return 3
  if (item.slot.score >= config.twoPartFrom) return 2
  return 1
}

export function apply(ctx: Context, config: PartsConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const parts = partsOf(item)
    const required = requiredParts(item, config)
    if (parts >= required) {
      return {
        ...verdict,
        pass: true,
        evidence: {
          ...verdict.evidence,
          [evidenceKey]: { pass: true, detail: `${String(parts)} 问，题位要求至少 ${String(required)} 问` },
        },
      }
    }

    return {
      pass: false,
      gate: name,
      reason:
        `题位是 ${String(item.slot.score)} 分的${item.slot.type}题，构造出来只有 ${String(parts)} 问：` +
        `一道 ${String(item.slot.score)} 分的${item.slot.type}题至少要 ${String(required)} 问`,
      fixable: true,
      hint:
        '让题型按"分量"设计：把一道题拆成几问（例如先求解析式、再求顶点、再求面积；或先化简、再代入求值），' +
        '用 goals 声明每一问，每一问都要有能核对的检验点。不是把一句话拆成两句，而是真的多一个可解的小目标',
    }
  })
}
