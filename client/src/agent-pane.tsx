import { useEffect, useRef, useState } from 'react'
import SendIcon from '@mui/icons-material/Send'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { Timeline } from './components.js'
import { toolLabel } from './log.js'
import type { LogEntryView, RunAgentView, RunDoneView, StreamView } from './types.js'

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

/** 整轮用时（分:秒） */
function clock(since: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

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

export function AgentPane({
  entries,
  running,
  doing,
  stream,
  lastStop,
  stopping,
  translate,
  onExample,
  onStop,
}: {
  entries: readonly LogEntryView[]
  running: RunAgentView | null
  doing: { what: string; agent: string; at: number } | null
  /** 模型写出来的字（流式）：底部那一块浅字显示它的尾巴 */
  stream: StreamView | null
  /** 上一轮怎么结束的（出错就要说出来，别让记录一滚就没人知道） */
  lastStop: RunDoneView | null
  /** 叫停已经发出去了（这一步之后停） */
  stopping: boolean
  translate: (text: string) => string
  onExample: (example: string) => void
  onStop: () => void
}): React.JSX.Element {
  // 计时用**整轮**起点：以前用"当前工具的开始时间"，每换一个工具就跳回 0:00（看着像卡住）
  const elapsed = useSeconds(running?.since)
  const stepSeconds = useSeconds(doing?.at)
  const writing = stream !== null && stream.live
  /**
   * 流的尾巴：**贴着底往下滚**——它不是"看历史"的地方，是"看它此刻在写什么"的地方。
   * 但老师自己往上翻的时候就别再拽他下去（松手的意思是"我在看这里"），
   * 那时右上角给一个"回到最新"，点一下继续跟着滚。
   */
  const tailRef = useRef<HTMLDivElement | null>(null)
  const tailStuck = useRef(true)
  const [tailFree, setTailFree] = useState(false)
  const followTail = (): void => {
    const box = tailRef.current
    if (box === null) return
    box.scrollTop = box.scrollHeight
    tailStuck.current = true
    setTailFree(false)
  }
  useEffect(() => {
    const box = tailRef.current
    if (box !== null && tailStuck.current) box.scrollTop = box.scrollHeight
  }, [stream?.text])

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      {/* 状态行：一眼的事实（在做/空闲、在干什么、多久、第几步、叫停） */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}
        data-print-hide
        data-agent="status"
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
              {doing !== null
                ? `${toolLabel(doing.what) || '做一步'}（${String(stepSeconds)} 秒）`
                : writing
                  ? '在写字'
                  : '在想下一步'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {/* 计时用整轮起点；服务端不报开始时间时（刷新后重新接手）**不编一个 0:00**，只报第几步 */}
              {running.since === undefined ? '' : `整轮 ${clock(running.since)} · `}
              {String(running.steps)} 步
            </Typography>
            <Tooltip title="让它在这一步之后停下——已经做完的留着">
              <span>
                <Button
                  size="small"
                  disabled={stopping}
                  startIcon={<StopCircleOutlinedIcon />}
                  onClick={() => onStop()}
                >
                  {stopping ? '正在停…' : '叫停'}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {running === null && (
          <Typography
            variant="caption"
            color={lastStop === 'error' ? 'error.main' : 'text.secondary'}
            sx={{ flex: 1, minWidth: 0 }}
            noWrap
          >
            {lastStop === 'error'
              ? '上一轮出错了，停下了——翻记录看最后一行'
              : lastStop === 'no-llm'
                ? '上一轮没跑起来：模型还没配好'
                : '说一句就行'}
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

      {/* **模型写出来的字**：这一块是"它正在说的那句话"的尾巴——
          它在写就滚着往下长；它没写（模型在想、工具在跑）就静静摆着刚才那句。
          模型还没吐字时这一块**不存在**（不摆一个空框子假装在工作）。
          （用户："显示的是 LLM 的实时流的末尾，所以应该是持续滚动的，而不是解析出的步骤"） */}
      {stream !== null && stream.text.trim() !== '' && (
        <Box
          data-print-hide
          data-agent="stream"
          sx={{
            px: 1.5,
            py: 0.75,
            height: 76,
            flexShrink: 0,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            overflow: 'hidden',
            display: 'flex',
            gap: 0.75,
          }}
        >
          <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap', pt: 0.1 }}>
            {stream.live ? '它在写…' : '它刚才写的'}
          </Typography>
          {tailFree && (
            <Button
              size="small"
              onClick={followTail}
              sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 12, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
            >
              回到最新
            </Button>
          )}
          <Box
            ref={tailRef}
            onScroll={() => {
              const box = tailRef.current
              if (box === null) return
              const free = box.scrollHeight - box.scrollTop - box.clientHeight > 8
              tailStuck.current = !free
              setTailFree(free)
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              '&::-webkit-scrollbar': { width: 4 },
            }}
          >
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                lineHeight: 1.6,
                color: 'text.secondary',
              }}
            >
              {stream.text}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}

/**
 * 输入框：**任何时候都能用**——它空闲就开一轮，它正忙就把话插进去（下一步生效）。
 *
 * 三条踩过的坑：
 *   · 中文输入法里按回车是**选词**，不是发送：以前这里不认 `isComposing`，
 *     打到一半按回车，半句话就发出去了；
 *   · 空输入按回车**会开一整轮**（外面把空话当成"按设定出一份卷子"）：按钮灰着、回车却能过，
 *     老师一不留神就发起一轮。现在两边都不认空话；
 *   · 插进去的话**没有回执**：输入框清空了，记录里要等它下一步读到才出现，
 *     中间那几十秒像是什么都没发生。
 */
export function AgentComposer({
  draft,
  onDraft,
  onSend,
  running,
  elsewhere,
  pending,
}: {
  draft: string
  onDraft: (text: string) => void
  onSend: () => void
  running: RunAgentView | null
  elsewhere: readonly RunAgentView[]
  /** 刚插进去、还没被读到的那句话（有就显示一行回执） */
  pending: string
}): React.JSX.Element {
  const canSend = draft.trim() !== ''
  return (
    <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }} data-print-hide data-agent="composer">
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
              : '它正在忙：这句话会插进去，它下一步就动手'
          }
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            // 输入法正在组词时回车是"选字"，不是"发送"
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (canSend) onSend()
            }
          }}
        />
        <Tooltip title={running === null ? '开始做' : '插进它正在做的那一轮'}>
          <span>
            <IconButton color="primary" disabled={!canSend} onClick={onSend} aria-label="发送">
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
        {pending !== '' ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
            已经插进去了：「{pending}」——它下一步会读到
          </Typography>
        ) : running !== null ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
            它正忙：在这里说的话会插进去（下一步就动手），不用等它
          </Typography>
        ) : (
          <Typography variant="caption" color="text.disabled">
            Enter 发送 · Shift+Enter 换行
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
