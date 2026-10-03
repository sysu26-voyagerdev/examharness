import type {
  Blueprint,
  BlueprintRow,
  FigureArtifact,
  FigureSpec,
  Item,
  QuestionType,
  SlotSpec,
  Verdict,
} from './types.js'
import type { FusionView, KnowledgeMatch, KnowledgeNeighbors } from './graph.js'

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
  /**
   * **预检**：跑一遍闸门链，但**不入库**。
   *
   * 为什么要有它：口述出题会一次造好几个候选，结构上就站不住的（分量不够、超纲、
   * 选项不全）不该先花一次模型调用把题面写出来再被拦下——先用模板题面预检，能过的才值得写。
   * 这不是第二个写入口：预检不落库、不发事件、不改变任何状态，判定永远还是那套闸门给的。
   */
  verify?(item: Item): Promise<Verdict>
  get(id: string): Item | undefined
  all(): readonly Item[]
  /**
   * 闸门**向题库报到**（由闸门自己在挂载时调用）。
   *
   * 为什么要有：题目一旦入库，重组卷时会直接复用（R3：不重跑）。
   * 但那样一来，**新加的闸门管不到旧题**——真实后果：分量闸门上线后，
   * 卷子里还留着"9 分解答题 = 化简 √108"这类旧题。
   * 有了名单，复用就能要求"这道题的证据里**每一道现役闸门**都签过字"，
   * 签不全的题会被重新送进闸门链（要么补签，要么被拦下）。
   */
  declareGate?(name: string): void
  /** 现役闸门名单（按报到顺序） */
  gates?(): readonly string[]
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
  /**
   * 按名字/别名模糊找知识点。
   * 为什么要有：图谱有一百多个知识点，逼 agent 一字不差地写对名字，
   * 结果是它写错一个字就白跑一轮——这是它的高频痛点，不该靠提示词解决。
   */
  search(text: string, limit?: number): readonly KnowledgeMatch[]
  /** 前置与后继（图谱是双向看的：命题时要看"学过什么"，也要看"接下来能学什么"） */
  neighbors(key: string): KnowledgeNeighbors | undefined
  /**
   * 多知识点融合的证据：在真题里常和谁一起考、支持卷数、题型分布、常见分值。
   * 没有融合数据（seed/knowledge-fusion.json 缺失）时返回空统计，而不是抛错——
   * 图谱本身必须能单独用。
   */
  fusion(key: string): FusionView
}

/** 构造器：题位 + 种子 → 一道题（同种子必须复现同一道题） */
export type Constructor = (slot: BlueprintRow, seed: number) => Item

/** 构造器注册表 */
export interface ConstructApi {
  register(kind: string, factory: Constructor, covers?: readonly string[]): void
  /** 每个构造器覆盖哪些知识点 */
  coverage?(): Readonly<Record<string, readonly string[]>>
  kinds(): readonly string[]
  /**
   * 这个题位**能用哪些构造器**（按注册顺序）。
   *
   * 为什么不"挑一个"就算了：同一个知识点下可能有多个题型——一个是入门小题，
   * 一个是多问综合题。题位是 9 分解答题时，小题过不了分量闸门，
   * 组装时应该**接着试下一个**，而不是让整个题位报缺口。
   */
  candidates?(slot: BlueprintRow): readonly string[]
  /** 用指定的构造器构造（题位 + 种子 → 一道题） */
  generateWith?(slot: BlueprintRow, seed: number, kind: string): Item
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
  /**
   * **这一版沿用了上一版的那几道**（题位）。
   *
   * 什么时候会沿用：这个题位的候选题型都造不出"新的"了——同一题型的参数空间是有限的，
   * 库里攒起来之后（真实情况：548 道）"再生一道不重样的"就会失败。
   * 那时候宁可**沿用上一版这个题位的那道**，也不要报缺口——卷子缺一道题比"少一点新意"严重得多，
   * 而且沿用了哪几道必须如实说出来（界面上显示在版本说明里）。
   */
  reused?: readonly string[]
}

export interface AssembleOptions {
  /** 每个卷面题位的候选种子；用尽即报缺口 */
  seeds?: Readonly<Record<string, readonly number[]>>
  /** 单题位最大尝试次数 */
  maxAttempts?: number
  /**
   * 这次的组卷标识。**不同次组卷必须给不同的值**（默认取当前时间）——
   * 这样"再出一版"就是**现造**一批新题，而不是把上次那批从库里捞回来。
   *
   * 同一张卷内要能复现：同一次组卷的内部重试仍然按 (题位, 尝试, nonce) 派生种子。
   */
  nonce?: string
  /**
   * 已经有过的**结构指纹**：优先避开它们，让新卷子在结构上也是新的
   * （不只是换数字）。都用过了就退回到能过闸门的那些。
   */
  usedShapes?: readonly string[]
  /**
   * **钉住的题位**（题位 → 题号）：这些题位不许重造，直接用指定的题。
   * 老师签过字的那道题属于老师，重组卷不该把它换掉。
   */
  pinned?: Readonly<Record<string, string>>
  /**
   * **上一版每个题位上摆的是哪道**（题位 → 题号）：现造不出新的时的最后一招。
   * 只有在"这个题位的候选题型都造不出新的"时才会用它（见 `Paper.reused`）。
   */
  previous?: Readonly<Record<string, string>>
  /**
   * **这个题位该用哪个题型**（题位 → 题型名）：卷子自己记住的事。
   *
   * 为什么要有：一个题位常常有好几个题型能出（入门小题、多问综合题、新写的题型…），
   * 按注册顺序挑第一个 = **agent 新写的题型永远轮不到**——真实后果：
   * agent 为"第 2 题"专门写了一个更好的题型、也造出了题，重组的卷子上却还是老题型出的老题，
   * 老师的结论只能是"你做的活我看不见"。
   *
   * 所以：卷子上这个题位现在用的题型，下一版继续用它（题目照样现造）。
   * 换题型要有明确的动作（老师指定、或 agent 明确说换），不靠"谁先注册"。
   */
  preferredKinds?: Readonly<Record<string, string>>
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
  /**
   * 这一轮是**谁派出来的**：没有 = 老师直接起的（界面上的"一轮"）；
   * 有 = 某个 agent 派的子任务（子任务可以并行跑，父 agent 能查进度、能收结果）。
   */
  parent?: string
  goal: string
  /**
   * 现状简报：框架准备好的"现在是什么情况"（蓝图题位、各题位还缺几道、有哪些资料）。
   *
   * 为什么要有它：以前 agent 每轮开工都要 ws_ls / bank_stats / kb_list / graph_query 查一遍，
   * 五到八次工具调用才搞清状况，然后还常常反问老师——慢、贵、烦。
   * 这些事实框架本来就知道，直接给它，让它把力气花在出题上。
   */
  brief?: string
  /**
   * 界面上给这一轮起的短名字（例如「整理『数学课程标准』」）。
   * 没有它就只能把整段目标指令当"老师说的话"显示出来——那是系统生成的长文本，
   * 不该冒充老师说的话。
   */
  label?: string
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
  stopped: 'done' | 'no-llm' | 'stopped' | 'error'
  /** 这一轮留下的工作区（模型没干活时是空的，但目录还是在） */
  workspace?: { name: string; files: readonly WorkspaceFile[] }
}

/** agent 工作台：模型拿工具自己迭代，但收尾动作只能是"提交"，由闸门裁决 */
export interface WorkbenchRunState {
  id: string
  goal: string
  steps: number
  workspace: string
  /** 界面上显示的短名字（子任务用它说"我在干什么"） */
  label?: string
  /** 谁派的（没有 = 老师直接起的） */
  parent?: string
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
  /**
   * **按老师的指示改题面**（"改这一道"里的"让 agent 改"）：只动语言层，
   * 数值、条件、答案都不许改——改完仍要过闸门。
   */
  polish?(item: Item, instruction: string): Promise<Item | string>
  /**
   * **口述出题**：老师说一句"我想要一道……的题"，直接拿到题。
   *
   * 这一支存在的理由是**自由度**：题不该只能从题位/题库里挑。老师脑子里有一道题，
   * 就该能立刻看到它——现有题型覆盖得到就现造（走完整闸门链才入库），
   * 覆盖不到就如实说，并把话交给 agent 去写题型（`escalate`）。
   */
  compose?(text: string): Promise<ComposeResult>
  active(): readonly WorkbenchRunState[]
}

/** 老师那句话被翻译成的题位（给老师看：系统理解成了什么，错了当场能发现） */
export interface ComposeSpec {
  /** 落到图谱上的知识点（老师话里的说法会被对到图谱里的名字） */
  knowledge: readonly string[]
  /** 没能落进题位的说法（图谱里没有，或不在已学范围）——不悄悄丢掉 */
  unresolved: readonly string[]
  type: QuestionType
  score: number
  difficulty: readonly [number, number]
  /** 模型对这句话的理解（一句人话） */
  note: string
}

export interface ComposeResult {
  ok: boolean
  spec?: ComposeSpec
  /** 现造出来、过了闸门、已入库的题（能放进题位，也能只留着） */
  items: readonly Item[]
  /** 库里已有的相近题（造不出来时，老师可能就想要这几道） */
  similar?: readonly Item[]
  /**
   * 出了一道、但规格与老师说的不一样时的一句人话（例如"10 分的出不来，这道是 6 分的"）。
   * **不许偷偷降规格**：降了就说清楚，老师自己决定要不要。
   */
  adjusted?: string
  /** 没出成时的一句人话 */
  reason?: string
  /** 试过哪些题型、被哪道闸门拦下（如实列出来，不糊成"失败了"） */
  attempts?: readonly string[]
  /**
   * **换个相近的知识点就能出**的那几个（能真的出成题的知识点）。
   *
   * 为什么要有：老师说的知识点常常没有专门的题型——真实例子："考圆周角"，而题型覆盖的是
   * "圆的性质"。这时候只回一句"出不了"是死的；把"这些能出"摆出来，老师一点就出。
   * 刻意**不自动替换**：换成别的知识点是另一道题，得老师自己点头。
   */
  alternatives?: readonly string[]
  /** 现有题型做不到时，交给 agent 的活儿 */
  escalate?: string
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
  /**
   * 如果是**从本机文件夹导入**的，记下那个文件夹：文件原地不动（教材动辄几十 GB，
   * 复制一份既慢又没意义）。整理时用符号链接铺进工作区，agent 照常当本地文件读。
   */
  sourceDir?: string
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
  /** 同上，但用符号链接（大资料不复制；链接失败自动退回复制） */
  seedLinks(name: string, sources: readonly string[]): number
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

// ── 动态题型（agent 在运行时制作新题型）──────────────────────
//
// 题型 = 一个模块（kind / covers / construct），由 agent 写、**由框架验收**：
// 静态安全扫描（只许做计算）、契约完整、同种子可复现、不同种子有差异、
// 检验点能算且**能区分对错**（把参数改坏它必须失败）。通过才注册生效。
// 闸门不认识新题型，但会用**自己的求值器**核对题型声明的检验点——判分不归出题的人管。

export interface ConstructorReport {
  kind: string
  file: string
  covers: readonly string[]
  ok: boolean
  samples: number
  checks: number
  problems: readonly string[]
  at: string
}

export interface DynamicConstructorApi {
  /** 现在生效的动态题型（含未通过的，报告里留痕） */
  list(): readonly ConstructorReport[]
  /** 扫描题型目录：加载 + 验收 */
  loadAll(): Promise<readonly ConstructorReport[]>
  /** 加载并验收一个题型模块；通过就注册生效 */
  loadOne(file: string): Promise<ConstructorReport>
}

// ── 构造器提案（agent 出活，人签字）──────────────────────────
//
// 构造器产出**数学真值**，闸门是**裁判**——这两处不能让 agent 直接改（R1/R2）。
// 所以它的产出是"提案"：规格 + 草稿实现 + 自测，落在 data/proposals/ 下**不生效**，
// 由老师在界面上看规格、跑自测、批准或驳回；真正合入代码由人做。

export type ProposalStatus = 'pending' | 'approved' | 'rejected'

export interface ProposalSelftest {
  ranAt: string
  ok: boolean
  output: string
}

export interface ConstructorProposal {
  id: string
  /** 构造器名字，例如 'linear/two-points' */
  kind: string
  title: string
  /** 这个构造器能覆盖哪些知识点（与蓝图里的 knowledge 对应） */
  covers: readonly string[]
  /** 规格：参数空间、真值怎么算、难度、干扰项设计（Markdown） */
  spec: string
  /** 草稿实现（python；合入时由人翻成 TS 并写闸门验证规则） */
  draft: string
  status: ProposalStatus
  createdAt: string
  proposedBy: 'agent' | 'teacher'
  selftest?: ProposalSelftest
  /** 人的批注（批准/驳回时写） */
  note?: string
}

export interface ProposalApi {
  list(): readonly ConstructorProposal[]
  get(id: string): ConstructorProposal | undefined
  /** agent 提提案（只写 data/proposals/，不碰任何生效代码） */
  propose(input: {
    kind: string
    title: string
    covers: readonly string[]
    spec: string
    draft: string
    selftest?: string
  }): ConstructorProposal
  /** 跑提案自带的自测（真跑，返回真实输出） */
  runSelftest(id: string): ProposalSelftest
  /** 人做决定 */
  decide(id: string, status: ProposalStatus, note?: string): ConstructorProposal | undefined
}

// ── 文档与 OCR（内置工具：常见的格式一次读成文字）────────────
// 模型不必为 PDF/Word/Excel/图片每次现写脚本；读不了的（版式太怪、扫描太糊）如实说。

export interface DocExtract {
  ok: boolean
  /** 全文写到工作区里的哪个文件（给模型的只有开头，其余按需去取） */
  fullPath?: string
  /** text / pdf / docx / xlsx / image / unknown */
  kind: string
  chars: number
  text: string
  /** 说明：缺语言包、没有文字层、编码不是 UTF-8……都要说清 */
  notes: readonly string[]
  pages?: number
  truncated?: boolean
  needsOcr?: boolean
  error?: string
}

/** 模糊检索的一条命中（真题/课标里的片段） */
export interface MaterialHit {
  path: string
  block: number
  score: number
  /** 这一块前面最近的题号/大题标题（agent 靠它知道是哪道题） */
  head?: string
  snippet: string
}

export interface MaterialSearch {
  ok: boolean
  scanned: number
  hits: readonly MaterialHit[]
  error?: string
}

export interface DocBuild {
  ok: boolean
  /** 产出的文件（相对工作区） */
  outputs: readonly string[]
  /** 每本书抽到多少条（示例题 / 内容要求） */
  books: readonly { source: string; pages: number; examples: number; requirements: number }[]
  notes: readonly string[]
  error?: string
}

export interface DocApi {
  /** 脚本在不在（不在就说明没装好，别假装能读） */
  available(): boolean
  /** 这是什么文件、要不要 OCR */
  probe(workspace: string, path: string): DocExtract
  /** 按后缀自动选读法；PDF 可加 ocr */
  extract(workspace: string, path: string, options?: { ocr?: boolean }): DocExtract
  /** 图片或扫描版 PDF 的 OCR */
  ocr(workspace: string, path: string, lang?: string): DocExtract
  /**
   * **整份读成资料**：多份扫描件一次 OCR + 抽结构（示例题、内容要求），产物落工作区 out/。
   * 这是给整理 agent 的"标准做法"入口——不用它自己摸索怎么分页、怎么定页码。
   */
  build(workspace: string, paths: readonly string[]): DocBuild
  /**
   * 在资料里**模糊检索**（按大意找，容错错字与 OCR 噪声）：
   * 真题里写着"求二次函数的最小值"，agent 要能用"二次函数 最值"找到它。
   */
  search(workspace: string, query: string, options?: { limit?: number; dir?: string }): MaterialSearch
}

export interface KbApi {
  list(): readonly KbBatch[]
  /**
   * 上传一批资料。文本给 `text`，二进制（PDF / Word / 图片）给 `base64`——
   * 会按原样存进工作区，整理时由内置的读文档工具解析（不要把它当文本读，那会毁掉文件）。
   */
  upload(name: string, files: readonly { name: string; text?: string; base64?: string }[]): KbBatch
  /** 从本机文件夹导入（不复制文件）；只收认得出来的资料类型 */
  importDir(name: string, dir: string): KbBatch
  /** 这一批文件的实际路径（上传的是副本，导入的是原地文件） */
  sourcePaths(batchId: string): readonly string[]
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
  /**
   * **被明确指到过这个题位**（老师点了"用这一道"，或 agent 用 place_item 放的）。
   *
   * 与签字同一档的语义：**这道题是人选的，不是抽的**——重组卷时钉住不动。
   * 没有它，agent 为某一题辛辛苦苦写的新题型会在下一版卷子上被"抽签"抽掉，
   * 老师的结论只能是"你做的活我看不见"（ADR-0034）。
   */
  chosenBy?: string
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

/** 库里一份蓝图的摘要（列表用；不把整份题位表拖出来） */
export interface BlueprintInfo {
  name: string
  path: string
  title: string
  totalScore: number
  minutes: number
  slots: number
  /** 随仓库走的内置模板（不能被删） */
  builtin: boolean
  /** 谁建的：agent 建的算草稿，老师要过一眼（不是权限，只是标注） */
  createdBy?: 'agent' | 'teacher'
}

/** 蓝图的可改部分：卷头与题位表（题位 key 保留原样，新增的自动编号） */
export interface BlueprintPatch {
  paper?: Partial<Blueprint['paper']>
  blueprint?: readonly Blueprint['blueprint'][number][]
  constraints?: Partial<Blueprint['constraints']>
}

/** 两个版本之间某个题位的变化 */
export interface SlotChange {
  slot: string
  change: 'added' | 'removed' | 'replaced' | 'same'
  from?: string
  to?: string
}

/**
 * 会话记录里的一行。**这不是"聊天记录"的装饰**：它是这个会话发生过什么的凭据，
 * 刷新页面之后还在（只存在内存里的记录会在刷新时消失，那才是假的东西）。
 */
export interface SessionLogEntry {
  id: string
  at: string
  /** user = 老师说的；其余是系统/agent 侧 */
  kind: 'user' | 'assistant' | 'tool' | 'gate' | 'verdict'
  text: string
  runId?: string
  /**
   * 这一行属于**哪个工作区**（谁的活）。
   * 工作台的记录显示当前会话的，资料页只显示这一批资料整理时的——
   * 以前两者共用一条线，结果资料页里滚动的是主 agent 的对话（那是错的）。
   */
  workspace?: string
  /** 工具名（界面自己翻译成人话，正文里不再重复工具名） */
  tool?: string
  /**
   * 这一行是**谁做的**（agent 的 runId）。子任务的记录因此能挂回自己的块里——
   * 以前主线与子任务混成一条流，界面上一片"串"（用户当场点过两次）。
   */
  agent?: string
  /** 起一轮的那一行带它：这一轮是谁派的（空 = 老师直接起的） */
  parent?: string
}

export interface SessionApi {
  list(): readonly SessionMeta[]
  /** 会话分组 */
  groups(): readonly SessionGroup[]
  /**
   * 读当前会话的蓝图（卷头 + 题位表）。
   * 题位是**老师的输入**，不是系统编的——所以必须能读出来、能改。
   */
  blueprint(): Blueprint
  /** 蓝图从哪个文件来、什么修订号（共享文件要靠它发现冲突） */
  blueprintSource(): { path: string; revision: string }
  /** 蓝图库：老师手上是一套模板（课后作业 / 单元测验 / …），不是一个蓝图 */
  blueprintList(): readonly BlueprintInfo[]
  blueprintRead(name: string): Blueprint
  blueprintCreate(name: string, blueprint: Blueprint, createdBy?: 'agent' | 'teacher'): BlueprintInfo
  blueprintUpdate(name: string, patch: BlueprintPatch, expectedRevision?: string): Blueprint
  /** 这个会话改用库里的某一份（已出的题留在题库里，不丢） */
  blueprintUse(name: string): SessionMeta
  /** 改蓝图（共享文件；带修订号防互相覆盖） */
  updateBlueprint(patch: BlueprintPatch, expectedRevision?: string): Blueprint
  /** 会话记录：追加一行 / 读全部（刷新后仍在） */
  appendLog(entry: Omit<SessionLogEntry, 'id' | 'at'>): SessionLogEntry | undefined
  log(): readonly SessionLogEntry[]
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
  /**
   * **指定用这一道**：把已有的题放进某个题位。
   * 与 regenerate（让机器再造一道）相对——这是"人指了这一道"。
   *
   * `by` 记的是谁指的（老师 / agent）：指过的题位**钉住**，重组卷不该把它换掉。
   */
  place(
    slotKey: string,
    itemId: string,
    by?: string,
  ): Promise<{ ok: boolean; version?: PaperVersion; reason?: string }>
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
    doc: DocApi
    proposals: ProposalApi
    constructDynamic: DynamicConstructorApi
  }
}
