import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, Item } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as algebraPlugin from '@examharness/plugin-construct-algebra'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as paperPlugin from '@examharness/plugin-paper'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 新构造器（代数与统计）的验收测试。**这里是"严格验收"的落点**：
 *   1. 每个题型都能构造出题，并且**真的过一遍闸门链**入库（不是只跑构造器）；
 *   2. 常见种子批量构造：不能崩、不能重复、答案要自洽（用闸门的独立校验兜底）；
 *   3. **对抗性检查**：把参数改坏（比如把根挪一位、把 k 改掉），闸门必须拦下——
 *      这一条才证明"验证是独立的"，而不是构造器自说自话。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = [
  '实数运算', '实数与二次根式', '整式运算', '整式与因式分解', '一元一次不等式',
  '一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点',
  '最值', '一元二次方程', '反比例函数', '统计与概率',
]
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprints/作业-二次函数.json'), 'utf8')) as Blueprint

const fibers: Fiber[] = []
let workdir = ''

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
    await ctx.plugin(algebraPlugin, { maxValue: 12 }),
    await ctx.plugin(paperPlugin, { maxAttempts: 6 }),
  )
  return ctx
}

/** 每个新题型：知识词 → 期望的构造器 */
const CASES: readonly { knowledge: string; kind: string }[] = [
  { knowledge: '实数与二次根式', kind: 'radical/simplify' },
  { knowledge: '整式与因式分解', kind: 'factor/quadratic' },
  { knowledge: '一元二次方程', kind: 'equation/quadratic' },
  { knowledge: '一次函数', kind: 'linear/two-points' },
  { knowledge: '反比例函数', kind: 'inverse/point' },
  { knowledge: '统计与概率', kind: 'stats/mean' },
]

function slotFor(knowledge: string, key: string): Blueprint['blueprint'][number] {
  const row = blueprint.blueprint[0]
  if (row === undefined) throw new Error('蓝图是空的')
  return { ...row, key, knowledge: [knowledge] }
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-algebra-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('新构造器：代数与统计', () => {
  it('六个题型都能构造，并且真的过闸门入库', async () => {
    const ctx = await boot()
    const submitted = await Promise.all(
      CASES.map(async (entry, index) => {
        const slot = slotFor(entry.knowledge, `A${String(index + 1)}`)
        const item = ctx.construct.generate(slot, 1000 + index)
        return { entry, item, result: await ctx.bank.submit(item) }
      }),
    )
    for (const { entry, item, result } of submitted) {
      expect(item.provenance.constructor.startsWith(entry.kind)).toBe(true)
      // 没通过就把原因打出来（否则只看到 false，不知道哪道闸门拦的）
      expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
      expect(item.prose.stem.length).toBeGreaterThan(6)
      expect(item.witness.steps.length).toBeGreaterThan(0)
    }
    expect(ctx.bank.all()).toHaveLength(CASES.length)
  })

  it('批量构造：同种子可复现、不同种子有差异、不崩', async () => {
    const ctx = await boot()
    const slot = slotFor('一元二次方程', 'B1')
    const first = ctx.construct.generate(slot, 7)
    const again = ctx.construct.generate(slot, 7)
    expect(again.id).toBe(first.id)
    expect(again.witness.answer).toBe(first.witness.answer)

    const ids = new Set<string>()
    for (let seed = 1; seed <= 60; seed += 1) {
      const item = ctx.construct.generate(slot, seed)
      ids.add(item.id)
    }
    // 60 个种子至少造出 30 种不同的题（退化太多说明参数空间太小）
    expect(ids.size).toBeGreaterThan(30)
  })

  it('对抗性检查：把参数改坏，闸门必须拦下（证明验证是独立的）', async () => {
    const ctx = await boot()
    const cases: readonly { knowledge: string; kind: string; tamper: (params: Record<string, number>) => void }[] = [
      { knowledge: '一元二次方程', kind: 'equation/quadratic', tamper: (p) => { p.r1 = (p.r1 ?? 0) + 1 } },
      { knowledge: '一次函数', kind: 'linear/two-points', tamper: (p) => { p.k = (p.k ?? 0) + 1 } },
      { knowledge: '反比例函数', kind: 'inverse/point', tamper: (p) => { p.k = (p.k ?? 0) + 3 } },
      { knowledge: '整式与因式分解', kind: 'factor/quadratic', tamper: (p) => { p.product = (p.product ?? 0) + 1 } },
      { knowledge: '实数与二次根式', kind: 'radical/simplify', tamper: (p) => { p.outside = (p.outside ?? 0) + 1 } },
      { knowledge: '统计与概率', kind: 'stats/mean', tamper: (p) => { p.mean = (p.mean ?? 0) + 1 } },
    ]

    // 先并发提交，再逐个断言（同一个 ctx：篡改后的题会先被 symbolic 拦下，走不到查重）
    const results = await Promise.all(
      cases.map(async (entry, index) => {
        const slot = slotFor(entry.knowledge, `C${String(index + 1)}`)
        const good = ctx.construct.generate(slot, 2000 + index)
        const broken: Item = structuredClone(good)
        entry.tamper(broken.instance.params as Record<string, number>)
        return { kind: entry.kind, result: await ctx.bank.submit(broken) }
      }),
    )
    for (const entry of results) {
      expect(entry.result.ok ? `没拦住（${entry.kind}）` : 'ok').toBe('ok')
    }
    // 一条都不该入库
    expect(ctx.bank.all()).toHaveLength(0)
  })
})
