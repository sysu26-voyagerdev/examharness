import { useEffect, useRef, useState } from 'react'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import PersonOutlinedIcon from '@mui/icons-material/PersonOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { useApp } from './app-context.js'
import { MathText } from './math-text.js'
import { splitStep } from './log.js'
import type { ItemView, KnowledgeView, LogEntryView, SlotBindingView, SlotChangeView, TexView, VersionView } from './types.js'

/**
 * 页面里复用的几块内容：会话记录、试卷、知识点、依据、文件。
 *
 * 一条规矩：**服务端算什么，这里就显示什么**。数学是服务端渲染好的 MathML，
 * 图是服务端按 spec 画的 SVG，证据是闸门自己写的判定——界面不重算、不猜、不美化。
 */

/**
 * 一行/一列：Box 加几个常用的 flex 属性。
 * MUI 的 Stack 只认 direction/spacing，对齐与换行得走 sx——用起来啰嗦，还容易写错。
 */
export function Flex({
  row = false,
  gap = 0,
  align,
  justify,
  wrap = false,
  sx,
  children,
  ...rest
}: {
  row?: boolean
  gap?: number
  align?: React.CSSProperties['alignItems']
  justify?: React.CSSProperties['justifyContent']
  wrap?: boolean
  sx?: object
  children?: React.ReactNode
} & Omit<React.ComponentProps<typeof Box>, 'sx' | 'children'>): React.JSX.Element {
  return (
    <Box
      {...rest}
      sx={{
        display: 'flex',
        flexDirection: row ? 'row' : 'column',
        gap: `${String(gap * 8)}px`,
        alignItems: align,
        justifyContent: justify,
        flexWrap: wrap ? 'wrap' : undefined,
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

/* ────────────────────────── 会话记录 ────────────────────────── */

const STEP_ICON = {
  user: <PersonOutlinedIcon fontSize="small" />,
  assistant: <AutoAwesomeOutlinedIcon fontSize="small" />,
  tool: <BuildOutlinedIcon fontSize="small" />,
  gate: <CheckCircleOutlinedIcon fontSize="small" />,
  verdict: <CheckCircleOutlinedIcon fontSize="small" />,
} as const

export function Timeline({ entries, running }: { entries: readonly LogEntryView[]; running: boolean }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  // 只在"本来就在底部"时才跟着滚：不跟用户抢滚动条，也不做花哨的动画
  useEffect(() => {
    const box = boxRef.current
    if (box !== null) {
      const distance = box.scrollHeight - box.scrollTop - box.clientHeight
      stickRef.current = distance < 80
    }
    if (stickRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <Box sx={{ px: 3, py: 6, maxWidth: 520, mx: 'auto' }}>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.9 }}>
          还没有内容。
          <br />
          说一句你想要什么样的卷子就能开始——例如「初三(2)班，二次函数最值，一道大题两道小题」。
        </Typography>
      </Box>
    )
  }

  return (
    <Box ref={boxRef} sx={{ overflowY: 'auto', height: '100%', px: 3, py: 2 }}>
      <Flex gap={0.25} sx={{ maxWidth: 680, mx: 'auto' }}>
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} />
        ))}
        {running && (
          <Flex row gap={1} align="center" sx={{ pl: 1, pt: 1, color: 'text.secondary' }}>
            <CircularProgress size={12} thickness={5} />
            <Typography variant="caption">正在做…（可以直接说一句，它下一步会看到）</Typography>
          </Flex>
        )}
      </Flex>
      <div ref={endRef} />
    </Box>
  )
}

function Row({ entry }: { entry: LogEntryView }): React.JSX.Element {
  if (entry.kind === 'user') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', py: 0.75 }}>
        <Paper
          variant="outlined"
          sx={{ px: 1.75, py: 1, maxWidth: '82%', borderRadius: 3, bgcolor: 'action.hover', borderColor: 'transparent' }}
        >
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
            {entry.text}
          </Typography>
        </Paper>
      </Box>
    )
  }

  const { label, detail } = entry.kind === 'tool' ? splitStep(entry.text) : { label: '', detail: entry.text }
  const bad = entry.kind === 'gate' && /没通过|失败|拦下|不一致|过于相似|读不了|不能|还缺/.test(entry.text)
  const tone = bad ? 'error.main' : entry.kind === 'verdict' ? 'success.main' : 'text.secondary'

  return (
    <Flex row gap={1.25} align="flex-start" sx={{ py: 0.5, pl: 1 }}>
      <Box sx={{ color: tone, display: 'flex', pt: '3px' }}>
        {bad ? <ErrorOutlinedIcon fontSize="small" /> : STEP_ICON[entry.kind]}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {label !== '' && (
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled' }}>
            {label}
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: bad ? 'error.main' : 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {detail}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.disabled', whiteSpace: 'nowrap', pt: '3px' }}>
        {new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </Typography>
    </Flex>
  )
}

/* ────────────────────────── 试卷 ────────────────────────── */

function statusOf(item: ItemView, binding: SlotBindingView): { text: string; color: 'success' | 'warning' } {
  if (binding.confirmedBy !== null) return { text: `${binding.confirmedBy} 已确认`, color: 'success' }
  const failed = Object.entries(item.evidence).filter(([, value]) => !value.pass)
  if (failed.length > 0 || item.lifecycle === 'needs_review') return { text: '需要你确认', color: 'warning' }
  return { text: '通过', color: 'success' }
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
  onRegenerate,
  onConfirm,
  onAssemble,
}: {
  version: VersionView | undefined
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
      <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          还没有试卷。
        </Typography>
        <Button variant="contained" disabled={busy || frozen} onClick={onAssemble} sx={{ mb: 1 }}>
          按蓝图出一份
        </Button>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {frozen ? '这份卷子已经定稿，不能再改。' : '题目由构造产生，每道题都会先过一遍检查。'}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Flex gap={1.5} sx={{ maxWidth: 720, mx: 'auto' }}>
        <Flex row gap={1} align="center" wrap>
          <Typography variant="h3">第 {version.version} 版</Typography>
          <Typography variant="caption">
            满分 {version.totalScore}　{version.bindings.length} 道题
          </Typography>
          {viewingOld && <Chip size="small" variant="outlined" label="在看旧版本" />}
        </Flex>

        {version.gaps.length > 0 && (
          <Alert severity="warning" variant="outlined">
            有 {version.gaps.length} 个题位没凑齐：
            {version.gaps.map((gap) => `${gap.slot}（${gap.reason}）`).join('；')}
          </Alert>
        )}

        {rows.map(({ binding, item }, index) => {
          const status = statusOf(item, binding)
          const mark = changeMark(changes.find((change) => change.slot === binding.slot))
          return (
            <Paper key={binding.slot} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Flex row gap={1} align="center" wrap sx={{ mb: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{index + 1}</Typography>
                <Typography variant="caption">
                  {item.type}　{item.score} 分　{item.knowledge.join('、')}
                </Typography>
                {item.difficulty !== undefined && (
                  <Typography variant="caption">难度 {item.difficulty[0]}–{item.difficulty[1]}</Typography>
                )}
                {mark !== '' && <Chip size="small" variant="outlined" label={mark} />}
                <Box sx={{ flex: 1 }} />
                <Chip size="small" variant="outlined" color={status.color} label={status.text} />
              </Flex>

              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                <MathText html={item.stemHtml} />
              </Typography>

              {item.tex?.stemMath !== undefined && (
                <Box sx={{ my: 1, overflowX: 'auto' }}>
                  <MathText display html={item.tex.stemMath} />
                </Box>
              )}

              {item.figure !== '' && (
                // 图是服务端按 spec 画的；界面只显示，不解析、不重画
                <Box sx={{ my: 1.5, '& svg': { maxWidth: '100%', height: 'auto' } }} dangerouslySetInnerHTML={{ __html: item.figure }} />
              )}

              <AnswerBlock item={item} />

              <Flex row gap={1} align="center" sx={{ mt: 1.5 }} wrap>
                <Button size="small" disabled={busy || frozen || version === undefined} onClick={() => onRegenerate(binding.slot)}>
                  换一道
                </Button>
                {item.lifecycle === 'needs_review' && binding.confirmedBy === null && (
                  <Button size="small" variant="contained" disabled={busy || frozen} onClick={() => onConfirm(item.id)}>
                    确认这道
                  </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {item.id}
                </Typography>
              </Flex>
            </Paper>
          )
        })}

        <Flex row gap={1}>
          <Button variant="outlined" disabled={busy || frozen} onClick={onAssemble}>
            {version === undefined ? '按蓝图出一份' : '再出一版'}
          </Button>
          {frozen && <Typography variant="caption" sx={{ alignSelf: 'center' }}>已定稿</Typography>}
        </Flex>
      </Flex>
    </Box>
  )
}

function AnswerBlock({ item }: { item: ItemView }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const solutionTex: TexView['solution'] = item.tex?.solution ?? []
  return (
    <>
      <Button size="small" onClick={() => setOpen((value) => !value)} sx={{ mt: 1 }}>
        {open ? '收起答案' : '答案与解析'}
      </Button>
      {open && (
        <Box sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            答案
          </Typography>
          <Typography variant="body1">
            <MathText html={item.answerHtml} />
          </Typography>
          {item.tex?.answerMath !== undefined && (
            <Box sx={{ my: 1, overflowX: 'auto' }}>
              <MathText display html={item.tex.answerMath} />
            </Box>
          )}
          <Box component="ol" sx={{ pl: 2.5, my: 1 }}>
            {item.solutionHtml.map((step, index) => (
              <Box component="li" key={index} sx={{ mb: 0.5 }}>
                <Typography variant="body2">
                  <MathText html={step} />
                </Typography>
                {solutionTex[index] !== undefined && (
                  <Box sx={{ overflowX: 'auto' }}>
                    <MathText display html={solutionTex[index]?.math ?? ''} />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
            检查结果：
            {Object.entries(item.evidence)
              .map(([gate, value]) => `${gate} ${value.pass ? '通过' : '没通过'}`)
              .join('　')}
            {Object.keys(item.evidence).length === 0 ? '（还没有记录）' : ''}
          </Typography>
        </Box>
      )}
    </>
  )
}

/* ────────────────────────── 知识点 ────────────────────────── */

export function KnowledgeView({ knowledge, items }: { knowledge: KnowledgeView; items: readonly ItemView[] }): React.JSX.Element {
  const used = new Map<string, number>()
  for (const item of items) {
    for (const key of item.knowledge) used.set(key, (used.get(key) ?? 0) + 1)
  }
  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Flex gap={2} sx={{ maxWidth: 620, mx: 'auto' }}>
        <Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            这一卷用到的
          </Typography>
          <Flex row gap={0.75} wrap>
            {knowledge.learned.length === 0 ? (
              <Typography variant="caption">还没有学过任何知识点。在设置的蓝图里选。</Typography>
            ) : (
              knowledge.learned.map((key) => (
                <Chip
                  key={key}
                  size="small"
                  variant={used.has(key) ? 'filled' : 'outlined'}
                  label={used.has(key) ? `${key} · ${String(used.get(key) ?? 0)}` : key}
                />
              ))
            )}
          </Flex>
        </Box>
        <Divider />
        <Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            知识点之间的关系
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            括号里是它的前置知识。
          </Typography>
          <Flex gap={0.5}>
            {knowledge.nodes
              .filter((node) => node.prerequisites.length > 0)
              .map((node) => (
                <Typography key={node.key} variant="body2">
                  {node.key}
                  <Typography component="span" variant="caption">
                    　← {node.prerequisites.join('、')}
                  </Typography>
                </Typography>
              ))}
          </Flex>
        </Box>
      </Flex>
    </Box>
  )
}

/* ────────────────────────── 依据 ────────────────────────── */

export function EvidenceView({
  rows,
  versions,
}: {
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  versions: readonly VersionView[]
}): React.JSX.Element {
  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Flex gap={2} sx={{ maxWidth: 720, mx: 'auto' }}>
        <Typography variant="caption">
          每道题为什么算通过：这些结论是检查程序写的，不是模型说的。
        </Typography>
        {rows.length === 0 && <Typography variant="body2" color="text.secondary">还没有题目。</Typography>}
        {rows.map(({ binding, item }) => (
          <Box key={binding.slot}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              第 {binding.slot} 题　{item.type}　{item.score} 分
            </Typography>
            <Flex gap={0.5}>
              {Object.entries(item.evidence).map(([gate, value]) => (
                <Flex key={gate} row gap={1} align="flex-start">
                  <Chip size="small" variant="outlined" color={value.pass ? 'success' : 'error'} label={value.pass ? '通过' : '没通过'} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{gate}</Typography>
                    {value.detail !== undefined && <Typography variant="caption">{value.detail}</Typography>}
                  </Box>
                </Flex>
              ))}
              {item.confirmedBy != null && (
                <Typography variant="caption">
                  {item.confirmedBy} 在 {new Date(item.confirmedAt ?? '').toLocaleString('zh-CN')} 确认过
                </Typography>
              )}
            </Flex>
          </Box>
        ))}

        {versions.length > 1 && (
          <>
            <Divider />
            <Box>
              <Typography variant="h3" sx={{ mb: 0.5 }}>
                版本
              </Typography>
              {versions.map((version) => (
                <Typography key={version.version} variant="body2">
                  第 {version.version} 版　{new Date(version.at).toLocaleString('zh-CN')}　{version.reason}　试了 {version.attempts} 次
                </Typography>
              ))}
            </Box>
          </>
        )}
      </Flex>
    </Box>
  )
}

/* ────────────────────────── 文件（agent 的工作区） ────────────────────────── */

export function FilesView({ name, tick }: { name: string; tick: number }): React.JSX.Element {
  const { busy, guard } = useApp()
  const [view, setView] = useState<Awaited<ReturnType<typeof api.getWorkspace>> | null>(null)
  const [file, setFile] = useState('')
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (name === '') return
    void api
      .getWorkspace(name)
      .then((next) => {
        setView(next)
        setFile((current) => {
          if (current !== '' && next.files.some((entry) => entry.path === current)) return current
          return next.files[0]?.path ?? ''
        })
      })
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

  if (name === '') return <Empty text="这个会话还没有工作区。" />
  const files = view?.files ?? []
  if (files.length === 0) {
    return <Empty text="agent 还没有在这里放过文件。它读原件、写脚本、跑出来的东西都会留在这里。" />
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Flex gap={1.5} sx={{ maxWidth: 720, mx: 'auto' }}>
        <Flex row gap={1} align="center" wrap>
          <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.disabled' }} />
          <Typography variant="body2">{files.length} 个文件</Typography>
          {view?.venv == null && (
            <Tooltip title="处理 PDF、Word、Excel 需要它：在仓库根跑 pnpm venv">
              <Chip size="small" variant="outlined" color="warning" label="还没建虚拟环境" />
            </Tooltip>
          )}
        </Flex>
        <Flex row gap={0.75} wrap>
          {files.map((entry) => (
            <Chip
              key={entry.path}
              size="small"
              variant={entry.path === file ? 'filled' : 'outlined'}
              label={entry.path}
              onClick={() => setFile(entry.path)}
              sx={{ cursor: 'pointer', fontFamily: 'monospace' }}
            />
          ))}
        </Flex>

        {chunk === null ? (
          <Typography variant="caption">这个文件不是文本（比如 PDF、图片），用「试卷」里的内容看结果。</Typography>
        ) : (
          <>
            <Paper variant="outlined" sx={{ p: 1.5, maxHeight: 340, overflow: 'auto', borderRadius: 2 }}>
              <Typography variant="caption" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                {chunk.text}
              </Typography>
            </Paper>
            <Flex row gap={1} align="center">
              <Typography variant="caption">
                {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                disabled={busy !== '' || offset === 0}
                onClick={() => void guard('files', async () => setChunk(await api.readWorkspaceFile(name, file, Math.max(0, offset - 4000))))}
              >
                上一段
              </Button>
              <Button
                size="small"
                disabled={busy !== '' || chunk.next === undefined}
                onClick={() => void guard('files', async () => setChunk(await api.readWorkspaceFile(name, file, chunk.next ?? offset)))}
              >
                下一段
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </Box>
  )
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <Box sx={{ px: 3, py: 6, maxWidth: 520, mx: 'auto' }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  )
}
