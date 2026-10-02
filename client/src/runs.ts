import type { RunLogEntry } from './app-context.js'
import type { RunEventView, RunSignal } from './types.js'

/**
 * 把 run:* 信号合进"每一轮"的记录里。
 *
 * 界面不自己编过程：它只是把服务端推来的信号归位到对应轮次。
 * 收尾（done）只标记状态，过程早已逐步到达——顺序错了就是顺序错了，不假装没事。
 */
export function mergeRunSignal(runs: readonly RunLogEntry[], signal: RunSignal): readonly RunLogEntry[] {
  if (signal.kind === 'started') {
    if (runs.some((entry) => entry.id === signal.runId)) return runs
    return [...runs, { id: signal.runId, goal: signal.goal, workspace: signal.workspace, events: [], stopped: '', steps: 0 }]
  }

  if (signal.kind === 'step') {
    const event: RunEventView = {
      ...(signal.runId === undefined ? {} : { runId: signal.runId }),
      step: signal.step,
      kind: signal.stepKind,
      text: signal.text,
    }
    // 没有 runId 的老式事件归给正在跑的那一轮；都没有就丢掉（宁可少显示，不要乱归位）
    const target = signal.runId ?? runs.find((entry) => entry.stopped === '')?.id
    if (target === undefined) return runs
    return runs.map((entry) => (entry.id === target ? { ...entry, events: [...entry.events, event] } : entry))
  }

  return runs.map((entry) =>
    entry.id === signal.runId ? { ...entry, stopped: signal.stopped, steps: signal.steps } : entry,
  )
}
