import { Service, type Context } from '@deepseek-ai/cordis'
import { parseJsonObject } from '@examharness/core'
import type {
  Blueprint,
  BlueprintRow,
  Item,
  LlmMessage,
  LlmToolSpec,
  WorkbenchApi,
  WorkbenchEvent,
  WorkbenchRequest,
  WorkbenchRun,
} from '@examharness/core'
import z from 'schemastery'

/**
 * agent 工作台。
 *
 * 形状（docs/agent/01 §6）：
 *   - **内环**：模型自己决定查图谱、构造、提交，想迭代几轮迭代几轮；
 *   - **外环**：`submit_item` 是唯一的收尾动作，它内部必然跑闸门链——
 *     模型既不能跳过、也不能改写判定（验证不能被被验证者调度）；
 *   - 判定结果**结构化地**回给模型（哪道闸门、为什么、可不可修），而不是一句"重做"。
 *
 * 顺带一条工程约束：候选题存在工作台里，模型只传 candidateId——
 * 不让它复述题干，避免"模型抄错自己的题"这种低级失败。
 */

export const name = 'workbench'
export const inject = ['llm', 'graph', 'bank', 'construct']

export const Config = z.object({
  maxSteps: z.number().default(8),
  /** 会话约定之外，额外给模型的硬规矩 */
  extraRules: z.string().default(''),
})

export interface WorkbenchConfig {
  maxSteps: number
  extraRules: string
}

interface Candidate {
  id: string
  slot: BlueprintRow
  item: Item
}

const TOOLS: readonly LlmToolSpec[] = [
  {
    name: 'graph_query',
    description: '查一组知识点的前置闭包，以及是否超出已学范围（超纲）。设计题目前先用它。',
    parameters: {
      type: 'object',
      properties: { knowledge: { type: 'array', items: { type: 'string' } } },
      required: ['knowledge'],
    },
  },
  {
    name: 'construct_item',
    description: '按题位构造一道候选题（按构造为真）。返回 candidateId，此时还没入库。',
    parameters: {
      type: 'object',
      properties: { slotKey: { type: 'string' }, seed: { type: 'number' } },
      required: ['slotKey', 'seed'],
    },
  },
  {
    name: 'serialize_item',
    description:
      '让执笔者把候选题的结构写成给学生看的题面（序列化）。题面随后会过回译校验：写漏条件会被拦下。',
    parameters: {
      type: 'object',
      properties: { candidateId: { type: 'string' } },
      required: ['candidateId'],
    },
  },
  {
    name: 'submit_item',
    description: '提交候选题：会跑完整闸门链，通过才入库。不通过会返回哪道闸门、为什么、能不能靠重做修好。',
    parameters: {
      type: 'object',
      properties: { candidateId: { type: 'string' } },
      required: ['candidateId'],
    },
  },
  {
    name: 'bank_stats',
    description: '看题库现状：已入库多少题、每个题位各有多少。',
    parameters: { type: 'object', properties: {} },
  },
]

export class WorkbenchService extends Service implements WorkbenchApi {
  static Config = Config

  private readonly config: WorkbenchConfig
  private readonly candidates = new Map<string, Candidate>()
  private counter = 0

  constructor(ctx: Context, config: WorkbenchConfig) {
    super(ctx, 'workbench')
    this.config = config
  }

  async run(request: WorkbenchRequest): Promise<WorkbenchRun> {
    const transcript: WorkbenchEvent[] = []
    const stored: string[] = []
    const say = (step: number, kind: WorkbenchEvent['kind'], text: string): void => {
      transcript.push({ step, kind, text })
    }

    if (!this.ctx.llm.configured) {
      say(0, 'gate', '未配置模型密钥，工作台拒绝运行（不假装在干活）')
      return { goal: request.goal, steps: 0, transcript, stored, stopped: 'no-llm' }
    }

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt(request.blueprint, this.config.extraRules) },
      { role: 'user', content: request.goal },
    ]

    let steps = 0
    let stopped: WorkbenchRun['stopped'] = 'max-steps'

    while (steps < this.config.maxSteps) {
      steps += 1
      // agent 循环天然串行：下一步做什么取决于上一步的回复
      // oxlint-disable-next-line no-await-in-loop
      const reply = await this.ctx.llm.chat(messages, TOOLS)
      if (reply.content !== null && reply.content !== '') say(steps, 'assistant', reply.content)

      if (reply.toolCalls.length === 0) {
        stopped = 'done'
        break
      }

      messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls })
      for (const call of reply.toolCalls) {
        // 同一轮里的多个工具调用也必须串行：它们会改共享状态（题库、候选题表）
        // oxlint-disable-next-line no-await-in-loop
        const outcome = await this.execute(call.name, call.arguments, request.blueprint)
        say(steps, outcome.kind, outcome.text)
        if (outcome.storedId !== undefined) stored.push(outcome.storedId)
        messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.payload) })
      }
    }

    return { goal: request.goal, steps, transcript, stored, stopped }
  }

  private async execute(
    tool: string,
    rawArguments: string,
    blueprint: Blueprint,
  ): Promise<{ kind: WorkbenchEvent['kind']; text: string; payload: unknown; storedId?: string }> {
    let args: Record<string, unknown> = {}
    try {
      args = rawArguments === '' ? {} : (JSON.parse(rawArguments) as Record<string, unknown>)
    } catch {
      return { kind: 'tool', text: `${tool}：参数不是合法 JSON`, payload: { error: '参数不是合法 JSON' } }
    }

    if (tool === 'graph_query') {
      const knowledge = Array.isArray(args.knowledge) ? args.knowledge.map(String) : []
      const closure = this.ctx.graph.closure(knowledge)
      const missing = this.ctx.graph.missing(knowledge)
      return {
        kind: 'tool',
        text: `graph_query：闭包 ${closure.length} 项，越界 ${missing.length} 项`,
        payload: { closure, missing },
      }
    }

    if (tool === 'construct_item') {
      const slotKey = String(args.slotKey ?? '')
      const seed = typeof args.seed === 'number' ? args.seed : 1
      const row = blueprint.blueprint.find((entry) => entry.key === slotKey)
      if (row === undefined) {
        return { kind: 'tool', text: `construct_item：蓝图里没有题位 ${slotKey}`, payload: { error: '未知题位' } }
      }
      try {
        const item = this.ctx.construct.generate({ ...row, key: `${slotKey}-1`, count: 1 }, seed)
        this.counter += 1
        const candidateId = `cand-${this.counter}`
        this.candidates.set(candidateId, { id: candidateId, slot: row, item })
        return {
          kind: 'tool',
          text: `construct_item：${candidateId}（${item.prose.stem}）`,
          payload: { candidateId, stem: item.prose.stem, answer: item.prose.answerText, knowledge: item.slot.knowledge },
        }
      } catch (error) {
        return {
          kind: 'tool',
          text: `construct_item：${error instanceof Error ? error.message : String(error)}`,
          payload: { error: '构造失败' },
        }
      }
    }

    if (tool === 'serialize_item') {
      const candidateId = String(args.candidateId ?? '')
      const candidate = this.candidates.get(candidateId)
      if (candidate === undefined) {
        return { kind: 'tool', text: `serialize_item：没有候选题 ${candidateId}`, payload: { error: '未知候选' } }
      }
      const brief = {
        题型: candidate.item.slot.type,
        知识点: candidate.item.slot.knowledge,
        条件: candidate.item.instance.givens,
        目标: candidate.item.instance.goal,
        答案: candidate.item.witness.answer,
      }
      const reply = await this.ctx.llm.chat([
        { role: 'system', content: SERIALIZER_PROMPT },
        { role: 'user', content: JSON.stringify(brief) },
      ])
      const parsed = parseJsonObject(reply.content)
      const stem = typeof parsed?.stem === 'string' ? parsed.stem : undefined
      const answerText = typeof parsed?.answerText === 'string' ? parsed.answerText : undefined
      if (stem === undefined || answerText === undefined || stem === '') {
        return {
          kind: 'tool',
          text: 'serialize_item：执笔者没有按要求返回 stem/answerText',
          payload: { error: '序列化失败：需要 JSON 里的 stem 与 answerText' },
        }
      }
      const solution = Array.isArray(parsed?.solution) ? parsed.solution.map(String) : candidate.item.prose.solution
      // 干扰项保留构造器给的那份（错因库的活，不交给这次调用随手编）
      const options = candidate.item.prose.options
      const item: Item = {
        ...candidate.item,
        prose: {
          stem,
          ...(options === undefined ? {} : { options }),
          answerText,
          solution,
          serializer: { model: this.ctx.llm.model, version: 1 },
        },
      }
      this.candidates.set(candidateId, { ...candidate, item })
      return {
        kind: 'tool',
        text: `serialize_item：题面已写（${stem.length} 字，序列化者 ${this.ctx.llm.model}）`,
        payload: { ok: true, candidateId, stem },
      }
    }

    if (tool === 'submit_item') {
      const candidateId = String(args.candidateId ?? '')
      const candidate = this.candidates.get(candidateId)
      if (candidate === undefined) {
        return { kind: 'tool', text: `submit_item：没有候选题 ${candidateId}`, payload: { error: '未知候选' } }
      }
      const result = await this.ctx.bank.submit(candidate.item)
      if (result.ok) {
        return {
          kind: 'gate',
          text: `submit_item：${candidateId} 通过四审并入库（${result.id}）`,
          // 通过时把证据一并回给模型：它能看到"凭什么通过"，而不是只看到 ok
          payload: {
            ok: true,
            id: result.id,
            evidence: result.verdict.pass ? (result.verdict.evidence ?? {}) : {},
          },
          storedId: result.id,
        }
      }
      return {
        kind: 'gate',
        text: `submit_item：被 ${result.verdict.gate} 拦下 —— ${result.verdict.reason}`,
        payload: {
          ok: false,
          gate: result.verdict.gate,
          reason: result.verdict.reason,
          fixable: result.verdict.fixable,
          hint: result.verdict.hint ?? null,
        },
      }
    }

    if (tool === 'bank_stats') {
      const items = this.ctx.bank.all()
      return {
        kind: 'tool',
        text: `bank_stats：已入库 ${items.length} 题`,
        payload: {
          total: items.length,
          slots: blueprint.blueprint.map((row) => ({
            slot: row.key,
            want: row.count,
            have: items.filter((item) => item.slot.key.startsWith(row.key)).length,
          })),
        },
      }
    }

    return { kind: 'tool', text: `未知工具 ${tool}`, payload: { error: '未知工具' } }
  }
}

/** 执笔者提示词：只把结构写成通顺题面，**不许改数学** */
const SERIALIZER_PROMPT = [
  '你是命题组的执笔者。给你一道**已经构造好**的题的结构，把它写成给学生看的题面。',
  '只输出 JSON：{"stem":"题干","answerText":"答案","solution":["步骤1","步骤2"]}',
  '硬规矩：',
  '1. 只把给你的条件与目标写成通顺的题面，**不得新增、删改、四舍五入任何条件或数值**；',
  '2. 你不负责算答案：answerText 直接使用给你的答案；',
  '3. 步骤要写成学生看得懂的解题过程，但数值必须与给你的数据一致；',
  '4. 不要输出 JSON 以外的任何内容。',
].join('\n')

function systemPrompt(blueprint: Blueprint, extraRules: string): string {
  const rows = blueprint.blueprint
    .map((row) => `- ${row.key}：${row.knowledge.join('、')}｜${row.cognitive}｜${row.type}｜${row.score} 分 ×${row.count}`)
    .join('\n')
  return [
    '你是 AI 命题组的组长。你的产出必须是**能过闸门**的原创题。',
    '',
    `本次卷子：${blueprint.paper.title}（${blueprint.paper.className}，${blueprint.paper.totalScore} 分，${blueprint.paper.minutes} 分钟）`,
    '题位：',
    rows,
    `本卷禁用知识点：${blueprint.constraints.forbidKnowledge.join('、')}`,
    '',
    '硬规矩：',
    '1. 数学真值由构造与符号计算保证，你不要自己算答案，也不要改题面里的数值。',
    '2. 每道候选题先用 serialize_item 写题面（写漏条件会被回译闸门拦下），再用 submit_item 提交；',
    '   闸门由框架挂载，你无法跳过，也不必重复验证。',
    '3. 被拦下时读清楚是哪道闸门、能不能靠重做修好：能就换种子重来，不能就换题位设计。',
    '4. 每题位凑齐为止；凑不齐就说明原因，不要用不合规的题凑数。',
    extraRules === '' ? '' : `5. ${extraRules}`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function apply(ctx: Context, config: WorkbenchConfig): void {
  ctx.plugin(WorkbenchService, config)
}
