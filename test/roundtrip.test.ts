import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item, LlmMessage, LlmReply } from '@examharness/core'
import { sameAnswer } from '@examharness/core'
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
import { learnedClosure } from './helpers/learned.js'

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
const LEARNED = learnedClosure(['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值'])
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
  // 记住见过的那一个候选号：submit 之后返回里就没有 candidateId 了（只有 ok/evidence/id），
  // 而放上卷子那一步还得用它。**必须活在闭包外**，否则每次调用都被清空。
  let remembered = ''
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
        const parsed = JSON.parse(last) as { candidateId?: string }
        if (parsed.candidateId !== undefined && parsed.candidateId !== '') remembered = parsed.candidateId
      } catch {
        /* 不是 JSON 就用上次记住的 */
      }
      return remembered
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
    // 提交只是过检查；**放上卷子**才入库（真实语义：入库发生在那一刻）
    if (phase === 4) {
      return { content: null, toolCalls: [call('c4', 'place_item', { slotKey: 'S1-1', candidateId: candidateId() })] }
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

    // 放上卷子之后才在库里（提交本身只是预检）
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

  it('旧"公式层"（tex.*）里塞的是整句正文时，按正文拆开编译，不整道拦下', async () => {
    // 实测：一次组卷里 6 道题卡在这一条——`tex.answer` 写的是
    // `（1）$y=-(x-3)^{2}+2$；（2）…`，整句当公式编译必然报 `Can't use function '$'`，
    // 于是一个**数学没有任何问题**的候选被整道拦下，还白花一次模型调用。
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const withTex: Item = {
      ...base,
      prose: {
        ...base.prose,
        tex: { answer: '（1）$y=(x-3)^{2}-4$；（2）最大值 $-4$' },
      },
    }
    const result = await ctx.bank.submit(withTex)

    expect(result.ok).toBe(true)
  })

  it('旧"公式层"里没有定界符、公式本身写坏了 → 照样拦下，并说清是哪个字段', async () => {
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const broken: Item = { ...base, prose: { ...base.prose, tex: { answer: 'y=\\frac{1}{' } } }
    const result = await ctx.bank.submit(broken)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-roundtrip')
    expect(result.ok ? '' : result.verdict.reason).toContain('答案公式（旧字段）')
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
    const item: Item = {
      ...base,
      prose: {
        ...base.prose,
        stem: `（1）$y=x^{2}+6x+8$ 的对称轴是什么；（2）求顶点坐标；（3）求面积`,
      },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('题面里凭空多出的数字要拦下（含行内公式里的数字）', async () => {
    const ctx = await boot(brain({ serialize: false, parse: () => null }), false)
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const item: Item = {
      ...base,
      prose: { ...base.prose, stem: '某商店购进 777 件商品，$y=x^{2}+6x+8$，求对称轴。' },
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
  it('措辞与标注不同不算错：目标多个 O、答案带名称、条件多算一条，都该放行', async () => {
    // 真实被拦下的例子（用户在界面上看到的）：
    //   目标不一致（题面里找不到「求圆心到弦AB的距离」，回译得到「求圆心 O 到弦 AB 的距离」）
    //   答案不一致（回译得到「圆心 O 到弦 AB 的距离 = 12」，构造答案是「12」）
    //   条件条数不一致（题面 4 条，构造 3 条）
    // 这三条说的都是同一件事——闸门该抓的是"问的变了、数值变了、条件漏了"。
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({
          goals: ['求圆心 O 到弦 AB 的距离'],
          givensCount: 4,
          answer: '圆心 O 到弦 AB 的距离 = 12',
          numbers: [],
        }),
      }),
    )
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const item: Item = {
      ...base,
      instance: {
        ...base.instance,
        goal: '求圆心到弦AB的距离',
        goals: ['求圆心到弦AB的距离'],
        givens: ['⊙O 的半径是 13', '弦 AB 的长是 24', 'OC ⊥ AB 于点 C'],
      },
      witness: { ...base.witness, answer: '12' },
      prose: { ...base.prose, serializer: { model: 'fake-writer', version: 1 } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('真的问错了 / 答案真的不一样 → 照样拦下（容错不是放水）', async () => {
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({ goals: ['求这个三角形的面积'], givensCount: 3, answer: '99', numbers: [] }),
      }),
    )
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const item: Item = {
      ...base,
      instance: { ...base.instance, goal: '求对称轴', goals: ['求对称轴'], givens: ['a', 'b', 'c'] },
      witness: { ...base.witness, answer: 'x = 2' },
      prose: { ...base.prose, serializer: { model: 'fake-writer', version: 1 } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    const verdict = result.ok ? undefined : result.verdict
    expect(verdict?.gate).toBe('verify-roundtrip')
    expect(verdict?.reason).toContain('答案不一致')
  })
  it('答案带分问序号/名称不算错：同一个答案换个写法必须放行（真实被拦的例子）', async () => {
    // 界面上真实被拦下的一对：
    //   回译得到「平均数 = 6；中位数 = 5.5；众数 = 6」
    //   构造答案是「（1）平均数 = 6；（2）中位数 = 5.5；（3）众数 = 6」
    // 这是同一个答案。判定必须比**值**，不比字符串（见 core 的 sameAnswer）。
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({
          goals: ['求这组数据的平均数', '求这组数据的中位数', '求这组数据的众数'],
          givensCount: 1,
          answer: '平均数 = 6；中位数 = 5.5；众数 = 6',
          numbers: [],
        }),
      }),
    )
    const base = ctx.construct.generate({ ...SLOT, key: 'S18-1', count: 1 }, SEED)
    const item: Item = {
      ...base,
      instance: {
        ...base.instance,
        goal: '求平均数 求中位数 求众数',
        goals: ['求这组数据的平均数', '求这组数据的中位数', '求这组数据的众数'],
        givens: ['一组数据'],
      },
      witness: { ...base.witness, answer: '（1）平均数 = 6；（2）中位数 = 5.5；（3）众数 = 6' },
      prose: { ...base.prose, serializer: { model: 'fake-writer', version: 1 } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('分数换个写法（5/12 与 5/13）不算同一个答案 → 照样拦', async () => {
    const ctx = await boot(
      brain({
        serialize: false,
        parse: () => ({ goals: ['求对称轴'], givensCount: 3, answer: '5/13', numbers: [] }),
      }),
    )
    const base = ctx.construct.generate({ ...SLOT, key: 'S1-1', count: 1 }, SEED)
    const item: Item = {
      ...base,
      instance: { ...base.instance, goal: '求对称轴', goals: ['求对称轴'], givens: ['a', 'b', 'c'] },
      witness: { ...base.witness, answer: '5/12' },
      prose: { ...base.prose, serializer: { model: 'fake-writer', version: 1 } },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.reason).toContain('答案不一致')
  })

})

describe('答案按值比（真实用例）', () => {
  const cases: readonly { constructed: string; parsed: string; same: boolean }[] = [
    { constructed: '（1）a^{2}-b^{2}=72；（2）a^{2}-2ab+b^{2}=64', parsed: '（1）72；（2）64', same: true },
    { constructed: '（1）平均数 = 6；（2）中位数 = 5.5；（3）众数 = 6', parsed: '平均数 = 6；中位数 = 5.5；众数 = 6', same: true },
    { constructed: '圆心 O 到弦 AB 的距离 = 12', parsed: '12', same: true },
    { constructed: '（1）y = 2x + 2；（2）(-1, 0)；（3）面积为 1', parsed: '（1）y = 2x + 2；（2）交点坐标 (-1, 0)；（3）面积 = 1', same: true },
    { constructed: '\\dfrac{6}{14}', parsed: '3/7', same: true },
    // 数学减号（U+2212）与 ASCII 减号是同一个事实：真实案例里模型写"顶点坐标为 (3/2, -49/4)"，
    // 构造答案是"(1.5, −12.25)"——曾经因为减号写法不同被判成两个答案，好题白白重跑一遍。
    { constructed: '(1.5, \u221212.25)', parsed: '顶点坐标为 (3/2, -49/4)', same: true },
    { constructed: '\\dfrac{1}{2}', parsed: '0.5', same: true },
    // 真实两例（一次组卷里连着两道被冤枉）：分问之间用 `\quad`/`\ ` 排版、
    // 面积记成 S 而回译写成"△ABC 的面积"——数值一模一样，却因"字母对不上"被判不一致，
    // 每道白跑一次模型。排版与标签不是数学。
    {
      constructed: 'a=1,\\ b=6,\\ c=5;\\quad (0,5);\\quad x=-3,\\ y=-4',
      parsed: '（1）a = 1，b = 6，c = 5；（2）(0, 5)；（3）x = -3 时 y 取得最小值，最小值是 -4',
      same: true,
    },
    {
      constructed: 'b=14,\\ c=45;\\quad (-7,-4);\\quad S= 90',
      parsed: 'b = 14，c = 45；顶点坐标为 (-7, -4)；△ABC 的面积 = 90',
      same: true,
    },
    { constructed: 'x = 2', parsed: 'y = 2', same: false },
    { constructed: 'x = 2', parsed: 'x = 3', same: false },
    { constructed: '\\dfrac{5}{12}', parsed: '5/13', same: false },
    { constructed: '（1）144；（2）x(x-6)(x+6)', parsed: '(1) 72；(2) x^3-36x = x(x+6)(x-6)', same: false },
  ]
  for (const item of cases) {
    it(`${item.constructed.slice(0, 18)} ${item.same ? '=' : '≠'} ${item.parsed.slice(0, 18)}`, () => {
      expect(sameAnswer(item.constructed, item.parsed)).toBe(item.same)
    })
  }
})
