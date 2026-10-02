import { useMemo, useState } from 'react'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SendIcon from '@mui/icons-material/Send'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { EvidenceView, FilesView, KnowledgeView, PaperView, Timeline } from '../components.js'
import { forWorkspace } from '../log.js'
import type { ItemView, SlotChangeView, VersionView } from '../types.js'

const TABS = [
  { key: 'paper', label: '试卷' },
  { key: 'knowledge', label: '知识点' },
  { key: 'evidence', label: '依据' },
  { key: 'files', label: '文件' },
] as const

/** 两版之间的题位变化（服务端只算最新一版，界面要能看任意两版） */
export function diffVersions(before: VersionView | undefined, after: VersionView): SlotChangeView[] {
  if (before === undefined) return []
  const slots = new Set([...before.bindings.map((b) => b.slot), ...after.bindings.map((b) => b.slot)])
  return [...slots].toSorted().map((slot) => {
    const a = before.bindings.find((b) => b.slot === slot)
    const b = after.bindings.find((c) => c.slot === slot)
    if (a === undefined && b !== undefined) return { slot, change: 'added' as const, to: b.itemId }
    if (a !== undefined && b === undefined) return { slot, change: 'removed' as const, from: a.itemId }
    if (a !== undefined && b !== undefined && a.itemId !== b.itemId) return { slot, change: 'replaced' as const, from: a.itemId, to: b.itemId }
    return { slot, change: 'same' as const }
  })
}

export function WorkPage(): React.JSX.Element {
  const app = useApp()
  const { session, state, log, running, busy } = app

  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('paper')
  const [viewVersion, setViewVersion] = useState<number | null>(null)

  const versions = session?.versions ?? []
  const latest = versions.at(-1)
  const shown = useMemo(() => (viewVersion === null ? latest : versions.find((v) => v.version === viewVersion)), [latest, versions, viewVersion])
  const viewingOld = shown !== undefined && latest !== undefined && shown.version !== latest.version

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemView>()
    for (const item of state?.items ?? []) map.set(item.id, item)
    for (const item of session?.slots ?? []) map.set(item.id, item)
    return map
  }, [session, state])

  const rows = (shown?.bindings ?? []).flatMap((binding) => {
    const item = itemsById.get(binding.itemId)
    return item === undefined ? [] : [{ binding, item }]
  })
  const frozen = session?.meta.frozen === true
  // 只显示**这个会话**的活：资料整理是另一条（在「资料」页看）
  const entries = useMemo(() => forWorkspace(log, session?.meta.id ?? ''), [log, session?.meta.id])

  const send = (): void => {
    const text = draft.trim()
    if (running !== null) {
      if (text === '') return
      void app.interject(text)
      setDraft('')
      return
    }
    void app.startRun(text === '' ? '按蓝图出一份课后作业卷' : text)
    setDraft('')
    setViewVersion(null)
  }

  const assemble = (): void => {
    void app.guard('assemble', async () => {
      await api.assemble()
      setViewVersion(null)
      await app.reload()
    })
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0, gap: 2, p: 2 }}>
      {/* 会话记录 */}
      <Card sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <Timeline entries={entries} running={running !== null} />
        </Box>
        <CardContent sx={{ borderTop: 1, borderColor: 'divider', py: 2 }}>
          {running !== null && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
              <Chip color="primary" label="正在做" />
              <Typography variant="caption" color="text.secondary">
                说的下一句它马上会看到
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<StopCircleOutlinedIcon />} disabled={busy !== ''} onClick={() => void app.stopRun()}>
                按停
              </Button>
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
            <TextField
              fullWidth
              multiline
              maxRows={6}
              value={draft}
              placeholder={running === null ? '说说你要什么样的卷子' : '插一句话'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (busy === '') send()
                }
              }}
            />
            <IconButton color="primary" disabled={busy !== '' || (running !== null && draft.trim() === '')} onClick={send}>
              <SendIcon />
            </IconButton>
          </Stack>
          {running === null && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} disabled={busy !== ''} onClick={() => void app.startRun('按蓝图出一份课后作业卷')}>
                出一份课后作业卷
              </Button>
              <Button size="small" variant="outlined" disabled={busy !== '' || frozen} onClick={assemble}>
                按蓝图组卷
              </Button>
              <Typography variant="caption" color="text.secondary">
                {latest === undefined ? '还没有试卷' : `第 ${String(latest.version)} 版`}　题库 {String(state?.items.length ?? 0)} 道
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* 这份卷子 */}
      <Card sx={{ flex: 1.15, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Tabs value={tab} onChange={(_event, next: (typeof TABS)[number]['key']) => setTab(next)} variant="fullWidth">
          {TABS.map((entry) => (
            <Tab key={entry.key} value={entry.key} label={entry.label} />
          ))}
        </Tabs>
        {versions.length > 1 && (
          <Stack direction="row" spacing={1} sx={{ px: 2, pt: 2, flexWrap: 'wrap' }}>
            {versions.map((version) => (
              <Chip
                key={version.version}
                variant={shown?.version === version.version ? 'filled' : 'outlined'}
                color={shown?.version === version.version ? 'primary' : 'default'}
                label={`第 ${String(version.version)} 版`}
                onClick={() => setViewVersion(version.version)}
              />
            ))}
            {viewingOld && <Chip variant="outlined" label="回到最新" onClick={() => setViewVersion(null)} />}
          </Stack>
        )}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {tab === 'paper' && (
            <PaperView
              version={shown}
              rows={rows}
              changes={shown === undefined ? [] : diffVersions(versions[shown.version - 2], shown)}
              frozen={frozen}
              viewingOld={viewingOld}
              busy={busy !== ''}
              onRegenerate={(slotKey) =>
                void app.guard(`regen:${slotKey}`, async () => {
                  const result = await api.regenerate(slotKey)
                  if (!result.ok) throw new Error(result.reason ?? '这道题没能重做，换个要求再试')
                  setViewVersion(null)
                  await app.reload()
                })
              }
              onConfirm={(itemId) =>
                void app.guard(`confirm:${itemId}`, async () => {
                  await api.confirmItem(itemId, '老师')
                  await app.reload()
                })
              }
              onAssemble={assemble}
            />
          )}
          {tab === 'knowledge' && state !== null && <KnowledgeView knowledge={state.knowledge} items={state.items} />}
          {tab === 'evidence' && <EvidenceView rows={rows} versions={versions} />}
          {tab === 'files' && <FilesView name={session?.meta.id ?? ''} tick={entries.length} />}
        </Box>
      </Card>
    </Box>
  )
}
