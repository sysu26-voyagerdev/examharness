import { useState } from 'react'
import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Flex } from '../components.js'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { SessionMetaView } from '../types.js'

/**
 * 会话：一份卷子一个会话。分组是给"一个班一学期"用的。
 *
 * 新建会话一次问清四件事——班级、进度、蓝图、用哪批资料——因为 agent 每次开工都要读它们。
 */
export function SessionsPage(): React.JSX.Element {
  const app = useApp()
  const { sessions, session, kb, busy } = app
  const defaults = sessions?.defaults ?? { className: '', progress: '', blueprintPath: '' }

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ title: '', ...defaults, groupId: '', kbId: '' })
  const [groupName, setGroupName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const groups = sessions?.groups ?? []
  const list = sessions?.sessions ?? []
  const inGroup = (groupId: string): readonly SessionMetaView[] => list.filter((meta) => meta.groupId === groupId)

  const open = (meta: SessionMetaView): void => {
    void app.guard('switch', async () => {
      if (meta.id !== session?.meta.id) await api.switchSession(meta.id)
      await app.reload()
    })
    app.go('work')
  }

  const create = (): void => {
    void app.guard('new', async () => {
      await api.createSession({
        title: draft.title === '' ? `新会话 ${String(list.length + 1)}` : draft.title,
        className: draft.className,
        progress: draft.progress,
        blueprintPath: draft.blueprintPath,
        groupId: draft.groupId,
        kbId: draft.kbId,
      })
      setCreating(false)
      setDraft({ title: '', ...defaults, groupId: '', kbId: '' })
      await app.reload()
    })
  }

  const row = (meta: SessionMetaView): React.JSX.Element => (
    <Flex
      key={meta.id}
      row
      gap={1.5}
      align="center"
      sx={{
        px: 2,
        py: 1.25,
        borderRadius: 2,
        '&:hover': { bgcolor: 'action.hover' },
        ...(session?.meta.id === meta.id ? { bgcolor: 'action.selected' } : {}),
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Flex row gap={0.75} align="center" wrap>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
            {meta.title}
          </Typography>
          {session?.meta.id === meta.id && <Chip size="small" variant="outlined" label="当前" />}
          {meta.frozen && <Chip size="small" variant="outlined" label="已定稿" />}
        </Flex>
        <Typography variant="caption" noWrap sx={{ display: 'block' }}>
          {meta.className}　{meta.progress}
          {meta.kbId === '' ? '' : `　资料 ${kb?.batches.find((batch) => batch.id === meta.kbId)?.name ?? meta.kbId}`}
        </Typography>
      </Box>

      <TextField
        select
        size="small"
        value={meta.groupId}
        disabled={busy !== ''}
        onChange={(event) =>
          void app.guard('group', async () => {
            await api.moveSessionToGroup(meta.id, event.target.value)
            await app.reload()
          })
        }
        sx={{ width: 132 }}
      >
        <MenuItem value="">未分组</MenuItem>
        {groups.map((group) => (
          <MenuItem key={group.id} value={group.id}>
            {group.name}
          </MenuItem>
        ))}
      </TextField>

      <Button size="small" disabled={busy !== ''} onClick={() => open(meta)}>
        打开
      </Button>
    </Flex>
  )

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Flex row gap={2} align="center" sx={{ mb: 2 }}>
        <Typography variant="h2">会话</Typography>
        <Typography variant="caption">
          {list.length} 个　{groups.length} 个分组
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          size="small"
          startIcon={<AddOutlinedIcon fontSize="small" />}
          disabled={busy !== ''}
          onClick={() => {
            setDraft({ title: '', ...defaults, groupId: '', kbId: '' })
            setCreating(true)
          }}
        >
          新建会话
        </Button>
      </Flex>

      {groups.map((group) => (
        <Box key={group.id} sx={{ mb: 2.5 }}>
          <Flex row gap={1} align="center" sx={{ px: 2, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {group.name}
            </Typography>
            <Typography variant="caption">{inGroup(group.id).length} 个</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setRenaming({ id: group.id, name: group.name })}>
              改名
            </Button>
          </Flex>
          {inGroup(group.id).length === 0 ? (
            <Typography variant="caption" sx={{ px: 2 }}>
              这个分组还没有会话
            </Typography>
          ) : (
            inGroup(group.id).map(row)
          )}
          <Divider sx={{ mt: 1.5 }} />
        </Box>
      ))}

      <Box>
        <Flex row gap={1} align="center" sx={{ px: 2, mb: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            未分组
          </Typography>
          <Typography variant="caption">{inGroup('').length} 个</Typography>
        </Flex>
        {inGroup('').length === 0 ? (
          <Typography variant="caption" sx={{ px: 2 }}>
            没有未分组的会话
          </Typography>
        ) : (
          inGroup('').map(row)
        )}
      </Box>

      <Flex row gap={1.5} sx={{ mt: 4, maxWidth: 420 }} align="flex-end">
        <TextField
          fullWidth
          label="新建分组"
          value={groupName}
          placeholder="例如 初三(2)班 九上"
          onChange={(event) => setGroupName(event.target.value)}
        />
        <Button
          size="small"
          disabled={busy !== '' || groupName.trim() === ''}
          onClick={() =>
            void app.guard('group', async () => {
              await api.createGroup(groupName.trim())
              setGroupName('')
              await app.reload()
            })
          }
        >
          创建
        </Button>
      </Flex>

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建会话</DialogTitle>
        <DialogContent>
          <Flex gap={2} sx={{ mt: 0.5 }}>
            <TextField
              label="这份卷子叫什么"
              value={draft.title}
              autoFocus
              placeholder={`新会话 ${String(list.length + 1)}`}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Flex row gap={2}>
              <TextField
                label="班级"
                fullWidth
                value={draft.className}
                onChange={(event) => setDraft({ ...draft, className: event.target.value })}
              />
              <TextField
                label="讲到哪里了"
                fullWidth
                value={draft.progress}
                onChange={(event) => setDraft({ ...draft, progress: event.target.value })}
              />
            </Flex>
            <TextField
              label="蓝图"
              value={draft.blueprintPath}
              helperText="双向细目表：每个题位考什么、多少分、多难"
              onChange={(event) => setDraft({ ...draft, blueprintPath: event.target.value })}
            />
            <Flex row gap={2}>
              <TextField
                select
                label="分组"
                fullWidth
                value={draft.groupId}
                onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
              >
                <MenuItem value="">未分组</MenuItem>
                {groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="用哪批资料"
                fullWidth
                value={draft.kbId}
                onChange={(event) => setDraft({ ...draft, kbId: event.target.value })}
              >
                <MenuItem value="">不用</MenuItem>
                {(kb?.batches ?? []).map((batch) => (
                  <MenuItem key={batch.id} value={batch.id}>
                    {batch.name}
                    {batch.status === 'indexed' ? `（${String(batch.records)} 条）` : '（还没整理）'}
                  </MenuItem>
                ))}
              </TextField>
            </Flex>
          </Flex>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreating(false)}>取消</Button>
          <Button variant="contained" disabled={busy !== ''} onClick={create}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>分组改名</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            autoFocus
            value={renaming?.name ?? ''}
            onChange={(event) => setRenaming(renaming === null ? null : { ...renaming, name: event.target.value })}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRenaming(null)}>取消</Button>
          <Button
            variant="contained"
            disabled={busy !== '' || renaming === null}
            onClick={() =>
              void app.guard('rename', async () => {
                if (renaming === null) return
                await api.renameGroup(renaming.id, renaming.name)
                setRenaming(null)
                await app.reload()
              })
            }
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
