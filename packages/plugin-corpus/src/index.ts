import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { CorpusApi, CorpusHit, CorpusRecord } from '@examharness/core'
import { normalize } from '@examharness/core'
import z from 'schemastery'

/**
 * 语料库：真实题库 / 教材整理件的**只读**索引。
 *
 * 它存在的唯一理由是给三件事提供参照：**风格（few-shot）、难度先验、查重对照**。
 * 它**不提供答案**——答案由构造产生（R1）。
 *
 * 与题库严格分开，因为两者的语义完全不同：
 *   - 题库里的东西是我们自己的原创题，可以分发；
 *   - 语料库里的东西是别人的作品，**默认不可分发**（ADR-0014）。
 * 对外只出数字（相似度/原创度），不出原文。
 *
 * 支持直接吃的格式（都是纯文本，不需要额外依赖）：
 *   - `.jsonl`  每行一个对象：{stem, answer?, knowledge?, type?, difficulty?, distributable?, id?}
 *   - `.csv`    表头：stem,answer,knowledge,type,difficulty,distributable（knowledge 用 / 或 ; 分隔）
 *   - `.md`     每段以 `## ` 或 `### ` 开头的标题行作为题干，其余作为答案/解析
 *   - `.txt`    每行一道题（空行忽略）
 * PDF/扫描件请先 OCR 成上述文本；这条流水线还没写。
 */

export const name = 'corpus'

export const Config = z.object({
  /** 扫描哪些目录；不存在就跳过（不报错——语料是可选的） */
  dirs: z.array(z.string()).default(['corpus/questions', 'corpus/textbooks']),
  /** 单条题干最短长度，太短的（页码、标题）直接丢 */
  minLength: z.number().default(8),
  /** 相似度阈值：与原题达到这个相似度就算"抄"，由查重闸门使用 */
  maxSimilarity: z.number().default(0.6),
})

export interface CorpusConfig {
  dirs: string[]
  minLength: number
  maxSimilarity: number
}

/** 字符二元组集合：对中文数学文本够用，且零依赖 */
function bigrams(text: string): Set<string> {
  const chars = [...normalize(text)]
  const out = new Set<string>()
  for (let index = 0; index + 1 < chars.length; index += 1) {
    out.add(`${chars[index] ?? ''}${chars[index + 1] ?? ''}`)
  }
  return out
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const value of left) if (right.has(value)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** 措辞相似度（字符二元组） */
export function similarity(left: string, right: string): number {
  return jaccard(bigrams(left), bigrams(right))
}

/** 题面里出现的数字集合——数学题"是不是同一道"，主要看这个 */
export function numbers(text: string): Set<string> {
  return new Set(normalize(text).match(/\d+(?:\.\d+)?/g) ?? [])
}

export function numberSimilarity(left: string, right: string): number {
  return jaccard(numbers(left), numbers(right))
}

function splitKnowledge(value: string): string[] {
  return value
    .split(/[/;；、|]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function parseJsonl(source: string, text: string): CorpusRecord[] {
  const out: CorpusRecord[] = []
  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    const raw = JSON.parse(trimmed) as Record<string, unknown>
    out.push(record(source, raw, `${source}#${String(index + 1)}`))
  })
  return out
}

function parseCsv(source: string, text: string): CorpusRecord[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const header = (lines.shift() ?? '').split(',').map((cell) => cell.trim())
  return lines.map((line, index) => {
    const cells = line.split(',')
    const raw: Record<string, unknown> = {}
    header.forEach((key, position) => {
      raw[key] = (cells[position] ?? '').trim()
    })
    if (typeof raw.knowledge === 'string') raw.knowledge = splitKnowledge(raw.knowledge)
    if (typeof raw.difficulty === 'string') raw.difficulty = Number(raw.difficulty)
    if (typeof raw.distributable === 'string') raw.distributable = raw.distributable === 'true'
    return record(source, raw, `${source}#${String(index + 1)}`)
  })
}

/** Markdown：`## ` 标题行当题干，其后到下一个标题之间当答案/解析 */
function parseMarkdown(source: string, text: string): CorpusRecord[] {
  const out: CorpusRecord[] = []
  let stem: string | undefined
  let body: string[] = []
  const flush = (): void => {
    if (stem === undefined) return
    out.push(record(source, { stem, answer: body.join('\n').trim() }, `${source}#${String(out.length + 1)}`))
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      stem = line.slice(3).trim()
      body = []
      continue
    }
    if (stem !== undefined) body.push(line)
  }
  flush()
  return out
}

function record(source: string, raw: Record<string, unknown>, fallbackId: string): CorpusRecord {
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : ''
  const knowledge = Array.isArray(raw.knowledge)
    ? raw.knowledge.map(String)
    : typeof raw.knowledge === 'string'
      ? splitKnowledge(raw.knowledge)
      : []
  const difficulty = typeof raw.difficulty === 'number' && Number.isFinite(raw.difficulty) ? raw.difficulty : undefined
  const type = typeof raw.type === 'string' && raw.type !== '' ? raw.type : undefined
  const answer = typeof raw.answer === 'string' && raw.answer !== '' ? raw.answer : undefined
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : fallbackId,
    // 记录可以自己声明来源（agent 抽出来的写 `kb:<批次>`）；没声明就用文件路径
    source: typeof raw.source === 'string' && raw.source !== '' ? raw.source : source,
    stem,
    ...(answer === undefined ? {} : { answer }),
    knowledge,
    ...(type === undefined ? {} : { type }),
    ...(difficulty === undefined ? {} : { difficulty }),
    // 默认不可分发：**要显式写 true 才算可对外**
    distributable: raw.distributable === true,
  }
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out // 目录不存在 = 没有语料，不是错误
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export class CorpusService extends Service implements CorpusApi {
  static Config = Config

  private readonly items: CorpusRecord[] = []
  private readonly config: CorpusConfig
  private readonly root: string

  constructor(ctx: Context, config: CorpusConfig) {
    super(ctx, 'corpus')
    this.config = config
    this.root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.reload()
    // 设置页改了语料目录 → 立刻重扫（目录是热设置，不假装要重启）
    this.ctx.on('settings:changed', () => {
      this.reload()
    })
  }

  /** 重新扫描：上传新知识库后调用，让它立刻可检索 */
  reload(): number {
    this.items.length = 0
    const settings = this.ctx.get('settings')
    const dirs = settings === undefined || settings.get().corpusDirs.length === 0
      ? this.config.dirs
      : settings.get().corpusDirs
    const base = this.root
    for (const dir of dirs) {
      for (const file of walk(resolve(base, dir))) {
        // 来源标识：库内文件用相对路径，库外（测试的临时目录）用文件名
        const rel = relative(base, file)
        const source = rel.startsWith('..') ? basename(file) : rel
        let text: string
        try {
          text = readFileSync(file, 'utf8')
        } catch {
          continue // 二进制/无权限：跳过，别让语料拖垮启动
        }
        const extension = extname(file)
        const parsed =
          extension === '.jsonl'
            ? parseJsonl(source, text)
            : extension === '.csv'
              ? parseCsv(source, text)
              : extension === '.md'
                ? parseMarkdown(source, text)
                : extension === '.txt'
                  ? text
                      .split('\n')
                      .filter((line) => line.trim() !== '')
                      .map((line, index) => record(source, { stem: line.trim() }, `${source}#${String(index + 1)}`))
                  : []
        for (const item of parsed) {
          if (item.stem.length < this.config.minLength) continue
          this.items.push(item)
        }
      }
    }
    return this.items.length
  }

  get size(): number {
    return this.items.length
  }

  records(): readonly CorpusRecord[] {
    return this.items
  }

  /** 引导：按关键词与知识点检索；命中给摘要，全文要 read() */
  search(query: { text?: string; knowledge?: readonly string[]; limit?: number }): readonly CorpusHit[] {
    const text = query.text ?? ''
    const knowledge = query.knowledge ?? []
    const limit = query.limit ?? 5
    const scored = this.items
      .map((item) => {
        const knowledgeHits = knowledge.filter((key) => item.knowledge.includes(key)).length
        const textScore = text === '' ? 0 : 0.6 * similarity(text, item.stem) + 0.4 * numberSimilarity(text, item.stem)
        // 知识点命中优先于关键词命中：老师找参考材料是按知识点找的
        return { item, score: knowledgeHits * 2 + textScore }
      })
      .filter((entry) => entry.score > 0)
      .toSorted((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map(({ item }) => {
      const hit: CorpusHit = {
        id: item.id,
        source: item.source,
        snippet: item.stem.length > 60 ? `${item.stem.slice(0, 60)}…` : item.stem,
        knowledge: item.knowledge,
        distributable: item.distributable,
      }
      if (item.type !== undefined) hit.type = item.type
      if (item.difficulty !== undefined) hit.difficulty = item.difficulty
      return hit
    })
  }

  /** 引导：读全文 */
  read(id: string): CorpusRecord | undefined {
    return this.items.find((item) => item.id === id)
  }

  /** 双指标相似度（引导与闸门共用） */
  compare(text: string): { wording: number; numbers: number; id?: string; source?: string } {
    let best = -1
    let hit: CorpusRecord | undefined
    for (const item of this.items) {
      // 选最近邻用组合分：数字重合为主（数学上像才是真的像），措辞为辅。
      // 只用数字会把"措辞几乎一样但数值不同"的邻居漏掉，报告出来就是骗人的 0.00。
      const score = 0.7 * numberSimilarity(text, item.stem) + 0.3 * similarity(text, item.stem)
      if (score > best) {
        best = score
        hit = item
      }
    }
    if (hit === undefined) return { wording: 0, numbers: 0 }
    return {
      wording: similarity(text, hit.stem),
      numbers: numberSimilarity(text, hit.stem),
      id: hit.id,
      source: hit.source,
    }
  }

  stats(): {
    total: number
    distributable: number
    bySource: Readonly<Record<string, number>>
    byKnowledge: Readonly<Record<string, number>>
  } {
    const bySource: Record<string, number> = {}
    const byKnowledge: Record<string, number> = {}
    for (const item of this.items) {
      bySource[item.source] = (bySource[item.source] ?? 0) + 1
      for (const key of item.knowledge) byKnowledge[key] = (byKnowledge[key] ?? 0) + 1
    }
    return {
      total: this.items.length,
      distributable: this.items.filter((item) => item.distributable).length,
      bySource,
      byKnowledge,
    }
  }
}

export function apply(ctx: Context, config: CorpusConfig): void {
  ctx.plugin(CorpusService, config)
}
