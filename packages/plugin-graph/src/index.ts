import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  buildKnowledgeTree,
  closureOf,
  danglingFor,
  depthOf,
  missingFor,
  noteKeyOf,
  parseKnowledgeNote,
  prerequisitesOf,
  serializeKnowledgeNote,
  type GraphApi,
  type GraphNodeView,
  type KnowledgeDiagnostic,
  type KnowledgeGraph,
  type KnowledgeNodeInput,
  type KnowledgeNote,
  type KnowledgeTreeView,
} from '@examharness/core'
import z from 'schemastery'

/**
 * 知识点图谱。它不是内部数据结构，而是产品的一张脸：
 * - 引导：命题 agent 设计时查合法组合与前置闭包；
 * - 闸门：越界检测（用了未学的知识 → 拒绝）。
 *
 * 真相是**一堆 Markdown 文件**（ADR-0033）：`知识/<知识点>.md`。
 * 老师在 Obsidian 里直接改、agent 也能改，服务读目录、改了重载——
 * 所以本服务多了两个别的服务没有的动作：`reload()` 与 `save()`。
 */

export const name = 'graph'

export const Config = z.object({
  /** 知识点目录：一个知识点一个 `.md`，**这是真相**（ADR-0033） */
  dir: z.string().default('知识'),
  /** 旧的 JSON 图谱文件；只在 `dir` 不存在时用来兜底（迁移期兼容） */
  path: z.string().default('seed/knowledge.json'),
  /**
   * 追加的 **JSON** 图谱文件：课标整理的清单、教材目录整理件……后读到的会并入。
   * Markdown 目录里的文件不从这里走（它们本身就是真相）。
   */
  paths: z.array(z.string()).default([]),
  /** 已学知识点集合；不在其中的前置知识 = 超纲 */
  learned: z.array(z.string()).default([]),
})

export interface GraphConfig {
  dir: string
  path: string
  paths: string[]
  learned: string[]
}

/** 一个知识点在界面上的样子：连线两头都要，所以既有前置也有后继 */
export type { GraphNodeView } from '@examharness/core'

export class GraphService extends Service implements GraphApi {
  static Config = Config

  private readonly config: GraphConfig
  private readonly root: string
  private readonly dir: string
  private data: KnowledgeGraph = { nodes: {} }
  private learned: ReadonlySet<string>
  private notes: readonly KnowledgeNote[] = []
  private diagnostics: readonly KnowledgeDiagnostic[] = []
  /** 这棵树是从哪儿来的：界面上要如实说（目录 / 兜底 JSON） */
  private origin: { kind: 'dir' | 'json'; path: string }

  constructor(ctx: Context, config: GraphConfig) {
    super(ctx, 'graph')
    this.config = config
    this.root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.dir = resolve(this.root, config.dir)
    this.learned = new Set(config.learned)
    // origin 由 load() 决定，这里只占位。**别在 load 之前快照**：
    // 写盘之后再加载时，快照的值还停在旧位置，界面会一直显示"读的是兜底 JSON"
    this.origin = { kind: 'json', path: config.path }
    this.load()
  }

  /** 直接前置 */
  prerequisites(keys: readonly string[]): string[] {
    return prerequisitesOf(this.data, keys)
  }

  /** 前置闭包（含自身） */
  closure(keys: readonly string[]): string[] {
    return closureOf(this.data, keys)
  }

  /**
   * 越界知识点：**闭包里**不在已学集合里的，空数组表示合法。
   * 注意闭包含传入的知识点本身——所以"用了没学过的知识"连它自己一起报（闸门就是这么用的）。
   */
  missing(keys: readonly string[]): string[] {
    return missingFor(this.data, keys, this.learned)
  }

  /** 图谱上的全部知识点 */
  nodes(): readonly string[] {
    return Object.keys(this.data.nodes)
  }

  /** 已学集合（只读视图） */
  learnedKeys(): readonly string[] {
    return [...this.learned]
  }

  /** 重载：文件被改过（老师用编辑器、agent 用工具、界面保存）之后调它 */
  reload(): void {
    this.load()
  }

  /** 这棵树是从哪儿读来的（目录还是兜底 JSON），给界面如实显示 */
  originOf(): { kind: 'dir' | 'json'; path: string } {
    return this.origin
  }

  /** 界面上要画的整棵树 */
  tree(): KnowledgeTreeView {
    const dependents = new Map<string, string[]>()
    for (const note of this.notes) {
      for (const prerequisite of note.prerequisites) {
        const list = dependents.get(prerequisite) ?? []
        list.push(note.key)
        dependents.set(prerequisite, list)
      }
    }
    const nodes: GraphNodeView[] = this.notes.map((note) => ({
      key: note.key,
      title: note.title,
      order: note.order,
      group: note.group,
      aliases: note.aliases,
      prerequisites: note.prerequisites,
      dependents: (dependents.get(note.key) ?? []).toSorted((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
      note: note.note,
      dangling: danglingFor(this.data, note.key),
      depth: depthOf(this.data, note.key),
      file: `${note.key}.md`,
    }))
    return {
      origin: this.origin,
      learned: [...this.learned],
      nodes,
      diagnostics: [...this.diagnostics],
    }
  }

  /**
   * 写一个知识点（新建或改）。连线的增删改都走这里。
   *
   * 两条不变量：
   * - **改名 = 新建 + 删旧的**：节点键就是文件名，改键会让所有引用它的双链变成悬空，
   *   所以这里不允许"改键"，要改键请显式 `remove` 再 `save`。
   * - 写盘前**先建整棵树**验证：写出去的东西自己都读不回来，那是把坑埋给下一次启动。
   */
  save(input: KnowledgeNodeInput): KnowledgeNote {
    const key = input.key.trim()
    assertKey(key)
    const before = this.notes.find((note) => note.key === key)
    const next: KnowledgeNote = {
      key,
      title: (input.title ?? before?.title ?? key).trim() === '' ? key : (input.title ?? before?.title ?? key).trim(),
      order: input.order ?? before?.order ?? 0,
      group: input.group ?? before?.group ?? '',
      aliases: dedupe(input.aliases ?? before?.aliases ?? []),
      prerequisites: dedupe(input.prerequisites ?? before?.prerequisites ?? []),
      note: input.note ?? before?.note ?? '',
    }
    const candidate = [...this.notes.filter((note) => note.key !== key), next]
    const tree = buildKnowledgeTree(candidate)
    const fatal = tree.diagnostics.filter((entry) => entry.kind === 'cycle' && entry.key === key)
    if (fatal.length > 0) throw new Error(`保存被拒：${fatal.map((entry) => entry.detail).join('；')}`)

    // **写解析后的那一份，不是原始输入**：老师写的可能是别名（老叫法），
    // 直接写 next 会把别名原样落进文件，从此这个别名永远是别名，换不回键。
    const normalized = tree.notes.find((note) => note.key === key) ?? next
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${key}.md`), serializeKnowledgeNote(normalized), 'utf8')
    this.load()
    this.changed('saved', key)
    return normalized
  }

  /** 删一个知识点。**不静默**：谁还在引它一并返回，界面上要提醒老师去补线 */
  remove(key: string): { removed: boolean; stillReferencedBy: readonly string[] } {
    const file = join(this.dir, `${key.trim()}.md`)
    const stillReferencedBy = this.notes
      .filter((note) => note.key !== key && note.prerequisites.includes(key))
      .map((note) => note.key)
    if (!existsSync(file)) return { removed: false, stillReferencedBy }
    rmSync(file)
    this.load()
    this.changed('removed', key)
    return { removed: true, stillReferencedBy }
  }

  /** 磁盘上一个知识点的原始文本（界面上的"看文件"用；目录兜底时给空） */
  sourceOf(key: string): string | undefined {
    if (this.origin.kind !== 'dir') return undefined
    const file = join(this.dir, `${key.trim()}.md`)
    if (!existsSync(file)) return undefined
    return readFileSync(file, 'utf8')
  }

  private changed(action: 'saved' | 'removed', key: string): void {
    this.ctx.emit('graph:changed', { action, key, nodes: this.notes.length })
  }

  /** 读目录；目录不在就退回旧的 JSON（迁移期：老仓库还没 `知识/` 时不能让服务起不来） */
  private load(): void {
    this.origin = this.loadDir() ?? this.loadJson()
  }

  private loadDir(): { kind: 'dir'; path: string } | undefined {
    if (!existsSync(this.dir) || !statSync(this.dir).isDirectory()) return undefined
    const notes: KnowledgeNote[] = []
    for (const file of readdirSync(this.dir).toSorted()) {
      if (!file.toLowerCase().endsWith('.md')) continue
      if (file.startsWith('.') || file.startsWith('_')) continue
      try {
        notes.push(parseKnowledgeNote(noteKeyOf(file), readFileSync(join(this.dir, file), 'utf8')))
      } catch {
        // 单个文件读不动不该拖垮整棵树：跳过，界面上少一个节点比服务起不来好
      }
    }
    if (notes.length === 0) return undefined
    this.apply(buildKnowledgeTree(notes))
    return { kind: 'dir', path: this.config.dir }
  }

  private loadJson(): { kind: 'json'; path: string } {
    const nodes: Record<string, { prerequisites?: readonly string[] }> = {}
    for (const relative of [this.config.path, ...this.config.paths]) {
      if (relative === '') continue
      try {
        const part = JSON.parse(readFileSync(resolve(this.root, relative), 'utf8')) as KnowledgeGraph
        for (const [key, node] of Object.entries(part.nodes)) {
          const merged = new Set([...(nodes[key]?.prerequisites ?? []), ...(node.prerequisites ?? [])])
          nodes[key] = { prerequisites: [...merged] }
        }
      } catch {
        // 追加文件缺失/格式错不该拖垮启动
      }
    }
    const notes: KnowledgeNote[] = Object.entries(nodes).map(([key, node]) => ({
      key,
      title: key,
      order: 0,
      group: '',
      aliases: [],
      prerequisites: [...(node.prerequisites ?? [])],
      note: '',
    }))
    this.apply(buildKnowledgeTree(notes))
    return { kind: 'json', path: this.config.path }
  }

  private apply(tree: ReturnType<typeof buildKnowledgeTree>): void {
    this.data = tree.graph
    // **必须存 tree.notes（已解析过的）而不是原始 notes**：
    // 原始 notes 里前置还是"名字"（可能是别名），存下来下一次保存就会把别名原样写进文件，
    // 别名永远变不成键——改一次连线写坏一次文件，而且看上去一切正常。
    this.notes = tree.notes
    this.diagnostics = tree.diagnostics
  }
}

/** 节点键 = 文件名，所以得能当文件名用：不许路径分隔符、不许空、不许前后点 */
function assertKey(key: string): void {
  if (key === '') throw new Error('知识点得有名字')
  if (key.length > 80) throw new Error('知识点名字太长了（80 字以内）')
  if (/[/\\:*?"<>|]/.test(key)) throw new Error('知识点名字里不能有 / \\ : * ? " < > | 这些字符（它要当文件名）')
  if (key.startsWith('.')) throw new Error('知识点名字不能以点开头（会被当成隐藏文件）')
  if (key === '_' || key.startsWith('_')) throw new Error('知识点名字不能以下划线开头（预留给非知识点文件）')
}

function dedupe(list: readonly string[]): string[] {
  const out: string[] = []
  for (const item of list) {
    const text = item.trim()
    if (text !== '' && !out.includes(text)) out.push(text)
  }
  return out
}

export function apply(ctx: Context, config: GraphConfig): void {
  ctx.plugin(GraphService, config)
}
