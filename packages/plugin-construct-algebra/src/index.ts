import { Service, type Context } from '@deepseek-ai/cordis'
import { fnv1a } from '@examharness/core'
import type { BlueprintRow, Constructor, Item, Option } from '@examharness/core'
import z from 'schemastery'

/**
 * 代数与统计的构造器（数与式 / 方程 / 函数 / 统计）。
 *
 * 每个构造器的形状都一样：**先造出数学对象，再由它推出题面与答案**。
 * 答案永远不是"模型算的"，而是从参数直接算出来的——闸门会拿参数重新算一遍（独立验证）。
 *
 * 覆盖的题位（蓝图的 knowledge 用这些词）：
 *   实数与二次根式 / 整式与因式分解 / 一元二次方程 / 一次函数 / 反比例函数 / 统计与概率
 */

export const name = 'construct-algebra'

export const Config = z.object({
  /** 参数取值范围（数值大小的上界） */
  maxValue: z.number().default(12),
})

export interface AlgebraConfig {
  maxValue: number
}

/** 确定性伪随机（LCG）：同种子 → 同序列 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const minus = (value: number): string => (value < 0 ? `− ${String(-value)}` : `${String(value)}`)
/** 带符号的项，用于拼多项式文本：x² + 5x − 6 */
const signed = (value: number, tail: string): string =>
  value === 0 ? '' : value > 0 ? ` + ${value === 1 && tail !== '' ? '' : String(value)}${tail}` : ` − ${-value === 1 && tail !== '' ? '' : String(-value)}${tail}`

/** 把一个整数写成便于小学生读的分数或整数 */
function asFraction(numerator: number, denominator: number): string {
  if (denominator === 1) return String(numerator)
  const sign = numerator < 0 !== denominator < 0 ? '−' : ''
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  const g = gcd(n, d)
  return `${sign}\\dfrac{${String(n / g)}}{${String(d / g)}}`
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x === 0 ? 1 : x
}

function pickInt(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/** 组装一个题目（六个构造器共用）：答案、证据、题面、LaTeX 都在这里定形 */
function buildItem(input: {
  slot: BlueprintRow
  seed: number
  kind: string
  params: Record<string, number>
  givens: readonly string[]
  goal: string
  answer: string
  answerTex: string
  steps: readonly { text: string; basis: string }[]
  stem: string
  stemTex: string
  solution: readonly string[]
  solutionTex: readonly string[]
  options?: readonly { key: string; text: string }[]
}): Item {
  const difficultyMid = (input.slot.difficulty[0] + input.slot.difficulty[1]) / 2
  return {
    id: `it-${input.slot.key}-${String(input.seed)}-${fnv1a(`${input.kind}|${JSON.stringify(input.params)}`)}`,
    slot: {
      ...input.slot,
      difficulty: [Math.max(0, difficultyMid - 0.06), Math.min(1, difficultyMid + 0.06)],
    },
    instance: {
      kind: input.kind,
      params: input.params,
      givens: input.givens,
      goal: input.goal,
    },
    witness: {
      steps: input.steps.map((step, index) => ({ n: index + 1, text: step.text, basis: step.basis })),
      answer: input.answer,
      auxiliary: false,
      reprSwitches: 1,
    },
    prose: {
      stem: input.stem,
      ...(input.options === undefined
        ? {}
        : {
            options: input.options.map((option): Option => ({ key: option.key, text: option.text })),
          }),
      answerText: input.answer,
      solution: input.solution,
      tex: { stem: input.stemTex, answer: input.answerTex, solution: input.solutionTex },
      serializer: { model: 'template', version: 1 },
    },
    evidence: {},
    provenance: {
      constructor: `${input.kind}@v1`,
      seed: input.seed,
      models: {},
      createdAt: new Date(0).toISOString(),
    },
    lifecycle: 'draft',
    review: { confirmedBy: null, confirmedAt: null },
  }
}

/* ────────────── 1. 实数与二次根式：化简 √(a²b) ────────────── */

function createRadicalSimplify(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const square = pickInt(random, 2, Math.min(config.maxValue, 9))
    const free = pickInt(random, 2, 7)
    const outside = square
    const radicand = square * square * free
    return buildItem({
      slot,
      seed,
      kind: 'radical/simplify',
      params: { square, free, outside, radicand },
      givens: [`\\sqrt{${String(radicand)}}`],
      goal: '化简',
      answer: `${String(outside)}√${String(free)}`,
      answerTex: `${String(outside)}\\sqrt{${String(free)}}`,
      steps: [
        { text: `把 ${String(radicand)} 分解成平方因数：${String(radicand)} = ${String(outside)}² × ${String(free)}`, basis: '因数分解' },
        { text: `开方得 ${String(outside)}√${String(free)}`, basis: '二次根式的性质' },
      ],
      stem: `化简：√${String(radicand)}。`,
      stemTex: `\\sqrt{${String(radicand)}}`,
      solution: [`${String(radicand)} = ${String(outside)}² × ${String(free)}`, `所以 √${String(radicand)} = ${String(outside)}√${String(free)}`],
      solutionTex: [
        `${String(radicand)} = ${String(outside)}^{2} \\times ${String(free)}`,
        `\\sqrt{${String(radicand)}} = ${String(outside)}\\sqrt{${String(free)}}`,
      ],
      options: [
        { key: 'A', text: `${String(outside)}√${String(free)}` },
        { key: 'B', text: `√${String(radicand)}` },
        { key: 'C', text: `${String(free)}√${String(outside)}` },
        { key: 'D', text: `${String(outside * free)}` },
      ],
    })
  }
}

/* ────────────── 2. 整式与因式分解：(x+a)(x+b) ────────────── */

function createFactorQuadratic(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const a = pickInt(random, 1, Math.min(config.maxValue, 8))
    const b = pickInt(random, 1, Math.min(config.maxValue, 8))
    const sum = a + b
    const product = a * b
    const stem = `把多项式 x²${signed(sum, 'x')}${signed(product, '')} 分解因式。`
    return buildItem({
      slot,
      seed,
      kind: 'factor/quadratic',
      params: { a, b, sum, product },
      givens: [`x²${signed(sum, 'x')}${signed(product, '')}`],
      goal: '分解因式',
      answer: `(x + ${String(a)})(x + ${String(b)})`,
      answerTex: `(x + ${String(a)})(x + ${String(b)})`,
      steps: [
        { text: `找两个数，和是 ${String(sum)}、积是 ${String(product)}：${String(a)} 与 ${String(b)}`, basis: '十字相乘' },
        { text: `所以 x²${signed(sum, 'x')}${signed(product, '')} = (x + ${String(a)})(x + ${String(b)})`, basis: '因式分解' },
      ],
      stem,
      stemTex: `x^{2}${signed(sum, 'x')}${signed(product, '')}`,
      solution: [`${String(a)} + ${String(b)} = ${String(sum)}，${String(a)} × ${String(b)} = ${String(product)}`, `原式 = (x + ${String(a)})(x + ${String(b)})`],
      solutionTex: [
        `${String(a)} + ${String(b)} = ${String(sum)},\\quad ${String(a)} \\times ${String(b)} = ${String(product)}`,
        `x^{2}${signed(sum, 'x')}${signed(product, '')} = (x + ${String(a)})(x + ${String(b)})`,
      ],
    })
  }
}

/* ────────────── 3. 一元二次方程：整数根 ────────────── */

function createQuadraticRoots(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const r1 = pickInt(random, -Math.min(config.maxValue, 9), Math.min(config.maxValue, 9)) || 1
    let r2 = pickInt(random, -Math.min(config.maxValue, 9), Math.min(config.maxValue, 9))
    if (r2 === r1) r2 = r1 + 1
    const b = -(r1 + r2)
    const c = r1 * r2
    const stem = `解方程：x²${signed(b, 'x')}${signed(c, '')} = 0。`
    return buildItem({
      slot,
      seed,
      kind: 'equation/quadratic',
      params: { r1, r2, b, c },
      givens: [`x²${signed(b, 'x')}${signed(c, '')} = 0`],
      goal: '解方程',
      answer: `x₁ = ${String(r1)}，x₂ = ${String(r2)}`,
      answerTex: `x_{1} = ${String(r1)},\\quad x_{2} = ${String(r2)}`,
      steps: [
        { text: `因为 ${String(r1)} × ${String(r2)} = ${String(c)}，且 ${String(r1)} + ${String(r2)} = ${String(-b)}`, basis: '十字相乘' },
        { text: `原方程化为 (x ${r1 < 0 ? '+' : '−'} ${String(Math.abs(r1))})(x ${r2 < 0 ? '+' : '−'} ${String(Math.abs(r2))}) = 0`, basis: '因式分解' },
        { text: `解得 x₁ = ${String(r1)}，x₂ = ${String(r2)}`, basis: '一元二次方程' },
      ],
      stem,
      stemTex: `x^{2}${signed(b, 'x')}${signed(c, '')} = 0`,
      solution: [
        `(x ${r1 < 0 ? '+' : '−'} ${String(Math.abs(r1))})(x ${r2 < 0 ? '+' : '−'} ${String(Math.abs(r2))}) = 0`,
        `x₁ = ${String(r1)}，x₂ = ${String(r2)}`,
      ],
      solutionTex: [
        `x^{2}${signed(b, 'x')}${signed(c, '')} = (x ${r1 < 0 ? '+' : '−'} ${String(Math.abs(r1))})(x ${r2 < 0 ? '+' : '−'} ${String(Math.abs(r2))})`,
        `x_{1} = ${String(r1)},\\quad x_{2} = ${String(r2)}`,
      ],
    })
  }
}

/* ────────────── 4. 一次函数：过两点求解析式 ────────────── */

function createLinearTwoPoints(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    let k = pickInt(random, -4, 4)
    if (k === 0) k = 2
    const b = pickInt(random, -Math.min(config.maxValue, 9), Math.min(config.maxValue, 9))
    const x1 = pickInt(random, -4, 4)
    let x2 = pickInt(random, -4, 4)
    if (x2 === x1) x2 = x1 + 2
    const y1 = k * x1 + b
    const y2 = k * x2 + b
    const stem = `已知一次函数的图象经过点 A(${String(x1)}, ${String(y1)}) 与 B(${String(x2)}, ${String(y2)})，求这个一次函数的解析式。`
    return buildItem({
      slot,
      seed,
      kind: 'linear/two-points',
      params: { k, b, x1, y1, x2, y2 },
      givens: [`过 A(${String(x1)}, ${String(y1)})`, `过 B(${String(x2)}, ${String(y2)})`],
      goal: '求解析式',
      answer: `y = ${String(k)}x${signed(b, '')}`,
      answerTex: `y = ${String(k)}x${signed(b, '')}`,
      steps: [
        { text: `设 y = kx + b，把两点代入：${String(k)} × ${String(x1)} + b = ${String(y1)}，${String(k)} × ${String(x2)} + b = ${String(y2)}`, basis: '待定系数法' },
        { text: `两式相减得 k = ${String(k)}，再代回得 b = ${String(b)}`, basis: '解二元一次方程组' },
      ],
      stem,
      stemTex: `A(${String(x1)},\\ ${String(y1)}),\\quad B(${String(x2)},\\ ${String(y2)})`,
      solution: [`k = \\dfrac{${String(y2)} - ${String(y1)}}{${String(x2)} - ${String(x1)}} = ${String(k)}`, `b = ${String(b)}`],
      solutionTex: [
        `k = \\dfrac{${String(y2)} - ${String(y1)}}{${String(x2)} - ${String(x1)}} = ${String(k)}`,
        `y = ${String(k)}x${signed(b, '')}`,
      ],
    })
  }
}

/* ────────────── 5. 反比例函数：过点求 k ────────────── */

function createInversePoint(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    let x = pickInt(random, 1, Math.min(config.maxValue, 9))
    let y = pickInt(random, 2, Math.min(config.maxValue, 9))
    if (x === y) y = x + 3
    const k = x * y
    const stem = `已知反比例函数 y = k/x 的图象经过点 P(${String(x)}, ${String(y)})，求 k 的值，并说明图象在哪几个象限。`
    return buildItem({
      slot,
      seed,
      kind: 'inverse/point',
      params: { x, y, k },
      givens: [`P(${String(x)}, ${String(y)})`, 'y = k/x'],
      goal: '求 k 与所在象限',
      answer: `k = ${String(k)}，图象在第一、三象限`,
      answerTex: `k = ${String(k)}`,
      steps: [
        { text: `把点代入：${String(y)} = k / ${String(x)}`, basis: '函数图象上的点满足解析式' },
        { text: `得 k = ${String(x)} × ${String(y)} = ${String(k)}`, basis: '等式变形' },
        { text: `k = ${String(k)} > 0，所以图象在第一、三象限`, basis: '反比例函数的性质' },
      ],
      stem,
      stemTex: `y = \\dfrac{k}{x}`,
      solution: [`k = ${String(x)} \\times ${String(y)} = ${String(k)}`, 'k > 0，图象在第一、三象限'],
      solutionTex: [`k = ${String(x)} \\times ${String(y)} = ${String(k)}`],
    })
  }
}

/* ────────────── 6. 统计：平均数与众数 ────────────── */

function createStatsMean(config: AlgebraConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const count = 8
    const base = pickInt(random, 5, 12)
    const values: number[] = []
    for (let index = 0; index < count - 1; index += 1) values.push(base + pickInt(random, -3, 3))
    // 最后一数补齐，让总和是 count 的整数倍——答案好看，且平均数一定是整数（可精确验证）
    const partial = values.reduce((sum, value) => sum + value, 0)
    const target = base * count
    values.push(target - partial)
    const sorted = [...values].toSorted((left, right) => left - right)
    const sum = values.reduce((total, value) => total + value, 0)
    const mean = sum / count
    const mode = sorted.reduce(
      (best, value) => {
        const hits = values.filter((entry) => entry === value).length
        return hits > best.hits ? { value, hits } : best
      },
      { value: sorted[0] ?? 0, hits: 0 },
    )
    const stem = `某班随机抽取 ${String(count)} 名学生的成绩（单位：分）如下：${values.join('，')}。求这组数据的平均数与众数。`
    return buildItem({
      slot,
      seed,
      kind: 'stats/mean',
      params: { count, sum, mean, mode: mode.value, ...Object.fromEntries(values.map((value, index) => [`v${String(index + 1)}`, value])) },
      givens: [`${String(count)} 个数据`, values.join('，')],
      goal: '求平均数与众数',
      answer: `平均数 ${String(mean)} 分，众数 ${String(mode.value)} 分`,
      answerTex: `\\bar{x} = ${asFraction(sum, count)},\\quad \\text{众数} = ${String(mode.value)}`,
      steps: [
        { text: `总和 = ${values.join(' + ')} = ${String(sum)}`, basis: '求和' },
        { text: `平均数 = ${String(sum)} ÷ ${String(count)} = ${String(mean)}`, basis: '平均数的定义' },
        { text: `出现次数最多的是 ${String(mode.value)}（${String(mode.hits)} 次）`, basis: '众数的定义' },
      ],
      stem,
      stemTex: `\\bar{x} = \\dfrac{${String(sum)}}{${String(count)}} = ${String(mean)}`,
      solution: [`总和 ${String(sum)}，平均数 ${String(mean)}`, `众数 ${String(mode.value)}`],
      solutionTex: [`\\bar{x} = \\dfrac{${String(sum)}}{${String(count)}} = ${String(mean)}`],
    })
  }
}

/* ────────────── 注册 ────────────── */

export class ConstructAlgebraService extends Service {
  static Config = Config

  constructor(ctx: Context, config: AlgebraConfig) {
    super(ctx, 'constructAlgebra')
    // kind → 工厂 → 覆盖的知识点（蓝图题位用这些词来匹配）
    const factories: readonly [string, Constructor, readonly string[]][] = [
      ['radical/simplify', createRadicalSimplify(config), ['实数与二次根式']],
      ['factor/quadratic', createFactorQuadratic(config), ['整式与因式分解']],
      ['equation/quadratic', createQuadraticRoots(config), ['一元二次方程']],
      ['linear/two-points', createLinearTwoPoints(config), ['一次函数']],
      ['inverse/point', createInversePoint(config), ['反比例函数']],
      ['stats/mean', createStatsMean(config), ['统计与概率']],
    ]
    for (const [kind, factory, covers] of factories) {
      ctx.construct.register(kind, factory, covers)
    }
  }
}

export const inject = ['construct']

export function apply(ctx: Context, config: AlgebraConfig): void {
  ctx.plugin(ConstructAlgebraService, config)
}
