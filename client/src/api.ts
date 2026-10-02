import type {
  LiveEvent,
  RunEventView,
  RunView,
  SessionMetaView,
  SessionView,
  SettingsView,
  StateView,
  VersionView,
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

export const getSessions = (): Promise<{ currentId: string; sessions: readonly SessionMetaView[] }> =>
  fetch('/api/sessions').then((r) => json<{ currentId: string; sessions: readonly SessionMetaView[] }>(r))

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

export const runWorkbench = (goal: string): Promise<RunView> =>
  send('POST', '/api/run', { goal }).then((r) => json<RunView>(r))

export const exportUrl = (format: 'html' | 'md'): string => `/api/export?format=${format}`

/** 订阅实时事件。返回退订函数——组件卸载时必须调用，否则 EventSource 泄漏 */
export function subscribe(
  onEvent: (event: LiveEvent) => void,
  onRunStep: (event: RunEventView) => void,
): () => void {
  const source = new EventSource('/api/stream')
  const at = (): string => new Date().toLocaleTimeString('zh-CN')
  const simple = (kind: LiveEvent['kind']) => (message: MessageEvent<string>) => {
    onEvent({ ...(JSON.parse(message.data) as object), kind, at: at() } as LiveEvent)
  }
  const step = (message: MessageEvent<string>): void => {
    onRunStep(JSON.parse(message.data) as RunEventView)
  }
  const handlers: [string, (message: MessageEvent<string>) => void][] = [
    ['stored', simple('stored')],
    ['rejected', simple('rejected')],
    ['confirmed', simple('confirmed')],
    ['run:step', step],
  ]
  for (const [name, handler] of handlers) source.addEventListener(name, handler)
  return () => {
    for (const [name, handler] of handlers) source.removeEventListener(name, handler)
    source.close()
  }
}
