import { createContext, useContext } from 'react'
import type {
  KbListView,
  LiveEvent,
  LogEntryView,
  RunAgentView,
  SessionView,
  SessionsView,
  SettingsView,
  StateView,
} from './types.js'

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
  /** 正在跑的主线（没有就是 null） */
  running: RunAgentView | null
  /** **当前会话**里在跑的 agent：主线 + 子任务（子任务是 agent 自己派的） */
  agents: readonly RunAgentView[]
  /** **别的会话**正在跑的一轮（只提示，不挡人：会话之间互不影响） */
  elsewhere: readonly RunAgentView[]
  /** 正在做的动作（工具名 + 开始时间）：界面显示"正在…（已 n 秒）" */
  doing: { what: string; agent: string; at: number } | null
  /** 模型此刻正在写的内容（流式）：界面右下角用浅字实时显示，走完一步就清掉 */
  stream: { label: string; text: string; at: number } | null
  live: readonly LiveEvent[]
  /**
   * 正在进行的界面动作（'' = 空闲）。
   *
   * **它不是一把全局锁**：以前用它 disable 掉整屏按钮，于是"有一道题在改"就动不了别的题、
   * 连设定都打不开（用户当场指出的机制问题）。现在它只用来显示进度条与"这个动作自己在跑"。
   */
  busy: string
  /** 这个动作是不是正在跑（只挡它自己，不挡别人） */
  busyWith: (label: string) => boolean
  error: string
  clearError: () => void
  reload: () => Promise<void>
  guard: (label: string, action: () => Promise<void>) => Promise<void>
  startRun: (goal: string) => Promise<void>
  /**
   * **跟它说一件事**：它空闲就开一轮；它正在忙，就把这句话插进去（下一步就生效）。
   *
   * 为什么不是"忙就禁用"：老师手上不该有"等它干完才能动"的时刻——
   * 一道题正在改，不该挡住他改另一道、调设定、删一道。
   */
  ask: (goal: string) => Promise<'run' | 'interjected'>
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
