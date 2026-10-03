import { useEffect, useMemo, useRef, useState } from 'react'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import PersonIcon from '@mui/icons-material/Person'
import ReportOutlinedIcon from '@mui/icons-material/ReportOutlined'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Collapse from '@mui/material/Collapse'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { useApp } from './app-context.js'
import { toolLabel } from './log.js'
import { MarkdownText } from './markdown.js'
import { MathText } from './math-text.js'
import type { ItemView, KnowledgeView, LogEntryView, SlotBindingView, SlotChangeView, VersionView } from './types.js'

/**
 * 复用块：会话记录、试卷、知识点、依据、文件。
 *
 * 服务端算什么，这里就显示什么：数学是服务端渲染好的 MathML，图是服务端画的 SVG，
 * 判定是闸门自己写的。界面不重算、不猜。
 */

/* ─────────────── 会话记录 ─────────────── */

/**
 * 把模型偶尔写出的 Markdown 记号收拾干净。
 * 提示词已经要求它写短句，但偶尔还是会带 `**加粗**`、`## 标题`——那些星号糊在气泡里很难看。
 * 这里只做**显示**处理：不解析 Markdown、不引库。
 */
function plain(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 把同一类记录收成一条。
 *
 * 出卷时会连着入库几十道题：不收敛的话时间线就是一面墙
 * （真实截图：一屏 20 条"入库：第 X 题"，把真正值得看的话全顶下去）。
 *
 * 两件事：
 *   1. **连着入库**（放进库里的都是同一类动作）→ 收成一条"入库 N 道题（S11-1 → S23-1）"；
 *   2. 完全重复的（同 kind + 同 tool + 同文本）→ 记次数。
 */
function collapseRepeats(entries: readonly LogEntryView[]): readonly LogEntryView[] {
  const merged: LogEntryView[] = []
  let run: LogEntryView[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const first = run[0]
    const last = run.at(-1)
    if (run.length === 1 && first !== undefined) {
      merged.push(first)
    } else if (first !== undefined && last !== undefined) {
      merged.push({
        ...last,
        text: `入库 ${String(run.length)} 道题：${first.text.replace(/^入库：/, '')} → ${last.text.replace(/^入库：/, '')}`,
      })
    }
    run = []
  }
  for (const entry of entries) {
    if (/^入库：/.test(entry.text)) {
      run.push(entry)
      continue
    }
    flush()
    merged.push(entry)
  }
  flush()

  // 连着写题型（agent 一轮能写十来个）也收成一条：只留"写了几个、覆盖什么"
  const condensed: LogEntryView[] = []
  let wrote: LogEntryView[] = []
  const flushWrote = (): void => {
    if (wrote.length === 0) return
    const first = wrote[0]
    const last = wrote.at(-1)
    if (wrote.length === 1 && first !== undefined) condensed.push(first)
    else if (last !== undefined) {
      const names = wrote.map((entry) => entry.text.split('（')[0]?.replace(/\s*通过验收并生效.*$/u, '').trim() ?? '')
      condensed.push({ ...last, text: `写了 ${String(wrote.length)} 个题型：${names.join('、')}` })
    }
    wrote = []
  }
  for (const entry of merged) {
    if (entry.tool === 'constructor_write') {
      wrote.push(entry)
      continue
    }
    flushWrote()
    condensed.push(entry)
  }
  flushWrote()

  const out: LogEntryView[] = []
  for (const entry of condensed) {
    const last = out.at(-1)
    if (last !== undefined && entry.kind !== 'user' && last.kind === entry.kind && last.tool === entry.tool && last.text === entry.text) {
      last.repeat = (last.repeat ?? 1) + 1
      continue
    }
    out.push({ ...entry })
  }
  return out
}

/**
 * 底部那条**实时状态**：「正在 ws_grep…（已 12 秒）」。
 *
 * 为什么要有：一次模型调用加一次工具可能几十秒没有任何输出，
 * 界面静悄悄的时候，老师会以为它死了（用户原话："看不到 agent 的实时工作，
 * 让用户干等待会以为没工作"）。所以工具一开跑就推一条 run:busy，这里秒数跳着走。
 */
export function DoingRow({ doing, since }: { doing: { what: string; agent: string } | null; since: number }): React.JSX.Element | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (doing === null) return undefined
    const timer = window.setInterval(() => tick((previous) => previous + 1), 1000)
    return () => window.clearInterval(timer)
  }, [doing])
  if (doing === null) return null
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2.5, py: 1.5 }}>
      <CircularProgress size={14} thickness={5} />
      <Typography variant="caption" color="text.secondary">
        正在 {toolLabel(doing.what)}…（{seconds} 秒）
      </Typography>
    </Stack>
  )
}

export function Timeline({ entries, running }: { entries: readonly LogEntryView[]; running: boolean }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  useEffect(() => {
    const box = boxRef.current
    if (box !== null) stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <Box sx={{ p: 4, maxWidth: 520, mx: 'auto', textAlign: 'center' }}>
        <Avatar sx={{ bgcolor: 'grey.200', color: 'grey.600', width: 48, height: 48, mx: 'auto', mb: 2 }}>
          <AutoAwesomeIcon />
        </Avatar>
        <Typography variant="subtitle1" gutterBottom>
          还没有开始
        </Typography>
        <Typography variant="body2" color="text.secondary">
          说一句你想要什么样的卷子，例如「初三(2)班，二次函数最值，一道大题两道小题」。
        </Typography>
      </Box>
    )
  }

  return (
    <Box ref={boxRef} sx={{ height: '100%', overflowY: 'auto', px: { xs: 1.5, md: 2 }, py: 1.5 }}>
      <List disablePadding>
        {collapseRepeats(entries).map((entry) => (
          <Row key={entry.id} entry={entry} />
        ))}
        {running && (
          <ListItem>
            <ListItemAvatar>
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <CircularProgress size={16} color="inherit" />
              </Avatar>
            </ListItemAvatar>
            <ListItemText primary="正在做…" secondary="可以直接说一句，它下一步会看到" />
          </ListItem>
        )}
      </List>
      <div ref={endRef} />
    </Box>
  )
}

function Row({ entry }: { entry: LogEntryView }): React.JSX.Element {
  const repeat = entry.repeat ?? 1
  if (entry.kind === 'user') {
    return (
      <ListItem sx={{ justifyContent: 'flex-end', pr: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, maxWidth: '85%' }}>
          <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 2.5, px: 2, py: 1 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {plain(entry.text)}
            </Typography>
          </Box>
          <Avatar sx={{ width: 28, height: 28, bgcolor: 'secondary.main' }}>
            <PersonIcon fontSize="small" />
          </Avatar>
        </Box>
      </ListItem>
    )
  }

  const failed = entry.kind === 'gate' && /没通过|失败|拦下|不一致|过于相似|读不了|不能|还缺/.test(entry.text)
  const tone = failed ? 'error.main' : entry.kind === 'verdict' ? 'success.main' : 'primary.main'
  const label = entry.kind === 'tool' ? toolLabel(entry.tool) : entry.kind === 'assistant' ? '命题组' : '检查'

  return (
    <ListItem alignItems="flex-start" sx={{ px: 0.5 }}>
      <ListItemAvatar sx={{ minWidth: 40 }}>
        <Avatar sx={{ width: 28, height: 28, bgcolor: failed ? 'error.main' : entry.kind === 'verdict' ? 'success.main' : 'grey.500' }}>
          {failed ? <ErrorIcon fontSize="small" /> : entry.kind === 'tool' ? <BuildOutlinedIcon fontSize="small" /> : entry.kind === 'verdict' ? <CheckCircleIcon fontSize="small" /> : <AutoAwesomeIcon fontSize="small" />}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        sx={{ my: 0 }}
        primary={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            {repeat > 1 && <Chip size="small" variant="outlined" label={`×${String(repeat)}`} />}
          </Stack>
        }
        secondary={
          entry.kind === 'assistant' ? (
            <Box sx={{ color: 'text.primary' }}>
              <MarkdownText>{entry.text}</MarkdownText>
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: failed ? tone : 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {plain(entry.text)}
            </Typography>
          )
        }
        slotProps={{ secondary: { component: 'div' } }}
      />
      <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, ml: 1, whiteSpace: 'nowrap' }}>
        {new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </Typography>
    </ListItem>
  )
}

/* ─────────────── 试卷 ─────────────── */

/**
 * 「改这道题」对话框：**把三个动作分清楚**。
 *
 *   · 改这道题：说一句要求（改条件、加一问、换题型、换情境），交给 agent 重造——
 *     数值与答案仍由构造给出，改完照例过闸门；
 *   · 改文字：老师直接改题面/答案/解析的说法（改不了数学：对不上会被闸门拦下）；
 *   · 换一道：机器随机再造一道（原来的动作，保留在卷面上）。
 */
export function ReviseDialog({
  slot,
  item,
  onClose,
  onRevise,
  onPatch,
  busy,
}: {
  slot: string
  item: ItemView
  onClose: () => void
  onRevise: (slot: string, instruction: string) => Promise<void>
  onPatch: (
    itemId: string,
    patch: { stem: string; answerText: string; solution: readonly string[] },
  ) => Promise<{ ok: boolean; reason?: string; gate?: string; hint?: string }>
  busy: boolean
}): React.JSX.Element {
  const [mode, setMode] = useState<'revise' | 'text'>('revise')
  const [instruction, setInstruction] = useState('')
  const [stem, setStem] = useState(item.stem)
  const [answer, setAnswer] = useState(item.answer)
  const [solution, setSolution] = useState(item.solutionHtml.map((step) => step.replace(/<[^>]+>/g, '')).join('\n'))
  const [note, setNote] = useState('')

  const examples = ['把条件改简单一点', '再加一问求面积', '改成选择题（四个选项）', '情境换成测量教学楼', '数字换成整数、别太大']

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>改这道题（题位 {slot}）</DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_event, next: 'revise' | 'text') => setMode(next)} sx={{ mb: 2 }}>
          <Tab value="revise" label="改这道题" />
          <Tab value="text" label="改文字" />
        </Tabs>

        {mode === 'revise' ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              说清楚你想怎么改。数值与答案由构造给出——agent 可以换参数重造、换题型，必要时现写一个题型；
              重造出来的题照例过检查，过关才放进这个题位。
            </Typography>
            <TextField
              autoFocus
              multiline
              minRows={3}
              maxRows={8}
              placeholder="例如：把 AB 改成 10，并再加一问求这个三角形的面积"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {examples.map((example) => (
                <Chip key={example} size="small" variant="outlined" label={example} onClick={() => setInstruction(example)} />
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              改的是说法，不是数学：数字、条件、答案对不上构造的话，会被检查拦下并告诉你原因。
            </Typography>
            <TextField label="题面" multiline minRows={3} maxRows={8} value={stem} onChange={(event) => setStem(event.target.value)} />
            <TextField label="答案" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            <TextField
              label="解析（一行一步）"
              multiline
              minRows={3}
              maxRows={8}
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
            />
          </Stack>
        )}

        {note !== '' && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {note}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>算了</Button>
        {mode === 'revise' ? (
          <Button
            variant="contained"
            disableElevation
            disabled={busy || instruction.trim() === ''}
            onClick={() => {
              setNote('')
              void onRevise(slot, instruction.trim()).then(onClose)
            }}
          >
            交给 agent 改
          </Button>
        ) : (
          <Button
            variant="contained"
            disableElevation
            disabled={busy}
            onClick={() => {
              setNote('')
              void onPatch(item.id, {
                stem,
                answerText: answer,
                solution: solution
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line !== ''),
              }).then((result) => (result.ok ? onClose() : setNote(`${gateLabel(result.gate ?? '')}：${result.reason ?? '没通过'}`)))
            }}
          >
            保存并重新检查
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/**
 * 闸门名说人话。**不许把内部名字摊在老师面前**（roundtrip / scope / symbolic …），
 * 他要看的是"题面有没有写歪、算式对不对"这件事本身。
 */
const GATE_LABEL: Readonly<Record<string, string>> = {
  scope: '不超纲',
  symbolic: '算式核对',
  dedup: '不与旧题重复',
  originality: '不是抄原题',
  figure: '图形自洽',
  roundtrip: '题面忠实',
  parts: '分量够',
  options: '选项可判',
}

export function gateLabel(gate: string): string {
  // 闸门有两个名字：插件名（verify-options）与证据键（options）。两个都要认。
  const key = gate.replace(/^verify-/, '')
  return GATE_LABEL[key] ?? GATE_LABEL[gate] ?? gate
}

/** 难度按人话显示：0.855 不是给人看的，0.86 或"较易"才是 */
export function formatDifficulty(range: readonly [number, number] | undefined): string {
  if (range === undefined) return ''
  const low = Math.round(range[0] * 100) / 100
  const high = Math.round(range[1] * 100) / 100
  return low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`
}

function statusOf(item: ItemView, binding: SlotBindingView): { text: string; tone: 'ok' | 'warn'; hint: string } {
  if (binding.confirmedBy !== null) {
    return { text: '已确认', tone: 'ok', hint: `${binding.confirmedBy} 已确认这道题` }
  }
  const failed = Object.entries(item.evidence).filter(([, value]) => !value.pass)
  if (failed.length > 0) {
    return { text: '没通过', tone: 'warn', hint: failed.map(([gate]) => `${gateLabel(gate)}没通过`).join('、') }
  }
  if (item.lifecycle === 'needs_review') {
    return { text: '待确认', tone: 'warn', hint: '有一项检查没验成，等你签字' }
  }
  return { text: '已检查', tone: 'ok', hint: '各项检查都过了' }
}

/**
 * 缺口的说法**给老师看**：服务端那句是给 agent 看的（带内部题型名与闸门名），
 * 界面上要把它们换成"哪一项检查没过 + 为什么"。
 */
function humanGap(reason: string): string {
  const stripped = reason
    .replace(/^\S+\s*被\s*([a-z-]+)\s*拦下：/u, (_all, gate: string) => `${gateLabel(gate)}没过：`)
    .replace(/构造器不覆盖该题位：.*$/u, '还没有能出这个题位的题型')
  return stripped.length > 120 ? `${stripped.slice(0, 118)}…` : stripped
}

function changeMark(change: SlotChangeView | undefined): string {
  if (change === undefined || change.change === 'same') return ''
  return change.change === 'replaced' ? '这一版换过' : change.change === 'added' ? '这一版新增' : '这一版移除'
}

/** 卷面分组：真卷子是"一、选择题（每题 3 分）二、填空题…"，不是一题一张卡片 */
function groupByType(rows: readonly { binding: SlotBindingView; item: ItemView }[]): readonly {
  type: string
  heading: string
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
}[] {
  const order = ['选择', '填空', '解答']
  const groups = new Map<string, { binding: SlotBindingView; item: ItemView }[]>()
  for (const row of rows) {
    const list = groups.get(row.item.type) ?? []
    list.push(row)
    groups.set(row.item.type, list)
  }
  const numerals = ['一', '二', '三', '四', '五']
  return [...groups.entries()]
    .toSorted((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([type, list], index) => {
      const per = list[0]?.item.score ?? 0
      const total = list.reduce((sum, row) => sum + row.item.score, 0)
      return {
        type,
        heading: `${numerals[index] ?? String(index + 1)}、${type}题（每题 ${String(per)} 分，共 ${String(total)} 分）`,
        rows: list,
      }
    })
}

export function PaperView({
  version,
  paperTitle,
  rows,
  changes,
  frozen,
  viewingOld,
  busy,
  bankSize,
  onRegenerate,
  onRevise,
  onConfirm,
  onAssemble,
  onSyncHeader,
}: {
  version: VersionView | undefined
  /** 卷名（来自会话的蓝图） */
  paperTitle: string
  bankSize: number
  onSyncHeader: (totalScore: number) => void
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  changes: readonly SlotChangeView[]
  frozen: boolean
  viewingOld: boolean
  busy: boolean
  onRegenerate: (slotKey: string) => void
  /** 打开"改这道题"（说一句要求，交给 agent 重造） */
  onRevise: (slotKey: string, item: ItemView) => void
  onConfirm: (itemId: string) => void
  onAssemble: () => void
}): React.JSX.Element {
  const [showAnswers, setShowAnswers] = useState(false)

  if (version === undefined) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="subtitle1" gutterBottom>
          还没有试卷
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {frozen
            ? '这份卷子已经定稿。'
            : bankSize === 0
              ? '题库还是空的：让 agent 出题，它会先过一遍检查再入库。'
              : `题库里已经有 ${String(bankSize)} 道题。按蓝图组卷，把够格的题排成一份卷子。`}
        </Typography>
        <Button variant="contained" disableElevation disabled={busy || frozen} onClick={onAssemble}>
          按蓝图出一份
        </Button>
      </Box>
    )
  }

  const groups = groupByType(rows)

  return (
    <Box sx={{ px: { xs: 1, md: 2.5 }, py: 2 }}>
      {/* 工具条：卷面之外的操作都收在这里，别混进卷子里 */}
      <Stack
        direction="row"
        spacing={1}
        data-print-hide
        sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}
      >
        <Typography variant="subtitle2">第 {version.version} 版</Typography>
        <Typography variant="caption" color="text.secondary">
          {String(version.bindings.length)} 道题 · 满分 {String(version.totalScore)}
        </Typography>
        {viewingOld && <Chip label="在看旧版本" color="warning" size="small" />}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant={showAnswers ? 'contained' : 'outlined'}
          disableElevation
          onClick={() => setShowAnswers((previous) => !previous)}
        >
          {showAnswers ? '只看卷面' : '答案与解析'}
        </Button>
        <Button size="small" variant="outlined" onClick={() => window.print()}>
          打印
        </Button>
        <Button size="small" variant="outlined" disabled={busy || frozen} onClick={onAssemble}>
          再出一版
        </Button>
      </Stack>

      {version.scoreGap > 0 && (
        <Alert
          severity="warning"
          icon={<ReportOutlinedIcon />}
          data-print-hide
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" onClick={() => void onSyncHeader(version.totalScore)}>
              卷头改成 {String(version.totalScore)} 分
            </Button>
          }
        >
          这份卷子 {String(version.totalScore)} 分，蓝图卷头写的是更多分（差 {String(version.scoreGap)} 分）。
        </Alert>
      )}

      {version.gaps.length > 0 && (
        <Alert severity="warning" icon={<ReportOutlinedIcon />} data-print-hide sx={{ mb: 1.5 }}>
          有 {String(version.gaps.length)} 个题位没凑齐：{version.gaps.map((gap) => `${gap.slot}（${humanGap(gap.reason)}）`).join('；')}
        </Alert>
      )}

      {/* 卷面：一张纸的样子——标题居中、按题型分节、题号连着走 */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 5 },
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          '& svg': { maxWidth: '100%', height: 'auto' },
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.04em' }}>
            {paperTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            满分 {String(version.totalScore)} 分　共 {String(version.bindings.length)} 题
          </Typography>
        </Box>

        {groups.map((group) => {
          let running = 0
          return (
            <Box key={group.type} sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: 15.5, fontWeight: 600, mb: 1.5 }}>{group.heading}</Typography>
              <Stack spacing={2.5}>
                {group.rows.map(({ binding, item }) => {
                  running += 1
                  return (
                    <QuestionBlock
                      key={binding.slot}
                      number={numberAfter(groups, group.type) + running}
                      binding={binding}
                      item={item}
                      mark={changeMark(changes.find((change) => change.slot === binding.slot))}
                      showAnswer={showAnswers}
                      busy={busy}
                      frozen={frozen}
                      onRegenerate={onRegenerate}
                      onRevise={onRevise}
                      onConfirm={onConfirm}
                    />
                  )
                })}
              </Stack>
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
}

/** 这一节之前已经排了几道题（题号要连着走，不能每组都从 1 开始） */
function numberAfter(groups: readonly { type: string; rows: readonly unknown[] }[], type: string): number {
  let count = 0
  for (const group of groups) {
    if (group.type === type) break
    count += group.rows.length
  }
  return count
}

/** 卷面上的一道题：题号 + 题干 + 选项 + 图；操作按钮只在鼠标悬停时出现 */
function QuestionBlock({
  number,
  binding,
  item,
  mark,
  showAnswer,
  busy,
  frozen,
  onRegenerate,
  onRevise,
  onConfirm,
}: {
  number: number
  binding: SlotBindingView
  item: ItemView
  mark: string
  showAnswer: boolean
  busy: boolean
  frozen: boolean
  onRegenerate: (slotKey: string) => void
  onRevise: (slotKey: string, item: ItemView) => void
  onConfirm: (itemId: string) => void
}): React.JSX.Element {
  const status = statusOf(item, binding)
  const [detail, setDetail] = useState(false)

  return (
    <Box sx={{ position: 'relative', '&:hover .q-actions': { opacity: 1 } }}>
      {/* 卷面左侧的题号（真卷子就是这样）：分值跟在题号后 */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography component="span" sx={{ fontWeight: 600, minWidth: 26 }}>
          {number}.
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="span" sx={{ fontSize: 15.5, lineHeight: 1.9 }}>
            <MathText html={item.stemHtml} />
          </Typography>
          {item.options.length > 0 && (
            <Box
              sx={{
                mt: 1,
                display: 'grid',
                // 按**容器**宽度自适应（不是按屏幕）：卷面这一栏在窄屏/分栏时本来就窄，
                // 两列硬塞会把 "(x-2)(x+6)" 折成两行（截图里就是这样）。
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                columnGap: 3,
                rowGap: 0.5,
              }}
            >
              {item.options.map((option) => (
                <Typography
                  key={option.key}
                  sx={{
                    fontSize: 15,
                    color: showAnswer && option.correct ? 'success.dark' : 'text.primary',
                    fontWeight: showAnswer && option.correct ? 600 : 400,
                  }}
                >
                  {option.key}. <MathText html={option.html} />
                </Typography>
              ))}
            </Box>
          )}
          {item.figure !== '' && (
            <Box
              sx={{ my: 1.5, textAlign: 'center' }}
              dangerouslySetInnerHTML={{ __html: item.figure }}
            />
          )}
          {showAnswer && (
            <Box sx={{ mt: 1.5, pl: 2, borderLeft: 3, borderColor: 'divider' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                答案　<MathText html={item.answerHtml} />
              </Typography>
              <Box component="ol" sx={{ pl: 2.5, my: 1, mb: 0 }}>
                {item.solutionHtml.map((step, stepIndex) => (
                  <Box component="li" key={stepIndex}>
                    <Typography variant="body2" color="text.secondary">
                      <MathText html={step} />
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Button size="small" sx={{ mt: 0.5, px: 0 }} onClick={() => setDetail((previous) => !previous)}>
                {detail ? '收起检查结果' : '检查结果'}
              </Button>
              {detail && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {Object.entries(item.evidence)
                    .map(([gate, value]) => `${gateLabel(gate)}${value.pass ? ' ✓' : ' ✗'}`)
                    .join('　')}
                  {Object.keys(item.evidence).length === 0 ? '（还没有记录）' : ''}
                </Typography>
              )}
            </Box>
          )}
        </Box>

        {/* 老师才能看到的操作：藏在悬停里，不占卷面 */}
        <Stack
          className="q-actions"
          direction="row"
          spacing={0.5}
          data-print-hide
          sx={{ opacity: 0, transition: 'opacity .15s', alignItems: 'center', pl: 1 }}
        >
          {mark !== '' && <Chip size="small" color="info" variant="outlined" label={mark} />}
          <Tooltip title={`${status.hint}｜${item.knowledge.join('、')}｜难度 ${formatDifficulty(item.difficulty)}`}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: status.tone === 'ok' ? 'success.main' : 'warning.main',
              }}
            />
          </Tooltip>
          <Button size="small" disabled={busy || frozen} onClick={() => onRevise(binding.slot, item)}>
            改这道题…
          </Button>
          <Button size="small" disabled={busy || frozen} onClick={() => onRegenerate(binding.slot)}>
            换一道
          </Button>
          {item.lifecycle === 'needs_review' && binding.confirmedBy === null && (
            <Button size="small" variant="contained" disableElevation disabled={busy || frozen} onClick={() => onConfirm(item.id)}>
              确认
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  )
}

export function KnowledgeView({ knowledge, items }: { knowledge: KnowledgeView; items: readonly ItemView[] }): React.JSX.Element {
  const used = new Map<string, number>()
  for (const item of items) for (const key of item.knowledge) used.set(key, (used.get(key) ?? 0) + 1)

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2 } }}>
      <Card>
        <CardHeader title="这一卷用到的知识点" subheader={`共 ${String(knowledge.learned.length)} 个已学知识点`} />
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {knowledge.learned.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                还没有已学知识点。检查蓝图的设置。
              </Typography>
            ) : (
              knowledge.learned.map((key) => (
                <Chip key={key} color={used.has(key) ? 'primary' : 'default'} variant={used.has(key) ? 'filled' : 'outlined'} label={used.has(key) ? `${key} · ${String(used.get(key))}` : key} />
              ))
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="知识点之间的关系" subheader="括号里是它的前置知识" />
        <CardContent>
          <List dense>
            {knowledge.nodes
              .filter((node) => node.prerequisites.length > 0)
              .map((node) => (
                <ListItem key={node.key} divider>
                  <ListItemText primary={node.key} secondary={`前置：${node.prerequisites.join('、')}`} />
                </ListItem>
              ))}
          </List>
        </CardContent>
      </Card>
    </Stack>
  )
}

/* ─────────────── 依据 ─────────────── */

export function EvidenceView({ rows, versions }: { rows: readonly { binding: SlotBindingView; item: ItemView }[]; versions: readonly VersionView[] }): React.JSX.Element {
  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2 } }}>
      <Alert severity="info">这些结论是检查程序写出来的，不是模型说的。</Alert>

      {rows.length === 0 && (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              还没有题目。
            </Typography>
          </CardContent>
        </Card>
      )}

      {rows.map(({ binding, item }) => (
        <Card key={binding.slot}>
          <CardHeader
            avatar={<Avatar sx={{ bgcolor: 'grey.600' }}>{binding.slot}</Avatar>}
            title={`${item.type}　${String(item.score)} 分`}
            subheader={item.knowledge.join('、')}
          />
          <CardContent sx={{ pt: 0 }}>
            <Stack spacing={1}>
              {Object.entries(item.evidence).map(([gate, value]) => (
                <Stack key={gate} direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <Chip size="small" color={value.pass ? 'success' : 'error'} label={value.pass ? '通过' : '没通过'} />
                  <Box sx={{ minWidth: 0 }}>
                    {/* 闸门名说人话：老师不需要认识 roundtrip / symbolic 这些内部名字 */}
                    <Typography variant="body2">{gateLabel(gate)}</Typography>
                    {value.detail !== undefined && (
                      <Typography variant="caption" color="text.secondary">
                        {value.detail}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              ))}
              {item.confirmedBy != null && (
                <Typography variant="caption" color="text.secondary">
                  {item.confirmedBy} 在 {new Date(item.confirmedAt ?? '').toLocaleString('zh-CN')} 确认过
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}

      {versions.length > 1 && (
        <Card>
          <CardHeader title="版本" />
          <CardContent>
            <List dense>
              {versions.map((version) => (
                <ListItem key={version.version} divider>
                  <ListItemAvatar>
                    <Avatar sx={{ bgcolor: 'primary.main', width: 30, height: 30, fontSize: 13 }}>v{version.version}</Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={version.reason} secondary={`${new Date(version.at).toLocaleString('zh-CN')}　试了 ${String(version.attempts)} 次`} />
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}

/* ─────────────── 文件（agent 的工作区） ─────────────── */

/** 路径 → 树（`in/a.pdf`、`tmp/x.py` 这样按 `/` 分层） */
interface TreeNode {
  name: string
  path: string
  bytes: number
  children: TreeNode[]
  isFile: boolean
}

function buildTree(files: readonly { path: string; bytes: number }[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', bytes: 0, children: [], isFile: false }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      let next = node.children.find((child) => child.name === part)
      if (next === undefined) {
        next = { name: part, path: parts.slice(0, index + 1).join('/'), bytes: 0, children: [], isFile }
        node.children.push(next)
      }
      if (isFile) next.bytes = file.bytes
      node = next
    })
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => ({ ...node, children: sort(node.children) }))
      .toSorted((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1))
  return sort(root.children)
}

function humanSize(bytes: number): string {
  if (bytes === 0) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function TreeBranch({
  nodes,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  nodes: readonly TreeNode[]
  depth: number
  selected: string
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <List dense disablePadding>
      {nodes.map((node) => (
        <Box key={node.path}>
          <ListItem disablePadding sx={{ pl: depth * 1.5 }}>
            <ListItemButton selected={node.isFile && node.path === selected} onClick={() => (node.isFile ? onSelect(node.path) : onToggle(node.path))}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                {node.isFile ? <InsertDriveFileOutlinedIcon fontSize="small" /> : expanded.has(node.path) ? <FolderOpenOutlinedIcon fontSize="small" /> : <FolderOutlinedIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={node.name}
                slotProps={{ primary: { variant: 'body2', noWrap: true, sx: { fontFamily: node.isFile ? 'monospace' : 'inherit' } } }}
              />
              {node.isFile && <Typography variant="caption" color="text.disabled">{humanSize(node.bytes)}</Typography>}
            </ListItemButton>
          </ListItem>
          {!node.isFile && (
            <Collapse in={expanded.has(node.path)} unmountOnExit>
              <TreeBranch nodes={node.children} depth={depth + 1} selected={selected} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
            </Collapse>
          )}
        </Box>
      ))}
    </List>
  )
}

export function FilesView({ name, tick }: { name: string; tick: number }): React.JSX.Element {
  const { busy, guard } = useApp()
  const [view, setView] = useState<Awaited<ReturnType<typeof api.getWorkspace>> | null>(null)
  const [file, setFile] = useState('')
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [offset, setOffset] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (name === '') return
    void api
      .getWorkspace(name)
      .then((next) => setView(next))
      .catch(() => setView(null))
  }, [name, tick])

  useEffect(() => {
    if (name === '' || file === '') return
    void api
      .readWorkspaceFile(name, file, 0)
      .then((next) => {
        setOffset(0)
        setChunk(next)
      })
      .catch(() => setChunk(null))
  }, [name, file, tick])

  const files = view?.files ?? []
  const tree = useMemo(() => buildTree(files), [files])
  const expanded = useMemo(() => {
    const all = new Set<string>()
    for (const node of tree) if (!node.isFile) all.add(node.path)
    for (const path of collapsed) all.delete(path)
    return all
  }, [tree, collapsed])

  if (name === '') {
    return (
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            这个会话还没有工作区。
          </Typography>
        </CardContent>
      </Card>
    )
  }

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2 } }}>
      <Card>
        <CardHeader
          avatar={<Avatar sx={{ bgcolor: 'secondary.main' }}><FolderOpenOutlinedIcon /></Avatar>}
          title="工作区"
          subheader={files.length === 0 ? '它读的资料、写的脚本、跑出来的东西都留在这里' : `${String(files.length)} 个文件`}
          action={
            view?.venv == null ? (
              <Tooltip title="处理 PDF / Word / Excel 需要它：在仓库根跑 pnpm venv">
                <Chip color="warning" variant="outlined" label="还没建虚拟环境" />
              </Tooltip>
            ) : undefined
          }
        />
        <CardContent sx={{ pt: 0 }}>
          {files.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              agent 还没有在这里放过文件。
            </Typography>
          ) : (
            <TreeBranch
              nodes={tree}
              depth={0}
              selected={file}
              expanded={expanded}
              onToggle={(path) =>
                setCollapsed((previous) => {
                  const next = new Set(previous)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              }
              onSelect={setFile}
            />
          )}
        </CardContent>
      </Card>

      {file !== '' && (
        <Card>
          <CardHeader title={file} subheader={chunk === null ? '这个文件不是文本（PDF、图片这类）' : `共 ${String(chunk.total)} 字`} />
          {chunk !== null && (
            <CardContent sx={{ pt: 0 }}>
              <Box sx={{ maxHeight: 360, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
                <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {chunk.text}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" disabled={busy !== '' || offset === 0} onClick={() => void guard('files', async () => setChunk(await api.readWorkspaceFile(name, file, Math.max(0, offset - 4000))))}>
                  上一段
                </Button>
                <Button size="small" disabled={busy !== '' || chunk.next === undefined} onClick={() => void guard('files', async () => setChunk(await api.readWorkspaceFile(name, file, chunk.next ?? offset)))}>
                  下一段
                </Button>
              </Stack>
            </CardContent>
          )}
        </Card>
      )}
    </Stack>
  )
}
