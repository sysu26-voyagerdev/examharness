import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import { fnv1a } from '@examharness/core'
import type {
  BlueprintRow,
  CheckPoint,
  Constructor,
  ConstructorReport,
  DynamicConstructorApi,
  FigureSpec,
  Item,
  Option,
} from '@examharness/core'
import z from 'schemastery'

/**
 * **让 agent 在运行时制作新题型**（不再由人一个个硬编码）。
 *
 * 形状：
 *   - agent 写一个题型模块（`data/constructors/<kind>.mjs`），导出
 *     `kind` / `covers`（覆盖哪些知识点）/ `construct(slot, seed)`；
 *   - 构造结果里必须带 `checks`：**检验点**，形如 `{ expr, at, expect }`——
 *     "把 at 代进 expr 应当得到 expect"。它声明的是**要被核对的数学事实**；
 *   - 加载时框架先做**静态安全扫描**（不许子进程 / 文件 / 网络 / eval），
 *     再跑**验收**：契约完整、同种子可复现、不同种子有差异、检验点能算且**能区分对错**
 *     （把参数改坏它必须失败）、边界不崩、构造速度可接受；
 *   - 通过才注册生效。闸门那边不认识新 kind，但会用**自己的求值器**核对检验点——
 *     判分仍然不归出题的人管（R2）。
 *
 * **诚实边界**：这是"降低风险"，不是沙箱。模块是纯计算（静态扫描拦掉危险调用），
 * 但它毕竟在本进程里跑；所以只允许 agent 写计算，不允许它碰系统。
 */

export const name = 'construct-dynamic'

export const Config = z.object({
  dir: z.string().default('data/constructors'),
  /** 验收时构造多少条样题 */
  samples: z.number().default(30),
  /** 一个题型最多覆盖多少知识点（防"什么都能出"的假题型） */
  maxCovers: z.number().default(6),
  /** 隔离验收脚本（在独立进程里跑，带内存上限与超时） */
  verifyScript: z.string().default('scripts/verify-constructor.mjs'),
  /** 验收子进程的内存上限（MB）：模块爆内存也只崩它自己 */
  maxOldSpaceMb: z.number().default(256),
  /** 验收子进程超时 */
  verifyTimeoutMs: z.number().default(10_000),
  /** 模块允许的堆占用上限（MB）：顶层做重活的模块不许注册 */
  maxHeapMb: z.number().default(96),
})

export interface DynamicConfig {
  dir: string
  samples: number
  maxCovers: number
  verifyScript: string
  maxOldSpaceMb: number
  verifyTimeoutMs: number
  maxHeapMb: number
}

interface ModuleShape {
  kind?: unknown
  covers?: unknown
  construct?: unknown
}

/**
 * 题型模块返回的"数学形状"——**它只管数学**，Item 由框架组装。
 * 这样题型作者（agent）不必知道 id 怎么算、证据怎么挂、生命周期怎么标。
 */
interface ModuleOutput {
  params: Record<string, number>
  stem: string
  answer: string
  answerTex?: string
  solution?: readonly string[]
  solutionTex?: readonly string[]
  steps?: readonly { text: string; basis: string }[]
  checks?: readonly CheckPoint[]
  options?: readonly { key: string; text: string }[]
  figure?: FigureSpec
}

/** 把题型模块的产出组装成 Item（与内置构造器完全一致的形状） */
function assembleItem(kind: string, slot: BlueprintRow, seed: number, out: ModuleOutput): Item {
  const mid = (slot.difficulty[0] + slot.difficulty[1]) / 2
  const solution = out.solution ?? []
  return {
    id: `it-${slot.key}-${String(seed)}-${fnv1a(`${kind}|${JSON.stringify(out.params)}`)}`,
    slot: { ...slot, difficulty: [Math.max(0, mid - 0.06), Math.min(1, mid + 0.06)] },
    instance: {
      kind,
      params: out.params,
      givens: [],
      goal: out.stem.slice(0, 40),
      ...(out.checks === undefined ? {} : { checks: out.checks }),
    },
    witness: {
      steps: (out.steps ?? []).map((step, index) => ({ n: index + 1, text: step.text, basis: step.basis })),
      answer: out.answer,
      auxiliary: false,
      reprSwitches: 1,
    },
    prose: {
      stem: out.stem,
      ...(out.options === undefined ? {} : { options: out.options.map((option): Option => ({ key: option.key, text: option.text })) }),
      answerText: out.answer,
      solution,
      tex: {
        stem: out.answerTex ?? out.stem,
        answer: out.answerTex ?? out.answer,
        solution: out.solutionTex ?? solution,
      },
      serializer: { model: 'template', version: 1 },
    },
    ...(out.figure === undefined ? {} : { figure: { spec: out.figure, renderer: 'template' } }),
    evidence: {},
    provenance: { constructor: `${kind}@dynamic`, seed, models: {}, createdAt: new Date(0).toISOString() },
    lifecycle: 'draft',
    review: { confirmedBy: null, confirmedAt: null },
  }
}

/** 静态安全扫描：题型模块**只许做计算** */
const FORBIDDEN = [
  'child_process',
  'node:fs',
  "require(",
  'process.',
  'globalThis.',
  'import(',
  'eval(',
  'new Function',
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'worker_threads',
]

export class DynamicConstructorService extends Service implements DynamicConstructorApi {
  static Config = Config

  private readonly config: DynamicConfig
  private readonly root: string
  private readonly dir: string
  private readonly reports = new Map<string, ConstructorReport>()

  constructor(ctx: Context, config: DynamicConfig) {
    super(ctx, 'constructDynamic')
    this.config = config
    this.root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.dir = resolve(this.root, config.dir)
    mkdirSync(this.dir, { recursive: true })
    void this.loadAll()
  }

  /** 现在生效的动态题型 */
  list(): readonly ConstructorReport[] {
    return [...this.reports.values()].toSorted((a, b) => a.kind.localeCompare(b.kind))
  }

  /** 扫描目录：逐个加载 + 验收（不通过的只在报告里留痕，不注册） */
  async loadAll(): Promise<readonly ConstructorReport[]> {
    // 两个来源：仓库里的 constructors/（版本化、团队共享）+ data/constructors/（本机实验）
    const dirs = [resolve(this.root, 'constructors'), this.dir]
    const files = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .filter((file) => file.endsWith('.mjs'))
        .map((file) => join(dir, file))
    })
    for (const file of files) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        await this.loadOne(file)
      } catch (error) {
        // 一个模块出问题不该让其他题型都加载不了
        const kind = (file.split('/').at(-1) ?? file).replace(/\.mjs$/, '')
        this.reports.set(kind, {
          kind,
          file,
          covers: [],
          ok: false,
          samples: 0,
          checks: 0,
          problems: [`加载时抛错：${error instanceof Error ? error.message : String(error)}`],
          at: new Date().toISOString(),
        })
      }
    }
    return this.list()
  }

  /** 加载一个题型模块并验收；通过就注册，不通过就把问题写进报告 */
  async loadOne(modulePath: string): Promise<ConstructorReport> {
    // 统一成绝对路径：调用方可能给绝对路径（扫描目录）或相对仓库根的路径（工具写入）
    const file = modulePath.startsWith('/') ? modulePath : resolve(this.root, modulePath)
    const fileName = file.split('/').at(-1) ?? file
    // 报告的 key 先用文件名占位；模块加载后用**它自己声明的 kind**（以模块为准）
    let kind = fileName.replace(/\.mjs$/, '')
    const report = (ok: boolean, covers: readonly string[], samples: number, checks: number, problems: readonly string[]): ConstructorReport => {
      const value: ConstructorReport = { kind, file, covers, ok, samples, checks, problems, at: new Date().toISOString() }
      this.reports.set(kind, value)
      // kind 里可能有斜杠（dynamic/xxx）→ 落盘时换成文件名安全的写法
      writeFileSync(join(this.dir, `${kind.replace(/[^\w.-]/g, '_')}.report.json`), JSON.stringify(value, null, 2), 'utf8')
      return value
    }

    const source = readFileSync(file, 'utf8')
    const banned = FORBIDDEN.filter((token) => source.includes(token))
    if (banned.length > 0) {
      return report(false, [], 0, 0, [`模块里有不允许的调用：${banned.join('、')}（题型只许做计算）`])
    }

    let module: ModuleShape
    try {
      module = (await import(pathToFileURL(file).href)) as ModuleShape
    } catch (error) {
      return report(false, [], 0, 0, [`加载失败：${error instanceof Error ? error.message : String(error)}`])
    }

    if (typeof module.kind !== 'string' || typeof module.construct !== 'function') {
      return report(false, [], 0, 0, ['模块必须导出 kind（字符串）与 construct（函数）'])
    }
    // 注册与报告都认模块声明的 kind（文件名只是它的存放位置）
    kind = module.kind
    const covers = Array.isArray(module.covers) ? module.covers.map(String) : []
    if (covers.length === 0) return report(false, [], 0, 0, ['没有声明 covers：不知道这个题型覆盖哪些知识点'])
    if (covers.length > this.config.maxCovers) {
      return report(false, covers, 0, 0, [`covers 最多 ${String(this.config.maxCovers)} 个：覆盖太多等于"什么都能出"，不是题型`])
    }

    // **验收在独立进程里跑**：模块的顶层代码在 import 时就会执行，
    // 一个 while 循环就能把宿主进程的内存吃光（真实踩过：服务被 agent 的模块搞 OOM）。
    // 子进程带内存上限与超时，崩了只崩它自己；主进程只认它的报告。
    const script = resolve(this.root, this.config.verifyScript)
    if (!existsSync(script)) {
      return report(false, covers, 0, 0, [`找不到验收脚本：${this.config.verifyScript}`])
    }
    const verified = spawnSync(
      process.execPath,
      [`--max-old-space-size=${String(this.config.maxOldSpaceMb)}`, script, file, String(this.config.samples)],
      { encoding: 'utf8', timeout: this.config.verifyTimeoutMs, maxBuffer: 4 * 1024 * 1024 },
    )
    const line = (verified.stdout ?? '').trim().split('\n').at(-1) ?? ''
    let parsed:
    | { ok?: boolean; problems?: string[]; samples?: number; checks?: number; covers?: string[]; kind?: string; heapMb?: number }
    | undefined
    try {
      parsed = JSON.parse(line) as typeof parsed
    } catch {
      parsed = undefined
    }

    if (parsed === undefined) {
      const timedOut = verified.error !== undefined && (verified.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
      return report(
        false,
        covers,
        0,
        0,
        [
          timedOut
            ? `验收超时（${String(this.config.verifyTimeoutMs)} ms）：模块里有代价过高的计算（顶层或 construct 里陷进循环了）`
            : `验收进程没有给出报告（多半是它自己崩了 / 内存爆了）：${(verified.stderr ?? '').trim().slice(0, 200) || '没有输出'}`,
        ],
      )
    }

    const problems = [...(parsed.problems ?? [])]
    // 顶层占内存过多的模块直接拒（import 进主进程就晚了：内存收不回来）
    if ((parsed.heapMb ?? 0) > this.config.maxHeapMb) {
      problems.push(`模块占堆 ${String(parsed.heapMb)} MB（上限 ${String(this.config.maxHeapMb)} MB）：顶层或构造里在造大对象`)
    }
    if (parsed.ok !== true || problems.length > 0) {
      return report(false, parsed.covers ?? covers, parsed.samples ?? 0, parsed.checks ?? 0, problems)
    }

    // 通过验收才 import 注册（此时它已经在受限进程里证明过自己不会拖垮系统）
    let moduleOk: ModuleShape
    try {
      moduleOk = (await import(pathToFileURL(file).href)) as ModuleShape
    } catch (error) {
      return report(false, covers, 0, 0, [`通过验收后却加载不了：${error instanceof Error ? error.message : String(error)}`])
    }
    const constructOk = moduleOk.construct as (slot: BlueprintRow, seed: number) => ModuleOutput
    const finalKind = typeof moduleOk.kind === 'string' && moduleOk.kind !== '' ? moduleOk.kind : kind
    const wrapped: Constructor = (slot: BlueprintRow, seed: number) => assembleItem(finalKind, slot, seed, constructOk(slot, seed))
    ctx_of(this).construct.register(finalKind, wrapped, parsed.covers ?? covers)
    return report(true, parsed.covers ?? covers, parsed.samples ?? 0, parsed.checks ?? 0, [])
  }
}

/** 拿服务持有的 ctx（Cordis 的 Service 上就是 this.ctx） */
function ctx_of(service: DynamicConstructorService): Context {
  return (service as unknown as { ctx: Context }).ctx
}

export const inject = ['construct']

export function apply(ctx: Context, config: DynamicConfig): void {
  ctx.plugin(DynamicConstructorService, config)
}
