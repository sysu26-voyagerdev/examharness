import { Service, type Context } from '@deepseek-ai/cordis'
import type { CredentialSource, LlmApi, LlmDelta, LlmMessage, LlmReply, LlmToolCall, LlmToolSpec } from '@examharness/core'
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
  /** 暂时性失败（超时/网络抖动/5xx）重试几次：一次抖动不该把整轮 agent 带停 */
  retries: z.number().default(2),
})

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeoutMs: number
  retries: number
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

  async chat(
    messages: readonly LlmMessage[],
    tools?: readonly LlmToolSpec[],
    onDelta?: (delta: LlmDelta) => void,
  ): Promise<LlmReply> {
    if (!this.configured) throw new Error('未配置模型密钥：在设置页填，或设环境变量 EXAMHARNESS_API_KEY')
    const active = this.effective()
    const attempts = Math.max(1, this.config.retries + 1)
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- 重试必须串行
        return await this.once(active.baseUrl, active.model, messages, tools, onDelta)
      } catch (error) {
        lastError = error
        // 只重试**暂时性**失败（超时、网络抖动、5xx）：真实的错（密钥、参数、余额）重试也没用，
        // 早报早改。加这个是因为一次 60 秒超时把整轮 agent 直接带停了——
        // 那不是"该停"，是网线抖了一下（真实踩过）。
        if (!isTransient(error) || attempt === attempts - 1) break
        // eslint-disable-next-line no-await-in-loop -- 退避等待
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** 一次调用（不带重试）：要流式就带 onDelta */
  private async once(
    baseUrl: string,
    model: string,
    messages: readonly LlmMessage[],
    tools?: readonly LlmToolSpec[],
    onDelta?: (delta: LlmDelta) => void,
  ): Promise<LlmReply> {
    const payload = buildPayload({ ...this.config, model }, messages, tools)
    // 有人在看就流式：一次调用常常十几秒没输出，那段时间界面不该是死的
    if (onDelta !== undefined) payload.stream = true
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key()}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })
    if (!response.ok) {
      const body = await response.text()
      const error = new Error(`模型调用失败：HTTP ${response.status} ${body}`)
      ;(error as Error & { status?: number }).status = response.status
      throw error
    }
    if (onDelta === undefined || response.body === null) return parseReply(await response.json())
    return readStream(response.body, onDelta)
  }
}

/**
 * 读 SSE 流，边读边回调**模型正在写的字**。
 *
 * 只认 `data:` 行，遇到 `[DONE]` 收工；工具调用的参数是**分片**来的，
 * 必须按 index 拼回去（拼错了工具就带着半截 JSON 被调用——这是流式最容易踩的坑）。
 *
 * **两路分开回调**（`delta.reasoning_content` → `think`，`delta.content` → `say`）：
 * 一个带工具的回合里，模型常常先想十几秒、再动手，这段时间流里**只有** `reasoning_content`。
 * 以前只认 `content`，那十几秒就被整段丢掉——界面上那一块于是"根本不存在"，
 * 而老师看到的却是状态行说"在做"（真实量过：前 14 个采样点、约 25 秒，实时区都是空的）。
 *
 * 思考**不进 reply**：它是模型的过程，不是结论（记录只认走完的那一步，见 ADR-0038）。
 * 返回值里只有 `content` 与 `toolCalls`，这条边界靠类型就守住了。
 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: LlmDelta) => void,
): Promise<LlmReply> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const calls = new Map<number, { id: string; name: string; args: string }>()

  const handle = (chunk: string): void => {
    const choice = (JSON.parse(chunk) as {
      choices?: {
        delta?: {
          content?: string | null
          /** 思考那一路（DeepSeek 系）：**只有**它先到，正文随后才来 */
          reasoning_content?: string | null
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
    }).choices?.[0]
    const delta = choice?.delta
    if (delta?.reasoning_content !== undefined && delta.reasoning_content !== null && delta.reasoning_content !== '')
      onDelta({ kind: 'think', text: delta.reasoning_content })
    if (delta?.content !== undefined && delta.content !== null && delta.content !== '') {
      content += delta.content
      onDelta({ kind: 'say', text: delta.content })
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const current = calls.get(index) ?? { id: '', name: '', args: '' }
      calls.set(index, {
        id: call.id ?? current.id,
        name: call.function?.name ?? current.name,
        args: current.args + (call.function?.arguments ?? ''),
      })
    }
  }

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 流就是这样读的：一段一段来
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const text = line.trim()
      if (!text.startsWith('data:')) continue
      const data = text.slice(5).trim()
      if (data === '' || data === '[DONE]') continue
      try {
        handle(data)
      } catch {
        /* 半截 JSON（跨块断开）留给下一轮 buffer 拼 */
      }
    }
  }

  return {
    content: content === '' ? null : content,
    toolCalls: [...calls.entries()]
      .toSorted((left, right) => left[0] - right[0])
      .flatMap(([index, call]) =>
        call.name === '' ? [] : [{ id: call.id === '' ? `call_${String(index)}` : call.id, name: call.name, arguments: call.args === '' ? '{}' : call.args }],
      ),
  }
}

/** 这次失败值不值得重试：超时、网络错误、5xx 值得；4xx（密钥/参数/余额）不值得 */
function isTransient(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status
  if (typeof status === 'number') return status >= 500 || status === 429
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /timeout|timed out|aborted|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i.test(message)
}

export function apply(ctx: Context, config: LlmConfig): void {
  ctx.plugin(LlmService, config)
}
