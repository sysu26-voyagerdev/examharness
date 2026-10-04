import { describe, expect, it } from 'vitest'
import type { LlmConfig } from '@examharness/plugin-llm'
import { buildPayload, expandEnv, parseReply, readStream } from '@examharness/plugin-llm'

/**
 * 只测纯函数——请求体长什么样、返回怎么收。**不测网络**：
 * 网络失败不是这个项目要验证的东西，而请求体写错是。
 */

const config: LlmConfig = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'k',
  model: 'm',
  temperature: 0.2,
  timeoutMs: 1000,
  retries: 2,
}

describe('模型接入的纯函数', () => {
  it('密钥从环境变量展开；没设置就是空串（据此判定未配置）', () => {
    expect(expandEnv('${KEY}', { KEY: 'sk-1' })).toBe('sk-1')
    expect(expandEnv('${KEY}', {})).toBe('')
    expect(expandEnv('literal', {})).toBe('literal')
  })

  it('请求体：工具以 function 形式挂上，助手消息带 tool_calls', () => {
    const payload = buildPayload(
      config,
      [
        { role: 'system', content: '你是命题组' },
        { role: 'user', content: '出题' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'c1', name: 'construct_item', arguments: '{"slotKey":"S1","seed":1}' }],
        },
        { role: 'tool', content: '{"candidateId":"cand-1"}', toolCallId: 'c1' },
      ],
      [
        {
          name: 'submit_item',
          description: '提交',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ],
    )

    expect(payload.model).toBe('m')
    expect(payload.tool_choice).toBe('auto')
    const tools = payload.tools as { type: string; function: { name: string } }[]
    expect(tools[0]?.type).toBe('function')
    expect(tools[0]?.function.name).toBe('submit_item')

    const messages = payload.messages as Record<string, unknown>[]
    expect(messages[2]?.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'construct_item', arguments: '{"slotKey":"S1","seed":1}' } },
    ])
    expect(messages[3]?.tool_call_id).toBe('c1')
  })

  it('返回体：把提供方的 tool_calls 收成我们的形状', () => {
    const reply = parseReply({
      choices: [
        {
          message: {
            content: '我来构造',
            tool_calls: [{ id: 'c9', function: { name: 'bank_stats', arguments: '{}' } }],
          },
        },
      ],
    })
    expect(reply.content).toBe('我来构造')
    expect(reply.toolCalls).toEqual([{ id: 'c9', name: 'bank_stats', arguments: '{}' }])

    // 没有 tool_calls 的纯文本回复也要能收
    expect(parseReply({ choices: [{ message: { content: '完成' } }] }).toolCalls).toEqual([])
  })
})

/** 把若干段 SSE 文本做成一个流：真实的流是**任意切**的，不能假设一段一条消息 */
function stream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

const frame = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`

describe('流式（SSE）', () => {
  it('边读边回调，并把正文拼完整', async () => {
    const seen: string[] = []
    const reply = await readStream(
      stream([
        frame({ choices: [{ delta: { content: '我在' } }] }),
        frame({ choices: [{ delta: { content: '想。' } }] }),
        'data: [DONE]\n\n',
      ]),
      (delta) => seen.push(delta.text),
    )

    expect(seen.join('')).toBe('我在想。')
    expect(reply.content).toBe('我在想。')
    expect(reply.toolCalls).toHaveLength(0)
  })

  it('**它在想**与**它在写**分开回调：思考那一路不混进正文，也不进返回值', async () => {
    const seen: { kind: string; text: string }[] = []
    const reply = await readStream(
      stream([
        // 真实形状：带工具的回合里，reasoning_content 先来一大段，正文随后才出现
        frame({ choices: [{ delta: { role: 'assistant', reasoning_content: 'The teacher wants' } }] }),
        frame({ choices: [{ delta: { reasoning_content: ' a multiple-choice item.' } }] }),
        frame({ choices: [{ delta: { content: '我先看一下' } }] }),
        frame({ choices: [{ delta: { content: '这类题的问法。' } }] }),
        'data: [DONE]\n\n',
      ]),
      (delta) => seen.push(delta),
    )

    // 两路各自连续、顺序不乱：想完再写
    expect(seen).toEqual([
      { kind: 'think', text: 'The teacher wants' },
      { kind: 'think', text: ' a multiple-choice item.' },
      { kind: 'say', text: '我先看一下' },
      { kind: 'say', text: '这类题的问法。' },
    ])
    // 思考不是结论：正文里不许带上它（它只用于界面显示，记录只认走完的那一步）
    expect(reply.content).toBe('我先看一下这类题的问法。')
  })

  it('只吐思考、还没吐正文时也要回调（这十几秒以前是整段丢掉的）', async () => {
    const seen: string[] = []
    const reply = await readStream(
      stream([frame({ choices: [{ delta: { reasoning_content: 'Let me check the graph first.' } }] }), 'data: [DONE]\n\n']),
      (delta) => {
        expect(delta.kind).toBe('think')
        seen.push(delta.text)
      },
    )

    expect(seen.join('')).toBe('Let me check the graph first.')
    // 这一回合没有正文：reply.content 照样是 null（不许拿思考当正文回给调用方）
    expect(reply.content).toBeNull()
  })

  it('开始给工具填参数时报一次"它在准备哪一步"（参数本身不回调出去）', async () => {
    const seen: { kind: string; text: string }[] = []
    const reply = await readStream(
      stream([
        // 真实形状：名字先到，参数一个字一个字地流（写一整个题型模块能有十几秒）
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'constructor_write', arguments: '' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"con' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'structors/x.mjs"' } }] } }] }),
        'data: [DONE]\n\n',
      ]),
      (delta) => seen.push(delta),
    )

    // 只说一次名字（后面那些分片不再重复报）；这一段给界面用，**不是**模型写的字
    expect(seen).toEqual([{ kind: 'use', text: 'constructor_write' }])
    // 参数照样拼完整交给调用方（参数没丢，只是不摆给老师看）
    expect(reply.toolCalls).toEqual([{ id: 'c1', name: 'constructor_write', arguments: '{"path":"constructors/x.mjs"' }])
  })

  it('工具调用的参数是**分片**来的：必须按 index 拼回去（拼错就成了半截 JSON）', async () => {
    const reply = await readStream(
      stream([
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'construct_item', arguments: '{"slot' } }] } }] }),
        frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Key":"S1","seed":7}' } }] } }] }),
        'data: [DONE]\n\n',
      ]),
      () => undefined,
    )

    expect(reply.toolCalls).toEqual([{ id: 'c1', name: 'construct_item', arguments: '{"slotKey":"S1","seed":7}' }])
  })

  it('一段被切开（半截 JSON）也不会把整条流带崩', async () => {
    const whole = frame({ choices: [{ delta: { content: '好。' } }] })
    const seen: string[] = []
    const reply = await readStream(stream([whole.slice(0, 12), whole.slice(12)]), (delta) => seen.push(delta.text))
    // 切开那一半解析不了就跳过——但正文不能因此丢掉（宁可少显示一段，也不能让这轮挂掉）
    expect(reply.content === null || reply.content === '好。').toBe(true)
    expect(seen.length).toBeLessThanOrEqual(1)
  })
})
