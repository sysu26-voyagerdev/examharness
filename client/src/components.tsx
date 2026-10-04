import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PersonIcon from '@mui/icons-material/Person'
import ReportOutlinedIcon from '@mui/icons-material/ReportOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
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
import { RISK, TOOL_LABEL, gateLabel, toolLabel } from './log.js'
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

/** 第一次用时的三句话：说得出、也点得动 */
const EXAMPLES: readonly string[] = [
  '出一份二次函数的课后作业，20 分钟',
  '再加一道圆的选择题，3 分',
  '这一版太难了，换简单点',
  '整卷换一版：情境生活化一点',
]

/**
 * agent 的工作记录：**DSH 式的一块一块**。
 *
 * 为什么是这样：老师要看着它干活（那才是控制感），所以它必须常驻、可读、能插话；
 * 但一条平铺的流水账会"串"——主线、子任务、几轮之间分不开。
 * 所以按**轮**分块：块头是老师那句话，块内一行一步，子任务缩进嵌在自己那一轮里；
 * 过去跑完的块折成一行，最近一轮（和正在跑的）展开。没有装饰动画，没有转圈。
 */
export function Timeline({
  entries,
  running,
  runningId,
  translate,
  onExample,
}: {
  entries: readonly LogEntryView[]
  running: boolean
  /** 正在跑的那一轮（哪一块展开） */
  runningId?: string
  /** 把系统题号翻成人话（S3-1 → 第 3 题） */
  translate?: (text: string) => string
  /** 点一句例子就把它填进输入框（第一次用时不用猜该说什么） */
  onExample?: (text: string) => void
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  /** 里面那一层（块都在里面）：观察它的大小，才知道"内容又长高了" */
  const contentRef = useRef<HTMLDivElement | null>(null)
  /**
   * 是不是"贴着底"：贴着就跟着最新一行往下走，松开就不动它。
   *
   * 规矩（用户原话）：**除非老师自己在往上滚，就自动到最底部**（刚打开也算）；
   * 他往上滚之后别再拽他回去，除非点"回到最新"。
   * 用 scroll 事件记，而不是每次新记录来了量一遍——后者在"内容一边长、事件一边来"时会误判。
   */
  const stickRef = useRef(true)
  /** 我们自己刚把滚动条设到哪儿：用来认出"这是程序滚的"，别当成老师在翻 */
  const expectRef = useRef(-1)
  const [free, setFree] = useState(false)
  /**
   * 块的开合：**只记老师手动改过的那些**（id → 展开吗）。
   *
   * 以前这里分了"手动展开的"和"手动收起的"两个数组，而"手动展开"那个数组**从头到尾没被写过**
   * （只读不写）——于是点一个折起来的旧块时，第一下只是把它记进"收起的名单"，看着毫无反应：
   * 旧块**永远打不开**（真实踩过，截图复现过）。
   */
  const [manual, setManual] = useState<Readonly<Record<string, boolean>>>({})

  const toBottom = (): void => {
    const box = boxRef.current
    if (box === null) return
    // 直接设 scrollTop：`scrollIntoView` 会连祖先滚动容器一起滚（实测会把卷面也带着动）
    box.scrollTop = box.scrollHeight
    expectRef.current = box.scrollTop
    stickRef.current = true
    setFree(false)
  }
  /**
   * 老师在翻记录吗？
   *
   * 只认**他滚出来的位置**：内容一边长、事件一边来，如果每次都拿"现在离底多远"重新判断，
   * 中间那一次量到"离底很远"就会把"跟着走"关掉——记录一边长一边自己停在半路（真实踩到过）。
   * 所以先认出"这一下是我自己滚的"（停在刚设的位置上），剩下的才算老师翻的。
   */
  const remember = (): void => {
    const box = boxRef.current
    if (box === null) return
    if (Math.abs(box.scrollTop - expectRef.current) <= 2) return
    const away = box.scrollHeight - box.scrollTop - box.clientHeight > 24
    stickRef.current = !away
    setFree(away)
  }
  useEffect(() => {
    const box = boxRef.current
    if (box === null) return
    if (stickRef.current) {
      toBottom()
      return
    }
    // 没贴着底：把"离底多远"重新量一遍——内容长了、或者它自己已经回到过底部，按钮要跟着变
    const away = box.scrollHeight - box.scrollTop - box.clientHeight > 24
    stickRef.current = !away
    setFree(away)
  }, [entries.length])
  /**
   * 高度会自己变（实时区出现/消失、窗口缩放、字体与公式重排）：贴着底的话一直跟着走。
   * 观察的是**里面的内容**：只观察外框的话，内容长高根本不会触发（这一层高度没变）。
   */
  useEffect(() => {
    const box = boxRef.current
    const content = contentRef.current
    if (box === null || content === null) return undefined
    const observer = new ResizeObserver(() => {
      if (stickRef.current) toBottom()
    })
    observer.observe(box)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const blocks = useMemo(() => collapseBlocks(groupRuns(entries)), [entries])
  /** 默认展开**最近一轮**（刚发生的事才是老师要看的）；兜底那一块（'earlier'）不算"最近一轮" */
  const latestRound = blocks.toReversed().find((block) => block.id !== 'earlier')?.id
  const isOpen = (block: RunBlock): boolean => {
    const chosen = manual[block.id]
    if (chosen !== undefined) return chosen
    if (running && block.id === runningId) return true
    // 子任务（帮手）：正在跑的那个展开，跑完的折成一行——不然父块会被帮手的过程淹没
    if (block.parent !== undefined) return false
    return block.id === latestRound
  }
  const toggle = (block: RunBlock): void =>
    setManual((previous) => ({ ...previous, [block.id]: !isOpen(block) }))

  if (blocks.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          还没有开始。说一句就行——出题、改哪一道、换个难度，都是这一句：
        </Typography>
        <Stack spacing={0.75}>
          {EXAMPLES.map((example) => (
            <ButtonBase
              key={example}
              disabled={onExample === undefined}
              onClick={() => onExample?.(example)}
              sx={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                px: 1.25,
                py: 0.75,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography variant="body2">{example}</Typography>
            </ButtonBase>
          ))}
        </Stack>
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'relative', height: '100%', minHeight: 0 }}>
      <Box ref={boxRef} onScroll={remember} sx={{ height: '100%', overflowY: 'auto', px: 1.25, py: 1 }}>
        <Box ref={contentRef}>
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              running={running}
              {...(runningId === undefined ? {} : { runningId })}
              isOpen={isOpen}
              onToggle={toggle}
              {...(translate === undefined ? {} : { translate })}
            />
          ))}
          <div ref={endRef} />
        </Box>
      </Box>
      {/* 老师往上翻着看的时候，新记录不会把他拽下去；想跟上就点这一下 */}
      {free && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<ArrowDownwardIcon sx={{ fontSize: 15 }} />}
          onClick={toBottom}
          sx={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'background.paper',
            boxShadow: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          回到最新
        </Button>
      )}
    </Box>
  )
}

/** 块头那一列（"老师/卷子/子任务"）的宽度：**固定住**，不然每一块的标题起头都不齐 */
const WHO_WIDTH = 38

/**
 * 一块：块头一行（谁说的 + 说了什么 + 在做/做完了 + 几点），折起来时补一句"最后成了什么"。
 * 展开时先列自己这一步一步，再把子任务嵌在下面——**子任务有自己的块头**，能单独开合、有几层嵌几层。
 */
function BlockRow({
  block,
  running,
  runningId,
  isOpen,
  onToggle,
  translate,
}: {
  block: RunBlock
  running: boolean
  runningId?: string
  isOpen: (block: RunBlock) => boolean
  onToggle: (block: RunBlock) => void
  translate?: (text: string) => string
}): React.JSX.Element {
  const open = isOpen(block)
  const current = running && block.id === runningId
  return (
    <Box sx={{ mb: 1.25 }}>
      <ButtonBase
        onClick={() => onToggle(block)}
        aria-expanded={open}
        title={open ? '折起来' : '展开看每一步'}
        sx={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          px: 0.5,
          py: 0.5,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {/* 第一行：谁说的 + 说了什么（**一行，截断**，不换行——换行会把整块挤成一坨） */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ whiteSpace: 'nowrap', width: WHO_WIDTH, flexShrink: 0 }}
          >
            {block.id === 'earlier' ? '卷子' : block.parent === undefined ? '老师' : '子任务'}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
            {titleLine(block.title, translate)}
          </Typography>
          {current ? <Chip size="small" color="primary" label="在做" /> : <Chip size="small" variant="outlined" label="做完了" />}
          <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
            {clock(block.at)}
          </Typography>
        </Stack>
        {/* 第二行：折起来时给出"最后成了什么"（展开时就不必重复） */}
        {!open && (
          <Typography
            variant="caption"
            color="text.disabled"
            noWrap
            sx={{ display: 'block', pl: `${String(WHO_WIDTH + 8)}px` }}
          >
            {String(stepsOf(block))} 步 · {resultLine(block, translate)}
          </Typography>
        )}
      </ButtonBase>
      {open && (
        <Stack spacing={0.25} sx={{ pl: block.parent === undefined ? 1 : 2.5, mt: 0.25 }}>
          {block.entries.map((entry) => (
            <StepRow key={entry.id} entry={entry} {...(translate === undefined ? {} : { translate })} />
          ))}
          {block.children.map((child) => (
            <Box key={child.id} sx={{ borderLeft: 2, borderColor: 'divider', pl: 1 }}>
              <BlockRow
                block={child}
                running={running}
                {...(runningId === undefined ? {} : { runningId })}
                isOpen={isOpen}
                onToggle={onToggle}
                {...(translate === undefined ? {} : { translate })}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}

/** 几点几分（记录里只有一个时间格式：时:分） */
function clock(at: string): string {
  return new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 折起来的块也让人知道"最后成了什么"（取最后一条记录的第一句） */
function resultLine(block: RunBlock, translate?: (text: string) => string): string {
  const last = block.entries.at(-1)
  if (last === undefined) return ''
  const text = translate === undefined ? last.text : translate(last.text)
  const first = (text.split('\n')[0] ?? '').trim()
  return first.length > 40 ? `${first.slice(0, 40)}…` : first
}

/**
 * 块头那一行：老师说的话（或"改第 3 题"这种派活）**也要翻译**。
 *
 * "改 S3-1"里的题号是内部编号，直接显示出来就是个系统词（真实踩过）。
 */
function titleLine(title: string, translate?: (text: string) => string): string {
  const cleaned = plain(title)
  return translate === undefined ? cleaned : translate(cleaned)
}

interface RunBlock {
  id: string
  title: string
  at: string
  parent?: string
  entries: readonly LogEntryView[]
  children: readonly RunBlock[]
}

/** 一块里一共有多少步（含子任务的），折起来时显示的就是它 */
function stepsOf(block: RunBlock): number {
  return block.entries.length + block.children.reduce((sum, child) => sum + stepsOf(child), 0)
}

/** 每一块自己合一遍重复行，子块也合 */
function collapseBlocks(blocks: readonly RunBlock[]): readonly RunBlock[] {
  return blocks.map((block) => ({
    ...block,
    entries: collapseSame(block.entries),
    children: collapseBlocks(block.children),
  }))
}

/**
 * 按"轮"分块：起一轮的那一行是块头，其余挂到自己的 `agent`/`runId` 下。
 *
 * 子任务嵌在派它的那一轮里（**有几层就嵌几层**）：以前只往"顶层块"里挂一层，
 * 帮手再派的帮手就挂不上任何地方——它每一步都渲染不出来（等于凭空消失），
 * 而挂不上父块的行又会掉进兜底块，几条线混成一条平铺的流水账，也就是用户说的"串"。
 */
function groupRuns(entries: readonly LogEntryView[]): readonly RunBlock[] {
  const starters = new Map<string, { title: string; at: string; parent?: string }>()
  for (const entry of entries) {
    if (entry.kind !== 'user' || entry.runId === undefined) continue
    if (!starters.has(entry.runId)) {
      starters.set(entry.runId, {
        title: entry.text,
        at: entry.at,
        ...(entry.parent === undefined ? {} : { parent: entry.parent }),
      })
    }
  }
  const buckets = new Map<string, LogEntryView[]>()
  const loose: LogEntryView[] = []
  for (const entry of entries) {
    const id = entry.agent ?? entry.runId
    if (id === undefined || !starters.has(id)) {
      // 没有轮次归属的行（老师签的字、早先的记录）单独兜住，不硬塞进谁的块里
      loose.push(entry)
      continue
    }
    const bucket = buckets.get(id) ?? []
    bucket.push(entry)
    buckets.set(id, bucket)
  }
  const nodes = new Map<string, RunBlock>()
  for (const [id, starter] of starters) {
    nodes.set(id, {
      id,
      title: starter.title,
      at: starter.at,
      ...(starter.parent === undefined ? {} : { parent: starter.parent }),
      // 块头那一行不重复显示在块里
      entries: (buckets.get(id) ?? []).filter(
        (entry) => !(entry.kind === 'user' && entry.runId === id && entry.text === starter.title),
      ),
      children: [],
    })
  }
  /** 顺着 parent 往上走：用来认出"父块指向自己/自己的后代"这种坏数据，别渲染成死循环 */
  const reaches = (from: RunBlock, target: string): boolean => {
    const seen = new Set<string>()
    let current: RunBlock | undefined = from
    while (current !== undefined && !seen.has(current.id)) {
      if (current.id === target) return true
      seen.add(current.id)
      current = current.parent === undefined ? undefined : nodes.get(current.parent)
    }
    return false
  }
  const roots: RunBlock[] = []
  for (const node of nodes.values()) {
    const parent = node.parent === undefined ? undefined : nodes.get(node.parent)
    if (parent === undefined || parent.id === node.id || reaches(parent, node.id)) {
      roots.push(node)
      continue
    }
    const siblings = parent.children as RunBlock[]
    siblings.push(node)
  }
  if (loose.length > 0) {
    const earlier: RunBlock = {
      id: 'earlier',
      // 没有轮次头的记录（例如老师签字、退回某一版）：不属于哪一轮 agent，
      // 但它们就是"这一版"发生过的事——别把它们藏起来，也别叫它们"早先的记录"
      title: '这一版做了什么',
      at: loose[0]?.at ?? new Date().toISOString(),
      entries: loose,
      children: [],
    }
    // **按时间插回去**：以前不管三七二十一放在最上面，于是"最近发生的事"长在记录的开头
    const index = roots.findIndex((root) => root.at > earlier.at)
    if (index < 0) roots.push(earlier)
    else roots.splice(index, 0, earlier)
  }
  return roots
}

/**
 * 连着几行一模一样就合成一行（×N）：记录要能读，不是流水账。
 *
 * 比的是**正文 + 类型 + 工具名**：只比正文的话，两个不同工具碰巧写出同一句话
 * 就会被合成一行，标签只剩前一个——等于把"谁干的"说错。
 */
function collapseSame(entries: readonly LogEntryView[]): readonly LogEntryView[] {
  const out: LogEntryView[] = []
  for (const entry of entries) {
    const previous = out.at(-1)
    if (
      previous !== undefined &&
      previous.text === entry.text &&
      previous.kind === entry.kind &&
      previous.tool === entry.tool
    ) {
      out[out.length - 1] = { ...previous, repeat: (previous.repeat ?? 1) + 1 }
      continue
    }
    out.push(entry)
  }
  return out
}

/**
 * 一步的语气：**出错**、**没成**、**完成**、平常。
 *
 * 记录里没有"语气"字段（那是服务端的事，界面不改数据），只能看文字——
 * 所以说法要列全：以前这条正则里没有"出错"，于是"这一轮出错停下了"那一行
 * 顶着一个**绿色对勾**（真实踩过，截图里就是它）。
 */
const HARD_FAIL = /出错|停下了|崩了|报错/u
const SOFT_FAIL = /没通过|失败|拦下|不一致|过于相似|读不了|不能|还缺|出不了|没赶上|没做成|没成功/u

/**
 * 一步：**一行，但会自己换行**。
 *
 * 踩过：以前用 nowrap + 省略号，栏一窄就成了一条横线（用户："agent 输出没有自动换行"）。
 * 记录是给人读的，宁可折行也不裁字；实在长的（超过 6 行）折起一半，点一下看全文。
 */
function StepRow({ entry, translate }: { entry: LogEntryView; translate?: (text: string) => string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const text = translate === undefined ? entry.text : translate(entry.text)
  const broken = HARD_FAIL.test(text)
  const stalled = !broken && SOFT_FAIL.test(text)
  const tone = broken ? 'error.main' : stalled ? 'warning.main' : 'text.primary'
  const settled = entry.kind === 'verdict' || entry.kind === 'gate'
  const long = text.length > 260 || text.split('\n').length > 6
  const toggle = (): void => setOpen((value) => !value)
  return (
    <Box sx={{ px: 0.5 }}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ mt: 0.4, flexShrink: 0 }}>
          {broken ? (
            <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />
          ) : stalled ? (
            <WarningAmberOutlinedIcon sx={{ fontSize: 14, color: 'warning.main' }} />
          ) : settled ? (
            <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
          ) : (
            <BuildOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          )}
        </Box>
        <Typography
          variant="body2"
          onClick={long ? toggle : undefined}
          onKeyDown={
            long
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle()
                  }
                }
              : undefined
          }
          {...(long ? { role: 'button', tabIndex: 0, 'aria-expanded': open } : {})}
          sx={{
            flex: 1,
            minWidth: 0,
            color: tone,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            cursor: long ? 'pointer' : 'default',
            borderRadius: 0.5,
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
            ...(long && !open
              ? {
                  display: '-webkit-box',
                  WebkitLineClamp: 6,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }
              : {}),
          }}
          title={long ? (open ? '收起' : '点开看全文（也可以按回车）') : undefined}
        >
          {entry.kind === 'tool' && toolLabel(entry.tool) !== '' ? `${toolLabel(entry.tool)}：` : ''}
          {text}
          {(entry.repeat ?? 1) > 1 && (
            <Box component="span" sx={{ ml: 0.75, color: 'text.disabled' }}>
              ×{String(entry.repeat ?? 1)}
            </Box>
          )}
        </Typography>
      </Stack>
    </Box>
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

  const examples = [
    '换一道不一样的（换情境、换问法）',
    '把条件改简单一点',
    '再加一问求面积',
    '改成选择题（四个选项）',
    '情境换成测量教学楼',
  ]

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>改这一道</DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_event, next: 'revise' | 'text') => setMode(next)} sx={{ mb: 2 }}>
          <Tab value="revise" label="改这道题" />
          <Tab value="text" label="改文字" />
        </Tabs>

        {mode === 'revise' ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
               说清楚你想要什么：换情境、加一问、换一道不一样的、改成选择题……都由它重新设计再造一道。
              数值与答案由构造给出（它不会替你编数），重造出来的题照例过检查，过关才放进这一道。
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
            disabled={instruction.trim() === ''}
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
            disabled={false}
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

/** 难度按人话显示：0.855 不是给人看的，0.86 或"较易"才是 */
export function formatDifficulty(range: readonly [number, number] | undefined): string {
  if (range === undefined) return ''
  const low = Math.round(range[0] * 100) / 100
  const high = Math.round(range[1] * 100) / 100
  return low === high ? low.toFixed(2) : `${low.toFixed(2)}–${high.toFixed(2)}`
}

function statusOf(item: ItemView, binding: SlotBindingView): { text: string; tone: 'ok' | 'warn'; hint: string } {
  // 检查过期先于其它状态：闸门加了判据之后，旧签字不算数——不能假装它还合格
  if (item.stale === true) {
    return { text: '要重查', tone: 'warn', hint: '这道题的检查是旧规则的（闸门后来加了判据），要重新过一遍' }
  }
  if (binding.confirmedBy !== null) {
    return { text: '已确认', tone: 'ok', hint: `${binding.confirmedBy} 已确认这道题` }
  }
  if (binding.chosenBy !== undefined) {
    // 指定过的那道：重组卷不会换掉它（与签字同一档）
    return { text: '指定的', tone: 'ok', hint: `${binding.chosenBy} 指定要这一道——重组卷不会换掉它` }
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
    // 缺口原因里可能列了几个题型各为什么不行：**每一处**都要翻成人话
    .replace(/[^：:\s]+\s*被\s*verify-([a-z-]+)\s*拦下：/gu, (_all, gate: string) => `${RISK[gate] ?? gateLabel(`verify-${gate}`)}：`)
    .replace(/与已入库题目结构完全相同（\S+）/gu, '与我已经出过的一道题完全相同')
    .replace(/构造器不覆盖该题位：.*$/u, '还没有能出这道题的题型')
  return stripped.length > 120 ? `${stripped.slice(0, 118)}…` : stripped
}

function changeMark(change: SlotChangeView | undefined): string {
  if (change === undefined || change.change === 'same') return ''
  return change.change === 'replaced' ? '这一版换过' : change.change === 'added' ? '这一版新增' : '这一版移除'
}

/** 卷面分组：真卷子是"一、选择题（每题 3 分）二、填空题…"，不是一题一张卡片 */
export function groupByType(rows: readonly { binding: SlotBindingView; item: ItemView }[]): readonly {
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
  paper,
  rows,
  changes,
  frozen,
  viewingOld,
  busy,
  bankSize,
  onRevise,
  onConfirm,
  onSyncHeader,
  onPatchPaper,
  onPatchText,
  onDelete,
  onReaudit,
  answers,
  chrome = 'full',
}: {
  version: VersionView | undefined
  /** 卷头（卷名/班级/时长/满分）：**在文档里点着改**，改的是这一张卷子的设定 */
  paper: { title: string; totalScore: number; minutes: number; className: string; studentFields?: boolean }
  onPatchPaper: (patch: Partial<{ title: string; minutes: number; className: string; studentFields: boolean }>) => void
  bankSize: number
  onSyncHeader: (totalScore: number) => void
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  changes: readonly SlotChangeView[]
  frozen: boolean
  viewingOld: boolean
  busy: boolean
  /** 打开"改这一道"（说一句要求，交给 agent 重造） */
  onRevise: (slotKey: string, item: ItemView) => void
  onConfirm: (itemId: string) => void
  /** 就地改题面（改说法） */
  onPatchText: (itemId: string, stem: string) => Promise<{ ok: boolean; reason?: string; gate?: string }>
  /** 从卷子上拿掉这一道 */
  onDelete: (slotKey: string) => void
  /** 把"检查过期"的题重新送审（闸门加了判据之后，旧签字不算数） */
  onReaudit: () => void
  /** 由外面控制"要不要连着答案看"（底栏的 试卷|答案 视图标签） */
  answers?: boolean
  /**
   * 'full'：卷面 + 它自己的工具条（够用，但工具条与顶栏重复）；
   * 'doc'：只有卷面（还有两条如实说明的提示），按钮都在顶栏功能区——一屏只有一套动词。
   */
  chrome?: 'full' | 'doc'
}): React.JSX.Element {
  const [ownAnswers, setOwnAnswers] = useState(false)
  const showAnswers = answers ?? ownAnswers

  if (version === undefined) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', maxWidth: 460, mx: 'auto' }}>
        <Typography variant="subtitle1" gutterBottom>
          还是空的
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {frozen
            ? '这份卷子已经定稿。'
            : '在右边那一栏说一句你要什么——它会先给设计和题，你再一句句改。'}
        </Typography>

      </Box>
    )
  }

  const groups = groupByType(rows)
  /** 检查过期的有几道（闸门加了判据之后，旧签字不算数） */
  const staleCount = rows.filter(({ item }) => item.stale === true).length

  return (
    <Box sx={{ px: { xs: 1, md: 2.5 }, py: 2 }}>
      {/* 工具条：卷面之外的操作都收在这里，别混进卷子里（chrome='doc' 时这些都在顶栏） */}
      <Stack
        direction="row"
        spacing={1}
        data-print-hide
        sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5, display: chrome === 'doc' ? 'none' : 'flex' }}
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
          onClick={() => setOwnAnswers((previous) => !previous)}
        >
          {showAnswers ? '只看卷面' : '答案与解析'}
        </Button>
        <Button size="small" variant="outlined" onClick={() => window.print()}>
          打印
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
          这份卷子 {String(version.totalScore)} 分，设定里卷头写的是更多分（差 {String(version.scoreGap)} 分）。
        </Alert>
      )}

      {staleCount > 0 && (
        <Alert
          severity="warning"
          icon={<ReportOutlinedIcon />}
          data-print-hide
          sx={{ mb: 1.5 }}
          action={
            <Button color="inherit" size="small" disabled={busy} onClick={onReaudit}>
              重新检查一遍
            </Button>
          }
        >
          有 {String(staleCount)} 道题的检查是旧规则的（闸门后来加了判据，比如「题面说『如图』就必须有图」）。
          过得了的就地更新；过不了的它会按原因修（补图 / 去掉「如图」/ 重造）。
        </Alert>
      )}

      {version.gaps.length > 0 && (
        <Alert severity="warning" icon={<ReportOutlinedIcon />} data-print-hide sx={{ mb: 1.5 }}>
          还缺 {String(version.gaps.length)} 道：{version.gaps.map((gap) => `${gap.slot.replace(/-\d+$/, '')}`).join('、')}
          （设定里的编号）
          <Box sx={{ mt: 0.5, color: 'text.secondary' }}>
            {(() => {
              // 同一句原因重复三遍是最烦的（每个题型各报一次）——去重后只留不同的话
              const reasons = [...new Set(version.gaps.flatMap((gap) => humanGap(gap.reason).split('；')))]
              return reasons.slice(0, 2).join('；')
            })()}
          </Box>
          <Box sx={{ mt: 0.5 }}>说一句「把缺的补上」，它会想办法（必要时现写一个新题型）。</Box>
        </Alert>
      )}

      {/* 卷面：一张纸的样子——标题居中、按题型分节、题号连着走 */}
      <Paper
        data-paper
        elevation={0}
        sx={{
          // 左边距留出 46px 给"这一道"的按钮（Word 的批注按钮也在边距里）；
          // 边距是纸上本来就有的空白，拿它放操作既不占文字宽度、也不遮挡
          py: { xs: 2.5, md: 5 },
          pl: { xs: 3.5, md: 7.5 },
          pr: { xs: 2.5, md: 5 },
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          '& svg': { maxWidth: '100%', height: 'auto' },
        }}
      >
        <PaperHeader paper={paper} totalScore={version.totalScore} count={version.bindings.length} onPatch={onPatchPaper} />

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
                      onRevise={onRevise}
                      onConfirm={onConfirm}
                      onPatchText={onPatchText}
                      onDelete={onDelete}
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
/**
 * **卷面上的"第 N 题"**：题号是按题型分段连着走的（一、选择 1–8；二、填空 9–14…）。
 *
 * 所以"第 3 题"是**视图产物**——界面、agent 说的话、工具参数都得用这一套编号，
 * 界面里永远不出现 S3-1 这种系统编号（这是"术语统一"的一半）。
 */
export function questionNumbers(rows: readonly { binding: SlotBindingView; item: ItemView }[]): ReadonlyMap<string, number> {
  const groups = groupByType(rows)
  const numbers = new Map<string, number>()
  for (const group of groups) {
    const base = numberAfter(groups, group.type)
    group.rows.forEach((row, index) => numbers.set(row.binding.slot, base + index + 1))
  }
  return numbers
}

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
  onRevise,
  onConfirm,
  onPatchText,
  onDelete,
}: {
  number: number
  binding: SlotBindingView
  item: ItemView
  mark: string
  showAnswer: boolean
  busy: boolean
  frozen: boolean
  onRevise: (slotKey: string, item: ItemView) => void
  onConfirm: (itemId: string) => void
  /** 就地改题面（改的是说法；改了数字就得重造——见编辑器里的说明） */
  onPatchText: (itemId: string, stem: string) => Promise<{ ok: boolean; reason?: string; gate?: string }>
  onDelete: (slotKey: string) => void
}): React.JSX.Element {
  const status = statusOf(item, binding)
  const [detail, setDetail] = useState(false)
  const [editing, setEditing] = useState(false)
  const [stem, setStem] = useState(item.stem)
  const [note, setNote] = useState('')
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null)

  const save = async (): Promise<void> => {
    const result = await onPatchText(item.id, stem.trim())
    if (!result.ok) {
      setNote(`${gateLabel(result.gate ?? '')}：${result.reason ?? '没通过'}`)
      return
    }
    setNote('')
    setEditing(false)
  }

  return (
    <Box
      id={`q-${binding.slot}`}
      sx={{
        position: 'relative',
        scrollMarginTop: 16,
        // 悬停时那一排动作**浮在题面右上角**，不占版面：
        // 以前它是 flex 里的一列（宽度常驻），题面被挤成左边一条（用户："题目文字被挤到左边去了"）。
        '&:hover .q-actions': { opacity: 1, pointerEvents: 'auto' },
      }}
    >
      {/* 卷面左侧的题号（真卷子就是这样）：分值跟在题号后 */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography component="span" sx={{ fontWeight: 600, minWidth: 26 }}>
          {number}.
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            // **就地改，没有"编辑模式"**：点一下就改，Ctrl+Enter 保存、Esc 取消
            <Box data-print-hide>
              <TextField
                autoFocus
                fullWidth
                multiline
                minRows={2}
                maxRows={10}
                value={stem}
                onChange={(event) => setStem(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault()
                    void save()
                  }
                  if (event.key === 'Escape') setEditing(false)
                }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                <Button size="small" variant="contained" disableElevation onClick={() => void save()}>
                  保存并检查
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setStem(item.stem)
                    setEditing(false)
                    setNote('')
                  }}
                >
                  取消
                </Button>
                <Typography variant="caption" color="text.secondary">
                  公式照 $…$ 写。改说法随便改；**数字、条件、答案别动**——那等于换了一道题，用「改这一道…」。
                </Typography>
              </Stack>
              {note !== '' && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {note}
                </Alert>
              )}
            </Box>
          ) : (
            <Typography
              component="span"
              onDoubleClick={() => {
                if (frozen) return
                setStem(item.stem)
                setEditing(true)
              }}
              sx={{ fontSize: 15.5, lineHeight: 1.9 }}
            >
              <MathText html={item.stemHtml} />
            </Typography>
          )}
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
                {detail ? '收起体检' : '检查' }
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

        {/*
          **操作放进左边距**（Word 的批注按钮就在这儿）：不占题面宽度、不遮挡文字。
          之前两版都不对——常驻一排会挤窄题面，浮在右上角又会盖住题干；
          边距是纸上本来就有的空白，正好放这些只有老师才用的按钮。
        */}
        <Stack
          className="q-actions"
          data-print-hide
          sx={{
            position: 'absolute',
            left: -40,
            top: -2,
            opacity: 0,
            pointerEvents: 'none',
            transition: 'opacity .12s',
            alignItems: 'center',
            gap: 0.25,
            width: 34,
          }}
        >
          <Tooltip title={`${status.text}｜${status.hint}`}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: status.tone === 'ok' ? 'success.main' : 'warning.main',
              }}
            />
          </Tooltip>
          <Tooltip title="这一道：改文字 / 改这一道 / 换一道 / 删掉">
            <IconButton
              size="small"
              disabled={frozen}
              onClick={(event) => setMenuAt(event.currentTarget)}
              sx={{ p: 0.25 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {mark !== '' && (
            <Tooltip title={mark}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'info.main' }} />
            </Tooltip>
          )}
        </Stack>

        {/* 这一道的菜单：动词都在这儿，卷面上只留一个边距按钮 */}
        <Menu
          anchorEl={menuAt}
          open={menuAt !== null}
          onClose={() => setMenuAt(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <MenuItem disabled sx={{ opacity: '1 !important' }}>
            <Typography variant="caption" color="text.secondary">
              {item.knowledge.join('、') || item.type}｜{String(item.score)} 分｜难度 {formatDifficulty(item.difficulty)}
              ｜{status.text}
              {binding.chosenBy === undefined ? '' : binding.chosenBy === 'agent' ? '｜agent 放的' : '｜我指定的'}
            </Typography>
          </MenuItem>
          <Divider />
          <MenuItem
            disabled={frozen}
            onClick={() => {
              setMenuAt(null)
              setStem(item.stem)
              setEditing(true)
            }}
          >
            改文字（就地改说法）
          </MenuItem>
          <MenuItem
            disabled={frozen}
            onClick={() => {
              setMenuAt(null)
              onRevise(binding.slot, item)
            }}
          >
            改这一道…（说一句要求：换情境、加一问、换一道不一样的，都由它重造）
          </MenuItem>
          {item.lifecycle === 'needs_review' && binding.confirmedBy === null && (
            <MenuItem
              disabled={frozen}
              onClick={() => {
                setMenuAt(null)
                onConfirm(item.id)
              }}
            >
              我确认这道题
            </MenuItem>
          )}
          <Divider />
          <MenuItem
            disabled={frozen}
            onClick={() => {
              setMenuAt(null)
              onDelete(binding.slot)
            }}
          >
            从卷子上拿掉
          </MenuItem>
        </Menu>
      </Stack>
    </Box>
  )
}

/**
 * 卷头：**在纸面上点着改**（卷名、班级、时长、学生填写栏）。
 *
 * 为什么放在文档里而不是只有"设定"对话框里：老师看着卷子的时候才发现"名字不对""少一行姓名"，
 * 这时候让他去翻对话框是反人性的。改完之后写回这一张卷子的设定（不影响别人的卷子）。
 */
function PaperHeader({
  paper,
  totalScore,
  count,
  onPatch,
}: {
  paper: { title: string; minutes: number; className: string; studentFields?: boolean }
  totalScore: number
  count: number
  onPatch: (patch: Partial<{ title: string; minutes: number; className: string; studentFields: boolean }>) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<'title' | 'meta' | null>(null)
  const [title, setTitle] = useState(paper.title)
  const [className, setClassName] = useState(paper.className)
  const [minutes, setMinutes] = useState(String(paper.minutes))

  const commit = (): void => {
    if (editing === 'title') {
      if (title.trim() !== '' && title !== paper.title) onPatch({ title: title.trim() })
    }
    if (editing === 'meta') {
      const next = Number(minutes)
      onPatch({
        ...(className === paper.className ? {} : { className }),
        ...(Number.isFinite(next) && next > 0 && next !== paper.minutes ? { minutes: next } : {}),
      })
    }
    setEditing(null)
  }

  if (editing === 'title') {
    return (
      <Box sx={{ textAlign: 'center', mb: 3 }} data-print-hide>
        <TextField
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setTitle(paper.title)
              setEditing(null)
            }
          }}
          sx={{ width: '70%', '& input': { textAlign: 'center', fontSize: 20, fontWeight: 700 } }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          这就是卷子最上面那行名字
        </Typography>
      </Box>
    )
  }

  if (editing === 'meta') {
    return (
      <Box data-print-hide sx={{ textAlign: 'center', mb: 3 }}>
        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            autoFocus
            size="small"
            label="班级"
            value={className}
            onChange={(event) => setClassName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(null)
            }}
            sx={{ width: 150 }}
          />
          <TextField
            size="small"
            label="时长（分钟）"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') setEditing(null)
            }}
            sx={{ width: 130 }}
          />
          <Button size="small" variant="contained" disableElevation onClick={commit}>
            好了
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          满分 {String(totalScore)} 分由每道题的分值加起来，不用填
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Tooltip title="点一下改卷名">
        <Typography
          onClick={() => {
            setTitle(paper.title)
            setEditing('title')
          }}
          sx={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.04em', cursor: 'text', '&:hover': { bgcolor: 'action.hover' } }}
        >
          {paper.title}
        </Typography>
      </Tooltip>
      <Tooltip title="点一下改班级与时长">
        <Typography
          onClick={() => {
            setClassName(paper.className)
            setMinutes(String(paper.minutes))
            setEditing('meta')
          }}
          variant="caption"
          color="text.secondary"
          sx={{ display: 'inline-block', mt: 0.5, cursor: 'text', '&:hover': { bgcolor: 'action.hover' } }}
        >
          {paper.className === '' ? '（没写班级）' : paper.className}　满分 {String(totalScore)} 分　时间{' '}
          {String(paper.minutes)} 分钟　共 {String(count)} 题
        </Typography>
      </Tooltip>
      {paper.studentFields !== false && (
        <Typography sx={{ display: 'block', mt: 1.5, fontSize: 14, letterSpacing: '0.1em' }}>
          学校：＿＿＿＿＿＿　班级：＿＿＿＿＿＿　姓名：＿＿＿＿＿＿　学号：＿＿＿＿＿＿
        </Typography>
      )}
      <Tooltip title={paper.studentFields === false ? '加上"学校/班级/姓名"那一行' : '去掉学生填写那一行'}>
        <Button
          size="small"
          data-print-hide
          sx={{ mt: 0.5, opacity: 0.5, '&:hover': { opacity: 1 } }}
          onClick={() => onPatch({ studentFields: paper.studentFields === false })}
        >
          {paper.studentFields === false ? '加学生填写栏' : '去掉学生填写栏'}
        </Button>
      </Tooltip>
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
                还没有已学知识点——这份卷子的设定里换个范围试试。
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
