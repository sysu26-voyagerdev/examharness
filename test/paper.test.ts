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
import { checkTex, mathSegments, renderMathInText } from '@examharness/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

/**
 * 组卷测试。测的是「试卷=测量仪器」那三条：
 *   - 配额必须凑齐，凑不齐要**报缺口**（不许静默少给题）；
 *   - 结构性违规不重试（超纲是蓝图的问题，不是运气问题）；
 *   - 组卷可复现、且幂等（同蓝图同种子 → 同卷子，不重复入库）。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = learnedClosure(['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值'])
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

/** 第二个题型：和第一条构造器覆盖同样的题位（用来测"这个题位该用哪个题型"） */
function secondKind(): { name: string; apply(ctx: Context): void } {
  return {
    name: 'second-kind',
    apply(ctx: Context): void {
      ctx.inject(['construct'], (scope) => {
        const construct = scope.construct
        scope.construct.register(
          'second/roots',
          (slot, seed) => {
            // 借用第一条构造器造出来的结构，只把题型名换掉：
            // 这样"卷面上用的哪个题型"可以从 instance.kind 上看出来
            const base = construct.generate({ ...slot, key: `${slot.key}--x`, count: 1 }, seed)
            const { a, r1, r2 } = base.instance.params
            return {
              ...base,
              id: `${base.id}-2nd`,
              // 符号闸门对不认识的题型是 fail-closed 的：新题型必须自带可独立复算的检验点
              instance: {
                ...base.instance,
                kind: 'second/roots',
                checks: [
                  { expr: `${String(a)}*(x-(${String(r1)}))*(x-(${String(r2)}))`, at: { x: Number(r1) }, expect: 0 },
                ],
              },
            }
          },
          ['与坐标轴交点', '对称轴', '顶点式'],
        )
      })
    },
  }
}

describe('组卷', () => {
  it('**卷子自己记住题位用的题型**：agent 新写的题型不会被"先注册的那个"顶掉', async () => {
    const ctx = await boot()
    await ctx.plugin(secondKind())
    // 不指定：按注册顺序，用的是先注册的那条
    const plain = await ctx.paper.assemble(blueprint, { nonce: 'n1' })
    const first = ctx.bank.get(plain.slots[0]?.itemId ?? '')
    expect(first?.instance.kind).toBe('parabola/roots')

    // 指定（等价于"上一版这个题位用的是它"）：换题型出，但仍然**现造**
    const preferred = await ctx.paper.assemble(blueprint, {
      nonce: 'n2',
      preferredKinds: { [plain.slots[0]?.key ?? '']: 'second/roots' },
    })
    const second = ctx.bank.get(preferred.slots[0]?.itemId ?? '')
    expect(second?.instance.kind).toBe('second/roots')
    // 现造：换了题型也是新的一道（不是把库里的捞回来）
    expect(second?.id).not.toBe(first?.id)
  })

  it('按蓝图凑齐题位，并由易到难排序、分值对得上', async () => {
    const ctx = await boot()
    const paper = await ctx.paper.assemble(blueprint)

    expect(paper.gaps).toHaveLength(0)
    expect(paper.slots.map((slot) => slot.key)).toEqual(blueprint.blueprint.map((row) => `${row.key}-1`))
    expect(paper.totalScore).toBe(blueprint.paper.totalScore)
    // 卷头分数与题位合计一致时，不该有差额（差额是"卷头写了更多分"才出现的）
    expect(paper.scoreGap).toBe(0)

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

  it('同一次组卷可复现（给同一个 nonce，出同一张卷、不重复入库）', async () => {
    const ctx = await boot()
    const seeds = { 'S1-1': [11], 'S2-1': [21] }
    const first = await ctx.paper.assemble(blueprint, { seeds, nonce: 'fixed' })
    const countAfterFirst = ctx.bank.all().length
    const second = await ctx.paper.assemble(blueprint, { seeds, nonce: 'fixed' })

    expect(first.order).toEqual(second.order)
    expect(ctx.bank.all()).toHaveLength(countAfterFirst)
    expect(second.gaps).toHaveLength(0)
  })

  it('再出一版要**现造新题**，不是把上次那批捞回来（这是"原创卷"的底线）', async () => {
    const ctx = await boot()
    const first = await ctx.paper.assemble(blueprint, { nonce: 'round-1' })
    const second = await ctx.paper.assemble(blueprint, { nonce: 'round-2' })

    expect(first.gaps).toHaveLength(0)
    expect(second.gaps).toHaveLength(0)
    // 两次组卷的题目不能是同一批
    const sameIds = first.order.filter((id) => second.order.includes(id))
    expect(sameIds).toHaveLength(0)
    // 卷子里的每一道都是**各自那次**造的，题库随之长大（历史留痕，不当零件仓库）
    expect(ctx.bank.all().length).toBe(first.order.length + second.order.length)
  })
})

/**
 * 构造器给出的 LaTeX 必须**真的能渲染**。
 * 踩过的坑：模板字符串里写 `\right` 会被当成转义（`\r` 是回车），
 * 结果公式悄悄变成 `ight|`，编译还照样"成功"——这种错只能靠断言挡住。
 */
describe('题面里的 LaTeX', () => {
  it('构造器给出的公式没有转义残留，且都能编译', async () => {
    const ctx = await boot()
    const row = blueprint.blueprint[0]
    if (row === undefined) throw new Error('蓝图是空的')
    const built = ctx.construct.generate({ ...row, key: 'S1-tex', count: 1 }, 42)
    // 数学写在**正文**里（行内 $…$）：这里查的就是学生看到的那几段
    const fragments = [
      ...mathSegments(built.prose.stem),
      ...mathSegments(built.prose.answerText),
      ...built.prose.solution.flatMap((step) => mathSegments(step)),
      // 老题里可能还带着"公式层"：留着的也得编译得过
      ...(built.prose.tex?.stem === undefined ? [] : [built.prose.tex.stem]),
      ...(built.prose.tex?.answer === undefined ? [] : [built.prose.tex.answer]),
      ...(built.prose.tex?.solution ?? []),
    ]
    expect(fragments.length).toBeGreaterThan(0)

    for (const fragment of fragments) {
      // 控制字符 = 反斜杠被吃掉过（`\r` 会变成回车）
      const hasControl = [...fragment].some((char) => char.charCodeAt(0) < 32)
      expect(hasControl).toBe(false)
      expect(checkTex(fragment).ok).toBe(true)
    }
    // 反斜杠还活着：既要有真正的命令，又不能出现"被吃掉反斜杠"的裸词
    const joined = fragments.join(' ')
    expect(joined).toContain('\\left')
    expect(joined).not.toMatch(/(?<!\\)(dfrac|left|right|quad|cdot)/)

    // 正文里嵌的数学也要能渲染（界面用 KaTeX HTML；导出那版用 MathML）
    expect(renderMathInText('求 $x_{1} = 3$ 与 $y = x^{2}$')).toContain('class="katex"')
    expect(renderMathInText('求 $x_{1} = 3$', 'mathml')).toContain('<math')
  })
})
