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
  paper: { title: string; totalScore: number; minutes: number; className: string }
  blueprint: readonly BlueprintRowView[]
  constraints: { forbidKnowledge: readonly string[] }
}

export interface SlotBindingView {
  slot: string
  itemId: string
  confirmedBy: string | null
  confirmedAt: string | null
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

/** 界面上的一个 agent（主线或子任务）：用来显示"谁在干什么、走到第几步" */
export interface RunAgentView {
  id: string
  goal: string
  steps: number
  workspace: string
  label?: string
  /** 谁派的（没有 = 老师直接起的一轮） */
  parent?: string
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
}
