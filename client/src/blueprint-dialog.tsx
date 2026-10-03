import { useEffect, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { useApp } from './app-context.js'
import type { BlueprintRowView, BlueprintView } from './types.js'

/**
 * 这份卷子的**设定**（原来叫"蓝图/双向细目表"）。
 *
 * 两件事必须成立，否则这张表又是"系统的话"：
 *   1. 说人话、按卷面编号：一行就是"第几题、考什么、每题几分、几道、难不难"，
 *      不出现 S3-1 这种内部编号，也不给老师看文件路径；
 *   2. **能说给它改**：老师不用会填表——"第 2 题换成圆""大题改 3 道"直接说，
 *      agent 用 change_setting 改**这一张卷子自己的设定**（不动别人的卷子），再把受影响的题重出。
 */

const COGNITIVE = ['了解', '理解', '掌握', '灵活运用'] as const
const TYPES = ['选择', '填空', '解答'] as const

/** 难度给人话：老师想的是"难不难"，不是 0.63–0.85 */
const LEVELS: readonly { label: string; range: readonly [number, number] }[] = [
  { label: '较易', range: [0.3, 0.6] },
  { label: '中等', range: [0.6, 0.8] },
  { label: '较难', range: [0.8, 0.95] },
]

function levelOf(range: readonly [number, number]): string {
  const mid = (range[0] + range[1]) / 2
  const hit = LEVELS.find((level) => mid >= level.range[0] && mid <= level.range[1])
  return hit?.label ?? '中等'
}

/** 每一行在卷面上从第几题到第几题（同一题型连着编号，与卷面一致） */
function rowNumbers(rows: readonly BlueprintRowView[]): readonly { from: number; to: number }[] {
  const out: { from: number; to: number }[] = rows.map(() => ({ from: 0, to: 0 }))
  let running = 0
  for (const type of TYPES) {
    rows.forEach((row, index) => {
      if (row.type !== type) return
      const target = out[index]
      if (target === undefined) return
      target.from = running + 1
      running += row.count
      target.to = running
    })
  }
  return out
}

const emptyRow = (index: number): BlueprintRowView => ({
  key: `S${String(index)}`,
  knowledge: [],
  cognitive: '掌握',
  type: '解答',
  count: 1,
  difficulty: [0.6, 0.8],
  score: 10,
})

export function BlueprintDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const app = useApp()
  const [view, setView] = useState<{ blueprint: BlueprintView; revision: string; own: boolean } | null>(null)
  const [rows, setRows] = useState<readonly (BlueprintRowView & { knowledgeText: string })[]>([])
  const [paper, setPaper] = useState<BlueprintView['paper'] | null>(null)
  const [forbid, setForbid] = useState('')
  const [wish, setWish] = useState('')

  useEffect(() => {
    void api
      .getBlueprint()
      .then((next) => {
        setView(next)
        setPaper(next.blueprint.paper)
        setForbid(next.blueprint.constraints.forbidKnowledge.join('、'))
        setRows(next.blueprint.blueprint.map((row) => ({ ...row, knowledgeText: row.knowledge.join('、') })))
      })
      .catch(() => setView(null))
  }, [])

  const total = rows.reduce((sum, row) => sum + row.score * row.count, 0)
  const count = rows.reduce((sum, row) => sum + row.count, 0)
  const numbers = rowNumbers(rows)

  const save = (): void => {
    const revision = view?.revision
    if (revision === undefined) return
    void app.guard('setting', async () => {
      await api.patchBlueprint(
        {
          ...(paper === null ? {} : { paper }),
          blueprint: rows.map((row) => ({
            ...row,
            knowledge: row.knowledgeText
              .split(/[、,，\s]+/)
              .map((part) => part.trim())
              .filter((part) => part !== ''),
          })),
          constraints: {
            forbidKnowledge: forbid
              .split(/[、,，\s]+/)
              .map((part) => part.trim())
              .filter((part) => part !== ''),
          },
        },
        revision,
      )
      await app.reload()
      onClose()
    })
  }

  /** 说一句就改：改完按新设定把受影响的题重出（只改设定不动卷子等于没改） */
  const tellAgent = (): void => {
    const text = wish.trim()
    if (text === '') return
    void app.guard('setting-agent', async () => {
      // 它正忙就把这句话插进去（不阻塞老师）
      await app.ask(
        `老师要改这份卷子的设定：${text}\n\n` +
          '用 change_setting 改（它按**卷面上的第几题**认，改的是这一张卷子自己的设定）。\n' +
          '改完按新设定把受影响的题重出（quick_question / construct_item），再用 place_item 放回卷子上——' +
          '只改设定不动卷子等于没改。最后用一句话说清：卷子上第几题变成了什么。',
      )
      onClose()
    })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>这份卷子的设定</DialogTitle>
      <DialogContent dividers>
        {view === null || paper === null ? (
          <Typography variant="body2" color="text.secondary">
            正在读取…
          </Typography>
        ) : (
          <Stack spacing={2.5}>
            {/* 说一句就改：老师不该为了"第 2 题换成圆"去填表 */}
            <Card variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="想改什么直接说——例如「第 2 题换成圆」「大题改成 3 道」「每题 12 分」"
                  value={wish}
                  onChange={(event) => setWish(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      tellAgent()
                    }
                  }}
                />
                <Button
                  variant="contained"
                  disableElevation
                  startIcon={<AutoAwesomeIcon />}
                  disabled={wish.trim() === ''}
                  sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                  onClick={tellAgent}
                >
                  让它改
                </Button>
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
                {['第 2 题换成圆', '大题改成 3 道', '每题 12 分', '别考动点问题'].map((example) => (
                  <Chip key={example} size="small" variant="outlined" label={example} onClick={() => setWish(example)} />
                ))}
              </Stack>
            </Card>

            <Stack direction="row" spacing={2}>
              <TextField
                label="卷名"
                fullWidth
                size="small"
                value={paper.title}
                onChange={(event) => setPaper({ ...paper, title: event.target.value })}
              />
              <TextField
                label="班级"
                size="small"
                sx={{ width: 160 }}
                value={paper.className}
                onChange={(event) => setPaper({ ...paper, className: event.target.value })}
              />
              <TextField
                label="时长（分钟）"
                type="number"
                size="small"
                sx={{ width: 130 }}
                value={paper.minutes}
                onChange={(event) => setPaper({ ...paper, minutes: Number(event.target.value) })}
              />
              <TextField label="满分" size="small" sx={{ width: 110 }} value={total} disabled helperText="按每题分值算" />
            </Stack>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                这张卷子考什么
              </Typography>
              <Stack spacing={2}>
                {TYPES.filter((type) => rows.some((row) => row.type === type)).map((type) => (
                  <Box key={type}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      {type}题（
                      {String(rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.count, 0))} 道 ·
                      {' '}
                      {String(rows.filter((row) => row.type === type).reduce((sum, row) => sum + row.score * row.count, 0))} 分）
                    </Typography>
                    <Stack spacing={1}>
                {rows.map((row, index) => {
                  if (row.type !== type) return null
                  const number = numbers[index] ?? { from: 0, to: 0 }
                  return (
                    <Card key={`${row.key}-${String(index)}`} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ minWidth: 88, fontWeight: 600, pt: 0.9 }}>
                          {number.from === number.to
                            ? `第 ${String(number.from)} 题`
                            : `第 ${String(number.from)}–${String(number.to)} 题`}
                        </Typography>
                        <TextField
                          size="small"
                          sx={{ flex: 1, minWidth: 150 }}
                          placeholder="考什么，例如 与坐标轴交点"
                          value={row.knowledgeText}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, knowledgeText: event.target.value } : entry)))
                          }
                        />
                        <TextField
                          select
                          size="small"
                          sx={{ width: 92 }}
                          value={row.type}
                          onChange={(event) => setRows(rows.map((entry, at) => (at === index ? { ...entry, type: event.target.value } : entry)))}
                        >
                          {TYPES.map((value) => (
                            <MenuItem key={value} value={value}>
                              {value}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          size="small"
                          sx={{ width: 84 }}
                          value={levelOf(row.difficulty)}
                          onChange={(event) => {
                            const level = LEVELS.find((entry) => entry.label === event.target.value)
                            if (level === undefined) return
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, difficulty: level.range } : entry)))
                          }}
                        >
                          {LEVELS.map((level) => (
                            <MenuItem key={level.label} value={level.label}>
                              {level.label}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          type="number"
                          label="每题分"
                          sx={{ width: 78 }}
                          value={row.score}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, score: Number(event.target.value) } : entry)))
                          }
                        />
                        <TextField
                          size="small"
                          type="number"
                          label="几道"
                          sx={{ width: 68 }}
                          value={row.count}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, count: Number(event.target.value) } : entry)))
                          }
                        />
                        <TextField
                          select
                          size="small"
                          label="要求"
                          sx={{ width: 100 }}
                          value={row.cognitive}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, cognitive: event.target.value } : entry)))
                          }
                        >
                          {COGNITIVE.map((value) => (
                            <MenuItem key={value} value={value}>
                              {value}
                            </MenuItem>
                          ))}
                        </TextField>
                        <IconButton
                          size="small"
                          title="去掉这一档"
                          sx={{ ml: 'auto' }}
                          onClick={() => setRows(rows.filter((_, at) => at !== index))}
                        >
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Card>
                  )
                })}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>

            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => setRows([...rows, { ...emptyRow(rows.length + 1), knowledgeText: '' }])}
              >
                再加一道
              </Button>
              <Typography variant="caption" color="text.secondary">
                共 {String(count)} 道题、{String(total)} 分
              </Typography>
            </Stack>

            <TextField
              label="这张卷子不考什么"
              fullWidth
              size="small"
              value={forbid}
              onChange={(event) => setForbid(event.target.value)}
              helperText="例如 实际问题建模、动点问题（整卷都不出这些）"
            />

            <Alert severity="info" icon={false}>
              {view.own
                ? '改的是这一张卷子的设定，别人的卷子不受影响。'
                : '保存时会先给这一张卷子单独复制一份设定，之后改的都只影响它。'}
            </Alert>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disableElevation disabled={view === null || app.busyWith('setting')} onClick={save}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
