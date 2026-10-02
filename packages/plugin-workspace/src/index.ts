import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { WorkspaceApi, WorkspaceFile, WorkspaceRun } from '@examharness/core'
import z from 'schemastery'

/**
 * 工作区：**agent 的手脚**（ADR-0020）。
 *
 * 一个工作区就是一个目录：
 *   `in/`  原件副本（PDF、docx、真题文本……原件不动手，只复制进来处理）
 *   `tmp/` agent 自己写的脚本（要先落成文件再跑，跑过的东西可复查）
 *   `out/` 跑出来的文本/中间产物（交给 kb_write 或别处使用）
 *
 * 三条自觉：
 *   1. **不是沙箱**：进程没有被隔离，跑的是本机 python。别在文档里吹成沙箱。
 *   2. **要跑的先落成文件**：不允许 `python3 -c "..."` 这种一行代码——
 *      跑过的东西必须留在工作区里能被复查（这是可审计性，不是安全边界）。
 *   3. **边界要挡**：命令走白名单 + 路径不许 `..`/绝对路径 + 有超时和输出上限；
 *      装包默认关闭（agent 不该悄悄往 venv 里装东西）。
 *
 * venv 优先：配置里的虚拟环境存在时，`python3`/`pip` 一律解析到它的可执行文件，
 * 这样 agent 装的库（pdfplumber 之类）与系统 python 不互相污染。
 */

export const name = 'workspace'

export const Config = z.object({
  /** 工作区根目录（运行期数据，不进 Git） */
  dir: z.string().default('data/workspaces'),
  /** 虚拟环境目录（相对仓库根）；不存在时 `pnpm venv` 建一个 */
  venv: z.string().default('.venv'),
  /** 允许跑的可执行文件（写 basename；`python3`/`pip` 会被解析到 venv） */
  allow: z
    .array(z.string())
    .default([
      'python3',
      'python',
      'node',
      'pdftotext',
      'tesseract',
      'ls',
      'cat',
      'head',
      'tail',
      'wc',
      'grep',
      'sort',
      'uniq',
      'cut',
      'iconv',
      'file',
      'cp',
      'mv',
      'mkdir',
      'find',
      'unzip',
    ]),
  /** 允许 agent 自己 `pip install` 吗（默认不许：装包是人的决定） */
  allowInstall: z.boolean().default(false),
  /** 单条命令超时 */
  timeoutMs: z.number().default(60_000),
  /** 给模型的 stdout/stderr 上限（超了截断并注明） */
  maxOutputBytes: z.number().default(20_000),
  /** 单文件上限（写/复制） */
  maxFileBytes: z.number().default(2_000_000),
  /** 一次列目录最多返回多少个文件 */
  maxListed: z.number().default(200),
})

export interface WorkspaceConfig {
  dir: string
  venv: string
  allow: string[]
  allowInstall: boolean
  timeoutMs: number
  maxOutputBytes: number
  maxFileBytes: number
  maxListed: number
}

/** `python3 -c "任意代码"` 这类内联代码一律不许：要跑的先落成文件 */
const INLINE_CODE_FLAGS = new Set(['-c', '-e', '--eval', '-i', '--command', '--expression'])
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断，共 ${String(text.length)} 字）`
}

export class WorkspaceService extends Service implements WorkspaceApi {
  static Config = Config

  private readonly config: WorkspaceConfig
  private readonly root: string
  private readonly base: string

  constructor(ctx: Context, config: WorkspaceConfig) {
    super(ctx, 'workspace')
    this.config = config
    this.root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.base = resolve(this.root, config.dir)
    mkdirSync(this.base, { recursive: true })
  }

  open(wsName: string): { name: string; path: string; files: readonly WorkspaceFile[] } {
    const safe = this.safeName(wsName)
    const path = join(this.base, safe)
    for (const sub of ['in', 'tmp', 'out']) mkdirSync(join(path, sub), { recursive: true })
    return { name: safe, path, files: this.list(safe) }
  }

  seed(wsName: string, sources: readonly string[]): number {
    const safe = this.safeName(wsName)
    const target = join(this.base, safe, 'in')
    mkdirSync(target, { recursive: true })
    let copied = 0
    for (const source of sources) {
      try {
        if (!existsSync(source) || !statSync(source).isFile()) continue
        if (statSync(source).size > this.config.maxFileBytes) continue
        copyFileSync(source, join(target, basename(source)))
        copied += 1
      } catch {
        /* 复制失败就跳过：原件读不了不该让整轮崩掉 */
      }
    }
    if (copied > 0) this.changed(safe)
    return copied
  }

  /**
   * 把外部文件**以符号链接**铺进 `in/`：教材、课标动辄几十 GB，复制一份既慢又占地方。
   * 链接失败（跨文件系统等）就退回复制——别因为一个链接失败就让老师没法干活。
   */
  seedLinks(wsName: string, sources: readonly string[]): number {
    const safe = this.safeName(wsName)
    const target = join(this.base, safe, 'in')
    mkdirSync(target, { recursive: true })
    let linked = 0
    for (const source of sources) {
      try {
        if (!existsSync(source)) continue
        const link = join(target, basename(source))
        // 已经铺过的算数：重复整理同一批时不该报"0 份"
        if (existsSync(link)) {
          linked += 1
          continue
        }
        symlinkSync(source, link)
        linked += 1
      } catch {
        try {
          copyFileSync(source, join(target, basename(source)))
          linked += 1
        } catch {
          /* 复制也不行就跳过 */
        }
      }
    }
    if (linked > 0) this.changed(safe)
    return linked
  }

  list(wsName: string): readonly WorkspaceFile[] {
    const root = this.dirOf(wsName)
    if (root === undefined) return []
    const out: WorkspaceFile[] = []
    const walk = (dir: string): void => {
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= this.config.maxListed) return
        const full = join(dir, entry)
        try {
          const info = statSync(full)
          if (info.isDirectory()) walk(full)
          else {
            out.push({
              path: relative(root, full).split('\\').join('/'),
              bytes: info.size,
              at: info.mtime.toISOString(),
            })
          }
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
    walk(root)
    return out.toSorted((a, b) => a.path.localeCompare(b.path))
  }

  read(
    wsName: string,
    relPath: string,
    offset = 0,
    limit = 4000,
  ): { text: string; total: number; next?: number } | undefined {
    const file = this.fileOf(wsName, relPath, false)
    if (file === undefined || !existsSync(file)) return undefined
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return undefined // 二进制/无权限
    }
    const slice = text.slice(offset, offset + limit)
    const next = offset + limit < text.length ? offset + limit : undefined
    return next === undefined ? { text: slice, total: text.length } : { text: slice, total: text.length, next }
  }

  write(wsName: string, relPath: string, text: string): { path: string; bytes: number } | undefined {
    const safe = this.safeName(wsName)
    const file = this.fileOf(safe, relPath, true)
    if (file === undefined) return undefined
    const body = text.slice(0, this.config.maxFileBytes)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body, 'utf8')
    const bytes = Buffer.byteLength(body, 'utf8')
    this.changed(safe)
    return { path: relative(join(this.base, safe), file).split('\\').join('/'), bytes }
  }

  run(wsName: string, argv: readonly string[], timeoutMs?: number): WorkspaceRun {
    const safe = this.safeName(wsName)
    const started = Date.now()
    const deny = (message: string): WorkspaceRun => ({
      argv,
      code: null,
      out: '',
      err: message,
      timedOut: false,
      ms: Date.now() - started,
    })

    const [program, ...rest] = argv
    if (program === undefined || program === '') return deny('没有给可执行文件')

    // 路径边界：不许绝对路径、不许 `..`（argv 逐项检查，包括被当成路径的参数）
    for (const token of argv) {
      if (token.startsWith('/') || token.startsWith('~') || token.split(/[/\\]/).includes('..')) {
        return deny(`参数里有工作区之外的路径：${token}`)
      }
    }
    if (rest.some((token) => INLINE_CODE_FLAGS.has(token))) {
      return deny('不许内联代码（-c/-e）：要把脚本写成文件再跑，这样跑过的东西能复查')
    }

    const resolved = this.resolveProgram(program)
    if (resolved.error !== undefined) return deny(resolved.error)

    const installing = basename(resolved.bin).startsWith('pip') && rest[0] === 'install'
    if (installing && !this.config.allowInstall) {
      return deny(
        'pip install 被关掉了（默认不许 agent 自己装包）。' +
          `请让老师在仓库根跑：pnpm venv:add ${rest.slice(1).join(' ')}`,
      )
    }

    const timeout = Math.min(timeoutMs ?? this.config.timeoutMs, this.config.timeoutMs)
    const result = spawnSync(resolved.bin, [...rest], {
      cwd: join(this.base, safe),
      timeout,
      encoding: 'utf8',
      maxBuffer: Math.max(this.config.maxOutputBytes * 8, 1_000_000),
      env: { ...process.env, ...(this.venvPython() === undefined ? {} : { VIRTUAL_ENV: resolve(this.root, this.config.venv) }) },
    })
    const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    const err = [result.error === undefined ? '' : timedOut ? `超时（${String(timeout)} ms）已终止` : String(result.error.message), result.stderr ?? '']
      .filter((part) => part !== '')
      .join('\n')
    if (result.stdout !== null && result.stdout !== '') this.changed(safe)
    return {
      argv,
      code: result.status,
      out: clip(result.stdout ?? '', this.config.maxOutputBytes),
      err: clip(err, this.config.maxOutputBytes),
      timedOut,
      ms: Date.now() - started,
    }
  }

  venvPython(): string | undefined {
    const bin = join(resolve(this.root, this.config.venv), 'bin', 'python3')
    return existsSync(bin) ? bin : undefined
  }

  /** 工作区目录（不存在就创建）；名字非法返回 undefined——不给穿越的机会 */
  dirOf(wsName: string): string | undefined {
    if (!NAME_PATTERN.test(wsName)) return undefined
    const path = join(this.base, wsName)
    return path.startsWith(this.base) ? path : undefined
  }

  private safeName(wsName: string): string {
    return NAME_PATTERN.test(wsName) ? wsName : 'default'
  }

  /** 工作区内的文件绝对路径；`create` 时允许父目录不存在（write 会建） */
  private fileOf(wsName: string, relPath: string, create: boolean): string | undefined {
    const root = this.dirOf(wsName)
    if (root === undefined) return undefined
    if (relPath === '' || relPath.startsWith('/') || relPath.split(/[/\\]/).includes('..')) return undefined
    const file = resolve(root, relPath)
    if (!file.startsWith(root) || file === root) return undefined
    if (!create && !existsSync(file)) return undefined
    return file
  }

  /** `python3`/`pip` 解析到 venv；其余按白名单查 */
  private resolveProgram(program: string): { bin: string; error?: undefined } | { bin?: undefined; error: string } {
    const short = basename(program)
    if (!this.config.allow.includes(short)) {
      return { error: `不在允许清单里：${short}（cordis.yml 的 workspace.allow 里加它）` }
    }
    if (short === 'python3' || short === 'python') {
      const venv = this.venvPython()
      if (venv === undefined && basename(program) === 'python') {
        return { error: '没有虚拟环境：请老师先跑 pnpm venv（或用 python3）' }
      }
      return { bin: venv ?? program }
    }
    if (short === 'pip' || short === 'pip3') {
      const pip = join(resolve(this.root, this.config.venv), 'bin', 'pip')
      return existsSync(pip) ? { bin: pip } : { error: '没有虚拟环境：请老师先跑 pnpm venv' }
    }
    return { bin: program }
  }

  private changed(wsName: string): void {
    this.ctx.emit('workspace:changed', { name: wsName, files: this.list(wsName).length })
  }
}

export function apply(ctx: Context, config: WorkspaceConfig): void {
  ctx.plugin(WorkspaceService, config)
}
