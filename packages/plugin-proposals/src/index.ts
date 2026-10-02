import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ConstructorProposal, ProposalApi, ProposalSelftest, ProposalStatus } from '@examharness/core'
import z from 'schemastery'

/**
 * 构造器提案：**agent 出活，人签字**。
 *
 * 为什么不直接让它改构造器：构造器产出数学真值，闸门是裁判；
 * 让 agent 改构造器就等于让被验证者写裁判（R1/R2 直接失效）。
 * 所以它的产出是"提案"——规格 + 草稿实现 + 自测，落在 data/proposals/ 下**不生效**：
 *   - 这里只做三件事：存提案、**真跑**自测、记下人的决定；
 *   - 合入代码（把草稿翻成 TS 构造器 + 在闸门里写独立验证）由人做，这不是一个按钮能代替的。
 *
 * 物理保证：这个服务只碰 data/proposals/ 与 scripts/ 下指定的自测脚本，不写任何 packages/ 里的代码。
 */

export const name = 'proposals'

export const Config = z.object({
  dir: z.string().default('data/proposals'),
  /** 跑自测用的 python（工作区的虚拟环境优先） */
  python: z.string().default(''),
  timeoutMs: z.number().default(120_000),
})

export interface ProposalsConfig {
  dir: string
  python: string
  timeoutMs: number
}

function safeId(kind: string): string {
  return kind.replace(/[^\w.\-]/g, '_').slice(0, 80) || `proposal-${String(Date.now())}`
}

export class ProposalService extends Service implements ProposalApi {
  static Config = Config

  private readonly config: ProposalsConfig
  private readonly base: string
  private readonly dir: string

  constructor(ctx: Context, config: ProposalsConfig) {
    super(ctx, 'proposals')
    this.config = config
    this.base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.dir = resolve(this.base, config.dir)
    mkdirSync(this.dir, { recursive: true })
  }

  list(): readonly ConstructorProposal[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const found = this.get(entry.name)
        return found === undefined ? [] : [found]
      })
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  get(id: string): ConstructorProposal | undefined {
    const file = join(this.dir, safeId(id), 'proposal.json')
    if (!existsSync(file)) return undefined
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ConstructorProposal
    } catch {
      return undefined
    }
  }

  propose(input: {
    kind: string
    title: string
    covers: readonly string[]
    spec: string
    draft: string
    selftest?: string
  }): ConstructorProposal {
    const id = safeId(input.kind)
    const dir = join(this.dir, id)
    mkdirSync(dir, { recursive: true })
    const proposal: ConstructorProposal = {
      id,
      kind: input.kind,
      title: input.title === '' ? input.kind : input.title,
      covers: input.covers,
      spec: input.spec,
      draft: input.draft,
      status: 'pending',
      createdAt: new Date().toISOString(),
      proposedBy: 'agent',
    }
    // 规格与草稿分开存（界面读规格、人看草稿；自测脚本单独一个文件，直接跑）
    writeFileSync(join(dir, 'spec.md'), input.spec, 'utf8')
    writeFileSync(join(dir, 'draft.py'), input.draft, 'utf8')
    if (input.selftest !== undefined && input.selftest !== '') {
      writeFileSync(join(dir, 'selftest.py'), input.selftest, 'utf8')
    }
    writeFileSync(join(dir, 'proposal.json'), JSON.stringify(proposal, null, 2), 'utf8')
    return proposal
  }

  /** 真跑自测：输出原样回给界面（人审的依据是"跑得通"而不是"它说跑得通"） */
  runSelftest(id: string): ProposalSelftest {
    const proposal = this.get(id)
    const now = new Date().toISOString()
    if (proposal === undefined) return { ranAt: now, ok: false, output: '没有这个提案' }
    const script = join(this.dir, safeId(id), 'selftest.py')
    if (!existsSync(script)) {
      return { ranAt: now, ok: false, output: '这个提案没有带自测脚本（selftest.py）——没自测的提案别合入' }
    }
    const python = this.python()
    const result = spawnSync(python, [script], {
      cwd: join(this.dir, safeId(id)),
      encoding: 'utf8',
      timeout: this.config.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const output = [result.stdout ?? '', result.stderr ?? ''].filter((part) => part.trim() !== '').join('\n').slice(-4000)
    const selftest: ProposalSelftest = { ranAt: now, ok: result.status === 0, output: output === '' ? '（没有输出）' : output }
    // 结果记进提案：界面刷新后还看得到上次跑成什么样
    const updated: ConstructorProposal = { ...proposal, selftest }
    writeFileSync(join(this.dir, safeId(id), 'proposal.json'), JSON.stringify(updated, null, 2), 'utf8')
    return selftest
  }

  decide(id: string, status: ProposalStatus, note?: string): ConstructorProposal | undefined {
    const proposal = this.get(id)
    if (proposal === undefined) return undefined
    const updated: ConstructorProposal = {
      ...proposal,
      status,
      ...(note === undefined || note === '' ? {} : { note }),
    }
    writeFileSync(join(this.dir, safeId(id), 'proposal.json'), JSON.stringify(updated, null, 2), 'utf8')
    return updated
  }

  /** 用哪个 python：仓库的 .venv 优先（自测里要 import 的东西都在那儿） */
  private python(): string {
    if (this.config.python !== '') return this.config.python
    const venv = resolve(this.base, '.venv', 'bin', 'python3')
    return existsSync(venv) ? venv : 'python3'
  }
}

export function apply(ctx: Context, config: ProposalsConfig): void {
  ctx.plugin(ProposalService, config)
}
