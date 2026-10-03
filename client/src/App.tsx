import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { AppCtx, type AppValue } from './app-context.js'
import { appendLive, appendSignal } from './log.js'
import { CheckPage } from './pages/CheckPage.js'
import { KnowledgeGraphPage } from './pages/KnowledgeGraphPage.js'
import { PaperPage } from './pages/PaperPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { StartPage } from './pages/StartPage.js'
import { useRoute } from './router.js'
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
 * 壳层：**挑一张卷子 → 改这张卷子 → 设置**，没有常驻侧边栏。
 *
 * 原来那套（工作台/题库/会话/资料/设置 + 会话列表）是把后端的插件分类摆给老师看：
 * 一件"这张卷子"被拆到七处看，同一个意图又有好几条路。现在只剩两种界面状态：
 * 回到某张卷子（或开一张新的），和改这一张。
 */

export function App({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }): React.JSX.Element {
  const { route, go } = useRoute()

  const [session, setSession] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<SessionsView | null>(null)
  const [state, setState] = useState<StateView | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [kb, setKb] = useState<KbListView | null>(null)
  const [log, setLog] = useState<readonly LogEntryView[]>([])
  const [runs, setRuns] = useState<readonly RunAgentView[]>([])
  const [doing, setDoing] = useState<{ what: string; agent: string; at: number } | null>(null)
  /**
   * 模型**此刻正在写的内容**（流式累积）。
   * 它不是记录：走完一步就清掉（那一步会作为一条记录出现）。界面只在右下角用浅字显示它。
   */
  const [stream, setStream] = useState<{ label: string; text: string; at: number } | null>(null)
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  /** 同时在跑的界面动作（可以有多个：一边在改题，一边在存设定） */
  const [busy, setBusy] = useState<readonly string[]>([])
  const [error, setError] = useState('')
  /** 正在跑的那一轮属于哪个会话：判定事件跟着它走（用 ref，避免闭包拿到旧值） */
  const runningNow = useRef('')

  const mine = session?.meta.id ?? ''
  const running = runs.find((run) => run.parent === undefined && (run.workspace === '' || run.workspace === mine)) ?? null
  const elsewhere = runs.filter((run) => run.parent === undefined && run.workspace !== '' && run.workspace !== mine)

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
    setLog(nextSession.log)
  }, [])

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const unsubscribe = api.subscribe(
      (event) => {
        if (event.kind !== 'stored' && event.kind !== 'rejected' && event.kind !== 'confirmed') return
        setLive((previous) => [event, ...previous].slice(0, 20))
        // 判定属于当前在跑的那一轮（不再"两边都显示"）
        setLog((previous) => appendLive(previous, event, runningNow.current))
      },
      (signal) => {
        if (signal.kind === 'started') {
          if (signal.parent === undefined) runningNow.current = signal.workspace
          setRuns((previous) => [
            ...previous.filter((run) => run.id !== signal.runId),
            {
              id: signal.runId,
              goal: signal.goal,
              steps: 0,
              workspace: signal.workspace,
              ...(signal.label === undefined ? {} : { label: signal.label }),
              ...(signal.parent === undefined ? {} : { parent: signal.parent }),
            },
          ])
        }
        if (signal.kind === 'busy') {
          setDoing({ what: signal.what, agent: signal.agent, at: Date.now() })
          // 换工具了：上一段流已经变成"走完的一步"，实时区从头开始
          setStream(null)
        }
        if (signal.kind === 'delta') {
          // **模型正在写什么**：累积一小段，界面用浅字实时显示（约 3 行就滚）
          setStream((previous) =>
            previous === null || previous.label !== signal.label || Date.now() - previous.at > 4000
              ? { label: signal.label, text: signal.text, at: Date.now() }
              : { ...previous, text: previous.text + signal.text, at: Date.now() },
          )
        }
        if (signal.kind === 'step') {
          setStream(null)
          setRuns((previous) =>
            previous.map((run) => (run.id === signal.runId ? { ...run, steps: Math.max(run.steps, signal.step) } : run)),
          )
        }
        if (signal.kind === 'done') {
          if (signal.parent === undefined && signal.workspace === runningNow.current) runningNow.current = ''
          setRuns((previous) => previous.filter((run) => run.id !== signal.runId))
          setDoing((current) => (current?.agent === signal.runId ? null : current))
        } else setLog((previous) => appendSignal(previous, signal))
      },
    )
    return unsubscribe
  }, [reload])

  // 一轮跑完就重新拉一遍（卷面、版本、底栏的事实都会变）
  useEffect(() => {
    if (running === null) void reload().catch(() => undefined)
  }, [running, reload])

  const guard = useCallback(async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy((previous) => (previous.includes(label) ? previous : [...previous, label]))
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy((previous) => previous.filter((entry) => entry !== label))
    }
  }, [])
  const busyWith = useCallback((label: string) => busy.includes(label), [busy])

  const startRun = useCallback(
    async (goal: string): Promise<void> => {
      await guard('run', async () => {
        await api.startRun(goal)
      })
    },
    [guard],
  )

  const interject = useCallback(
    async (text: string): Promise<void> => {
      if (running === null) return
      await guard('interject', async () => {
        await api.interjectRun(running.id, text)
      })
    },
    [guard, running],
  )

  /** 跟它说一件事：空闲就开一轮，在忙就插进去（不挡老师） */
  const ask = useCallback(
    async (goal: string): Promise<'run' | 'interjected'> => {
      if (running !== null) {
        await interject(goal)
        return 'interjected'
      }
      await startRun(goal)
      return 'run'
    },
    [running, interject, startRun],
  )

  const stopRun = useCallback(async (): Promise<void> => {
    if (running === null) return
    await guard('stop', async () => {
      await api.stopRun(running.id)
    })
  }, [guard, running])

  const goTo = useCallback(
    (page: string) => {
      go(page)
    },
    [go],
  )

  const value: AppValue = useMemo(
    () => ({
      session,
      sessions,
      state,
      settings,
      kb,
      log,
      running,
      elsewhere,
      agents: runs.filter((run) => run.workspace === '' || run.workspace === mine),
      doing,
      stream,
      live,
      busy: busy[0] ?? '',
      busyWith,
      error,
      clearError: () => setError(''),
      reload,
      guard,
      startRun,
      ask,
      interject,
      stopRun,
      go: goTo,
    }),
    [session, sessions, state, settings, kb, log, running, elsewhere, doing, stream, live, busy, busyWith, error, reload, guard, startRun, ask, interject, stopRun, goTo, runs, mine],
  )

  // 旧地址（工作台/题库/会话/资料）还有人存着书签：一律落到"这张卷子"或起始页
  const page =
    route.page === 'work' || route.page === 'bank' || route.page === 'sessions' || route.page === 'materials'
      ? session === null
        ? 'start'
        : 'paper'
      : route.page
  const runtime = settings?.runtime

  return (
    <AppCtx.Provider value={value}>
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.5, minHeight: 56 }}>
          <Tooltip title="所有出题">
            <IconButton onClick={() => goTo('')} disabled={page === ''}>
              <HomeOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            命题组
          </Typography>
          {page === 'paper' && session !== null && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 280 }}>
              {session.meta.title}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {runtime !== undefined && (
            <Tooltip title={runtime.modelConfigured ? `正在用 ${runtime.modelName}` : '还没有配置模型，点这里去填'}>
              <Chip
                size="small"
                color={runtime.modelConfigured ? 'success' : 'warning'}
                variant="outlined"
                label={runtime.modelConfigured ? '模型就绪' : '模型未配置'}
                onClick={() => goTo('settings')}
              />
            </Tooltip>
          )}
          <Tooltip title={dark ? '浅色' : '深色'}>
            <IconButton onClick={onToggleDark}>{dark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}</IconButton>
          </Tooltip>
          <Tooltip title="知识图谱">
            <IconButton onClick={() => goTo('graph')}>
              <AccountTreeOutlinedIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="设置">
            <IconButton onClick={() => goTo('settings')}>
              <SettingsOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
        {busy.length > 0 && <LinearProgress />}
      </AppBar>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {page === 'paper' ? (
          <PaperPage />
        ) : page === 'graph' ? (
          <KnowledgeGraphPage />
        ) : page === 'check' ? (
          <CheckPage />
        ) : page === 'settings' ? (
          <SettingsPage />
        ) : (
          <StartPage />
        )}
      </Box>

      <Snackbar
        open={error !== ''}
        autoHideDuration={10000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError('')} sx={{ maxWidth: 640 }}>
          {error}
        </Alert>
      </Snackbar>
      </Box>
    </AppCtx.Provider>
  )
}
