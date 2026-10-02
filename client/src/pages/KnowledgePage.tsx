import { useMemo, useState } from 'react'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { FilesView, Timeline } from '../components.js'
import { forWorkspace } from '../log.js'
import type { KbBatchView, KbStatus } from '../types.js'

const STATUS: Readonly<Record<KbStatus, { text: string; color?: 'warning' | 'success' | 'info' }>> = {
  raw: { text: '待整理', color: 'info' },
  ingesting: { text: '整理中', color: 'warning' },
  indexed: { text: '整理完成', color: 'success' },
  failed: { text: '没有整理完', color: 'warning' },
}

export function KnowledgePage(): React.JSX.Element {
  const app = useApp()
  const { kb, settings, log, running, busy } = app

  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [files, setFiles] = useState<readonly { name: string; text?: string; base64?: string }[]>([])
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')
  const [reading, setReading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState('')
  const [fileName, setFileName] = useState('')
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [offset, setOffset] = useState(0)

  const configured = settings?.runtime.modelConfigured === true
  const pending = pasted.trim() === '' ? files : [...files, { name: pastedName === '' ? '粘贴的资料.txt' : pastedName, text: pasted }]

  // 只显示**这一批**的活：主 agent 的对话属于工作台，不该混进来
  const entries = useMemo(() => forWorkspace(log, open), [log, open])

  const pick = async (list: FileList | null): Promise<void> => {
    setReading(true)
    try {
      setFiles(
        await Promise.all(
          [...(list ?? [])].map(async (file) => {
            const binary = /\.(pdf|docx|xlsx|xlsm|png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)
            if (!binary) return { name: file.name, text: await file.text() }
            const bytes = new Uint8Array(await file.arrayBuffer())
            let raw = ''
            for (const byte of bytes) raw += String.fromCharCode(byte)
            return { name: file.name, base64: btoa(raw) }
          }),
        ),
      )
    } finally {
      setReading(false)
    }
  }

  const upload = (): void => {
    void app.guard('upload', async () => {
      const batch = await api.uploadKb(name.trim(), pending)
      setAdding(false)
      setName('')
      setFiles([])
      setPasted('')
      setOpen(batch.id)
      setFileName('')
      setChunk(null)
      await app.reload()
    })
  }

  const load = (batchId: string, file: string, at: number): void => {
    void app.guard('preview', async () => {
      setOpen(batchId)
      setFileName(file)
      setOffset(at)
      setChunk(await api.previewKb(batchId, file, at))
    })
  }

  const batches = kb?.batches ?? []

  const importDir = (): void => {
    void app.guard('import', async () => {
      const batch = await api.importKbDir(name.trim(), dir.trim())
      setName('')
      setDir('')
      setAdding(false)
      setOpen(batch.id)
      await app.reload()
    })
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', minHeight: 0, gap: 2.5, p: 2.5 }}>
      <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
          <Typography variant="h5">资料</Typography>
          <Typography variant="caption" color="text.secondary">
            真题、课标、教材——出题时的参考，也是判重的依据
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" disableElevation startIcon={<UploadFileOutlinedIcon />} disabled={busy !== ''} onClick={() => setAdding(true)}>
            加资料
          </Button>
        </Stack>

        {/* 三种加法是**三件不同的事**（上传小文件 / 指向大文件夹 / 贴一段文字），
            摆在一个表单里只会让人犹豫——收进对话框，一次选一种 */}
        <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="sm">
          <DialogTitle>加一批资料</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <TextField
                label="给这批资料起个名字"
                value={name}
                placeholder="例如 2023 中考真题"
                onChange={(event) => setName(event.target.value)}
              />
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  小文件直接上传
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button component="label" variant="outlined" size="small" disabled={reading} startIcon={<UploadFileOutlinedIcon />}>
                    选择文件
                    <input
                      hidden
                      type="file"
                      multiple
                      accept=".txt,.md,.csv,.jsonl,.pdf,.docx,.xlsx,.png,.jpg,.jpeg"
                      onChange={(event) => void pick(event.target.files)}
                    />
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    {pending.length === 0 ? '还没有选文件' : pending.map((file) => file.name).join('　')}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button variant="contained" disableElevation size="small" disabled={busy !== '' || pending.length === 0} onClick={upload}>
                    上传
                  </Button>
                </Stack>
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  教材、课标这类几十 GB 的：指一个本机文件夹
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    label="文件夹路径"
                    value={dir}
                    placeholder="/home/…/课标、教材、教参"
                    helperText="文件原地不动，整理时链接进工作区"
                    onChange={(event) => setDir(event.target.value)}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{ mt: 0.5 }}
                    disabled={busy !== '' || dir.trim() === ''}
                    onClick={importDir}
                  >
                    导入
                  </Button>
                </Stack>
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  或者直接贴一段文字
                </Typography>
                <Stack spacing={1}>
                  <TextField value={pasted} multiline minRows={2} maxRows={6} placeholder="把题目或课标片段贴进来" onChange={(event) => setPasted(event.target.value)} />
                  {pasted.trim() !== '' && (
                    <TextField label="这段文字叫什么" value={pastedName} onChange={(event) => setPastedName(event.target.value)} />
                  )}
                </Stack>
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAdding(false)}>算了</Button>
          </DialogActions>
        </Dialog>

        {batches.length === 0 && (
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                还没有资料。加上一批之后，出题时会拿它做参考，也会拿来判重。
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* 卡片不要铺满 1500px 的屏：一行文字超过 ~90 字就看不住了 */}
        <Stack spacing={2} sx={{ maxWidth: 900 }}>
          {batches.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              busy={busy !== ''}
              running={running !== null}
              configured={configured}
              open={open === batch.id}
              fileName={fileName}
              chunk={chunk}
              offset={offset}
              onOpen={() => setOpen(batch.id)}
              onLoad={load}
              onIngest={() => {
                void app.guard('ingest', async () => {
                  await api.ingestKb(batch.id)
                  setOpen(batch.id)
                  await app.reload()
                })
              }}
            />
          ))}
        </Stack>
      </Box>

      {/* 整理记录：**选了一批才出现**——不该为"可能要看"常占三分之一屏 */}
      <Card sx={{ flex: 0.8, minWidth: 320, display: open === '' ? 'none' : 'flex', flexDirection: 'column' }}>
        <CardHeader
          title="整理记录"
          subheader={open === '' ? '选一批资料，这里显示它读到了什么' : (batches.find((batch) => batch.id === open)?.name ?? '')}
          action={running !== null ? <Chip color="warning" label="正在整理" /> : undefined}
        />
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {open === '' ? (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">
                先选一批资料，这里会显示它读到了什么、抽出了什么。
              </Typography>
            </Box>
          ) : (
            <Timeline entries={entries} running={running !== null} />
          )}
        </Box>
        {open !== '' && (
          <Box sx={{ borderTop: 1, borderColor: 'divider', maxHeight: 260, overflowY: 'auto' }}>
            <FilesView name={open} tick={entries.length} />
          </Box>
        )}
      </Card>
    </Box>
  )
}

function BatchCard({
  batch,
  busy,
  running,
  configured,
  open,
  fileName,
  chunk,
  offset,
  onOpen,
  onLoad,
  onIngest,
}: {
  batch: KbBatchView
  busy: boolean
  running: boolean
  configured: boolean
  open: boolean
  fileName: string
  chunk: { text: string; total: number; next?: number } | null
  offset: number
  onOpen: () => void
  onLoad: (batchId: string, file: string, at: number) => void
  onIngest: () => void
}): React.JSX.Element {
  const status = STATUS[batch.status]
  return (
    <Card>
      <CardHeader
        avatar={<FolderOpenOutlinedIcon color="action" />}
        title={batch.name}
        subheader={`${String(batch.files.length)} 个文件${batch.records > 0 ? `　抽到 ${String(batch.records)} 条` : ''}　${new Date(batch.at).toLocaleString('zh-CN')}`}
        action={
          <Stack direction="row" spacing={1}>
            <Chip color={status.color} label={status.text} />
            {batch.sourceDir !== undefined && <Chip variant="outlined" label="本机文件夹" title={batch.sourceDir} />}
          </Stack>
        }
      />
      {batch.note !== undefined && (
        <CardContent sx={{ pt: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {batch.note}
          </Typography>
        </CardContent>
      )}
      <Collapse in={open} unmountOnExit>
        <CardContent sx={{ pt: batch.note === undefined ? 0 : 1 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            {batch.files.slice(0, 20).map((file) => (
              <Chip
                key={file.name}
                variant={file.name === fileName ? 'filled' : 'outlined'}
                color={file.name === fileName ? 'primary' : 'default'}
                label={file.name}
                onClick={() => onLoad(batch.id, file.name, 0)}
              />
            ))}
            {batch.files.length > 20 && <Chip variant="outlined" label={`…还有 ${String(batch.files.length - 20)} 个`} />}
          </Stack>
          {chunk === null ? (
            <Typography variant="caption" color="text.secondary">
              选一个文件看内容。
            </Typography>
          ) : (
            <>
              <Box sx={{ maxHeight: 300, overflow: 'auto', bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
                <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                  {chunk.text}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" disabled={busy || offset === 0} onClick={() => onLoad(batch.id, fileName, Math.max(0, offset - 4000))}>
                  上一段
                </Button>
                <Button size="small" disabled={busy || chunk.next === undefined} onClick={() => onLoad(batch.id, fileName, chunk.next ?? offset)}>
                  下一段
                </Button>
              </Stack>
            </>
          )}
        </CardContent>
      </Collapse>
      <CardActions>
        <Button size="small" disabled={busy} onClick={onOpen}>
          {open ? '收起' : '看一下'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="contained"
          startIcon={<PlayArrowIcon />}
          disabled={busy || running || batch.status === 'ingesting'}
          title={configured ? 'agent 读资料、抽题、写进语料' : '先去设置里配置模型'}
          onClick={onIngest}
        >
          让 agent 整理
        </Button>
      </CardActions>
    </Card>
  )
}
