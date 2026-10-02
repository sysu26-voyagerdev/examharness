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
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
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

function collapseRepeats(entries: readonly LogEntryView[]): readonly LogEntryView[] {
  const out: LogEntryView[] = []
  for (const entry of entries) {
    const last = out.at(-1)
    if (last !== undefined && entry.kind !== 'user' && last.kind === entry.kind && last.tool === entry.tool && last.text === entry.text) {
      last.repeat = (last.repeat ?? 1) + 1
      continue
    }
    out.push({ ...entry })
  }
  return out
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

function statusOf(item: ItemView, binding: SlotBindingView): { text: string; color: 'success' | 'warning' } {
  if (binding.confirmedBy !== null) return { text: `${binding.confirmedBy} 已确认`, color: 'success' }
  const failed = Object.entries(item.evidence).filter(([, value]) => !value.pass)
  if (failed.length > 0 || item.lifecycle === 'needs_review') return { text: '需要确认', color: 'warning' }
  return { text: '通过检查', color: 'success' }
}

function changeMark(change: SlotChangeView | undefined): string {
  if (change === undefined || change.change === 'same') return ''
  return change.change === 'replaced' ? '这一版换过' : change.change === 'added' ? '这一版新增' : '这一版移除'
}

export function PaperView({
  version,
  rows,
  changes,
  frozen,
  viewingOld,
  busy,
  bankSize,
  onRegenerate,
  onConfirm,
  onAssemble,
  onSyncHeader,
}: {
  version: VersionView | undefined
  bankSize: number
  onSyncHeader: (totalScore: number) => void
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  changes: readonly SlotChangeView[]
  frozen: boolean
  viewingOld: boolean
  busy: boolean
  onRegenerate: (slotKey: string) => void
  onConfirm: (itemId: string) => void
  onAssemble: () => void
}): React.JSX.Element {
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
              ? '题库还是空的：先让 agent 出题，题目会先过一遍检查再入库。'
              : `题库里已经有 ${String(bankSize)} 道题。按蓝图组卷，把够格的题排成一份卷子。`}
        </Typography>
        <Button variant="contained" disabled={busy || frozen} onClick={onAssemble}>
          按蓝图出一份
        </Button>
      </Box>
    )
  }

  return (
    <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6">第 {version.version} 版</Typography>
        <Chip label={`满分 ${String(version.totalScore)}`} color="primary" variant="outlined" />
        <Chip label={`${String(version.bindings.length)} 道题`} variant="outlined" />
        {viewingOld && <Chip label="在看旧版本" color="warning" />}
      </Stack>

      {version.scoreGap > 0 && (
        <Alert
          severity="warning"
          icon={<ReportOutlinedIcon />}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() =>
                void onSyncHeader(version.totalScore)
              }
            >
              卷头改成 {String(version.totalScore)} 分
            </Button>
          }
        >
          这份卷子 {String(version.totalScore)} 分，蓝图卷头写的是更多分（差 {String(version.scoreGap)} 分）。
        </Alert>
      )}

      {version.gaps.length > 0 && (
        <Alert severity="warning" icon={<ReportOutlinedIcon />}>
          有 {version.gaps.length} 个题位没凑齐：{version.gaps.map((gap) => `${gap.slot}（${gap.reason}）`).join('；')}
        </Alert>
      )}

      {rows.map(({ binding, item }, index) => (
        <QuestionCard
          key={binding.slot}
          index={index}
          binding={binding}
          item={item}
          mark={changeMark(changes.find((change) => change.slot === binding.slot))}
          busy={busy}
          frozen={frozen}
          onRegenerate={onRegenerate}
          onConfirm={onConfirm}
        />
      ))}

      <Card variant="outlined">
        <CardActions>
          <Button variant="contained" disabled={busy || frozen} onClick={onAssemble}>
            再出一版
          </Button>
          {frozen && <Chip label="已定稿" color="warning" sx={{ ml: 1 }} />}
        </CardActions>
      </Card>
    </Stack>
  )
}

function QuestionCard({
  index,
  binding,
  item,
  mark,
  busy,
  frozen,
  onRegenerate,
  onConfirm,
}: {
  index: number
  binding: SlotBindingView
  item: ItemView
  mark: string
  busy: boolean
  frozen: boolean
  onRegenerate: (slotKey: string) => void
  onConfirm: (itemId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const status = statusOf(item, binding)

  return (
    <Card>
      <CardHeader
        avatar={<Avatar sx={{ bgcolor: 'primary.main' }}>{index + 1}</Avatar>}
        title={`${item.type}　${String(item.score)} 分`}
        subheader={item.knowledge.join('、')}
        action={<Chip label={status.text} color={status.color} />}
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          {item.difficulty !== undefined && <Chip size="small" variant="outlined" label={`难度 ${String(item.difficulty[0])}–${String(item.difficulty[1])}`} />}
          {mark !== '' && <Chip size="small" color="info" label={mark} />}
          <Tooltip title={`完整编号 ${item.id}`}>
            <Chip size="small" variant="outlined" label={item.id.slice(-8)} sx={{ fontFamily: 'monospace' }} />
          </Tooltip>
        </Stack>

        <Typography variant="body1">
          {/* 数学写在题面里（$…$，服务端渲染好）：不再单独摆一块公式 */}
          <MathText html={item.stemHtml} />
        </Typography>
        {item.figure !== '' && (
          <Box
            sx={{ my: 1.5, textAlign: 'center', '& svg': { maxWidth: '100%', height: 'auto' } }}
            dangerouslySetInnerHTML={{ __html: item.figure }}
          />
        )}

        <Collapse in={open} unmountOnExit>
          <Box sx={{ mt: 1.5, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              答案
            </Typography>
            <Typography variant="body1">
              <MathText html={item.answerHtml} />
            </Typography>
            <Box component="ol" sx={{ pl: 2.5, my: 1.5 }}>
              {item.solutionHtml.map((step, stepIndex) => (
                <Box component="li" key={stepIndex} sx={{ mb: 1 }}>
                  <Typography variant="body2">
                    <MathText html={step} />
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              检查结果：{Object.entries(item.evidence).map(([gate, value]) => `${gate} ${value.pass ? '通过' : '没通过'}`).join('　')}
              {Object.keys(item.evidence).length === 0 ? '（还没有记录）' : ''}
            </Typography>
          </Box>
        </Collapse>
      </CardContent>
      <CardActions>
        <Button size="small" onClick={() => setOpen((previous) => !previous)}>
          {open ? '收起答案' : '答案与解析'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" disabled={busy || frozen} onClick={() => onRegenerate(binding.slot)}>
          换一道
        </Button>
        {item.lifecycle === 'needs_review' && binding.confirmedBy === null && (
          <Button size="small" variant="contained" disabled={busy || frozen} onClick={() => onConfirm(item.id)}>
            确认这道
          </Button>
        )}
      </CardActions>
    </Card>
  )
}

/* ─────────────── 知识点 ─────────────── */

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
                    <Typography variant="body2">{gate}</Typography>
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
