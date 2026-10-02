import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, Item, LlmMessage, LlmReply, SessionMeta } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as paperPlugin from '@examharness/plugin-paper'
import * as sessionPlugin from '@examharness/plugin-session'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as roundtripGate from '@examharness/plugin-verify-roundtrip'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { renderPaperHtml, renderPaperMarkdown } from '@examharness/plugin-web'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 会话与版本测试。盯住四件事：
 *   - **版本**：组卷产生 v1，局部重做产生 v2，diff 说清哪个题位被换了；
 *   - **局部重做必须守蓝图约束**（知识点/题型/分值不许被偷偷换掉）；
 *   - **R4**：`needs_review` 只能由人签成 `verified`；
 *   - **R3**：冻结之后一切写操作被拒。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

/** 取蓝图第一行（不让类型检查被 `!` 绕过） */
function firstRow(): Blueprint['blueprint'][number] {
  const row = blueprint.blueprint[0]
  if (row === undefined) throw new Error('蓝图是空的')
  return row
}

const fibers: Fiber[] = []
const scratch: string[] = []

/** 假模型：只会回一句"我解析不了"，用来制造 needs_review */
const unparseable = (): LlmReply => ({ content: '（我解析不出来）', toolCalls: [] })

function fakeLlm() {
  return {
    name: 'fake-llm',
    apply(ctx: Context): void {
      ctx.provide('llm', {
        configured: true,
        model: 'fake-writer',
        chat: async (_messages: readonly LlmMessage[]) => unparseable(),
      })
    },
  }
}

async function boot(options: { withRoundtrip?: boolean; sessionPath?: string } = {}): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-session-'))
  scratch.push(dir)
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', paths: [], learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(dir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85, corpusWordingMax: 0.55, corpusNumbersMin: 0.8 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(paperPlugin, { maxAttempts: 6 }),
    await context.plugin(sessionPlugin, {
      path: options.sessionPath ?? join(dir, 'sessions.json'),
      defaultBlueprint: 'seed/blueprint.json',
      defaultClass: '初三(2)班',
      defaultProgress: '九上·22章·第2课时',
    }),
  )
  if (options.withRoundtrip === true) {
    fibers.push(await context.plugin(fakeLlm()))
    fibers.push(await context.plugin(roundtripGate, { strict: false }))
  }
  return context
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('会话与版本', () => {
  it('组卷产生 v1：题位齐、分值对、diff 显示为新增', async () => {
    const ctx = await boot()
    const version = await ctx.session.assemble()

    expect(version.version).toBe(1)
    expect(version.bindings).toHaveLength(2)
    expect(version.totalScore).toBe(20)
    expect(version.reason).toBe('组卷')
    expect(ctx.session.current().className).toBe('初三(2)班')

    // 换了蓝图（多一个题位）后再组一次：diff 应当报出 added
    const wider = structuredClone(blueprint)
    const extra = firstRow()
    wider.blueprint = [...wider.blueprint, { ...extra, key: 'S3' }]
    const dir = mkdtempSync(join(tmpdir(), 'examharness-bp-'))
    scratch.push(dir)
    const extraPath = join(dir, 'blueprint-wide.json')
    writeFileSync(extraPath, JSON.stringify(wider), 'utf8')
    ctx.session.update({ blueprintPath: extraPath })
    await ctx.session.assemble('换蓝图')

    const diff = ctx.session.diff(1, 2)
    expect(diff.find((change) => change.slot === 'S3-1')?.change).toBe('added')
    expect(diff.filter((change) => change.change === 'same').length).toBe(2)
  })

  it('局部重做：只换一个题位、守住蓝图约束、产生 v2 且 diff 标为 replaced', async () => {
    const ctx = await boot()
    await ctx.session.assemble()
    const before = ctx.session.latest()?.bindings.find((binding) => binding.slot === 'S1-1')?.itemId

    const result = await ctx.session.regenerate('S1-1', 777)
    expect(result.ok).toBe(true)
    expect(result.version?.version).toBe(2)

    const after = ctx.session.latest()?.bindings.find((binding) => binding.slot === 'S1-1')?.itemId
    expect(after).not.toBe(before)

    // 蓝图约束不许被偷偷改掉
    const item = after === undefined ? undefined : ctx.bank.get(after)
    const row = blueprint.blueprint.find((entry) => entry.key === 'S1')
    expect(item?.slot.knowledge).toEqual(row?.knowledge)
    expect(item?.slot.type).toBe(row?.type)
    expect(item?.slot.score).toBe(row?.score)

    const diff = ctx.session.diff(1, 2)
    expect(diff.find((change) => change.slot === 'S1-1')?.change).toBe('replaced')
    expect(diff.find((change) => change.slot === 'S2-1')?.change).toBe('same')
  })

  it('R4：人工签字写进题目的 review 与题位绑定', async () => {
    const ctx = await boot()
    await ctx.session.assemble()
    const itemId = ctx.session.latest()?.bindings[0]?.itemId ?? ''

    const binding = ctx.session.confirm(itemId, '张老师')
    expect(binding?.confirmedBy).toBe('张老师')

    const item = ctx.bank.get(itemId)
    expect(item?.review.confirmedBy).toBe('张老师')
    expect(item?.review.confirmedAt).not.toBeNull()
    expect(item?.lifecycle).toBe('verified')
    // 重组卷之后签字要保住：签字是对题目的，不是对版本的
    await ctx.session.assemble('再组一次')
    expect(ctx.session.latest()?.bindings.find((b) => b.itemId === itemId)?.confirmedBy).toBe('张老师')
  })

  it('R3：冻结之后组卷、重做、改元信息一律被拒', async () => {
    const ctx = await boot()
    await ctx.session.assemble()
    ctx.session.freeze()
    expect(ctx.session.current().frozen).toBe(true)

    await expect(ctx.session.assemble()).rejects.toThrow('冻结')
    const regenerated = await ctx.session.regenerate('S1-1', 5)
    expect(regenerated.ok).toBe(false)
    expect(regenerated.reason).toContain('冻结')
    expect(() => ctx.session.update({ title: '改名' })).toThrow('冻结')
  })

  it('多会话：新建后当前会话切换，列表可读', async () => {
    const ctx = await boot()
    const first = ctx.session.current().id
    const created = ctx.session.create({ title: '单元小卷' })
    expect(ctx.session.current().id).toBe(created.id)
    expect(ctx.session.list().map((meta: SessionMeta) => meta.title)).toContain('单元小卷')
    ctx.session.switch(first)
    expect(ctx.session.current().id).toBe(first)
  })

  it('needs_review 只能由人升级为 verified', async () => {
    const ctx = await boot({ withRoundtrip: true })
    const item = ctx.construct.generate({ ...firstRow(), key: 'S1-1', count: 1 }, 42)
    // 冒充"模型写过题面"：非严格模式下回译拿不到结构 → 通过但标 needsReview
    const modeled: Item = { ...item, prose: { ...item.prose, serializer: { model: 'fake-writer', version: 1 } } }
    const result = await ctx.bank.submit(modeled)

    expect(result.ok).toBe(true)
    const stored = ctx.bank.get(result.ok ? result.id : '')
    expect(stored?.lifecycle).toBe('needs_review')
    expect(stored?.review.confirmedBy).toBeNull()

    ctx.session.confirm(result.ok ? result.id : '', '李老师')
    expect(ctx.bank.get(result.ok ? result.id : '')?.lifecycle).toBe('verified')
  })
})

describe('会话分组', () => {
  it('老存档缺 groups/groupId 时补齐：不分组也不丢会话（undefined 不许渗到接口层）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'examharness-legacy-'))
    scratch.push(dir)
    const file = join(dir, 'sessions.json')
    // 这是分组功能之前写下的存档：没有 groups，meta 里也没有 groupId/kbId
    writeFileSync(
      file,
      JSON.stringify({
        currentId: 's-legacy',
        sessions: [
          {
            meta: {
              id: 's-legacy',
              title: '老会话',
              className: '初三(2)班',
              progress: '九上·22章·第2课时',
              blueprintPath: 'seed/blueprint.json',
              createdAt: new Date(0).toISOString(),
              frozen: false,
            },
            versions: [],
          },
        ],
      }),
      'utf8',
    )

    const ctx = await boot({ sessionPath: file })
    const meta = ctx.session.list()[0]
    expect(ctx.session.groups()).toEqual([])
    expect(meta?.groupId).toBe('')
    expect(meta?.kbId).toBe('')
    // 复存一次后文件里必须真的带上这两个键（否则界面还是读到 undefined）
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { sessions: { meta: Record<string, unknown> }[] }
    expect(onDisk.sessions[0]?.meta).toHaveProperty('groupId', '')

    const group = ctx.session.createGroup('初三(2)班 九上')
    expect(ctx.session.moveToGroup('s-legacy', group.id)?.groupId).toBe(group.id)
    expect(ctx.session.list().filter((entry) => entry.groupId === group.id)).toHaveLength(1)
    expect(ctx.session.renameGroup(group.id, '九上')?.name).toBe('九上')

    const fresh = ctx.session.create({ title: '新会话', groupId: group.id, kbId: 'kb-1' })
    expect(fresh.groupId).toBe(group.id)
    expect(fresh.kbId).toBe('kb-1')
  })
})

describe('会话记录', () => {
  it('记录落盘：刷新（重开服务）之后还在；冻结的会话不再记', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'examharness-log-'))
    scratch.push(dir)
    const file = join(dir, 'sessions.json')

    const first = await boot({ sessionPath: file })
    first.session.appendLog({ kind: 'user', text: '按蓝图出一份课后作业卷', runId: 'r1' })
    first.session.appendLog({ kind: 'gate', text: '入库：S1', runId: 'r1' })
    expect(first.session.log().map((entry) => entry.text)).toEqual(['按蓝图出一份课后作业卷', '入库：S1'])
    expect(first.session.log()[0]?.at).toBeTruthy()

    // 换一个进程实例读同一个文件——记录是**这个会话的**，不该随着内存消失
    const second = await boot({ sessionPath: file })
    expect(second.session.log().map((entry) => entry.text)).toEqual(['按蓝图出一份课后作业卷', '入库：S1'])

    // 冻结之后不再记新东西（冻结 = 这一版到此为止）
    second.session.freeze()
    expect(second.session.appendLog({ kind: 'user', text: '再来一次' })).toBeUndefined()
    expect(second.session.log()).toHaveLength(2)
  })
})

describe('导出', () => {
  it('HTML 与 Markdown 都含题干、答案、解析与图', async () => {
    const ctx = await boot()
    await ctx.session.assemble()
    const items = ctx
      .session
      .latest()
      ?.bindings.flatMap((binding) => {
        const item = ctx.bank.get(binding.itemId)
        return item === undefined ? [] : [item]
      }) ?? []

    const figureOf = (item: Item): string => ctx.figure.renderItem(item)?.svg ?? ''
    const html = renderPaperHtml(ctx.session.current(), items, figureOf)
    const markdown = renderPaperMarkdown(ctx.session.current(), items, figureOf)

    expect(html).toContain('参考答案与解析')
    expect(html).toContain('<svg')
    expect(html).toContain(items[0]?.prose.stem.slice(0, 12) ?? '')
    expect(markdown).toContain('# 课后作业卷')
    expect(markdown).toContain('<svg')
    expect(markdown).toContain(items[0]?.prose.answerText ?? '')
  })
})
