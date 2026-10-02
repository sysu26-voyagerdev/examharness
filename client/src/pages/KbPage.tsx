import { useState } from 'react'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { Icon } from '../icons.js'
import type { KbBatchView, KbStatus, RunView } from '../types.js'
import { TranscriptView } from '../views.js'

/**
 * 知识库：**上传的是原料，整理交给 agent**。
 *
 * 老师传进来的真题/教材整理件先落在"待整理"；点「让 agent 整理」会真的去跑一次工作台：
 * agent 分片读文件 → 抽出原文里真实存在的题 → 写进语料库（可检索、可查重）。
 * 这里不做自动解析器——真实资料格式太杂，读一段抽几条正是 agent 擅长的。
 * 预览是**分片**读的：几 MB 的资料不进浏览器，只取这一段。
 */

const STATUS: Readonly<Record<KbStatus, { text: string; tone: string }>> = {
  raw: { text: '待整理', tone: '' },
  ingesting: { text: '整理中', tone: 'warn' },
  indexed: { text: '已整理', tone: 'ok' },
  failed: { text: '整理未完成', tone: 'warn' },
}

export function KbPage(): React.JSX.Element {
  const app = useApp()
  const { kb, settings, busy } = app

  const [name, setName] = useState('')
  const [files, setFiles] = useState<readonly { name: string; text: string }[]>([])
  const [pasted, setPasted] = useState('')
  const [pastedName, setPastedName] = useState('')
  const [reading, setReading] = useState(false)

  const [openId, setOpenId] = useState('')
  const [fileName, setFileName] = useState('')
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)
  const [offset, setOffset] = useState(0)

  const [ingest, setIngest] = useState<{ name: string; run: RunView } | null>(null)

  const configured = settings?.runtime.modelConfigured === true
  const pending = pasted === '' ? files : [...files, { name: pastedName === '' ? '粘贴.txt' : pastedName, text: pasted }]

  const pick = async (list: FileList | null): Promise<void> => {
    setReading(true)
    try {
      const read = await Promise.all(
        [...(list ?? [])].map(async (file) => ({ name: file.name, text: await file.text() })),
      )
      setFiles(read)
    } finally {
      setReading(false)
    }
  }

  const upload = (): void => {
    void app.guard('upload', async () => {
      const batch = await api.uploadKb(name, pending)
      setName('')
      setFiles([])
      setPasted('')
      setOpenId(batch.id)
      setFileName(batch.files[0]?.name ?? '')
      setOffset(0)
      setChunk(null)
      await app.reload()
    })
  }

  const load = (batchId: string, file: string, at: number): void => {
    void app.guard('preview', async () => {
      setOpenId(batchId)
      setFileName(file)
      setOffset(at)
      setChunk(await api.previewKb(batchId, file, at))
    })
  }

  const runIngest = (batch: KbBatchView): void => {
    void app.guard('ingest', async () => {
      const result = await api.ingestKb(batch.id)
      setIngest({ name: batch.name, run: result.run })
      // 这一轮也是 agent 的工作，接到全局工作记录上
      app.record(`整理知识库「${batch.name}」`, result.run)
      await app.reload()
    })
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="pagehd">
          <h1>知识库</h1>
          <span className="hint">
            语料库共 {kb?.corpusTotal ?? 0} 条　{configured ? '' : '模型未配置时整理会立刻停下'}
          </span>
        </div>

        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>知识库名称</label>
              <input value={name} placeholder="例如：2023 中考真题" onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label>选择文件（文本类）</label>
              <input
                type="file"
                multiple
                accept=".txt,.md,.csv,.jsonl"
                onChange={(event) => void pick(event.target.files)}
              />
            </div>
          </div>
          <div className="field">
            <label>或直接粘贴一段（PDF / 扫描件请先转文本）</label>
            <textarea
              rows={4}
              value={pasted}
              placeholder="粘进来的原文会一起上传"
              onChange={(event) => setPasted(event.target.value)}
            />
          </div>
          {pasted !== '' && (
            <div className="field">
              <label>粘贴内容的文件名</label>
              <input value={pastedName} placeholder="粘贴.txt" onChange={(event) => setPastedName(event.target.value)} />
            </div>
          )}
          <div className="acts">
            <span className="hint">
              {pending.length === 0
                ? '还没有选文件'
                : pending.map((file) => `${file.name}（${String(file.text.length)} 字）`).join('　')}
            </span>
            <button className="pri" disabled={busy !== '' || reading || pending.length === 0} onClick={upload}>
              上传
            </button>
          </div>
        </div>

        {(kb?.batches ?? []).length === 0 && <div className="empty">还没有上传过知识库</div>}

        {(kb?.batches ?? []).map((batch) => {
          const status = STATUS[batch.status]
          const open = openId === batch.id
          return (
            <div key={batch.id} className="group">
              <div className="grouphd">
                <Icon name="layers" />
                <b>{batch.name}</b>
                <span className={`chip ${status.tone}`}>{status.text}</span>
                <span className="hint">
                  {batch.files.length} 个文件　{batch.records} 条记录　{new Date(batch.at).toLocaleString('zh-CN')}
                  {batch.note === undefined ? '' : `　${batch.note}`}
                </span>
                <span className="lacts" style={{ marginLeft: 'auto' }}>
                  <button
                    className="ghost"
                    disabled={busy !== '' || batch.files.length === 0}
                    onClick={() => load(batch.id, fileName === '' ? (batch.files[0]?.name ?? '') : fileName, 0)}
                  >
                    预览
                  </button>
                  <button
                    className="ghost"
                    disabled={busy !== '' || batch.status === 'ingesting'}
                    title={configured ? 'agent 逐片读原文、抽题、写入语料库' : '模型未配置：会立刻停下来（不会假装整理）'}
                    onClick={() => runIngest(batch)}
                  >
                    让 agent 整理
                  </button>
                </span>
              </div>

              <div className="lrow">
                <span className="lmain">
                  <span className="ls">
                    {batch.files.map((file) => `${file.name}（${String(Math.round(file.bytes / 1024))} KB）`).join('　')}
                  </span>
                </span>
              </div>

              {open && (
                <div className="panel">
                  <div className="chips" style={{ marginBottom: 'var(--sp-3)' }}>
                    {batch.files.map((file) => (
                      <button
                        key={file.name}
                        className={`chip click ${file.name === fileName ? 'on' : ''}`}
                        onClick={() => load(batch.id, file.name, 0)}
                      >
                        {file.name}
                      </button>
                    ))}
                  </div>
                  {chunk === null ? (
                    <div className="hint">正在读取…</div>
                  ) : (
                    <>
                      <pre className="pre">{chunk.text}</pre>
                      <div className="acts">
                        <span className="hint mono">
                          {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
                        </span>
                        <button
                          className="ghost"
                          disabled={busy !== '' || offset === 0}
                          onClick={() => load(batch.id, fileName, Math.max(0, offset - 2000))}
                        >
                          上一段
                        </button>
                        <button
                          className="ghost"
                          disabled={busy !== '' || chunk.next === undefined}
                          onClick={() => load(batch.id, fileName, chunk.next ?? offset)}
                        >
                          下一段
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {ingest !== null && (
          <div className="group">
            <div className="grouphd">
              <Icon name="tool" />
              <b>整理「{ingest.name}」</b>
              <span className="hint mono">{ingest.run.steps} 步</span>
            </div>
            <div className="bd" style={{ maxHeight: 320 }}>
              <TranscriptView goal={ingest.run.goal} events={ingest.run.transcript} live={[]} stopped={ingest.run.stopped} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
