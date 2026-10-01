import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as graphPlugin from '@examharness/plugin-graph'
import * as paperPlugin from '@examharness/plugin-paper'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 组卷测试。测的是「试卷=测量仪器」那三条：
 *   - 配额必须凑齐，凑不齐要**报缺口**（不许静默少给题）；
 *   - 结构性违规不重试（超纲是蓝图的问题，不是运气问题）；
 *   - 组卷可复现、且幂等（同蓝图同种子 → 同卷子，不重复入库）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

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
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(paperPlugin, { maxAttempts: 6 }),
  )
  return context
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-paper-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('组卷', () => {
  it('按蓝图凑齐题位，并由易到难排序、分值对得上', async () => {
    const ctx = await boot()
    const paper = await ctx.paper.assemble(blueprint)

    expect(paper.gaps).toHaveLength(0)
    expect(paper.slots.map((slot) => slot.key)).toEqual(['S1-1', 'S2-1'])
    expect(paper.totalScore).toBe(20)
    expect(paper.scoreGap).toBe(blueprint.paper.totalScore - 20)

    const mids = paper.order.map((id) => {
      const item = ctx.bank.get(id)
      if (item === undefined) throw new Error(`题目 ${id} 不在库里`)
      return (item.slot.difficulty[0] + item.slot.difficulty[1]) / 2
    })
    expect(mids).toEqual(mids.toSorted((a, b) => a - b))
    expect(ctx.paper.current()?.order).toEqual(paper.order)
  })

  it('蓝图要了未学的知识点 → 报缺口，不静默少给题', async () => {
    const ctx = await boot()
    const illegal: Blueprint = {
      ...blueprint,
      blueprint: [
        // 对称轴是构造器覆盖的，动点问题是未学的 → 由 scope 闸门拦下
        { key: 'X1', knowledge: ['对称轴', '动点问题'], cognitive: '灵活运用', type: '解答', count: 2, difficulty: [0.5, 0.7], score: 10 },
      ],
    }
    const paper = await ctx.paper.assemble(illegal)

    expect(paper.slots).toHaveLength(0)
    expect(paper.gaps).toHaveLength(2)
    expect(paper.gaps.every((gap) => gap.missing === 1)).toBe(true)
    // 结构性违规只试一次：换种子救不了超纲
    expect(paper.attempts).toBe(2)
    expect(paper.gaps[0]?.reason).toContain('verify')
  })

  it('组卷幂等：同蓝图同种子，不重复入库', async () => {
    const ctx = await boot()
    const seeds = { 'S1-1': [11], 'S2-1': [21] }
    const first = await ctx.paper.assemble(blueprint, { seeds })
    const countAfterFirst = ctx.bank.all().length
    const second = await ctx.paper.assemble(blueprint, { seeds })

    expect(first.order).toEqual(second.order)
    expect(ctx.bank.all()).toHaveLength(countAfterFirst)
    expect(second.gaps).toHaveLength(0)
  })
})
