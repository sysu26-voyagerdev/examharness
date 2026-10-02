import { useEffect, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from './api.js'
import { useApp } from './app-context.js'
import type { BlueprintRowView, BlueprintView } from './types.js'

/**
 * 蓝图（双向细目表）：**题位由老师下发**。
 *
 * 以前只能去改 seed/blueprint.json 这个文件——老师根本碰不到。
 * 现在在这里加题位、改分值、改知识点；保存时会存成**这份会话自己的副本**
 * （直接改仓库里那份示例会让所有会话互相覆盖）。
 * 卷头分数按题位自动算，不再出现"卷头 100 分、题位 20 分"这种自相矛盾。
 */

const COGNITIVE = ['了解', '理解', '掌握', '综合'] as const
const TYPES = ['选择', '填空', '解答', '作图'] as const

const emptyRow = (index: number): BlueprintRowView => ({
  key: `S${String(index)}`,
  knowledge: [],
  cognitive: '掌握',
  type: '解答',
  count: 1,
  difficulty: [0.6, 0.85],
  score: 10,
})

export function BlueprintDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const app = useApp()
  const [view, setView] = useState<{ blueprint: BlueprintView; path: string; revision: string } | null>(null)
  const [rows, setRows] = useState<readonly (BlueprintRowView & { knowledgeText: string })[]>([])
  const [paper, setPaper] = useState<BlueprintView['paper'] | null>(null)
  const [forbid, setForbid] = useState('')

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

  const save = (): void => {
    const revision = view?.revision
    if (revision === undefined) return
    void app.guard('blueprint', async () => {
      await api.patchBlueprint({
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
      }, revision)
      await app.reload()
      onClose()
    })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>蓝图（题位表）</DialogTitle>
      <DialogContent dividers>
        {view === null || paper === null ? (
          <Typography variant="body2" color="text.secondary">
            正在读取…
          </Typography>
        ) : (
          <Stack spacing={2.5}>
            <Alert severity="info">
              题位是你下发的：agent 只能出这里列出的题位，出不来就如实报缺口。卷头分数按题位自动算。
              这份蓝图是**共享文件**，别人同时改会被拦下（重新打开即可）。
            </Alert>

            <Stack direction="row" spacing={2}>
              <TextField
                label="卷子标题"
                fullWidth
                value={paper.title}
                onChange={(event) => setPaper({ ...paper, title: event.target.value })}
              />
              <TextField
                label="班级"
                sx={{ width: 180 }}
                value={paper.className}
                onChange={(event) => setPaper({ ...paper, className: event.target.value })}
              />
              <TextField
                label="时长（分钟）"
                type="number"
                sx={{ width: 140 }}
                value={paper.minutes}
                onChange={(event) => setPaper({ ...paper, minutes: Number(event.target.value) })}
              />
              <TextField label="满分" sx={{ width: 120 }} value={total} disabled helperText="由题位算出" />
            </Stack>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 60 }}>编号</TableCell>
                    <TableCell>知识点（用、分隔）</TableCell>
                    <TableCell sx={{ width: 110 }}>水平</TableCell>
                    <TableCell sx={{ width: 110 }}>题型</TableCell>
                    <TableCell sx={{ width: 80 }}>道数</TableCell>
                    <TableCell sx={{ width: 90 }}>每题分</TableCell>
                    <TableCell sx={{ width: 110 }}>难度区间</TableCell>
                    <TableCell sx={{ width: 48 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow key={`${row.key}-${String(index)}`}>
                      <TableCell>
                        <TextField
                          value={row.key}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, key: event.target.value } : entry)))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          fullWidth
                          placeholder="例如 与坐标轴交点"
                          value={row.knowledgeText}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, knowledgeText: event.target.value } : entry)))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          fullWidth
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
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          fullWidth
                          value={row.type}
                          onChange={(event) => setRows(rows.map((entry, at) => (at === index ? { ...entry, type: event.target.value } : entry)))}
                        >
                          {TYPES.map((value) => (
                            <MenuItem key={value} value={value}>
                              {value}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="number"
                          value={row.count}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, count: Number(event.target.value) } : entry)))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="number"
                          value={row.score}
                          onChange={(event) =>
                            setRows(rows.map((entry, at) => (at === index ? { ...entry, score: Number(event.target.value) } : entry)))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5}>
                          <TextField
                            type="number"
                            value={row.difficulty[0]}
                            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
                            onChange={(event) =>
                              setRows(
                                rows.map((entry, at) =>
                                  at === index ? { ...entry, difficulty: [Number(event.target.value), entry.difficulty[1]] } : entry,
                                ),
                              )
                            }
                          />
                          <TextField
                            type="number"
                            value={row.difficulty[1]}
                            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
                            onChange={(event) =>
                              setRows(
                                rows.map((entry, at) =>
                                  at === index ? { ...entry, difficulty: [entry.difficulty[0], Number(event.target.value)] } : entry,
                                ),
                              )
                            }
                          />
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => setRows(rows.filter((_, at) => at !== index))}>
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Button
                startIcon={<AddIcon />}
                onClick={() => setRows([...rows, { ...emptyRow(rows.length + 1), knowledgeText: '' }])}
                variant="outlined"
                size="small"
              >
                加一个题位
              </Button>
              <Typography variant="caption" color="text.secondary">
                共 {String(rows.length)} 个题位，合计 {String(total)} 分
              </Typography>
            </Stack>

            <TextField
              label="本卷禁用（不在题目里出现的情境/知识点）"
              fullWidth
              value={forbid}
              onChange={(event) => setForbid(event.target.value)}
              helperText="例如 实际问题建模、动点问题"
            />

            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              蓝图文件：{view.path}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={app.busy !== '' || view === null} onClick={save}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  )
}
