import type { GenerateView, LiveEvent, PaperView, RunView, StateView } from './types.js'

/** 与 plugin-web 的接口层。界面不猜服务端形状——对不上就是这里报错 */

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}：${text.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

const post = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const getState = (): Promise<StateView> => fetch('/api/state').then((r) => json<StateView>(r))

export const assemblePaper = (): Promise<PaperView> => post('/api/paper').then((r) => json<PaperView>(r))

export const runWorkbench = (goal: string): Promise<RunView> =>
  post('/api/run', { goal }).then((r) => json<RunView>(r))

export const generateOne = (slotKey: string, seed?: number): Promise<GenerateView> =>
  post('/api/generate', seed === undefined ? { slotKey } : { slotKey, seed }).then(
    async (r) => (await r.json()) as GenerateView,
  )

/** 订阅闸门事件。返回退订函数——组件卸载时必须调用，否则 EventSource 泄漏 */
export function subscribe(onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource('/api/stream')
  const handler = (kind: LiveEvent['kind']) => (message: MessageEvent<string>) => {
    const data = JSON.parse(message.data) as Omit<LiveEvent, 'kind' | 'at'>
    onEvent({ ...data, kind, at: new Date().toLocaleTimeString('zh-CN') })
  }
  const onStored = handler('stored')
  const onRejected = handler('rejected')
  source.addEventListener('stored', onStored)
  source.addEventListener('rejected', onRejected)
  return () => {
    source.removeEventListener('stored', onStored)
    source.removeEventListener('rejected', onRejected)
    source.close()
  }
}
