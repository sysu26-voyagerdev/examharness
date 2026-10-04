import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 图形规范闸门。
 *
 * 它不"看"图——它让 `ctx.figure` 由图数据重算一遍，并检查断言：
 *   - 几何一致性：标注的点是否真在曲线上；
 *   - 可读性：两个点是否挤成一个点；
 *   - 越界：点是否跑出画布。
 * 断言不过 = 图会误导学生 → 拦下（fixable：调整尺度后重绘即可）。
 *
 * 这条闸门让"图与题干不一致"从**概率问题**变成**可判定问题**。
 */

export const name = 'verify-figure'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'figure'

/**
 * 判定规则的版本：**加一条新判据就 +1**（见 EvidenceEntry.rule）。
 *
 * 2：题面里说"如图/见图"的，必须有图。
 *    为什么加：库里真实有 124 道"如图但没有图"的题（圆切线 46、四边形对角线 45…）——
 *    题面指着不存在的图让学生做，而当年的闸门只看"有的图对不对"，不看"说了图却有没有"。
 *    规则一升级，那些题的旧签字自动失效，重组卷时会被重新送审（补图，或者把"如图"改掉）。
 */
export const rule = 2

/** 题面里"指着图说话"的字样 */
const FIGURE_WORDS = /如图|见图|图中|下图|上图|如图\s*\d|图\s*\d\s*所示/u
export const inject = ['figure']

export const Config = z.object({
  /** 本题型是否必须带图（例如函数图象题） */
  requireFigure: z.boolean().default(false),
})

export interface VerifyFigureConfig {
  requireFigure: boolean
}

export function apply(ctx: Context, config: VerifyFigureConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线/规则升级后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey, rule)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    if (item.figure === undefined) {
      // **题面指着图说话，却没有图**：学生看到的是一道做不了的题
      if (FIGURE_WORDS.test(item.prose.stem)) {
        return {
          pass: false,
          gate: name,
          reason: '题面里说"如图"，但这道题没有图：学生看不到图就做不了',
          fixable: true,
          hint:
            '两条路：①给题型补 figureSpec（框架按 spec 画图，图必须与条件一致）；' +
            '②如果这道题本来就不需要图（条件已经说全了），把题面里的"如图，""见图"这类字样去掉——' +
            '别让题面指着一个不存在的东西',
        }
      }
      if (!config.requireFigure) {
        return {
          ...verdict,
          pass: true,
          evidence: {
            ...verdict.evidence,
            [evidenceKey]: { pass: true, rule, detail: '本题没有图，题面也没提图，且本卷不要求带图' },
          },
        }
      }
      return {
        pass: false,
        gate: name,
        reason: '本题型要求带图，但题目里没有 figure',
        fixable: true,
        hint: '补一个由图数据生成的 figureSpec',
      }
    }

    let artifact
    try {
      artifact = ctx.figure.render(item.figure.spec)
    } catch (error) {
      return {
        pass: false,
        gate: name,
        reason: `渲染失败：${error instanceof Error ? error.message : String(error)}`,
        fixable: true,
      }
    }

    const failed = Object.entries(artifact.assertions)
      .filter(([, ok]) => !ok)
      .map(([key]) => key)

    if (failed.length > 0) {
      return {
        pass: false,
        gate: name,
        reason: `图形规范未通过：${failed.join('、')}`,
        fixable: true,
        hint: '调整尺度或标注位置后重新出图（图必须与条件一致、且不得误导）',
      }
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          rule,
          detail: `断言 ${Object.keys(artifact.assertions).length} 项全过（${Object.keys(artifact.assertions).join('、')}）`,
        },
      },
    }
  })
}
