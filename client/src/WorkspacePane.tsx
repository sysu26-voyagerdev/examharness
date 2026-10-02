import { useCallback, useEffect, useState } from 'react'
import * as api from './api.js'
import { useApp } from './app-context.js'
import { Icon } from './icons.js'
import type { WorkspaceView } from './types.js'

/**
 * 工作区面板：**agent 在里面干了什么，老师能复查**（ADR-0020）。
 *
 * 显示 `in/`（原件副本）· `tmp/`（agent 写的脚本）· `out/`（产物），文本可直接分片预览。
 * 脚本能看懂、产物能翻——这是"可审计"，不是"沙箱"。venv 没建也如实说，别让人以为转换失败是模型的错。
 */
export function WorkspacePane({ name, refreshKey = 0 }: { name: string; refreshKey?: number }): React.JSX.Element {
  const { busy, guard } = useApp()
  const [view, setView] = useState<WorkspaceView | null>(null)
  const [file, setFile] = useState('')
  const [offset, setOffset] = useState(0)
  const [chunk, setChunk] = useState<{ text: string; total: number; next?: number } | null>(null)

  const load = useCallback(
    async (at: number): Promise<void> => {
      setOffset(at)
      setChunk(await api.readWorkspaceFile(name, file, at))
    },
    [name, file],
  )

  // 取文件清单：只在打开工作区/刷新时拉，别把用户点的文件又抢回去
  useEffect(() => {
    if (name === '') return
    void api
      .getWorkspace(name)
      .then((next) => {
        setView(next)
        setFile((current) => {
          if (current !== '' && next.files.some((entry) => entry.path === current)) return current
          const preferred =
            next.files.find((entry) => entry.path.startsWith('out/') && !entry.path.endsWith('.svg')) ??
            next.files.find((entry) => entry.path.startsWith('tmp/')) ??
            next.files[0]
          return preferred?.path ?? ''
        })
      })
      .catch(() => setView(null))
  }, [name, refreshKey])

  // 换文件就从头读（分片读，别把大文件全塞进界面）
  useEffect(() => {
    if (name === '' || file === '') return
    void api
      .readWorkspaceFile(name, file, 0)
      .then((next) => {
        setOffset(0)
        setChunk(next)
      })
      .catch(() => setChunk(null))
  }, [name, file])

  if (name === '') return <div className="empty">还没有工作区</div>
  const files = view?.files ?? []

  return (
    <div className="ws">
      <div className="hint">
        <Icon name="folder" /> 工作区 <span className="mono">{name}</span>
        {view === null ? '' : `　${String(files.length)} 个文件`}
        {view?.venv == null ? '　venv 未建（要处理 PDF/表格就先跑 pnpm venv）' : '　venv 已就绪'}
      </div>

      {files.length === 0 ? (
        <div className="hint" style={{ padding: 'var(--sp-4) 0' }}>
          agent 还没在里面放东西
        </div>
      ) : (
        <div className="chips" style={{ padding: 'var(--sp-3) 0' }}>
          {files.map((entry) => (
            <button
              key={entry.path}
              className={`chip click ${entry.path === file ? 'on' : ''}`}
              title={`${String(entry.bytes)} 字节　${new Date(entry.at).toLocaleString('zh-CN')}`}
              onClick={() => setFile(entry.path)}
            >
              <span className="mono">{entry.path}</span>
            </button>
          ))}
        </div>
      )}

      {file !== '' && chunk === null && (
        <div className="hint">读不到 <span className="mono">{file}</span> 的文本（可能是二进制，比如 PDF/图片）</div>
      )}
      {chunk !== null && (
        <>
          <pre className="pre">{chunk.text}</pre>
          <div className="acts">
            <span className="hint mono">
              {offset}–{Math.min(offset + chunk.text.length, chunk.total)} / {chunk.total}
            </span>
            <button className="ghost" disabled={busy !== '' || offset === 0} onClick={() => void guard('ws', () => load(Math.max(0, offset - 4000)))}>
              上一段
            </button>
            <button
              className="ghost"
              disabled={busy !== '' || chunk.next === undefined}
              onClick={() => void guard('ws', () => load(chunk.next ?? offset))}
            >
              下一段
            </button>
          </div>
        </>
      )}
    </div>
  )
}
