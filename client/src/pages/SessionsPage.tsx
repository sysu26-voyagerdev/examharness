import { useState } from 'react'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { Icon } from '../icons.js'
import type { SessionMetaView } from '../types.js'
import { SessionDialog } from '../views.js'

/**
 * 会话管理：**分组、新建、切换、改约定**。
 *
 * 新建会话不是一个空壳——它一次问清四件事（班级 / 进度 / 蓝图 / 归属分组与知识库），
 * 因为 agent 每次开工都要读它们（docs/agent/04）。
 */
export function SessionsPage(): React.JSX.Element {
  const app = useApp()
  const { sessions, session, kb, busy } = app
  const defaults = sessions?.defaults ?? { className: '', progress: '', blueprintPath: '' }

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({
    title: '',
    className: defaults.className,
    progress: defaults.progress,
    blueprintPath: defaults.blueprintPath,
    groupId: '',
    kbId: '',
  })
  const [groupName, setGroupName] = useState('')
  const [renaming, setRenaming] = useState('')
  const [renameTo, setRenameTo] = useState('')
  const [editing, setEditing] = useState<SessionMetaView | null>(null)

  const groups = sessions?.groups ?? []
  const list = sessions?.sessions ?? []
  const inGroup = (groupId: string): readonly SessionMetaView[] =>
    list.filter((meta) => meta.groupId === groupId)

  const open = (meta: SessionMetaView): void => {
    void app.guard('switch', async () => {
      if (meta.id !== session?.meta.id) await api.switchSession(meta.id)
      app.clearLog()
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
      setDraft({ ...draft, title: '' })
      app.clearLog()
      await app.reload()
    })
  }

  const row = (meta: SessionMetaView): React.JSX.Element => (
    <div key={meta.id} className={`lrow ${session?.meta.id === meta.id ? 'on' : ''}`}>
      <span className="lmain">
        <span className="lt">
          {meta.title}
          {session?.meta.id === meta.id && <span className="chip ok">当前</span>}
          {meta.frozen && <span className="chip warn">已冻结</span>}
        </span>
        <span className="ls">
          {meta.className}　{meta.progress}　<span className="mono">{meta.blueprintPath}</span>
          {meta.kbId !== '' && `　知识库 ${meta.kbId}`}
        </span>
      </span>
      <span className="lacts">
        <select
          className="sel"
          value={meta.groupId}
          disabled={busy !== ''}
          title="移到分组"
          onChange={(event) =>
            void app.guard('group', async () => {
              await api.moveSessionToGroup(meta.id, event.target.value)
              await app.reload()
            })
          }
        >
          <option value="">未分组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        {/* 约定是**当前会话**的属性（服务端只有一条 PATCH /api/session），不在当前就不显示 */}
        {session?.meta.id === meta.id && (
          <button className="ghost" disabled={busy !== ''} onClick={() => setEditing(meta)}>
            约定
          </button>
        )}
        <button className="ghost" disabled={busy !== ''} onClick={() => open(meta)}>
          打开
        </button>
      </span>
    </div>
  )

  return (
    <div className="page">
      <div className="wrap">
        <div className="pagehd">
          <h1>会话</h1>
          <span className="hint">
            {list.length} 个会话　{groups.length} 个分组
          </span>
          <span className="r">
            <button className="pri" disabled={busy !== ''} onClick={() => setCreating((value) => !value)}>
              新建会话
            </button>
          </span>
        </div>

        {creating && (
          <div className="panel card2">
            <div className="grid2">
              <div className="field">
                <label>卷子标题</label>
                <input
                  autoFocus
                  value={draft.title}
                  placeholder={`新会话 ${String(list.length + 1)}`}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="field">
                <label>班级</label>
                <input value={draft.className} onChange={(event) => setDraft({ ...draft, className: event.target.value })} />
              </div>
              <div className="field">
                <label>教学进度</label>
                <input value={draft.progress} onChange={(event) => setDraft({ ...draft, progress: event.target.value })} />
              </div>
              <div className="field">
                <label>蓝图文件</label>
                <input
                  value={draft.blueprintPath}
                  onChange={(event) => setDraft({ ...draft, blueprintPath: event.target.value })}
                />
              </div>
              <div className="field">
                <label>归属分组</label>
                <select
                  className="sel"
                  value={draft.groupId}
                  onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
                >
                  <option value="">未分组</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>整理好的知识库</label>
                <select className="sel" value={draft.kbId} onChange={(event) => setDraft({ ...draft, kbId: event.target.value })}>
                  <option value="">不用知识库</option>
                  {(kb?.batches ?? []).map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name}（{batch.status === 'indexed' ? `${String(batch.records)} 条` : '未整理'}）
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="acts">
              <button className="ghost" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="pri" disabled={busy !== ''} onClick={create}>
                创建
              </button>
            </div>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.id} className="group">
            <div className="grouphd">
              <Icon name="folder" />
              {renaming === group.id ? (
                <>
                  <input
                    className="flat"
                    autoFocus
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void app.guard('rename', async () => {
                          await api.renameGroup(group.id, renameTo)
                          setRenaming('')
                          await app.reload()
                        })
                      }
                    }}
                  />
                  <button
                    className="ghost"
                    onClick={() =>
                      void app.guard('rename', async () => {
                        await api.renameGroup(group.id, renameTo)
                        setRenaming('')
                        await app.reload()
                      })
                    }
                  >
                    保存
                  </button>
                  <button className="ghost" onClick={() => setRenaming('')}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <b>{group.name}</b>
                  <span className="hint">{inGroup(group.id).length} 个</span>
                  <button
                    className="ghost"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                      setRenaming(group.id)
                      setRenameTo(group.name)
                    }}
                  >
                    重命名
                  </button>
                </>
              )}
            </div>
            {inGroup(group.id).length === 0 ? (
              <div className="hint" style={{ padding: '0 var(--sp-5) var(--sp-4)' }}>
                这个分组还没有会话
              </div>
            ) : (
              inGroup(group.id).map(row)
            )}
          </div>
        ))}

        <div className="group">
          <div className="grouphd">
            <Icon name="layers" />
            <b>未分组</b>
            <span className="hint">{inGroup('').length} 个</span>
          </div>
          {inGroup('').length === 0 ? (
            <div className="hint" style={{ padding: '0 var(--sp-5) var(--sp-4)' }}>
              没有未分组的会话
            </div>
          ) : (
            inGroup('').map(row)
          )}
        </div>

        <div className="panel card2">
          <div className="grid2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>新建分组</label>
              <input
                value={groupName}
                placeholder="例如：初三(2)班 九上"
                onChange={(event) => setGroupName(event.target.value)}
              />
            </div>
          </div>
          <div className="acts">
            <button
              className="ghost"
              disabled={busy !== ''}
              onClick={() =>
                void app.guard('group', async () => {
                  await api.createGroup(groupName)
                  setGroupName('')
                  await app.reload()
                })
              }
            >
              建分组
            </button>
          </div>
        </div>
      </div>

      {editing !== null && (
        <SessionDialog
          meta={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) =>
            void app.guard('meta', async () => {
              await api.updateSession(patch)
              setEditing(null)
              await app.reload()
            })
          }
        />
      )}
    </div>
  )
}
