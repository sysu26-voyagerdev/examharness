import type {
  BankQuery,
  BankView,
  ComposeView,
  BlueprintInfoView,
  BlueprintRowView,
  BlueprintView,
  CredentialInfoView,
  GraphView,
  KbBatchView,
  KbListView,
  LiveEvent,
  RunAgentView,
  RunEventView,
  RunSignal,
  RunView,
  SessionGroupView,
  SessionMetaView,
  SessionView,
  SessionsView,
  SettingsView,
  StateView,
  StreamPart,
  VersionView,
  WorkspaceView,
} from './types.js'

/** 与 plugin-web 的接口层。界面不猜服务端形状——对不上就在这里抛错 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    // 服务端的错误体统一是 { error }；拿不到就退回原文
    let message = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      /* 保留原文 */
    }
    throw new ApiError(response.status, message)
  }
  return JSON.parse(text) as T
}

const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

export const getSession = (): Promise<SessionView> => fetch('/api/session').then((r) => json<SessionView>(r))
export const getState = (): Promise<StateView> => fetch('/api/state').then((r) => json<StateView>(r))

/**
 * 现在有没有在跑的一轮（服务端是权威）。
 *
 * 为什么要它：`run:started` 是一条**事件**，刷新页面就错过了——
 * 刷新之后界面会以为"空闲"，而它其实正在干活：状态行写"空闲"、输入框按"开新一轮"发、
 * 连"叫停"都没有。所以挂载时、以及每次（重新）连上事件流时，都要问一遍服务端。
 */
export const getRuns = (): Promise<{ active: readonly RunAgentView[] }> =>
  fetch('/api/runs').then((r) => json<{ active: readonly RunAgentView[] }>(r))

/** 知识图谱：整张图一次拿走（只读——图是脚本算出来的产物，见 docs/知识图谱构建报告.md） */
export const getGraph = (): Promise<GraphView> => fetch('/api/graph').then((r) => json<GraphView>(r))

/** 题库：按条件筛（题库是老师手里的存货，得看得见、挑得动） */
export const getBank = (query: BankQuery = {}): Promise<BankView> => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`
  return fetch(`/api/bank${suffix}`).then((r) => json<BankView>(r))
}

/** 改这道题：把老师的意图交给 agent 重造（数值与答案仍由构造给出） */
export const reviseItem = (
  slot: string,
  instruction: string,
): Promise<{ runId: string; slot: string; interjected?: boolean }> =>
  send('POST', '/api/session/revise', { slot, instruction }).then((r) =>
    json<{ runId: string; slot: string; interjected?: boolean }>(r),
  )

/** 改文字：老师直接改题面/答案/解析（改的是说法，不是数学） */
export const patchItem = (
  itemId: string,
  patch: { stem?: string; answerText?: string; solution?: readonly string[] },
): Promise<{ ok: boolean; gate?: string; reason?: string; hint?: string }> =>
  fetch(`/api/item/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => json<{ ok: boolean; gate?: string; reason?: string; hint?: string }>(r))

/** 让 agent 按一句话改题面（只动说法与情境） */
export const polishItem = (itemId: string, instruction: string): Promise<{ ok: boolean; gate?: string; reason?: string; hint?: string; stem?: string }> =>
  send('POST', `/api/item/${encodeURIComponent(itemId)}/polish`, { instruction }).then((r) =>
    json<{ ok: boolean; gate?: string; reason?: string; hint?: string; stem?: string }>(r),
  )

/**
 * 口述出题：说一句"我想要一道……的题"，直接拿回现造的题。
 * 同步等（十几秒）：这句话先被翻译成题位，再用现有题型现造、过闸门——
 * 等着的这段时间界面要**说清在等什么**，不能只转圈。
 */
export const compose = (text: string): Promise<ComposeView> =>
  send('POST', '/api/compose', { text }).then((r) => json<ComposeView>(r))

/** 现有题型造不出来时：把这句话交给 agent，让它写题型把它真的造出来 */
export const escalateCompose = (goal: string, label: string): Promise<{ runId: string }> =>
  send('POST', '/api/compose/escalate', { goal, label }).then((r) => json<{ runId: string }>(r))

/** 退回某一版（撤回）：按那一版的题列表再出一版 */
export const restoreVersion = (version: number): Promise<{ ok: boolean; reason?: string }> =>
  send('POST', '/api/session/restore', { version }).then((r) => json<{ ok: boolean; reason?: string }>(r))

/** 把某一道从卷子上拿掉（题位空着，底栏会说还缺几道） */
export const clearSlot = (slot: string): Promise<{ ok: boolean; reason?: string }> =>
  send('POST', '/api/session/clear', { slot }).then((r) => json<{ ok: boolean; reason?: string }>(r))

/** 老师指定用这一道：把它放进某个题位 */
export const placeItem = (slot: string, itemId: string): Promise<{ ok: boolean; reason?: string }> =>
  send('POST', '/api/session/place', { slot, itemId }).then((r) => json<{ ok: boolean; reason?: string }>(r))

export const getSettings = (): Promise<SettingsView> => fetch('/api/settings').then((r) => json<SettingsView>(r))

export const getSessions = (): Promise<SessionsView> => fetch('/api/sessions').then((r) => json<SessionsView>(r))

export const createGroup = (name: string): Promise<SessionGroupView> =>
  send('POST', '/api/groups', { name }).then((r) => json<SessionGroupView>(r))

export const renameGroup = (id: string, name: string): Promise<SessionGroupView> =>
  send('PATCH', '/api/groups', { id, name }).then((r) => json<SessionGroupView>(r))

export const moveSessionToGroup = (sessionId: string, groupId: string): Promise<SessionMetaView> =>
  send('POST', '/api/session/group', { sessionId, groupId }).then((r) => json<SessionMetaView>(r))

export interface SettingsOp {
  path: readonly string[]
  value?: unknown
  unset?: boolean
}

/** 按路径改设置（整体替换会删掉界面从没见过的密钥，所以只能这么说清改哪一片） */
export const patchSettings = (ops: readonly SettingsOp[], expectedRevision: number): Promise<SettingsView> =>
  send('PATCH', '/api/settings', { ops, expectedRevision }).then((r) => json<SettingsView>(r))

/** 写密钥：只进不出——返回的只有"配没配/从哪来" */
export const setCredential = (
  ref: string,
  value: string | null,
): Promise<CredentialInfoView> =>
  send('POST', '/api/settings/credential', value === null ? { ref, unset: true } : { ref, value }).then((r) =>
    json<CredentialInfoView>(r),
  )

/** 拉可用模型列表（GET {baseUrl}/models，结果不落盘）；apiKey 可以一次性带上"先试后存" */
export const discoverModels = (
  baseUrl: string,
  apiKey?: string,
): Promise<{ models: readonly { id: string; name: string }[] }> =>
  send('POST', '/api/settings/models', apiKey === undefined ? { baseUrl } : { baseUrl, apiKey }).then((r) =>
    json<{ models: readonly { id: string; name: string }[] }>(r),
  )

export const getKb = (): Promise<KbListView> => fetch('/api/kb').then((r) => json<KbListView>(r))

/** 从本机文件夹导入资料（不复制文件：教材这类资料原地不动） */
export const importKbDir = (name: string, dir: string): Promise<KbBatchView> =>
  send('POST', '/api/kb/import', { name, dir }).then((r) => json<KbBatchView>(r))

export const uploadKb = (
  name: string,
  files: readonly { name: string; text?: string; base64?: string }[],
  onProgress?: (percent: number) => void,
): Promise<KbBatchView> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/kb/upload')
    request.setRequestHeader('content-type', 'application/json')
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new Error('连接中断，未能确认上传结果。请先刷新资料列表，再决定是否重试。'))
    request.onload = () => {
      void json<KbBatchView>(new Response(request.responseText, { status: request.status }))
        .then(resolve, reject)
    }
    request.send(JSON.stringify({ name, files }))
  })

export const previewKb = (
  batchId: string,
  file: string,
  offset = 0,
): Promise<{ text: string; total: number; next?: number }> =>
  fetch(`/api/kb/preview?batchId=${encodeURIComponent(batchId)}&file=${encodeURIComponent(file)}&offset=${String(offset)}`).then(
    (r) => json<{ text: string; total: number; next?: number }>(r),
  )

export const getWorkspace = (name: string): Promise<WorkspaceView> =>
  fetch(`/api/workspace?name=${encodeURIComponent(name)}`).then((r) => json<WorkspaceView>(r))

export const readWorkspaceFile = (
  name: string,
  file: string,
  offset = 0,
): Promise<{ text: string; total: number; next?: number }> =>
  fetch(
    `/api/workspace/file?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}&offset=${String(offset)}`,
  ).then((r) => json<{ text: string; total: number; next?: number }>(r))

/** 让 agent 整理这个知识库（不是手写导入器，而是 agent 拿工具干） */
export const ingestKb = (
  batchId: string,
): Promise<{ runId: string; workspace: string; batch: KbBatchView; seeded?: number }> =>
  send('POST', '/api/kb/ingest', { batchId }).then((r) =>
    json<{ runId: string; workspace: string; batch: KbBatchView; seeded?: number }>(r),
  )

export const createSession = (patch: Partial<SessionMetaView> = {}): Promise<SessionMetaView> =>
  send('POST', '/api/sessions', patch).then((r) => json<SessionMetaView>(r))

/** 蓝图库：老师手上是一套模板（课后作业 / 单元测验 / …），不是一个蓝图 */
export const listBlueprints = (): Promise<{
  blueprints: readonly BlueprintInfoView[]
  current: string
  revision: string
}> => fetch('/api/blueprints').then((r) => json<{ blueprints: readonly BlueprintInfoView[]; current: string; revision: string }>(r))

export const createBlueprint = (name: string, blueprint: BlueprintView): Promise<BlueprintInfoView> =>
  send('POST', '/api/blueprints', { name, blueprint }).then((r) => json<BlueprintInfoView>(r))

export const useBlueprint = (name: string): Promise<SessionMetaView> =>
  send('POST', '/api/blueprints/use', { name }).then((r) => json<SessionMetaView>(r))

/** 蓝图（卷头 + 题位表）：题位是老师下发的，能读能改 */
export const getBlueprint = (): Promise<{ blueprint: BlueprintView; path: string; revision: string; own: boolean }> =>
  fetch('/api/session/blueprint').then((r) => json<{ blueprint: BlueprintView; path: string; revision: string; own: boolean }>(r))

export interface BlueprintPatchView {
  paper?: Partial<BlueprintView['paper']>
  blueprint?: readonly BlueprintRowView[]
  constraints?: Partial<BlueprintView['constraints']>
}

export const patchBlueprint = (
  patch: BlueprintPatchView,
  expectedRevision?: string,
): Promise<{ blueprint: BlueprintView; path: string; revision: string }> =>
  send('PATCH', '/api/session/blueprint', expectedRevision === undefined ? patch : { ...patch, expectedRevision }).then((r) =>
    json<{ blueprint: BlueprintView; path: string; revision: string }>(r),
  )

export const switchSession = (id: string): Promise<SessionMetaView> =>
  send('POST', '/api/session/switch', { id }).then((r) => json<SessionMetaView>(r))

export const updateSession = (patch: Partial<SessionMetaView>): Promise<SessionMetaView> =>
  send('PATCH', '/api/session', patch).then((r) => json<SessionMetaView>(r))

export const assemble = (reason?: string): Promise<VersionView> =>
  send('POST', '/api/session/assemble', reason === undefined ? {} : { reason }).then((r) => json<VersionView>(r))

export const regenerate = (
  slotKey: string,
  seed?: number,
): Promise<{ ok: boolean; version?: VersionView; reason?: string }> =>
  send('POST', '/api/session/regenerate', seed === undefined ? { slotKey } : { slotKey, seed }).then((r) =>
    json<{ ok: boolean; version?: VersionView; reason?: string }>(r),
  )

export const confirmItem = (itemId: string, by: string): Promise<{ slot: string; confirmedBy: string | null }> =>
  send('POST', '/api/session/confirm', { itemId, by }).then((r) =>
    json<{ slot: string; confirmedBy: string | null }>(r),
  )

export const freezeSession = (): Promise<{ frozen: boolean; version: number | null }> =>
  send('POST', '/api/session/freeze').then((r) => json<{ frozen: boolean; version: number | null }>(r))

/** 起一轮 agent：立刻返回 runId，过程走 SSE（看得见每一步，也能插话/叫停） */
export const startRun = (goal: string): Promise<{ runId: string; workspace: string; goal: string }> =>
  send('POST', '/api/run', { goal }).then((r) => json<{ runId: string; workspace: string; goal: string }>(r))

export const interjectRun = (runId: string, text: string): Promise<{ ok: boolean }> =>
  send('POST', '/api/run/interject', { runId, text }).then((r) => json<{ ok: boolean }>(r))

export const stopRun = (runId: string): Promise<{ ok: boolean }> =>
  send('POST', '/api/run/stop', { runId }).then((r) => json<{ ok: boolean }>(r))

export const exportUrl = (format: 'html' | 'md' | 'docx', options: { answers?: boolean } = {}): string => {
  const params = new URLSearchParams({ format })
  if (options.answers === true) params.set('answers', '1')
  return `/api/export?${params.toString()}`
}

/** 订阅实时事件。返回退订函数——组件卸载时必须调用，否则 EventSource 泄漏 */
export function subscribe(
  onEvent: (event: LiveEvent) => void,
  onRun: (signal: RunSignal) => void,
  /** 每次（重新）连上事件流时调一次：断线期间发生的事得补回来 */
  onOpen?: () => void,
): () => void {
  const source = new EventSource('/api/stream')
  if (onOpen !== undefined) source.addEventListener('open', onOpen)
  const at = (): string => new Date().toLocaleTimeString('zh-CN')
  const simple = (kind: LiveEvent['kind']) => (message: MessageEvent<string>) => {
    onEvent({ ...(JSON.parse(message.data) as object), kind, at: at() } as LiveEvent)
  }
  const step = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as {
      runId?: string
      step: number
      kind: RunEventView['kind']
      text: string
      workspace?: string
      agent?: string
    }
    onRun({
      kind: 'step',
      ...(payload.runId === undefined ? {} : { runId: payload.runId }),
      ...(payload.agent === undefined ? {} : { agent: payload.agent }),
      step: payload.step,
      stepKind: payload.kind,
      text: payload.text,
      workspace: payload.workspace ?? '',
    })
  }
  const started = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as { runId: string; goal: string; workspace: string; label?: string; parent?: string }
    onRun({ kind: 'started', ...payload })
  }
  // 模型正在写什么（流式）：一小段一小段来，界面拿它显示最下面那一块浅字
  const delta = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as {
      runId: string
      label: string
      /** 哪一路：它在想 / 它在写 / 它在给工具填参数（**不是**信号名，信号名由下面显式写死） */
      kind: StreamPart
      text: string
      workspace?: string
    }
    // 载荷里的 `kind` 与信号的 `kind` 撞名：这里逐个字段写出来，**不要**用 `...payload` 展开——
    // 展开会把 `kind: 'delta'` 盖成 think/say/use，界面就再也认不出这是一条流式增量
    onRun({
      kind: 'delta',
      runId: payload.runId,
      label: payload.label,
      part: payload.kind,
      text: payload.text,
      workspace: payload.workspace ?? '',
    })
  }
  // "正要做什么"：工具一开跑就推，界面据此显示"正在…（已 n 秒）"
  const busy = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as { runId: string; agent: string; what: string; workspace?: string }
    onRun({ kind: 'busy', ...payload, workspace: payload.workspace ?? '' })
  }
  const done = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as {
      runId: string
      stopped: RunView['stopped']
      steps: number
      stored: readonly string[]
      workspace?: string
      label?: string
      parent?: string
    }
    onRun({ kind: 'done', ...payload, workspace: payload.workspace ?? '' })
  }
  const handlers: [string, (message: MessageEvent<string>) => void][] = [
    ['stored', simple('stored')],
    ['rejected', simple('rejected')],
    ['confirmed', simple('confirmed')],
    ['kb:changed', simple('kb:changed')],
    ['workspace:changed', simple('workspace:changed')],
    ['settings:changed', simple('settings:changed')],
    ['delta', delta],
    ['run:busy', busy],
    ['run:step', step],
    ['run:started', started],
    ['run:done', done],
  ]
  for (const [name, handler] of handlers) source.addEventListener(name, handler)
  return () => {
    if (onOpen !== undefined) source.removeEventListener('open', onOpen)
    for (const [name, handler] of handlers) source.removeEventListener(name, handler)
    source.close()
  }
}
