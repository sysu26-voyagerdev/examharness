/**
 * 知识树的**文件形态**：一个知识点一个 `.md`（frontmatter + 备注正文）。
 *
 * 为什么真相是 Markdown 而不是 JSON（ADR-0033）：
 * 这棵树是老师要**读、要改、要带走**的东西——JSON 能存不能读，
 * 而 Obsidian 生态里"一个节点一个文件 + `[[双链]]`"已经是老师的母语。
 * 所以：**文件是真相，JSON 是生成物**（`seed/knowledge.json` 由它导出，只作兼容）。
 *
 * 前置关系写在 frontmatter 的 `prerequisites` 里，用 `[[双链]]`：
 * 这样 Obsidian 的图谱视图能直接把它画成连线（正文里的散链做不到这件事），
 * 而界面改连线时只需要重写 frontmatter ——**老师写的备注正文一个字都不会被碰到**。
 *
 * 本模块是**纯函数**：不碰文件系统、不认识进程，读写在 plugin-graph 里（core 是纯库）。
 */

import { closureOf, type KnowledgeGraph, type KnowledgeNode } from './graph.js'

/** 一个知识点的文件形态 */
export interface KnowledgeNote {
  /** 节点键 = 文件名去掉 `.md`；改名等于改键，所以键一旦定下就别动 */
  key: string
  /** 显示名（frontmatter 的 `title`，缺省用键） */
  title: string
  /**
   * 教学顺序（frontmatter 的 `order`）。
   * **只用来排序与画树，不参与任何判定**——"讲到第几课时"仍由老师说了算（本阶段不接路线计算）。
   */
  order: number
  /** 分册/章节/模块，用来把树分组 */
  group: string
  /** 别名：老叫法、教材上的另一种写法。引用可以写别名，存回时统一成键 */
  aliases: readonly string[]
  /** 前置知识点的**键**（已解析完毕，存的是键不是原样文本） */
  prerequisites: readonly string[]
  /** 备注正文（frontmatter 之后的部分，原样保留） */
  note: string
}

/** 建树时的抱怨：**不抛异常**，因为一棵树坏一个节点不该让服务起不来 */
export interface KnowledgeDiagnostic {
  kind: 'dangling' | 'cycle' | 'duplicate'
  /** 出问题的节点键 */
  key: string
  detail: string
}

export interface KnowledgeTree {
  graph: KnowledgeGraph
  notes: readonly KnowledgeNote[]
  /** 这棵树自己的抱怨（悬空引用 / 成环 / 重名）；空数组表示干净 */
  diagnostics: readonly KnowledgeDiagnostic[]
}

const NOTE_EXTENSION = '.md'
/** 认得的 frontmatter 键：多写的键会**原样保留**在 `extra` 里，不被这里弄丢 */
const KNOWN_KEYS = new Set(['title', 'order', 'group', 'aliases', 'prerequisites'])

/** `[[双链]]`：Obsidian 的写法。别名写法 `[[键|显示名]]` 也认 */
const WIKI_LINK = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g

export function noteKeyOf(fileName: string): string {
  const name = fileName.split(/[/\\]/).pop() ?? fileName
  return name.toLowerCase().endsWith(NOTE_EXTENSION) ? name.slice(0, -NOTE_EXTENSION.length).trim() : name.trim()
}

/**
 * frontmatter 的最小解析：标量 / 行内数组 / `[[双链]]`。
 *
 * 故意不引 `yaml` 包：这里只为认下面这几种写法，而**多引一个依赖要动 cordis.yml 与锁文件**。
 * 认不出的行会被跳过而不是报错——老师的 frontmatter 里可能写着自己的键。
 */
export function parseFrontmatter(source: string): {
  fields: Record<string, string | string[]>
  extra: string[]
  body: string
} {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!text.startsWith('---')) return { fields: {}, extra: [], body: text.trim() }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { fields: {}, extra: [], body: text.trim() }
  const head = text.slice(3, end)
  const body = text.slice(text.indexOf('\n', end + 1) + 1).trim()

  const fields: Record<string, string | string[]> = {}
  const extra: string[] = []
  for (const rawLine of head.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) {
      extra.push(line)
      continue
    }
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    if (!KNOWN_KEYS.has(key)) {
      extra.push(line)
      continue
    }
    fields[key] = raw.startsWith('[') ? parseInlineArray(raw) : unquote(raw)
  }
  return { fields, extra, body }
}

/**
 * `["[[a]]", "b"]` → `['[[a]]', 'b']`；空数组写成 `[]`。
 *
 * 剥外层方括号要**从后往前配对**，不能用 `/\].*$/` 那种正则：
 * 内层全是 `]]`，正则从**第一个** `]` 就开始吞，`"[[A]]"` 会被啃成 `"[[A`。
 * 这个坑在文件里看不出来——写出去的东西看着是对的，读回来少两个字符。
 */
function parseInlineArray(raw: string): string[] {
  const open = raw.indexOf('[')
  const close = raw.lastIndexOf(']')
  if (open === -1 || close <= open) return []
  const inner = raw.slice(open + 1, close).trim()
  if (inner === '') return []
  const items: string[] = []
  for (const piece of splitTopLevel(inner)) {
    const item = unquote(piece.trim())
    if (item !== '') items.push(item)
  }
  return items
}

/**
 * 按逗号切，但**不切引号里的、也不切 `[[ ]]` 里的**。
 *
 * 写出来的行长这样：`prerequisites: ["[[顶点式]]", "[[对称轴]]"]`。两种保护缺一不可，而且有**优先级**：
 * 方括号深度优先——只要还在 `[[ ]]` 里面，逗号一律不是分隔符。
 * 反过来先看引号就会踩坑：`"` 一旦把"引号中"置位，`[[整式, 运算]]` 里那个逗号就照切不误
 * （引号里居然还有分隔符，这个反直觉的点就是坑本身）。
 */
function splitTopLevel(text: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    // 双链内部：只认结束的 ]]，其余字符（含逗号、引号）都只是名字的一部分
    if (depth > 0) {
      if (char === ']' && text[index + 1] === ']') {
        depth -= 1
        current += ']]'
        index += 1
        continue
      }
      current += char
      continue
    }
    if (char === '"') {
      quoted = !quoted
      current += char
      continue
    }
    if (!quoted && char === '[' && text[index + 1] === '[') {
      depth += 1
      current += '[['
      index += 1
      continue
    }
    if (!quoted && char === ',') {
      out.push(current)
      current = ''
      continue
    }
    current += char
  }
  out.push(current)
  return out
}

/**
 * 剥掉一层的引号。
 * **空引号要还原成空串**：`"".trim()` 还是 `""`，不特判的话它会被当成一个叫 `""` 的知识点。
 */
function unquote(raw: string): string {
  const text = raw.trim()
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1)
  }
  return text
}

/** 取出文本里的全部 `[[双链]]` 目标（不解析，只取名字） */
export function wikiLinksIn(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(WIKI_LINK)) {
    const target = (match[1] ?? '').trim()
    if (target !== '') out.push(target)
  }
  return out
}

/** 解析一个 `.md` 文件。`key` 由调用方给（= 文件名去扩展名） */
export function parseKnowledgeNote(key: string, source: string): KnowledgeNote {
  const { fields, body } = parseFrontmatter(source)
  const title = typeof fields['title'] === 'string' && fields['title'].trim() !== '' ? fields['title'].trim() : key
  const order = Number(typeof fields['order'] === 'string' ? fields['order'] : '')
  const group = typeof fields['group'] === 'string' ? fields['group'].trim() : ''
  const aliases = asArray(fields['aliases']).map(unwrapLink).filter((alias) => alias !== '')
  const prerequisites = asArray(fields['prerequisites']).map(unwrapLink).filter((name) => name !== '')
  return {
    key,
    title,
    order: Number.isFinite(order) ? order : 0,
    group,
    aliases,
    prerequisites,
    note: body,
  }
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? [...value] : [value]
}

/** `[[一次函数]]` → `一次函数`；顺手把别名写法 `[[键|显示名]]` 还原成键 */
function unwrapLink(raw: string): string {
  const text = raw.trim()
  const match = /^\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]$/.exec(text)
  if (match !== null) return (match[1] ?? '').trim()
  return text
}

/**
 * 把知识点写回 Markdown。**顺序固定**：frontmatter 键序一致，改一次连线的 diff 只有一行。
 * 备注正文原样跟在后面。
 */
export function serializeKnowledgeNote(note: KnowledgeNote): string {
  const lines = ['---', `title: ${quoteIfNeeded(note.title)}`]
  // 0 是"没填"而不是"排在第 0 个"：不写出来，免得每个文件都多一行噪音
  if (note.order !== 0) lines.push(`order: ${String(note.order)}`)
  if (note.group !== '') lines.push(`group: ${quoteIfNeeded(note.group)}`)
  if (note.aliases.length > 0) lines.push(`aliases: [${note.aliases.map((alias) => quoteIfNeeded(alias)).join(', ')}]`)
  // 前置**一个都不写**时留空数组而不是省掉这一行：省掉就看不出"这个节点改过没有"
  // 双链本身带方括号，**不再另外包一层**——包了就会被 JSON 转义成 ["[[\"[[x]]"] 这种谁也读不懂的东西
  lines.push(`prerequisites: [${note.prerequisites.map((key) => JSON.stringify(`[[${key}]]`)).join(', ')}]`)
  lines.push('---', '')
  const body = note.note.trim()
  return body === '' ? `${lines.join('\n')}\n` : `${lines.join('\n')}\n${body}\n`
}

/** 名字里有 YAML 的元字符就加引号；干净的名字不加（diff 好看） */
function quoteIfNeeded(text: string): string {
  return /^[\w\u4e00-\u9fa5·（）()\-+.]+$/.test(text) ? text : JSON.stringify(text)
}

/**
 * 建图：把节点集合变成 `KnowledgeGraph`，同时**把话说清楚**——
 * 悬空引用（引了不存在的节点）、重名、前置成环，都在这里报出来。
 *
 * 悬空引用**保留成孤立节点**而不是丢掉：丢掉了老师就看不见自己写错了；
 * 保留下来，虽然查闭包查不到它，但界面上会明确标红。
 */
export function buildKnowledgeTree(notes: readonly KnowledgeNote[]): KnowledgeTree {
  const keys = new Set(notes.map((note) => note.key))
  const diagnostics: KnowledgeDiagnostic[] = []

  // 别名 → 键；键优先于别名（别名撞车不该悄悄改掉引用目标）
  const byName = new Map<string, string>()
  for (const note of notes) byName.set(note.key, note.key)
  for (const note of notes) {
    for (const alias of note.aliases) {
      if (byName.has(alias)) continue
      byName.set(alias, note.key)
    }
  }

  const nodes: Record<string, KnowledgeNode> = {}
  const resolved: KnowledgeNote[] = []
  for (const note of notes) {
    const prerequisites: string[] = []
    for (const name of note.prerequisites) {
      const target = byName.get(name) ?? (keys.has(name) ? name : undefined)
      if (target === undefined) {
        diagnostics.push({ kind: 'dangling', key: note.key, detail: `引用了不存在的知识点「${name}」` })
        prerequisites.push(name)
        continue
      }
      if (target === note.key) {
        diagnostics.push({ kind: 'cycle', key: note.key, detail: '把自己写成了自己的前置' })
        continue
      }
      if (!prerequisites.includes(target)) prerequisites.push(target)
    }
    nodes[note.key] = { prerequisites }
    resolved.push({ ...note, prerequisites })
  }

  const graph: KnowledgeGraph = { nodes }
  for (const key of detectCycles(graph)) {
    diagnostics.push({ kind: 'cycle', key, detail: '前置关系成环：这组知识点互相要求先学' })
  }

  // 重名只在"显示名"层面看：文件键不会重（一文件一键），但两个文件可能都叫「二次函数」
  const byTitle = new Map<string, string[]>()
  for (const note of notes) {
    const list = byTitle.get(note.title) ?? []
    list.push(note.key)
    byTitle.set(note.title, list)
  }
  for (const [title, list] of byTitle) {
    if (list.length > 1) {
      diagnostics.push({ kind: 'duplicate', key: list[0] ?? '', detail: `${String(list.length)} 个知识点都叫「${title}」：${list.join('、')}` })
    }
  }

  return { graph, notes: resolved.toSorted(compareNotes), diagnostics }
}

/** 树上的顺序：先按分组，再按 order，最后按名字（保证渲染稳定） */
function compareNotes(a: KnowledgeNote, b: KnowledgeNote): number {
  if (a.group !== b.group) return a.group.localeCompare(b.group, 'zh-Hans-CN')
  if (a.order !== b.order) return a.order - b.order
  return a.key.localeCompare(b.key, 'zh-Hans-CN')
}

/**
 * 找成环的节点。
 *
 * 为什么非找不可：`closureOf` 是**查已学/判超纲**用的，环会让闭包无限扩张；
 * 更糟的是环在界面上看不出来——树画出来是漂亮的，判定却是错的。
 */
export function detectCycles(graph: KnowledgeGraph): string[] {
  const state = new Map<string, 'visiting' | 'done'>()
  const bad = new Set<string>()
  const visit = (key: string, stack: string[]): void => {
    const current = state.get(key)
    if (current === 'visiting') {
      // 环上的每一个都在栈里：从它第一次出现的位置起全标上
      const from = stack.indexOf(key)
      for (const member of stack.slice(from === -1 ? 0 : from)) bad.add(member)
      return
    }
    if (current === 'done') return
    state.set(key, 'visiting')
    for (const prerequisite of graph.nodes[key]?.prerequisites ?? []) {
      if (graph.nodes[prerequisite] !== undefined) visit(prerequisite, [...stack, key])
    }
    state.set(key, 'done')
  }
  for (const key of Object.keys(graph.nodes)) visit(key, [])
  return [...bad].toSorted((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/**
 * 一个节点欠哪些前置还没搭好（**只报一层**，不做闭包）。
 * 这是界面上"这条线画不通"的提示，不是闸门判定。
 */
export function danglingFor(graph: KnowledgeGraph, key: string): string[] {
  return (graph.nodes[key]?.prerequisites ?? []).filter((prerequisite) => graph.nodes[prerequisite] === undefined)
}

/** 闭包复用：给界面显示"这个知识点一共压着多少个前置" */
export function depthOf(graph: KnowledgeGraph, key: string): number {
  return Math.max(0, closureOf(graph, [key]).length - 1)
}
