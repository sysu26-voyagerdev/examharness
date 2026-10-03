import { useEffect, useMemo, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
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
 * 知识树（第 5 页）。
 *
 * 这里**只做两件事**：把树看清楚，把连线改对。
 * 它是真相 `知识/*.md` 的窗口——树上每一个点就是一个文件，改完立刻落盘。
 *
 * 刻意**不在这里做**的事（本阶段的范围，ADR-0036）：
 * 不按进度推"已学"、不算"从 A 到 B 怎么补"、不拿它判超纲。
 * 那些要动闸门与判定，等这棵树在老师手里用顺了再说。
 */
export function GraphPage(): React.JSX.Element {
  const app = useApp()
  const { busy } = app

  const [tree, setTree] = useState<GraphView | null>(null)
  const [selected, setSelected] = useState('')
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<{ key: string; stillReferencedBy: readonly string[] } | null>(null)
  const [notice, setNotice] = useState('')

  const load = (): void => {
    void app.guard('graph', async () => {
      setTree(await api.getGraph())
    })
  }

  useEffect(() => {
    load()
    // 只在进入本页时拉一次；之后的刷新由每次保存的返回值驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nodes = useMemo(() => tree?.nodes ?? [], [tree])
  const current = nodes.find((node) => node.key === selected) ?? null

  /** 按分组排好：组之间按组名，组内按 order——这就是"教到哪儿"的阅读顺序 */
  const grouped = useMemo(() => {
    const map = new Map<string, GraphNodeView[]>()
    for (const node of nodes) {
      const list = map.get(node.group) ?? []
      list.push(node)
      map.set(node.group, list)
    }
    return [...map.entries()].map(([group, list]) => [group, list.toSorted((a, b) => a.order - b.order || a.key.localeCompare(b.key, 'zh-Hans-CN'))] as const)
  }, [nodes])

  const save = (node: Parameters<typeof api.saveGraphNode>[0]): void => {
    void app.guard('save', async () => {
      setTree(await api.saveGraphNode(node))
      setSelected(node.key)
      // 工作台的"这一卷用到的知识点"读的是同一份图谱，保存后让它一起刷新
      await app.reload()
    })
  }

  const remove = (key: string): void => {
    void app.guard('remove', async () => {
      const result = await api.removeGraphNode(key)
      setTree(result.tree)
      setSelected('')
      setConfirmRemove(null)
      if (result.stillReferencedBy.length > 0) {
        setNotice(`删掉了「${key}」。${result.stillReferencedBy.join('、')} 还在引它，那几条线现在是断的——去把它们改掉。`)
      }
      await app.reload()
    })
  }

  return (
    <Box sx={{ display: 'flex', gap: 2.5, p: 2.5, height: '100%', minHeight: 0 }}>
      {/* ── 左：树 ───────────────────────────────── */}
      <Box sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            知识树
          </Typography>
          <Tooltip title="新建一个知识点">
            <span>
              <IconButton size="small" disabled={busy !== ''} onClick={() => { setNewKey(''); setAdding(true) }}>
                <AddIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          每条线都是"先学会这个，才学得会那个"
        </Typography>

        {tree !== null && tree.origin.kind === 'json' && (
          <Alert severity="info" sx={{ mb: 1 }}>
            现在读的是旧的 {tree.origin.path}。放好 <code>知识/</code> 目录后重启，树就以那边的文件为准。
          </Alert>
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {grouped.map(([group, list]) => (
            <List
              key={group === '' ? '（未分组）' : group}
              dense
              disablePadding
              subheader={
                <ListSubheader component="div" sx={{ bgcolor: 'transparent', lineHeight: '30px' }}>
                  {group === '' ? '未分组' : group}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {list.length}
                  </Typography>
                </ListSubheader>
              }
            >
              {list.map((node) => (
                <ListItemButton key={node.key} selected={node.key === selected} onClick={() => setSelected(node.key)} sx={{ borderRadius: 1 }}>
                  <Stack sx={{ minWidth: 0, width: '100%' }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                        {node.title}
                      </Typography>
                      {node.dangling.length > 0 && <Chip size="small" color="error" variant="outlined" label="断线" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {node.prerequisites.length === 0 ? '没有前置' : `${String(node.prerequisites.length)} 个前置`}
                      {node.dependents.length > 0 && ` · ${String(node.dependents.length)} 个后续`}
                      {node.depth > 0 && ` · 压着 ${String(node.depth)} 层`}
                    </Typography>
                  </Stack>
                </ListItemButton>
              ))}
            </List>
          ))}
          {tree !== null && nodes.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              还没有知识点。点右上角加第一个。
            </Typography>
          )}
        </Box>
      </Box>

      <Divider orientation="vertical" flexItem />

      {/* ── 右：细节与连线 ───────────────────────── */}
      <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {notice !== '' && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotice('')}>
            {notice}
          </Alert>
        )}

        {tree !== null && tree.diagnostics.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">这棵树有几处要修</Typography>
            {tree.diagnostics.map((entry) => (
              <Typography key={`${entry.kind}-${entry.key}-${entry.detail}`} variant="body2">
                {entry.key}：{entry.detail}
              </Typography>
            ))}
          </Alert>
        )}

        {current === null ? (
          <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              左边点一个知识点，这里就能改它和它的连线。
            </Typography>
          </Box>
        ) : (
          <NodeDetail
            key={current.key}
            node={current}
            all={nodes}
            busy={busy !== ''}
            onSave={save}
            onRemove={() => setConfirmRemove({ key: current.key, stillReferencedBy: current.dependents })}
          />
        )}
      </Box>

      {/* ── 新建 ─────────────────────────────────── */}
      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="xs">
        <DialogTitle>新建知识点</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            名字就是文件名，建完在 <code>知识/</code> 里能直接看到。
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="名字"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            helperText="比如「二次函数图象」。建好之后再连前置"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)}>算了</Button>
          <Button
            variant="contained"
            disableElevation
            disabled={newKey.trim() === '' || busy !== ''}
            onClick={() => {
              setAdding(false)
              save({ key: newKey.trim() })
            }}
          >
            建
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 删除：**先把后果说清楚**再删 ─────────────── */}
      <Dialog open={confirmRemove !== null} onClose={() => setConfirmRemove(null)} fullWidth maxWidth="xs">
        <DialogTitle>删掉「{confirmRemove?.key ?? ''}」？</DialogTitle>
        <DialogContent>
          {confirmRemove !== null && confirmRemove.stillReferencedBy.length > 0 ? (
            <DialogContentText>
              有 {confirmRemove.stillReferencedBy.length} 个知识点拿它当前置：{confirmRemove.stillReferencedBy.join('、')}。
              删掉之后那几条线会断，你得去把它们改掉。
            </DialogContentText>
          ) : (
            <DialogContentText>没有别的知识点引它，删掉不影响别处。</DialogContentText>
          )}
          <DialogContentText sx={{ mt: 1.5 }}>文件也会一起删掉，删了找不回来。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(null)}>不删了</Button>
          <Button color="error" variant="contained" disableElevation disabled={busy !== ''} onClick={() => remove(confirmRemove?.key ?? '')}>
            删掉
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/** 一个知识点的细节：元信息 + 连线编辑 + 备注 */
function NodeDetail({
  node,
  all,
  busy,
  onSave,
  onRemove,
}: {
  node: GraphNodeView
  all: readonly GraphNodeView[]
  busy: boolean
  onSave: (input: Parameters<typeof api.saveGraphNode>[0]) => void
  onRemove: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(node.title)
  const [group, setGroup] = useState(node.group)
  const [order, setOrder] = useState(String(node.order))
  const [note, setNote] = useState(node.note)
  const [prerequisites, setPrerequisites] = useState<readonly string[]>(node.prerequisites)
  const [source, setSource] = useState('')

  // 另一个知识点在界面上叫什么：连线两头都要显示人话，不显示文件键
  const labelOf = useMemo(() => {
    const map = new Map(all.map((entry) => [entry.key, entry.title]))
    return (key: string): string => map.get(key) ?? key
  }, [all])

  const dirty =
    title !== node.title ||
    group !== node.group ||
    order !== String(node.order) ||
    note !== node.note ||
    prerequisites.join('\u0000') !== node.prerequisites.join('\u0000')

  const options = all.filter((entry) => entry.key !== node.key && !prerequisites.includes(entry.key))

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" noWrap>
            {node.title}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.75 }}>
            <Chip size="small" variant="outlined" label={`文件 知识/${node.file}`} />
            {node.depth > 0 && <Chip size="small" variant="outlined" label={`压着 ${String(node.depth)} 层前置`} />}
            {node.dangling.length > 0 && <Chip size="small" color="error" variant="outlined" label={`${String(node.dangling.length)} 条断线`} />}
          </Stack>
        </Box>
        <Tooltip title="看这个知识点的文件原文">
          <Button
            size="small"
            onClick={() => {
              void api.getGraphSource(node.key).then((result) => setSource(result.source))
            }}
          >
            看文件
          </Button>
        </Tooltip>
        <Tooltip title="删掉这个知识点">
          <IconButton size="small" color="error" onClick={onRemove} disabled={busy}>
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {source !== '' && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                知识/{node.file}
              </Typography>
              <IconButton size="small" onClick={() => setSource('')}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Box
              component="pre"
              sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}
            >
              {source}
            </Box>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            它是什么
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
            <TextField label="名字" size="small" value={title} onChange={(event) => setTitle(event.target.value)} sx={{ minWidth: 200, flex: 1 }} />
            <TextField label="归在哪一块" size="small" value={group} onChange={(event) => setGroup(event.target.value)} sx={{ minWidth: 160 }} helperText="比如「函数」" />
            <TextField
              label="教的先后"
              size="small"
              type="number"
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              sx={{ width: 120 }}
              helperText="小的先教"
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2">先学会这些，才学得会它</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            写在文件里就是 ["[[前置知识点]]"]
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75, mb: prerequisites.length === 0 ? 0 : 1.5 }}>
            {prerequisites.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                没有前置：这是这条线的起点
              </Typography>
            )}
            {prerequisites.map((key) => (
              <Chip
                key={key}
                label={labelOf(key)}
                color={node.dangling.includes(key) ? 'error' : 'default'}
                variant={node.dangling.includes(key) ? 'outlined' : 'filled'}
                onDelete={() => setPrerequisites(prerequisites.filter((entry) => entry !== key))}
              />
            ))}
          </Stack>
          <Autocomplete
            size="small"
            options={options}
            getOptionLabel={(option) => option.title}
            renderInput={(params) => <TextField {...params} label="加一个前置" placeholder="搜知识点" />}
            onChange={(_event, value) => {
              if (value !== null) setPrerequisites([...prerequisites, value.key])
            }}
            value={null}
          />
        </CardContent>
      </Card>

      {node.dependents.length > 0 && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              学会它之后才学得会的（{node.dependents.length}）
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
              {node.dependents.map((key) => (
                <Chip key={key} size="small" variant="outlined" label={labelOf(key)} />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              这些线在对方那个文件里写，这里改不了——要改就去点它。
            </Typography>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            备注
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={5}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="学生常在这儿卡住的地方、你的讲法、跟别的知识点的关系……"
          />
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          disableElevation
          startIcon={<SaveOutlinedIcon />}
          disabled={busy || !dirty}
          onClick={() =>
            onSave({
              key: node.key,
              title,
              group,
              order: Number(order) || 0,
              note,
              prerequisites: [...prerequisites],
            })
          }
        >
          保存
        </Button>
        {dirty && (
          <Typography variant="caption" color="text.secondary">
            改完记得保存，保存就是写文件
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}
