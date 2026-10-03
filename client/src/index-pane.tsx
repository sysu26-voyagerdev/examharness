import { useState } from 'react'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useApp } from './app-context.js'
import { formatDifficulty, questionNumbers } from './components.js'
import { KnowledgePage } from './pages/KnowledgePage.js'
import type { ItemView } from './types.js'
import type { SlotBindingView } from './types.js'

/**
 * 左栏：**这道卷子的索引**（不是第二个文档）。
 *
 * Word 的导航窗格是索引：一题一行，点一下跳到卷面上那一题。
 * 设计的编辑不在这里（那会重复一份内容）——设计在顶栏「设定」，
 * 改设计用说话或就地改。索引只做一件事：让老师一眼看到全卷的骨架与状态。
 */

function stateOf(binding: SlotBindingView, item: ItemView): { text: string; color: 'default' | 'success' | 'warning' | 'info' } {
  if (binding.confirmedBy !== null) return { text: '已签', color: 'success' }
  if (Object.values(item.evidence).some((value) => !value.pass)) return { text: '没过', color: 'warning' }
  if (item.lifecycle === 'needs_review') return { text: '待签', color: 'warning' }
  return { text: '过了', color: 'default' }
}

export function IndexPane({
  rows,
  width,
  onClose,
  onRevise,
}: {
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  width: number
  onClose: () => void
  onRevise: (slot: string, item: ItemView) => void
}): React.JSX.Element {
  const app = useApp()
  const [tab, setTab] = useState<'index' | 'materials'>('index')
  const [materials, setMaterials] = useState(false)
  const numbers = questionNumbers(rows)
  const batches = app.kb?.batches ?? []

  const jump = (slot: string): void => {
    document.getElementById(`q-${slot}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Box
      data-print-hide
      sx={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: 'background.paper' }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_event, next: 'index' | 'materials') => setTab(next)} sx={{ flex: 1, minHeight: 40 }}>
          <Tab value="index" label="索引" sx={{ minHeight: 40, py: 0 }} />
          <Tab value="materials" label="材料" sx={{ minHeight: 40, py: 0 }} />
        </Tabs>
        <Tooltip title="折起这一栏">
          <IconButton size="small" onClick={onClose} sx={{ mr: 0.5 }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {tab === 'index' ? (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 0.5 }}>
          {rows.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>
              卷子还是空的。说一句要什么，题会一道道落在右边。
            </Typography>
          ) : (
            rows.map(({ binding, item }) => {
              const state = stateOf(binding, item)
              return (
                <Stack
                  key={binding.slot}
                  direction="row"
                  spacing={0.75}
                  onClick={() => jump(binding.slot)}
                  sx={{
                    px: 1,
                    py: 0.6,
                    alignItems: 'center',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Typography variant="caption" sx={{ minWidth: 22, fontWeight: 600 }}>
                    {numbers.get(binding.slot) ?? '?'}
                  </Typography>
                  <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }} title={item.knowledge.join('、')}>
                    {item.knowledge.join('、') || item.type}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {String(item.score)}分
                  </Typography>
                  <Tooltip title={`${state.text}｜难度 ${formatDifficulty(item.difficulty)}`}>
                    <Chip size="small" variant="outlined" color={state.color} label={state.text} sx={{ height: 18, fontSize: 11 }} />
                  </Tooltip>
                  <Tooltip title="改这一道">
                    <IconButton
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRevise(binding.slot, item)
                      }}
                    >
                      <Typography variant="caption">改</Typography>
                    </IconButton>
                  </Tooltip>
                </Stack>
              )
            })
          )}
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            这次出题用到的材料（教材、真题、上传件）。agent 会照着它们设计情境。
          </Typography>
          <Stack spacing={0.75}>
            {batches.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                还没有材料。
              </Typography>
            )}
            {batches.map((batch) => (
              <Box key={batch.id}>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  {batch.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {batch.status === 'indexed' ? `已整理 ${String(batch.records)} 条` : '未整理'} · {String(batch.files.length)} 份文件
                </Typography>
              </Box>
            ))}
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Button size="small" variant="outlined" onClick={() => setMaterials(true)}>
            打开资料库
          </Button>
        </Box>
      )}

      {materials && (
        <Dialog open onClose={() => setMaterials(false)} fullWidth maxWidth="md">
          <DialogTitle>资料</DialogTitle>
          <DialogContent>
            <KnowledgePage />
          </DialogContent>
        </Dialog>
      )}
    </Box>
  )
}
