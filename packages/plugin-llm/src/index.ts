import { Service, type Context } from '@deepseek-ai/cordis'
import type { LlmApi, LlmMessage, LlmReply, LlmToolCall, LlmToolSpec } from '@examharness/core'
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

/** 展开 `${VAR}`；找不到就返回空串（调用方据此判定"没配好"） */
export function expandEnv(value: string, env: Record<string, string | undefined> = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key: string) => env[key] ?? '')
}

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
  private readonly apiKey: string

  constructor(ctx: Context, config: LlmConfig) {
    super(ctx, 'llm')
    this.apiKey = expandEnv(config.apiKey)
    this.config = {
      ...config,
      baseUrl: expandEnv(config.baseUrl) || 'https://api.openai.com/v1',
      model: expandEnv(config.model) || 'gpt-4o-mini',
    }
  }

  get configured(): boolean {
    return this.apiKey !== ''
  }

  async chat(messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]): Promise<LlmReply> {
    if (!this.configured) throw new Error('未配置模型密钥（EXAMHARNESS_API_KEY）')
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(buildPayload(this.config, messages, tools)),
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
