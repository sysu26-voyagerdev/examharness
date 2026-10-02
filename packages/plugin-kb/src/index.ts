import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { CorpusRecord, KbApi, KbBatch, KbStatus } from '@examharness/core'
import z from 'schemastery'

/**
 * 知识库：**上传的是原料，整理交给 agent**。
 *
 * 用户上传一堆资料（真题、教材整理件、教研笔记），它们先落在"待整理"状态；
 * 然后由 agent 拿工具去干：分片读文件 → 抽成结构化题目记录 → 写入语料 → 标记完成。
 * 这里不做"自动解析器"——因为真实资料的格式千奇百怪，规则写不完，
 * 而"读一段、抽几条、写进去"恰恰是 agent 擅长的。
 *
 * 本服务只负责三件事：**存文件、记状态、提供分片读**（并把 agent 写回来的记录落到索引）。
 */

export const name = 'kb'

export const Config = z.object({
  /**
   * 原料落点。**故意不在语料目录里**：上传件是素材，不是真值——
   * 它没有被任何人核对过，不该进查重的比较集（素材≠真值，见 docs/agent/01）。
   */
  dir: z.string().default('data/kb/uploads'),
  /** 抽取结果落点（在语料目录里：agent 抽出来的题才是可检索、可查重的语料） */
  extractDir: z.string().default('corpus/extracted'),
  /** 整理状态索引 */
  index: z.string().default('data/kb.json'),
  /** 单个文件上限（文本；超了请先切分） */
  maxTextBytes: z.number().default(5_242_880),
})

export interface KbConfig {
  dir: string
  extractDir: string
  index: string
  maxTextBytes: number
}

export class KbService extends Service implements KbApi {
  static Config = Config

  private readonly config: KbConfig
  private readonly root: string
  private readonly dir: string
  private readonly extractDir: string
  private readonly indexFile: string
  private batches: KbBatch[]

  constructor(ctx: Context, config: KbConfig) {
    super(ctx, 'kb')
    this.config = config
    this.root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.dir = resolve(this.root, config.dir)
    this.extractDir = resolve(this.root, config.extractDir)
    this.indexFile = resolve(this.root, config.index)
    mkdirSync(this.dir, { recursive: true })
    mkdirSync(this.extractDir, { recursive: true })
    this.batches = this.load()
  }

  list(): readonly KbBatch[] {
    return this.batches
  }

  upload(title: string, files: readonly { name: string; text: string }[]): KbBatch {
    const id = `kb-${String(Date.now())}`
    const dir = join(this.dir, id)
    mkdirSync(dir, { recursive: true })
    const stored: { name: string; bytes: number }[] = []
    for (const file of files) {
      const safe = file.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120)
      const text = file.text.slice(0, this.config.maxTextBytes)
      writeFileSync(join(dir, safe), text, 'utf8')
      stored.push({ name: safe, bytes: Buffer.byteLength(text, 'utf8') })
    }
    const batch: KbBatch = {
      id,
      name: title === '' ? id : title,
      at: new Date().toISOString(),
      status: 'raw',
      files: stored,
      records: 0,
    }
    this.batches.push(batch)
    this.save()
    this.ctx.emit('kb:changed', { batchId: batch.id, status: batch.status })
    return batch
  }

  /** 分片读：一次别糊太多进上下文（agent 会自己翻页） */
  read(
    batchId: string,
    fileName: string,
    offset = 0,
    limit = 4000,
  ): { text: string; total: number; next?: number } | undefined {
    const file = join(this.dir, batchId, fileName)
    if (!file.startsWith(this.dir) || !existsSync(file)) return undefined
    const text = readFileSync(file, 'utf8')
    const slice = text.slice(offset, offset + limit)
    const next = offset + limit < text.length ? offset + limit : undefined
    return next === undefined ? { text: slice, total: text.length } : { text: slice, total: text.length, next }
  }

  /** agent 抽出来的记录落到**语料目录**里，并让语料库重扫 */
  write(batchId: string, records: readonly CorpusRecord[]): number {
    if (this.batches.every((entry) => entry.id !== batchId)) return 0
    const lines = records.map((record) => JSON.stringify({ ...record, source: `kb:${batchId}` })).join('\n')
    if (lines !== '') appendFileSync(join(this.extractDir, `${batchId}.jsonl`), `${lines}\n`, 'utf8')
    const batch = this.batches.find((entry) => entry.id === batchId)
    if (batch !== undefined) {
      batch.records += records.length
      this.save()
      this.ctx.emit('kb:changed', { batchId, status: batch.status, records: batch.records })
    }
    this.ctx.get('corpus')?.reload()
    return records.length
  }

  mark(batchId: string, status: KbStatus, note?: string): KbBatch | undefined {
    const batch = this.batches.find((entry) => entry.id === batchId)
    if (batch === undefined) return undefined
    batch.status = status
    if (note !== undefined) batch.note = note
    this.save()
    this.ctx.emit('kb:changed', { batchId, status, records: batch.records })
    return batch
  }

  dirOf(batchId: string): string | undefined {
    const dir = join(this.dir, batchId)
    return dir.startsWith(this.dir) && existsSync(dir) ? dir : undefined
  }

  private load(): KbBatch[] {
    if (!existsSync(this.indexFile)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8')) as KbBatch[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private save(): void {
    mkdirSync(resolve(this.indexFile, '..'), { recursive: true })
    writeFileSync(this.indexFile, JSON.stringify(this.batches, null, 1), 'utf8')
  }
}

/** 供上层判断"这个目录有多大"（界面上显示文件数用得到） */
export function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function apply(ctx: Context, config: KbConfig): void {
  ctx.plugin(KbService, config)
}
