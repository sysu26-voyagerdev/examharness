/**
 * 服务端投影的类型（与 packages/plugin-web 的接口一一对应）。
 * 界面**不猜服务端形状**：对不上就该在这里报错，而不是在渲染时 undefined。
 */

export interface EvidenceView {
  pass: boolean
  detail?: string
}

export interface ItemView {
  id: string
  slot: string
  knowledge: readonly string[]
  type: string
  score: number
  lifecycle: string
  stem: string
  answer: string
  /** 正文里的数学（$...$）已经在服务端渲染好，界面直接显示，不引数学库 */
  stemHtml: string
  answerHtml: string
  solutionHtml: readonly string[]
  /** 选择题的选项（界面必须显示：没有选项的选择题不是题）；correct 只在"看答案"时用 */
  options: readonly { key: string; html: string; correct: boolean; errorType?: string }[]
  /** 图由服务端按 spec 渲染好；界面只显示 */
  figure: string
  constructor: string
  seed: number
  evidence: Readonly<Record<string, EvidenceView>>
  /** 检查过期：闸门后来加了判据，这道题的签字是旧规则的（要重新过一遍） */
  stale?: boolean
  /** 以下字段只有 /api/session 的题位带 */
  difficulty?: readonly [number, number]
  slotKey?: string
  confirmedBy?: string | null
  confirmedAt?: string | null
  knowledgeWanted?: readonly string[]
}

export interface BlueprintRowView {
  key: string
  knowledge: readonly string[]
  cognitive: string
  type: string
  count: number
  difficulty: readonly [number, number]
  score: number
}

/** 库里一份蓝图的摘要 */
export interface BlueprintInfoView {
  name: string
  path: string
  title: string
  totalScore: number
  minutes: number
  slots: number
  builtin: boolean
  createdBy?: 'agent' | 'teacher'
}

export interface BlueprintView {
  paper: { title: string; totalScore: number; minutes: number; className: string; studentFields?: boolean }
  blueprint: readonly BlueprintRowView[]
  constraints: { forbidKnowledge: readonly string[] }
}

export interface SlotBindingView {
  slot: string
  itemId: string
  confirmedBy: string | null
  confirmedAt: string | null
  /** 被明确指到过这个题位的人（老师 / agent）：指过的**钉住**，重组卷不换掉它 */
  chosenBy?: string
}

export interface VersionView {
  version: number
  at: string
  reason: string
  totalScore: number
  scoreGap: number
  attempts: number
  gaps: readonly { slot: string; missing: number; reason: string }[]
  bindings: readonly SlotBindingView[]
  /** 卷名（卷面标题）：由蓝图带下来，卷面上居中显示 */
  paperTitle?: string
}

export interface SlotChangeView {
  slot: string
  change: 'added' | 'removed' | 'replaced' | 'same'
  from?: string
  to?: string
}

export interface SessionMetaView {
  /** 列表接口附带：这一张卷子的现状（多少道、多少分、还缺几道、最后动过） */
  items?: number
  totalScore?: number
  version?: number
  gaps?: number
  updatedAt?: string
  id: string
  title: string
  className: string
  progress: string
  blueprintPath: string
  createdAt: string
  frozen: boolean
  groupId: string
  kbId: string
}

export interface SessionGroupView {
  id: string
  name: string
}

export interface SessionsView {
  currentId: string
  sessions: readonly SessionMetaView[]
  groups: readonly SessionGroupView[]
  defaults: { className: string; progress: string; blueprintPath: string }
}

/** 会话记录的一行：老师说的、agent 做的、闸门判的，按时间排在一起 */
export interface LogEntryView {
  id: string
  at: string
  kind: 'user' | 'assistant' | 'tool' | 'gate' | 'verdict'
  text: string
  runId?: string
  /** 属于哪个工作区：工作台看会话的，资料页看这一批资料的 */
  workspace?: string
  /** 工具名（界面翻译成人话） */
  tool?: string
  /** 这一行是谁做的（agent 的 runId）：子任务的记录挂回自己的块 */
  agent?: string
  /** 起一轮的那一行带它：这一轮是谁派的（空 = 老师直接起的） */
  parent?: string
  /** 界面上把连续重复的行合并时用的计数（服务端不存这个） */
  repeat?: number
}

export interface SessionView {
  meta: SessionMetaView
  blueprint: BlueprintView
  slots: readonly ItemView[]
  versions: readonly VersionView[]
  diff: readonly SlotChangeView[]
  log: readonly LogEntryView[]
}

export interface KnowledgeView {
  nodes: readonly { key: string; prerequisites: readonly string[] }[]
  learned: readonly string[]
}

/** 知识点在图谱页上的样子（`GET /api/graph`）——可选字段缺了就不画，不要编 */
export interface GraphNodeView {
  key: string
  prerequisites: readonly string[]
  /** 谁拿它当前置 */
  successors: readonly string[]
  /** 前置闭包大小（不含自己） */
  depth: number
  /** 同年级同章节里的第几个 */
  chapterIndex: number
  /** 已学（含前置闭包，与超纲闸门同一份语义） */
  learned: boolean
  grade?: string
  chapter?: string
  domain?: string
  kind?: string
  aliases?: readonly string[]
  /** 存在依据：课标条目原文、教材章节、真题统计 */
  sources?: readonly string[]
  /** 每一条前置凭什么成立 */
  prerequisiteBasis?: Readonly<Record<string, string>>
  evidenceLevel?: string
  zhenti?: { papers: number; questions: number }
  /** 常见问法（人工归纳，不是统计出来的） */
  ask?: string
}

export interface GraphView {
  total: number
  edges: number
  learned: readonly string[]
  nodes: readonly GraphNodeView[]
  /** 指向图里不存在的知识点的前置边 */
  dangling: readonly { key: string; missing: string }[]
  /** 这张图是脚本从哪些材料算出来的 */
  generatedBy?: Readonly<Record<string, unknown>>
}

export interface StateView {
  blueprint: BlueprintView
  items: readonly ItemView[]
  knowledge: KnowledgeView
}

/** 密钥在界面上只有这些信息：**没有值**（ADR-0022） */
export interface CredentialInfoView {
  ref: string
  configured: boolean
  source: 'env' | 'file' | 'none'
  writable: boolean
}

/** 可编辑的运行期设置（落盘到 data/settings.json） */
export interface AppSettingsView {
  model: { baseUrl: string; model: string; apiKeyEnv: string }
  websearch: { enabled: boolean; endpoint: string }
  corpusDirs: readonly string[]
  sessionDefaults: { className: string; progress: string; blueprintPath: string }
  gates: { corpusWordingMax: number; corpusNumbersMin: number; bankMaxSimilarity: number }
}

/** 设置页 = 可改的设置 + 只读的运行期观测值 */
export interface SettingsView {
  /** 服务端返回的是脱敏视图：密钥字段换成了 {configured, source, writable} */
  app: AppSettingsView & { model: { apiKey: CredentialInfoView } }
  /** 修订号：写入时带上旧号 = 有人在别处改过 → 明确冲突，不静默覆盖 */
  revision: number
  runtime: {
    modelConfigured: boolean
    modelName: string
    modelSource: 'env' | 'file' | 'none'
    corpusTotal: number
    corpusDistributable: number
    corpusBySource: Readonly<Record<string, number>>
    websearchEnabled: boolean
    /** 哪些改动要重启才生效（诚实标注；目前都是热设置 = 空） */
    restartRequired: readonly string[]
    constructors: readonly string[]
    gates: readonly string[]
  }
}

export type KbStatus = 'raw' | 'ingesting' | 'indexed' | 'failed'

export interface KbBatchView {
  id: string
  name: string
  at: string
  /** 从本机文件夹导入的批次：文件原地不动 */
  sourceDir?: string
  status: KbStatus
  files: readonly { name: string; bytes: number }[]
  records: number
  note?: string
}

export interface KbListView {
  batches: readonly KbBatchView[]
  corpusTotal: number
}

export interface WorkspaceFileView {
  path: string
  bytes: number
  at: string
}

/** 工作区视图：agent 留下了什么（in/ 原件 · tmp/ 脚本 · out/ 产物） */
export interface WorkspaceView {
  name: string
  path: string
  venv: string | null
  files: readonly WorkspaceFileView[]
}

export interface RunEventView {
  /** 属于哪一轮（界面可以同时看到多轮记录，各自归位） */
  runId?: string
  step: number
  /** user = 老师中途插的话 */
  kind: 'assistant' | 'tool' | 'gate' | 'user'
  text: string
}

export interface RunView {
  goal: string
  steps: number
  transcript: readonly RunEventView[]
  stored: readonly string[]
  stopped: 'done' | 'no-llm' | 'stopped' | 'error'
  /** 子任务的短名字与它的父（没有父 = 老师直接起的一轮） */
  label?: string
  parent?: string
  /** 这一轮留下的工作区 */
  workspace?: { name: string; files: readonly WorkspaceFileView[] }
}

/** agent 循环的生命周期信号（SSE 里的 run:*） */
export type RunSignal =
  | { kind: 'started'; runId: string; goal: string; workspace: string; label?: string; parent?: string }
  | {
      kind: 'step'
      runId?: string
      step: number
      stepKind: RunEventView['kind']
      text: string
      workspace: string
      agent?: string
    }
  | { kind: 'busy'; runId: string; agent: string; what: string; workspace: string }
  | {
      kind: 'done'
      runId: string
      stopped: RunView['stopped']
      steps: number
      stored: readonly string[]
      workspace: string
      label?: string
      parent?: string
    }
  /**
   * 模型正在写什么（流式，一小段一小段来）：只用于"实时浅字"那一块。
   *
   * `part` 是**哪一路**：`think` = 它在想，`say` = 它写给人看的正文，
   * `use` = 它在给某个工具填参数（这时 `text` 是工具名）。
   * 这里叫 part 而不是 kind：信号自己的判别字段就是 `kind`，同名会互相盖掉。
   */
  | { kind: 'delta'; runId: string; label: string; part: StreamPart; text: string; workspace: string }

/** 题库页的投影：筛出来的题 + 分面（各知识点/题型/状态各有多少道） */
export interface BankView {
  total: number
  facets: {
    knowledge: readonly { key: string; count: number }[]
    type: readonly { key: string; count: number }[]
    status: readonly { key: string; count: number }[]
  }
  items: readonly ItemView[]
}

export interface BankQuery {
  knowledge?: string
  type?: string
  status?: string
  q?: string
  limit?: number
  offset?: number
}

/**
 * 口述出题：老师那句话被翻译成的题位 + 现造出来的题。
 *
 * `spec` 一定要显示给老师看——他才知道系统把他的话理解成了什么，
 * 理解错了当场就能发现（而不是拿到一道莫名其妙的题猜哪里出了问题）。
 */
export interface ComposeSpecView {
  knowledge: readonly string[]
  unresolved: readonly string[]
  type: string
  score: number
  difficulty: readonly [number, number]
  note: string
}

export interface ComposeView {
  ok: boolean
  spec?: ComposeSpecView
  items: readonly ItemView[]
  similar?: readonly ItemView[]
  /** 出了一道但降了规格时的一句人话（降了就说清楚） */
  adjusted?: string
  reason?: string
  attempts?: readonly string[]
  /** 换个相近的知识点就能出（点一下就出，不自动替换） */
  alternatives?: readonly string[]
  escalate?: string
}

/** 界面上的一个 agent（主线或子任务）：用来显示"谁在干什么、走到第几步" */
export interface RunAgentView {
  id: string
  goal: string
  steps: number
  workspace: string
  /** 这一轮什么时候开始的（界面显示"整轮已用时"；它不是服务端字段，是收到 started 时记的） */
  since?: number
  label?: string
  /** 谁派的（没有 = 老师直接起的一轮） */
  parent?: string
}

/**
 * 一轮是怎么结束的（服务端 `run:done` 里的 `stopped`：做完了 / 出错 / 没模型 / 老师叫停）
 */
export type RunDoneView = RunView['stopped']

/**
 * 实时区的两路：`think` = 它在想，`say` = 它写给人看的正文。
 *
 * 为什么非要分两路：带工具的回合里模型**先想十几秒**，那段时间流里只有 `think`。
 * 合成一路就等于把"它正在想的事"当成"它写出来的话"摆在老师眼前。
 */
export type StreamLaneKind = 'think' | 'say'

/**
 * 流式信号里的"这一段是哪一路"：两路之外还有 `use`——
 * **它开始给工具填参数了**（名字先到）。参数是给程序看的 JSON（真实跑过十几秒），
 * 界面不摆内容，只把"它在准备哪一步"说出来；这一路的 `text` 是**工具名**。
 */
export type StreamPart = StreamLaneKind | 'use'

/** 一路输出的尾巴（实时区显示的就是它） */
export interface StreamLane {
  /** 这一路是**谁在写**（主线"它说"、执笔者的"写题面"…）：换一路就另起一段 */
  label: string
  text: string
  /** 这一路最后一次吐字的时间（没在吐字时，界面显示最近动过的那一路） */
  at: number
}

/**
 * 模型写出来的字（agent 栏底部那一块实时区）。
 *
 * 它是**这一轮**的流，不是记录：记录只认走完的 `run:step`。
 * 两路各自留尾巴，`live` 说"此刻在吐字的是哪一路"（null = 这一轮此刻没在吐字）。
 * 文本只留尾巴（几十 KB 的正文塞进一条 76px 高的框里没有意义，而且每来一段都要重排）。
 */
export interface StreamView {
  think: StreamLane | null
  say: StreamLane | null
  /** 此刻在吐字的是哪一路；null = 这一轮里它此刻没在吐字（工具在跑、或者轮到别人） */
  live: StreamLaneKind | null
  /**
   * 它正在**给哪个工具填参数**（`use` 那一路带过来的工具名）。
   *
   * 参数不摆出来（那是给程序看的 JSON，真实跑过十几秒），但这一段必须说出来：
   * 不说的话，那十几秒里那一块的字一动不动，看着像死了。
   */
  preparing: string | null
}

export interface LiveEvent {
  kind:
    | 'stored'
    | 'rejected'
    | 'confirmed'
    | 'run:step'
    | 'run:started'
    | 'run:done'
    | 'kb:changed'
    | 'settings:changed'
    | 'workspace:changed'
  batchId?: string
  status?: string
  records?: number
  /** workspace:changed 用 */
  name?: string
  files?: number
  /** run:started / run:done 用 */
  runId?: string
  goal?: string
  workspace?: string
  stopped?: RunView['stopped']
  steps?: number
  stored?: readonly string[]
  at: string
  id?: string
  slot?: string
  by?: string
  text?: string
  step?: number
  verdict?: { gate: string; reason: string; fixable: boolean; hint?: string }
  /**
   * stored / confirmed 的那一道是什么（服务端 `summarize` 里本来就有）：
   * 界面拿它把实时那一行写成和服务端记录**同一句话**，一会儿重拉记录时不会"换一个说法"。
   */
  knowledge?: readonly string[]
  type?: string
  score?: number
  /** 卷面上的第几题（在卷子上才有） */
  number?: number
}
