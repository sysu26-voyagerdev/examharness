import { useCallback, useEffect, useMemo, useState } from 'react'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { AppCtx, type AppValue } from './app-context.js'
import { appendLive, appendSignal } from './log.js'
import { KnowledgePage } from './pages/KnowledgePage.js'
import { SessionsPage } from './pages/SessionsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { WorkPage } from './pages/WorkPage.js'
import { useRoute } from './router.js'
import type { KbListView, LiveEvent, LogEntryView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

/**
 * 外壳：四个页面，一条顶栏。
 *
 * 这里只做两件事：取服务端的投影、给页面一个受控的动作入口。
 * 业务状态一律留在服务端——界面上看到的每个数字都能在接口里找到出处。
 */

const NAV: readonly { key: string; label: string }[] = [
  { key: 'work', label: '工作台' },
  { key: 'sessions', label: '会话' },
  { key: 'materials', label: '资料' },
  { key: 'settings', label: '设置' },
]

export function App({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }): React.JSX.Element {
  const { route, go } = useRoute()

  const [session, setSession] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<SessionsView | null>(null)
  const [state, setState] = useState<StateView | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [kb, setKb] = useState<KbListView | null>(null)

  const [log, setLog] = useState<readonly LogEntryView[]>([])
  const [running, setRunning] = useState<{ runId: string; goal: string; workspace: string } | null>(null)
  const [live, setLive] = useState<readonly LiveEvent[]>([])
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
    // 记录以服务端为准：刷新不丢，一轮结束时也用它把本地增量对齐
    setLog(nextSession.log)
  }, [])

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const unsubscribe = api.subscribe(
      (event) => {
        if (event.kind !== 'stored' && event.kind !== 'rejected' && event.kind !== 'confirmed') return
        setLive((previous) => [event, ...previous].slice(0, 20))
        setLog((previous) => appendLive(previous, event))
      },
      (signal) => {
        if (signal.kind === 'started') setRunning({ runId: signal.runId, goal: signal.goal, workspace: signal.workspace })
        if (signal.kind === 'done') setRunning((current) => (current?.runId === signal.runId ? null : current))
        else setLog((previous) => appendSignal(previous, signal))
      },
    )
    return unsubscribe
  }, [reload])

  // 一轮结束后重取投影（记录、进度、文件清单都以服务端为准）
  useEffect(() => {
    if (running === null) void reload().catch(() => undefined)
  }, [running, reload])

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
        await api.interjectRun(running.runId, text)
      })
    },
    [guard, running],
  )

  const stopRun = useCallback(async (): Promise<void> => {
    if (running === null) return
    await guard('stop', async () => {
      await api.stopRun(running.runId)
    })
  }, [guard, running])

  const value: AppValue = useMemo(
    () => ({
      session,
      sessions,
      state,
      settings,
      kb,
      log,
      running,
      live,
      busy,
      error,
      clearError: () => setError(''),
      reload,
      guard,
      startRun,
      interject,
      stopRun,
      go,
    }),
    [session, sessions, state, settings, kb, log, running, live, busy, error, reload, guard, startRun, interject, stopRun, go],
  )

  const page = NAV.some((entry) => entry.key === route.page) ? route.page : 'work'
  const runtime = settings?.runtime
  const needsReview =
    session === null
      ? 0
      : (session.versions.at(-1)?.bindings ?? []).filter((binding) =>
          session.slots.some((item) => item.id === binding.itemId && item.lifecycle === 'needs_review'),
        ).length

  return (
    <AppCtx.Provider value={value}>
      <AppBar position="sticky">
        <Container
          maxWidth={false}
          sx={{ px: { xs: 2, md: 3 }, display: 'flex', alignItems: 'center', gap: 2, minHeight: 52 }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            命题组
          </Typography>

          <Tabs
            value={page}
            onChange={(_event, next: string) => go(next)}
            sx={{ minHeight: 52, '& .MuiTabs-indicator': { bottom: 0 } }}
          >
            {NAV.map((entry) => (
              <Tab key={entry.key} value={entry.key} label={entry.label} />
            ))}
          </Tabs>

          <Box sx={{ flex: 1 }} />

          {session !== null && page === 'work' && (
            <Box sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: 240, color: 'text.primary' }}>
                {session.meta.title}
              </Typography>
              <Typography variant="caption" noWrap>
                {session.meta.className}　{session.meta.progress}
              </Typography>
              {session.meta.frozen && <Chip size="small" label="已定稿" variant="outlined" />}
              {needsReview > 0 && (
                <Chip size="small" color="warning" variant="outlined" label={`${String(needsReview)} 道待确认`} />
              )}
            </Box>
          )}

          {runtime !== undefined && (
            <Tooltip title={runtime.modelConfigured ? `正在用 ${runtime.modelName}` : '还没有配置模型，去设置里填'}>
              <Chip
                size="small"
                variant="outlined"
                color={runtime.modelConfigured ? 'default' : 'warning'}
                label={runtime.modelConfigured ? '模型就绪' : '模型未配置'}
                onClick={() => go('settings')}
                sx={{ cursor: 'pointer' }}
              />
            </Tooltip>
          )}

          <IconButton onClick={onToggleDark} title={dark ? '切换到浅色' : '切换到深色'}>
            {dark ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </IconButton>

          <Button
            size="small"
            startIcon={<DownloadOutlinedIcon fontSize="small" />}
            href={api.exportUrl('html')}
            disabled={session === null || session.versions.length === 0}
          >
            导出
          </Button>
        </Container>
        {busy !== '' && <LinearProgress />}
      </AppBar>

      {page === 'work' && <WorkPage />}
      {page === 'sessions' && <SessionsPage />}
      {page === 'materials' && <KnowledgePage />}
      {page === 'settings' && <SettingsPage />}

      <Snackbar
        open={error !== ''}
        autoHideDuration={9000}
        onClose={() => setError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="outlined" onClose={() => setError('')} sx={{ maxWidth: 560 }}>
          {error}
        </Alert>
      </Snackbar>
    </AppCtx.Provider>
  )
}
