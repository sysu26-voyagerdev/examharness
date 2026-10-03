import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useApp } from '../app-context.js'
import { questionNumbers } from '../components.js'
import { RISK, gateLabel } from '../log.js'
import type { ItemView } from '../types.js'

/**
 * 体检：**发出去之前看一眼**。
 *
 * 这里不是"闸门证据的列表"，是把闸门结论翻译成老师能判断的风险：
 * 不写"verify-symbolic 未签字"，写"这道题的答案没能独立复算"。
 * 一页看完：缺没缺题、分值对不对、哪几道没签字、哪几道沿用了上一版、每道题的检查结论。
 */

function problemsOf(item: ItemView): readonly string[] {
  return Object.entries(item.evidence)
    .filter(([, value]) => !value.pass)
    .map(([gate, value]) => `${RISK[gate] ?? gateLabel(gate)}：${value.detail ?? ''}`.trim())
}

export function CheckPage(): React.JSX.Element {
  const app = useApp()
  const { session, state } = app
  const versions = session?.versions ?? []
  const latest = versions.at(-1)
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemView>()
    for (const item of state?.items ?? []) map.set(item.id, item)
    for (const item of session?.slots ?? []) map.set(item.id, item)
    return map
  }, [session, state])

  const rows = (latest?.bindings ?? []).flatMap((binding) => {
    const item = itemsById.get(binding.itemId)
    return item === undefined ? [] : [{ binding, item }]
  })
  const numbers = questionNumbers(rows)
  const unconfirmed = rows.filter(({ binding }) => binding.confirmedBy === null)
  const risky = rows.flatMap(({ binding, item }) => problemsOf(item).map((text) => ({ slot: binding.slot, number: numbers.get(binding.slot) ?? 0, text })))
  const totalScore = latest?.totalScore ?? 0
  const want = session?.blueprint.paper.totalScore ?? 0
  const reused = latest?.reason.includes('沿用了上一版') === true

  return (
    <Box sx={{ maxWidth: 860, mx: 'auto', px: 3, py: 4 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">体检</Typography>
        <Typography variant="caption" color="text.secondary">
          {session?.meta.title ?? ''}　第 {String(latest?.version ?? 0)} 版
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => app.go('paper')}>
          回到卷子
        </Button>
      </Stack>

      <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Chip size="small" color={rows.length === 0 ? 'warning' : 'success'} variant="outlined" label={`${String(rows.length)} 道题`} />
          <Chip
            size="small"
            color={totalScore === want ? 'success' : 'warning'}
            variant="outlined"
            label={`${String(totalScore)} 分${totalScore === want ? '' : `（卷头写的是 ${String(want)} 分）`}`}
          />
          <Chip
            size="small"
            color={(latest?.gaps.length ?? 0) === 0 ? 'success' : 'warning'}
            variant="outlined"
            label={(latest?.gaps.length ?? 0) === 0 ? '题位齐了' : `还缺 ${String(latest?.gaps.length ?? 0)} 道`}
          />
          <Chip
            size="small"
            color={unconfirmed.length === 0 ? 'success' : 'default'}
            variant="outlined"
            label={unconfirmed.length === 0 ? '都签过字了' : `${String(unconfirmed.length)} 道还没签字`}
          />
          {risky.length > 0 && <Chip size="small" color="warning" variant="outlined" label={`${String(risky.length)} 处要留意`} />}
          {reused && <Chip size="small" variant="outlined" label="这一版有几道沿用了上一版" />}
        </Stack>
      </Card>

      {(latest?.gaps.length ?? 0) > 0 && (
        <Card variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            还有题位没凑齐
          </Typography>
          <Stack spacing={0.75}>
            {(latest?.gaps ?? []).map((gap) => (
              <Typography key={gap.slot} variant="body2" color="text.secondary">
                {gap.slot.replace(/-\d+$/, '')}：{gap.reason}
              </Typography>
            ))}
          </Stack>
        </Card>
      )}

      <Card variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          每一道
        </Typography>
        <Stack spacing={1}>
          {rows.map(({ binding, item }) => {
            const problems = problemsOf(item)
            const number = numbers.get(binding.slot) ?? 0
            return (
              <Stack key={binding.slot} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2" sx={{ minWidth: 34, fontWeight: 600 }}>
                  第 {String(number)} 题
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={problems.length > 0 ? 'warning' : 'success'}
                  label={problems.length > 0 ? '要留意' : '没问题'}
                />
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                  {problems.length > 0
                    ? problems.join('；')
                    : `${item.knowledge.join('、')} · ${item.type} · ${String(item.score)} 分${binding.confirmedBy === null ? '（还没签字）' : `（${binding.confirmedBy} 签过）`}`}
                </Typography>
              </Stack>
            )
          })}
          {rows.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              这张卷子还没有题。
            </Typography>
          )}
        </Stack>
      </Card>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        "要留意"不是判错：那是某项检查没能独立确认（例如题面由模型写过、回译没验成），
        自己看一眼再签字就行。签过的题才算定稿。
      </Typography>
    </Box>
  )
}
