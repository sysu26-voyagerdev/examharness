import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import * as graphPlugin from '@examharness/plugin-graph'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 知识树服务层：**文件是真相**（ADR-0033）。
 *
 * 要盯住的是"写出去的东西还能读回来"，以及"服务重启后看到的和刚才写的一致"——
 * 这两件事错了，老师在界面上改的连线会在重启后凭空消失，而且没有任何提示。
 */

const fibers: Fiber[] = []
let root = ''
const scratch: string[] = []

function writeNote(dir: string, key: string, prerequisites: readonly string[] = [], extra = ''): void {
  const list = prerequisites.map((item) => JSON.stringify(`[[${item}]]`)).join(', ')
  writeFileSync(
    join(dir, `${key}.md`),
    `---\ntitle: ${key}\ngroup: 测试\nprerequisites: [${list}]\n---\n\n${key} 的备注${extra}\n`,
    'utf8',
  )
}

/** 起一个只用临时目录的服务；返回它的目录方便断言文件 */
async function boot(): Promise<{ ctx: Context; dir: string }> {
  root = mkdtempSync(join(tmpdir(), 'examharness-graph-'))
  scratch.push(root)
  const dir = join(root, '知识')
  mkdirSync(dir, { recursive: true })
  const context = new Context()
  context.baseUrl = pathToFileURL(root).href
  fibers.push(await context.plugin(graphPlugin, { dir: '知识', path: 'seed/knowledge.json', paths: [], learned: ['A', 'B'] }))
  return { ctx: context, dir }
}

beforeEach(() => {
  root = ''
})

afterEach(async () => {
  // 与仓库其它测试同一写法（倒序 dispose，别在循环里 await）
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('读目录', () => {
  it('一个 .md 一个知识点，前置照读', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeNote(dir, 'B', ['A'])
    writeNote(dir, 'C', ['A', 'B'])
    ctx.graph.reload()

    expect(ctx.graph.nodes().toSorted()).toEqual(['A', 'B', 'C'])
    expect(ctx.graph.prerequisites(['C']).toSorted()).toEqual(['A', 'B'])
    expect(ctx.graph.closure(['C']).toSorted()).toEqual(['A', 'B', 'C'])
  })

  it('越界检测照旧：没学过的前置算超纲', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeNote(dir, 'B', ['A'])
    writeNote(dir, 'D')
    writeNote(dir, 'E', ['D'])
    ctx.graph.reload()

    // A、B 都在已学集合里 → 合法
    expect(ctx.graph.missing(['B'])).toEqual([])
    // E 自己没学、它的前置 D 也没学：闭包整条都报出来（闸门就是这么用的）
    expect(ctx.graph.missing(['E']).toSorted()).toEqual(['D', 'E'])
    // 只依赖已学的东西时，闭包干净
    writeNote(dir, 'F', ['A', 'B'])
    ctx.graph.reload()
    expect(ctx.graph.missing(['F'])).toEqual(['F'])
  })

  it('目录不在时退回旧 JSON（迁移期不能让服务起不来）', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'examharness-graph-bare-'))
    scratch.push(bare)
    writeFileSync(join(bare, 'old.json'), JSON.stringify({ nodes: { X: {}, Y: { prerequisites: ['X'] } } }), 'utf8')
    const context = new Context()
    context.baseUrl = pathToFileURL(bare).href
    fibers.push(await context.plugin(graphPlugin, { dir: '不存在', path: 'old.json', paths: [], learned: ['X'] }))

    expect(context.graph.nodes().toSorted()).toEqual(['X', 'Y'])
    expect(context.graph.tree().origin.kind).toBe('json')
  })

  it('单个坏文件不拖垮整棵树', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeFileSync(join(dir, '坏文件.md'), '\u0000\u0001 不是文本', 'utf8')
    writeNote(dir, 'B', ['A'])
    ctx.graph.reload()
    expect(ctx.graph.nodes()).toContain('A')
    expect(ctx.graph.nodes()).toContain('B')
  })
})

describe('写知识点', () => {
  it('新建 → 落盘 → 重载后还在（重启不丢）', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    ctx.graph.reload()

    ctx.graph.save({ key: '新知识点', title: '新知识点', group: '函数', order: 42, prerequisites: ['A'], note: '备注正文' })

    expect(existsSync(join(dir, '新知识点.md'))).toBe(true)
    const text = readFileSync(join(dir, '新知识点.md'), 'utf8')
    expect(text).toContain('prerequisites: ["[[A]]"]')
    expect(text).toContain('备注正文')

    // 模拟重启：重新读一遍目录，看到的必须和刚才写的一致
    ctx.graph.reload()
    const note = ctx.graph.tree().nodes.find((entry) => entry.key === '新知识点')
    expect(note?.prerequisites).toEqual(['A'])
    expect(note?.title).toBe('新知识点')
    expect(note?.order).toBe(42)
    expect(note?.depth).toBe(1)
  })

  it('改连线只改前置，**老师的备注正文一个字不动**', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeNote(dir, 'B')
    writeNote(dir, 'C', ['A'], '\n\n## 我自己的话\n\n这段谁也别动。')
    ctx.graph.reload()

    ctx.graph.save({ key: 'C', prerequisites: ['A', 'B'] })

    const text = readFileSync(join(dir, 'C.md'), 'utf8')
    expect(text).toContain('prerequisites: ["[[A]]", "[[B]]"]')
    expect(text).toContain('这段谁也别动。')
    expect(text).toContain('## 我自己的话')
  })

  it('只给 key 就是新建，其余字段有默认值', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    ctx.graph.reload()
    const note = ctx.graph.save({ key: '光秃秃' })
    expect(note.title).toBe('光秃秃')
    expect(note.prerequisites).toEqual([])
    expect(existsSync(join(dir, '光秃秃.md'))).toBe(true)
  })

  it('自环被拒绝，而且不留下半个文件', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    ctx.graph.reload()
    expect(() => ctx.graph.save({ key: 'A', prerequisites: ['A'] })).toThrow(/自己/)
    expect(readFileSync(join(dir, 'A.md'), 'utf8')).toContain('prerequisites: []')
  })

  it('文件名不能用的字符被挡下（节点键就是文件名）', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    ctx.graph.reload()
    expect(() => ctx.graph.save({ key: 'a/b' })).toThrow(/不能有/)
    expect(() => ctx.graph.save({ key: '' })).toThrow(/得有名字/)
    expect(() => ctx.graph.save({ key: '_草稿' })).toThrow(/下划线/)
  })

  it('别名能当引用目标，写回时统一成键', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, '一次函数')
    ctx.graph.reload()
    ctx.graph.save({ key: '一次函数', aliases: ['正比例函数'] })
    ctx.graph.save({ key: '正比例应用', prerequisites: ['正比例函数'] })

    ctx.graph.reload()
    const note = ctx.graph.tree().nodes.find((entry) => entry.key === '正比例应用')
    expect(note?.prerequisites).toEqual(['一次函数'])
    expect(readFileSync(join(dir, '正比例应用.md'), 'utf8')).toContain('["[[一次函数]]"]')
  })
})

describe('删知识点', () => {
  it('删掉文件，并如实报告谁还在引它', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeNote(dir, 'B', ['A'])
    writeNote(dir, 'C', ['A'])
    ctx.graph.reload()

    const result = ctx.graph.remove('A')
    expect(result.removed).toBe(true)
    expect(result.stillReferencedBy.toSorted()).toEqual(['B', 'C'])
    expect(existsSync(join(dir, 'A.md'))).toBe(false)

    // B、C 现在是断线状态：**看得见**，不是悄悄消失
    ctx.graph.reload()
    expect(ctx.graph.tree().diagnostics.filter((entry) => entry.kind === 'dangling').length).toBe(2)
    expect(ctx.graph.tree().nodes.find((entry) => entry.key === 'B')?.dangling).toEqual(['A'])
  })

  it('删不存在的返回 false，不抛异常', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    ctx.graph.reload()
    expect(ctx.graph.remove('没有这个').removed).toBe(false)
  })
})

describe('整棵树', () => {
  it('给得出分组、顺序、正反两个方向的连线与原始文件', async () => {
    const { ctx, dir } = await boot()
    writeNote(dir, 'A')
    writeNote(dir, 'B', ['A'])
    ctx.graph.reload()

    const tree = ctx.graph.tree()
    const a = tree.nodes.find((entry) => entry.key === 'A')
    const b = tree.nodes.find((entry) => entry.key === 'B')
    expect(a?.dependents).toEqual(['B'])
    expect(b?.dependents).toEqual([])
    expect(b?.file).toBe('B.md')
    expect(tree.origin).toEqual({ kind: 'dir', path: '知识' })
    expect(tree.learned).toEqual(['A', 'B'])
    expect(ctx.graph.sourceOf('A')).toContain('title: A')
  })
})
