import { useMemo, useState } from 'react'
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { EvidenceView, FilesView, Flex, KnowledgeView, PaperView, Timeline } from '../components.js'
import type { ItemView, SlotChangeView, VersionView } from '../types.js'

/**
 * 工作台：左边会话，中间记录，右边这份卷子。
 *
 * 中间那一条是**会话记录**：老师说的、agent 做的、检查的结论，按时间排在一起。
 * 跑起来时输入框变成插话——它下一步会读到；也可以直接按停。
 */

const TABS = [
  { key: 'paper', label: '试卷' },
  { key: 'knowledge', label: '知识点' },
  { key: 'evidence', label: '依据' },
  { key: 'files', label: '文件' },
] as const

/** 两版之间的题位变化（服务端只算最新一版，界面要能看任意两版） */
export function diffVersions(before: VersionView | undefined, after: VersionView): SlotChangeView[] {
  if (before === undefined) return []
  const slots = new Set([
    ...before.bindings.map((binding) => binding.slot),
    ...after.bindings.map((binding) => binding.slot),
  ])
  return [...slots].toSorted().map((slot) => {
    const a = before.bindings.find((binding) => binding.slot === slot)
    const b = after.bindings.find((binding) => binding.slot === slot)
    if (a === undefined && b !== undefined) return { slot, change: 'added' as const, to: b.itemId }
    if (a !== undefined && b === undefined) return { slot, change: 'removed' as const, from: a.itemId }
    if (a !== undefined && b !== undefined && a.itemId !== b.itemId) {
      return { slot, change: 'replaced' as const, from: a.itemId, to: b.itemId }
    }
    return { slot, change: 'same' as const }
  })
}

export function WorkPage(): React.JSX.Element {
  const app = useApp()
  const { session, sessions, state, log, running, busy } = app

  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('paper')
  const [viewVersion, setViewVersion] = useState<number | null>(null)

  const versions = session?.versions ?? []
  const latest = versions.at(-1)
  const shown = useMemo(
    () => (viewVersion === null ? latest : versions.find((version) => version.version === viewVersion)),
    [latest, versions, viewVersion],
  )
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
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '224px 1fr 1.05fr' }, height: 'calc(100vh - 52px)' }}>
      {/* 会话 */}
      <Box sx={{ borderRight: { md: '1px solid' }, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Flex row align="center" sx={{ px: 1.5, py: 1.25 }}>
          <Typography variant="caption">会话</Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="新建会话">
            <IconButton
              size="small"
              disabled={busy !== ''}
              onClick={() =>
                void app.guard('new', async () => {
                  await api.createSession()
                  setViewVersion(null)
                  await app.reload()
                })
              }
            >
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Flex>
        <List dense sx={{ overflowY: 'auto', px: 0.5, pb: 1 }}>
          {(sessions?.sessions ?? []).map((meta) => (
            <ListItemButton
              key={meta.id}
              selected={session?.meta.id === meta.id}
              onClick={() =>
                void app.guard('switch', async () => {
                  if (meta.id === session?.meta.id) return
                  await api.switchSession(meta.id)
                  setViewVersion(null)
                  await app.reload()
                })
              }
            >
              <ListItemText
                primary={meta.title}
                secondary={meta.frozen ? '已定稿' : meta.className}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flex: 1 }} />
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" sx={{ display: 'block' }}>
            {session === null ? '' : `${session.meta.className}　${session.meta.progress}`}
          </Typography>
          <Button size="small" sx={{ mt: 0.5, px: 0 }} onClick={() => app.go('sessions')}>
            管理会话
          </Button>
        </Box>
      </Box>

      {/* 记录 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <Timeline entries={log} running={running !== null} />
        </Box>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          {running !== null && (
            <Flex row gap={1} align="center" sx={{ mb: 1 }}>
              <Chip size="small" color="primary" variant="outlined" label="正在做" />
              <Typography variant="caption">说的下一句它马上会看到</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" startIcon={<StopCircleOutlinedIcon fontSize="small" />} disabled={busy !== ''} onClick={() => void app.stopRun()}>
                按停
              </Button>
            </Flex>
          )}
          <Flex row gap={1} align="flex-end">
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
            <IconButton color="primary" disabled={busy !== '' || (running !== null && draft.trim() === '')} onClick={send} title="发送">
              <SendOutlinedIcon />
            </IconButton>
          </Flex>
          {running === null && (
            <Flex row gap={2} sx={{ mt: 1 }} align="center">
              <Button size="small" sx={{ px: 0 }} disabled={busy !== ''} onClick={() => void app.startRun('按蓝图出一份课后作业卷')}>
                出一份课后作业卷
              </Button>
              <Button size="small" sx={{ px: 0 }} disabled={busy !== '' || frozen} onClick={assemble}>
                按蓝图组卷
              </Button>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption">
                {latest === undefined ? '还没有试卷' : `第 ${latest.version} 版`}　{state?.items.length ?? 0} 道题在库
              </Typography>
            </Flex>
          )}
        </Box>
      </Box>

      {/* 这份卷子 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: 'background.default' }}>
        <Tabs value={tab} onChange={(_event, next: (typeof TABS)[number]['key']) => setTab(next)}>
          {TABS.map((entry) => (
            <Tab key={entry.key} value={entry.key} label={entry.label} />
          ))}
        </Tabs>
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {versions.length > 1 && (
            <Flex row gap={0.75} sx={{ px: 2, pt: 1.5 }} wrap>
              {versions.map((version) => (
                <Chip
                  key={version.version}
                  size="small"
                  variant={shown?.version === version.version ? 'filled' : 'outlined'}
                  label={`第 ${version.version} 版`}
                  onClick={() => setViewVersion(version.version)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
              {viewingOld && <Chip size="small" variant="outlined" label="回到最新" onClick={() => setViewVersion(null)} sx={{ cursor: 'pointer' }} />}
            </Flex>
          )}
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
          {/* 文件列表跟着记录一起刷新：agent 每走一步都可能多出一个文件 */}
          {tab === 'files' && <FilesView name={session?.meta.id ?? ''} tick={log.length} />}
        </Box>
      </Box>
    </Box>
  )
}
