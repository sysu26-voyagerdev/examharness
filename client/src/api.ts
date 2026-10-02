import type {
  CredentialInfoView,
  KbBatchView,
  KbListView,
  LiveEvent,
  RunEventView,
  RunView,
  SessionGroupView,
  SessionMetaView,
  SessionsView,
  SessionView,
  RunSignal,
  SettingsView,
  StateView,
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
): Promise<KbBatchView> =>
  send('POST', '/api/kb/upload', { name, files }).then((r) => json<KbBatchView>(r))

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

export const exportUrl = (format: 'html' | 'md'): string => `/api/export?format=${format}`

/** 订阅实时事件。返回退订函数——组件卸载时必须调用，否则 EventSource 泄漏 */
export function subscribe(onEvent: (event: LiveEvent) => void, onRun: (signal: RunSignal) => void): () => void {
  const source = new EventSource('/api/stream')
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
    }
    onRun({
      kind: 'step',
      ...(payload.runId === undefined ? {} : { runId: payload.runId }),
      step: payload.step,
      stepKind: payload.kind,
      text: payload.text,
      workspace: payload.workspace ?? '',
    })
  }
  const started = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as { runId: string; goal: string; workspace: string }
    onRun({ kind: 'started', ...payload })
  }
  const done = (message: MessageEvent<string>): void => {
    const payload = JSON.parse(message.data) as {
      runId: string
      stopped: RunView['stopped']
      steps: number
      stored: readonly string[]
      workspace?: string
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
    ['run:step', step],
    ['run:started', started],
    ['run:done', done],
  ]
  for (const [name, handler] of handlers) source.addEventListener(name, handler)
  return () => {
    for (const [name, handler] of handlers) source.removeEventListener(name, handler)
    source.close()
  }
}
