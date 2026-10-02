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
  /**
   * 人工终审签字（R4）：把题目从 needs_review / draft 变成 verified 并留痕。
   * **系统不得自己调用它**——只有老师在界面上点"我确认"才会走到这里。
   */
  confirm(id: string, by: string): Item | undefined
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
  /** 密钥从哪来（env / file / none）——**不给值**，只给来源 */
  readonly source: CredentialSource
  /** 还缺哪些配置（API 地址/密钥/模型名）——不完整就别发起调用，也别假装在跑 */
  readonly missing?: readonly string[]
  /** 有没有配好密钥。没配好时工作台必须**明确拒绝**，而不是假装在干活 */
  readonly configured: boolean
  /** 当前模型名（要记进 prose.serializer，题面将来可重生成） */
  readonly model: string
  chat(messages: readonly LlmMessage[], tools?: readonly LlmToolSpec[]): Promise<LlmReply>
}

export interface WorkbenchRequest {
  goal: string
  blueprint: Blueprint
  /**
   * 这一轮在哪个工作区干（缺省用会话 id）。
   * 工作区是 agent 的**手脚**：原件副本、自己写的脚本、跑出来的中间产物都落在这里，
   * 每一步可复查（见 ADR-0020：可审计，但不是沙箱）。
   */
  workspace?: string
}

/** 工作台的每一步都留痕：这就是可审计的"命题组工作记录" */
export interface WorkbenchEvent {
  step: number
  /** user = 老师中途插的话（下一步读进上下文），不是 agent 的动作 */
  kind: 'assistant' | 'tool' | 'gate' | 'user'
  text: string
}

export interface WorkbenchRun {
  goal: string
  steps: number
  transcript: readonly WorkbenchEvent[]
  stored: readonly string[]
  stopped: 'done' | 'max-steps' | 'no-llm' | 'stopped'
  /** 这一轮留下的工作区（模型没干活时是空的，但目录还是在） */
  workspace?: { name: string; files: readonly WorkspaceFile[] }
}

/** agent 工作台：模型拿工具自己迭代，但收尾动作只能是"提交"，由闸门裁决 */
export interface WorkbenchRunState {
  id: string
  goal: string
  steps: number
  workspace: string
}

export interface WorkbenchApi {
  /** 跑到底（脚本与测试用） */
  run(request: WorkbenchRequest): Promise<WorkbenchRun>
  /**
   * 起一轮并**立刻返回 runId**：过程走 run:started / run:step / run:done 事件。
   * 界面上看得见 agent 每一步在干什么，也能中途插话（下一步就生效）或叫停。
   * 同一时刻只允许一轮——做不到并行就别假装能。
   */
  start(request: WorkbenchRequest): { runId: string; workspace: string; done: Promise<WorkbenchRun> }
  /** 老师说一句：下一步读进上下文（返回 false = 这轮不在跑了） */
  interject(runId: string, text: string): boolean
  /** 让它在下一步之前停下来 */
  stop(runId: string): boolean
  active(): readonly WorkbenchRunState[]
}

// ── 设置（运行期覆盖层）────────────────────────────────────
// 原则：密钥永远只从环境变量取；设置页只改"可安全落盘"的东西，
// 并且标注哪些需要重启——需要重启的，界面会直说。

export interface AppSettings {
  /** 模型：baseUrl 与 model 可改；密钥不在这里（走 ${VAR}） */
  model: { baseUrl: string; model: string; /** 密钥存在哪个环境变量名下（配置里只放引用名） */ apiKeyEnv: string }
  /** 联网搜索：开关与网关地址 */
  websearch: { enabled: boolean; endpoint: string }
  /** 语料目录（上传的知识库会追加进这里） */
  corpusDirs: readonly string[]
  /** 新建会话的默认值 */
  sessionDefaults: { className: string; progress: string; blueprintPath: string }
  /** 闸门阈值 */
  gates: { corpusWordingMax: number; corpusNumbersMin: number; bankMaxSimilarity: number }
}

/**
 * 路径化补丁：`{ path: ['model','baseUrl'], value: '...' }`。
 *
 * 为什么不是"整体替换"：界面拿到的是**脱敏视图**（密钥字段根本没发出去），
 * 整体替换会把界面从没见过的密钥一起删掉。写入必须按路径说清改哪一片（照 DSH 的做法）。
 * `unset: true` 表示删掉这一片（回到装机配置的值）。
 */
export interface SettingsOp {
  path: readonly string[]
  value?: unknown
  unset?: boolean
}

export interface SettingsApi {
  get(): AppSettings
  /** 当前修订号：每次写入 +1。界面带旧号写入 = 有人在别处改过 → 明确冲突，不静默覆盖 */
  revision(): number
  /** 按路径改并落盘，返回新值；同时广播 settings:changed。修订号对不上抛 SettingsConflict */
  mutate(ops: readonly SettingsOp[], expectedRevision?: number): AppSettings
  /** 局部更新（内部用；等价于一组 set 操作） */
  patch(patch: DeepPartial<AppSettings>): AppSettings
  /** 哪些改动需要重启才能生效（诚实标注，不假装全部热更新） */
  restartRequired(): readonly string[]
  /** 凭据（API 密钥一类）：值**只进不出**，对外只有 describe() */
  credentials: CredentialsApi
}

/** 密钥的来源：环境变量（只读）· 本地凭据文件（可改）· 没有 */
export type CredentialSource = 'env' | 'file' | 'none'

/**
 * 凭据描述——**故意没有值字段**：密钥只单向流入（DESIGN: DSH 的
 * "Secret values cross in one direction only"）。界面据此渲染"已配置/未配置"。
 */
export interface CredentialInfo {
  ref: string
  configured: boolean
  source: CredentialSource
  /** 环境变量给的密钥不可从界面改（改了也不算数） */
  writable: boolean
}

export interface CredentialsApi {
  /** 取密钥值——只给服务端自己用（模型客户端、检索），绝不进 HTTP 响应 */
  get(ref: string): string
  describe(ref: string): CredentialInfo
  set(ref: string, value: string): CredentialInfo
  unset(ref: string): CredentialInfo
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

// ── 知识库（上传 + 由 agent 整理）─────────────────────────────
// 用户上传的是"原始资料"，它是**待整理**的；整理这件事交给 agent 做
// （parse → extract → tag → dedupe → write），而不是靠一个手写导入器。

export type KbStatus = 'raw' | 'ingesting' | 'indexed' | 'failed'

export interface KbBatch {
  id: string
  name: string
  /** 上传时间 */
  at: string
  status: KbStatus
  files: readonly { name: string; bytes: number }[]
  /** 整理进语料的条数 */
  records: number
  note?: string
}

// ── 工作区（agent 的手脚）─────────────────────────────────────
// 一个工作区 = 一个目录：`in/`（原件副本）· `tmp/`（agent 自己写的脚本）· `out/`（产物）。
// agent 在里面读文件、写脚本、跑 `python3`（venv 优先）与命令行工具，产出中间文件再交给别的工具。
// **这是可审计，不是沙箱**：脚本落在目录里能被复查，但进程本身没有被隔离（ADR-0020）。

export interface WorkspaceFile {
  /** 相对工作区根目录的路径 */
  path: string
  bytes: number
  at: string
}

export interface WorkspaceRun {
  argv: readonly string[]
  /** 退出码；被杀掉（超时）时为 null */
  code: number | null
  out: string
  err: string
  timedOut: boolean
  ms: number
}

export interface WorkspaceApi {
  /** 打开（必要时创建）工作区，返回目录绝对路径与现有文件 */
  open(name: string): { name: string; path: string; files: readonly WorkspaceFile[] }
  /** 把外部文件复制进 `in/`（原件只读副本，别在原件上动手） */
  seed(name: string, sources: readonly string[]): number
  list(name: string): readonly WorkspaceFile[]
  /** 分片读（与 kb_read 同一套翻页语义） */
  read(name: string, relPath: string, offset?: number, limit?: number): { text: string; total: number; next?: number } | undefined
  write(name: string, relPath: string, text: string): { path: string; bytes: number } | undefined
  /** 跑一条命令：cwd = 工作区，argv 逐个传参（不过 shell），可执行文件走白名单 */
  run(name: string, argv: readonly string[], timeoutMs?: number): WorkspaceRun
  /** 虚拟环境里的 python（没建 venv 时返回 undefined，工具会如实告诉 agent 怎么办） */
  venvPython(): string | undefined
  /** 工作区目录（界面要显示"agent 把东西放哪了"）；名字非法时 undefined */
  dirOf(name: string): string | undefined
}

export interface KbApi {
  list(): readonly KbBatch[]
  /** 上传一批文本文件（PDF/扫描件请先转文本；二进制不支持） */
  upload(name: string, files: readonly { name: string; text: string }[]): KbBatch
  /** 读某个知识库里的文件（给 agent 用；分页切片，避免一次糊进上下文） */
  read(batchId: string, fileName: string, offset?: number, limit?: number): { text: string; total: number; next?: number } | undefined
  /** agent 整理时逐条写入语料 */
  write(batchId: string, records: readonly CorpusRecord[]): number
  mark(batchId: string, status: KbStatus, note?: string): KbBatch | undefined
  dirOf(batchId: string): string | undefined
}

// ── 会话与版本（应用层）─────────────────────────────────────
// paper 只负责"按蓝图凑齐一份卷子"；会话负责**它是谁、第几版、谁签过字**。

/** 会话分组（按班级/学期/用途归类） */
export interface SessionGroup {
  id: string
  name: string
}

export interface SessionMeta {
  id: string
  title: string
  className: string
  /** 教学进度，例如「九上·22章·第2课时」 */
  progress: string
  /** 本次会话要用的蓝图文件 */
  blueprintPath: string
  createdAt: string
  /** 冻结后所有写操作一律拒绝（R3） */
  frozen: boolean
  /** 归属分组；空串表示未分组 */
  groupId: string
  /** 这个会话绑定哪个知识库（整理时用；空串表示不绑定） */
  kbId: string
}

/** 卷面题位 → 题目，以及这道题的人工签字 */
export interface SlotBinding {
  slot: string
  itemId: string
  /** 人工终审签字（R4）：谁、何时 */
  confirmedBy: string | null
  confirmedAt: string | null
}

export interface PaperVersion {
  version: number
  at: string
  /** 为什么产生这一版（组卷 / 重做某题位） */
  reason: string
  bindings: readonly SlotBinding[]
  totalScore: number
  scoreGap: number
  attempts: number
  gaps: readonly PaperGap[]
}

/** 两个版本之间某个题位的变化 */
export interface SlotChange {
  slot: string
  change: 'added' | 'removed' | 'replaced' | 'same'
  from?: string
  to?: string
}

export interface SessionApi {
  list(): readonly SessionMeta[]
  /** 会话分组 */
  groups(): readonly SessionGroup[]
  createGroup(title: string): SessionGroup
  renameGroup(id: string, title: string): SessionGroup | undefined
  /** 把会话挪到某个分组（'' = 移出分组） */
  moveToGroup(sessionId: string, groupId: string): SessionMeta | undefined
  current(): SessionMeta
  /** 新建会话：一次把 agent 开工要读的约定都定下来（含归属分组与知识库） */
  create(
    patch?: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath' | 'groupId' | 'kbId'>>,
  ): SessionMeta
  switch(id: string): SessionMeta
  /** 改当前会话的约定 */
  update(patch: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath'>>): SessionMeta
  versions(): readonly PaperVersion[]
  latest(): PaperVersion | undefined
  /**
   * 两版之间的题位变化。参数是**版本号**（1 起，与界面显示的 v1/v2 一致），
   * 缺省为最后两版——界面与测试都不该去记数组下标。
   */
  diff(from?: number, to?: number): readonly SlotChange[]
  /** 组卷并记为新版本 */
  assemble(reason?: string): Promise<PaperVersion>
  /** 只重做某一个题位，**必须守住蓝图约束**；返回被替换掉的那道题 */
  regenerate(slotKey: string, seed?: number): Promise<{ ok: boolean; version?: PaperVersion; reason?: string }>
  /** 人工终审签字（R4）。签名与时间落入题目的 review 与会话轨迹 */
  confirm(itemId: string, by: string): SlotBinding | undefined
  freeze(): PaperVersion | undefined
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
  /** 重新扫描目录（上传新知识库后调用，让它立刻可检索） */
  reload(): number
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
    session: SessionApi
    settings: SettingsApi
    kb: KbApi
    workspace: WorkspaceApi
  }
}
