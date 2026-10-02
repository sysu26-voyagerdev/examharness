import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, LlmMessage, LlmReply, LlmToolSpec } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as corpusPlugin from '@examharness/plugin-corpus'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import * as workbenchPlugin from '@examharness/plugin-workbench'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSearchRequest, parseSearchResults } from '@examharness/plugin-websearch'

/**
 * 检索能力测试。
 *
 * 要证明三件事：
 *   1. **agent 真能检索语料**：search → read → compare 走通，且 compare 会明说"像原题"；
 *   2. **联网搜索是可配置的**：关掉时 agent **连工具都看不到**（工具表按配置生成），
 *      打开时它才出现在模型手里；
 *   3. **素材不是真值**：检索结果只进模型上下文与证据，界面事件里不出现原文。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint
const CORPUS_STEM = '已知抛物线 y = x² - 4x + 3 与 x 轴交于 A、B 两点，求线段 AB 的长。'

const fibers: Fiber[] = []
const scratch: string[] = []

function corpusDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-retrieval-'))
  scratch.push(dir)
  writeFileSync(
    join(dir, 'q.jsonl'),
    `${JSON.stringify({ id: 'c-1', stem: CORPUS_STEM, answer: 'AB = 2', knowledge: ['与坐标轴交点'], difficulty: 0.72 })}\n`,
    'utf8',
  )
  return dir
}

/** 假模型：按剧本调工具，并把每次拿到的**工具表**记下来 */
function model(seen: LlmToolSpec[][]) {
  let phase = 0
  return (messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]): LlmReply => {
    seen.push([...(tools ?? [])])
    const last = messages.at(-1)?.content ?? ''
    const payload = (): Record<string, unknown> => {
      try {
        return JSON.parse(last) as Record<string, unknown>
      } catch {
        return {}
      }
    }
    phase += 1
    if (phase === 1) {
      return {
        content: '先看看素材库里有什么。',
        toolCalls: [{ id: 't1', name: 'corpus_search', arguments: JSON.stringify({ knowledge: ['与坐标轴交点'] }) }],
      }
    }
    if (phase === 2) {
      const hits = payload().hits as { id: string }[] | undefined
      return {
        content: null,
        toolCalls: [{ id: 't2', name: 'corpus_read', arguments: JSON.stringify({ id: hits?.[0]?.id ?? 'c-1' }) }],
      }
    }
    if (phase === 3) {
      return {
        content: null,
        toolCalls: [{ id: 't3', name: 'corpus_compare', arguments: JSON.stringify({ text: CORPUS_STEM }) }],
      }
    }
    return { content: '收工。', toolCalls: [] }
  }
}

/** 一个"不管怎样都想联网"的模型：用来验证关掉时会被明确拒绝 */
const alwaysWebSearch = (): LlmReply => ({
  content: null,
  toolCalls: [{ id: 'w1', name: 'web_search', arguments: JSON.stringify({ query: '课标 二次函数' }) }],
})

function fakeLlm(chat: (messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]) => LlmReply) {
  return {
    name: 'fake-llm',
    apply(ctx: Context): void {
      ctx.provide('llm', {
        configured: true,
        model: 'fake-writer',
        chat: async (messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]) => chat(messages, tools),
      })
    },
  }
}

function fakeWebSearch(enabled: boolean) {
  return {
    name: 'fake-websearch',
    apply(ctx: Context): void {
      ctx.provide('websearch', {
        enabled,
        search: async (query: string) => [{ title: `关于「${query}」`, url: 'https://example.com/a', snippet: '示例结果' }],
      })
    },
  }
}

async function boot(options: {
  chat: (messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]) => LlmReply
  withCorpus?: boolean
  websearch?: boolean
}): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(fakeLlm(options.chat)),
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', paths: [], learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(mkdtempSync(join(tmpdir(), 'examharness-bank-')), 'b.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85, corpusWordingMax: 0.55, corpusNumbersMin: 0.8 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
  )
  if (options.withCorpus === true) {
    fibers.push(await context.plugin(corpusPlugin, { dirs: [corpusDir()], minLength: 8, maxSimilarity: 0.6 }))
  }
  if (options.websearch !== undefined) {
    fibers.push(await context.plugin(fakeWebSearch(options.websearch)))
  }
  fibers.push(await context.plugin(workbenchPlugin, { maxSteps: 8, extraRules: '' }))
  return context
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('检索能力', () => {
  it('agent 能 search → read → compare，compare 会明说"像原题"', async () => {
    const seen: LlmToolSpec[][] = []
    const ctx = await boot({ chat: model(seen), withCorpus: true })
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    const texts = run.transcript.map((event) => event.text).join('\n')
    expect(texts).toContain('corpus_search：命中 1 条')
    expect(texts).toContain('corpus_read：c-1')
    expect(texts).toContain('corpus_compare：数字 1.00、措辞 1.00（判定：像原题，必须改）')
  })

  it('素材原文不进界面事件文本（只进模型上下文）', async () => {
    const seen: LlmToolSpec[][] = []
    const ctx = await boot({ chat: model(seen), withCorpus: true })
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    const texts = run.transcript.map((event) => event.text).join('\n')
    expect(texts).not.toContain(CORPUS_STEM)
  })

  it('工具表按配置生成：没接语料库就看不到语料工具', async () => {
    const seen: LlmToolSpec[][] = []
    const ctx = await boot({ chat: model(seen) })
    await ctx.workbench.run({ goal: '出题', blueprint })

    const names = seen[0]?.map((tool) => tool.name) ?? []
    expect(names).toContain('submit_item')
    expect(names).not.toContain('corpus_search')
  })

  it('接了语料库：语料工具出现，联网搜索仍然没有（因为没开）', async () => {
    const seen: LlmToolSpec[][] = []
    const ctx = await boot({ chat: model(seen), withCorpus: true })
    await ctx.workbench.run({ goal: '出题', blueprint })

    const names = seen[0]?.map((tool) => tool.name) ?? []
    expect(names).toEqual(expect.arrayContaining(['corpus_search', 'corpus_read', 'corpus_compare']))
    expect(names).not.toContain('web_search')
  })

  it('开了联网搜索：工具才出现在模型手里', async () => {
    const seen: LlmToolSpec[][] = []
    const ctx = await boot({ chat: model(seen), withCorpus: true, websearch: true })
    await ctx.workbench.run({ goal: '出题', blueprint })

    const names = seen[0]?.map((tool) => tool.name) ?? []
    expect(names).toContain('web_search')
  })

  it('联网搜索关着时，即使模型硬调也只会得到明确拒绝', async () => {
    const ctx = await boot({ chat: alwaysWebSearch, withCorpus: true, websearch: false })
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    expect(run.transcript.some((event) => event.text.includes('未启用联网搜索'))).toBe(true)
  })
})

describe('联网搜索的纯函数', () => {
  it('请求长什么样：POST JSON，密钥走 Authorization', () => {
    const { url, init } = buildSearchRequest(
      { endpoint: 'https://search.example.com/api', timeoutMs: 1000 },
      'k-1',
      '二次函数 情境',
      3,
    )
    expect(url).toBe('https://search.example.com/api')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k-1')
    expect(JSON.parse(String(init.body))).toEqual({ query: '二次函数 情境', limit: 3 })
  })

  it('返回体：缺 url 的条目直接丢', () => {
    expect(
      parseSearchResults({
        results: [
          { title: '有链接', url: 'https://a.example.com', snippet: 'x' },
          { title: '没链接' },
          { url: '' },
        ],
      }),
    ).toEqual([{ title: '有链接', url: 'https://a.example.com', snippet: 'x' }])
    expect(parseSearchResults({})).toEqual([])
  })
})
