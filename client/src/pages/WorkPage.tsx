import { useMemo, useState } from 'react'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { Icon } from '../icons.js'
import type { ItemView, SlotChangeView, VersionView } from '../types.js'
import { EvidencePane, KnowledgePane, PaperPane, SessionDialog, TranscriptView } from '../views.js'

const TABS = [
  { key: 'paper', label: '卷子' },
  { key: 'net', label: '知识网络' },
  { key: 'ev', label: '证据' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** 两个版本之间的题位变化（服务端只算最新一版，界面要能看任意两版） */
export function diffVersions(before: VersionView | undefined, after: VersionView): SlotChangeView[] {
  if (before === undefined) return []
  const slots = new Set([
    ...before.bindings.map((binding) => binding.slot),
    ...after.bindings.map((binding) => binding.slot),
  ])
  return [...slots].toSorted().map((slot) => {
    const a = before.bindings.find((binding) => binding.slot === slot)
    const b = after.bindings.find((binding) => binding.slot === slot)
    if (a === undefined && b !== undefined) return { slot, change: 'added' as const, to: b.itemId }
    if (a !== undefined && b === undefined) return { slot, change: 'removed' as const, from: a.itemId }
    if (a !== undefined && b !== undefined && a.itemId !== b.itemId) {
      return { slot, change: 'replaced' as const, from: a.itemId, to: b.itemId }
    }
    return { slot, change: 'same' as const }
  })
}

/** 工作台：会话（左）· 工作记录（中）· 卷子/网络/证据（右）。三栏各自独立滚动。 */
export function WorkPage(): React.JSX.Element {
  const app = useApp()
  const { session, sessions, state, transcript, live, runGoal, stopped, busy, error } = app

  const [goal, setGoal] = useState('按蓝图出一份课后作业卷')
  const [tab, setTab] = useState<TabKey>('paper')
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)

  const versions = session?.versions ?? []
  const latest = versions.at(-1)
  const shown = useMemo(
    () => (viewVersion === null ? latest : versions.find((version) => version.version === viewVersion)),
    [latest, versions, viewVersion],
  )
  const viewingOld = shown !== undefined && latest !== undefined && shown.version !== latest.version

  /** itemId → 题（题位那一份信息更全，优先用它） */
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemView>()
    for (const item of state?.items ?? []) map.set(item.id, item)
    for (const item of session?.slots ?? []) map.set(item.id, item)
    return map
  }, [session, state])

  const rows = (shown?.bindings ?? []).flatMap((binding) => {
    const item = itemsById.get(binding.itemId)
    return item === undefined ? [] : [{ binding, item }]
  })
  const needsReview = rows.filter(({ item }) => item.lifecycle === 'needs_review').length
  const frozen = session?.meta.frozen === true

  const send = (text: string): void => {
    void app.run(text === '' ? '出题' : text)
    setViewVersion(null)
  }

  const assemble = (): void => {
    void app.guard('assemble', async () => {
      await api.assemble()
      setViewVersion(null)
      await app.reload()
    })
  }

  const groupOf = (groupId: string): string =>
    groupId === '' ? '' : (sessions?.groups.find((group) => group.id === groupId)?.name ?? '')

  return (
    <div className="shell">
      <aside className="col side">
        <div className="hd">
          会话
          <span className="r" style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--sp-3)' }}>
            <button className="chip click" onClick={() => app.go('sessions')}>
              管理
            </button>
            <button
              className="chip click"
              disabled={busy !== ''}
              onClick={() =>
                void app.guard('new', async () => {
                  await api.createSession()
                  setViewVersion(null)
                  app.clearLog()
                  await app.reload()
                })
              }
            >
              新建
            </button>
          </span>
        </div>
        <div className="bd">
          <div className="nav">
            {sessions?.sessions.map((meta) => (
              <div
                key={meta.id}
                className={`row ${session?.meta.id === meta.id ? 'on' : ''}`}
                onClick={() =>
                  void app.guard('switch', async () => {
                    await api.switchSession(meta.id)
                    setViewVersion(null)
                    app.clearLog()
                    await app.reload()
                  })
                }
              >
                <span className="t">{meta.title}</span>
                <span className="s">
                  {meta.frozen ? '已冻结' : groupOf(meta.groupId) === '' ? meta.className : groupOf(meta.groupId)}
                </span>
              </div>
            ))}
          </div>
          {session !== null && (
            <div className="panel">
              <div className="hint">
                {session.meta.className}　{session.meta.progress}
                <br />
                {session.meta.blueprintPath}
              </div>
              <button className="ghost" style={{ marginTop: 'var(--sp-3)' }} onClick={() => setEditing(true)}>
                编辑会话约定
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="col">
        <div className="hd">工作记录</div>
        <div className="bd">
          <TranscriptView goal={runGoal} events={transcript} live={live} stopped={stopped} />
        </div>
        <div className="cmp">
          <div className="quick">
            <button className="ghost" disabled={busy !== ''} onClick={() => send(goal)}>
              跑一次命题组
            </button>
            <button className="ghost" disabled={busy !== '' || frozen} onClick={assemble}>
              按蓝图组卷
            </button>
            <button
              className="ghost"
              disabled={busy !== '' || frozen}
              title="冻结后所有写操作一律拒绝（R3）"
              onClick={() =>
                void app.guard('freeze', async () => {
                  await api.freezeSession()
                  await app.reload()
                })
              }
            >
              定稿冻结
            </button>
            <span className="meter">
              {busy === '' ? `v${latest?.version ?? 0} · 入库 ${state?.items.length ?? 0} 题` : '进行中…'}
            </span>
          </div>
          <div className="in">
            <input
              value={goal}
              placeholder="说需求、纠正，或只改某一道题"
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && busy === '') send(goal)
              }}
            />
            <button className="send" disabled={busy !== ''} title="发送" onClick={() => send(goal)}>
              <Icon name="send" />
            </button>
          </div>
          {error !== '' && <div className="hint err">{error}</div>}
        </div>
      </section>

      <section className="col">
        <div className="tabs">
          {TABS.map((entry) => (
            <button key={entry.key} className={tab === entry.key ? 'on' : ''} onClick={() => setTab(entry.key)}>
              {entry.label}
            </button>
          ))}
          <span className="r">{shown === undefined ? '未组卷' : `v${shown.version} · 满分 ${shown.totalScore}`}</span>
        </div>

        {versions.length > 0 && (
          <div className="panel" style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {versions.map((version) => (
              <button
                key={version.version}
                className={`chip click ${shown?.version === version.version ? 'on' : ''}`}
                title={`${new Date(version.at).toLocaleString('zh-CN')}　${version.reason}`}
                onClick={() => setViewVersion(version.version)}
              >
                v{version.version}
              </button>
            ))}
            {viewingOld && (
              <button className="chip click" onClick={() => setViewVersion(null)}>
                回到最新
              </button>
            )}
          </div>
        )}

        <div className="bd p0">
          {tab === 'paper' && (
            <PaperPane
              version={shown}
              rows={rows}
              changes={shown === undefined ? [] : diffVersions(versions[shown.version - 2], shown)}
              frozen={frozen}
              viewingOld={viewingOld}
              busy={busy !== ''}
              onRegenerate={(slotKey) =>
                void app.guard(`regen:${slotKey}`, async () => {
                  const result = await api.regenerate(slotKey)
                  if (!result.ok) throw new Error(result.reason ?? '重做被拒')
                  setViewVersion(null)
                  await app.reload()
                })
              }
              onConfirm={(itemId) =>
                void app.guard(`confirm:${itemId}`, async () => {
                  await api.confirmItem(itemId, '老师')
                  await app.reload()
                })
              }
              onAssemble={assemble}
            />
          )}
          {tab === 'net' && state !== null && <KnowledgePane knowledge={state.knowledge} items={state.items} />}
          {tab === 'ev' && <EvidencePane rows={rows} events={transcript} versions={versions} />}
        </div>
      </section>

      {editing && session !== null && (
        <SessionDialog
          meta={session.meta}
          onClose={() => setEditing(false)}
          onSave={(patch) =>
            void app.guard('meta', async () => {
              await api.updateSession(patch)
              setEditing(false)
              await app.reload()
            })
          }
        />
      )}
    </div>
  )
}
