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
export const inject = ['figure']

export const Config = z.object({
  /** 本题型是否必须带图（例如函数图象题） */
  requireFigure: z.boolean().default(false),
})

export interface VerifyFigureConfig {
  requireFigure: boolean
}

export function apply(ctx: Context, config: VerifyFigureConfig): void {
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    if (item.figure === undefined) {
      if (!config.requireFigure) return verdict
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
      pass: true,
      evidence: {
        ...verdict.evidence,
        figure: {
          pass: true,
          detail: `断言 ${Object.keys(artifact.assertions).length} 项全过（${Object.keys(artifact.assertions).join('、')}）`,
        },
      },
    }
  })
}
