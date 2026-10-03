import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildKnowledgeTree,
  danglingFor,
  depthOf,
  detectCycles,
  noteKeyOf,
  parseFrontmatter,
  parseKnowledgeNote,
  serializeKnowledgeNote,
  wikiLinksIn,
  type KnowledgeNote,
} from '@examharness/core'
import { describe, expect, it } from 'vitest'

/**
 * 知识树的**文件形态**测试（ADR-0033）。
 *
 * 这棵树是老师要读要改的东西，所以最要紧的不是"能解析"，而是三件事：
 *   1. **改一次连线，别的内容一个字都不能动**——老师的备注正文是私产；
 *   2. **写出去的文件要能再读回来**，而且再写一遍逐字节一致（不然每次保存都产生假 diff）；
 *   3. **树坏的地方要说出来**（悬空引用、成环、重名），不能悄悄吞掉。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NOTE = (fields: string, body = ''): string => `---\n${fields}\n---\n\n${body}`
/** 造一个只有键和前置的知识点（别的字段对这组测试没意义） */
const noteOf = (key: string, prerequisites: string[] = []): KnowledgeNote => ({
  key,
  title: key,
  order: 0,
  group: '',
  aliases: [],
  prerequisites,
  note: '',
})

describe('frontmatter 最小解析', () => {
  it('标量、行内数组、空数组', () => {
    const { fields } = parseFrontmatter(NOTE('title: 顶点式\norder: 320\ngroup: 函数\nprerequisites: []'))
    expect(fields['title']).toBe('顶点式')
    expect(fields['order']).toBe('320')
    expect(fields['group']).toBe('函数')
    expect(fields['prerequisites']).toEqual([])
  })

  it('认不出的键原样留在 extra 里，不丢', () => {
    const { extra } = parseFrontmatter(NOTE('title: a\n我自己的键: 值'))
    expect(extra).toContain('我自己的键: 值')
  })

  it('没有 frontmatter 的文件不报错，整篇当正文', () => {
    const { fields, body } = parseFrontmatter('就是一段文字\n')
    expect(fields).toEqual({})
    expect(body).toBe('就是一段文字')
  })

  it('frontmatter 没闭合时退回"整篇当正文"，不做半截解析', () => {
    const { fields, body } = parseFrontmatter('---\ntitle: 没关\ntext')
    expect(fields).toEqual({})
    expect(body).toContain('title: 没关')
  })
})

describe('前置连线：[[双链]]', () => {
  it('取出文本里的全部双链', () => {
    expect(wikiLinksIn('见 [[一次函数]] 与 [[配方|配方法]]。')).toEqual(['一次函数', '配方'])
  })

  it('带逗号的节点名不会被切错（引号与双链两层保护）', () => {
    const note = parseKnowledgeNote('k', NOTE('prerequisites: ["[[整式, 运算]]", "[[配方]]"]'))
    expect(note.prerequisites).toEqual(['整式, 运算', '配方'])
  })

  it('空数组不产生一个名叫空串的知识点', () => {
    expect(parseKnowledgeNote('k', NOTE('prerequisites: []')).prerequisites).toEqual([])
    expect(parseKnowledgeNote('k', NOTE('prerequisites: [""]')).prerequisites).toEqual([])
  })

  it('别名写法 [[键|显示名]] 还原成键', () => {
    expect(parseKnowledgeNote('k', NOTE('prerequisites: ["[[一次函数|函数]]"]')).prerequisites).toEqual(['一次函数'])
  })

  it('别名能当引用目标，但解析完存的是键', () => {
    const notes = [
      parseKnowledgeNote('一次函数', NOTE('title: 一次函数\naliases: [正比例函数]')),
      parseKnowledgeNote('图象平移', NOTE('prerequisites: ["[[正比例函数]]"]')),
    ]
    const tree = buildKnowledgeTree(notes)
    expect(tree.graph.nodes['图象平移']?.prerequisites).toEqual(['一次函数'])
    expect(tree.diagnostics).toEqual([])
  })
})

describe('写回文件', () => {
  const note: KnowledgeNote = {
    key: '顶点式',
    title: '顶点式',
    order: 320,
    group: '函数',
    aliases: [],
    prerequisites: ['二次函数图象'],
    note: 'y = a(x-h)² + k：顶点坐标一眼可见的那一种写法\n\n## 学生常在这儿卡住\n\n（老师自己填）',
  }

  it('序列化 → 解析 → 再序列化，逐字节一致（不产生假 diff）', () => {
    const once = serializeKnowledgeNote(note)
    const again = serializeKnowledgeNote(parseKnowledgeNote(note.key, once))
    expect(again).toBe(once)
  })

  it('备注正文一个字都不动', () => {
    const back = parseKnowledgeNote(note.key, serializeKnowledgeNote(note))
    expect(back.note).toBe(note.note)
  })

  it('改一次连线只动 prerequisites 那一行', () => {
    const before = serializeKnowledgeNote(note).split('\n')
    const after = serializeKnowledgeNote({ ...note, prerequisites: ['二次函数图象', '配方'] }).split('\n')
    expect(after.length).toBe(before.length)
    const changed = before.map((line, index) => (line === after[index] ? -1 : index)).filter((index) => index >= 0)
    expect(changed.map((index) => before[index]?.split(':')[0])).toEqual(['prerequisites'])
  })

  it('order 为 0 是"没填"，不写出那一行', () => {
    expect(serializeKnowledgeNote({ ...note, order: 0 })).not.toContain('order:')
  })
})

describe('建树与抱怨', () => {
  it('悬空引用保留成孤立节点并报出来（不能悄悄丢掉）', () => {
    const tree = buildKnowledgeTree([noteOf('A', ['不存在的东西'])])
    expect(tree.graph.nodes['A']?.prerequisites).toEqual(['不存在的东西'])
    expect(tree.diagnostics.map((entry) => entry.kind)).toContain('dangling')
    expect(danglingFor(tree.graph, 'A')).toEqual(['不存在的东西'])
  })

  it('自己指自己算成环，而且是报错不是留一条自环', () => {
    const tree = buildKnowledgeTree([noteOf('A', ['A'])])
    expect(tree.graph.nodes['A']?.prerequisites).toEqual([])
    expect(tree.diagnostics.some((entry) => entry.kind === 'cycle' && entry.key === 'A')).toBe(true)
  })

  it('长环：A→B→C→A 三个都要报出来', () => {
    const graph = {
      nodes: { A: { prerequisites: ['C'] }, B: { prerequisites: ['A'] }, C: { prerequisites: ['B'] } },
    }
    expect(detectCycles(graph)).toEqual(['A', 'B', 'C'])
  })

  it('菱形（两条路到同一个前置）不是环', () => {
    const graph = {
      nodes: { A: {}, B: { prerequisites: ['A'] }, C: { prerequisites: ['A'] }, D: { prerequisites: ['B', 'C'] } },
    }
    expect(detectCycles(graph)).toEqual([])
  })

  it('重名（显示名撞车）报出来，且不动文件键', () => {
    const tree = buildKnowledgeTree([
      { ...noteOf('a'), title: '二次函数' },
      { ...noteOf('b'), title: '二次函数' },
    ])
    expect(tree.diagnostics.some((entry) => entry.kind === 'duplicate')).toBe(true)
    expect(Object.keys(tree.graph.nodes).toSorted()).toEqual(['a', 'b'])
  })

  it('深度 = 前置闭包大小（不含自己）', () => {
    const tree = buildKnowledgeTree([noteOf('A'), noteOf('B', ['A']), noteOf('C', ['B'])])
    expect(depthOf(tree.graph, 'C')).toBe(2)
    expect(depthOf(tree.graph, 'A')).toBe(0)
  })
})

describe('noteKeyOf', () => {
  it('去扩展名、去目录、去空白', () => {
    expect(noteKeyOf('顶点式.md')).toBe('顶点式')
    expect(noteKeyOf('函数/顶点式.md')).toBe('顶点式')
    expect(noteKeyOf('函数\\顶点式.md')).toBe('顶点式')
  })
})

/**
 * 随仓库分发的这棵树**必须是干净的**：老师第一次打开就看到一堆红字，
 * 那不是"提示"，那是没做完。
 */
describe('seed 知识树', () => {
  const dir = join(ROOT, '知识')
  const notes = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseKnowledgeNote(noteKeyOf(name), readFileSync(join(dir, name), 'utf8')))
  const tree = buildKnowledgeTree(notes)

  it('有足够多的知识点，且每个都归了组', () => {
    expect(notes.length).toBeGreaterThanOrEqual(20)
    expect(notes.filter((note) => note.group === '')).toEqual([])
  })

  it('没有悬空引用、没有环、没有重名', () => {
    expect(tree.diagnostics).toEqual([])
  })

  it('迁移是忠实的：JSON 里的每个节点和它的前置都还在', () => {
    const source = JSON.parse(readFileSync(join(ROOT, 'seed/knowledge.json'), 'utf8')) as {
      nodes: Record<string, { prerequisites?: readonly string[] }>
    }
    for (const [key, node] of Object.entries(source.nodes)) {
      expect([...(tree.graph.nodes[key]?.prerequisites ?? [])].toSorted()).toEqual([...(node.prerequisites ?? [])].toSorted())
    }
    // 反方向**故意不查**：真相搬到 Markdown 之后，往树上加知识点是正常操作
    // （老师加的节点不在 JSON 里，这不是"不一致"，这正是这棵树该有的样子）
  })

  it('每个文件都是稳定的（再写一遍不变）', () => {
    for (const note of notes) {
      expect(serializeKnowledgeNote(parseKnowledgeNote(note.key, serializeKnowledgeNote(note)))).toBe(serializeKnowledgeNote(note))
    }
  })
})
