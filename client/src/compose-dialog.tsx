import { useState } from 'react'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { useApp } from './app-context.js'
import { gateLabel } from './components.js'
import { MathText } from './math-text.js'
import type { ComposeView, ItemView } from './types.js'

/**
 * **说一道题**：老师脑子里有一道题，说一句就该看到它。
 *
 * 这一支存在的理由是自由度：题不该只能从题位、题库里挑。
 * 服务端做三件事——把这句话翻译成题位、用现有题型现造、过完整闸门链才入库；
 * 造不出来就如实说（试过哪些题型、被哪道闸门拦下），并把活交给 agent 去写题型。
 *
 * 界面上要**把理解过程显示出来**（"理解成了：解答题 8 分 二次函数"）：
 * 老师才知道是自己说清了还是系统听错了——理解错了当场说一句重来，比猜哪里出错强。
 */

const EXAMPLES = [
  '出一道二次函数的题，求最大高度，8 分',
  '来一道关于圆的选择题，考圆周角',
  '一道一次函数的应用题，要带图象，10 分',
  '考频数分布直方图，读图求中位数',
]

export function ComposeDialog({
  onClose,
  onPlaced,
}: {
  onClose: () => void
  /** 放进某个题位之后：让页面刷新卷面 */
  onPlaced: () => Promise<void> | void
}): React.JSX.Element {
  const app = useApp()
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<ComposeView | null>(null)
  const [note, setNote] = useState('')
  const [showAnswer, setShowAnswer] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [target, setTarget] = useState('')

  const rows = app.session?.blueprint.blueprint ?? []

  const ask = async (question: string): Promise<void> => {
    setAsking(true)
    setNote('')
    setResult(null)
    try {
      const view = await api.compose(question)
      setResult(view)
      // 题型相同的题位才能放（选择题填不进解答题位）
      const first = rows.find((row) => row.type === (view.items[0]?.type ?? view.spec?.type ?? ''))
      setTarget(first?.key ?? '')
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setAsking(false)
    }
  }

  const place = (item: ItemView): void => {
    if (target === '') return
    void app.guard('place', async () => {
      const placed = await api.placeItem(target, item.id)
      if (!placed.ok) {
        setNote(placed.reason ?? '没能放进去')
        return
      }
      setNote(`已把这道题放进题位 ${target}`)
      await app.reload()
      await onPlaced()
    })
  }

  const escalate = (goal: string): void => {
    void app.guard('escalate', async () => {
      const started = await api.escalateCompose(goal, '说一道题')
      setNote(`已交给 agent（${started.runId}）——它去写题型把这道题造出来，进度在工作台上能看到。`)
      await app.reload()
    })
  }

  const spec = result?.spec
  const candidates = result === null ? [] : [...result.items, ...(result.similar ?? [])]

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>说一道题</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          用你自己的话说想要一道什么题——它会现造一道（不是从题库里翻），造好先过一遍检查才收下。
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={5}
          placeholder="例如：出一道二次函数的题，情境是拱桥，求最大高度，8 分，稍微难一点"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !asking && text.trim() !== '') {
              event.preventDefault()
              void ask(text.trim())
            }
          }}
        />
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
          {EXAMPLES.map((example) => (
            <Chip
              key={example}
              size="small"
              variant="outlined"
              label={example}
              disabled={asking}
              onClick={() => setText(example)}
            />
          ))}
        </Stack>

        {asking && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 2.5 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              正在把你的话变成题位，再造题、过一遍检查——十几秒。
            </Typography>
          </Stack>
        )}

        {spec !== undefined && (
          <Stack spacing={1} sx={{ mt: 2.5 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip size="small" color="primary" variant="outlined" label="理解成了" />
              <Chip size="small" label={`${spec.type}题`} />
              <Chip size="small" label={`${String(spec.score)} 分`} />
              <Chip size="small" label={`难度 ${spec.difficulty[0].toFixed(2)}–${spec.difficulty[1].toFixed(2)}`} />
              {spec.knowledge.map((key) => (
                <Chip key={key} size="small" variant="outlined" label={key} />
              ))}
            </Stack>
            {spec.note !== '' && (
              <Typography variant="caption" color="text.secondary">
                {spec.note}
              </Typography>
            )}
            {spec.unresolved.length > 0 && (
              <Alert severity="warning" icon={false}>
                这几处没认出来：{spec.unresolved.join('、')}——图谱里没有这个知识点，或者还没学到。
                如果它很重要，换个说法再试一次。
              </Alert>
            )}
          </Stack>
        )}

        {result?.adjusted !== undefined && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {result.adjusted}
          </Alert>
        )}

        {note !== '' && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {note}
          </Alert>
        )}

        {result !== null && !result.ok && (
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <Alert severity="warning">
              {result.reason ?? '这道题没造出来。'}
              {result.similar !== undefined && result.similar.length > 0 && ' 库里倒是有几道相近的（见下）。'}
            </Alert>
            {result.attempts !== undefined && result.attempts.length > 0 && (
              <Box>
                <Button size="small" onClick={() => setShowWhy((value) => !value)}>
                  {showWhy ? '收起' : `看看试过什么（${String(result.attempts.length)} 条）`}
                </Button>
                <Collapse in={showWhy}>
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {result.attempts.map((attempt) => (
                      <Typography key={attempt} variant="caption" color="text.secondary">
                        · {attempt}
                      </Typography>
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            )}
          </Stack>
        )}

        {candidates.length > 0 && (
          <Stack spacing={2} sx={{ mt: 2.5 }} divider={<Divider flexItem />}>
            {candidates.map((item) => (
              <Box key={item.id}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
                  <Chip
                    size="small"
                    color={result?.items.some((owned) => owned.id === item.id) === true ? 'success' : 'default'}
                    variant="outlined"
                    label={
                      result?.items.some((owned) => owned.id === item.id) === true
                        ? '刚造出来 · 已过检查'
                        : '库里已有的'
                    }
                  />
                  {item.knowledge.map((key) => (
                    <Chip key={key} size="small" variant="outlined" label={key} />
                  ))}
                  <Typography variant="caption" color="text.secondary">
                    {item.type} · {String(item.score)} 分
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={app.busy !== '' || target === ''}
                    onClick={() => place(item)}
                  >
                    放进题位
                  </Button>
                </Stack>
                <QuestionPreview item={item} showAnswer={showAnswer} />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                  <Button size="small" onClick={() => setShowAnswer((value) => !value)}>
                    {showAnswer ? '收起答案' : '看答案'}
                  </Button>
                  {Object.keys(item.evidence).length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      检查：{Object.keys(item.evidence).map((key) => gateLabel(key)).join('、')}（都过了才收下）
                    </Typography>
                  )}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {candidates.length > 0 && target !== '' && (
          <TextField
            select
            size="small"
            label="放进哪个题位"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            sx={{ minWidth: 200, mr: 'auto' }}
          >
            {rows
              .filter((row) => row.type === (result?.items[0]?.type ?? spec?.type ?? ''))
              .map((row) => (
                <MenuItem key={row.key} value={row.key}>
                  {row.key}（{row.knowledge.join('、')}｜{row.type}｜{String(row.score)} 分）
                </MenuItem>
              ))}
          </TextField>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>先这样</Button>
        {result !== null && result.ok && (
          <Button variant="outlined" disabled={asking} onClick={() => void ask(text.trim())}>
            再来一批
          </Button>
        )}
        {result !== null && !result.ok && result.escalate !== undefined && (
          <Button
            variant="contained"
            disableElevation
            startIcon={<AutoAwesomeIcon />}
            disabled={app.busy !== '' || app.running !== null}
            onClick={() => escalate(result.escalate ?? '')}
          >
            让 agent 想办法
          </Button>
        )}
        {result === null && (
          <Button
            variant="contained"
            disableElevation
            startIcon={<AutoAwesomeIcon />}
            disabled={asking || text.trim() === ''}
            onClick={() => void ask(text.trim())}
          >
            出题
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/**
 * 一道题的样子（题面/选项/答案/解析）。
 *
 * 不引 PaperView：那是"卷面"（带题号、分值、勾选与确认），
 * 这里是"看一道题"——两者混用会把卷面的规矩带进候选里（候选还没进卷子）。
 */
function QuestionPreview({ item, showAnswer }: { item: ItemView; showAnswer: boolean }): React.JSX.Element {
  return (
    <Box>
      {/* 数学由服务端渲染成 HTML（界面不引数学库），所以这里走 MathText 而不是纯文本 */}
      <Typography component="div" variant="body2" sx={{ lineHeight: 1.9 }}>
        <MathText html={item.stemHtml} />
      </Typography>
      {item.options !== undefined && item.options.length > 0 && (
        <Stack sx={{ mt: 0.75, pl: 1 }}>
          {item.options.map((option) => (
            <Typography key={option.key} component="div" variant="body2" sx={{ lineHeight: 1.8 }}>
              {option.key}．<MathText html={option.html} />
            </Typography>
          ))}
        </Stack>
      )}
      {showAnswer && (
        <Box sx={{ mt: 1, pl: 1.5, borderLeft: 2, borderColor: 'divider' }}>
          <Typography component="div" variant="body2" sx={{ lineHeight: 1.8 }}>
            答案：<MathText html={item.answerHtml} />
          </Typography>
          {item.solutionHtml.map((step, index) => (
            <Typography key={`${String(index)}`} component="div" variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
              {String(index + 1)}. <MathText html={step} />
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}
