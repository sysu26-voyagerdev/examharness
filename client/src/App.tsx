import { useCallback, useEffect, useState } from 'react'
import { assemblePaper, generateOne, getState, runWorkbench, subscribe } from './api.js'
import { Icon } from './icons.js'
import type { LiveEvent, PaperView, RunEventView, StateView } from './types.js'
import { EvidencePane, KnowledgePane, PaperPane, TranscriptView } from './views.js'

/**
 * 界面骨架 = 视觉契约（preview/index.html）+ ADR-0015。
 *
 * 三条自觉：
 *   - 界面**不写死任何数学**：题面、图、证据都来自服务端投影；
 *   - 界面**不作为写入口**：所有动作都是往会话里发一句话（打断/组卷/生成），
 *     真正入库必须经服务端的闸门链；
 *   - 文字克制：一行一个事实，细节折叠，正常态不上色。
 */

const DEFAULT_GOAL = '按蓝图出一份课后作业卷'
const TABS = [
  { key: 'paper', label: '卷子' },
  { key: 'net', label: '知识网络' },
  { key: 'ev', label: '证据' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function App(): React.JSX.Element {
  const [state, setState] = useState<StateView | null>(null)
  const [paper, setPaper] = useState<PaperView | null>(null)
  const [events, setEvents] = useState<readonly RunEventView[]>([])
  const [goal, setGoal] = useState(DEFAULT_GOAL)
  const [goalShown, setGoalShown] = useState('')
  const [live, setLive] = useState<readonly LiveEvent[]>([])
  const [stopped, setStopped] = useState<string>('')
  const [tab, setTab] = useState<TabKey>('paper')
  const [dark, setDark] = useState(false)
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setState(await getState())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const unsubscribe = subscribe((event) => setLive((previous) => [event, ...previous].slice(0, 20)))
    return unsubscribe
  }, [refresh])

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

  const doRun = (text: string): Promise<void> =>
    guard('run', async () => {
      setGoalShown(text)
      const run = await runWorkbench(text)
      setEvents(run.transcript)
      setStopped(run.stopped)
      await refresh()
    })

  const doAssemble = (): Promise<void> =>
    guard('paper', async () => {
      setPaper(await assemblePaper())
      await refresh()
    })

  const doGenerate = (slotKey: string): Promise<void> =>
    guard(`gen:${slotKey}`, async () => {
      const result = await generateOne(slotKey)
      const verdict = result.verdict
      if (!result.ok && verdict !== undefined) {
        setLive((previous) => [
          {
            kind: 'rejected',
            at: new Date().toLocaleTimeString('zh-CN'),
            id: result.id ?? '—',
            slot: slotKey,
            stem: '',
            // exactOptionalPropertyTypes：可选字段要么不出现，要么是真值
            ...(verdict === undefined ? {} : { verdict }),
          },
          ...previous,
        ])
      }
      if (result.error !== undefined) setError(result.error)
      await refresh()
    })

  const blueprint = state?.blueprint
  const items = state?.items ?? []

  return (
    <>
      <header className="top">
        <span className="brand">
          命题组<span>examharness</span>
        </span>
        {blueprint !== undefined && (
          <>
            <span className="title">{blueprint.paper.title}</span>
            <span className="meta">
              <span>{blueprint.paper.className}</span>
              <span>
                <b className="mono">{blueprint.paper.totalScore}</b> 分
              </span>
              <span>
                <b className="mono">{blueprint.paper.minutes}</b> 分钟
              </span>
              <span>
                禁用 <b>{blueprint.constraints.forbidKnowledge.join(' · ')}</b>
              </span>
            </span>
          </>
        )}
        <button className="ibtn" onClick={() => setDark((value) => !value)} title="明暗">
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
      </header>

      <div className="shell">
        <aside className="col side">
          <div className="hd">会话</div>
          <div className="bd">
            <div className="nav">
              <div className="row on">
                <span className="t">{blueprint?.paper.title ?? '本次命题会话'}</span>
              </div>
              <div className="row">
                <span className="t">已入库</span>
                <span className="s mono">{items.length}</span>
              </div>
            </div>
          </div>
        </aside>

        <section className="col">
          <div className="hd">工作记录</div>
          <div className="bd" id="transcript">
            <TranscriptView goal={goalShown} events={events} live={live} stopped={stopped} />
          </div>
          <div className="cmp">
            <div className="quick">
              <button
                className="ghost"
                disabled={busy !== ''}
                onClick={() => void doRun(goal === '' ? DEFAULT_GOAL : goal)}
              >
                跑一次命题组
              </button>
              <button className="ghost" disabled={busy !== ''} onClick={() => void doAssemble()}>
                按蓝图组卷
              </button>
              {blueprint?.blueprint.map((row) => (
                <button
                  key={row.key}
                  className="ghost"
                  disabled={busy !== ''}
                  onClick={() => void doGenerate(row.key)}
                >
                  生成一道 {row.key}
                </button>
              ))}
              <span className="meter">{busy === '' ? `已入库 ${items.length} 题` : '进行中…'}</span>
            </div>
            <div className="in">
              <input
                value={goal}
                placeholder="说需求、纠正，或只改某一道题"
                onChange={(event) => setGoal(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && busy === '') void doRun(goal === '' ? DEFAULT_GOAL : goal)
                }}
              />
              <button
                className="send"
                disabled={busy !== ''}
                title="发送"
                onClick={() => void doRun(goal === '' ? DEFAULT_GOAL : goal)}
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
              <button
                key={entry.key}
                className={tab === entry.key ? 'on' : ''}
                onClick={() => setTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
            <span className="r">
              {paper === null ? '未组卷' : `满分 ${paper.totalScore} · 缺口 ${paper.gaps.length}`}
            </span>
          </div>
          <div className="bd p0">
            {tab === 'paper' && <PaperPane paper={paper} items={items} busy={busy !== ''} onAssemble={doAssemble} />}
            {tab === 'net' && state !== null && <KnowledgePane knowledge={state.knowledge} items={items} />}
            {tab === 'ev' && <EvidencePane items={items} events={events} />}
          </div>
        </section>
      </div>
    </>
  )
}
