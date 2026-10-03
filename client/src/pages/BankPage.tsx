import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { MathText } from '../math-text.js'
import { gateLabel } from '../components.js'
import type { BankQuery, BankView, ItemView } from '../types.js'

/**
 * 题库页：**老师手里的存货**。
 *
 * 以前题库只在接口里，界面只给最终那份卷子看——老师既不知道有什么题，也没法挑。
 * 这一页回答三个问题：有哪些题（筛选 + 分面）、这道题长什么样（题干/选项/图/答案/检查结果）、
 * 以及"我要用它"（放进当前卷的哪个题位）。
 *
 * 放进去之后仍然过闸门：这道题若还没被现役闸门签过字，服务端会重新送审一遍。
 */

const STATUS_TEXT: Readonly<Record<string, string>> = {
  verified: '已通过',
  needs_review: '待复核',
  draft: '草稿',
  rejected: '被拦下',
  published: '已发布',
  frozen: '已冻结',
}

export function BankPage(): React.JSX.Element {
  const app = useApp()
  const { session, busy } = app

  const [query, setQuery] = useState<BankQuery>({ limit: 60 })
  const [data, setData] = useState<BankView | null>(null)
  const [picked, setPicked] = useState<ItemView | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [showAnswer, setShowAnswer] = useState(false)
  const [target, setTarget] = useState('')

  const load = useCallback(async (next: BankQuery): Promise<void> => {
    setLoading(true)
    try {
      const view = await api.getBank(next)
      setData(view)
      setPicked((current) => (current === null ? (view.items[0] ?? null) : current))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(query)
  }, [load, query])

  /** 当前卷里与这道题题型相同的题位：只有同题型才能放（选择题填不进解答题位） */
  const slots = useMemo(() => {
    const rows = session?.blueprint.blueprint ?? []
    if (picked === null) return []
    return rows.filter((row) => row.type === picked.type)
  }, [session, picked])

  useEffect(() => {
    setTarget(slots[0]?.key ?? '')
  }, [slots])

  const place = (): void => {
    if (picked === null || target === '') return
    void app.guard('place', async () => {
      const result = await api.placeItem(target, picked.id)
      if (!result.ok) {
        setNote(result.reason ?? '没能放进去')
        return
      }
      setNote(`已把这道题放进题位 ${target}`)
      await app.reload()
      await load(query)
    })
  }

  const items = data?.items ?? []

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0, gap: 2, p: 2 }}>
      {/* 左：筛选 + 列表 */}
      <Box sx={{ width: { xs: '100%', md: 430 }, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <Typography variant="h5">题库</Typography>
          <Typography variant="caption" color="text.secondary">
            {data === null ? '读题库…' : `筛出 ${String(data.total)} 道`}
          </Typography>
          {loading && <CircularProgress size={14} />}
        </Stack>
        {/* 题库是**全局**的（几个会话共用一份），所以"给哪张卷"必须说清是哪一张 */}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          所有会话共用的一份存货。当前这张卷：{session?.meta.title ?? '（没有会话）'}
          {session === null ? '' : `　第 ${String(session.versions.at(-1)?.version ?? 0)} 版`}
        </Typography>

        <Stack spacing={1} sx={{ mb: 1.5 }}>
          <TextField
            size="small"
            placeholder="搜题干里的字（例如 抛物线、方差）"
            value={query.q ?? ''}
            onChange={(event) => setQuery((previous) => ({ ...previous, q: event.target.value, offset: 0 }))}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select
              size="small"
              label="题型"
              value={query.type ?? ''}
              onChange={(event) => setQuery((previous) => ({ ...previous, type: event.target.value, offset: 0 }))}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">全部</MenuItem>
              {(data?.facets.type ?? []).map((entry) => (
                <MenuItem key={entry.key} value={entry.key}>
                  {entry.key}（{String(entry.count)}）
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="状态"
              value={query.status ?? ''}
              onChange={(event) => setQuery((previous) => ({ ...previous, status: event.target.value, offset: 0 }))}
              sx={{ flex: 1 }}
            >
              <MenuItem value="">全部</MenuItem>
              {(data?.facets.status ?? []).map((entry) => (
                <MenuItem key={entry.key} value={entry.key}>
                  {STATUS_TEXT[entry.key] ?? entry.key}（{String(entry.count)}）
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {/* 知识点很多：用 chip 点选，比下拉好找 */}
          <Box sx={{ maxHeight: 96, overflowY: 'auto' }}>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              <Chip
                size="small"
                variant={(query.knowledge ?? '') === '' ? 'filled' : 'outlined'}
                color={(query.knowledge ?? '') === '' ? 'primary' : 'default'}
                label="全部知识点"
                onClick={() => setQuery((previous) => ({ ...previous, knowledge: '', offset: 0 }))}
              />
              {(data?.facets.knowledge ?? []).slice(0, 14).map((entry) => (
                <Chip
                  key={entry.key}
                  size="small"
                  variant={query.knowledge === entry.key ? 'filled' : 'outlined'}
                  color={query.knowledge === entry.key ? 'primary' : 'default'}
                  label={`${entry.key} ${String(entry.count)}`}
                  onClick={() => setQuery((previous) => ({ ...previous, knowledge: entry.key, offset: 0 }))}
                />
              ))}
            </Stack>
          </Box>
        </Stack>

        <Card sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1 }}>
          {items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              没有符合条件的题。放宽筛选，或者让 agent 按蓝图出一批。
            </Typography>
          ) : (
            <Stack spacing={0.5}>
              {items.map((item) => (
                <Box
                  key={item.id}
                  onClick={() => setPicked(item)}
                  sx={{
                    p: 1.25,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    bgcolor: picked?.id === item.id ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {/* 列表里也要渲染数学：显示原始 $…$ 会看成乱码 */}
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    <MathText html={item.stemHtml} />
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {item.type} {String(item.score)} 分
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                      {item.knowledge.join('、')}
                    </Typography>
                    <Tooltip title={Object.entries(item.evidence).map(([gate, value]) => `${gateLabel(gate)}${value.pass ? ' ✓' : ' ✗'}`).join('　')}>
                      <Box
                        sx={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          bgcolor: item.lifecycle === 'needs_review' ? 'warning.main' : 'success.main',
                        }}
                      />
                    </Tooltip>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Card>
      </Box>

      {/* 右：这一道长什么样、能怎么用 */}
      <Card sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {picked === null ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              左边选一道题，这里看它的题面、选项、答案与检查结果。
            </Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ p: 2.5, overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
                <Chip size="small" label={`${picked.type}　${String(picked.score)} 分`} />
                <Chip
                  size="small"
                  variant="outlined"
                  color={picked.lifecycle === 'needs_review' ? 'warning' : 'success'}
                  label={STATUS_TEXT[picked.lifecycle] ?? picked.lifecycle}
                />
                <Chip size="small" variant="outlined" label={picked.knowledge.join('、')} />
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant={showAnswer ? 'contained' : 'outlined'} disableElevation onClick={() => setShowAnswer((previous) => !previous)}>
                  {showAnswer ? '只看题面' : '答案与解析'}
                </Button>
              </Stack>

              <Typography variant="body1" sx={{ fontSize: 15.5, lineHeight: 1.9 }}>
                <MathText html={picked.stemHtml} />
              </Typography>
              {picked.options.length > 0 && (
                <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', columnGap: 3, rowGap: 0.5 }}>
                  {picked.options.map((option) => (
                    <Typography
                      key={option.key}
                      sx={{ fontSize: 15, color: showAnswer && option.correct ? 'success.dark' : 'text.primary', fontWeight: showAnswer && option.correct ? 600 : 400 }}
                    >
                      {option.key}. <MathText html={option.html} />
                    </Typography>
                  ))}
                </Box>
              )}
              {picked.figure !== '' && (
                <Box sx={{ my: 1.5, textAlign: 'center', '& svg': { maxWidth: '100%', height: 'auto' } }} dangerouslySetInnerHTML={{ __html: picked.figure }} />
              )}

              {showAnswer && (
                <Box sx={{ mt: 2, pl: 2, borderLeft: 3, borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    答案　<MathText html={picked.answerHtml} />
                  </Typography>
                  <Box component="ol" sx={{ pl: 2.5, my: 1, mb: 0 }}>
                    {picked.solutionHtml.map((step, index) => (
                      <Box component="li" key={index}>
                        <Typography variant="body2" color="text.secondary">
                          <MathText html={step} />
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    检查结果：{Object.entries(picked.evidence).map(([gate, value]) => `${gateLabel(gate)}${value.pass ? ' ✓' : ' ✗'}`).join('　') || '（还没有记录）'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    来自题型 {picked.constructor}（种子 {String(picked.seed)}）
                  </Typography>
                </Box>
              )}
            </Box>

            <Divider />
            <Box sx={{ p: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {session?.meta.title ?? '当前卷'} 的
                </Typography>
                <TextField select size="small" value={target} onChange={(event) => setTarget(event.target.value)} sx={{ minWidth: 240 }} disabled={slots.length === 0}>
                  {slots.length === 0 ? (
                    <MenuItem value="">没有同题型的题位</MenuItem>
                  ) : (
                    slots.map((row) => (
                      <MenuItem key={row.key} value={row.key}>
                        {row.key}　{row.knowledge.join('、')}（{String(row.score)} 分）
                      </MenuItem>
                    ))
                  )}
                </TextField>
                <Button variant="contained" disableElevation disabled={busy !== '' || target === ''} onClick={place}>
                  用这一道
                </Button>
              </Stack>
              {/* 说清这条路的性质：**这是复用库里已有的题**，不是造新题 */}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                这是把库里已有的一道**指给**这个题位（会重新过一遍检查）。要**现造**新题，用卷面上的
                「改这道题…」，或者直接「再出一版」——每次组卷都是现造的。
              </Typography>
              {note !== '' && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {note}
                </Typography>
              )}
            </Box>
          </>
        )}
      </Card>
    </Box>
  )
}
