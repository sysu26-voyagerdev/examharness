import { createContext, useContext } from 'react'
import type { KbListView, LiveEvent, RunEventView, RunView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

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
  /** 工作记录：agent 干过的每一步（run:step 与闸门结论都落在这里） */
  transcript: readonly RunEventView[]
  live: readonly LiveEvent[]
  runGoal: string
  stopped: string
  busy: string
  error: string
  dark: boolean
  toggleDark: () => void
  reload: () => Promise<void>
  guard: (label: string, action: () => Promise<void>) => Promise<void>
  /** 跑一次工作台，并把这一轮的记录接到工作记录上 */
  run: (goal: string) => Promise<RunView | undefined>
  /** 别处（如知识库整理）跑过的轮次也要进工作记录 */
  record: (goal: string, run: RunView) => void
  clearLog: () => void
  go: (path: string) => void
}

export const AppCtx = createContext<AppValue | null>(null)

export function useApp(): AppValue {
  const value = useContext(AppCtx)
  if (value === null) throw new Error('AppCtx 尚未挂载')
  return value
}
