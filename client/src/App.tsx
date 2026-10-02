import { useCallback, useEffect, useMemo, useState } from 'react'
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import MenuIcon from '@mui/icons-material/Menu'
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
import { KnowledgePage } from './pages/KnowledgePage.js'
import { SessionsPage } from './pages/SessionsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { WorkPage } from './pages/WorkPage.js'
import { useRoute } from './router.js'
import type { KbListView, LiveEvent, LogEntryView, SessionView, SessionsView, SettingsView, StateView } from './types.js'

const NAV = [
  { key: 'work', label: '工作台', icon: <ScienceOutlinedIcon /> },
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
      <AppBar position="fixed" color="primary" elevation={2}>
        <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 56 }}>
          {!wide && (
            <IconButton color="inherit" edge="start" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ fontSize: 17, whiteSpace: 'nowrap' }}>
            命题组
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.85, display: { xs: 'none', sm: 'block' } }}>
            ExamHarness
          </Typography>

          <Box sx={{ flex: 1 }} />

          {session !== null && page === 'work' && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', display: { xs: 'none', lg: 'flex' }, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                {session.meta.title}
              </Typography>
              <Chip size="small" variant="outlined" label={session.meta.className} sx={{ color: 'inherit', borderColor: 'rgba(255,255,255,.5)' }} />
              {session.meta.frozen && <Chip size="small" color="warning" label="已定稿" />}
            </Stack>
          )}

          {runtime !== undefined && (
            <Tooltip title={runtime.modelConfigured ? `正在用 ${runtime.modelName}` : '还没有配置模型，去设置里填'}>
              <Chip
                size="small"
                color={runtime.modelConfigured ? 'success' : 'warning'}
                label={runtime.modelConfigured ? '模型就绪' : '模型未配置'}
                onClick={() => value.go('settings')}
              />
            </Tooltip>
          )}

          <Tooltip title={dark ? '浅色' : '深色'}>
            <IconButton color="inherit" onClick={onToggleDark}>
              {dark ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
            </IconButton>
          </Tooltip>

          <Button
            color="inherit"
            variant="outlined"
            size="small"
            startIcon={<DownloadOutlinedIcon />}
            href={api.exportUrl('html')}
            disabled={session === null || session.versions.length === 0}
            sx={{ borderColor: 'rgba(255,255,255,.5)' }}
          >
            导出
          </Button>
        </Toolbar>
        {busy !== '' && <LinearProgress color="secondary" />}
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
          mt: '56px',
          height: { md: 'calc(100vh - 56px)' },
          minHeight: 'calc(100vh - 56px)',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {page === 'work' && <WorkPage />}
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
