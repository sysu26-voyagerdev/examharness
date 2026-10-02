import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as dynamicPlugin from '@examharness/plugin-construct-dynamic'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as paperPlugin from '@examharness/plugin-paper'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * **agent 在运行时制作新题型**的验收测试。
 *
 * 这里要证明的不是"某个题型能用"，而是这条能力链本身：
 *   1. 外部模块（agent 写的）能被加载、验收、注册，然后**真的出题并过闸门入库**；
 *   2. 作弊的模块会被拦住——检验点无效（怎么改参数都成立）、用了危险调用、覆盖太宽、参数空间太小；
 *   3. 闸门**不认识**这个题型，却能用框架的求值器核对它声明的检验点（判分不归出题的人管）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一元一次不等式', '整式运算', '整式与因式分解', '一元二次方程', '对称轴', '与坐标轴交点', '二次函数图象', '配方']

const fibers: Fiber[] = []
let workdir = ''

/**
 * 一个"agent 会写出来"的题型：一元一次不等式。
 * 注意它**按种子在三种结构里分支**（换给定、换问法）——验收现在会量这一点：
 * 只会"同一句式换数字"的模块会被判"这不是题型"。
 */
const GOOD_MODULE = `
export const kind = 'dynamic/linear-inequality'
export const covers = ['一元一次不等式']

const small = (n) => Math.abs(Math.round(n))

export function construct(slot, seed) {
  const s = small(seed)
  const branch = s % 3
  if (branch === 0) return solve(s)
  if (branch === 1) return integerSolution(s)
  return fromSolutionSet(s)
}

/** 结构一：解不等式 */
function solve(s) {
  const a = 2 + (s % 5)
  const x = -6 + (s % 13)
  const b = -9 + (s % 19)
  const c = a * x + b
  return {
    params: { a, b, c, x },
    stem: '解不等式：' + a + 'x + ' + b + ' > ' + c + '。',
    stemTex: a + 'x+' + b + '>' + c,
    answer: 'x > ' + x,
    answerTex: 'x > ' + x,
    goal: '解这个不等式',
    goals: ['解这个不等式'],
    givens: ['不等式 ' + a + 'x + ' + b + ' > ' + c],
    solution: ['移项得 ' + a + 'x > ' + (c - b), '两边同除以 ' + a + ' 得 x > ' + x],
    solutionTex: [a + 'x>' + (c - b), 'x>' + x],
    steps: [
      { text: '移项：' + a + 'x > ' + (c - b), basis: '不等式性质' },
      { text: '两边同除以正数 ' + a + '，不等号方向不变：x > ' + x, basis: '不等式性质' },
    ],
    checks: [
      { expr: 'a*x + b', at: { a, b, x }, expect: c },
      { expr: '(a*(x-1) + b) - c', at: { a, b, x, c }, expect: -a },
    ],
  }
}

/** 结构二：带整数解的要求（两问） */
function integerSolution(s) {
  const a = 2 + (s % 4)
  const x = -(5 + (s % 9))
  const b = 1 + (s % 11)
  const c = a * x + b
  return {
    params: { a, b, c, x },
    stem: '已知关于 x 的不等式 ' + a + 'x + ' + b + ' > ' + c + '。（1）解这个不等式；（2）求它的最小整数解。',
    stemTex: a + 'x+' + b + '>' + c,
    answer: '（1）x > ' + x + '；（2）最小整数解是 ' + (x + 1),
    answerTex: 'x>' + x + ',\\ x_{\\min}=' + (x + 1),
    goal: '解不等式 求最小整数解',
    goals: ['解这个不等式', '求最小整数解'],
    givens: ['不等式 ' + a + 'x + ' + b + ' > ' + c, 'x 取整数'],
    solution: ['解得 x > ' + x, '大于 ' + x + ' 的最小整数是 ' + (x + 1)],
    solutionTex: ['x>' + x, 'x_{\\min}=' + (x + 1)],
    steps: [
      { text: '解不等式得 x > ' + x, basis: '不等式性质' },
      { text: '在解集里取最小整数', basis: '整数解的意义' },
    ],
    checks: [
      { expr: 'a*x + b', at: { a, b, x }, expect: c },
      { expr: '(a*(x-1) + b) - c', at: { a, b, x, c }, expect: -a },
    ],
  }
}

/** 结构三：已知解集反求参数 */
function fromSolutionSet(s) {
  const a = 2 + (s % 5)
  const x = 1 + (s % 8)
  const c = a * x
  return {
    params: { a, c, x },
    stem: '已知关于 x 的不等式 ' + a + 'x - c > 0 的解集是 x > ' + x + '，求 c 的值与这个解集的最小整数。',
    stemTex: a + 'x-c>0',
    answer: 'c = ' + c + '，最小整数是 ' + x,
    answerTex: 'c=' + c + ',\\ x=' + x,
    goal: '求 c 求最小整数',
    goals: ['求 c 的值', '求解集里的最小整数'],
    givens: ['不等式 ' + a + 'x - c > 0', '解集是 x > ' + x],
    solution: ['解不等式得 x > c/' + a + '，与 x > ' + x + ' 比较得 c = ' + c, '最小整数是 ' + x],
    solutionTex: ['x>\\frac{c}{' + a + '}', 'c=' + c],
    steps: [
      { text: '解不等式，把解集用 c 表示', basis: '不等式性质' },
      { text: '与已知解集比较，求出 c', basis: '解集的唯一性' },
    ],
    checks: [
      { expr: 'a*x - c', at: { a, x, c }, expect: 0 },
      { expr: 'c - a*x', at: { a, x, c }, expect: 0 },
    ],
  }
}
`

/** 作弊模块一：检验点永远成立（把参数怎么改都通过）——结构看着挺像，但没在核对任何东西 */
const FAKE_CHECK_MODULE = `
export const kind = 'dynamic/fake-check'
export const covers = ['一元一次不等式']
export function construct(slot, seed) {
  const branch = Math.abs(Math.round(seed)) % 3
  const a = 2 + (Math.abs(Math.round(seed)) % 5)
  const x = Math.abs(Math.round(seed)) % 7
  const shapes = [
    { givens: ['不等式 ' + a + 'x > ' + a * x], goals: ['解这个不等式'] },
    { givens: ['不等式 ' + a + 'x > ' + a * x, 'x 是整数'], goals: ['解这个不等式', '求最小整数解'] },
    { givens: ['解集是 x > ' + x], goals: ['求参数'] },
  ]
  const shape = shapes[branch]
  return {
    params: { a, x },
    stem: '随便一道题 ' + seed,
    answer: 'x = ' + x,
    givens: shape.givens,
    goals: shape.goals,
    // 恒等式：把参数怎么改都成立 → 变异检验会判"没有在检验任何东西"
    checks: [{ expr: 'a - a', at: { a, x }, expect: 0 }],
  }
}
`

/** 作弊模块二：偷偷调用系统能力 */
const DANGEROUS_MODULE = `
import { execSync } from 'node:child_process'
export const kind = 'dynamic/dangerous'
export const covers = ['一元一次不等式']
export function construct(slot, seed) {
  execSync('echo hi')
  return { params: { seed }, stem: 'x', answer: 'x', checks: [{ expr: 'seed - seed', at: { seed }, expect: 0 }] }
}
`

/** 作弊模块三：没有检验点（无法独立验证） */
const NO_CHECK_MODULE = `
export const kind = 'dynamic/no-check'
export const covers = ['一元一次不等式']
export function construct(slot, seed) {
  const x = seed % 9
  return {
    params: { x },
    stem: '解 x - ' + x + ' = 0',
    answer: 'x = ' + x,
    goal: '解这个方程',
    goals: ['解这个方程'],
    givens: ['方程 x - ' + x + ' = 0'],
  }
}
`

/** 作弊模块四：顶层就在死循环（真踩过：agent 写的 `for (let i = -4; i <= -1; i = i - 1)`） */
const TOP_LEVEL_HANG_MODULE = `
export const kind = 'dynamic/hang'
export const covers = ['一元一次不等式']
const CASES = []
for (let r1 = -4; r1 <= -1; r1 = r1 - 1) {
  for (let r2 = 1; r2 <= 6; r2 = r2 + 1) {
    if (((r1 + r2) % 2) === 0 && (r2 + r1) !== 0) CASES.push({ r1: r1, r2: r2 })
  }
}
export function construct(slot, seed) {
  return { params: { seed }, stem: 'x', answer: 'x', checks: [{ expr: 'seed - seed', at: { seed }, expect: 0 }] }
}
`

/** 会写字段的模块：goals / givens / stemTex 都要原样进 Item（并且有真的结构分支） */
const DECLARED_MODULE = `
export const kind = 'dynamic/declared'
export const covers = ['配方']
export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed))
  const branch = s % 3
  const x = 2 + (s % 3)
  const k = 2 + (s % 2)
  const c = k * x + 3
  if (branch === 0) {
    return {
      params: { x, k, c },
      stem: '已知 ' + k + 'x + 3 > ' + c + '，求 x 的取值范围。',
      stemTex: k + 'x+3>' + c,
      answer: 'x > ' + x,
      answerTex: 'x > ' + x,
      goal: '求 x 的取值范围',
      goals: ['求 x 的取值范围'],
      givens: [k + 'x + 3 > ' + c],
      checks: [{ expr: 'k*x + 3 - c', at: { k, x, c }, expect: 0 }],
    }
  }
  if (branch === 1) {
    return {
      params: { x, k, c },
      stem: '已知 ' + k + 'x + 3 > ' + c + ' 的解集是 x > ' + x + '，求 k。',
      stemTex: k + 'x+3>' + c,
      answer: 'k = ' + k,
      answerTex: 'k=' + k,
      goal: '求 k',
      goals: ['求 k 的值'],
      givens: ['不等式 ' + k + 'x + 3 > ' + c, '解集是 x > ' + x],
      checks: [{ expr: 'k*x + 3 - c', at: { k, x, c }, expect: 0 }],
    }
  }
  return {
    params: { x, k, c },
    stem: '已知 ' + k + 'x + 3 > ' + c + '，求最小整数解。',
    stemTex: k + 'x+3>' + c,
    answer: 'x > ' + x + '，最小整数是 ' + (x + 1),
    answerTex: 'x>' + x,
    goal: '求最小整数解',
    goals: ['求最小整数解'],
    givens: ['不等式 ' + k + 'x + 3 > ' + c, 'x 取整数'],
    checks: [{ expr: 'k*x + 3 - c', at: { k, x, c }, expect: 0 }],
  }
}
`

/** 作弊模块五：用 Math.random 出题（同一种子两次不一样） */
const NONDETERMINISTIC_MODULE = `
export const kind = 'dynamic/random'
export const covers = ['最值']
export function construct(slot, seed) {
  const x = 1 + Math.floor(Math.random() * 7)
  return {
    params: { x, y: 2 * x },
    stem: '求 ' + x + ' 的两倍',
    answer: 'y=' + (2 * x),
    goal: '求两倍',
    goals: ['求这个数的两倍'],
    givens: ['一个数 ' + x],
    checks: [{ expr: 'y - 2*x', at: { x, y: 2 * x }, expect: 0 }],
  }
}
`

/** 同一个路径被改写的两版（用来钉住"重交生效的是新代码"） */
const rewriteModule = (tag: string): string => `
export const kind = 'dynamic/rewrite'
export const covers = ['最值']
export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed))
  const x = 1 + (s % 5)
  const shapes = [
    { givens: ['一个数 ' + x], goals: ['求它的两倍'] },
    { givens: ['一个数 ' + x, '再减去 1'], goals: ['求两倍', '求减 1 后的结果'] },
    { givens: ['一个数的两倍是 ' + 2 * x], goals: ['求这个数'] },
  ]
  const shape = shapes[s % 3]
  return {
    params: { x, y: 2 * x },
    stem: '${tag}：求 ' + x + ' 的两倍',
    answer: '${tag}=' + (2 * x),
    givens: shape.givens,
    goals: shape.goals,
    checks: [{ expr: 'y - 2*x', at: { x, y: 2 * x }, expect: 0 }],
  }
}
`

/**
 * 带浮点噪声的检验点（真实被误判过的那种）。
 * 注意它仍然要满足新的验收要求：**三种结构**（换给定、换问法）——
 * 这里三个分支都保留"除不尽 → 代入必然带噪声"的检验点。
 */
const FLOAT_NOISE_MODULE = `
export const kind = 'dynamic/float-noise'
export const covers = ['配方']

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed))
  const k = 1 + (s % 3)
  const x0 = (1 + (s % 5)) / 7
  const b = 2 + (s % 4)
  const y0 = k * x0 + b
  const shapes = [
    { stem: '已知一次函数 $y=kx+b$ 的图象经过点 $(x_{0}, y_{0})$，求 $y_{0}$。', givens: ['$k = ' + k + '$', '$b = ' + b + '$', '$x_{0} = ' + x0 + '$'], goals: ['求 $y_{0}$'] },
    { stem: '已知一次函数 $y=kx+b$ 的图象经过点 $(x_{0}, y_{0})$，判断它是否经过点 $(0, ' + (y0 + 1) + ')$。', givens: ['$k = ' + k + '$', '$x_{0} = ' + x0 + '$', '$b = ' + b + '$'], goals: ['判断是否经过给定点', '说明理由'] },
    { stem: '已知一次函数 $y=kx+b$ 的图象经过点 $(x_{0}, y_{0})$ 和原点，求 $y_{0}$。', givens: ['图象经过原点', '$x_{0} = ' + x0 + '$', '$k = ' + k + '$'], goals: ['求 $y_{0}$', '求这个一次函数的解析式'] },
  ]
  const shape = shapes[s % 3]
  return {
    params: { k, x0, b, y0 },
    stem: shape.stem,
    answer: '$y_{0} = ' + y0 + '$',
    givens: shape.givens,
    goals: shape.goals,
    checks: [{ expr: 'k*x0 + b - y0', at: { k, x0, b, y0 }, expect: 0 }],
  }
}
`

async function boot(): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await ctx.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await ctx.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await ctx.plugin(scopePlugin, { forbid: [] }),
    await ctx.plugin(symbolicPlugin, { tolerance: 1e-6 }),
    await ctx.plugin(dedupPlugin, { maxSimilarity: 0.85, corpusWordingMax: 0.55, corpusNumbersMin: 0.8 }),
    await ctx.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await ctx.plugin(figureGate, { requireFigure: false }),
    await ctx.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await ctx.plugin(dynamicPlugin, { dir: join(workdir, 'constructors'), samples: 30, maxCovers: 6 }),
    await ctx.plugin(paperPlugin, { maxAttempts: 6 }),
  )
  return ctx
}

function writeModule(name: string, source: string): void {
  const dir = join(workdir, 'constructors')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.mjs`), source, 'utf8')
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-dynamic-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('agent 在运行时制作新题型', () => {
  it('外部题型模块被验收、注册，然后真的出题并过闸门入库', async () => {
    writeModule('linear-inequality', GOOD_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.kind === 'dynamic/linear-inequality')
    expect(mine?.ok).toBe(true)
    expect(mine?.covers).toEqual(['一元一次不等式'])

    // 生效后才可能被选题位选中
    expect(ctx.construct.kinds()).toContain('dynamic/linear-inequality')
    const slot = {
      key: 'Z1',
      knowledge: ['一元一次不等式'],
      cognitive: '掌握' as const,
      type: '解答' as const,
      difficulty: [0.6, 0.85] as const,
      score: 10,
      count: 1,
    }
    const item = ctx.construct.generate(slot, 2024)
    expect(item.instance.kind).toBe('dynamic/linear-inequality')
    expect(item.instance.checks !== undefined && item.instance.checks.length > 0).toBe(true)

    // 闸门不认识这个题型，但用框架的求值器核对了检验点 → 入库
    const result = await ctx.bank.submit(item)
    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
    expect(ctx.bank.get(item.id)?.evidence.symbolic?.pass).toBe(true)
  })

  it('检验点无效（怎么改参数都成立）→ 不注册，并说明原因', async () => {
    writeModule('fake-check', FAKE_CHECK_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.kind === 'dynamic/fake-check')
    expect(mine?.ok).toBe(false)
    expect(mine?.problems.join(' ')).toContain('没有在检验')
    expect(ctx.construct.kinds()).not.toContain('dynamic/fake-check')
  })

  it('偷偷调用系统能力 → 静态扫描拦下', async () => {
    writeModule('dangerous', DANGEROUS_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    // 静态扫描发生在加载模块之前，那时只能用文件名当 kind
    const mine = reports.find((report) => report.file.endsWith('dangerous.mjs'))
    expect(mine?.ok).toBe(false)
    expect(mine?.problems.join(' ')).toContain('不允许的调用')
    expect(ctx.construct.kinds()).not.toContain('dynamic/dangerous')
  })

  it('没有检验点 → 无法独立验证，不注册', async () => {
    writeModule('no-check', NO_CHECK_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.kind === 'dynamic/no-check')
    expect(mine?.ok).toBe(false)
    expect(mine?.problems.join(' ')).toContain('checks')
  })

  it('顶层死循环 → 只崩掉验收子进程，报告说清崩在哪一步', async () => {
    writeModule('hang', TOP_LEVEL_HANG_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.file.endsWith('hang.mjs'))
    expect(mine?.ok).toBe(false)
    const problems = mine?.problems.join(' ') ?? ''
    // 说清是**顶层**崩的、崩在什么原因上——agent 要拿这句话去改代码
    expect(problems).toContain('顶层')
    expect(problems).toContain('内存')
    expect(ctx.construct.kinds()).not.toContain('dynamic/hang')
    // 宿主进程还活着，而且没有偷偷注册
    expect(ctx.construct.kinds()).toContain('parabola/roots')
  })

  it('模块声明的结构（goal / givens / 题面公式）原样进 Item——题面公式不许串成答案', async () => {
    writeModule('declared', DECLARED_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    expect(reports.find((report) => report.kind === 'dynamic/declared')?.ok).toBe(true)

    // 用一个**只有这个模块覆盖**的知识点：题位选构造器是"第一个覆盖它的"，
    // 用别的知识点会选到仓库里已有的题型，测的就不是这个模块了
    const item = ctx.construct.generate(
      {
        key: 'Z9',
        knowledge: ['配方'],
        cognitive: '掌握',
        type: '解答',
        difficulty: [0.6, 0.85],
        score: 10,
        count: 1,
      },
      // 种子 9 落在第一种结构（模块按 seed % 3 分支）——测的是字段有没有原样进 Item
      9,
    )
    expect(item.instance.goal).toBe('求 x 的取值范围')
    expect(item.instance.goals).toEqual(['求 x 的取值范围'])
    const params = item.instance.params as { x: number; k: number; c: number }
    expect(item.instance.givens).toEqual([`${String(params.k)}x + 3 > ${String(params.c)}`])
    // 曾经这里把 answerTex 当成题面公式：卷面上会把**答案**印在题干位置
    expect(item.prose.tex?.stem).toBe(`${String(params.k)}x+3>${String(params.c)}`)
    expect(item.prose.tex?.answer).toBe(`x > ${String(params.x)}`)
    expect(item.prose.tex?.stem).not.toBe(item.prose.tex?.answer)
  })
  it('重交同一个路径的题型 → 生效的是新代码（不是缓存里的旧代码）', async () => {
    writeModule('rewrite', rewriteModule('v1'))
    const ctx = await boot()
    await ctx.constructDynamic.loadAll()
    const slot = {
      key: 'Z7',
      knowledge: ['最值'],
      cognitive: '掌握' as const,
      type: '解答' as const,
      difficulty: [0.6, 0.85] as const,
      score: 10,
      count: 1,
    }
    expect(ctx.construct.generate(slot, 3).witness.answer.startsWith('v1')).toBe(true)

    // 同一个文件改写后重交：验收说的是"生效"，那就必须真的生效
    writeModule('rewrite', rewriteModule('v2'))
    const report = await ctx.constructDynamic.loadOne(join(workdir, 'constructors', 'rewrite.mjs'))
    expect(report.ok).toBe(true)
    expect(ctx.construct.generate(slot, 3).witness.answer.startsWith('v2')).toBe(true)
  })
  it('同一种子两次不一样（用了 Math.random）→ 判不确定，不注册', async () => {
    writeModule('random', NONDETERMINISTIC_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.file.endsWith('random.mjs'))
    expect(mine?.ok).toBe(false)
    expect(mine?.problems.join(' ')).toContain('确定性')
    expect(ctx.construct.kinds()).not.toContain('dynamic/random')
  })
  it('检验点的浮点噪声（1e-9 量级）不判错——按相对容差比，别按绝对差比', async () => {
    // 真实被拦的例子：`ks*x0 + b` 算出 1.000000082740371e-9、期望 0，
    // 绝对容差 1e-9 差一点点就判"检验点不成立"——那是量级噪声，不是数学错。
    writeModule('float-noise', FLOAT_NOISE_MODULE)
    const ctx = await boot()
    const reports = await ctx.constructDynamic.loadAll()
    const mine = reports.find((report) => report.kind === 'dynamic/float-noise')
    expect(mine?.ok ? 'ok' : JSON.stringify(mine?.problems)).toBe('ok')

    // 关键一步：**过闸门**（用户看到的报错是闸门给的，不是验收给的）
    const item = ctx.construct.generate(
      { key: 'Z6', knowledge: ['配方'], cognitive: '掌握', type: '解答', difficulty: [0.6, 0.85], score: 4, count: 1 },
      7,
    )
    const result = await ctx.bank.submit(item)
    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })
})
