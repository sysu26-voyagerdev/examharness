import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item, LlmMessage, LlmReply } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as roundtripGate from '@examharness/plugin-verify-roundtrip'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import * as workbenchPlugin from '@examharness/plugin-workbench'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 回译闸门测试 —— **H2 的雏形**：回译能不能抓住序列化错误。
 *
 * 剧本：模型先构造，再写题面（serialize_item），再提交。
 * 提交时闸门把题面**回译**成结构，与构造实例比对：
 *   - 忠实 → 通过；
 *   - 写漏条件 → 拦下，且 fixable（改题面，不要改数学）；
 *   - 模板序列化 → 不经回译（确定性题面不必花一次调用）。
 *
 * 注意：工作台内部的"执笔者/解析器"调用与主循环走的是**同一个 chat**，
 * 所以假模型必须按系统提示词分派，不能靠计数器推阶段。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint
const SLOT = blueprint.blueprint[0] as BlueprintRow
const SEED = 42

const call = (id: string, name: string, args: unknown) => ({ id, name, arguments: JSON.stringify(args) })

interface BrainOptions {
  /** 回译结果：faithful 会照构造实例回答，其余是"模型写歪了" */
  parse: (stem: string) => Record<string, unknown> | null
  /** 主循环里是否先写题面（false = 提交时自动写；这里只影响"先写一版"） */
  serialize: boolean
  /** 让假执笔者在题面里塞一句私货（用来测"数字必须来自构造"） */
  stemSuffix?: string
}

function brain(options: BrainOptions) {
  let phase = 0
  return (messages: readonly LlmMessage[]): LlmReply => {
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const last = messages.at(-1)?.content ?? ''

    // 旁路调用：执笔者（认**提示词的开头**，别只认"执笔者"三个字——
    // 主循环的系统提示里现在也写着"题面由执笔者写"，按关键词分会误判）
    if (system.includes('你是命题组的执笔者')) {
      const brief = JSON.parse(last) as { 问几问?: string[]; 目标?: string; 答案: string }
      const goals = brief.问几问 ?? [brief.目标 ?? '']
      const asks = goals.map((goal, index) => `（${String(index + 1)}）${goal}`).join('；')
      return {
        content: JSON.stringify({
          stem: `已知抛物线与 x 轴交于两点。${options.stemSuffix ?? ''}${asks}`,
          answerText: brief.答案,
          solution: ['由构造得到的结论'],
        }),
        toolCalls: [],
      }
    }
    // 旁路调用：题面解析器
    if (system.includes('题面解析器')) {
      const parsed = options.parse(last)
      return { content: parsed === null ? '（解析不出来）' : JSON.stringify(parsed), toolCalls: [] }
    }

    // 主循环（惰性解析：phase 1 时最后一条是用户的自然语言，不是 JSON）
    phase += 1
    const candidateId = (): string => {
      try {
        return (JSON.parse(last) as { candidateId?: string }).candidateId ?? ''
      } catch {
        return ''
      }
    }
    if (phase === 1) {
      return { content: '先构造候选。', toolCalls: [call('c1', 'construct_item', { slotKey: 'S1', seed: SEED })] }
    }
    if (options.serialize && phase === 2) {
      return { content: null, toolCalls: [call('c2', 'serialize_item', { candidateId: candidateId() })] }
    }
    if (phase <= 3) {
      return { content: null, toolCalls: [call('c3', 'submit_item', { candidateId: candidateId() })] }
    }
    return { content: '收工。', toolCalls: [] }
  }
}

function fakeLlm(configured: boolean, chat: (messages: readonly LlmMessage[]) => LlmReply) {
  return {
    name: 'fake-llm',
    apply(ctx: Context): void {
      ctx.provide('llm', {
        configured,
        model: 'fake-writer',
        chat: async (messages: readonly LlmMessage[]) => chat(messages),
      })
    },
  }
}

const fibers: Fiber[] = []
let workdir = ''

async function boot(chat: (messages: readonly LlmMessage[]) => LlmReply, configured = true): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(fakeLlm(configured, chat)),
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(roundtripGate, { strict: true }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(workbenchPlugin, { maxSteps: 8, extraRules: '' }),
  )
  return context
}

/** 同一个构造器 + 同一个种子 = 同一道题，用来知道"忠实回译"该回什么 */
async function expectedItem() {
  const probe = new Context()
  probe.baseUrl = pathToFileURL(ROOT).href
  const fiber = await probe.plugin(constructPlugin, { rootRange: [-4, 5] })
  const item = probe.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
  await fiber.dispose()
  return item
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-rt-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('回译闸门', () => {
  it('模型序列化 + 忠实回译 → 入库，证据里留下往返记录', async () => {
    const expected = await expectedItem()
    const ctx = await boot(
      brain({
        serialize: true,
        parse: () => ({
          goals: expected.instance.goals ?? [expected.instance.goal],
          givensCount: expected.instance.givens.length,
          answer: expected.witness.answer,
          numbers: [],
        }),
      }),
    )
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    expect(run.stored).toHaveLength(1)
    const stored = ctx.bank.all()[0]
    expect(stored?.prose.serializer.model).toBe('fake-writer')
    expect(stored?.evidence.roundtrip?.pass).toBe(true)
  })

  it('题面写漏条件 → 回译不一致，拦下并允许重写', async () => {
    const expected = await expectedItem()
    const ctx = await boot(
      brain({
        serialize: true,
        parse: () => ({
          goals: expected.instance.goals ?? [expected.instance.goal],
          givensCount: expected.instance.givens.length - 1,
          answer: expected.witness.answer,
          numbers: [],
        }),
      }),
    )
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    expect(run.stored).toHaveLength(0)
    expect(ctx.bank.all()).toHaveLength(0)
    const gate = run.transcript.find((event) => event.kind === 'gate')
    expect(gate?.text).toContain('verify-roundtrip')
    expect(gate?.text).toContain('条件条数不一致')
  })

  it('模板序列化的题不经回译（模型没配置也能入库）', async () => {
    // 这里刻意让 llm 处于"未配置"：模板题面是确定性的，回译闸门应当直接放行。
    // 注意不能借工作台来测这一条——工作台在没有模型时本来就会拒绝运行（那是对的）。
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const item = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(true)
    expect(ctx.bank.all()[0]?.prose.serializer.model).toBe('template')
    // 模板题**不走回译**，但要留一条痕迹（题库靠"每道现役闸门都签过字"判断旧题能否复用）
    expect(ctx.bank.all()[0]?.evidence.roundtrip?.detail).toContain('模板序列化')
  })

  it('构造实例没声明目标/条件 → 这两项没验成，如实落"待复核"（不假装通过）', async () => {
    // 动态题型模块可以只给题面、不声明 goal / givens。这时回译**没有对照物**：
    // 既不该判题面写错（冤枉），也不该当成验过了（假验证）——落 needs_review，等人签字。
    const expected = await expectedItem()
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({ goals: ['随便什么目标'], givensCount: 0, answer: expected.witness.answer, numbers: [] }),
      }),
    )
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const bare: Item = {
      ...base,
      instance: { ...base.instance, goal: '', givens: [] },
      prose: { ...base.prose, serializer: { model: 'fake-writer', version: 1 } },
    }
    const result = await ctx.bank.submit(bare)

    expect(result.ok).toBe(true)
    const stored = ctx.bank.all()[0]
    expect(stored?.lifecycle).toBe('needs_review')
    expect(stored?.evidence.roundtrip?.detail).toContain('没声明')
    expect(stored?.evidence.roundtrip?.detail).toContain('待复核')
  })

  it('分问标号与幂次不算题目数据（写对的中考解答题题面不该被数字检查误伤）', async () => {
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const fragment = base.prose.tex?.stem ?? ''
    const item: Item = {
      ...base,
      prose: { ...base.prose, tex: { ...base.prose.tex, stem: `（1）${fragment}；（2）求顶点坐标；（3）求面积` } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('题面公式里凭空多出的数字要拦下（公式必须照着构造写）', async () => {
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const fragment = base.prose.tex?.stem ?? ''
    const item: Item = {
      ...base,
      prose: { ...base.prose, tex: { ...base.prose.tex, stem: `${fragment} + 777` } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result.verdict)).toContain('777')
  })
  it('执笔者在题面里写了构造没有的数字（情境数据自己编）→ 拦下并说清怎么办', async () => {
    const expected = await expectedItem()
    const ctx = await boot(
      brain({
        serialize: false,
        stemSuffix: '某商店购进 200 件这种商品，每件定价 40 元。',
        parse: () => ({
          goals: expected.instance.goals ?? [expected.instance.goal],
          givensCount: expected.instance.givens.length,
          answer: expected.witness.answer,
          numbers: ['200', '40'],
        }),
      }),
    )
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    expect(run.stored).toHaveLength(0)
    expect(ctx.bank.all()).toHaveLength(0)
    const gate = run.transcript.find((event) => event.kind === 'gate')
    expect(gate?.text).toContain('verify-roundtrip')
    expect(gate?.text).toContain('200')
    expect(gate?.text).toContain('构造参数里没有的数字')
  })
  it('回译解析器把数字写成数字（不是字符串）也算数——别因此判"回译失败"', async () => {
    const expected = await expectedItem()
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({
          goals: expected.instance.goals ?? [expected.instance.goal],
          givensCount: expected.instance.givens.length,
          answer: expected.witness.answer,
          // 真实模型就是这么写的：数字就是数字
          numbers: [2, 3],
        }),
      }),
    )
    const run = await ctx.workbench.run({ goal: '出题', blueprint })
    // 2、3 不在构造参数里 → 该被"题面里出现了构造参数里没有的数字"拦下，
    // 而不是因为"类型不对"被判"回译失败"
    const gate = run.transcript.find((event) => event.kind === 'gate')
    expect(gate?.text).toContain('构造参数里没有的数字')
    expect(gate?.text).not.toContain('回译失败')
  })
})
