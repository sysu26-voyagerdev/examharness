import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item, Verdict } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

/**
 * 闸门链的集成测试。AGENTS.md：**闸门逻辑必须有测试**——它是本项目的正确性所在。
 * 这里测的不是"函数返回什么"，而是两条不变式：
 *   R2  没经过闸门的题进不了库，也不落盘；
 *   宁缺勿错  不认识的构造器一律不通过（fail closed）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = learnedClosure([
  '一次函数',
  '配方',
  '图象平移',
  '二次函数图象',
  '顶点式',
  '对称轴',
  '与坐标轴交点',
  '最值',
])

const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

const fibers: Fiber[] = []
let workdir = ''
let bankPath = ''

function slot(key: string): BlueprintRow {
  const row = blueprint.blueprint.find((entry) => entry.key === key)
  if (row === undefined) throw new Error(`蓝图里没有题位 ${key}`)
  return row
}

async function boot(): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: bankPath }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
  )
  return context
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-'))
  bankPath = join(workdir, 'bank.jsonl')
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('闸门链', () => {
  it('正常路径：构造 → 三审 → 入库，证据齐全', async () => {
    const ctx = await boot()
    const item = ctx.construct.generate(slot('S1'), 42)
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(true)
    const stored = ctx.bank.all()[0]
    expect(stored?.lifecycle).toBe('verified')
    expect(stored?.evidence.symbolic?.pass).toBe(true)
    expect(stored?.evidence.scope?.pass).toBe(true)
    expect(stored?.evidence.dedup?.pass).toBe(true)
    // 构造出来的实参必须能代入验证（R1：真值来自构造与符号计算）
    expect(stored?.witness.answer).toContain('AB =')
  })

  it('超纲题被拦下，且什么都不落盘（R2）', async () => {
    const ctx = await boot()
    // 构造器本身会拒绝不覆盖的题位，所以这里直接篡改它"声称"的知识点：
    // 模拟 agent 用未学知识命题，闸门必须拦住
    const illegal = { ...ctx.construct.generate(slot('S1'), 7), slot: { ...slot('S1'), key: 'S9', knowledge: ['动点问题'] } }
    const result = await ctx.bank.submit(illegal)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-scope')
    expect(ctx.bank.all()).toHaveLength(0)
    expect(existsSync(bankPath)).toBe(false)
  })

  it('撞题被拦下：同一题位、同一构造参数', async () => {
    const ctx = await boot()
    const first = await ctx.bank.submit(ctx.construct.generate(slot('S1'), 99))
    expect(first.ok).toBe(true)

    const again = await ctx.bank.submit(ctx.construct.generate(slot('S1'), 99))
    expect(again.ok).toBe(false)
    expect(again.ok ? '' : again.verdict.gate).toBe('verify-dedup')
    expect(ctx.bank.all()).toHaveLength(1)
  })

  it('不认识的构造器 fail closed：不得入库', async () => {
    const ctx = await boot()
    const item: Item = { ...ctx.construct.generate(slot('S1'), 5), instance: { kind: 'parabola/legendre', params: { a: 1 }, givens: [], goal: 'x' } }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-symbolic')
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('被拦下时发出 item:rejected，供界面与轨迹记录', async () => {
    const ctx = await boot()
    const seen: Verdict[] = []
    ctx.on('item:rejected', ({ verdict }) => {
      seen.push(verdict)
    })
    const illegal = { ...ctx.construct.generate(slot('S1'), 3), slot: { ...slot('S1'), key: 'S9', knowledge: ['实际问题建模'] } }
    await ctx.bank.submit(illegal)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.pass).toBe(false)
  })

  it('同一种子 + 同一构造器版本 = 同一道题（可复现）', async () => {
    const ctx = await boot()
    const a = ctx.construct.generate(slot('S1'), 2026)
    const b = ctx.construct.generate(slot('S1'), 2026)
    expect(a.id).toBe(b.id)
    expect(a.instance.params).toEqual(b.instance.params)
  })
})
