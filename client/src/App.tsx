import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api.js'
import { AppCtx, type AppValue } from './app-context.js'
import { Icon, type IconName } from './icons.js'
import { KbPage } from './pages/KbPage.js'
import { SessionsPage } from './pages/SessionsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { WorkPage } from './pages/WorkPage.js'
import { useRoute } from './router.js'
import type { KbListView, LiveEvent, RunEventView, RunView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

/**
 * 应用外壳（信息架构见 docs/agent/07）。
 *
 * 四页：工作台（命题协作）、会话（分组/新建/约定）、知识库（上传 + 让 agent 整理）、设置。
 * 外壳只做两件事：**取服务端投影**、**给各页一个受控动作入口**；业务状态一律留在服务端。
 *
 * 三条自觉（ADR-0015 / 07）：
 *   - 界面不写死数学：题面、图、证据、版本全部来自服务端投影；
 *   - 界面不是写入口：所有动作都是请服务端去改，改完以服务端返回为准；
 *   - 文字克制：一行一个事实，正常态不上色，异常才 warn。
 */

const NAV: readonly { key: string; label: string; icon: IconName }[] = [
  { key: 'work', label: '工作台', icon: 'tool' },
  { key: 'sessions', label: '会话', icon: 'chat' },
  { key: 'knowledge', label: '知识库', icon: 'layers' },
  { key: 'settings', label: '设置', icon: 'sliders' },
]

export function App(): React.JSX.Element {
  const { route, go } = useRoute()

  const [session, setSession] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<SessionsView | null>(null)
  const [state, setState] = useState<StateView | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [kb, setKb] = useState<KbListView | null>(null)

  const [transcript, setTranscript] = useState<readonly RunEventView[]>([])
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  const [runGoal, setRunGoal] = useState('')
  const [stopped, setStopped] = useState('')

  const [dark, setDark] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [nextSession, nextSessions, nextState, nextSettings, nextKb] = await Promise.all([
      api.getSession(),
      api.getSessions(),
      api.getState(),
      api.getSettings(),
      api.getKb(),
    ])
    setSession(nextSession)
    setSessions(nextSessions)
    setState(nextState)
    setSettings(nextSettings)
    setKb(nextKb)
  }, [])

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const unsubscribe = api.subscribe(
      (event) => {
        // run:step 已经在工作记录里逐条长出来了，不要再进"实时"列表
        if (event.kind !== 'run:step') {
          setLive((previous) => [event, ...previous].slice(0, 30))
          void reload().catch(() => undefined)
        }
      },
      (event) => setTranscript((previous) => [...previous, event]),
    )
    return unsubscribe
  }, [reload])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  const guard = useCallback(async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }, [])

  const clearLog = useCallback(() => {
    setTranscript([])
    setLive([])
    setRunGoal('')
    setStopped('')
  }, [])

  const run = useCallback(
    async (goal: string): Promise<RunView | undefined> => {
      let done: RunView | undefined
      await guard('run', async () => {
        setRunGoal(goal)
        setTranscript([])
        const next = await api.runWorkbench(goal)
        setTranscript(next.transcript)
        setStopped(next.stopped)
        done = next
        await reload()
      })
      return done
    },
    [guard, reload],
  )

  const record = useCallback((goal: string, done: RunView) => {
    setRunGoal(goal)
    setTranscript(done.transcript)
    setStopped(done.stopped)
  }, [])

  const value: AppValue = useMemo(
    () => ({
      session,
      sessions,
      state,
      settings,
      kb,
      transcript,
      live,
      runGoal,
      stopped,
      busy,
      error,
      dark,
      toggleDark: () => setDark((previous) => !previous),
      reload,
      guard,
      run,
      record,
      clearLog,
      go,
    }),
    [session, sessions, state, settings, kb, transcript, live, runGoal, stopped, busy, error, dark, reload, guard, run, record, clearLog, go],
  )

  const page = NAV.some((entry) => entry.key === route.page) ? route.page : 'work'
  const needsReview =
    session === null
      ? 0
      : (session.versions.at(-1)?.bindings ?? []).filter((binding) =>
          session.slots.some((item) => item.id === binding.itemId && item.lifecycle === 'needs_review'),
        ).length

  return (
    <AppCtx.Provider value={value}>
      <header className="top">
        <span className="brand">
          命题组<span>examharness</span>
        </span>

        <nav className="navtabs">
          {NAV.map((entry) => (
            <button key={entry.key} className={page === entry.key ? 'on' : ''} onClick={() => go(entry.key)}>
              <Icon name={entry.icon} />
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="right">
          {session !== null && page === 'work' && (
            <>
              <span className="title">
                {session.meta.title}
                {session.versions.length > 0 && <span className="ver mono"> v{session.versions.at(-1)?.version ?? 0}</span>}
              </span>
              <span className="meta">
                <span>{session.meta.className}</span>
                <span>{session.meta.progress}</span>
                <span>
                  满分 <b className="mono">{session.blueprint.paper.totalScore}</b>
                </span>
                <span>
                  <b className="mono">{session.blueprint.paper.minutes}</b> 分钟
                </span>
                {session.meta.frozen && <span className="chip warn">已冻结</span>}
                {needsReview > 0 && <span className="chip warn">待复核 {needsReview}</span>}
              </span>
            </>
          )}
          {settings !== null && (
            <span className="chips">
              <button className="chip click" onClick={() => go('settings')}>
                {settings.runtime.modelConfigured ? settings.runtime.modelName : '模型未配置'}
              </button>
              <button className="chip click" onClick={() => go('knowledge')}>
                语料 {settings.runtime.corpusTotal}
              </button>
              <button className="chip click" onClick={() => go('settings')}>
                联网{settings.runtime.websearchEnabled ? '已开' : '未开'}
              </button>
            </span>
          )}
          <button className="ibtn" title="明暗" onClick={() => setDark((previous) => !previous)}>
            <Icon name={dark ? 'sun' : 'moon'} />
          </button>
          <a className="ghost" href={api.exportUrl('html')} style={{ textDecoration: 'none' }}>
            导出
          </a>
        </div>
      </header>

      {page === 'work' && <WorkPage />}
      {page === 'sessions' && <SessionsPage />}
      {page === 'knowledge' && <KbPage />}
      {page === 'settings' && <SettingsPage />}
    </AppCtx.Provider>
  )
}
