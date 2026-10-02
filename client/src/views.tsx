import { useState } from 'react'
import { Icon, type IconName } from './icons.js'
import type {
  ItemView,
  KnowledgeView,
  LiveEvent,
  RunEventView,
  SessionMetaView,
  SlotBindingView,
  SlotChangeView,
  VersionView,
} from './types.js'

/* ────────────────────────── 工作记录 ────────────────────────── */

const TOOL_ICONS: Readonly<Record<string, IconName>> = {
  graph_query: 'graph',
  kb_list: 'layers',
  kb_read: 'paper',
  kb_write: 'upload',
  kb_mark: 'check',
  ws_ls: 'folder',
  ws_read: 'paper',
  ws_write: 'paper',
  ws_run: 'play',
  construct_item: 'grid',
  serialize_item: 'image',
  submit_item: 'upload',
  bank_stats: 'chart',
  corpus_search: 'search',
  corpus_read: 'paper',
  corpus_compare: 'sliders',
  web_search: 'globe',
}

function splitRow(text: string): { key: string; body: string } {
  const at = text.indexOf('：')
  if (at === -1) return { key: '命题组', body: text }
  return { key: text.slice(0, at), body: text.slice(at + 1) }
}

const gateTone = (text: string): string =>
  text.includes('拦下') || text.includes('不一致') || text.includes('失败') || text.includes('过于相似')
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
          agent 内环拿工具自己迭代（查图谱、查素材、构造、写题面、自查）；收尾动作只有一个「提交」——
          跑不跑闸门由框架决定，它跳不过去。
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
            const { key, body } = event.kind === 'user' ? { key: '老师', body: event.text } : splitRow(event.text)
            const tone = event.kind === 'gate' ? gateTone(event.text) : ''
            const icon: IconName =
              event.kind === 'user'
                ? 'send'
                : event.kind === 'assistant'
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
                <span className={event.kind === 'tool' ? 'k mono' : 'k'}>{key}</span>
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
            实时
          </div>
          {live.map((event, index) => {
            const text =
              event.kind === 'stored'
                ? `入库 ${event.id ?? ''}（${event.slot ?? ''}）`
                : event.kind === 'confirmed'
                  ? `${event.by ?? '老师'} 确认了 ${event.id ?? ''}`
                  : `${event.verdict?.gate ?? '闸门'}：${event.verdict?.reason ?? '被拦下'}`
            return (
              <div className="step" key={`live-${String(index)}`}>
                <span className="ico">
                  <Icon name={event.kind === 'rejected' ? 'alert' : 'check'} />
                </span>
                <span className="k mono">{event.at}</span>
                <span className="dot" />
                <span className={event.kind === 'rejected' ? 'st warn' : 'st ok'}>{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── 卷子 ────────────────────────── */

function statusOf(item: ItemView, binding: SlotBindingView): { text: string; tone: string; icon: IconName } {
  if (binding.confirmedBy !== null) return { text: `已确认 · ${binding.confirmedBy}`, tone: 'ok', icon: 'check' }
  const failed = Object.entries(item.evidence).filter(([, value]) => !value.pass)
  if (failed.length > 0 || item.lifecycle === 'needs_review') return { text: '待复核', tone: 'warn', icon: 'alert' }
  return { text: '通过', tone: 'ok', icon: 'check' }
}

function Question({
  binding,
  item,
  index,
  changed,
  locked,
  canAct,
  onRegenerate,
  onConfirm,
}: {
  binding: SlotBindingView
  item: ItemView
  index: number
  changed: SlotChangeView | undefined
  locked: boolean
  canAct: boolean
  onRegenerate: (slotKey: string) => void
  onConfirm: (itemId: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const status = statusOf(item, binding)
  const mark =
    changed === undefined || changed.change === 'same'
      ? ''
      : changed.change === 'replaced'
        ? '本版替换'
        : changed.change === 'added'
          ? '本版新增'
          : '本版移除'

  return (
    <div className={`q ${changed !== undefined && changed.change !== 'same' ? 'slot-hit' : ''}`}>
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
        {mark !== '' && <span className="chip">{mark}</span>}
      </div>
      <div className={`st ${status.tone}`}>
        <Icon name={status.icon} />
        {status.text}
      </div>

      <div className="wide stem">{item.stem}</div>
      {item.figure !== '' && (
        // 图是服务端按 spec 渲染好的 SVG：界面只显示，不解析、不重画
        <div className="wide fig" dangerouslySetInnerHTML={{ __html: item.figure }} />
      )}
      <div className="wide acts">
        <button onClick={() => setOpen((value) => !value)}>{open ? '收起答案' : '答案与解析'}</button>
        <button disabled={!canAct} onClick={() => onRegenerate(binding.slot)} title={locked ? '冻结后不可改（R3）' : '只重做这个题位'}>
          换一道
        </button>
        {item.lifecycle === 'needs_review' && binding.confirmedBy === null && (
          <button disabled={!canAct} onClick={() => onConfirm(item.id)} title="人工终审签字（R4）">
            我确认
          </button>
        )}
        <span className="mono" style={{ color: 'var(--label-4)', fontSize: 'var(--fs-cap)' }}>
          {item.id}
        </span>
      </div>
      {open && (
        <div className="wide ans">
          <b>答案</b>　{item.answer}
          <div className="hint">
            {Object.entries(item.evidence)
              .map(([gate, value]) => `${gate} ${value.pass ? '通过' : '未通过'}`)
              .join('　')}
          </div>
          <div className="hint">
            构造器 {item.constructor}　种子 <span className="mono">{item.seed}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function PaperPane({
  version,
  rows,
  changes,
  frozen,
  viewingOld,
  busy,
  onRegenerate,
  onConfirm,
  onAssemble,
}: {
  version: VersionView | undefined
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  changes: readonly SlotChangeView[]
  frozen: boolean
  viewingOld: boolean
  busy: boolean
  onRegenerate: (slotKey: string) => void
  onConfirm: (itemId: string) => void
  onAssemble: () => void
}): React.JSX.Element {
  const canAct = !frozen && !viewingOld && !busy

  if (version === undefined || rows.length === 0) {
    return (
      <div className="pane">
        <div className="card">
          <div className="empty">
            还没有卷子。组卷是约束求解：按蓝图配额逐题位凑齐，凑不到就报缺口——不许静默少给题。
          </div>
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <button className="pri" disabled={busy || frozen} onClick={onAssemble}>
              按蓝图组卷
            </button>
          </div>
        </div>
      </div>
    )
  }

  const changed = changes.filter((change) => change.change !== 'same')
  const gapText =
    version.gaps.length === 0
      ? '缺口 0'
      : `缺口 ${String(version.gaps.length)}：${version.gaps.map((gap) => `${gap.slot} ${gap.reason}`).join('；')}`

  return (
    <div className="pane">
      <div className="sheet">
        <div className="banner">
          v{version.version} · {version.reason} · 满分 {version.totalScore} · 与蓝图差 {version.scoreGap} · 提交{' '}
          {version.attempts} 次 · {gapText}
          {changed.length > 0 && (
            <span>
              　｜与上一版相比：
              {changed.map((change) => `${change.slot} ${change.change === 'replaced' ? '替换' : change.change === 'added' ? '新增' : '移除'}`).join('、')}
            </span>
          )}
        </div>
        {frozen && <div className="banner">本会话已冻结：冻结后不可改动（R3）</div>}
        {viewingOld && <div className="banner">正在看历史版本：只读，右侧「回到最新」可返回</div>}

        <h1>{version.reason === '组卷' ? '本次卷子' : `本次卷子（${version.reason}）`}</h1>
        <div className="sub">
          <span>共 {rows.length} 题</span>
          <span>由易到难</span>
          <span>
            {new Date(version.at).toLocaleString('zh-CN')}
          </span>
        </div>

        {rows.map(({ binding, item }, index) => (
          <Question
            key={`${binding.slot}-${item.id}`}
            binding={binding}
            item={item}
            index={index}
            changed={changes.find((change) => change.slot === binding.slot)}
            locked={frozen || viewingOld}
            canAct={canAct}
            onRegenerate={onRegenerate}
            onConfirm={onConfirm}
          />
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────── 知识网络 ────────────────────────── */

export function KnowledgePane({
  knowledge,
  items,
}: {
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

export function EvidencePane({
  rows,
  events,
  versions,
}: {
  rows: readonly { binding: SlotBindingView; item: ItemView }[]
  events: readonly RunEventView[]
  versions: readonly VersionView[]
}): React.JSX.Element {
  const gateEvents = events.filter((event) => event.kind === 'gate')
  const originality = rows
    .map(({ item }) => item.evidence.originality?.detail)
    .filter((detail): detail is string => typeof detail === 'string')

  return (
    <div className="pane">
      <div className="card">
        <div className="kpi">
          <div>
            <b>{rows.length}</b>
            卷内题数
          </div>
          <div>
            <b>{rows.filter(({ item }) => item.lifecycle === 'needs_review').length}</b>
            待复核
          </div>
          <div>
            <b>{rows.filter(({ binding }) => binding.confirmedBy !== null).length}</b>
            已签字
          </div>
          <div>
            <b>{versions.length}</b>
            版本数
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>题位</th>
              <th>构造器</th>
              <th>种子</th>
              {GATES.map((gate) => (
                <th key={gate}>{gate}</th>
              ))}
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ binding, item }) => (
              <tr key={binding.slot}>
                <td className="n">{binding.slot}</td>
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
                <td>{binding.confirmedBy ?? item.lifecycle}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {originality.length > 0 && (
          <>
            <div style={{ height: 'var(--sp-6)' }} />
            <div className="hint">原创度（只出数字，不出语料原文）：</div>
            {originality.map((detail) => (
              <div className="hint" key={detail}>
                {detail}
              </div>
            ))}
          </>
        )}

        {gateEvents.length > 0 && (
          <>
            <div style={{ height: 'var(--sp-6)' }} />
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

        <div className="hint">每个「通过」都能回答「凭什么」——这就是原创性与合规性的证据链。</div>
      </div>
    </div>
  )
}

/* ────────────────────────── 对话框 ────────────────────────── */

export function SessionDialog({
  meta,
  onClose,
  onSave,
}: {
  meta: SessionMetaView
  onClose: () => void
  onSave: (patch: Partial<SessionMetaView>) => void
}): React.JSX.Element {
  const [title, setTitle] = useState(meta.title)
  const [className, setClassName] = useState(meta.className)
  const [progress, setProgress] = useState(meta.progress)
  const [blueprintPath, setBlueprintPath] = useState(meta.blueprintPath)

  return (
    <div className="dialog-back" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <h2>会话约定</h2>
        <div className="hint" style={{ marginBottom: 'var(--sp-4)' }}>
          这些是 agent 每次开工都要读的约定（进度、班级、蓝图）；改完立刻生效。
          禁用清单在蓝图文件里（<span className="mono">forbidKnowledge</span>）。
        </div>
        <div className="field">
          <label>卷子标题</label>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label>班级</label>
          <input value={className} onChange={(event) => setClassName(event.target.value)} />
        </div>
        <div className="field">
          <label>教学进度</label>
          <input value={progress} onChange={(event) => setProgress(event.target.value)} />
        </div>
        <div className="field">
          <label>蓝图文件</label>
          <input value={blueprintPath} onChange={(event) => setBlueprintPath(event.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="pri" onClick={() => onSave({ title, className, progress, blueprintPath })}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
