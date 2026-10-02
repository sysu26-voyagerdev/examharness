import type { LiveEvent, LogEntryView, RunSignal } from './types.js'

/**
 * 会话记录是**一条时间线**：老师说的话、agent 干的每一步、闸门的判定，按顺序排在一起。
 *
 * 上一版是按"轮次"分开显示的，结果每说一句就换一屏——那不像对话，像日志查看器。
 * 现在服务端把记录存在会话里（刷新不丢），客户端拿到的是权威版本；
 * 跑起来时的增量先本地接上（立刻可见），一轮结束时用服务端版本整体替换（去重、纠正顺序）。
 */

/** 工具名 → 人话（界面上不出现 graph_query 这种东西） */
const TOOL_LABEL: Readonly<Record<string, string>> = {
  graph_query: '查知识点',
  construct_item: '构造题目',
  serialize_item: '写题面',
  submit_item: '送审',
  bank_stats: '看题库',
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
  doc_probe: '看文件',
  doc_extract: '读文字',
  doc_ocr: '识别文字',
}

/** 工具名 → 人话 */
export function toolLabel(tool: string | undefined): string {
  if (tool === undefined || tool === '') return ''
  return TOOL_LABEL[tool] ?? tool
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
