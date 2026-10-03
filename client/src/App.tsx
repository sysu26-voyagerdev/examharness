import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined'
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import * as api from './api.js'
import { AppCtx, type AppValue } from './app-context.js'
import { appendLive, appendSignal } from './log.js'
import { BankPage } from './pages/BankPage.js'
import { KnowledgePage } from './pages/KnowledgePage.js'
import { SessionsPage } from './pages/SessionsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { WorkPage } from './pages/WorkPage.js'
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

const NAV = [
  { key: 'work', label: '工作台', icon: <ScienceOutlinedIcon /> },
  { key: 'bank', label: '题库', icon: <LibraryBooksOutlinedIcon /> },
  { key: 'sessions', label: '会话', icon: <MenuBookOutlinedIcon /> },
  { key: 'materials', label: '资料', icon: <TuneOutlinedIcon /> },
  { key: 'settings', label: '设置', icon: <SettingsOutlinedIcon /> },
] as const

const DRAWER_WIDTH = 264

export function App({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }): React.JSX.Element {
  const { route, go } = useRoute()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [session, setSession] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<SessionsView | null>(null)
  const [state, setState] = useState<StateView | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [kb, setKb] = useState<KbListView | null>(null)
  const [log, setLog] = useState<readonly LogEntryView[]>([])
  const [runs, setRuns] = useState<readonly RunAgentView[]>([])
  /**
   * **当前会话**在跑的那一轮：没有就是空闲。
   * 按会话分（而不是全局）：别的会话在跑不该挡住我这一轮——会话是各自独立的。
   */
  const mine = session?.meta.id ?? ''
  const running =
    runs.find((run) => run.parent === undefined && (run.workspace === '' || run.workspace === mine)) ?? null
  /** 别的会话正在跑（界面上只提示一句，不挡人） */
  const elsewhere = runs.filter((run) => run.parent === undefined && run.workspace !== '' && run.workspace !== mine)
  /** 正在做的动作（工具名 + 什么时候开始的），用来显示"正在…（已 n 秒）" */
  const [doing, setDoing] = useState<{ what: string; agent: string; at: number } | null>(null)
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  const [busy, setBusy] = useState('')
  // 当前在跑的那一轮属于哪个工作区：判定事件要跟着它走（用 ref，避免闭包拿到旧值）
  const runningNow = useRef('')
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
          // 主线换工作区时，判定事件跟着主线走；子任务不改这个
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
        }
        if (signal.kind === 'step') {
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
        await api.interjectRun(running.id, text)
      })
    },
    [guard, running],
  )

  const stopRun = useCallback(async (): Promise<void> => {
    if (running === null) return
    await guard('stop', async () => {
      await api.stopRun(running.id)
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
      elsewhere,
      agents: runs.filter((run) => run.workspace === '' || run.workspace === mine),
      doing,
      live,
      busy,
      error,
      clearError: () => setError(''),
      reload,
      guard,
      startRun,
      interject,
      stopRun,
      go: (path: string) => {
        go(path)
        if (!wide) setDrawerOpen(false)
      },
    }),
    [session, sessions, state, settings, kb, log, running, live, busy, error, reload, guard, startRun, interject, stopRun, go, wide],
  )

  const page = NAV.some((entry) => entry.key === route.page) ? route.page : 'work'
  const runtime = settings?.runtime
  const list = sessions?.sessions ?? []

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ px: 2 }}>
        <Avatar sx={{ width: 30, height: 30, bgcolor: 'primary.main', fontSize: 15 }}>题</Avatar>
        <Typography variant="h6" sx={{ ml: 1.25, fontSize: 16 }}>
          命题组
        </Typography>
      </Toolbar>
      <Divider />
      <List dense sx={{ px: 1, py: 1 }}>
        {NAV.map((entry) => (
          <ListItem key={entry.key} disablePadding>
            <ListItemButton selected={page === entry.key} onClick={() => value.go(entry.key)}>
              <ListItemIcon sx={{ minWidth: 38 }}>{entry.icon}</ListItemIcon>
              <ListItemText primary={entry.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Divider />
      <List
        dense
        sx={{ px: 1, py: 0.5, overflowY: 'auto', flex: 1 }}
        subheader={
          <ListSubheader component="div" sx={{ bgcolor: 'transparent', lineHeight: '32px' }}>
            会话
            <IconButton
              size="small"
              sx={{ float: 'right' }}
              title="新建会话"
              disabled={busy !== ''}
              onClick={() =>
                void guard('new', async () => {
                  await api.createSession()
                  await reload()
                })
              }
            >
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </ListSubheader>
        }
      >
        {list.map((meta) => (
          <ListItem key={meta.id} disablePadding>
            <ListItemButton
              selected={session?.meta.id === meta.id}
              onClick={() =>
                void guard('switch', async () => {
                  if (meta.id === session?.meta.id) return
                  await api.switchSession(meta.id)
                  await reload()
                  value.go('work')
                })
              }
            >
              <ListItemAvatar sx={{ minWidth: 34 }}>
                <Avatar sx={{ width: 22, height: 22, fontSize: 11, bgcolor: meta.frozen ? 'warning.main' : 'secondary.main' }}>
                  {meta.title.slice(0, 1)}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={meta.title}
                slotProps={{ primary: { noWrap: true, variant: 'body2' }, secondary: { noWrap: true, variant: 'caption' } }}
                secondary={meta.frozen ? '已定稿' : meta.className}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <AppCtx.Provider value={value}>
      <AppBar>
        <Toolbar sx={{ gap: 2, minHeight: 60 }}>
          {!wide && (
            <IconButton edge="start" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="subtitle1" sx={{ whiteSpace: 'nowrap' }}>
            {NAV.find((entry) => entry.key === page)?.label ?? '命题组'}
          </Typography>

          <Box sx={{ flex: 1 }} />

          {session !== null && page === 'work' && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', display: { xs: 'none', lg: 'flex' }, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                {session.meta.title}
              </Typography>
              <Chip size="small" variant="outlined" label={session.meta.className} />
              {session.meta.frozen && <Chip size="small" color="warning" variant="outlined" label="已定稿" />}
            </Stack>
          )}

          {runtime !== undefined && (
            <Tooltip title={runtime.modelConfigured ? `正在用 ${runtime.modelName}` : '还没有配置模型，去设置里填'}>
              <Chip
                size="small"
                color={runtime.modelConfigured ? 'success' : 'warning'}
                variant="outlined"
                label={runtime.modelConfigured ? '模型就绪' : '模型未配置'}
                onClick={() => value.go('settings')}
              />
            </Tooltip>
          )}

          <Tooltip title={dark ? '浅色' : '深色'}>
            <IconButton onClick={onToggleDark}>
              {dark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>

          <Button
            variant="outlined"
            size="small"
            startIcon={<DownloadOutlinedIcon />}
            href={api.exportUrl('html')}
            disabled={session === null || session.versions.length === 0}
          >
            导出
          </Button>
        </Toolbar>
        {busy !== '' && <LinearProgress />}
      </AppBar>

      {wide ? (
        <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {drawer}
        </Drawer>
      ) : (
        <Drawer variant="temporary" open={drawerOpen} onClose={() => setDrawerOpen(false)} sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {drawer}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: { md: `${String(DRAWER_WIDTH)}px` },
          mt: '60px',
          height: { md: 'calc(100vh - 60px)' },
          minHeight: 'calc(100vh - 60px)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {page === 'work' && <WorkPage />}
        {/* 题库：老师手里的存货（看得到、挑得动、能放进题位） */}
        {page === 'bank' && <BankPage />}
        {page === 'sessions' && <SessionsPage />}
        {page === 'materials' && <KnowledgePage />}
        {page === 'settings' && <SettingsPage />}
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
    </AppCtx.Provider>
  )
}
