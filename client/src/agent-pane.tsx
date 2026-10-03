import { useEffect, useMemo, useState } from 'react'
import SendIcon from '@mui/icons-material/Send'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Timeline } from './components.js'
import type { LogEntryView, RunAgentView } from './types.js'

/**
 * agent 栏：**看得见、插得进、不挡人**。
 *
 * 三块，从上到下：
 *   1. **状态行**：在做还是空闲、正在干什么、多久了、第几步——一眼的事实，没有转圈动画；
 *   2. **记录**：DSH 式分块（正在跑的展开，过去的折成一行），可滚动；
 *   3. **实时区**：固定高度、浅字，永远显示"最后几条输出"——
 *      不用翻记录也能看到它此刻在做什么（用户："最好能实时浅字看到最后几个输出，固定长度"）。
 *
 * 输入框**任何时候都能用**：它空闲就开一轮，它正忙就把话插进去（下一步生效）。
 * agent 不该把老师锁在一边。
 */

/** 每秒跳一次的时钟：只为了"已 n 秒"是活的 */
function useSeconds(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [since])
  return since === undefined ? 0 : Math.max(0, Math.round((now - since) / 1000))
}

/** 实时区：最后几条输出，固定高度（浅字，不抢注意力） */
const TICKER_LINES = 3

/** 把正在流出来的字切成最后三行（太长就截，保持固定高度） */
function streamText(stream: { label: string; text: string } | null): readonly string[] {
  if (stream === null) return []
  const lines = stream.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return []
  return lines.slice(-TICKER_LINES).map((line) => (line.length > 160 ? `${line.slice(-160)}` : line))
}

export function AgentPane({
  entries,
  running,
  doing,
  stream,
  translate,
  onExample,
  onStop,
}: {
  entries: readonly LogEntryView[]
  running: RunAgentView | null
  doing: { what: string; agent: string; at: number } | null
  /** 模型此刻正在写的内容（流式） */
  stream: { label: string; text: string; at: number } | null
  translate: (text: string) => string
  onExample: (example: string) => void
  onStop: () => void
}): React.JSX.Element {
  const seconds = useSeconds(running === null ? undefined : (doing?.at ?? Date.now()))
  const recent = useMemo(() => {
    const tail = entries.slice(-TICKER_LINES * 2)
    const lines: string[] = []
    for (const entry of tail) {
      const text = translate(entry.text)
      const first = (text.split('\n')[0] ?? '').trim()
      if (first === '') continue
      lines.push(first.length > 150 ? `${first.slice(0, 150)}…` : first)
    }
    return lines.slice(-TICKER_LINES)
  }, [entries, translate])

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      {/* 状态行：一眼的事实（在做/空闲、在干什么、多久、第几步、按停） */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
        data-print-hide
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: running === null ? 'text.disabled' : 'primary.main',
          }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {running === null ? '空闲' : '在做'}
        </Typography>
        {running !== null && (
          <>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
              {doing === null ? '想事情' : doing.what}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {String(Math.floor(seconds / 60))}:{String(seconds % 60).padStart(2, '0')} · {String(running.steps)} 步
            </Typography>
            <Button size="small" startIcon={<StopCircleOutlinedIcon />} onClick={() => onStop()}>
              按停
            </Button>
          </>
        )}
        {running === null && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
            说一句就行
          </Typography>
        )}
      </Stack>

      {/* 记录：分块（正在跑的展开，过去的折一行），自己滚 */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Timeline
          entries={entries}
          running={running !== null}
          {...(running === null ? {} : { runningId: running.id })}
          translate={translate}
          onExample={onExample}
        />
      </Box>

      {/* 实时区：固定高度、浅字——不用翻记录也能看到它此刻在做什么 */}
      <Box
        data-print-hide
        sx={{
          px: 1.5,
          py: 0.75,
          height: 68,
          flexShrink: 0,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        {/* **模型正在写的字**（流式）：固定高度、浅字，最后三行——它每一秒都在动，
            老师不用翻记录也知道它在写什么（用户："要能实时浅字看到 llm 的流式输出"） */}
        {(() => {
          const live = streamText(stream)
          if (live.length > 0) {
            return live.map((line, index) => (
              <Typography
                key={`live-${String(index)}-${line.slice(0, 10)}`}
                variant="caption"
                noWrap
                sx={{
                  display: 'block',
                  lineHeight: 1.6,
                  fontStyle: 'italic',
                  color: index === live.length - 1 ? 'text.secondary' : 'text.disabled',
                }}
              >
                {index === 0 ? `${stream?.label ?? '它'}：` : ''}
                {line}
              </Typography>
            ))
          }
          if (recent.length === 0) {
            return (
              <Typography variant="caption" color="text.disabled">
                还没开始
              </Typography>
            )
          }
          return recent.map((line, index) => (
            <Typography
              key={`${String(index)}-${line.slice(0, 12)}`}
              variant="caption"
              noWrap
              sx={{
                display: 'block',
                lineHeight: 1.6,
                color: index === recent.length - 1 ? 'text.secondary' : 'text.disabled',
              }}
            >
              {index === recent.length - 1 ? '› ' : '· '}
              {line}
            </Typography>
          ))
        })()}
      </Box>
    </Box>
  )
}

/** 输入框：**任何时候都能用**（它忙就把话插进去） */
export function AgentComposer({
  draft,
  onDraft,
  onSend,
  running,
  elsewhere,
}: {
  draft: string
  onDraft: (text: string) => void
  onSend: () => void
  running: RunAgentView | null
  elsewhere: readonly RunAgentView[]
}): React.JSX.Element {
  return (
    <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }} data-print-hide>
      {elsewhere.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          别的出题也在跑（{elsewhere.map((run) => run.label ?? run.goal.slice(0, 10)).join('、')}）——这里不受影响。
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={5}
          size="small"
          value={draft}
          placeholder={
            running === null
              ? '说一句你要什么——例如「再加一道圆的，4 分」「第 3 题换个情境」'
              : '它正在忙：说一句会插进去，下一步就看得见'
          }
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <IconButton color="primary" disabled={draft.trim() === ''} onClick={onSend}>
          <SendIcon />
        </IconButton>
      </Stack>
      {running !== null && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
          <Chip size="small" color="primary" variant="outlined" label="它在做别的" />
          <Typography variant="caption" color="text.secondary">
            这时说的会插进去（下一步生效），不用等它
          </Typography>
        </Stack>
      )}
      <Divider sx={{ mt: 1, mb: 0, borderStyle: 'dashed' }} />
    </Box>
  )
}
