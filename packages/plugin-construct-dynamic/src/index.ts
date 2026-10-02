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
 *   - agent 写一个题型模块（`constructors/<kind>.mjs`），导出
 *     `kind` / `covers`（覆盖哪些知识点）/ `construct(slot, seed)`；
 *   - 构造结果里必须带 `checks`：**检验点**，形如 `{ expr, at, expect }`——
 *     "把 at 代进 expr 应当得到 expect"。它声明的是**要被核对的数学事实**；
 *   - 加载时框架先做**静态安全扫描**（不许子进程 / 文件 / 网络 / eval），
 *     再把模块交给**独立子进程**验收（`scripts/verify-constructor.mjs`，带内存上限与超时）：
 *     契约完整、同种子可复现、不同种子有差异、检验点能算且**能区分对错**
 *     （把参数改坏它必须失败）、边界不崩、构造速度可接受；
 *   - **只有子进程验收通过，主进程才 import 它**（顺序不能反：顶层代码 import 就执行）；
 *   - 通过才注册生效。闸门那边不认识新 kind，但会用**自己的求值器**核对检验点——
 *     判分仍然不归出题的人管（R2）。
 *
 * **诚实边界**：这是"降低风险"，不是沙箱。静态扫描拦掉危险调用，验收在子进程里跑，
 * 但**验收通过之后 construct 仍在主进程里执行**（只允许 agent 写计算，不允许它碰系统；
 * 要真正隔离得把构造也放进 worker，见 roadmap）。所以：**诚实地说，它不是沙箱。**
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
  /** 题面的 LaTeX（公式层；没写就用 stem 原文） */
  stemTex?: string
  /** 题目**要求什么**（回译闸门拿它核对题面有没有写歪；写成几个短句、空格分开） */
  goal?: string
  /** 题面**显式给出的条件**，一条一个（回译闸门按条数核对） */
  givens?: readonly string[]
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
      givens: out.givens === undefined ? [] : out.givens.map(String),
      // 没声明 goal 就是**没声明**：绝不拿题面前 40 字冒充"目标"——
      // 那会让回译闸门拿一个假对照物去核对（真实的坑：解析失败怪题面写歪）。
      goal: out.goal ?? '',
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
        // 题面公式**只有题型声明了才算数**：以前这里误写成 `answerTex ?? stem`，
        // 于是"题面公式"里放的其实是**答案**——卷面上会把答案印在题干位置。
        // 没声明就不放（题面本身已经有内容了，导出会照常渲染它）。
        ...(out.stemTex === undefined ? {} : { stem: out.stemTex }),
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

    // **验收必须在主进程 import 之前**：模块的顶层代码在 import 那一刻就会执行，
    // 一个 `for (let i = -4; i <= -1; i = i - 1)` 就能把主进程的内存吃光
    // （真实踩过两次：一次崩了服务，一次崩了测试进程——所以顺序不能反）。
    // 主进程要的 kind / covers 也由子进程的报告带回来，避免"为了读个名字先 import"。
    const script = resolve(this.root, this.config.verifyScript)
    if (!existsSync(script)) {
      return report(false, [], 0, 0, [`找不到验收脚本：${this.config.verifyScript}`])
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
      const stderr = verified.stderr ?? ''
      if (timedOut) {
        return report(false, [], 0, 0, [
          `验收超时（${String(this.config.verifyTimeoutMs)} ms）：${whereText(lastPhase(stderr))}停不下来——` +
            '循环要有终止条件（计数器在变小、判断却在等它变大，就会一直转下去），或者计算量太大',
        ])
      }
      return report(false, [], 0, 0, [`验收进程崩了：${whereText(lastPhase(stderr))}${crashReason(stderr)}${crashHint(stderr)}`])
    }

    const problems = [...(parsed.problems ?? [])]
    // 报告与注册都认模块自己声明的 kind（文件名只是它的存放位置）
    const reportedKind = typeof parsed.kind === 'string' && parsed.kind !== '' ? parsed.kind : kind
    kind = reportedKind
    const covers = (parsed.covers ?? []).map(String)
    // 顶层占内存过多的模块直接拒（import 进主进程就晚了：内存收不回来）
    if ((parsed.heapMb ?? 0) > this.config.maxHeapMb) {
      problems.push(`模块占堆 ${String(parsed.heapMb)} MB（上限 ${String(this.config.maxHeapMb)} MB）：顶层或构造里在造大对象`)
    }
    if (parsed.ok !== true || problems.length > 0) {
      return report(false, covers, parsed.samples ?? 0, parsed.checks ?? 0, problems)
    }
    if (covers.length === 0) return report(false, [], 0, 0, ['没有声明 covers：不知道这个题型覆盖哪些知识点'])
    if (covers.length > this.config.maxCovers) {
      return report(false, covers, 0, 0, [`covers 最多 ${String(this.config.maxCovers)} 个：覆盖太多等于"什么都能出"，不是题型`])
    }

    // 通过验收才 import 注册：这一步仍然在主进程里（子进程已经证明它不拖垮系统，
    // 但严格说这不是沙箱——见文件开头的"诚实边界"）
    let moduleOk: ModuleShape
    try {
      // **URL 上带内容哈希**：题型文件常常是"改完再交"（同一个路径被重写）。
      // ESM 按 URL 缓存模块——不带哈希的话，第二次交同一个路径就还是**旧代码**在跑，
      // 而报告已经说了"通过验收并生效"：报告和实际行为对不上，agent 会以为框架在骗它
      // （真实踩过：agent 反复重交，看到的题面始终是上一版，于是它去查蓝图、查缺口，白烧一轮）。
      moduleOk = (await import(`${pathToFileURL(file).href}?rev=${fnv1a(source)}`)) as ModuleShape
    } catch (error) {
      return report(false, covers, 0, 0, [`通过验收后却加载不了：${error instanceof Error ? error.message : String(error)}`])
    }
    if (typeof moduleOk.construct !== 'function') {
      return report(false, covers, 0, 0, ['模块必须导出 construct（函数）'])
    }
    const constructOk = moduleOk.construct as (slot: BlueprintRow, seed: number) => ModuleOutput
    const finalKind = typeof moduleOk.kind === 'string' && moduleOk.kind !== '' ? moduleOk.kind : reportedKind
    const wrapped: Constructor = (slot: BlueprintRow, seed: number) => assembleItem(finalKind, slot, seed, constructOk(slot, seed))
    ctx_of(this).construct.register(finalKind, wrapped, covers)
    return report(true, covers, parsed.samples ?? 0, parsed.checks ?? 0, [])
  }
}

/** 拿服务持有的 ctx（Cordis 的 Service 上就是 this.ctx） */
function ctx_of(service: DynamicConstructorService): Context {
  return (service as unknown as { ctx: Context }).ctx
}

/**
 * 验收子进程崩了就来不及输出报告，只有 stderr 上的面包屑（`#phase:xxx`）留了下来。
 * 靠它说清"崩在哪一步"——**这是给 agent 看的**：它要拿这句话去改代码，
 * 一句"验收失败"对它是没用的，一句"顶层 import 那一刻内存爆了"才是有用的。
 */
function lastPhase(stderr: string): string | undefined {
  const marks = [...stderr.matchAll(/^#phase:(.+)$/gm)]
  return marks.at(-1)?.[1]?.trim()
}

/** 把面包屑翻成人话：顶层 / 第几条构造 */
function whereText(phase: string | undefined): string {
  if (phase === undefined) return '还没走进模块就'
  if (phase === 'import') return '**模块顶层代码**在 import 那一刻'
  if (phase === 'import-done') return '加载完成、还没开始构造时'
  const sample = /^sample:(\d+)$/.exec(phase)
  if (sample !== null) return `第 ${sample[1]} 条构造时`
  return `阶段 ${phase} 里`
}

/** 崩的原因（挑出真正有用的那行，而不是把 GC 日志前 200 字甩出去） */
function crashReason(stderr: string): string {
  if (/heap out of memory|Ineffective mark-compacts|Allocation failed/i.test(stderr)) return '内存爆了（JavaScript heap out of memory）'
  if (/Maximum call stack size exceeded/i.test(stderr)) return '调用栈溢出（多半是递归没有出口）'
  const line = stderr
    .split('\n')
    .map((text) => text.trim())
    .findLast(
      (text) =>
        text !== '' &&
        !text.startsWith('#phase:') &&
        !text.startsWith('at ') &&
        !text.startsWith('-----') &&
        !text.startsWith('<---') &&
        !/^\d+:/.test(text),
    )
  return line === undefined ? '被杀了，但没留下错误信息' : `：${line.slice(0, 200)}`
}

/** 内存爆了要说清下一步怎么改，否则 agent 只会换个写法再撞一次 */
function crashHint(stderr: string): string {
  if (!/heap out of memory|Ineffective mark-compacts|Allocation failed/i.test(stderr)) return ''
  return '。检查循环的终止条件（例如 `for (let i = -4; i <= -1; i = i - 1)`：i 一直在变小，条件却等它变大，就永远不停），' +
    '以及顶层不要造大数组——顶层代码在 import 时就会跑'
}

export const inject = ['construct']

export function apply(ctx: Context, config: DynamicConfig): void {
  ctx.plugin(DynamicConstructorService, config)
}
