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
import * as questionGate from '@examharness/plugin-verify-question'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { signedByAll } from '@examharness/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

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
const LEARNED = learnedClosure(['一次函数', '配方', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值'])
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
    await ctx.plugin(questionGate),
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

  it('同一道题分成两问、且两问都写进题面 → 通过（分量对得上了）', async () => {
    const ctx = await boot()
    const base = await itemFor('解答', 9)
    const item: Item = {
      ...withGoals(base, ['求对称轴', '求顶点坐标']),
      prose: {
        ...base.prose,
        stem: '已知抛物线 $y=x^{2}+4x$。（1）求它的对称轴；（2）求它的顶点坐标。',
      },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok ? 'ok' : JSON.stringify(result.verdict)).toBe('ok')
  })

  it('3 分的填空题：留了作答空位就不拦（填空本来就一句话题完）', async () => {
    const ctx = await boot()
    const base = await itemFor('填空', 3)
    const item: Item = {
      ...withGoals(base, ['求对称轴']),
      prose: { ...base.prose, stem: '已知抛物线 $y=x^{2}+4x$，它的对称轴是 ______。' },
    }
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

  it('题面里又写了一遍选项 → 拦下（学生会看到两套不一样的选项）', async () => {
    const ctx = await boot()
    const base = await itemFor('选择', 3)
    // 真实案例：题面里写着 A–D 四个选项，结构里的选项却是另一套
    const item: Item = {
      ...base,
      prose: {
        ...base.prose,
        stem: `${base.prose.stem}\nA. 35°\nB. 70°\nC. 35°或70°\nD. 无法确定`,
      },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-options')
    expect(result.ok ? '' : result.verdict.reason).toContain('又写了一遍选项')
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
    expect(ctx.bank.gates?.().map((gate) => gate.name)).toContain('parts')
    expect(ctx.bank.gates?.().map((gate) => gate.name)).toContain('options')

    // 一道"当年入库"的题：证据里没有 verify-parts 的签字
    const item = withGoals(await itemFor('解答', 9), ['求对称轴'])
    const legacy: Item = {
      ...item,
      lifecycle: 'verified',
      evidence: { scope: { pass: true }, symbolic: { pass: true }, dedup: { pass: true } },
    }
    const gates = ctx.bank.gates?.() ?? []
    // 判据统一在 core：签过字 = 每道现役闸门都签过，**且签的是现在这版规则**
    expect(signedByAll(legacy, gates)).toBe(false)
  })
})

describe('题面闸门（题面得是一道题）', () => {
  it('只有情境、没有问 → 拦下（真实事故：8 道 9 分解答题全是"一块试验田…"）', async () => {
    const ctx = await boot()
    const base = await itemFor('解答', 9)
    const item: Item = {
      ...base,
      instance: {
        ...base.instance,
        goal: '求面积 求周长',
        goals: ['求面积', '求周长'],
      },
      prose: { ...base.prose, stem: '一块长方形试验田，长为 6√7 米，宽为 3√7 米。' },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.gate).toBe('verify-question')
    expect(result.ok ? '' : result.verdict.reason).toContain('没有问题')
  })

  it('声明两问但题面只有一问 → 拦下；把两问都写进题面才放行', async () => {
    const ctx = await boot()
    const base = await itemFor('解答', 9)
    const partial: Item = {
      ...base,
      instance: { ...base.instance, goal: '求面积 求周长', goals: ['求面积', '求周长'] },
      prose: { ...base.prose, stem: '一块长方形试验田，长为 6√7 米，宽为 3√7 米。求它的面积。' },
    }
    const rejected = await ctx.bank.submit(partial)
    expect(rejected.ok).toBe(false)
    expect(rejected.ok ? '' : rejected.verdict.reason).toContain('分问标记')

    const full: Item = {
      ...partial,
      prose: {
        ...partial.prose,
        stem: '一块长方形试验田，长为 6√7 米，宽为 3√7 米。（1）求它的面积；（2）求它的周长。',
      },
    }
    const accepted = await ctx.bank.submit(full)
    expect(accepted.ok ? 'ok' : JSON.stringify(accepted.verdict)).toBe('ok')
  })

  it('题面里的 $ 不成对 → 拦下（公式会从中间断开）', async () => {
    const ctx = await boot()
    const base = await itemFor('解答', 9)
    const item: Item = {
      ...base,
      instance: { ...base.instance, goal: '求面积 求周长', goals: ['求面积', '求周长'] },
      prose: {
        ...base.prose,
        // 少了一个 $（末尾那个丢了）：这种错在卷面上就是公式从中间断开
        stem: '在平行四边形 $ABCD$ 中，边 $AB=7$，边 $BC=5。（1）求面积；（2）求周长。',
      },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.reason).toContain('$ 不成对')
  })

  it('填空题没有作答空位 → 拦下', async () => {
    const ctx = await boot()
    const base = await itemFor('填空', 3)
    const item: Item = {
      ...base,
      instance: { ...base.instance, goal: '化简', goals: ['化简'] },
      prose: { ...base.prose, stem: '化简：$\\sqrt{44}$。' },
    }
    const result = await ctx.bank.submit(item)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.verdict.reason).toContain('作答空位')
  })
})
