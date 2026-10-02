import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { AppSettings, DeepPartial, SettingsApi } from '@examharness/core'
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
 * 一条硬规矩：**密钥永不落盘**。它只从环境变量（`${VAR}`）取；
 * 设置页能改的是 baseUrl 与 model 名，改不了也不该改密钥。
 */

export const name = 'settings'

export const Config = z.object({
  path: z.string().default('data/settings.json'),
  modelBaseUrl: z.string().default(''),
  modelName: z.string().default(''),
  websearchEnabled: z.boolean().default(false),
  websearchEndpoint: z.string().default(''),
  corpusDirs: z.array(z.string()).default([]),
  defaultClassName: z.string().default('初三(2)班'),
  defaultProgress: z.string().default(''),
  defaultBlueprint: z.string().default('seed/blueprint.json'),
  corpusWordingMax: z.number().default(0.55),
  corpusNumbersMin: z.number().default(0.8),
  bankMaxSimilarity: z.number().default(0.85),
})

export interface SettingsConfig {
  path: string
  modelBaseUrl: string
  modelName: string
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

  constructor(ctx: Context, config: SettingsConfig) {
    super(ctx, 'settings')
    const root = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.file = resolve(root, config.path)
    this.base = {
      model: { baseUrl: expandEnv(config.modelBaseUrl), model: expandEnv(config.modelName) },
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
    this.overlay = this.load()
  }

  get(): AppSettings {
    return merge(this.base, this.overlay)
  }

  patch(patch: DeepPartial<AppSettings>): AppSettings {
    this.overlay = merge(this.overlay, patch)
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.overlay, null, 1), 'utf8')
    this.ctx.emit('settings:changed', { restartRequired: this.restartRequired() })
    return this.get()
  }

  /** 我们尽量都做成热改；真正需要重启的只有装机配置（端口、插件组合） */
  restartRequired(): readonly string[] {
    return []
  }

  private load(): DeepPartial<AppSettings> {
    if (!existsSync(this.file)) return {}
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as DeepPartial<AppSettings>
    } catch {
      return {}
    }
  }
}

export function apply(ctx: Context, config: SettingsConfig): void {
  ctx.plugin(SettingsService, config)
}
