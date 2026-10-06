import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CloseIcon from '@mui/icons-material/Close'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import { Alert, Box, Button, Chip, IconButton, LinearProgress, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Tabs, TextField, Typography } from '@mui/material'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { FilesView, Timeline } from '../components.js'
import { forWorkspace } from '../log.js'
import type { KbBatchView, KbStatus } from '../types.js'
import { AddMaterialsDialog } from './AddMaterialsDialog.js'
import { MATERIAL_STATUS, fileSize, isTextMaterial } from './materials.js'

export function KnowledgePage(): React.JSX.Element {
  const app = useApp()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<KbStatus | 'all'>('all')
  const [source, setSource] = useState<'all' | 'upload' | 'folder'>('all')
  const [sort, setSort] = useState<'recent' | 'name'>('recent')
  const [page, setPage] = useState(0)
  const batches = app.kb?.batches ?? []
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return batches.filter((batch) =>
      (status === 'all' || batch.status === status)
      && (source === 'all' || (source === 'folder') === (batch.sourceDir !== undefined))
      && (needle === '' || [batch.name, batch.sourceDir ?? '', ...batch.files.map((file) => file.name)]
        .some((text) => text.toLocaleLowerCase().includes(needle))))
      .toSorted((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : b.at.localeCompare(a.at))
  }, [batches, query, status, source, sort])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(visible.length / 10) - 1))
  const batch = batches.find((entry) => entry.id === selected)
  const clear = (): void => { setQuery(''); setStatus('all'); setSource('all'); setPage(0) }
  return (
    <Box sx={{ minHeight: 0, p: { xs: 1.5, md: 2.5 } }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">资料库</Typography>
          <Typography variant="body2" color="text.secondary">管理出题参考，查看整理进度。</Typography>
        </Box>
        <Button variant="contained" startIcon={<UploadFileOutlinedIcon />} onClick={() => setAdding(true)}>添加资料</Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="搜索资料或文件名" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} sx={{ flex: 1, minWidth: 160 }} />
        <TextField select label="整理状态" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(0) }} sx={{ minWidth: 130 }}>
          <MenuItem value="all">全部状态</MenuItem>
          {Object.entries(MATERIAL_STATUS).map(([value, text]) => <MenuItem key={value} value={value}>{text}</MenuItem>)}
        </TextField>
        <TextField select label="来源" value={source} onChange={(event) => { setSource(event.target.value as typeof source); setPage(0) }} sx={{ minWidth: 130 }}>
          <MenuItem value="all">全部来源</MenuItem><MenuItem value="upload">上传或粘贴</MenuItem><MenuItem value="folder">本机文件夹</MenuItem>
        </TextField>
        <TextField select label="排序" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(0) }} sx={{ minWidth: 130 }}>
          <MenuItem value="recent">最近添加</MenuItem><MenuItem value="name">名称顺序</MenuItem>
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary">共 {batches.length} 批资料，显示 {visible.length} 批</Typography>
      {app.kb === null ? <LinearProgress sx={{ my: 2 }} /> : visible.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 7 }}>
          <FolderOpenOutlinedIcon color="action" sx={{ fontSize: 36, mb: 1 }} />
          <Typography variant="body1">{batches.length === 0 ? '把备课资料放在这里' : '没有找到匹配的资料'}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{batches.length === 0 ? '上传文件、导入文件夹，或粘贴一段文字。' : '试试其他关键词，或清除筛选条件。'}</Typography>
          <Button onClick={batches.length === 0 ? () => setAdding(true) : clear}>{batches.length === 0 ? '添加第一批资料' : '清除筛选'}</Button>
        </Box>
      ) : <>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="资料列表" sx={{ mt: 1 }}>
            <TableHead><TableRow><TableCell>资料</TableCell><TableCell>状态</TableCell><TableCell align="right">文件</TableCell><TableCell align="right">操作</TableCell></TableRow></TableHead>
            <TableBody>{visible.slice(currentPage * 10, currentPage * 10 + 10).map((entry) => <TableRow key={entry.id} selected={entry.id === selected}>
              <TableCell sx={{ maxWidth: 420 }}>
                <Button variant="text" sx={{ textAlign: 'left', justifyContent: 'flex-start', p: 0, overflowWrap: 'anywhere' }} onClick={() => setSelected(entry.id)}>{entry.name}</Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{entry.sourceDir === undefined ? '上传或粘贴' : '本机文件夹'} · {new Date(entry.at).toLocaleDateString('zh-CN')}</Typography>
                {entry.note !== undefined && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{entry.note}</Typography>}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}><Chip variant="outlined" color={entry.status === 'failed' ? 'warning' : 'default'} label={MATERIAL_STATUS[entry.status]} />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{entry.records} 条已整理内容</Typography>
              </TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{entry.files.length} 个<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{fileSize(entry.files.reduce((sum, file) => sum + file.bytes, 0))}</Typography></TableCell>
              <TableCell align="right"><Button size="small" onClick={() => setSelected(selected === entry.id ? '' : entry.id)}>{selected === entry.id ? '收起' : '查看'}</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </Box>
        <TablePagination component="div" count={visible.length} page={currentPage} rowsPerPage={10} rowsPerPageOptions={[10]} onPageChange={(_event, next) => setPage(next)} labelDisplayedRows={({ from, to, count }) => `第 ${String(from)}–${String(to)} 批，共 ${String(count)} 批`} getItemAriaLabel={(type) => type === 'next' ? '下一页资料' : '上一页资料'} />
      </>}
      {batch !== undefined && <BatchDetails key={batch.id} batch={batch} onClose={() => setSelected('')} />}
      <AddMaterialsDialog open={adding} onClose={() => setAdding(false)} onAdded={(added) => {
        setAdding(false); clear(); setSort('recent'); setSelected(added.id)
        app.notify(`已添加「${added.name}」，共 ${String(added.files.length)} 个文件`)
        void app.guard('kb-refresh', app.reload)
      }} />
    </Box>
  )
}

function BatchDetails({ batch, onClose }: { batch: KbBatchView; onClose: () => void }): React.JSX.Element {
  const app = useApp()
  const [tab, setTab] = useState<'files' | 'activity'>('files')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [filename, setFilename] = useState('')
  const [offset, setOffset] = useState(0)
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [runId, setRunId] = useState('')
  const request = useRef(0)
  const runRevision = useRef(0)
  const action = useRef(false)
  const entries = useMemo(() => forWorkspace(app.log, batch.id), [app.log, batch.id])
  const active = [...app.agents, ...app.elsewhere].find((run) => run.workspace === batch.id && run.parent === undefined)
  const running = active !== undefined || runId !== ''
  const configured = app.settings?.runtime.modelConfigured === true
  const files = batch.files.filter((file) => file.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(files.length / 10) - 1))

  const refreshRun = useCallback(async (): Promise<void> => {
    const revision = ++runRevision.current
    try {
      const result = await api.getRuns()
      if (revision === runRevision.current) setRunId(result.active.find((run) => run.workspace === batch.id && run.parent === undefined)?.id ?? '')
    } catch { /* 已收到的实时状态保留；连接恢复后可重新打开详情核对。 */ }
  }, [batch.id])

  useEffect(() => () => { request.current += 1 }, [])
  useEffect(() => {
    const unsubscribe = api.subscribe(() => undefined, (signal) => {
      if (signal.workspace !== batch.id) return
      if (signal.kind === 'started' && signal.parent === undefined) { runRevision.current += 1; setRunId(signal.runId) }
      if (signal.kind === 'done' && signal.parent === undefined) { runRevision.current += 1; setRunId('') }
    })
    void refreshRun()
    return () => { runRevision.current += 1; unsubscribe() }
  }, [batch.id, refreshRun])

  const load = async (file: string, at: number): Promise<void> => {
    const ticket = ++request.current
    setFilename(file); setOffset(at); setChunk(null); setError('')
    if (!isTextMaterial(file)) { setLoading(false); return }
    setLoading(true)
    try {
      const next = await api.previewKb(batch.id, file, at)
      if (request.current === ticket) setChunk(next)
    } catch (cause) {
      if (request.current === ticket) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (request.current === ticket) setLoading(false)
    }
  }

  const ingest = async (): Promise<void> => {
    if (action.current) return
    action.current = true; setWorking(true); setError('')
    try {
      await api.ingestKb(batch.id)
      // 极快的失败可能先于 HTTP 响应结束，返回的 runId 不能当作仍在运行的证据。
      await refreshRun(); setTab('activity')
      void app.guard('kb-refresh', app.reload)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { action.current = false; setWorking(false) }
  }

  return <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 2, pt: 2 }}>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{batch.name}</Typography>
        {batch.sourceDir !== undefined && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{batch.sourceDir}</Typography>}
      </Box>
      {running ? <Button color="warning" disabled={working} onClick={() => {
        const id = active?.id ?? runId
        setWorking(true)
        void api.stopRun(id).then(() => app.notify('已请求停止，当前步骤结束后会保留已整理的内容'))
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setWorking(false))
      }}>停止整理</Button> : <Button variant="outlined" disabled={working || !configured} onClick={() => void ingest()}>{working ? '正在开始…' : batch.status === 'failed' ? '继续整理' : batch.status === 'indexed' ? '再次整理' : '开始整理'}</Button>}
      <IconButton aria-label="关闭资料详情" onClick={onClose}><CloseIcon /></IconButton>
    </Stack>
    {!configured && <Alert severity="info" sx={{ mt: 1 }} action={<Button size="small" onClick={() => app.go('settings')}>前往设置</Button>}>配置模型后即可整理资料，上传和查看文件仍可使用。</Alert>}
    {error !== '' && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    <Tabs value={tab} onChange={(_event, next: typeof tab) => setTab(next)} aria-label="资料详情" sx={{ mb: 2 }}>
      <Tab value="files" label={`文件（${String(batch.files.length)}）`} /><Tab value="activity" label={running ? '整理记录 · 正在整理' : '整理记录'} />
    </Tabs>
    {tab === 'files' ? <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 1fr) minmax(0, 1.4fr)' }, gap: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <TextField label="在这批资料中找文件" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} fullWidth />
        <Box sx={{ mt: 1 }}>
          {files.slice(currentPage * 10, currentPage * 10 + 10).map((file) => <Button key={file.name} fullWidth onClick={() => void load(file.name, 0)}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 1, textAlign: 'left', bgcolor: filename === file.name ? 'action.selected' : undefined }}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{file.name}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{fileSize(file.bytes)}</Typography>
          </Button>)}
          {files.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>没有匹配的文件。</Typography>}
        </Box>
        <TablePagination component="div" count={files.length} page={currentPage} rowsPerPage={10} rowsPerPageOptions={[10]} onPageChange={(_event, next) => setPage(next)} labelDisplayedRows={({ from, to, count }) => `${String(from)}–${String(to)} / ${String(count)} 个`} getItemAriaLabel={(type) => type === 'next' ? '下一页文件' : '上一页文件'} />
      </Box>
      <Box sx={{ minWidth: 0, bgcolor: 'background.default', borderRadius: 1, p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>{filename === '' ? '文件预览' : filename}</Typography>
        {loading && <LinearProgress aria-label="正在读取文件" sx={{ mb: 1 }} />}
        {filename === '' && <Typography variant="body2" color="text.secondary">选择一个文件查看内容。</Typography>}
        {filename !== '' && !isTextMaterial(filename) && <Typography variant="body2" color="text.secondary">此格式暂不提供原文预览。开始整理后，可在整理记录中查看处理过程和提取结果。</Typography>}
        {chunk !== null && <>
          <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 340, overflowY: 'auto' }}>{chunk.text || '这一段没有文字。'}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>第 {chunk.total === 0 ? 0 : offset + 1}–{Math.min(offset + chunk.text.length, chunk.total)} 字，共 {chunk.total} 字</Typography>
            <Button size="small" disabled={loading || offset === 0} onClick={() => void load(filename, Math.max(0, offset - 2000))}>上一段</Button>
            <Button size="small" disabled={loading || chunk.next === undefined} onClick={() => void load(filename, chunk.next ?? offset)}>下一段</Button>
          </Stack>
        </>}
      </Box>
    </Box> : <Box>
      {entries.length === 0 && !running ? <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>还没有整理记录。开始整理后，这里会显示处理过程。</Typography>
        : <Box sx={{ height: 340 }}><Timeline entries={entries} running={running} /></Box>}
      <FilesView name={batch.id} tick={entries.length} />
    </Box>}
  </Box>
}
