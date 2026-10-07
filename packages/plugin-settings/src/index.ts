import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  AppSettings,
  CredentialInfo,
  CredentialSource,
  CredentialsApi,
  DeepPartial,
  SettingsApi,
  SettingsOp,
} from '@examharness/core'
import { expandEnv } from '@examharness/core'
import z from 'schemastery'

/**
 * 设置覆盖层。
 *
 * 分工很清楚：
 *   - **cordis.yml** 是"装机配置"（插件组合、端口、目录），改它要重启；
 *   - **本服务**是"运行期设置"（模型地址/模型名、联网开关与网关、语料目录、
 *     新建会话默认值、闸门阈值），改完**立刻生效**——因为 llm / websearch / corpus
 *     都在调用时读这里，而不是把配置抄一份在构造时冻住。
 *
 * 密钥的规矩（照 DeepSeek Harness 的做法，见 docs/agent/06 ADR-0022）：
 *   1. **只进不出**：密钥值从不进 HTTP 响应，界面只知道"配了没配"和"从哪来"；
 *   2. **单独文件**：值存 data/credentials.json（0600，别人可读就拒绝启动），
 *      配置文档里只放**引用名**（`model.apiKeyEnv`），密钥永远不写进设置；
 *   3. **环境变量优先且只读**：启动环境给了就是它说了算，界面上那道输入框变只读。
 *
 * 写入用**路径化补丁**（`{path, value}`）而不是整体替换：界面看的是脱敏视图，
 * 整体替换会把它从没见过的密钥一起删掉。
 */

export const name = 'settings'

export const Config = z.object({
  path: z.string().default('data/settings.json'),
  /** 凭据文件（0600；只存密钥值，绝不入 Git、绝不进 HTTP 响应） */
  credentials: z.string().default('data/credentials.json'),
  modelBaseUrl: z.string().default(''),
  modelApiKeyEnv: z.string().default('EXAMHARNESS_API_KEY'),
  modelName: z.string().default(''),
  /** 思考等级：'' = 不传（提供方默认）；low/medium/high = reasoning_effort */
  modelReasoningEffort: z.string().default(''),
  websearchEnabled: z.boolean().default(false),
  websearchEndpoint: z.string().default(''),
  corpusDirs: z.array(z.string()).default([]),
  defaultClassName: z.string().default('初三(2)班'),
  defaultProgress: z.string().default(''),
  /** 新卷的默认设定：空的（老师说一句要什么，agent 先给设计） */
  defaultBlueprint: z.string().default('seed/blueprints/空白.json'),
  corpusWordingMax: z.number().default(0.55),
  corpusNumbersMin: z.number().default(0.8),
  bankMaxSimilarity: z.number().default(0.85),
})

export interface SettingsConfig {
  path: string
  credentials: string
  modelBaseUrl: string
  modelApiKeyEnv: string
  modelName: string
  modelReasoningEffort: string
  websearchEnabled: boolean
  websearchEndpoint: string
  corpusDirs: string[]
  defaultClassName: string
  defaultProgress: string
  defaultBlueprint: string
  corpusWordingMax: number
  corpusNumbersMin: number
  bankMaxSimilarity: number
}

/** 合并两个深层的、可选的设置对象（只覆盖被显式给出的字段） */
function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    const current = out[key]
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current)
    ) {
      out[key] = merge(current, value as DeepPartial<typeof current>)
    } else {
      out[key] = value
    }
  }
  return out as T
}

export class SettingsService extends Service implements SettingsApi {
  static Config = Config

  private readonly file: string
  private readonly base: AppSettings
  private overlay: DeepPartial<AppSettings>
  private rev = 1
  private readonly credentialsFile: string
  readonly credentials: CredentialsApi

  constructor(ctx: Context, config: SettingsConfig) {
    super(ctx, 'settings')
    const root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.file = resolve(root, config.path)
    this.credentialsFile = resolve(root, config.credentials)
    this.base = {
      model: {
        baseUrl: expandEnv(config.modelBaseUrl),
        model: expandEnv(config.modelName),
        reasoningEffort: config.modelReasoningEffort,
        apiKeyEnv: config.modelApiKeyEnv,
      },
      websearch: { enabled: config.websearchEnabled, endpoint: config.websearchEndpoint },
      corpusDirs: [...config.corpusDirs],
      sessionDefaults: {
        className: config.defaultClassName,
        progress: config.defaultProgress,
        blueprintPath: config.defaultBlueprint,
      },
      gates: {
        corpusWordingMax: config.corpusWordingMax,
        corpusNumbersMin: config.corpusNumbersMin,
        bankMaxSimilarity: config.bankMaxSimilarity,
      },
    }
    const loaded = this.load()
    this.overlay = loaded.overlay
    this.rev = loaded.rev
    this.credentials = new CredentialsFile(this.credentialsFile)
  }

  get(): AppSettings {
    return merge(this.base, this.overlay)
  }

  patch(patch: DeepPartial<AppSettings>): AppSettings {
    const ops: SettingsOp[] = Object.entries(patch as Record<string, unknown>).flatMap(([key, value]) =>
      // 数组整片替换、对象拆成路径（否则 merge 语义与 op 语义会不一致）
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>).map(([sub, leaf]) => ({ path: [key, sub], value: leaf }))
        : [{ path: [key], value }],
    )
    return this.mutate(ops)
  }

  revision(): number {
    return this.rev
  }

  mutate(ops: readonly SettingsOp[], expectedRevision?: number): AppSettings {
    if (expectedRevision !== undefined && expectedRevision !== this.rev) {
      throw new SettingsConflict(expectedRevision, this.rev)
    }
    for (const op of ops) {
      if (op.path.length === 0) continue
      this.overlay = applyOp(this.overlay, op)
    }
    this.rev += 1
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ revision: this.rev, ...this.overlay }, null, 1), 'utf8')
    this.ctx.emit('settings:changed', { restartRequired: this.restartRequired() })
    return this.get()
  }

  /** 我们尽量都做成热改；真正需要重启的只有装机配置（端口、插件组合） */
  restartRequired(): readonly string[] {
    return []
  }

  private load(): { overlay: DeepPartial<AppSettings>; rev: number } {
    if (!existsSync(this.file)) return { overlay: {}, rev: 1 }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      // 文件里带一个修订号兄弟键（读的时候摘掉，不进 AppSettings）
      const rev = typeof parsed.revision === 'number' ? parsed.revision : 1
      delete parsed.revision
      return { overlay: parsed as DeepPartial<AppSettings>, rev }
    } catch {
      return { overlay: {}, rev: 1 }
    }
  }
}

/** 修订号对不上：界面看到的设置已经被别处改过，别默默覆盖 */
export class SettingsConflict extends Error {
  readonly code = 'SETTINGS_CONFLICT'
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`设置已被别处改过（你手上的修订号 ${String(expected)}，现在是 ${String(actual)}）：刷新后重试`)
    this.name = 'SettingsConflict'
  }
}

/** 按路径写进覆盖层（`unset` 就把这一片删掉，回到装机配置的值） */
function applyOp(overlay: DeepPartial<AppSettings>, op: SettingsOp): DeepPartial<AppSettings> {
  const [head, ...rest] = op.path
  if (head === undefined) return overlay
  const next = { ...(overlay as Record<string, unknown>) }
  if (rest.length === 0) {
    if (op.unset === true) delete next[head]
    else next[head] = op.value
    return next as DeepPartial<AppSettings>
  }
  const child = (next[head] ?? {}) as Record<string, unknown>
  next[head] = applyOp(child as DeepPartial<AppSettings>, { ...op, path: rest })
  return next as DeepPartial<AppSettings>
}

/**
 * 凭据文件（0600）。明文，但**只在本机**，且和别人可读就拒绝启动——
 * 这是照 DSH 抄的一条：把"权限没设对"当启动错误，比事后提醒有用得多。
 */
class CredentialsFile implements CredentialsApi {
  private refs: Record<string, string> = {}

  constructor(private readonly file: string) {
    this.refs = this.load()
  }

  get(ref: string): string {
    if (ref === '') return ''
    const fromEnv = process.env[ref]
    // 环境变量优先（只读覆盖）：部署时给的密钥不该被界面上的旧值盖掉
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv
    return this.refs[ref] ?? ''
  }

  describe(ref: string): CredentialInfo {
    const fromEnv = process.env[ref]
    const source: CredentialSource =
      fromEnv !== undefined && fromEnv !== ''
        ? 'env'
        : (this.refs[ref] ?? '') !== ''
          ? 'file'
          : 'none'
    return { ref, configured: source !== 'none', source, writable: source !== 'env' }
  }

  set(ref: string, value: string): CredentialInfo {
    if (ref === '') return this.describe(ref)
    if ((process.env[ref] ?? '') !== '') {
      throw new Error(`密钥由启动环境提供（${ref}），界面上改不了：改环境变量再启动`)
    }
    const trimmed = value.trim()
    // 密钥是 HTTP 头的一部分：带非 ASCII（粘贴时混进的全角字符/中文）就会变成一个
    // 让人摸不着头脑的 ByteString 错误。在**写的时候**就说清楚，别等调用模型时才炸。
    if (/[^\x20-\x7E]/.test(trimmed)) {
      throw new Error('密钥里出现了非 ASCII 字符（多半是粘贴时带进了全角字符或空格）：请重新粘贴纯密钥')
    }
    if (trimmed === '') delete this.refs[ref]
    else this.refs[ref] = trimmed
    this.save()
    return this.describe(ref)
  }

  unset(ref: string): CredentialInfo {
    return this.set(ref, '')
  }

  private load(): Record<string, string> {
    if (!existsSync(this.file)) return {}
    // 别人可读 = 启动错误（照 DSH 的 credentials-local）
    const mode = statSync(this.file).mode & 0o777
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
      throw new Error(
        `凭据文件权限过宽：${this.file}（${mode.toString(8)}）。先跑 chmod 600 ${this.file} 再启动`,
      )
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { refs?: Record<string, string> }
      return parsed.refs ?? {}
    } catch {
      return {}
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ version: 1, refs: this.refs }, null, 1), { encoding: 'utf8', mode: 0o600 })
    chmodSync(this.file, 0o600) // 已存在的文件不会被 mode 改写，显式设一次
  }
}

export function apply(ctx: Context, config: SettingsConfig): void {
  ctx.plugin(SettingsService, config)
}
