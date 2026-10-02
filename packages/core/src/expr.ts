/**
 * 一个**很小很严**的算术表达式求值器：给"验收新题型"用。
 *
 * 为什么不用 eval / new Function：那等于让 agent 写的代码在框架里任意执行。
 * 这里只认数字、标识符、+ − × ÷ ^、括号、一元负号——够表达"代数检验点"，
 * 又没有任何副作用（不能调函数、不能访问外部）。
 *
 * 题型模块声明检验点（`{expr, at, expect}`），**由框架用它求值核对**——
 * 判分这一步不归出题的人管（R2）。
 */

export interface CheckPoint {
  /** 表达式，例如 "a*(x-r1)*(x-r2)" */
  expr: string
  /** 代入哪些变量 */
  at: Readonly<Record<string, number>>
  /** 期望值（通常 0） */
  expect: number
}

export function evaluateExpression(source: string, variables: Readonly<Record<string, number>>): number {
  const tokens = tokenize(source)
  let position = 0

  const peek = (): string | undefined => tokens[position]
  const next = (): string | undefined => {
    const token = tokens[position]
    position += 1
    return token
  }

  const parsePrimary = (): number => {
    const token = next()
    if (token === undefined) throw new Error('表达式意外结束')
    if (token === '(') {
      const value = parseSum()
      if (next() !== ')') throw new Error('括号没有配对')
      return value
    }
    if (token === '-') return -parsePrimary()
    if (token === '+') return parsePrimary()
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token)
    if (/^[A-Za-z_]\w*$/.test(token)) {
      const value = variables[token]
      if (value === undefined) throw new Error(`表达式里有未知变量 ${token}`)
      if (!Number.isFinite(value)) throw new Error(`变量 ${token} 不是有限数`)
      return value
    }
    throw new Error(`不认识的记号：${token}`)
  }

  const parsePower = (): number => {
    const base = parsePrimary()
    if (peek() !== '^') return base
    next()
    // 右结合：2^3^2 = 2^(3^2)
    return base ** parsePower()
  }

  const parseProduct = (): number => {
    let value = parsePower()
    for (;;) {
      const token = peek()
      if (token === '*') {
        next()
        value *= parsePower()
      } else if (token === '/') {
        next()
        const divisor = parsePower()
        if (divisor === 0) throw new Error('表达式里出现除以 0')
        value /= divisor
      } else break
    }
    return value
  }

  const parseSum = (): number => {
    let value = parseProduct()
    for (;;) {
      const token = peek()
      if (token === '+') {
        next()
        value += parseProduct()
      } else if (token === '-') {
        next()
        value -= parseProduct()
      } else break
    }
    return value
  }

  const result = parseSum()
  if (position !== tokens.length) throw new Error(`表达式有多余内容：${tokens.slice(position).join(' ')}`)
  if (!Number.isFinite(result)) throw new Error('表达式求值结果不是有限数')
  return result
}

function tokenize(source: string): string[] {
  return source.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[+\-*/^()]/g) ?? []
}

/**
 * 检验点是否**真的在检验**：把参数或答案动一点点，它必须失败。
 *
 * 这是框架侧、与题型无关的对抗性检查——它抓的是"写了个永远成立的检验点"
 * （比如 `1 = 1`）。没有这一条，"声明式检验点"就退化成自证。
 */
export function checkPointIsDiscriminating(check: CheckPoint, tolerance = 1e-9): { ok: boolean; reason?: string } {
  let baseline: number
  try {
    baseline = evaluateExpression(check.expr, check.at)
  } catch (error) {
    return { ok: false, reason: `检验点本身算不出来：${error instanceof Error ? error.message : String(error)}` }
  }
  if (Math.abs(baseline - check.expect) > tolerance) {
    return { ok: false, reason: `检验点对正确参数就不成立：算出 ${String(baseline)}，期望 ${String(check.expect)}` }
  }

  // 逐个变量扰动：至少有一个扰动能让检验点失败，否则它没在检验任何东西
  for (const [name, value] of Object.entries(check.at)) {
    if (!Number.isFinite(value)) continue
    const delta = Math.abs(value) > 1 ? Math.abs(value) * 0.37 + 0.5 : 0.5
    for (const candidate of [value + delta, value - delta]) {
      try {
        const moved = evaluateExpression(check.expr, { ...check.at, [name]: candidate })
        if (Math.abs(moved - check.expect) > 1e-6) return { ok: true }
      } catch {
        // 扰动后算不出来（比如除零）也算"检验点会失败"
        return { ok: true }
      }
    }
  }
  return { ok: false, reason: '把参数怎么改，这个检验点都成立——它没有在检验任何东西' }
}
