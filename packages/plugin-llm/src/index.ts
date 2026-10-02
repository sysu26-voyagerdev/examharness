import { Service, type Context } from '@deepseek-ai/cordis'
import type { CredentialSource, LlmApi, LlmMessage, LlmReply, LlmToolCall, LlmToolSpec } from '@examharness/core'
import { expandEnv } from '@examharness/core'
import z from 'schemastery'

/**
 * 模型接入（OpenAI 兼容 `/chat/completions`）。
 *
 * 定位很清楚：**LLM 只做两件事**——把结构序列化成题面、驱动工作台选下一步。
 * 它不产生数学真值（R1），也不决定验证跑不跑（R2）。
 *
 * 密钥从环境变量取（`${VAR}` 展开），配置里**不写明文**，避免进仓库。
 */

export const name = 'llm'

export const Config = z.object({
  baseUrl: z.string().default('https://api.openai.com/v1'),
  /** 支持 ${VAR} 展开；未设置时 configured = false，工作台会明确拒绝 */
  apiKey: z.string().default('${EXAMHARNESS_API_KEY}'),
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().default(0.2),
  timeoutMs: z.number().default(60_000),
})

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeoutMs: number
}

export { expandEnv }

/** 纯函数：请求体长什么样。测试只测这个，不测网络 */
export function buildPayload(
  config: LlmConfig,
  messages: readonly LlmMessage[],
  tools?: readonly LlmToolSpec[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature,
    messages: messages.map((message) => {
      const out: Record<string, unknown> = { role: message.role, content: message.content }
      if (message.toolCallId !== undefined) out.tool_call_id = message.toolCallId
      if (message.toolCalls !== undefined) {
        out.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }))
      }
      return out
    }),
  }
  if (tools !== undefined && tools.length > 0) {
    payload.tools = tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
    payload.tool_choice = 'auto'
  }
  return payload
}

interface WireToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

/** 纯函数：把提供方返回的那坨东西收成我们的 LlmReply */
export function parseReply(body: unknown): LlmReply {
  const choice = (body as { choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[] })
    .choices?.[0]
  const message = choice?.message
  const calls: LlmToolCall[] = (message?.tool_calls ?? []).flatMap((call, index) =>
    call.function?.name === undefined
      ? []
      : [
          {
            id: call.id ?? `call_${index}`,
            name: call.function.name,
            arguments: call.function.arguments ?? '{}',
          },
        ],
  )
  return { content: message?.content ?? null, toolCalls: calls }
}

export class LlmService extends Service implements LlmApi {
  static Config = Config

  private readonly config: LlmConfig
  /** 装机配置里展开出来的密钥（环境变量优先，见 key()） */
  private readonly configKey: string

  constructor(ctx: Context, config: LlmConfig) {
    super(ctx, 'llm')
    this.configKey = expandEnv(config.apiKey)
    // 不发明默认地址：没配就是没配——"悄悄打 api.openai.com"会让老师以为系统坏了
    this.config = { ...config, baseUrl: expandEnv(config.baseUrl), model: expandEnv(config.model) }
  }

  /**
   * 密钥：**环境变量 > 本地凭据文件 > 装机配置**（照 DSH 的取值优先级）。
   * 设置页写的密钥落 data/credentials.json（0600），从不回传给界面（ADR-0022）。
   */
  private key(): string {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return this.configKey
    const fromStore = settings.credentials.get(settings.get().model.apiKeyEnv)
    return fromStore !== '' ? fromStore : this.configKey
  }

  get configured(): boolean {
    return this.missing.length === 0
  }

  /** 还缺什么（界面与工作台照实说，别只说一句"未配置"） */
  get missing(): readonly string[] {
    const live = this.effective()
    return [
      live.baseUrl === '' ? 'API 地址' : '',
      this.key() === '' ? '密钥' : '',
      live.model === '' ? '模型名' : '',
    ].filter((part) => part !== '')
  }

  /** 密钥的来源（给状态显示用，不给值） */
  get source(): CredentialSource {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return this.configKey === '' ? 'none' : 'env'
    return settings.credentials.describe(settings.get().model.apiKeyEnv).source
  }

  get model(): string {
    return this.effective().model
  }

  /** 设置页可以热改 baseUrl / model；密钥仍只从环境变量取 */
  private effective(): { baseUrl: string; model: string } {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { baseUrl: this.config.baseUrl, model: this.config.model }
    const live = settings.get().model
    return {
      baseUrl: live.baseUrl === '' ? this.config.baseUrl : live.baseUrl,
      model: live.model === '' ? this.config.model : live.model,
    }
  }

  async chat(messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]): Promise<LlmReply> {
    if (!this.configured) throw new Error('未配置模型密钥：在设置页填，或设环境变量 EXAMHARNESS_API_KEY')
    const active = this.effective()
    const response = await fetch(`${active.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key()}` },
      body: JSON.stringify(buildPayload({ ...this.config, model: active.model }, messages, tools)),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`模型调用失败：HTTP ${response.status} ${await response.text()}`)
    }
    return parseReply(await response.json())
  }
}

export function apply(ctx: Context, config: LlmConfig): void {
  ctx.plugin(LlmService, config)
}
