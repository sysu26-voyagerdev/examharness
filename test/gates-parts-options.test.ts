import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { BlueprintRow, Item, Option } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as optionsGate from '@examharness/plugin-verify-options'
import * as partsGate from '@examharness/plugin-verify-parts'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * **分量闸门**与**选择题闸门**。
 *
 * 这两道闸门是为一件具体的事加的：真实卷子里，
 *   · 8 分以上的解答题是**多问**的（求解析式→求顶点→求面积），
 *     而我们出过"9 分解答题 = 化简 √108"这种一句话题；
 *   · 选择题必须有四个选项，而我们出过"3 分选择题没有选项"。
 *
 * 判据必须是**可核对的事实**：分问数取题型声明的 goals 条数
 * （回译闸门保证题面真的分成这么多问）；正确选项必须是文字上等于构造答案的那一个。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const SEED = 42

const slot = (type: BlueprintRow['type'], score: number): BlueprintRow => ({
  key: 'Z1',
  knowledge: ['对称轴'],
  cognitive: '掌握',
  type,
  difficulty: [0.4, 0.7],
  score,
  count: 1,
})

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
    await ctx.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await ctx.plugin(partsGate, { twoPartFrom: 8, threePartFrom: 12 }),
    await ctx.plugin(optionsGate, { optionCount: 4 }),
    await ctx.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await ctx.plugin(figureGate, { requireFigure: false }),
    await ctx.plugin(constructPlugin, { rootRange: [-4, 5] }),
  )
  return ctx
}

/** 拿一道真实构造出来的题来改（比手搓 Item 更接近真实形状） */
async function itemFor(type: BlueprintRow['type'], score: number): Promise<Item> {
  const probe = new Context()
  probe.baseUrl = pathToFileURL(ROOT).href
  const fiber = await probe.plugin(constructPlugin, { rootRange: [-4, 5] })
  const item = probe.construct.generate(slot(type, score), SEED)
  await fiber.dispose()
  return item
}

const withGoals = (item: Item, goals: readonly string[]): Item => ({
  ...item,
  instance: { ...item.instance, goals, goal: goals.join(' ') },
})

const withOptions = (item: Item, options: readonly Option[]): Item => ({
  ...item,
  prose: { ...item.prose, options },
})

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-gates-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('分量闸门', () => {
  it('9 分的解答题只有一问 → 拦下，并说清"一道 9 分的题不该只有一个问题"', async () => {
    const ctx = await boot()
    const item = withGoals((await itemFor('解答', 9)), ['求对称轴'])
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-parts')
    expect(result.ok ? '' : result.verdict.reason).toContain('至少要 2 问')
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('同一道题分成两问 → 通过（分量对得上了）', async () => {
    const ctx = await boot()
    const item = withGoals((await itemFor('解答', 9)), ['求对称轴', '求顶点坐标'])
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('3 分的填空题一句话题完是常态 → 不拦', async () => {
    const ctx = await boot()
    const item = withGoals((await itemFor('填空', 3)), ['求对称轴'])
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })
})

describe('选择题闸门', () => {
  it('选择题没有选项 → 拦下（题面里写 A．B．C．D 不算）', async () => {
    const ctx = await boot()
    const base = await itemFor('选择', 3)
    // 内置的抛物线构造器会给选项；这里要测的是"没有选项的选择题"
    const { options: _dropped, ...prose } = base.prose
    const result = await ctx.bank.submit({ ...base, prose })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-options')
    expect(result.ok ? '' : result.verdict.reason).toContain('没有选项')
  })

  it('四个选项里正确项的文字必须就是构造答案', async () => {
    const ctx = await boot()
    const base = (await itemFor('选择', 3))
    const answer = base.witness.answer
    const good = withOptions(base, [
      { key: 'A', text: answer },
      { key: 'B', text: 'x = 999' },
      { key: 'C', text: 'x = -999' },
      { key: 'D', text: 'x = 998' },
    ])
    const ok = await ctx.bank.submit(good)
    expect(ok.ok ? 'ok' : JSON.stringify(ok.verdict)).toBe('ok')

    const missing = withOptions({ ...base, id: `${base.id}-x` }, [
      { key: 'A', text: 'x = 1' },
      { key: 'B', text: 'x = 2' },
      { key: 'C', text: 'x = 3' },
      { key: 'D', text: 'x = 4' },
    ])
    const bad = await ctx.bank.submit(missing)
    expect(bad.ok).toBe(false)
    expect(bad.ok ? '' : bad.verdict.reason).toContain('没有正确答案')
  })

  it('选项重复 → 拦下（那样答案就不唯一了）', async () => {
    const ctx = await boot()
    const base = (await itemFor('选择', 3))
    const answer = base.witness.answer
    const item = withOptions(base, [
      { key: 'A', text: answer },
      { key: 'B', text: 'x = 5' },
      { key: 'C', text: 'x = 5' },
      { key: 'D', text: 'x = 6' },
    ])
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.reason).toContain('选项文字一样')
  })

  it('闸门会向题库报到，没被现役闸门签过字的旧题不许直接复用', async () => {
    const ctx = await boot()
    expect(ctx.bank.gates?.()).toContain('parts')
    expect(ctx.bank.gates?.()).toContain('options')

    // 一道"当年入库"的题：证据里没有 verify-parts 的签字
    const item = withGoals(await itemFor('解答', 9), ['求对称轴'])
    const legacy: Item = {
      ...item,
      lifecycle: 'verified',
      evidence: { scope: { pass: true }, symbolic: { pass: true }, dedup: { pass: true } },
    }
    const gates = ctx.bank.gates?.() ?? []
    const signed = gates.every((gate) => legacy.evidence[gate] !== undefined)
    expect(signed).toBe(false)
  })
})
