import { useState } from 'react'
import { Icon, type IconName } from './icons.js'
import type { ItemView, KnowledgeView, LiveEvent, PaperView, RunEventView } from './types.js'

/* ────────────────────────── 工作记录 ────────────────────────── */

const TOOL_ICONS: Readonly<Record<string, IconName>> = {
  graph_query: 'graph',
  construct_item: 'grid',
  serialize_item: 'image',
  submit_item: 'upload',
  bank_stats: 'chart',
}

/** 行内一行一个事实：`工具名：摘要` → 左标题 + 圆点 + 右摘要 */
function splitRow(text: string): { key: string; body: string } {
  const at = text.indexOf('：')
  if (at === -1) return { key: '命题组', body: text }
  return { key: text.slice(0, at), body: text.slice(at + 1) }
}

const gateTone = (text: string): string =>
  text.includes('拦下') || text.includes('不一致') || text.includes('失败')
    ? 'warn'
    : text.includes('入库') || text.includes('通过')
      ? 'ok'
      : ''

const STOPPED_TEXT: Readonly<Record<string, string>> = {
  done: '完成',
  'max-steps': '达到步数上限',
  'no-llm': '模型未配置，工作台拒绝运行',
}

export function TranscriptView({
  goal,
  events,
  live,
  stopped,
}: {
  goal: string
  events: readonly RunEventView[]
  live: readonly LiveEvent[]
  stopped: string
}): React.JSX.Element {
  const idle = goal === '' && events.length === 0 && live.length === 0

  return (
    <div className="tx">
      {idle && (
        <div className="empty">
          agent 内环拿工具自己迭代；收尾动作只有一个「提交」，跑不跑闸门由框架决定——它跳不过去。
        </div>
      )}

      {goal !== '' && (
        <div className="turn user">
          <div className="stack">
            <div className="bubble">{goal}</div>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="turn">
          <div className="who">
            <Icon name="chat" />
            命题组
          </div>
          {events.map((event, index) => {
            const { key, body } = splitRow(event.text)
            const tone = event.kind === 'gate' ? gateTone(event.text) : ''
            const icon: IconName =
              event.kind === 'assistant'
                ? 'chat'
                : event.kind === 'gate'
                  ? tone === 'warn'
                    ? 'alert'
                    : 'check'
                  : (TOOL_ICONS[key] ?? 'tool')
            return (
              <div className="step" key={`${String(event.step)}-${String(index)}`}>
                <span className="ico">
                  <Icon name={icon} />
                </span>
                <span className={event.kind === 'assistant' ? 'k' : 'k mono'}>{key}</span>
                <span className="dot" />
                <span className={tone === '' ? 'st' : `st ${tone}`}>{body}</span>
              </div>
            )
          })}
          {stopped !== '' && <div className="hint">{STOPPED_TEXT[stopped] ?? stopped}</div>}
        </div>
      )}

      {live.length > 0 && (
        <div className="turn">
          <div className="who">
            <Icon name="refresh" />
            闸门实时
          </div>
          {live.map((event, index) => (
            <div className="step" key={`live-${String(index)}`}>
              <span className="ico">
                <Icon name={event.kind === 'stored' ? 'check' : 'alert'} />
              </span>
              <span className="k mono">{event.at}</span>
              <span className="dot" />
              <span className={event.kind === 'stored' ? 'st ok' : 'st warn'}>
                {event.kind === 'stored'
                  ? `入库 ${event.id}`
                  : `${event.verdict?.gate ?? '闸门'}：${event.verdict?.reason ?? '被拦下'}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── 卷子 ────────────────────────── */

function statusOf(item: ItemView): { text: string; tone: string; icon: IconName } {
  const failed = Object.entries(item.evidence).filter(([, value]) => !value.pass)
  if (failed.length > 0) return { text: '待复核', tone: 'warn', icon: 'alert' }
  return { text: '通过', tone: 'ok', icon: 'check' }
}

function Question({ item, index, open, onToggle }: {
  item: ItemView
  index: number
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const status = statusOf(item)
  return (
    <div className="q">
      <div className="no">{index + 1}</div>
      <div className="head">
        <em>{item.type}</em>
        <span className="mono">{item.score} 分</span>
        {item.difficulty !== undefined && (
          <span className="mono">
            难度 {item.difficulty[0]}–{item.difficulty[1]}
          </span>
        )}
        <span>{item.knowledge.join('、')}</span>
      </div>
      <div className={`st ${status.tone}`}>
        <Icon name={status.icon} />
        {status.text}
      </div>

      <div className="wide stem">{item.stem}</div>
      {item.figure !== '' && (
        // 图是服务端由 spec 渲染好的 SVG：界面只显示，不解析、不重画
        <div className="wide fig" dangerouslySetInnerHTML={{ __html: item.figure }} />
      )}
      <div className="wide acts">
        <button onClick={onToggle}>{open ? '收起答案' : '答案与解析'}</button>
        <span className="mono" style={{ color: 'var(--label-4)', fontSize: 'var(--fs-cap)' }}>
          {item.id}
        </span>
      </div>
      {open && (
        <div className="wide ans">
          <b>答案</b>　{item.answer}
          <div className="hint">
            {Object.entries(item.evidence)
              .map(([gate, value]) => `${gate}${value.pass ? '✓' : '✗'}`)
              .join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}

export function PaperPane({ paper, items, busy, onAssemble }: {
  paper: PaperView | null
  items: readonly ItemView[]
  busy: boolean
  onAssemble: () => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const list = paper === null ? items : paper.slots

  if (list.length === 0) {
    return (
      <div className="pane">
        <div className="card">
          <div className="empty">
            还没有题。组卷是约束求解：按蓝图配额逐题位凑齐，凑不到就报缺口——不许静默少给题。
          </div>
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <button className="pri" disabled={busy} onClick={() => void onAssemble()}>
              按蓝图组卷
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pane">
      <div className="sheet">
        {paper !== null && (
          <div className="banner">
            满分 {paper.totalScore} · 与蓝图差 {paper.scoreGap} · 提交 {paper.attempts} 次 ·{' '}
            {paper.gaps.length === 0
              ? '缺口 0'
              : `缺口 ${String(paper.gaps.length)}：${paper.gaps.map((gap) => `${gap.slot} ${gap.reason}`).join('；')}`}
          </div>
        )}
        <h1>{paper === null ? '题库（尚未组卷）' : '本次卷子'}</h1>
        <div className="sub">
          <span>共 {list.length} 题</span>
          <span>{paper === null ? '点「按蓝图组卷」凑齐题位' : '由易到难'}</span>
        </div>
        {list.map((item, index) => (
          <Question
            key={item.id}
            item={item}
            index={index}
            open={open.has(item.id)}
            onToggle={() =>
              setOpen((previous) => {
                const next = new Set(previous)
                if (next.has(item.id)) next.delete(item.id)
                else next.add(item.id)
                return next
              })
            }
          />
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────── 知识网络 ────────────────────────── */

export function KnowledgePane({ knowledge, items }: {
  knowledge: KnowledgeView
  items: readonly ItemView[]
}): React.JSX.Element {
  const covered = new Set(items.flatMap((item) => item.knowledge))
  const learned = new Set(knowledge.learned)
  const byKey = new Map(knowledge.nodes.map((node) => [node.key, node]))

  const depthOf = (key: string, seen: ReadonlySet<string> = new Set()): number => {
    const node = byKey.get(key)
    if (node === undefined || node.prerequisites.length === 0 || seen.has(key)) return 0
    const next = new Set(seen).add(key)
    return 1 + Math.max(...node.prerequisites.map((parent) => depthOf(parent, next)))
  }

  const layers = new Map<number, string[]>()
  for (const node of knowledge.nodes) {
    const depth = depthOf(node.key)
    layers.set(depth, [...(layers.get(depth) ?? []), node.key])
  }

  const column = 168
  const line = 34
  const position = new Map<string, { x: number; y: number }>()
  const ordered = [...layers.entries()].toSorted((a, b) => a[0] - b[0])
  for (const [depth, keys] of ordered) {
    keys.forEach((key, index) => position.set(key, { x: 14 + depth * column, y: 20 + index * line }))
  }
  const width = 14 * 2 + Math.max(1, ordered.length) * column
  const height = 20 * 2 + Math.max(...[...layers.values()].map((keys) => keys.length), 1) * line

  const dotColor = (key: string): string =>
    covered.has(key) ? 'var(--accent)' : learned.has(key) ? 'var(--label-1)' : 'var(--label-4)'

  return (
    <div className="pane">
      <div className="card">
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 500 }}>本卷覆盖视图</div>
        <div className="lg">
          <span>
            <i style={{ background: 'var(--accent)' }} />
            本卷覆盖
          </span>
          <span>
            <i style={{ background: 'var(--label-1)' }} />
            已学未覆盖
          </span>
          <span>
            <i style={{ background: 'var(--label-4)' }} />
            未学 · 不得入卷
          </span>
        </div>
        <svg viewBox={`0 0 ${String(width)} ${String(height)}`} style={{ width: '100%', height: 'auto' }}>
          {knowledge.nodes.flatMap((node) =>
            node.prerequisites.map((parent) => {
              const from = position.get(parent)
              const to = position.get(node.key)
              if (from === undefined || to === undefined) return null
              const dashed = !learned.has(node.key) || !learned.has(parent)
              return (
                <line
                  key={`${parent}->${node.key}`}
                  x1={from.x + 118}
                  y1={from.y}
                  x2={to.x - 6}
                  y2={to.y}
                  style={{ stroke: dashed ? 'var(--label-4)' : 'var(--line-2)' }}
                  strokeWidth="1.2"
                  strokeDasharray={dashed ? '4 4' : undefined}
                />
              )
            }),
          )}
          {knowledge.nodes.map((node) => {
            const at = position.get(node.key)
            if (at === undefined) return null
            return (
              <g key={node.key}>
                <circle cx={at.x} cy={at.y} r="4" style={{ fill: dotColor(node.key) }} />
                <text x={at.x + 12} y={at.y + 4} fontSize="12.5" style={{ fill: dotColor(node.key) }}>
                  {node.key}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="kpi">
          <div>
            <b>
              {covered.size}/{knowledge.nodes.length}
            </b>
            本卷覆盖
          </div>
          <div>
            <b>{knowledge.learned.length}</b>
            已学
          </div>
          <div>
            <b>{knowledge.nodes.length - knowledge.learned.length}</b>
            未学
          </div>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── 证据 ────────────────────────── */

const GATES = ['symbolic', 'scope', 'dedup', 'figure', 'roundtrip'] as const

export function EvidencePane({ items, events }: {
  items: readonly ItemView[]
  events: readonly RunEventView[]
}): React.JSX.Element {
  const gateEvents = events.filter((event) => event.kind === 'gate')

  return (
    <div className="pane">
      <div className="card">
        <div className="kpi">
          <div>
            <b>{items.length}</b>
            入库题数
          </div>
          <div>
            <b>{gateEvents.length}</b>
            本次提交
          </div>
          <div>
            <b>{items.flatMap((item) => item.slot).length}</b>
            覆盖题位
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>题</th>
              <th>构造器</th>
              <th>种子</th>
              {GATES.map((gate) => (
                <th key={gate}>{gate}</th>
              ))}
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="n">{item.slot}</td>
                <td className="n">{item.constructor}</td>
                <td className="n">{item.seed}</td>
                {GATES.map((gate) => {
                  const value = item.evidence[gate]
                  return (
                    <td key={gate} className="n">
                      {value === undefined ? '—' : value.pass ? '✓' : '✗'}
                    </td>
                  )
                })}
                <td>{item.lifecycle}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {gateEvents.length > 0 && (
          <>
            <div style={{ height: 'var(--sp-7)' }} />
            <table>
              <thead>
                <tr>
                  <th>步</th>
                  <th>闸门动作</th>
                </tr>
              </thead>
              <tbody>
                {gateEvents.map((event, index) => (
                  <tr key={`gate-${String(index)}`}>
                    <td className="n">{event.step}</td>
                    <td>{event.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="hint">
          每个「通过」都能回答「凭什么」——这就是原创性与合规性的证据链。
        </div>
      </div>
    </div>
  )
}
