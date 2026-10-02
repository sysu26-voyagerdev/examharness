import { Service, type Context } from '@deepseek-ai/cordis'
import type { WebSearchApi, WebSearchResult } from '@examharness/core'
import { expandEnv } from '@examharness/core'
import z from 'schemastery'

/**
 * 联网搜索 —— **可配置的引导工具**（默认关闭）。
 *
 * 定位（ADR-0017）：它是 agent 手里的一件检索工具，**不是闸门**。
 *   - 能干的：查情境/数据是否真实、查课标原文、查某道题是否已经公开存在；
 *   - 不能干的：**不能当真值**（R1）。模型检索到的东西是素材，
 *     题目正确性仍然来自构造与符号计算；
 *   - 拦不住的：网上抄来的题——那只有**查重闸门**拦得住，
 *     所以检索结果永远要过闸门，工具描述里也这么写。
 *
 * 协议保持"通用"：POST `{query, limit}` → `{results:[{title,url,snippet}]}`。
 * 换供应商只改 `endpoint`（SearXNG 聚合、Tavily 风格网关、自建代理都行）。
 */

export const name = 'websearch'

export const Config = z.object({
  /** 关掉时 agent 连这个工具都看不到（工具表按配置生成） */
  enabled: z.boolean().default(false),
  endpoint: z.string().default(''),
  /** 只从环境变量取，配置里不写明文 */
  apiKey: z.string().default('${EXAMHARNESS_SEARCH_KEY}'),
  limit: z.number().default(5),
  timeoutMs: z.number().default(15_000),
})

export interface WebSearchConfig {
  enabled: boolean
  endpoint: string
  apiKey: string
  limit: number
  timeoutMs: number
}

/** 纯函数：请求长什么样（测试只测这个，不测网络） */
export function buildSearchRequest(
  config: Pick<WebSearchConfig, 'endpoint' | 'timeoutMs'>,
  apiKey: string,
  query: string,
  limit: number,
): { url: string; init: RequestInit } {
  return {
    url: config.endpoint,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  }
}

/** 纯函数：把提供方返回的东西收成我们的形状；缺字段的条目直接丢 */
export function parseSearchResults(body: unknown): WebSearchResult[] {
  const raw = (body as { results?: unknown }).results
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const item = entry as { title?: unknown; url?: unknown; snippet?: unknown }
    if (typeof item.url !== 'string' || item.url === '') return []
    return [
      {
        title: typeof item.title === 'string' ? item.title : item.url,
        url: item.url,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
      },
    ]
  })
}

export class WebSearchService extends Service implements WebSearchApi {
  static Config = Config

  private readonly config: WebSearchConfig

  constructor(ctx: Context, config: WebSearchConfig) {
    super(ctx, 'websearch')
    this.config = { ...config, apiKey: expandEnv(config.apiKey) }
  }

  /** 设置页可热改开关与网关地址 */
  private effective(): { enabled: boolean; endpoint: string } {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return { enabled: this.config.enabled, endpoint: this.config.endpoint }
    const live = settings.get().websearch
    return { enabled: live.enabled, endpoint: live.endpoint }
  }

  get enabled(): boolean {
    const active = this.effective()
    return active.enabled && active.endpoint !== ''
  }

  async search(query: string, limit?: number): Promise<readonly WebSearchResult[]> {
    if (!this.enabled) throw new Error('未启用联网搜索（cordis.yml 的 websearch.enabled / endpoint）')
    const active = this.effective()
    const request = buildSearchRequest(
      { endpoint: active.endpoint, timeoutMs: this.config.timeoutMs },
      this.config.apiKey,
      query,
      limit ?? this.config.limit,
    )
    const response = await fetch(request.url, request.init)
    if (!response.ok) {
      throw new Error(`联网搜索失败：HTTP ${String(response.status)}`)
    }
    return parseSearchResults(await response.json())
  }
}

export function apply(ctx: Context, config: WebSearchConfig): void {
  ctx.plugin(WebSearchService, config)
}
