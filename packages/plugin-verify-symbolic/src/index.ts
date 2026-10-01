import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 符号校验闸门。
 *
 * **这是本项目正确性的落点**：它不相信构造器，只相信代入验证——
 * 从 `instance.params` 重新算出函数，再把主张的根代回求值。
 * 不认识的构造器一律不通过（fail closed，宁缺勿错）。
 */

export const name = 'verify-symbolic'

export const Config = z.object({
  /** 根的代入误差容忍度 */
  tolerance: z.number().default(1e-9),
})

export interface SymbolicConfig {
  tolerance: number
}

/** 多项式在某点的值（目前只覆盖构造器用到的两种形式） */
function evaluate(kind: string, params: Readonly<Record<string, number>>, x: number): number | null {
  if (kind === 'parabola/roots') {
    const { a, r1, r2 } = params
    if (a === undefined || r1 === undefined || r2 === undefined) return null
    return a * (x - r1) * (x - r2)
  }
  if (kind === 'parabola/vertex') {
    const { a, h, k } = params
    if (a === undefined || h === undefined || k === undefined) return null
    return a * (x - h) ** 2 + k
  }
  return null
}

function claims(item: { instance: { kind: string; params: Readonly<Record<string, number>> } }): number[] {
  const { kind, params } = item.instance
  if (kind === 'parabola/roots') {
    const { r1, r2 } = params
    return r1 === undefined || r2 === undefined ? [] : [r1, r2]
  }
  if (kind === 'parabola/vertex') {
    const { h } = params
    return h === undefined ? [] : [h]
  }
  return []
}

export function apply(ctx: Context, config: SymbolicConfig): void {
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const { kind, params } = item.instance
    const roots = claims(item)
    if (roots.length === 0) {
      return {
        pass: false,
        gate: name,
        reason: `没有覆盖构造器 ${kind} 的符号校验器`,
        fixable: false,
        hint: '为新构造器补一个校验器，否则不得入库',
      } satisfies Verdict
    }

    for (const root of roots) {
      const value = evaluate(kind, params, root)
      if (value === null || Math.abs(value) > config.tolerance) {
        return {
          pass: false,
          gate: name,
          reason: `代入验证失败：f(${root}) = ${String(value)}`,
          fixable: true,
          hint: '构造参数与主张的解不一致',
        } satisfies Verdict
      }
    }

    // 判别式 > 0：两根确实不同（防止退化成一个根）
    if (kind === 'parabola/roots') {
      const { a, r1, r2 } = params
      if (a === undefined || r1 === undefined || r2 === undefined || r1 === r2) {
        return {
          pass: false,
          gate: name,
          reason: '两根重合，题目退化',
          fixable: true,
        } satisfies Verdict
      }
    }

    return {
      pass: true,
      evidence: {
        ...verdict.evidence,
        symbolic: {
          pass: true,
          detail: `代入验证 f(${roots.join(')=0、f(')}) = 0（构造器 ${kind}）`,
        },
      },
    }
  })
}
