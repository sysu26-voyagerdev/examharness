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

/** 一个"agent 会写出来"的题型：一元一次不等式（ax + b > c，整数解） */
const GOOD_MODULE = `
export const kind = 'dynamic/linear-inequality'
export const covers = ['一元一次不等式']

export function construct(slot, seed) {
  // 简单确定性伪随机
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const a = 2 + Math.floor(next() * 5)
  const x = -6 + Math.floor(next() * 13)
  const b = -9 + Math.floor(next() * 19)
  const c = a * x + b
  const params = { a, b, c, x }
  return {
    params,
    stem: '解不等式：' + a + 'x + ' + b + ' > ' + c + '。',
    answer: 'x > ' + x,
    answerTex: 'x > ' + x,
    solution: ['移项得 ' + a + 'x > ' + (c - b), '两边同除以 ' + a + ' 得 x > ' + x],
    steps: [
      { text: '移项：' + a + 'x > ' + (c - b), basis: '不等式性质' },
      { text: '两边同除以正数 ' + a + '，不等号方向不变：x > ' + x, basis: '不等式性质' },
    ],
    // 检验点：把解 x 代进去，左边必须正好等于右边（边界成立），
    // 且真正大于 c 的最小整数就是 x（用 x-1 应当不满足）
    checks: [
      { expr: 'a*x + b', at: { a, b, x }, expect: c },
      { expr: '(a*(x-1) + b) - c', at: { a, b, x, c }, expect: -a },
    ],
  }
}
`

/** 作弊模块一：检验点永远成立（把参数怎么改都通过） */
const FAKE_CHECK_MODULE = `
export const kind = 'dynamic/fake-check'
export const covers = ['一元一次不等式']
export function construct(slot, seed) {
  const a = 2 + (seed % 5)
  const x = seed % 7
  return {
    params: { a, x },
    stem: '随便一道题 ' + seed,
    answer: 'x = ' + x,
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
  return { params: { x }, stem: '解 x - ' + x + ' = 0', answer: 'x = ' + x }
}
`

async function boot(): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await ctx.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await ctx.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await ctx.plugin(scopePlugin, { forbid: [] }),
    await ctx.plugin(symbolicPlugin, { tolerance: 1e-9 }),
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
})
