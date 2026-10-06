import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
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
  /** 单个文件上限（超了先切分：几十 MB 的扫描件请分册） */
  maxTextBytes: z.number().default(5_242_880),
  maxFileBytes: z.number().default(20_971_520),
})

export interface KbConfig {
  dir: string
  extractDir: string
  index: string
  maxTextBytes: number
  maxFileBytes: number
  maxImportFiles: number
}

/** 收哪些类型：认得出来的资料。认不出来的（二进制包、压缩包）不进来，让老师自己解。 */
const KEEP = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.txt', '.md', '.csv', '.jsonl', '.png', '.jpg', '.jpeg'])
const TEXT = new Set(['.txt', '.md', '.csv', '.jsonl', '.json'])

function newBatchId(): string {
  return `kb-${String(Date.now())}-${randomUUID().slice(0, 8)}`
}

/** 跨平台可保存；重名另存一份，绝不能覆盖原件。 */
function uploadName(filename: string, used: Set<string>): string {
  let safe = [...filename.normalize('NFC')].map((char) => char.charCodeAt(0) < 32 ? '_' : char).join('')
    .replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/, '')
  if (safe === '') throw new Error('文件名不能为空或只有句点')
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`
  const ext = extname(safe).slice(0, 16)
  const stem = safe.slice(0, safe.length - extname(safe).length).slice(0, 100) || '资料'
  safe = `${stem}${ext}`
  for (let n = 2; used.has(safe.toLowerCase()); n += 1) safe = `${stem} (${String(n)})${ext}`
  used.add(safe.toLowerCase())
  return safe
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const full = join(dir, entry)
    try {
      if (statSync(full).isDirectory()) {
        if (depth < 4) walk(full, out, depth + 1)
      } else out.push(full)
    } catch {
      /* 读不到就跳过 */
    }
  }
  return out
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
    // 上次进程没了，那一轮整理就永远不会回来：**启动即归零**，别让它卡在"整理中"
    // （卡住的后果不只是显示错了，前端还会因此不让重新整理）
    let recovered = 0
    for (const batch of this.batches) {
      if (batch.status !== 'ingesting') continue
      batch.status = 'failed'
      batch.note = '上次整理没跑完（服务重启过）：可以重新整理'
      recovered += 1
    }
    if (recovered > 0) this.save()
  }

  list(): readonly KbBatch[] {
    return this.batches
  }

  upload(title: string, files: readonly { name: string; text?: string; base64?: string }[]): KbBatch {
    if (files.length === 0) throw new Error('请先选择文件')
    const used = new Set<string>()
    // 先核对整批，再落盘；失败不会留下半批文件，更不会悄悄截断原件。
    const prepared = files.map((file) => {
      const safe = uploadName(file.name, used)
      if ((file.text === undefined) === (file.base64 === undefined)) {
        throw new Error(`「${file.name}」必须提供且只能提供一种文件内容`)
      }
      // 大文件不能用重复分组匹配，否则数 MB 的正常内容也会耗尽正则调用栈。
      if (file.base64 !== undefined && (file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))) {
        throw new Error(`「${file.name}」的文件编码损坏，请重新选择文件`)
      }
      const body = file.base64 === undefined ? Buffer.from(file.text ?? '', 'utf8') : Buffer.from(file.base64, 'base64')
      if (file.base64 !== undefined && body.toString('base64') !== file.base64) throw new Error(`「${file.name}」的文件编码损坏，请重新选择文件`)
      if (body.length === 0) throw new Error(`「${file.name}」是空文件，请移除后重试`)
      const limit = file.text !== undefined || TEXT.has(extname(safe).toLowerCase()) ? this.config.maxTextBytes : this.config.maxFileBytes
      if (body.length > limit) throw new Error(`「${file.name}」超过单文件上限（${String(limit)} 字节），请分割文件或从本机文件夹导入`)
      return { name: safe, body }
    })
    const id = newBatchId()
    const dir = join(this.dir, id)
    const batch: KbBatch = {
      id,
      name: title.trim() || (files.length === 1 ? files[0]?.name ?? id : `${String(files.length)} 份资料`),
      at: new Date().toISOString(),
      status: 'raw',
      files: prepared.map((file) => ({ name: file.name, bytes: file.body.length })),
      records: 0,
    }
    mkdirSync(dir)
    try {
      for (const file of prepared) writeFileSync(join(dir, file.name), file.body, { flag: 'wx' })
      this.batches.push(batch)
      this.save()
    } catch (error) {
      this.batches = this.batches.filter((entry) => entry.id !== id)
      // dir 是本次独占创建、位于 uploads 下的批次目录。
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
    this.ctx.emit('kb:changed', { batchId: batch.id, status: batch.status })
    return batch
  }

  /**
   * 从本机文件夹导入资料：**文件原地不动**。
   * 教材/课标动辄几十 GB，复制一份既慢又占地方；工作区用符号链接把它们铺进 in/，
   * agent 照常按相对路径读。
   */
  importDir(title: string, dir: string): KbBatch {
    if (dir.trim() === '') throw new Error('请填写本机文件夹路径')
    const root = resolve(dir.replace(/^~(?=\/)/, process.env['HOME'] ?? '~'))
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new Error(`不是文件夹：${dir}`)
    }
    const files: { name: string; bytes: number }[] = []
    for (const file of walk(root)) {
      if (files.length >= this.config.maxImportFiles) break
      if (!KEEP.has(extname(file).toLowerCase())) continue
      try {
        files.push({ name: relative(root, file).split('\\').join('/'), bytes: statSync(file).size })
      } catch {
        /* 读不到就跳过 */
      }
    }
    if (files.length === 0) throw new Error(`这个文件夹里没有认得的资料（${[...KEEP].join(' ')}）`)
    const id = newBatchId()
    const batch: KbBatch = {
      id,
      name: title === '' ? basename(root) : title,
      at: new Date().toISOString(),
      status: 'raw',
      files,
      records: 0,
      sourceDir: root,
    }
    this.batches.push(batch)
    this.save()
    this.ctx.emit('kb:changed', { batchId: batch.id, status: batch.status })
    return batch
  }

  sourcePaths(batchId: string): readonly string[] {
    const batch = this.batches.find((entry) => entry.id === batchId)
    if (batch === undefined) return []
    const root = batch.sourceDir ?? join(this.dir, batchId)
    return batch.files.map((file) => join(root, file.name))
  }

  /** 分片读：一次别糊太多进上下文（agent 会自己翻页） */
  read(
    batchId: string,
    fileName: string,
    offset = 0,
    limit = 4000,
  ): { text: string; total: number; next?: number } | undefined {
    const batch = this.batches.find((entry) => entry.id === batchId)
    if (batch === undefined || !batch.files.some((entry) => entry.name === fileName)) return undefined
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) return undefined
    const boundary = resolve(batch.sourceDir ?? join(this.dir, batch.id))
    const file = resolve(boundary, fileName)
    if (!existsSync(file)) return undefined
    const within = relative(realpathSync(boundary), realpathSync(file))
    if (within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within) || !statSync(file).isFile()) return undefined
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
    const batch = this.batches.find((entry) => entry.id === batchId)
    if (batch === undefined) return undefined
    const dir = batch?.sourceDir ?? join(this.dir, batchId)
    return existsSync(dir) ? dir : undefined
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
    const pending = `${this.indexFile}.${randomUUID()}.tmp`
    try {
      writeFileSync(pending, JSON.stringify(this.batches, null, 1), 'utf8')
      renameSync(pending, this.indexFile)
    } finally {
      rmSync(pending, { force: true })
    }
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
