import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { DocApi, DocBuild, DocExtract, WorkspaceApi } from '@examharness/core'
import z from 'schemastery'

/**
 * 文档与 OCR：**把常见格式一次读成文字**，别让模型每次现写脚本。
 *
 * 老师手里的资料是 PDF、Word、Excel、手机拍的卷子——标准库一个也解不了。
 * 这里内置四种读法（纯文本 / PDF / Word / Excel）与 OCR（图片、扫描版 PDF），
 * 都跑在仓库的虚拟环境里（`pnpm venv`），语言包放在 `data/tessdata`（`pnpm ocr:lang`）。
 *
 * 三条自觉：
 *   1. **干不了就说干不了**：没装库、缺语言包、扫描太糊，都如实回一句，并给出下一步；
 *   2. **不做假的成功**：识别结果为空就报空，不拿模型猜一段文字顶上；
 *   3. **文件只在工作区里**：路径相对工作区，跑不出工作区之外（和 ws_* 同一套边界）。
 *
 * 复杂版式（双栏、图文混排、手写）它读不好——那时模型可以照旧用 ws_run 自己写脚本，
 * 工具里也会这么告诉它。
 */

export const name = 'doc'
export const inject = ['workspace']

export const Config = z.object({
  /** 提取脚本（仓库自带，模型不写它） */
  script: z.string().default('scripts/extract.py'),
  /** 整份整理脚本（OCR + 抽示例题/内容要求） */
  curriculumScript: z.string().default('scripts/curriculum.py'),
  /** 脚本一次最多抽多少字（全文，会写到 out/extract/ 里）：一本教材也就几十万字 */
  maxChars: z.number().default(400_000),
  /**
   * 给**模型**看的开头有多少字。整篇原文进上下文会直接爆掉
   * （一本教材十几万字）——全文落盘，模型需要哪段用 ws_grep / ws_read 去取。
   */
  previewChars: z.number().default(1200),
  /**
   * 单次调用超时：**整份 OCR 要几分钟**（189 页扫描件约 1 分钟，并行后更快），
   * 超时定小了会逼模型自己写脚本分页跑——那才是真正慢的原因（每页一次模型往返）。
   */
  timeoutMs: z.number().default(1_800_000),
})

export interface DocConfig {
  script: string
  curriculumScript: string
  maxChars: number
  previewChars: number
  timeoutMs: number
}

interface RawResult {
  ok: boolean
  kind?: string
  pages?: number | null
  chars?: number
  truncated?: boolean
  needs_ocr?: boolean
  text?: string
  notes?: string[]
  error?: string
}

export class DocService extends Service implements DocApi {
  static Config = Config

  private readonly config: DocConfig
  private readonly script: string
  private readonly base: string

  constructor(ctx: Context, config: DocConfig) {
    super(ctx, 'doc')
    this.config = config
    this.base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.script = resolve(this.base, config.script)
  }

  /**
   * 整份读成资料：跑仓库自带的 curriculum 脚本（OCR + 抽示例题/内容要求），
   * 产物落在工作区 out/curriculum/ 下。整理 agent 只要调它，不必自己摸索分页与页码定位。
   */
  build(workspace: string, paths: readonly string[]): DocBuild {
    const root = this.ctx.workspace.dirOf(workspace)
    if (root === undefined) return { ok: false, outputs: [], books: [], notes: [], error: '没有这个工作区' }
    if (paths.length === 0) return { ok: false, outputs: [], books: [], notes: [], error: '没给文件' }
    const script = resolve(this.base, this.config.curriculumScript)
    if (!existsSync(script)) {
      return { ok: false, outputs: [], books: [], notes: [], error: `找不到脚本：${this.config.curriculumScript}` }
    }
    const result = spawnSync(this.python(), [script, 'build', ...paths, '--outdir', 'out/curriculum'], {
      cwd: root,
      encoding: 'utf8',
      timeout: this.config.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    })
    const parsed = ((): { ok?: boolean; books?: { source: string; pages: number; examples: number; requirements: number }[] } | undefined => {
      const line = (result.stdout ?? '').trim().split('\n').at(-1) ?? ''
      try {
        return JSON.parse(line) as { ok?: boolean; books?: { source: string; pages: number; examples: number; requirements: number }[] }
      } catch {
        return undefined
      }
    })()
    const outputs = this.listOutputs(workspace)
    if (parsed?.ok !== true) {
      return {
        ok: false,
        outputs,
        books: parsed?.books ?? [],
        notes: [],
        error: (result.stderr ?? '').trim().slice(0, 400) || '脚本没有跑成功',
      }
    }
    return { ok: true, outputs, books: parsed.books ?? [], notes: [] }
  }

  /** out/curriculum 下产出了什么 */
  private listOutputs(workspace: string): readonly string[] {
    return this.ctx.workspace
      .list(workspace)
      .map((file) => file.path)
      .filter((path) => path.startsWith('out/curriculum/'))
      .slice(0, 40)
  }

  /** 用哪个 python：工作区服务认得的虚拟环境优先，其次系统 python3 */
  private python(): string {
    const workspace: WorkspaceApi = this.ctx.workspace
    return workspace.venvPython() ?? 'python3'
  }

  available(): boolean {
    return existsSync(this.script)
  }

  probe(workspace: string, path: string): DocExtract {
    return this.invoke(workspace, ['probe', path])
  }

  extract(workspace: string, path: string, options: { ocr?: boolean } = {}): DocExtract {
    const target = this.resolveIn(workspace, path)
    if (target === undefined) {
      return { ok: false, kind: 'unknown', chars: 0, text: '', notes: [], error: '路径不在工作区里' }
    }
    const suffix = target.toLowerCase()
    const mode = suffix.endsWith('.pdf')
      ? 'pdf'
      : suffix.endsWith('.docx')
        ? 'docx'
        : suffix.endsWith('.xlsx') || suffix.endsWith('.xlsm')
          ? 'xlsx'
          : 'text'
    const args = [mode, path, '--max', String(this.config.maxChars)]
    if (options.ocr === true && mode === 'pdf') args.push('--ocr')
    return this.invoke(workspace, args)
  }

  ocr(workspace: string, path: string, lang?: string): DocExtract {
    const args = ['ocr', path, '--max', String(this.config.maxChars)]
    if (lang !== undefined && lang !== '') args.push('--lang', lang)
    return this.invoke(workspace, args)
  }

  private resolveIn(workspace: string, path: string): string | undefined {
    const root = this.ctx.workspace.dirOf(workspace)
    if (root === undefined || path === '' || path.startsWith('/')) return undefined
    const full = resolve(root, path)
    return full.startsWith(root) ? full : undefined
  }

  /** 抽出来的全文写进工作区，返回相对路径：给模型的是"文件在哪 + 开头长什么样" */
  private saveFullText(workspace: string, path: string, text: string): string | undefined {
    if (text === '') return undefined
    const safe = path.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(-80)
    const written = this.ctx.workspace.write(workspace, `out/extract/${safe}.txt`, text)
    return written?.path
  }

  private invoke(workspace: string, args: readonly string[]): DocExtract {
    if (!this.available()) {
      return { ok: false, kind: 'unknown', chars: 0, text: '', notes: [], error: `找不到提取脚本：${this.config.script}` }
    }
    const root = this.ctx.workspace.dirOf(workspace)
    if (root === undefined) {
      return { ok: false, kind: 'unknown', chars: 0, text: '', notes: [], error: '没有这个工作区' }
    }
    const result = spawnSync(this.python(), [this.script, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: this.config.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    })
    const stdout = result.stdout ?? ''
    const parsed = this.parse(stdout)
    if (parsed !== undefined) return this.shrink(workspace, parsed, args)
    const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    return {
      ok: false,
      kind: 'unknown',
      chars: 0,
      text: '',
      notes: [],
      error: timedOut
        ? `读取超时（${String(this.config.timeoutMs)} ms）：文件可能太大，先切小一点，或者只读其中几页`
        : (result.stderr ?? '').trim().slice(0, 300) || '读取失败，没有输出',
    }
  }

  /** 全文落盘，只留开头给模型看（`fullPath` 告诉它去哪儿取剩下的） */
  private shrink(workspace: string, parsed: DocExtract, args: readonly string[]): DocExtract {
    if (!parsed.ok || parsed.text.length <= this.config.previewChars) return parsed
    const source = args[1] ?? 'document'
    const fullPath = this.saveFullText(workspace, source, parsed.text)
    const head = parsed.text.slice(0, this.config.previewChars)
    return {
      ...parsed,
      text: head,
      ...(fullPath === undefined ? {} : { fullPath }),
      notes: [
        ...parsed.notes,
        `全文 ${String(parsed.chars)} 字已写到 ${fullPath ?? '（写盘失败）'}：这里只给你开头 ${String(head.length)} 字，` +
          '要哪一段用 ws_grep 找、ws_read 分片读',
      ],
    }
  }

  private parse(stdout: string): DocExtract | undefined {
    const line = stdout.trim().split('\n').at(-1) ?? ''
    if (line === '') return undefined
    let raw: RawResult
    try {
      raw = JSON.parse(line) as RawResult
    } catch {
      return undefined
    }
    return {
      ok: raw.ok,
      kind: raw.kind ?? 'unknown',
      chars: raw.chars ?? 0,
      text: raw.text ?? '',
      notes: raw.notes ?? [],
      ...(raw.pages === undefined || raw.pages === null ? {} : { pages: raw.pages }),
      ...(raw.truncated === undefined ? {} : { truncated: raw.truncated }),
      ...(raw.needs_ocr === undefined ? {} : { needsOcr: raw.needs_ocr }),
      ...(raw.error === undefined ? {} : { error: raw.error }),
    }
  }
}

export function apply(ctx: Context, config: DocConfig): void {
  ctx.plugin(DocService, config)
}
