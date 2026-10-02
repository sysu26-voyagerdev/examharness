import type { Blueprint, BlueprintRow, FigureArtifact, FigureSpec, Item, SlotSpec, Verdict } from './types.js'

// 必须真实导入被增强的模块：TS 只在模块已进入程序时才认这条声明合并
import '@deepseek-ai/cordis'

/**
 * 能力 seam：**接口定义放这里，实现放各插件包**。
 *
 * 这样做的原因很实际：闸门 A 只声明 `inject: ['bank']`，它不该（也不需要）
 * 依赖题库包的实现；但 TS 要知道 `ctx.bank` 长什么样。接口集中在 core，
 * 消费者只依赖 core，实现者各自实现 —— 与 DSH 的 capability seam 同构。
 */

export interface SearchQuery {
  knowledge?: readonly string[]
  difficulty?: readonly [number, number]
  limit?: number
}

/** 失败的判定（只可能是失败那一支） */
export type FailureVerdict = Extract<Verdict, { pass: false }>

/** 提交结果：拒绝时**必然**携带失败判定，类型层面就禁止"ok:false 但没有原因" */
export type SubmitResult =
  | { ok: true; id: string; verdict: Verdict }
  | { ok: false; verdict: FailureVerdict }

/** 题库：唯一写入口 submit()，它必然先跑闸门链 */
export interface BankApi {
  bySlot(key: string): readonly Item[]
  search(query?: SearchQuery): readonly Item[]
  fewShot(knowledge: readonly string[], count: number): readonly Item[]
  /** 结构指纹：构造器 + 参数（确定性） */
  fingerprint(item: Item): string
  /** 相似度：参数字面量 + 知识点的 Jaccard */
  similarity(a: Item, b: Item): number
  submit(item: Item): Promise<SubmitResult>
  get(id: string): Item | undefined
  all(): readonly Item[]
}

/** 知识点图谱：既是 agent 的设计工具（引导），也是闸门（越界检测） */
export interface GraphApi {
  prerequisites(keys: readonly string[]): string[]
  closure(keys: readonly string[]): string[]
  /** 越界知识点：不在已学集合里的（空数组 = 合法） */
  missing(keys: readonly string[]): string[]
  nodes(): readonly string[]
  learnedKeys(): readonly string[]
}

/** 构造器：题位 + 种子 → 一道题（同种子必须复现同一道题） */
export type Constructor = (slot: BlueprintRow, seed: number) => Item

/** 构造器注册表 */
export interface ConstructApi {
  register(kind: string, factory: Constructor): void
  kinds(): readonly string[]
  generate(slot: BlueprintRow, seed: number): Item
}

/** 卷面题位：蓝图题位 + 落在它上面的题 */
export interface PaperSlot {
  /** 卷面题位标识，例如 'S1-1'（蓝图行 key + 序号） */
  key: string
  spec: SlotSpec
  itemId: string
}

/** 缺口：没凑齐的题位与原因。**不许静默少给题** */
export interface PaperGap {
  slot: string
  missing: number
  reason: string
}

/** 一份卷子 */
export interface Paper {
  blueprint: Blueprint
  slots: readonly PaperSlot[]
  gaps: readonly PaperGap[]
  /** 由易到难排列的 itemId */
  order: readonly string[]
  totalScore: number
  /** 蓝图满分 − 实得满分（负值=超出） */
  scoreGap: number
  /** 组卷过程中提交了几次（可观测：闸门拦了几次） */
  attempts: number
}

export interface AssembleOptions {
  /** 每个卷面题位的候选种子；用尽即报缺口 */
  seeds?: Readonly<Record<string, readonly number[]>>
  /** 单题位最大尝试次数 */
  maxAttempts?: number
}

/** 组卷：把蓝图变成一份卷子。**是约束求解，不是"生成 N 道题"** */
export interface PaperApi {
  assemble(blueprint: Blueprint, options?: AssembleOptions): Promise<Paper>
  current(): Paper | undefined
}

// ── 模型与工作台 ──────────────────────────────────────────────
// LLM 在这个项目里只有两件事：**序列化题面** 与 **驱动工作台**。
// 它不产生数学真值（R1），也不决定验证跑不跑（R2）。

export interface LlmToolSpec {
  name: string
  description: string
  parameters: Readonly<Record<string, unknown>>
}

export interface LlmToolCall {
  id: string
  name: string
  /** 原始 JSON 字符串；解析失败要当成工具错误回给模型，而不是崩掉 */
  arguments: string
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** role = tool 时指回哪次调用 */
  toolCallId?: string
  toolCalls?: readonly LlmToolCall[]
}

export interface LlmReply {
  content: string | null
  toolCalls: readonly LlmToolCall[]
}

export interface LlmApi {
  /** 有没有配好密钥。没配好时工作台必须**明确拒绝**，而不是假装在干活 */
  readonly configured: boolean
  /** 当前模型名（要记进 prose.serializer，题面将来可重生成） */
  readonly model: string
  chat(messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]): Promise<LlmReply>
}

export interface WorkbenchRequest {
  goal: string
  blueprint: Blueprint
}

/** 工作台的每一步都留痕：这就是可审计的"命题组工作记录" */
export interface WorkbenchEvent {
  step: number
  kind: 'assistant' | 'tool' | 'gate'
  text: string
}

export interface WorkbenchRun {
  goal: string
  steps: number
  transcript: readonly WorkbenchEvent[]
  stored: readonly string[]
  stopped: 'done' | 'max-steps' | 'no-llm'
}

/** agent 工作台：模型拿工具自己迭代，但收尾动作只能是"提交"，由闸门裁决 */
export interface WorkbenchApi {
  run(request: WorkbenchRequest): Promise<WorkbenchRun>
}

/** 语料库里的一条记录（真实题库/教材整理来的参考材料） */
export interface CorpusRecord {
  id: string
  /** 来源标识（文件名或机构名），便于回溯 */
  source: string
  /** 题干纯文本 */
  stem: string
  answer?: string
  knowledge: readonly string[]
  type?: string
  difficulty?: number
  /**
   * 是否可以对外展示。**默认 false**：受版权保护的材料只作内部参考
   * （对齐风格、难度先验、错因、查重对照），对外只出数字不出原文（ADR-0014）。
   */
  distributable: boolean
}

/**
 * 语料库。**与题库严格分开**：
 *   - 题库 = 我们自己构造并经闸门验证的原创题（可分发）；
 *   - 语料库 = 真实世界的参考材料（默认不可分发）。
 * 混在一起会同时毁掉"原创"叙事和查重语义。
 */
/** 检索命中：给 agent 看的是**摘要**，不是整条原文 */
export interface CorpusHit {
  id: string
  source: string
  snippet: string
  knowledge: readonly string[]
  type?: string
  difficulty?: number
  /** 这条能不能对外（默认 false：受版权保护的只作内部参考） */
  distributable: boolean
}

/** 双指标：数字（数学上是不是同一道题）+ 措辞（有没有换皮） */
export interface CorpusCompareResult {
  wording: number
  numbers: number
  id?: string
  source?: string
}

/**
 * 语料库：**同一个资产，两副面孔**（见 docs/agent/03 §3）。
 *
 *   - **引导**（agent 自己调度）：`search` / `read` / `compare` —— 查、读、对比；
 *   - **闸门**（框架调度，agent 跳不过）：查重闸门调用 `compare`，按阈值判定原创度。
 *
 * 两者用同一批方法，**差别只在谁在调度**。把语料做成"只给闸门用"是设计错误：
 * agent 拿不到检索手段，就等于把教材原文这条参考线砍掉了。
 */
export interface CorpusApi {
  readonly size: number
  records(): readonly CorpusRecord[]
  /** 引导：按关键词与知识点检索（命中给摘要，不给全文） */
  search(query: { text?: string; knowledge?: readonly string[]; limit?: number }): readonly CorpusHit[]
  /** 引导：读某一条的全文（读过才谈得上参考表述、比较结构） */
  read(id: string): CorpusRecord | undefined
  /**
   * 双指标相似度（引导与闸门共用同一实现）。
   * 只看措辞会把"同一知识点不同数值"的题全判成抄原题——这是必须避免的误伤。
   */
  compare(text: string): CorpusCompareResult
  stats(): {
    total: number
    distributable: number
    bySource: Readonly<Record<string, number>>
    byKnowledge: Readonly<Record<string, number>>
  }
}

// ── 联网搜索（可配置的引导工具；默认关闭）──────────────────────

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * 联网搜索。**它是引导，不是闸门**：网上既有可用的素材（情境、数据、课标原文），
 * 也有别人已经出过的题——后者只有查重闸门拦得住，所以检索结果**永远只是素材**，
 * 绝不作为数学真值（R1）。
 */
export interface WebSearchApi {
  /** 未启用时 agent 连这个工具都看不到（工具表按配置生成） */
  readonly enabled: boolean
  search(query: string, limit?: number): Promise<readonly WebSearchResult[]>
}

/** 图形渲染：由 spec 决定，不靠模型"画" */
export interface FigureApi {
  render(spec: FigureSpec): FigureArtifact
  /** 渲染题目自带的图；没有图返回 undefined */
  renderItem(item: Item): FigureArtifact | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    bank: BankApi
    graph: GraphApi
    construct: ConstructApi
    paper: PaperApi
    figure: FigureApi
    llm: LlmApi
    workbench: WorkbenchApi
    corpus: CorpusApi
    websearch: WebSearchApi
  }
}
