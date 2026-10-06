import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import Alert from '@mui/material/Alert'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
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
  RunDoneView,
  SettingsView,
  StateView,
  StreamPart,
  StreamView,
} from './types.js'

/**
 * 实时区只显示**尾巴**：一次输出可以几十 KB（题面、JSON），
 * 全部塞进一个 76px 高的框里既看不见、又越来越慢（每来一段都要重排一次）。
 */
const STREAM_TAIL = 2000

/**
 * 流式增量攒多久画一次。
 *
 * 提供方是**一个词一帧**地吐（实测 `reasoning_content` 就是这样），一个回合几千帧；
 * 每帧都 setState 就是每帧重排一次界面（连着记录区一起白重渲染）。
 * 攒到下一帧再一起画：老师看到的仍然是滚着的尾巴，界面一秒只画十次左右。
 */
const DELTA_FLUSH_MS = 100
function tail(text: string): string {
  return text.length > STREAM_TAIL ? text.slice(text.length - STREAM_TAIL) : text
}

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
   * 模型**写出来的字**（流式累积）：界面底部那一块浅字显示它的尾巴。
   *
   * 它不是记录，也不是"解析出来的步骤"——它是模型此刻/刚才说的原话。
   * 两路分开存（想 / 写）：带工具的回合里模型先想十几秒，那段时间只有"想"这一路在动，
   * 以前只接正文，于是那几十秒那一块是空的。
   * 清空的时机只有两个：**老师起新一轮**、**这一轮结束**——
   * 轮内不清（换了工具、走完一步都不清），"一会儿有一会儿没"就不会再发生。
   */
  const [stream, setStream] = useState<StreamView | null>(null)
  /** 还没画出去的流式增量（一个词一帧地来，攒一批再画，见 DELTA_FLUSH_MS） */
  const pendingDelta = useRef<readonly { part: StreamPart; label: string; text: string }[]>([])
  const flushTimer = useRef<number | null>(null)
  /** 上一轮是怎么结束的：出错就得在状态行说一句，不然记录一滚就没人知道它栽了 */
  const [lastStop, setLastStop] = useState<RunDoneView | null>(null)
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  /** 同时在跑的界面动作（可以有多个：一边在改题，一边在存设定） */
  const [busy, setBusy] = useState<readonly string[]>([])
  const [error, setError] = useState('')
  /** 做成了一件事的一句话（自动消失） */
  const [notice, setNotice] = useState('')
  /** 正在跑的那一轮属于哪个会话：判定事件跟着它走（用 ref，避免闭包拿到旧值） */
  const runningNow = useRef('')
  /** 正在跑的那一轮的 id：判定事件要落进**这一轮**的块里（不然它们会挤进兜底块） */
  const runNow = useRef('')

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

  /**
   * 现在有没有在跑的一轮：**问服务端**，不靠"我见过那个事件"。
   *
   * 刷新页面（或者事件流断线重连）之后，"正在跑"这件事就丢了——界面会显示"空闲"、
   * 输入框按"开新一轮"发（服务端会拒："这个会话已经有 agent 在跑"）、连叫停都没有。
   * 服务端不报"什么时候开始的"，所以这里**不给 `since`**：宁可只显示"第几步"，
   * 也不要拿"我刚知道"的时间冒充"它已经跑了多久"。
   */
  const syncRuns = useCallback(async () => {
    const { active } = await api.getRuns()
    setRuns(active)
  }, [])

  /**
   * 把攒着的流式增量一次画出去（两路各自累积，只留尾巴）。
   *
   * 换了一路输出（主线的"它说" → 执笔者的"写题面"）另起一段：两段不同的输出连成一句就是假话。
   * 想 ↔ 写也分开放的：想那一路是英文的、还比正文长，混在一起老师会以为题面就长那样。
   * `use`（它在给工具填参数）不是文字、不攒：它只把"正在准备哪一步"写进 `preparing`。
   */
  const flushDelta = useCallback(() => {
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    const batch = pendingDelta.current
    pendingDelta.current = []
    if (batch.length === 0) return
    const at = Date.now()
    setStream((previous) => {
      let next: StreamView = previous ?? { think: null, say: null, live: null, preparing: null }
      for (const piece of batch) {
        if (piece.part === 'use') {
          // 开始给某个工具填参数了：不再是"它在写"（参数是给程序看的，不摆出来）
          next = { ...next, preparing: piece.text }
          continue
        }
        // 不认识的那一路（服务端比界面新）：**宁可少显示，也不能把界面搞崩**
        if (piece.part !== 'think' && piece.part !== 'say') continue
        const lane = next[piece.part]
        const text = lane === null ? piece.text : lane.label === piece.label ? lane.text + piece.text : `${lane.text}\n${piece.text}`
        next = { ...next, [piece.part]: { label: piece.label, text: tail(text), at }, live: piece.part, preparing: null }
      }
      return next
    })
  }, [])

  /** 来了一个增量：先攒着，下一批到点再画（见 DELTA_FLUSH_MS） */
  const queueDelta = useCallback(
    (piece: { part: StreamPart; label: string; text: string }) => {
      pendingDelta.current = [...pendingDelta.current, piece]
      if (flushTimer.current === null) flushTimer.current = window.setTimeout(flushDelta, DELTA_FLUSH_MS)
    },
    [flushDelta],
  )

  /** 这一轮结束（或老师起新一轮）：攒着的丢掉，那一块整块收起——这是轮与轮之间的切换，不是闪 */
  const dropStream = useCallback(() => {
    pendingDelta.current = []
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    setStream(null)
  }, [])

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    void syncRuns().catch(() => undefined)
    const unsubscribe = api.subscribe(
      (event) => {
        if (event.kind === 'kb:changed') {
          void api.getKb().then(setKb).catch(() => undefined)
          return
        }
        if (event.kind !== 'stored' && event.kind !== 'rejected' && event.kind !== 'confirmed') return
        setLive((previous) => [event, ...previous].slice(0, 20))
        // 判定属于当前在跑的那一轮（不再"两边都显示"）
        setLog((previous) => appendLive(previous, event, runningNow.current, runNow.current))
      },
      (signal) => {
        if (signal.kind === 'started') {
          // **老师起的新一轮**：实时区从头开始（上一轮的尾巴不该留着）。
          // 子任务（帮手）不算新一轮——它只是这一轮里派出去的活，实时区不该跟着它清掉。
          if (signal.parent === undefined) {
            dropStream()
            setLastStop(null)
          }
          setRuns((previous) => [
            ...previous.filter((run) => run.id !== signal.runId),
            {
              id: signal.runId,
              goal: signal.goal,
              steps: 0,
              workspace: signal.workspace,
              since: Date.now(),
              ...(signal.label === undefined ? {} : { label: signal.label }),
              ...(signal.parent === undefined ? {} : { parent: signal.parent }),
            },
          ])
        }
        if (signal.kind === 'busy') {
          setDoing({ what: signal.what, agent: signal.agent, at: Date.now() })
          // 工具在跑：模型这会儿没在吐字（但已经写出来的字留着，只把标签改成"刚才写的"）。
          // 攒着的那几帧先落地：不然标签说"刚写的"、尾巴还停在更早的地方。
          // `preparing` 到这儿也该收了：工具真的开跑了，状态行会显示它在跑哪个工具
          flushDelta()
          setStream((previous) =>
            previous === null ? previous : { ...previous, live: null, preparing: null },
          )
        }
        if (signal.kind === 'delta') {
          // **模型正在写什么**：两路各自累积，实时区只显示它的尾巴
          queueDelta({ part: signal.part, label: signal.label, text: signal.text })
        }
        if (signal.kind === 'step') {
          // 走完一步：模型的话已经变成记录里的一行，但实时区**不清**（清了就是"一会儿有一会儿没"）；
          // 只把"正在写"改成"刚才写的"，老师一眼看得出这一块是不是活的
          flushDelta()
          setStream((previous) =>
            previous === null ? previous : { ...previous, live: null, preparing: null },
          )
          // 这一步做完了：状态行不该继续挂着刚才那个工具在跳秒（接下来是模型在想事情）
          setDoing((current) => (current === null || current.agent !== (signal.agent ?? signal.runId) ? current : null))
          setRuns((previous) =>
            previous.map((run) => (run.id === signal.runId ? { ...run, steps: Math.max(run.steps, signal.step) } : run)),
          )
        }
        if (signal.kind === 'done') {
          if (signal.parent === undefined && signal.workspace === runningNow.current) {
            dropStream()
            setLastStop(signal.stopped)
          }
          setRuns((previous) => previous.filter((run) => run.id !== signal.runId))
          setDoing((current) => (current?.agent === signal.runId ? null : current))
          void api.getKb().then(setKb).catch(() => undefined)
        } else setLog((previous) => appendSignal(previous, signal))
      },
      // 连上（或重连）事件流：把"现在到底有没有在跑"重新问一遍服务端
      () => void syncRuns().catch(() => undefined),
    )
    return () => {
      unsubscribe()
      // 卸载时别把定时器留着：它还会往一个已经不存在的组件里画字
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
  }, [reload, syncRuns, flushDelta, queueDelta, dropStream])

  /**
   * "判定该记在谁名下"（哪个会话、哪一轮）**从 `running` 推出来**，不靠事件里记一下。
   *
   * 以前是在收到 `run:started` 时写进 ref：刷新或断线重连之后它就是空的，
   * 判定行于是没有归属，界面按会话过滤时会把它们滤掉（"哪道题没过"就看不见了）。
   */
  useEffect(() => {
    runningNow.current = running === null ? '' : running.workspace === '' ? mine : running.workspace
    runNow.current = running?.id ?? ''
  }, [running, mine])

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

  /** 跟它说一件事：空闲就开一轮，在忙就插进去（不挡老师） */  const ask = useCallback(
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
      lastStop,
      live,
      busy: busy[0] ?? '',
      busyWith,
      error,
      clearError: () => setError(''),
      notice,
      notify: (text: string) => {
        setNotice(text)
        window.setTimeout(() => setNotice((current) => (current === text ? '' : current)), 4000)
      },
      reload,
      guard,
      startRun,
      ask,
      interject,
      stopRun,
      go: goTo,
    }),
    [session, sessions, state, settings, kb, log, running, elsewhere, doing, stream, lastStop, live, busy, busyWith, error, notice, reload, guard, startRun, ask, interject, stopRun, goTo, runs, mine],
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
          {/*
            起始页是**根**：这里是标识，不是返回键（返回键在根上没有去处）。
            进了卷子之后，它才是"返回"：设置/体检 → 回到卷子；卷子 → 回到所有出题。
          */}
          {page === 'start' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 0.5 }}>
              <Avatar sx={{ width: 26, height: 26, bgcolor: 'primary.main', fontSize: 14 }}>题</Avatar>
            </Box>
          ) : (
            <Tooltip title={page === 'paper' ? '所有出题' : '回到卷子'}>
              <IconButton onClick={() => goTo(page === 'paper' ? '' : 'paper')}>
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          )}
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

      {/*
        内容区：**按页面决定谁滚**。
        · 一张卷子：三栏各自滚（这一层必须 overflow hidden，否则整页跟着滚，"分栏"就散了）；
        · 起始页/体检/设置：这几页本身就是长文档，这一层要 auto——不然设置页滚不动（真实踩过）。
      */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflowY: page === 'paper' ? 'hidden' : 'auto',
          overflowX: 'hidden',
        }}
      >
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
        open={notice !== ''}
        autoHideDuration={4000}
        onClose={() => setNotice('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice('')} sx={{ maxWidth: 640 }}>
          {notice}
        </Alert>
      </Snackbar>

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
