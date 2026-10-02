import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, LlmMessage, LlmReply } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as llmPlugin from '@examharness/plugin-llm'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import * as workbenchPlugin from '@examharness/plugin-workbench'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * agent 工作台测试。**用假模型**驱动循环，所以是确定性的、不依赖网络。
 * 要验证的是形状而不是"模型聪不聪明"：
 *   - 内环：模型拿工具自己迭代；
 *   - 外环：收尾只能是 submit_item，闸门由框架跑，模型跳不过去；
 *   - 被拦下时，**结构化的失败原因**要回到模型手里（否则它无从修正）；
 *   - 没配密钥时明确拒绝，不假装在干活。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

/** 一个只会照着剧本走的"模型"：先构造，再提交，然后收工 */
function driver(slotKey: string, seed: number) {
  return (messages: readonly LlmMessage[]): LlmReply => {
    const last = messages.at(-1)
    if (last?.role === 'user') {
      return {
        content: '先构造候选题。',
        toolCalls: [{ id: 'c1', name: 'construct_item', arguments: JSON.stringify({ slotKey, seed }) }],
      }
    }
    if (last?.role === 'tool') {
      const payload = JSON.parse(last.content ?? '{}') as { candidateId?: string }
      if (payload.candidateId !== undefined) {
        return {
          content: null,
          toolCalls: [{ id: 'c2', name: 'submit_item', arguments: JSON.stringify({ candidateId: payload.candidateId }) }],
        }
      }
    }
    return { content: '收工。', toolCalls: [] }
  }
}

/** 假模型插件：提供 llm 服务（同一 seam，工作台不需要知道真假） */
function fakeLlm(configured: boolean, chat: (messages: readonly LlmMessage[]) => LlmReply) {
  return {
    name: 'fake-llm',
    apply(ctx: Context): void {
      ctx.provide('llm', {
        configured,
        model: 'fake-writer',
        chat: async (messages: readonly LlmMessage[]) => chat(messages),
      })
    },
  }
}

const fibers: Fiber[] = []
let workdir = ''

async function boot(options: {
  configured?: boolean
  chat: (messages: readonly LlmMessage[]) => LlmReply
  useRealLlm?: boolean
  blueprintOverride?: Blueprint
}): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  const llm = options.useRealLlm === true
    ? await context.plugin(llmPlugin, { baseUrl: 'https://example.com/v1', apiKey: '${EXAMHARNESS_API_KEY}', model: 'm', temperature: 0.2, timeoutMs: 1000 })
    : await context.plugin(fakeLlm(options.configured ?? true, options.chat))
  fibers.push(
    llm,
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(workdir, 'bank.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
    await context.plugin(workbenchPlugin, { maxSteps: 8, extraRules: '' }),
  )
  return context
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'examharness-wb-'))
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  rmSync(workdir, { recursive: true, force: true })
})

describe('agent 工作台', () => {
  it('模型构造 → 提交 → 过闸门入库，全程留痕', async () => {
    const ctx = await boot({ chat: driver('S1', 42) })
    const run = await ctx.workbench.run({ goal: '按蓝图出一份课后作业卷', blueprint })

    expect(run.stopped).toBe('done')
    expect(run.stored).toHaveLength(1)
    expect(ctx.bank.all()).toHaveLength(1)
    expect(run.transcript.some((event) => event.kind === 'gate' && event.text.includes('入库'))).toBe(true)
    expect(run.transcript.some((event) => event.text.startsWith('construct_item'))).toBe(true)
  })

  it('被闸门拦下时，结构化的原因回到模型手里', async () => {
    const illegal: Blueprint = {
      ...blueprint,
      blueprint: [
        { key: 'S1', knowledge: ['对称轴', '动点问题'], cognitive: '掌握', type: '解答', count: 1, difficulty: [0.6, 0.8], score: 10 },
      ],
    }
    const ctx = await boot({ chat: driver('S1', 7) })
    const run = await ctx.workbench.run({ goal: '出题', blueprint: illegal })

    const gate = run.transcript.find((event) => event.kind === 'gate')
    expect(gate?.text).toContain('verify-scope')
    expect(run.stored).toHaveLength(0)
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('没配密钥就明确拒绝，不假装在干活', async () => {
    const ctx = await boot({ configured: false, chat: driver('S1', 1) })
    const run = await ctx.workbench.run({ goal: '出题', blueprint })

    expect(run.stopped).toBe('no-llm')
    expect(run.steps).toBe(0)
    expect(ctx.bank.all()).toHaveLength(0)
    expect(run.transcript[0]?.text).toContain('模型配置不完整')
  })

  it('插话在**下一步**生效：老师的话进了上下文，也留在记录里', async () => {
    const seen: string[][] = []
    let runId = ''
    // 慢模型：第一轮里把老师的话塞进去（模拟"agent 正在跑时老师插话"）
    const ctx = await boot({
      chat: (messages) => {
        seen.push(messages.filter((message) => message.role === 'user').map((message) => message.content ?? ''))
        if (seen.length === 1) {
          expect(ctx.workbench.interject(runId, '别用动点，换个情境')).toBe(true)
          // 带一个工具调用：循环才会进到第二步（否则这一轮就结束了）
          return { content: '先看看题库现状。', toolCalls: [{ id: 'c1', name: 'bank_stats', arguments: '{}' }] }
        }
        return { content: '好。', toolCalls: [] }
      },
    })
    // runId 来自事件（界面也是这么拿的）：start() 返回之前那一轮就已经开始了
    ctx.on('run:started', (payload) => {
      runId = payload.runId
    })
    const started = ctx.workbench.start({ goal: '出题', blueprint })
    const run = await started.done

    expect(run.stopped).toBe('done')
    // 第二次调用模型时，老师的插话已经在 user 消息里
    expect(seen.at(-1)?.some((text) => text.includes('别用动点'))).toBe(true)
    // 记录里也看得到（界面上是"老师"那一行）
    expect(run.transcript.some((event) => event.kind === 'user' && event.text === '别用动点，换个情境')).toBe(true)
  })

  it('叫停：这一步之后不再继续，已完成的部分保留，并如实标注', async () => {
    let runId = ''
    const ctx = await boot({
      chat: () => {
        expect(ctx.workbench.stop(runId)).toBe(true)
        // 同样带一个工具调用：叫停是在**下一步之前**生效的
        return { content: '我还在想。', toolCalls: [{ id: 'c1', name: 'bank_stats', arguments: '{}' }] }
      },
    })
    ctx.on('run:started', (payload) => {
      runId = payload.runId
    })
    const started = ctx.workbench.start({ goal: '出题', blueprint })
    const run = await started.done

    expect(run.stopped).toBe('stopped')
    expect(run.transcript.some((event) => event.text.includes('老师叫停'))).toBe(true)
    // 结束了就查不到这一轮（不然界面会以为它还在跑）
    expect(ctx.workbench.active()).toHaveLength(0)
    expect(ctx.workbench.interject(runId, '还在吗')).toBe(false)
  })

  it('同一时刻只允许一轮：再来一轮会被明确拒绝（做不到并行就别假装）', async () => {
    const ctx = await boot({
      chat: () => {
        expect(() => ctx.workbench.start({ goal: '再来', blueprint })).toThrow(/已经有 agent 在跑/)
        return { content: '收工。', toolCalls: [] }
      },
    })
    const started = ctx.workbench.start({ goal: '出题', blueprint })
    await started.done
    expect(ctx.workbench.active()).toHaveLength(0)
  })

  it('真实 llm 插件在缺密钥时 configured = false', async () => {
    const ctx = await boot({ useRealLlm: true, chat: () => ({ content: null, toolCalls: [] }) })
    expect(ctx.llm.configured).toBe(false)
  })
})
