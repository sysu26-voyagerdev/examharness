import { createContext, useContext } from 'react'
import type { KbListView, LiveEvent, LogEntryView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

/**
 * 外壳与页面共享的东西：**服务端的投影 + 一个受控的动作入口**。
 *
 * 界面不存业务状态（那会变成第二份真相）：`reload()` 每次重新取服务端投影；
 * `guard()` 是唯一的动作通道——做事前置忙、出错时留一条消息、做完刷新。
 */
export interface AppValue {
  session: SessionView | null
  sessions: SessionsView | null
  state: StateView | null
  settings: SettingsView | null
  kb: KbListView | null
  /** 会话记录（一条时间线）：来自服务端，跑起来时本地先接上增量 */
  log: readonly LogEntryView[]
  /** 正在跑的那一轮（没有就是 null） */
  running: { runId: string; goal: string; workspace: string } | null
  live: readonly LiveEvent[]
  /** 正在进行的动作（'' = 空闲） */
  busy: string
  error: string
  clearError: () => void
  reload: () => Promise<void>
  guard: (label: string, action: () => Promise<void>) => Promise<void>
  startRun: (goal: string) => Promise<void>
  interject: (text: string) => Promise<void>
  stopRun: () => Promise<void>
  go: (path: string) => void
}

export const AppCtx = createContext<AppValue | null>(null)

export function useApp(): AppValue {
  const value = useContext(AppCtx)
  if (value === null) throw new Error('AppCtx 尚未挂载')
  return value
}
