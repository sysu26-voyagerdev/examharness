import type { LiveEvent, LogEntryView, RunSignal } from './types.js'

/**
 * 会话记录是**一条时间线**：老师说的话、agent 干的每一步、闸门的判定，按顺序排在一起。
 *
 * 上一版是按"轮次"分开显示的，结果每说一句就换一屏——那不像对话，像日志查看器。
 * 现在服务端把记录存在会话里（刷新不丢），客户端拿到的是权威版本；
 * 跑起来时的增量先本地接上（立刻可见），一轮结束时用服务端版本整体替换（去重、纠正顺序）。
 */

/**
 * 工具名 → 人话。**全仓库唯一一张表**：状态行、记录里的工具标签、正文里冒出来的工具名都用它。
 *
 * 以前这里和 `components.tsx` 的正文替换表各有一份，名单还不一样——
 * 结果是真实跑出来的一轮里，`material_search`、`place_item`、`knowledge_lookup`
 * 这些名字**原样**出现在老师的记录里（截图见过）。
 * 名单照 `plugin-workbench` 注册的工具表写全；缺一个就等于把一个英文词漏给老师。
 */
export const TOOL_LABEL: Readonly<Record<string, string>> = {
  graph_query: '查知识点',
  knowledge_lookup: '查知识点',
  known_concepts: '看知识点',
  list_concepts: '看知识点',
  derive_concepts: '梳理知识点',
  satisfy_dependencies: '补前置知识',
  construct_item: '造一道',
  serialize_item: '写题面',
  submit_item: '送审',
  place_item: '放到卷子上',
  quick_question: '现造一道',
  gap_report: '看缺口',
  item_read: '看这一道',
  reaudit_paper: '重新检查',
  bank_stats: '看做过的题',
  material_search: '找素材',
  corpus_search: '找素材',
  corpus_read: '读素材',
  corpus_compare: '查重',
  web_search: '联网核查',
  kb_list: '看资料',
  kb_read: '读资料',
  kb_write: '整理入库',
  kb_mark: '记状态',
  ws_ls: '看文件',
  ws_read: '读文件',
  ws_write: '写文件',
  ws_run: '跑命令',
  ws_grep: '在文件里找',
  doc_probe: '看文件',
  doc_extract: '读文字',
  doc_ocr: '识别文字',
  doc_build: '写文档',
  assemble_paper: '出一版',
  paper_read: '看卷子',
  blueprint_list: '看设定',
  blueprint_read: '看设定',
  blueprint_use: '换设定',
  blueprint_create: '建设定',
  blueprint_update: '改设定',
  change_setting: '改设定',
  constructor_write: '写题型',
  figure_render: '画图',
  spawn_agent: '派一个帮手',
  agent_status: '看帮手做到哪了',
  agent_wait: '等帮手做完',
}

/**
 * 工具名 → 人话。**没登记的一律不显示**：记录是给老师看的，
 * 一个英文工具名不是词——宁可这一行少一个动词，也不露 `ws_grep` 这种东西。
 */
export function toolLabel(tool: string | undefined): string {
  if (tool === undefined || tool === '') return ''
  return TOOL_LABEL[tool] ?? ''
}

/**
 * 记录里属于某个工作区的行：**严格相等**。
 *
 * 以前这里是 `undefined 也算`，结果客户端本地追加的那几行（当时没带 workspace）
 * 在工作台和资料页都显示——"串"就是这么来的。现在每行都有归属。
 */
export function forWorkspace(log: readonly LogEntryView[], workspace: string): readonly LogEntryView[] {
  if (workspace === '') return []
  return log.filter((entry) => entry.workspace === workspace)
}

let counter = 0
const localId = (): string => `local-${String((counter += 1))}`

/** 本地的增量：起一轮、走一步、看到判定 */
export function appendSignal(log: readonly LogEntryView[], signal: RunSignal): readonly LogEntryView[] {
  const at = new Date().toISOString()
  if (signal.kind === 'started') {
    // 老师直接起的一轮才把目标当"老师说的话"显示；子任务不是老师说的
    if (signal.parent !== undefined) return log
    return [...log, { id: localId(), at, kind: 'user', text: signal.goal, runId: signal.runId }]
  }
  if (signal.kind === 'busy') {
    // "正要做什么"不进时间线（那会刷屏）：它是**状态**，由界面显示成"正在…"
    return log
  }
  if (signal.kind === 'step') {
    return [
      ...log,
      {
        id: localId(),
        at,
        kind: signal.stepKind === 'user' ? 'user' : signal.stepKind,
        text: signal.text,
        ...(signal.runId === undefined ? {} : { runId: signal.runId }),
        ...(signal.workspace === '' ? {} : { workspace: signal.workspace }),
      },
    ]
  }
  return log
}

/** 判定类事件（入库/没通过/确认）也进同一条时间线 */
export function appendLive(log: readonly LogEntryView[], event: LiveEvent, workspace = ''): readonly LogEntryView[] {
  const at = event.at
  const owner = workspace === '' ? {} : { workspace }
  if (event.kind === 'stored') {
    return [...log, { id: localId(), at, kind: 'verdict', text: `入库：第 ${event.slot ?? ''} 题`, ...owner }]
  }
  if (event.kind === 'confirmed') {
    return [...log, { id: localId(), at, kind: 'verdict', text: `${event.by ?? '老师'}确认了第 ${event.slot ?? ''} 题`, ...owner }]
  }
  if (event.kind === 'rejected') {
    const verdict = event.verdict
    return [
      ...log,
      {
        id: localId(),
        at,
        kind: 'verdict',
        text: verdict === undefined ? '有一道题没通过' : `没通过「${verdict.gate}」：${verdict.reason}`,
        ...owner,
      },
    ]
  }
  return log
}

/* ─────────────── 说人话（老师读到的字） ─────────────── */

/**
 * 记录、缺口、检查结果里的**系统词**都在这里翻成人话：
 * 闸门名说成"这意味着什么"，工具名说成"它在干什么"，内部编号（S3、it-xxxx、cand-3）说成"第 3 题/这道题"。
 *
 * 为什么集中在一个文件：这些词以前散在 `components.tsx` 与界面各处，
 * 结果同一类名字有两张表、名单还不一样——真实漏过英文工具名与 `verify-xxx`。
 * 文案是**给人看的那一层**，它就该只有一个地方改。
 */
/**
 * 闸门名说人话。**不许把内部名字摊在老师面前**（roundtrip / scope / symbolic …），
 * 老师要看的是"题面有没有写歪、算式对不对"这件事本身。
 */
const GATE_LABEL: Readonly<Record<string, string>> = {
  scope: '不超纲',
  symbolic: '算式核对',
  dedup: '不与旧题重复',
  originality: '不是抄原题',
  figure: '图形自洽',
  roundtrip: '题面忠实',
  parts: '分量够',
  options: '选项可判',
}

export function gateLabel(gate: string): string {
  // 闸门有两个名字：插件名（verify-options）与证据键（options）。两个都要认。
  const key = gate.replace(/^verify-/, '')
  // 认不出来也说人话：退回内部名就等于把一个英文词摊在老师面前（`verify-xxx` 真实漏过）
  return GATE_LABEL[key] ?? GATE_LABEL[gate] ?? '这项检查'
}


/** 闸门名 → 老师能判断的风险（说"这意味着什么"，不说闸门叫什么） */
export const RISK: Readonly<Record<string, string>> = {
  scope: '有知识点超出已学范围',
  symbolic: '答案没能独立复算',
  roundtrip: '题面与构造对不上（数字/答案/分问）',
  dedup: '与已有题目太像',
  originality: '与真题/教材太像',
  parts: '分值与分问数不匹配',
  options: '选项有问题（数量、重复或答案不在选项里）',
  question: '题面缺了要求或作答空位',
  figure: '图形与条件对不上',
}

/**
 * 把一行记录翻成人话：闸门名 → 风险说法，系统题号 → "第 N 题"，
 * 内部 id（it-xxxx / cand-3）→ "这道题"，工具名 → 它在干什么。
 *
 * 日志是给人看的（老师要看着 agent 干活），系统词一个都不该露出来——
 * 所以这里不是"美化"，是**翻译**：老师读到的是发生了什么，不是内部叫什么。
 */
export function humanLine(text: string, number?: (slot: string) => string | undefined): string {
  // "某题型 被 verify-x 拦下："先说成人话
  // （`[^：\s]+` 而不是 `\S+`：否则会把"3 分｜原因：parabola/roots"整段吃掉，真实踩过）
  let out = text.replace(/[^：:\s]*\s*被\s*verify-([a-z-]+)\s*拦下[：:]/gu, (_all, gate: string) => `${RISK[gate] ?? gateLabel(`verify-${gate}`)}：`)
  out = out.replace(/verify-([a-z-]+)/gu, (_all, gate: string) => RISK[gate] ?? gateLabel(`verify-${gate}`))
  // 内部 id：`\w` 不含汉字，所以 `it-口述出题-63096-2e3be86b` 以前**匹配不上**，
  // 只把中间那句"口述出题"换掉了，剩下 `it-这道题-63096-2e3be86b`——真实踩过（截图里就是它）
  out = out.replace(/it-[\w\u4e00-\u9fa5-]+/gu, '这道题')
  out = out.replace(/\bcand-\d+/gu, '这道题')
  out = out.replace(/口述出题/g, '这道题')
  // 题号：先认"S3-1""S3"这种内部编号
  out = out.replace(/\bS(\d+)-(\d+)\b/gu, (all: string, row: string) => number?.(all) ?? `第 ${row} 题`)
  out = out.replace(/\bS(\d+)\b/gu, (_all, row: string) => `第 ${row} 题`)
  // 再认系统词：题位 = 卷子上的某一道，闸门 = 检查，蓝图 = 设定
  out = out.replace(/题位\s*第\s*(\d+)\s*道?题/gu, '第 $1 题')
  out = out.replace(/(\d+)\s*个题位/gu, '$1 道题')
  out = out.replace(/题位/gu, '题')
  out = out.replace(/闸门/gu, '检查')
  // 蓝图文件路径是给程序看的，不是给老师看的
  out = out.replace(/（蓝图为 [^）]*）/gu, '')
  out = out.replace(/蓝图/gu, '设定')
  // 工具名不该出现在人看的正文里
  for (const [tool, human] of Object.entries(TOOL_LABEL)) out = out.split(tool).join(human)
  return out
}
