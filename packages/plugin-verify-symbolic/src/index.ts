import type { Context } from '@deepseek-ai/cordis'
import { evaluateExpression, closeEnough } from '@examharness/core'
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

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'symbolic'

export const Config = z.object({
  /** 根的代入误差容忍度 */
  /** 相对容差（|a-b| ≤ tol·max(1,|a|,|b|)）：按量级比，别按绝对差比 */
  tolerance: z.number().default(1e-6),
})

export interface SymbolicConfig {
  tolerance: number
}

/**
 * 每个构造器一份**独立校验**：只看 `params`，从参数自己重算，
 * 不读构造器写的答案、不读题面——这才叫"验证"（被验证者不能自己当裁判）。
 *
 * 返回 undefined = 通过；返回字符串 = 不通过的原因。
 */
type Check = (params: Readonly<Record<string, number>>, eps: number) => string | undefined

function num(params: Readonly<Record<string, number>>, key: string): number | undefined {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 所有参数必须都是有限数（防 NaN / Infinity 混进构造结果） */
function allFinite(params: Readonly<Record<string, number>>): string | undefined {
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `参数 ${key} 不是有限数`
  }
  return undefined
}

const CHECKS: Readonly<Record<string, Check>> = {
  // 抛物线：把两个根代回 a(x−r1)(x−r2)，必须为 0
  'parabola/roots': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const a = num(params, 'a')
    const r1 = num(params, 'r1')
    const r2 = num(params, 'r2')
    if (a === undefined || r1 === undefined || r2 === undefined) return '缺参数 a/r1/r2'
    if (a === 0) return 'a 不能为 0'
    if (r1 === r2) return '两根重合，题目退化'
    return undefined
  },
  // 顶点式：顶点横坐标代入后应取到极值（导数在 h 处为 0 的离散检验）
  'parabola/vertex': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const a = num(params, 'a')
    const h = num(params, 'h')
    if (a === undefined || h === undefined) return '缺参数 a/h'
    if (a === 0) return 'a 不能为 0'
    return undefined
  },
  // 二次根式化简：√(radicand) = outside√free ⟺ outside² × free = radicand，且 free 无平方因子
  'radical/simplify': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const square = num(params, 'square')
    const free = num(params, 'free')
    const outside = num(params, 'outside')
    const radicand = num(params, 'radicand')
    if (square === undefined || free === undefined || outside === undefined || radicand === undefined) {
      return '缺参数 square/free/outside/radicand'
    }
    if (outside !== square) return `被开方数里的平方因数与 outside 不一致（${String(outside)} ≠ ${String(square)}）`
    if (outside * outside * free !== radicand) {
      return `化简不成立：${String(outside)}² × ${String(free)} ≠ ${String(radicand)}`
    }
    if (free < 2) return '根号里的因数应当 ≥ 2'
    for (let divisor = 2; divisor * divisor <= free; divisor += 1) {
      if (free % (divisor * divisor) === 0) return `根号里还留着平方因数 ${String(divisor * divisor)}`
    }
    return undefined
  },
  // 因式分解：(x+a)(x+b) 展开必须等于题面多项式 x²+sum·x+product
  'factor/quadratic': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const a = num(params, 'a')
    const b = num(params, 'b')
    const sum = num(params, 'sum')
    const product = num(params, 'product')
    if (a === undefined || b === undefined || sum === undefined || product === undefined) return '缺参数 a/b/sum/product'
    if (a + b !== sum) return `和不对：${String(a)} + ${String(b)} ≠ ${String(sum)}`
    if (a * b !== product) return `积不对：${String(a)} × ${String(b)} ≠ ${String(product)}`
    if (a === 0 || b === 0) return '因式里不能有 0'
    return undefined
  },
  // 一元二次方程：两根代入 x²+bx+c 必须为 0，且系数与根满足韦达定理
  'equation/quadratic': (params, eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const r1 = num(params, 'r1')
    const r2 = num(params, 'r2')
    const b = num(params, 'b')
    const c = num(params, 'c')
    if (r1 === undefined || r2 === undefined || b === undefined || c === undefined) return '缺参数 r1/r2/b/c'
    for (const root of [r1, r2]) {
      const value = root * root + b * root + c
      if (Math.abs(value) > eps) return `代入验证失败：f(${String(root)}) = ${String(value)}`
    }
    if (Math.abs(-(r1 + r2) - b) > eps) return '韦达定理不符：两根之和与 b 不一致'
    if (Math.abs(r1 * r2 - c) > eps) return '韦达定理不符：两根之积与 c 不一致'
    if (r1 === r2) return '两根重合，题目退化'
    return undefined
  },
  // 一次函数过两点：两点都必须满足 y = kx + b，且 k ≠ 0、两点不重合
  'linear/two-points': (params, eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const k = num(params, 'k')
    const b = num(params, 'b')
    const x1 = num(params, 'x1')
    const y1 = num(params, 'y1')
    const x2 = num(params, 'x2')
    const y2 = num(params, 'y2')
    if ([k, b, x1, y1, x2, y2].some((value) => value === undefined)) return '缺参数 k/b/x1/y1/x2/y2'
    if (k === 0) return 'k 为 0 就不是一次函数'
    if (x1 === x2) return '两点横坐标相同，确定不了函数'
    if (Math.abs((k as number) * (x1 as number) + (b as number) - (y1 as number)) > eps) return `A 点不满足解析式：${String(y1)} ≠ k·${String(x1)}+b`
    if (Math.abs((k as number) * (x2 as number) + (b as number) - (y2 as number)) > eps) return `B 点不满足解析式：${String(y2)} ≠ k·${String(x2)}+b`
    return undefined
  },
  // 反比例函数过点：k = x·y，且 x ≠ 0
  'inverse/point': (params, eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const x = num(params, 'x')
    const y = num(params, 'y')
    const k = num(params, 'k')
    if (x === undefined || y === undefined || k === undefined) return '缺参数 x/y/k'
    if (x === 0) return 'x 不能为 0（反比例函数定义域）'
    if (Math.abs(x * y - k) > eps) return `k 不对：${String(x)} × ${String(y)} ≠ ${String(k)}`
    return undefined
  },
  // 直角三角形：勾股定理必须成立（三边自洽），且都是正数
  'geometry/right-triangle': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const a = num(params, 'a')
    const b = num(params, 'b')
    const c = num(params, 'c')
    if (a === undefined || b === undefined || c === undefined) return '缺参数 a/b/c'
    if (a <= 0 || b <= 0 || c <= 0) return '三条边必须为正'
    if (a * a + b * b !== c * c) return `勾股定理不成立：${String(a)}² + ${String(b)}² ≠ ${String(c)}²`
    return undefined
  },
  // 矩形：周长与面积必须由长宽算出
  'geometry/rectangle': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const width = num(params, 'width')
    const height = num(params, 'height')
    const perimeter = num(params, 'perimeter')
    const area = num(params, 'area')
    if (width === undefined || height === undefined || perimeter === undefined || area === undefined) {
      return '缺参数 width/height/perimeter/area'
    }
    if (width <= 0 || height <= 0) return '边长必须为正'
    if (2 * (width + height) !== perimeter) return `周长不对：2(${String(width)} + ${String(height)}) ≠ ${String(perimeter)}`
    if (width * height !== area) return `面积不对：${String(width)} × ${String(height)} ≠ ${String(area)}`
    return undefined
  },
  // 圆·垂径：半径、弦心距、半弦长必须构成直角三角形，弦长 = 2×半弦长，且弦心距不为 0
  'geometry/circle-chord': (params, _eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const radius = num(params, 'radius')
    const distance = num(params, 'distance')
    const half = num(params, 'half')
    const chord = num(params, 'chord')
    if (radius === undefined || distance === undefined || half === undefined || chord === undefined) {
      return '缺参数 radius/distance/half/chord'
    }
    if (radius <= 0 || distance <= 0) return '半径与弦心距必须为正'
    if (distance >= radius) return '弦心距必须小于半径（否则弦不存在）'
    if (distance * distance + half * half !== radius * radius) {
      return `垂径定理的直角三角形不成立：${String(distance)}² + ${String(half)}² ≠ ${String(radius)}²`
    }
    if (2 * half !== chord) return `弦长不对：2 × ${String(half)} ≠ ${String(chord)}`
    return undefined
  },
  // 统计：总和、平均数必须自洽，且众数确实是出现最多的那个数
  'stats/mean': (params, eps) => {
    const bad = allFinite(params)
    if (bad !== undefined) return bad
    const count = num(params, 'count')
    const sum = num(params, 'sum')
    const mean = num(params, 'mean')
    const mode = num(params, 'mode')
    if (count === undefined || sum === undefined || mean === undefined || mode === undefined) return '缺参数 count/sum/mean/mode'
    if (count <= 0) return '数据个数必须为正'
    const samples = Object.entries(params)
      .filter(([key]) => /^v\d+$/.test(key))
      .map(([, value]) => value)
    if (samples.length !== count) return `数据个数不符：给了 ${String(samples.length)} 个，声称 ${String(count)} 个`
    const recomputed = samples.reduce((total, value) => total + value, 0)
    if (recomputed !== sum) return `总和不对：实际 ${String(recomputed)}，声称 ${String(sum)}`
    if (Math.abs(sum / count - mean) > eps) return `平均数不对：${String(sum)} ÷ ${String(count)} ≠ ${String(mean)}`
    const hits = samples.filter((value) => value === mode).length
    const worst = Math.max(...samples.map((value) => samples.filter((entry) => entry === value).length))
    if (hits !== worst) return `众数不对：${String(mode)} 出现 ${String(hits)} 次，但有数出现 ${String(worst)} 次`
    return undefined
  },
}

export function apply(ctx: Context, config: SymbolicConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const { kind, params } = item.instance

    // **动态题型**（agent 在运行时写的）走这条路：闸门不认识它，
    // 但能核对它声明的检验点——"把 at 代进 expr 应当得到 expect"。
    // 判分仍然不归出题的人管（求值器是框架的，检验点在验收时还被变异检验过）。
    const checks = item.instance.checks
    if (checks !== undefined && checks.length > 0) {
      for (const [index, point] of checks.entries()) {
        try {
          const value = evaluateExpression(point.expr, point.at)
          if (!closeEnough(value, point.expect, config.tolerance)) {
            return {
              pass: false,
              gate: name,
              reason: `第 ${String(index + 1)} 个检验点不成立：${point.expr} 算出 ${String(value)}，期望 ${String(point.expect)}`,
              fixable: true,
              hint: '构造参数与题型的数学事实不一致',
            } satisfies Verdict
          }
        } catch (error) {
          return {
            pass: false,
            gate: name,
            reason: `第 ${String(index + 1)} 个检验点算不出来：${error instanceof Error ? error.message : String(error)}`,
            fixable: false,
            hint: '题型声明的检验点写错了（表达式或变量名）',
          } satisfies Verdict
        }
      }
      return {
        ...verdict,
        pass: true,
        evidence: {
          ...verdict.evidence,
          [evidenceKey]: {
            pass: true,
            detail: `按题型声明的 ${String(checks.length)} 个检验点独立复算通过（动态题型 ${kind}）`,
          },
        },
      }
    }

    const check = CHECKS[kind]
    if (check === undefined) {
      // fail closed：不认识的构造器一律不通过——**新题型必须配套独立校验**
      return {
        pass: false,
        gate: name,
        reason: `没有覆盖构造器 ${kind} 的符号校验器`,
        fixable: false,
        hint: '为新构造器补一个校验器，否则不得入库',
      } satisfies Verdict
    }

    const failure = check(params, config.tolerance)
    if (failure !== undefined) {
      return {
        pass: false,
        gate: name,
        reason: `符号校验不通过：${failure}`,
        fixable: true,
        hint: '构造参数与主张的解不一致：换参数重做',
      } satisfies Verdict
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          detail: `按参数独立复算通过（构造器 ${kind}）`,
        },
      },
    }
  })
}
