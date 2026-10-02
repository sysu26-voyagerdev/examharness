import { useState } from 'react'
import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { SessionMetaView } from '../types.js'

/**
 * 会话：一份卷子一个会话，分组是给"一个班一学期"用的。
 *
 * 这一页只做三件事：**打开**某个会话、**整理**会话（分组/改名）、**新建**会话。
 * 所以是"列表 + 右侧详情"：左边一眼看完所有会话，右边交代选中的那个是什么。
 */
export function SessionsPage(): React.JSX.Element {
  const app = useApp()
  const { sessions, session, kb, busy } = app
  const defaults = sessions?.defaults ?? { className: '', progress: '', blueprintPath: '' }
  const list = sessions?.sessions ?? []
  const groups = sessions?.groups ?? []

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ title: '', ...defaults, groupId: '', kbId: '' })
  const [picked, setPicked] = useState<string>('')
  const [groupMenu, setGroupMenu] = useState<{ anchor: HTMLElement; sessionId: string } | null>(null)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const selectedId = picked === '' ? (session?.meta.id ?? '') : picked
  const selected = list.find((meta) => meta.id === selectedId) ?? list[0]

  const open = (meta: SessionMetaView): void => {
    void app.guard('switch', async () => {
      if (meta.id !== session?.meta.id) await api.switchSession(meta.id)
      await app.reload()
    })
    app.go('work')
  }

  const move = (sessionId: string, groupId: string): void => {
    void app.guard('group', async () => {
      await api.moveSessionToGroup(sessionId, groupId)
      await app.reload()
    })
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

  /** 一行会话：名字 + 它是哪个班的/讲到哪里 + 打开；分组这种事收进一个图标菜单 */
  const row = (meta: SessionMetaView): React.JSX.Element => (
    <ListItemButton
      key={meta.id}
      selected={meta.id === selectedId}
      onClick={() => setPicked(meta.id)}
      sx={{ borderRadius: 2, alignItems: 'flex-start', py: 1 }}
    >
      <ListItemText
        disableTypography
        primary={
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {meta.title}
            </Typography>
            {session?.meta.id === meta.id && <Chip size="small" variant="outlined" label="正在用" />}
            {meta.frozen && <Chip size="small" variant="outlined" icon={<CheckCircleIcon />} label="已定稿" />}
          </Stack>
        }
        secondary={
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {meta.className}
            {meta.progress === '' ? '' : ` · ${meta.progress}`}
            {meta.kbId === '' ? '' : ` · 资料 ${kb?.batches.find((batch) => batch.id === meta.kbId)?.name ?? ''}`}
          </Typography>
        }
      />
      <Tooltip title="移到分组">
        <IconButton
          size="small"
          disabled={busy !== ''}
          onClick={(event) => {
            event.stopPropagation()
            setGroupMenu({ anchor: event.currentTarget, sessionId: meta.id })
          }}
        >
          <DriveFileMoveOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </ListItemButton>
  )

  const section = (name: string, items: readonly SessionMetaView[], groupId: string): React.JSX.Element => (
    <Box key={groupId === '' ? '__none__' : groupId} sx={{ mb: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 1, mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {name}
          {items.length > 0 ? `（${String(items.length)}）` : ''}
        </Typography>
        {groupId !== '' && (
          <Tooltip title="分组改名">
            <IconButton size="small" onClick={() => setRenaming({ id: groupId, name })}>
              <EditOutlinedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {items.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
          还没有会话
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map(row)}
        </List>
      )}
    </Box>
  )

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">会话</Typography>
        <Typography variant="caption" color="text.secondary">
          一份卷子一个会话
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disableElevation startIcon={<AddOutlinedIcon />} disabled={busy !== ''} onClick={() => setCreating(true)}>
          新建会话
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} sx={{ alignItems: 'flex-start' }}>
        <Card sx={{ flex: 1, minWidth: 0, width: '100%', p: 1.5 }}>
          {groups.map((group) => section(group.name, list.filter((meta) => meta.groupId === group.id), group.id))}
          {section('未分组', list.filter((meta) => meta.groupId === ''), '')}
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ px: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              label="新建分组"
              placeholder="例如 初三(2)班 九上"
              value={newGroup ?? ''}
              onChange={(event) => setNewGroup(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              disabled={busy !== '' || (newGroup ?? '').trim() === ''}
              onClick={() =>
                void app.guard('group', async () => {
                  await api.createGroup((newGroup ?? '').trim())
                  setNewGroup('')
                  await app.reload()
                })
              }
            >
              建好
            </Button>
          </Stack>
        </Card>

        {/* 右边：选中的那个会话是什么、下一步做什么 */}
        <Card sx={{ width: { xs: '100%', md: 340 }, flexShrink: 0, p: 2.5 }}>
          {selected === undefined ? (
            <Typography variant="body2" color="text.secondary">
              左边选一个会话，这里会显示它的班级、进度与蓝图。
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="subtitle1">{selected.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {selected.className}
                  {selected.progress === '' ? '' : ` · ${selected.progress}`}
                </Typography>
              </Box>
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  蓝图
                </Typography>
                {selected.blueprintPath === '' ? (
                  <Typography variant="body2">还没选</Typography>
                ) : (
                  <Tooltip title={selected.blueprintPath}>
                    {/* 老师认的是卷子的名字，不是文件路径 */}
                    <Typography variant="body2">
                      {selected.blueprintPath.split('/').at(-1)?.replace(/\.json$/u, '') ?? selected.blueprintPath}
                    </Typography>
                  </Tooltip>
                )}
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  资料
                </Typography>
                <Typography variant="body2">
                  {selected.kbId === '' ? '不用资料' : (kb?.batches.find((batch) => batch.id === selected.kbId)?.name ?? '未知批次')}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  创建于
                </Typography>
                <Typography variant="body2">{new Date(selected.createdAt).toLocaleString('zh-CN')}</Typography>
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" disableElevation disabled={busy !== ''} onClick={() => open(selected)}>
                  {selected.id === session?.meta.id ? '回到工作台' : '打开'}
                </Button>
                <TextField
                  select
                  size="small"
                  label="移到"
                  value={selected.groupId}
                  disabled={busy !== ''}
                  onChange={(event) => move(selected.id, event.target.value)}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="">未分组</MenuItem>
                  {groups.map((group) => (
                    <MenuItem key={group.id} value={group.id}>
                      {group.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Stack>
          )}
        </Card>
      </Stack>

      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>分组改名</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="分组叫什么"
            value={renaming?.name ?? ''}
            onChange={(event) => setRenaming(renaming === null ? null : { ...renaming, name: event.target.value })}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>算了</Button>
          <Button
            variant="contained"
            disableElevation
            disabled={busy !== '' || (renaming?.name ?? '').trim() === ''}
            onClick={() => {
              const target = renaming
              setRenaming(null)
              if (target === null) return
              void app.guard('group', async () => {
                await api.renameGroup(target.id, target.name.trim())
                await app.reload()
              })
            }}
          >
            改好
          </Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={groupMenu?.anchor} open={groupMenu !== null} onClose={() => setGroupMenu(null)}>
        <MenuItem
          onClick={() => {
            if (groupMenu !== null) move(groupMenu.sessionId, '')
            setGroupMenu(null)
          }}
        >
          未分组
        </MenuItem>
        {groups.map((group) => (
          <MenuItem
            key={group.id}
            onClick={() => {
              if (groupMenu !== null) move(groupMenu.sessionId, group.id)
              setGroupMenu(null)
            }}
          >
            {group.name}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <DialogTitle>新建会话</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="这份卷子叫什么"
              value={draft.title}
              autoFocus
              placeholder={`新会话 ${String(list.length + 1)}`}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Stack direction="row" spacing={2}>
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
            </Stack>
            <TextField
              label="蓝图"
              value={draft.blueprintPath}
              helperText="双向细目表：每个题位考什么、多少分、多难。可以先留着，回头在「工作台」里换。"
              onChange={(event) => setDraft({ ...draft, blueprintPath: event.target.value })}
            />
            <Stack direction="row" spacing={2}>
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
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>算了</Button>
          <Button variant="contained" disableElevation disabled={busy !== ''} onClick={create}>
            建好
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
