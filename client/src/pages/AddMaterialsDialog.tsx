import { useRef, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import * as api from '../api.js'
import type { KbBatchView } from '../types.js'
import { MATERIAL_ACCEPT, fileSize } from './materials.js'

/** 保留文件原始字节，文本也不先转 UTF-8；不同编码的原件交给文档工具读取。 */
function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error(`无法读取「${file.name}」，请重新选择文件`))
    reader.onabort = () => reject(new Error(`读取「${file.name}」已中止`))
    reader.readAsDataURL(file)
  })
}

export function AddMaterialsDialog({ open, onClose, onAdded }: {
  open: boolean
  onClose: () => void
  onAdded: (batch: KbBatchView) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'files' | 'folder' | 'text'>('files')
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [files, setFiles] = useState<readonly File[]>([])
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const saving = useRef(false)
  const total = files.reduce((sum, file) => sum + file.size, 0)

  const pick = (incoming: readonly File[]): void => {
    if (saving.current) return
    const additions: File[] = []
    const messages: string[] = []
    for (const file of incoming) {
      const extension = `.${file.name.split('.').at(-1)?.toLowerCase() ?? ''}`
      if (!MATERIAL_ACCEPT.split(',').includes(extension)) messages.push(`「${file.name}」暂不支持，请转换成 PDF 或文本`)
      else if (file.size === 0) messages.push(`「${file.name}」是空文件`)
      else if ([...files, ...additions].some((entry) => entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified)) {
        messages.push(`「${file.name}」已在清单中`)
      } else additions.push(file)
    }
    setFiles((previous) => [...previous, ...additions])
    setHint(messages.join('；'))
    setError('')
  }

  const submit = async (): Promise<void> => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    setProgress(null)
    try {
      let batch: KbBatchView
      if (mode === 'folder') {
        setStage('正在导入文件夹…')
        batch = await api.importKbDir(name.trim(), dir.trim())
      } else {
        const payload: { name: string; text?: string; base64?: string }[] = []
        if (mode === 'text') {
          const filename = pastedName.trim() || '粘贴的资料'
          payload.push({ name: /\.(txt|md)$/i.test(filename) ? filename : `${filename}.txt`, text: pasted })
        } else {
          for (const [index, file] of files.entries()) {
            setStage(`正在读取文件 ${String(index + 1)}/${String(files.length)}：${file.name}`)
            payload.push({ name: file.name, base64: await encodeFile(file) })
          }
        }
        setStage('正在上传…')
        setProgress(0)
        batch = await api.uploadKb(name.trim(), payload, (percent) => {
          setProgress(percent)
          setStage(percent === 100 ? '文件已传送，正在保存…' : `正在上传 ${String(percent)}%`)
        })
      }
      setName(''); setDir(''); setFiles([]); setPasted(''); setPastedName(''); setHint('')
      onAdded(batch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      saving.current = false
      setBusy(false)
      setStage('')
      setProgress(null)
    }
  }

  const ready = mode === 'files' ? files.length > 0 : mode === 'folder' ? dir.trim() !== '' : pasted.trim() !== ''
  return (
    <Dialog open={open} onClose={() => { if (!saving.current) onClose() }} fullWidth maxWidth="sm" aria-labelledby="add-materials-title">
      <DialogTitle id="add-materials-title">添加资料</DialogTitle>
      <DialogContent>
        <Tabs value={mode} onChange={(_event, value: typeof mode) => { setMode(value); setError(''); setHint('') }} aria-label="添加方式" sx={{ mb: 2 }}>
          <Tab value="files" label="上传文件" disabled={busy} />
          <Tab value="folder" label="本机文件夹" disabled={busy} />
          <Tab value="text" label="粘贴文字" disabled={busy} />
        </Tabs>
        <Stack spacing={2}>
          <TextField label="资料名称（选填）" placeholder="例如：二次函数备课资料" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} fullWidth />
          {mode === 'files' && <>
            <Box onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); pick([...event.dataTransfer.files]) }}
              sx={{ p: 3, textAlign: 'center', border: '1px dashed', borderColor: dragging ? 'primary.main' : 'divider', borderRadius: 1, bgcolor: dragging ? 'action.selected' : 'background.default' }}>
              <UploadFileOutlinedIcon color="action" sx={{ mb: 1 }} />
              <Typography variant="body2" sx={{ mb: 1.5 }}>把文件拖到这里，或从电脑选择</Typography>
              <Button component="label" variant="outlined" disabled={busy}>选择文件
                <input hidden type="file" multiple accept={MATERIAL_ACCEPT} onChange={(event) => { pick([...(event.target.files ?? [])]); event.target.value = '' }} />
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>支持 PDF、Word、Excel、图片和文本。大批资料可从本机文件夹导入。</Typography>
            </Box>
            {files.length > 0 && <Box>
              <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>{files.length} 个文件，共 {fileSize(total)}</Typography>
                <Button size="small" disabled={busy} onClick={() => { setFiles([]); setHint(''); setError('') }}>清空清单</Button>
              </Stack>
              <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {files.map((file, index) => <Stack key={`${String(index)}-${file.name}`} direction="row" spacing={1} sx={{ py: 0.5, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ flex: 1, overflowWrap: 'anywhere' }}>{file.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{fileSize(file.size)}</Typography>
                  <IconButton size="small" aria-label={`移除 ${file.name}`} disabled={busy} onClick={() => { setFiles((previous) => previous.filter((_file, at) => at !== index)); setError('') }}><CloseIcon fontSize="small" /></IconButton>
                </Stack>)}
              </Box>
            </Box>}
          </>}
          {mode === 'folder' && <TextField label="文件夹路径" value={dir} onChange={(event) => setDir(event.target.value)} disabled={busy}
            placeholder="例如：D:\教学资料" helperText="填写运行本应用的电脑上的路径。文件保留原位，导入后请勿移动或删除。" fullWidth />}
          {mode === 'text' && <>
            <TextField label="文字标题（选填）" value={pastedName} disabled={busy} onChange={(event) => setPastedName(event.target.value)} fullWidth />
            <TextField label="资料内容" placeholder="粘贴题目、课标片段或教研笔记" value={pasted} disabled={busy} onChange={(event) => setPasted(event.target.value)} multiline minRows={6} maxRows={12} fullWidth />
          </>}
          {hint !== '' && <Alert severity="info" onClose={() => setHint('')}>{hint}</Alert>}
          {error !== '' && <Alert severity="error">{error} 清单已保留，可调整后重试。</Alert>}
          {busy && <Box role="status" aria-live="polite">
            <LinearProgress variant={progress === null || progress === 100 ? 'indeterminate' : 'determinate'} value={progress ?? 0} />
            <Typography variant="caption" sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere' }}>{stage}</Typography>
          </Box>}
          <Typography variant="caption" color="text.secondary">添加后可开始整理，整理出的内容会用于出题参考和查重。</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? '正在添加…' : mode === 'folder' ? '导入文件夹' : mode === 'text' ? '保存文字' : '上传文件'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
