import { createContext, useContext } from 'react'
import type { KbListView, LiveEvent, RunEventView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

/** 一轮 agent 循环在界面上的样子：goal + 逐步长出来的记录 + 收尾状态 */
export interface RunLogEntry {
  id: string
  goal: string
  workspace: string
  events: readonly RunEventView[]
  /** '' = 正在跑 */
  stopped: string
  steps: number
}

/**
 * 应用外壳向各页共享的东西：**服务端投影 + 一个受控的动作入口**。
 *
 * 界面不自己存业务状态（那会变成第二份真相）：`reload()` 每次都重新取服务端投影，
 * `guard()` 是唯一的动作通道——它在做之前置忙、出错时留一条错误、做完刷新。
 */
export interface AppValue {
  session: SessionView | null
  sessions: SessionsView | null
  state: StateView | null
  settings: SettingsView | null
  kb: KbListView | null
  /** 每一轮 agent 循环（含中途插的话与闸门结论）：看得见过程，也留得下记录 */
  runs: readonly RunLogEntry[]
  /** 正在跑的那一轮（没有就是 null） */
  activeRun: RunLogEntry | null
  live: readonly LiveEvent[]
  /** 工作区变动的计数：面板看到它就重取文件清单 */
  workspaceTick: number
  busy: string
  error: string
  dark: boolean
  toggleDark: () => void
  reload: () => Promise<void>
  guard: (label: string, action: () => Promise<void>) => Promise<void>
  /** 起一轮 agent（立刻返回；过程走事件流） */
  startRun: (goal: string) => Promise<void>
  /** 插话：下一步就生效（不是另起一轮） */
  interject: (text: string) => Promise<void>
  /** 叫停：这一步之后不再继续 */
  stopRun: () => Promise<void>
  clearLog: () => void
  go: (path: string) => void
}

export const AppCtx = createContext<AppValue | null>(null)

export function useApp(): AppValue {
  const value = useContext(AppCtx)
  if (value === null) throw new Error('AppCtx 尚未挂载')
  return value
}
