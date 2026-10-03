import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, LlmMessage, LlmReply } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as paperPlugin from '@examharness/plugin-paper'
import * as sessionPlugin from '@examharness/plugin-session'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as partsGate from '@examharness/plugin-verify-parts'
import * as roundtripPlugin from '@examharness/plugin-verify-roundtrip'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import * as workbenchPlugin from '@examharness/plugin-workbench'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

/**
 * 口述出题测试（一次调用把话变成题位 → 现造 → 过闸门入库）。
 *
 * 用假模型，验的是**形状与态度**，不是"模型聪不聪明"：
 *   - 说出的话真的变成了一道过了闸门的题（不是从题库里翻出来的旧题）；
 *   - 图谱里没有的说法、还没学过的知识点，**如实说出来**，不硬凑一道别的题塞给老师；
 *   - 造不出来时不装作成功，要给出"试过什么、被哪道闸门拦下"。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = learnedClosure(['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值'])
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

const fibers: Fiber[] = []
let workdir = ''

/**
 * 假模型：翻译官（把老师的话变成题位）、执笔者（照构造的结构写题面）、
 * 题面解析器（回译闸门把题面读回结构）三个角色各司其职。
 *
 * 解析器要**真的读题面**（数字从题面里抠出来），否则回译闸门就白设了——
 * 测试里也必须让"题面里飘着构造没有的数字"这件事真的被抓到。
 */
function fakeChat(
  spec: Record<string, unknown>,
  writer: (brief: Record<string, unknown>) => string = () => '',
  count?: { writer: number },
) {
  // 执笔者写的时候把结构记下来，解析器读的时候给出同一份（等价于"读懂了题面"）
  let stash: { goals: readonly string[]; givens: number; answer: string } = { goals: [], givens: 0, answer: '' }
  return (messages: readonly LlmMessage[]): LlmReply => {
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const last = messages.at(-1)?.content ?? ''
    if (system.includes('你是命题组的执笔者')) {
      if (count !== undefined) count.writer += 1;
      // 口述出题时，老师的原话会**接在简报后面**（执笔者要照他的说法写情境）
      const brief = JSON.parse(last.split('\n\n老师原话：')[0] ?? '{}') as {
        答案?: string
        问几问?: string[]
        条件?: string[]
      }
      stash = { goals: brief.问几问 ?? [], givens: (brief.条件 ?? []).length, answer: brief.答案 ?? '' }
      return {
        content: JSON.stringify({
          // 假题面里的数字一律抹掉：省得"题面里飘着构造没有的数字"这条规则
          // 在别的用例里随机触发（那条规则本身有一条专门的用例在测）
          stem:
            `某地有一座拱桥，桥拱的形状是一条抛物线。${(brief.问几问 ?? [])
              .map((goal, index) => `（${String(index + 1)}）${goal.replace(/\d+/g, 'n')}`)
              .join('；')}` + writer(brief),
          answerText: brief.答案 ?? '',
          solution: ['由构造得到的结论'],
        }),
        toolCalls: [],
      }
    }
    if (system.includes('你是题面解析器')) {
      // 数字**从题面里真的抠出来**：构造没给的数字要被发现（这是回译闸门的活）
      const numbers = [...new Set(last.match(/\d+(?:\.\d+)?/g) ?? [])]
      return {
        content: JSON.stringify({ goals: stash.goals, givensCount: stash.givens, answer: stash.answer, numbers }),
        toolCalls: [],
      }
    }
    // 翻译官：把老师的话变成题位
    if (system.includes('你负责把他的一句话变成**题位**')) {
      return { content: JSON.stringify(spec), toolCalls: [] }
    }
    return { content: '好。', toolCalls: [] }
  }
}

async function boot(chat: (messages: readonly LlmMessage[]) => LlmReply, configured = true): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin({
      name: 'fake-llm',
      apply(ctx: Context): void {
        ctx.provide('llm', { configured, model: 'fake-writer', chat: async (messages: readonly LlmMessage[]) => chat(messages) })
      },
    }),
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: ['动点问题', '圆的切线'] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(partsGate, { twoPartFrom: 8, threePartFrom: 12 }),
    await context.plugin(roundtripPlugin, { strict: true }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(workbenchPlugin, { extraRules: '' }),
  )
  return context
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-compose-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('口述出题', () => {
  it('一句话变成一道现造的题：过了闸门才收下，来源是构造', async () => {
    const ctx = await boot(
      fakeChat({ knowledge: ['对称轴'], type: '解答', score: 6, difficulty: [0.6, 0.8], note: '一道二次函数解答题' }),
    )
    const result = await ctx.workbench.compose?.('出一道二次函数的解答题，求对称轴，6 分')

    expect(result?.ok).toBe(true)
    expect(result?.spec?.knowledge).toEqual(['对称轴'])
    expect(result?.items.length).toBeGreaterThan(0)
    const item = result?.items[0]
    expect(item?.id).toBeDefined()
    // 收下的题真的在题库里，而且每道现役闸门都签过字
    expect(ctx.bank.get(item?.id ?? '')).toBeDefined()
    expect(Object.keys(item?.evidence ?? {}).length).toBeGreaterThan(0)
    // 现造：来源是题型 + 种子，不是"从库里挑的"
    expect(item?.provenance.constructor).not.toBe('')
    expect(item?.prose.stem).toContain('拱桥')
    expect(ctx.bank.all()).toHaveLength(result?.items.length ?? 0)
  })

  it('规格造不出来时降一档再试，并把降了什么说清楚（不许偷偷降）', async () => {
    // 10 分的解答题至少要 2 问，而这个题型只出得了一问 → 降到 6 分才出得来
    const ctx = await boot(
      fakeChat({ knowledge: ['与坐标轴交点'], type: '解答', score: 10, difficulty: [0.6, 0.8], note: '' }),
    )
    const result = await ctx.workbench.compose?.('出一道 10 分的二次函数解答题')

    expect(result?.ok).toBe(true)
    expect(result?.items[0]?.slot.score).toBe(6)
    expect(result?.adjusted).toContain('10 分')
    expect(result?.adjusted).toContain('6 分')
    expect(ctx.bank.get(result?.items[0]?.id ?? '')).toBeDefined()
  })

  it('结构上就站不住的候选不会被白写一遍题面（预检不花模型调用）', async () => {
    // 10 分的解答题至少要 2 问，而这个题型只出得了一问：这一档**一道都不该拿去写题面**
    const calls = { writer: 0 }
    const ctx = await boot(
      fakeChat({ knowledge: ['与坐标轴交点'], type: '解答', score: 10, difficulty: [0.6, 0.8], note: '' }, () => '', calls),
    )
    const result = await ctx.workbench.compose?.('出一道 10 分的二次函数解答题')

    // 只有降规格之后那一道写了题面：预检替我们省掉了别的模型调用（时间就是老师的等待）
    expect(calls.writer).toBe(1)
    expect(result?.ok).toBe(true)
    expect(result?.items[0]?.slot.score).toBe(6)
  })

  it('图谱里没有的说法、还没学过的知识点，如实说出来，不硬凑一道别的题', async () => {
    const ctx = await boot(
      fakeChat({ knowledge: ['动点问题'], type: '解答', score: 10, difficulty: [0.6, 0.8], note: '一道动点题' }),
    )
    const result = await ctx.workbench.compose?.('出一道动点问题的压轴题')

    expect(result?.ok).toBe(false)
    expect(result?.items).toHaveLength(0)
    expect(result?.reason).toContain('动点问题')
    expect(result?.reason).toContain('还没学过')
    // 一道题都没入库：不许"造一道差不多的"顶替
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('说不出图谱里的知识点时，明说认不出来（而不是随便挑一个）', async () => {
    const ctx = await boot(fakeChat({ knowledge: ['量子力学'], type: '选择', score: 3, difficulty: [0.6, 0.7], note: '' }))
    const result = await ctx.workbench.compose?.('出一道量子力学的题')

    expect(result?.ok).toBe(false)
    expect(result?.spec?.unresolved).toContain('量子力学')
    expect(result?.spec?.knowledge).toHaveLength(0)
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('现造被抓时如实报出"试过什么、被哪道闸门拦下"，并给出交给 agent 的活', async () => {
    // 执笔者在题面里塞一个构造没给过的数字 → 回译闸门拦下
    const ctx = await boot(
      fakeChat(
        { knowledge: ['与坐标轴交点'], type: '解答', score: 10, difficulty: [0.6, 0.8], note: '' },
        () => '这座桥全长 999 米。',
      ),
    )
    const result = await ctx.workbench.compose?.('出一道二次函数的题')

    expect(result?.ok).toBe(false)
    expect(result?.items).toHaveLength(0)
    expect(result?.attempts?.length ?? 0).toBeGreaterThan(0)
    expect(result?.attempts?.join('\n')).toContain('拦下')
    expect(result?.escalate).toContain('constructor_write')
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('没配模型就明说需要配置，不假装能出题', async () => {
    const ctx = await boot(fakeChat({ knowledge: ['对称轴'] }), false)
    const result = await ctx.workbench.compose?.('出一道题')

    expect(result?.ok).toBe(false)
    expect(result?.reason).toContain('配置模型')
    expect(ctx.bank.all()).toHaveLength(0)
  })
})

/** 带会话的装配：用来验"收尾动作改的是卷子"（ADR-0034） */
async function bootWithSession(chat: (messages: readonly LlmMessage[]) => LlmReply): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin({
      name: 'fake-llm',
      apply(ctx: Context): void {
        ctx.provide('llm', { configured: true, model: 'fake-writer', chat: async (messages: readonly LlmMessage[]) => chat(messages) })
      },
    }),
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: ['动点问题', '圆的切线'] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(partsGate, { twoPartFrom: 8, threePartFrom: 12 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(paperPlugin, { maxAttempts: 6 }),
    await context.plugin(sessionPlugin, {
      path: join(workdir, 'sessions.json'),
      defaultBlueprint: 'seed/blueprint.json',
      defaultClass: '初三(2)班',
      defaultProgress: '九上·22章·第2课时',
    }),
    await context.plugin(workbenchPlugin, { extraRules: '' }),
  )
  // 会话是懒建的：先开一个，卷子才有地方落（界面启动时也是这么做的）
  context.session.current()
  return context
}

describe('把题放上卷子（收尾动作的落点）', () => {
  it('place_item 之后**卷子上这一题变了**（只让 submit_item 入库是不够的）', async () => {
    // 剧本：先构造，再 place_item——agent 该走的收尾动作
    const chat = (messages: readonly LlmMessage[]): LlmReply => {
      const system = messages.find((message) => message.role === 'system')?.content ?? ''
      const last = messages.at(-1)
      if (system.includes('你是命题组的执笔者')) {
        const brief = JSON.parse((last?.content ?? '{}').split('\n\n老师原话：')[0] ?? '{}') as {
          答案?: string
          问几问?: string[]
        }
        return {
          content: JSON.stringify({
            stem: `已知抛物线与 x 轴交于两点。${(brief.问几问 ?? [])
              .map((goal, index) => `（${String(index + 1)}）${goal.replace(/\d+/g, 'n')}`)
              .join('；')}`,
            answerText: brief.答案 ?? '',
            solution: ['由构造得到的结论'],
          }),
          toolCalls: [],
        }
      }
      if (last?.role === 'user') {
        return {
          content: '先造一道。',
          toolCalls: [{ id: 'c1', name: 'construct_item', arguments: JSON.stringify({ slotKey: 'S1', seed: 42 }) }],
        }
      }
      if (last?.role === 'tool') {
        const payload = JSON.parse(last.content ?? '{}') as { candidateId?: string; ok?: boolean }
        if (payload.candidateId !== undefined) {
          return {
            content: null,
            toolCalls: [
              {
                id: 'c2',
                name: 'place_item',
                arguments: JSON.stringify({ slotKey: 'S1-1', candidateId: payload.candidateId }),
              },
            ],
          }
        }
        // 闸门拦下（10 分的题至少要两问，不是每个种子都出得来）→ 换个种子再来
        if (payload.ok === false) {
          attempts += 1
          if (attempts > 5) return { content: '试了几个种子都过不了分量闸门。', toolCalls: [] }
          return {
            content: '换一个种子。',
            toolCalls: [
              {
                id: `c${String(attempts + 10)}`,
                name: 'construct_item',
                arguments: JSON.stringify({ slotKey: 'S1', seed: 7 + attempts * 5 }),
              },
            ],
          }
        }
      }
      return { content: '改好了：卷子第 1 题换成了新出的那道。', toolCalls: [] }
    }
    let attempts = 0

    const ctx = await bootWithSession(chat)
    // 6 分的解答题：分量闸门要求的分问数少，这个题型出得来（这道用例测的是"上卷"那一步）
    const firstRow = blueprint.blueprint[0]
    if (firstRow === undefined) throw new Error('蓝图里没有题位')
    const small: Blueprint = { ...blueprint, blueprint: [{ ...firstRow, score: 6 }] }
    const run = await ctx.workbench.run({ goal: '把第 1 题换成新出的那道', blueprint: small })

    expect(run.stopped).toBe('done')
    const latest = ctx.session.latest()
    const binding = latest?.bindings.find((entry) => entry.slot === 'S1-1')
    expect(binding?.itemId).toBe(run.stored[0])
    // 版本推进过：卷子确实出了一版新的（"入库"和"上卷"是两件事，这里是后者）
    expect(latest?.version).toBeGreaterThan(0)
    // 卷子上这道就是刚造的那道
    expect(ctx.bank.get(binding?.itemId ?? '')?.instance.kind).toBe('parabola/roots')
  })
})
