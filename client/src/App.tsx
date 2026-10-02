import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api.js'
import { Icon } from './icons.js'
import type {
  ItemView,
  LiveEvent,
  RunEventView,
  SessionMetaView,
  SessionView,
  SettingsView,
  SlotChangeView,
  StateView,
  VersionView,
} from './types.js'
import { EvidencePane, KnowledgePane, PaperPane, SessionDialog, SettingsDialog, TranscriptView } from './views.js'

/**
 * 完整应用的外壳（信息架构见 docs/agent/07）。
 *
 * 三条自觉（ADR-0015 / 07）：
 *   - 界面**不写死数学**：题面、图、证据、版本全部来自服务端投影；
 *   - 界面**不是写入口**：所有动作都是请服务端去改，改完以服务端返回为准；
 *   - 文字克制：一行一个事实，正常态不上色，异常才 warn。
 */

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

export function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionView | null>(null)
  const [sessions, setSessions] = useState<readonly SessionMetaView[]>([])
  const [state, setState] = useState<StateView | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)

  const [transcript, setTranscript] = useState<readonly RunEventView[]>([])
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  const [goal, setGoal] = useState('按蓝图出一份课后作业卷')
  const [goalShown, setGoalShown] = useState('')
  const [stopped, setStopped] = useState('')

  const [tab, setTab] = useState<TabKey>('paper')
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [dark, setDark] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'none' | 'session' | 'settings'>('none')

  const reload = useCallback(async () => {
    const [nextSession, nextSessions, nextState, nextSettings] = await Promise.all([
      api.getSession(),
      api.getSessions(),
      api.getState(),
      api.getSettings(),
    ])
    setSession(nextSession)
    setSessions(nextSessions.sessions)
    setState(nextState)
    setSettings(nextSettings)
  }, [])

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const unsubscribe = api.subscribe(
      (event) => {
        // run:step 已经在工作记录里逐条长出来了，不要再进"实时"列表
        if (event.kind !== 'run:step') {
          setLive((previous) => [event, ...previous].slice(0, 30))
          void reload().catch(() => undefined)
        }
      },
      (event) => setTranscript((previous) => [...previous, event]),
    )
    return unsubscribe
  }, [reload])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  const guard = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('')
    }
  }

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
  const changes = shown === undefined ? [] : diffVersions(versions[shown.version - 2], shown)
  const needsReview = rows.filter(({ item }) => item.lifecycle === 'needs_review').length

  const doRun = (text: string): void => {
    void guard('run', async () => {
      setGoalShown(text)
      setTranscript([])
      const run = await api.runWorkbench(text)
      setTranscript(run.transcript)
      setStopped(run.stopped)
      await reload()
    })
  }

  const doAssemble = (): void => {
    void guard('assemble', async () => {
      await api.assemble()
      setViewVersion(null)
      await reload()
    })
  }

  return (
    <>
      <header className="top">
        <span className="brand">
          命题组<span>examharness</span>
        </span>
        {session !== null && (
          <>
            <span className="title">
              {session.meta.title}
              {shown !== undefined && (
                <span className="ver mono">
                  {' '}
                  v{shown.version}
                  {viewingOld ? '（历史）' : ''}
                </span>
              )}
            </span>
            <span className="meta">
              <span>{session.meta.className}</span>
              <span>{session.meta.progress}</span>
              <span>
                满分 <b className="mono">{session.blueprint.paper.totalScore}</b>
              </span>
              <span>
                <b className="mono">{session.blueprint.paper.minutes}</b> 分钟
              </span>
              {session.meta.frozen && <span className="chip warn">已冻结</span>}
              {needsReview > 0 && <span className="chip warn">待复核 {needsReview}</span>}
            </span>
          </>
        )}
        {settings !== null && (
          <span className="chips">
            <button className="chip click" onClick={() => setDialog('settings')}>
              {settings.model.configured ? settings.model.name : '模型未配置'}
            </button>
            <button className="chip click" onClick={() => setDialog('settings')}>
              语料 {settings.corpus.total}
            </button>
            <button className="chip click" onClick={() => setDialog('settings')}>
              联网{settings.websearch.enabled ? '已开' : '未开'}
            </button>
          </span>
        )}
        <button className="ibtn" title="明暗" onClick={() => setDark((value) => !value)}>
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        <a className="ghost" href={api.exportUrl('html')} style={{ textDecoration: 'none' }}>
          导出（Word 可开）
        </a>
      </header>

      <div className="shell">
        <aside className="col side">
          <div className="hd">
            会话
            <button
              className="chip click"
              style={{ marginLeft: 'auto' }}
              onClick={() =>
                void guard('new', async () => {
                  await api.createSession({ title: `新会话 ${String(sessions.length + 1)}` })
                  setViewVersion(null)
                  await reload()
                })
              }
            >
              + 新建
            </button>
          </div>
          <div className="bd">
            <div className="nav">
              {sessions.map((meta) => (
                <div
                  key={meta.id}
                  className={`row ${session?.meta.id === meta.id ? 'on' : ''}`}
                  onClick={() =>
                    void guard('switch', async () => {
                      await api.switchSession(meta.id)
                      setViewVersion(null)
                      setTranscript([])
                      setStopped('')
                      await reload()
                    })
                  }
                >
                  <span className="t">{meta.title}</span>
                  <span className="s">{meta.frozen ? '已冻结' : meta.className}</span>
                </div>
              ))}
            </div>
            {session !== null && (
              <div className="panel">
                <div className="hint">
                  {session.meta.className}　{session.meta.progress}
                </div>
                <button className="ghost" style={{ marginTop: 'var(--sp-3)' }} onClick={() => setDialog('session')}>
                  编辑会话约定
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="col">
          <div className="hd">工作记录</div>
          <div className="bd">
            <TranscriptView goal={goalShown} events={transcript} live={live} stopped={stopped} />
          </div>
          <div className="cmp">
            <div className="quick">
              <button className="ghost" disabled={busy !== ''} onClick={() => doRun(goal === '' ? '出题' : goal)}>
                跑一次命题组
              </button>
              <button className="ghost" disabled={busy !== '' || session?.meta.frozen === true} onClick={doAssemble}>
                按蓝图组卷
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
                  if (event.key === 'Enter' && busy === '') doRun(goal === '' ? '出题' : goal)
                }}
              />
              <button
                className="send"
                disabled={busy !== ''}
                title="发送"
                onClick={() => doRun(goal === '' ? '出题' : goal)}
              >
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
                changes={changes}
                frozen={session?.meta.frozen === true}
                viewingOld={viewingOld}
                busy={busy !== ''}
                onRegenerate={(slotKey) =>
                  void guard(`regen:${slotKey}`, async () => {
                    const result = await api.regenerate(slotKey)
                    if (!result.ok) setError(result.reason ?? '重做失败')
                    setViewVersion(null)
                    await reload()
                  })
                }
                onConfirm={(itemId) =>
                  void guard(`confirm:${itemId}`, async () => {
                    await api.confirmItem(itemId, '老师')
                    await reload()
                  })
                }
                onAssemble={doAssemble}
              />
            )}
            {tab === 'net' && state !== null && <KnowledgePane knowledge={state.knowledge} items={state.items} />}
            {tab === 'ev' && <EvidencePane rows={rows} events={transcript} versions={versions} />}
          </div>
        </section>
      </div>

      {dialog === 'session' && session !== null && (
        <SessionDialog
          meta={session.meta}
          onClose={() => setDialog('none')}
          onSave={(patch) =>
            void guard('meta', async () => {
              await api.updateSession(patch)
              setDialog('none')
              await reload()
            })
          }
        />
      )}
      {dialog === 'settings' && settings !== null && (
        <SettingsDialog
          settings={settings}
          frozen={session?.meta.frozen === true}
          onClose={() => setDialog('none')}
          onFreeze={() =>
            void guard('freeze', async () => {
              await api.freezeSession()
              await reload()
            })
          }
        />
      )}
    </>
  )
}
