import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { FilesView, Flex, Timeline } from '../components.js'
import type { KbBatchView, KbStatus } from '../types.js'

/**
 * 资料：老师把手上的东西交进来，agent 读它、抽题、写进语料。
 *
 * 上传的是**原料**：先落在资料区，整理之后抽出来的题目才进入可比对的范围。
 * 整理是一轮看得见的活：左边记录它每一步在干什么，可以插话、也可以按停。
 */

const STATUS: Readonly<Record<KbStatus, { text: string; color?: 'warning' | 'success' }>> = {
  raw: { text: '待整理' },
  ingesting: { text: '整理中', color: 'warning' },
  indexed: { text: '整理完成', color: 'success' },
  failed: { text: '没有整理完', color: 'warning' },
}

export function KnowledgePage(): React.JSX.Element {
  const app = useApp()
  const { kb, settings, log, running, busy } = app

  const [name, setName] = useState('')
  const [files, setFiles] = useState<readonly { name: string; text?: string; base64?: string }[]>([])
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')
  const [reading, setReading] = useState(false)
  const [open, setOpen] = useState('')
  const [fileName, setFileName] = useState('')
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [offset, setOffset] = useState(0)

  const configured = settings?.runtime.modelConfigured === true
  const pending =
    pasted.trim() === '' ? files : [...files, { name: pastedName === '' ? '粘贴的资料.txt' : pastedName, text: pasted }]

  /** 文本类当文本读；PDF / Word / 图片当二进制读（当文本读会毁掉文件） */
  const pick = async (list: FileList | null): Promise<void> => {
    setReading(true)
    try {
      setFiles(
        await Promise.all(
          [...(list ?? [])].map(async (file) => {
            const binary = /\.(pdf|docx|xlsx|xlsm|png|jpe?g|webp|bmp|tiff?)$/i.test(file.name)
            if (!binary) return { name: file.name, text: await file.text() }
            const buffer = await file.arrayBuffer()
            const bytes = new Uint8Array(buffer)
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

  const ingest = (batch: KbBatchView): void => {
    void app.guard('ingest', async () => {
      await api.ingestKb(batch.id)
      setOpen(batch.id)
      await app.reload()
    })
  }

  const batches = kb?.batches ?? []

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.15fr 1fr' }, height: 'calc(100vh - 52px)' }}>
      <Box sx={{ overflowY: 'auto', borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
        <Container maxWidth="sm" sx={{ py: 3 }}>
          <Flex row gap={2} align="baseline" sx={{ mb: 2 }}>
            <Typography variant="h2">资料</Typography>
            <Typography variant="caption">
              {configured ? `${String(batches.length)} 批　语料 ${String(kb?.corpusTotal ?? 0)} 条` : '还没有配置模型，暂时不能整理'}
            </Typography>
          </Flex>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 3 }}>
            <Flex gap={2}>
              <TextField
                label="给这批资料起个名字"
                value={name}
                placeholder="例如 2023 中考真题"
                onChange={(event) => setName(event.target.value)}
              />
              <Button component="label" size="small" variant="outlined" disabled={reading}>
                选择文件
                <input hidden type="file" multiple accept=".txt,.md,.csv,.jsonl,.pdf,.docx,.xlsx,.png,.jpg,.jpeg" onChange={(event) => void pick(event.target.files)} />
              </Button>
              <TextField
                label="或者直接粘一段文字"
                value={pasted}
                multiline
                minRows={3}
                maxRows={8}
                placeholder="扫描件和 PDF 也可以传文件，整理时会自动识别上面的文字"
                onChange={(event) => setPasted(event.target.value)}
              />
              {pasted.trim() !== '' && (
                <TextField
                  label="这段文字叫什么"
                  value={pastedName}
                  placeholder="粘贴的资料.txt"
                  onChange={(event) => setPastedName(event.target.value)}
                />
              )}
              <Flex row gap={1} align="center">
                <Typography variant="caption" sx={{ flex: 1 }}>
                  {pending.length === 0 ? '还没有选文件' : pending.map((file) => file.name).join('　')}
                </Typography>
                <Button variant="contained" size="small" disabled={busy !== '' || pending.length === 0} onClick={upload}>
                  上传
                </Button>
              </Flex>
            </Flex>
          </Paper>

          {batches.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              还没有上传过资料。真题、教材整理件、教研笔记都可以——整理之后，出题时会拿它们做参考，也会拿来查重。
            </Typography>
          )}

          {batches.map((batch) => {
            const status = STATUS[batch.status]
            const isOpen = open === batch.id
            return (
              <Box key={batch.id} sx={{ mb: 2 }}>
                <Flex row gap={1} align="center" wrap>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {batch.name}
                  </Typography>
                  <Chip size="small" variant="outlined" color={status.color} label={status.text} />
                  <Typography variant="caption">
                    {batch.files.length} 个文件
                    {batch.records > 0 ? `　抽到 ${String(batch.records)} 条` : ''}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" disabled={busy !== ''} onClick={() => load(batch.id, fileName === '' ? (batch.files[0]?.name ?? '') : fileName, 0)}>
                    看一下
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy !== '' || running !== null || batch.status === 'ingesting'}
                    title={configured ? 'agent 读原件、抽题、写进语料' : '先去设置里配置模型'}
                    onClick={() => ingest(batch)}
                  >
                    整理
                  </Button>
                </Flex>
                {batch.note !== undefined && (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                    {batch.note}
                  </Typography>
                )}

                {isOpen && (
                  <Paper variant="outlined" sx={{ p: 1.5, mt: 1, borderRadius: 2 }}>
                    <Flex row gap={0.75} wrap sx={{ mb: 1 }}>
                      {batch.files.map((file) => (
                        <Chip
                          key={file.name}
                          size="small"
                          variant={file.name === fileName ? 'filled' : 'outlined'}
                          label={file.name}
                          onClick={() => load(batch.id, file.name, 0)}
                          sx={{ cursor: 'pointer' }}
                        />
                      ))}
                    </Flex>
                    {chunk === null ? (
                      <Typography variant="caption">正在读取…</Typography>
                    ) : (
                      <>
                        <Typography component="pre" variant="caption" sx={{ m: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                          {chunk.text}
                        </Typography>
                        <Flex row gap={1} align="center" sx={{ mt: 1 }}>
                          <Typography variant="caption">
                            {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Button size="small" disabled={busy !== '' || offset === 0} onClick={() => load(batch.id, fileName, Math.max(0, offset - 2000))}>
                            上一段
                          </Button>
                          <Button size="small" disabled={busy !== '' || chunk.next === undefined} onClick={() => load(batch.id, fileName, chunk.next ?? offset)}>
                            下一段
                          </Button>
                        </Flex>
                      </>
                    )}
                  </Paper>
                )}
                <Divider sx={{ mt: 1.5 }} />
              </Box>
            )
          })}
        </Container>
      </Box>

      {/* 整理过程：和会话记录同一条时间线 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Flex row gap={1} align="center" sx={{ px: 2, py: 1.25 }}>
          <Typography variant="caption">整理记录</Typography>
          {running !== null && (
            <>
              <CircularProgress size={12} thickness={5} />
              <Typography variant="caption">正在做</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" disabled={busy !== ''} onClick={() => void app.stopRun()}>
                按停
              </Button>
            </>
          )}
        </Flex>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <Timeline entries={log} running={running !== null} />
        </Box>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            {open === '' ? '整理开始后，这里会显示它读到了什么、抽出了什么；也可以插一句话。' : '这一批留下的文件：'}
          </Typography>
          <FilesView name={open} tick={log.length} />
        </Box>
      </Box>
    </Box>
  )
}
