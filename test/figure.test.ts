import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, FunctionGraphSpec, Item } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { signedByAll } from '@examharness/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

/**
 * 图形测试。核心是两句话：
 *   - **数据同源**：图由 spec 的系数算出，渲染器不解析任何字符串；
 *   - **断言不过不许入库**：几何不一致 / 点挤成一个点 / 越界 → 第四道闸门拦下。
 * 这条闸门把"图与题干不一致"从概率问题变成可判定问题。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = learnedClosure(['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值'])
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

/** 取蓝图第 index 行（不用 as never，让类型检查真的生效） */
function row(index: number): BlueprintRow {
  const found = blueprint.blueprint[index]
  if (found === undefined) throw new Error(`蓝图缺少第 ${index} 行`)
  return found
}

const fibers: Fiber[] = []
let workdir = ''

async function boot(): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
  )
  return context
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-figure-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

// FigureSpec 现在是联合类型（函数图 / 平面几何），这里明确是函数图那支
const specOf = (
  quadratics: FunctionGraphSpec['quadratics'],
  points: FunctionGraphSpec['points'],
  domain: readonly [number, number],
): FunctionGraphSpec => ({
  kind: 'function-graph',
  quadratics,
  domain,
  points,
})

describe('图形渲染与第四道闸门', () => {
  it('构造出来的题自带合规的图，四审全绿', async () => {
    const ctx = await boot()
    const item = ctx.construct.generate(row(0), 42)

    const artifact = ctx.figure.render(item.figure?.spec as FunctionGraphSpec)
    expect(artifact.svg).toContain('<polyline')
    expect(artifact.assertions.pointsOnCurve).toBe(true)
    expect(artifact.assertions.distinctPoints).toBe(true)
    expect(artifact.assertions.insidePlot).toBe(true)

    const result = await ctx.bank.submit(item)
    expect(result.ok).toBe(true)
    const stored = ctx.bank.all()[0]
    expect(stored?.evidence.figure?.pass).toBe(true)
    expect(Object.keys(stored?.evidence ?? {})).toEqual(
      expect.arrayContaining(['symbolic', 'scope', 'dedup', 'figure']),
    )
  })

  it('题面说「如图」却没有图 → 拦下（库里真实有 124 道这种做不了的题）', async () => {
    const ctx = await boot()
    const base = ctx.construct.generate(row(0), 42)
    // 把图拿掉，题面却还在指图
    const { figure: _dropped, ...rest } = base
    const item: Item = {
      ...rest,
      prose: { ...rest.prose, stem: `如图，${rest.prose.stem}` },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-figure')
    expect(result.ok ? '' : result.verdict.reason).toContain('没有图')
  })

  it('没有图、题面也没提图 → 不拦（不是所有题都要图）', async () => {
    const ctx = await boot()
    const base = ctx.construct.generate(row(0), 42)
    const { figure: _dropped, ...rest } = base
    const result = await ctx.bank.submit(rest)
    expect(result.ok).toBe(true)
  })

  it('闸门判据升级后，**老签字自动失效**（旧题会被重新送审）', async () => {
    const ctx = await boot()
    const item = ctx.construct.generate(row(0), 42)
    const stored = await ctx.bank.submit(item)
    expect(stored.ok).toBe(true)
    const gates = ctx.bank.gates?.() ?? []
    const figure = gates.find((gate) => gate.name === 'figure')
    expect(figure?.rule).toBeGreaterThan(1)

    const signed = ctx.bank.all()[0]
    if (signed === undefined) throw new Error('没入库')
    // 现在的签字带着规则版本 → 有效
    expect(signedByAll(signed, gates)).toBe(true)
    // 当年那版规则（没有 rule 字段）→ 无效：这就是"闸门加判据后旧题必须重新过一遍"
    const legacy: Item = { ...signed, evidence: { ...signed.evidence, figure: { pass: true } } }
    expect(signedByAll(legacy, gates)).toBe(false)
  })

  it('点挤成一个点 → distinctPoints 断言失败，闸门拦下', async () => {
    const ctx = await boot()
    // 两根相差 0.01：数学上没问题，但图上就是一个点 → 图形规范不许
    const spec = specOf([{ a: 1, b: -2, c: 1.0000001 }], [
      { label: 'A', x: 0.995, y: 0 },
      { label: 'B', x: 1.005, y: 0 },
    ], [-1, 3])
    expect(ctx.figure.render(spec).assertions.distinctPoints).toBe(false)

    const base = ctx.construct.generate(row(0), 7)
    const item: Item = { ...base, figure: { spec, renderer: 'template' } }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-figure')
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('标注的点不在曲线上 → pointsOnCurve 断言失败', async () => {
    const ctx = await boot()
    const spec = specOf([{ a: 1, b: -4, c: 3 }], [
      { label: 'A', x: 1, y: 0 },
      { label: 'B', x: 3, y: 1 }, // 假点：f(3) = 0 ≠ 1
    ], [-1, 5])
    const artifact = ctx.figure.render(spec)

    expect(artifact.assertions.pointsOnCurve).toBe(false)
    expect(artifact.assertions.distinctPoints).toBe(true)
  })
})
