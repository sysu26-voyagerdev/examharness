import { useEffect, useMemo, useState } from 'react'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListSubheader from '@mui/material/ListSubheader'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { GraphNodeView, GraphView } from '../types.js'

/**
 * 知识图谱。**只读**。
 *
 * 这张图是**脚本算出来的产物**（`scripts/graph-build.mjs` 读课标、183 份真题结构与人工审定表，
 * 见 `docs/知识图谱构建报告.md`），所以这一页不做编辑：改了也会被下一次重建冲掉，
 * 那比不能改更坏。要改就改审定表再重建——页面把"怎么改"写在明处。
 *
 * 它的职责只有一件：**让图上每一个结论都能追到出处**。
 * 一百多个知识点、每条先学关系都写着凭什么（教材章节先于 / 定义依赖 / 课标要求先于），
 * 这些以前只在 JSON 里，谁也看不见。
 */

/** 年级的展示顺序：按教材顺序，不是字典序 */
const GRADES = ['七上', '七下', '八上', '八下', '九上', '九下', '综合']

const gradeOrder = (grade: string): number => {
  const index = GRADES.indexOf(grade)
  return index === -1 ? GRADES.length : index
}

/** 先学依据的类别：把"教材章节先于：…"这种长句子归成一眼能扫的标签 */
function basisKind(basis: string): { label: string; color: 'info' | 'primary' | 'default' } {
  if (basis.startsWith('教材章节')) return { label: '教材先学', color: 'info' }
  if (basis.startsWith('课标')) return { label: '课标要求', color: 'primary' }
  if (basis.startsWith('定义')) return { label: '定义依赖', color: 'default' }
  return { label: '依据', color: 'default' }
}

export function KnowledgeGraphPage(): React.JSX.Element {
  const app = useApp()
  const [graph, setGraph] = useState<GraphView | null>(null)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<'all' | 'learned' | 'unlearned'>('all')

  useEffect(() => {
    void app.guard('graph', async () => {
      setGraph(await api.getGraph())
    })
    // 图是构建产物，进页面拉一次就够；它不会边看边变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nodes = useMemo(() => graph?.nodes ?? [], [graph])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return nodes.filter((node) => {
      if (only === 'learned' && !node.learned) return false
      if (only === 'unlearned' && node.learned) return false
      if (text === '') return true
      if (node.key.toLowerCase().includes(text)) return true
      return (node.aliases ?? []).some((alias) => alias.toLowerCase().includes(text))
    })
  }, [nodes, query, only])

  /** 按年级 → 章节铺开；章节里按图谱给的顺序 */
  const byGrade = useMemo(() => {
    const grades = new Map<string, Map<string, GraphNodeView[]>>()
    for (const node of filtered) {
      const grade = node.grade ?? '未标年级'
      const chapter = node.chapter ?? '未标章节'
      const chapters = grades.get(grade) ?? new Map<string, GraphNodeView[]>()
      const list = chapters.get(chapter) ?? []
      list.push(node)
      chapters.set(chapter, list)
      grades.set(grade, chapters)
    }
    const firstIndex = (list: readonly GraphNodeView[]): number =>
      list.reduce((min, node) => Math.min(min, node.chapterIndex), Number.MAX_SAFE_INTEGER)
    return [...grades.entries()]
      .toSorted((a, b) => gradeOrder(a[0]) - gradeOrder(b[0]) || a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .map(
        ([grade, chapters]) =>
          [
            grade,
            [...chapters.entries()].toSorted(
              (a, b) => firstIndex(a[1]) - firstIndex(b[1]) || a[0].localeCompare(b[0], 'zh-Hans-CN'),
            ),
          ] as const,
      )
  }, [filtered])

  const current = nodes.find((node) => node.key === selected) ?? null

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      {/* ── 左：索引 ─────────────────────────────────────── */}
      <Box
        sx={{
          width: 320,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Box sx={{ p: 1.5, pb: 1 }}>
          <TextField
            fullWidth
            placeholder="搜知识点或别名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
            {(
              [
                ['all', '全部'],
                ['learned', '已学'],
                ['unlearned', '还没学'],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                label={label}
                variant={only === value ? 'filled' : 'outlined'}
                color={only === value ? 'primary' : 'default'}
                onClick={() => setOnly(value)}
              />
            ))}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {String(filtered.length)} 个
            </Typography>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 0.5, pb: 2 }}>
          {byGrade.map(([grade, chapters]) => (
            <Box key={grade}>
              <ListSubheader
                component="div"
                sx={{ bgcolor: 'background.paper', lineHeight: '32px', fontSize: 13, fontWeight: 700 }}
              >
                {grade}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {String(chapters.reduce((sum, [, list]) => sum + list.length, 0))}
                </Typography>
              </ListSubheader>
              {chapters.map(([chapter, list]) => (
                <Box key={chapter}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', px: 1.5, pt: 0.75, pb: 0.25, fontWeight: 600 }}
                  >
                    {chapter}
                  </Typography>
                  <List dense disablePadding>
                    {list.map((node) => (
                      <ListItemButton
                        key={node.key}
                        selected={node.key === selected}
                        onClick={() => setSelected(node.key)}
                        sx={{ px: 1.5, py: 0.5 }}
                      >
                        <Stack sx={{ minWidth: 0, width: '100%' }}>
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                              {node.key}
                            </Typography>
                            {!node.learned && (
                              <Tooltip title="还没学到这儿">
                                <Chip label="未学" variant="outlined" sx={{ height: 18, fontSize: 11 }} />
                              </Tooltip>
                            )}
                          </Stack>
                          {node.prerequisites.length > 0 && (
                            <Typography variant="caption" color="text.secondary" noWrap>
                              先学 {node.prerequisites.slice(0, 2).join('、')}
                              {node.prerequisites.length > 2 && ` 等 ${String(node.prerequisites.length)} 个`}
                            </Typography>
                          )}
                        </Stack>
                      </ListItemButton>
                    ))}
                  </List>
                </Box>
              ))}
            </Box>
          ))}
          {graph !== null && filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              没有匹配的知识点。
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── 中：选中的那个 / 全图概览 ─────────────────────── */}
      <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: 2 }}>
        {graph === null ? (
          <Typography variant="body2" color="text.secondary">
            正在读图谱……
          </Typography>
        ) : current === null ? (
          <Overview graph={graph} onPick={setSelected} />
        ) : (
          <NodeDetail node={current} all={nodes} graph={graph} onPick={setSelected} />
        )}
      </Box>
    </Box>
  )
}

/** 没选知识点时：这张图长什么样、从哪来 */
function Overview({ graph, onPick }: { graph: GraphView; onPick: (key: string) => void }): React.JSX.Element {
  const byGrade = new Map<string, number>()
  const byKind = new Map<string, number>()
  const byDomain = new Map<string, number>()
  for (const node of graph.nodes) {
    const grade = node.grade ?? '未标年级'
    byGrade.set(grade, (byGrade.get(grade) ?? 0) + 1)
    if (node.kind !== undefined) byKind.set(node.kind, (byKind.get(node.kind) ?? 0) + 1)
    if (node.domain !== undefined) byDomain.set(node.domain, (byDomain.get(node.domain) ?? 0) + 1)
  }
  const withZhenti = graph.nodes.filter((node) => node.zhenti !== undefined).length
  const generated = graph.generatedBy ?? {}
  const rawInputs = generated['inputs']
  const inputs = Array.isArray(rawInputs) ? rawInputs.map(String) : []
  const roots = graph.nodes.filter((node) => node.prerequisites.length === 0)

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">知识图谱</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          左边挑一个知识点，看它凭什么在这儿、先得学会什么、真题里考得有多勤。
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 2 }}>
            <Fact label="知识点" value={String(graph.total)} />
            <Fact label="先学关系" value={String(graph.edges)} />
            <Fact label="这一卷已学" value={String(graph.learned.length)} />
            <Fact label="有真题统计" value={String(withZhenti)} />
          </Stack>
        </CardContent>
      </Card>

      {graph.dangling.length > 0 && (
        <Alert severity="warning">
          有 {String(graph.dangling.length)} 条先学关系指向图里不存在的知识点，它们是断的：
          {graph.dangling
            .slice(0, 5)
            .map((entry) => ` ${entry.key} → ${entry.missing}`)
            .join('；')}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            每个年级有多少
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {[...byGrade.entries()]
              .toSorted((a, b) => gradeOrder(a[0]) - gradeOrder(b[0]))
              .map(([grade, count]) => (
                <Chip key={grade} label={`${grade} · ${String(count)}`} variant="outlined" />
              ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            都是些什么
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {[...byKind.entries()]
              .toSorted((a, b) => b[1] - a[1])
              .map(([kind, count]) => (
                <Chip key={kind} label={`${kind} · ${String(count)}`} variant="outlined" />
              ))}
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {[...byDomain.entries()]
              .toSorted((a, b) => b[1] - a[1])
              .map(([domain, count]) => (
                <Chip key={domain} label={`${domain} · ${String(count)}`} variant="outlined" />
              ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            这张图是怎么来的
          </Typography>
          <Typography variant="body2" color="text.secondary">
            它是脚本算出来的产物：读课标条目、183 份中考真题的结构统计，加上一份人工审定表（哪个知识点存在、先学关系是谁）。
            所以这一页不给改——改了会被下一次重建冲掉。要改就改 <code>scripts/graph-nodes/*.mjs</code>，再跑{' '}
            <code>node scripts/graph-build.mjs</code>。
          </Typography>
          {inputs.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                这次用到的材料：
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {inputs.map((input) => (
                  <Chip key={input} label={input} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            从哪儿开始
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            没有先学要求的知识点是这条线的起点，一共 {String(roots.length)} 个：
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {roots.slice(0, 24).map((node) => (
              <Chip key={node.key} label={node.key} variant="outlined" onClick={() => onPick(node.key)} />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Box>
      <Typography variant="h5">{value}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}

/** 选中的知识点：它是什么、凭什么、先学什么、真题里什么样 */
function NodeDetail({
  node,
  all,
  graph,
  onPick,
}: {
  node: GraphNodeView
  all: readonly GraphNodeView[]
  graph: GraphView
  onPick: (key: string) => void
}): React.JSX.Element {
  const titleOf = useMemo(() => {
    const known = new Set(all.map((entry) => entry.key))
    return (key: string): string => (known.has(key) ? key : `${key}（图里没有）`)
  }, [all])

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h5">{node.key}</Typography>
          {node.learned ? (
            <Chip label="这一卷已学" color="success" variant="outlined" />
          ) : (
            <Chip label="还没学到" variant="outlined" />
          )}
          {node.kind !== undefined && <Chip label={node.kind} variant="outlined" />}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 1 }}>
          {node.grade !== undefined && (
            <Typography variant="caption" color="text.secondary">
              {node.grade}
              {node.chapter === undefined ? '' : ` · ${node.chapter}`}
            </Typography>
          )}
          {node.domain !== undefined && (
            <Typography variant="caption" color="text.secondary">
              {node.domain}
            </Typography>
          )}
        </Stack>
      </Box>

      {node.aliases !== undefined && node.aliases.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              也叫这些名字
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {node.aliases.map((alias) => (
                <Chip key={alias} label={alias} variant="outlined" />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              出题时说这些名字也认，不必一字不差。
            </Typography>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <Typography variant="subtitle2">先得学会这些，才学得会它</Typography>
          {node.prerequisites.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              没有先学要求——这是这条线的起点。
            </Typography>
          ) : (
            <Stack spacing={1.25} sx={{ mt: 1.5 }}>
              {node.prerequisites.map((key) => {
                const basis = node.prerequisiteBasis?.[key]
                const kind = basis === undefined ? null : basisKind(basis)
                return (
                  <Box key={key}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                      <Chip
                        label={titleOf(key)}
                        variant="outlined"
                        onClick={() => onPick(key)}
                        color={graph.nodes.some((entry) => entry.key === key) ? 'default' : 'error'}
                      />
                      {kind !== null && (
                        <Chip label={kind.label} variant="outlined" color={kind.color} sx={{ height: 20, fontSize: 11 }} />
                      )}
                    </Stack>
                    {basis !== undefined && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, pl: 0.5 }}>
                        {basis}
                      </Typography>
                    )}
                  </Box>
                )
              })}
            </Stack>
          )}
        </CardContent>
      </Card>

      {node.sources !== undefined && node.sources.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2">凭什么说它存在</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              逐条来自课标原文、教材目录或真题统计——图上每一个结论都要能追到出处
            </Typography>
            <Stack spacing={0.75}>
              {node.sources.map((source) => (
                <Typography key={source} variant="body2" sx={{ pl: 1.5, borderLeft: 3, borderColor: 'divider' }}>
                  {source}
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {node.zhenti !== undefined && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              中考里考得有多勤
            </Typography>
            <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Fact label="支持卷数" value={String(node.zhenti.papers)} />
              <Fact label="命中题数" value={String(node.zhenti.questions)} />
              <Fact label="压着几层先学" value={String(node.depth)} />
            </Stack>
            {node.ask !== undefined && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  常见问法
                </Typography>
                <Typography variant="body2">{node.ask}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  这一句是审定表里人工归纳的，不是统计出来的，也还没经老师校验。
                </Typography>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {node.successors.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              学会它之后才学得会的（{String(node.successors.length)}）
            </Typography>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {node.successors.map((key) => (
                <Chip key={key} label={titleOf(key)} variant="outlined" onClick={() => onPick(key)} />
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {node.evidenceLevel !== undefined && (
        <Typography variant="caption" color="text.secondary">
          依据等级：{node.evidenceLevel}
        </Typography>
      )}
    </Stack>
  )
}
