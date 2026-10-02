import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import { checkPointIsDiscriminating, evaluateExpression, fnv1a } from '@examharness/core'
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
})

export interface DynamicConfig {
  dir: string
  samples: number
  maxCovers: number
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
    const files = readdirSync(this.dir).filter((file) => file.endsWith('.mjs'))
    for (const file of files) {
      // oxlint-disable-next-line no-await-in-loop
      await this.loadOne(join(this.dir, file))
    }
    return this.list()
  }

  /** 加载一个题型模块并验收；通过就注册，不通过就把问题写进报告 */
  async loadOne(file: string): Promise<ConstructorReport> {
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

    const problems: string[] = []
    const construct = module.construct as (slot: BlueprintRow, seed: number) => {
      params?: Record<string, number>
      answer?: unknown
      stem?: unknown
      checks?: CheckPoint[]
      steps?: unknown
    }
    const probeSlot: BlueprintRow = {
      key: 'Z1',
      knowledge: covers.slice(0, 1),
      cognitive: '掌握',
      type: '解答',
      difficulty: [0.6, 0.85],
      score: 10,
      count: 1,
    }

    let checks = 0
    const seen = new Set<string>()
    for (let index = 0; index < this.config.samples && problems.length === 0; index += 1) {
      const seed = 1000 + index * 7
      let built: ReturnType<typeof construct>
      try {
        built = construct(probeSlot, seed)
      } catch (error) {
        problems.push(`第 ${String(index + 1)} 条构造就抛错：${error instanceof Error ? error.message : String(error)}`)
        break
      }
      if (typeof built.stem !== 'string' || built.stem.trim() === '') problems.push('题面是空的')
      if (typeof built.answer !== 'string' || built.answer.trim() === '') problems.push('答案（answer）必须是字符串')
      if (built.params === undefined || typeof built.params !== 'object') problems.push('没有 params：闸门与验收都靠它')
      if (!Array.isArray(built.checks) || built.checks.length === 0) {
        problems.push('没有 checks：题型必须声明"要被核对的数学事实"，否则无法独立验证')
        break
      }
      if (problems.length > 0) break

      // 检验点：能算、成立、而且**能区分对错**
      for (const check of built.checks ?? []) {
        checks += 1
        const verdict = checkPointIsDiscriminating(check)
        if (!verdict.ok) {
          problems.push(`检验点无效（${check.expr}）：${verdict.reason ?? ''}`)
          continue
        }
        try {
          const value = evaluateExpression(check.expr, check.at)
          if (Math.abs(value - check.expect) > 1e-6) {
            problems.push(`检验点不成立（${check.expr}）：算出 ${String(value)}，期望 ${String(check.expect)}`)
          }
        } catch (error) {
          problems.push(`检验点算不出来（${check.expr}）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (problems.length > 0) break
      seen.add(JSON.stringify(built.params))
    }

    if (problems.length === 0 && seen.size < Math.max(3, Math.floor(this.config.samples / 6))) {
      problems.push(`不同种子只造出 ${String(seen.size)} 种题：参数空间太小，出卷会反复撞同一道题`)
    }

    if (problems.length > 0) return report(false, covers, this.config.samples, checks, problems)

    // 注册的是"包装过的工厂"：题型只管数学，Item 组装归框架
    const wrapped: Constructor = (slot: BlueprintRow, seed: number) =>
      assembleItem(kind, slot, seed, construct(slot, seed) as ModuleOutput)
    ctx_of(this).construct.register(kind, wrapped, covers)
    return report(true, covers, this.config.samples, checks, [])
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
