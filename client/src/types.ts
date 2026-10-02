/**
 * 服务端投影的类型（与 packages/plugin-web 的接口一一对应）。
 * 界面**不猜服务端形状**：对不上就该在这里报错，而不是在渲染时 undefined。
 */

export interface EvidenceView {
  pass: boolean
  detail?: string
}

export interface ItemView {
  id: string
  slot: string
  knowledge: readonly string[]
  type: string
  score: number
  lifecycle: string
  stem: string
  answer: string
  /** 图由服务端按 spec 渲染好；界面只显示 */
  figure: string
  constructor: string
  seed: number
  evidence: Readonly<Record<string, EvidenceView>>
  /** 以下字段只有 /api/session 的题位带 */
  difficulty?: readonly [number, number]
  slotKey?: string
  confirmedBy?: string | null
  confirmedAt?: string | null
  knowledgeWanted?: readonly string[]
}

export interface BlueprintRowView {
  key: string
  knowledge: readonly string[]
  cognitive: string
  type: string
  count: number
  difficulty: readonly [number, number]
  score: number
}

export interface BlueprintView {
  paper: { title: string; totalScore: number; minutes: number; className: string }
  blueprint: readonly BlueprintRowView[]
  constraints: { forbidKnowledge: readonly string[] }
}

export interface SlotBindingView {
  slot: string
  itemId: string
  confirmedBy: string | null
  confirmedAt: string | null
}

export interface VersionView {
  version: number
  at: string
  reason: string
  totalScore: number
  scoreGap: number
  attempts: number
  gaps: readonly { slot: string; missing: number; reason: string }[]
  bindings: readonly SlotBindingView[]
}

export interface SlotChangeView {
  slot: string
  change: 'added' | 'removed' | 'replaced' | 'same'
  from?: string
  to?: string
}

export interface SessionMetaView {
  id: string
  title: string
  className: string
  progress: string
  blueprintPath: string
  createdAt: string
  frozen: boolean
}

export interface SessionView {
  meta: SessionMetaView
  blueprint: BlueprintView
  slots: readonly ItemView[]
  versions: readonly VersionView[]
  diff: readonly SlotChangeView[]
}

export interface KnowledgeView {
  nodes: readonly { key: string; prerequisites: readonly string[] }[]
  learned: readonly string[]
}

export interface StateView {
  blueprint: BlueprintView
  items: readonly ItemView[]
  knowledge: KnowledgeView
}

export interface SettingsView {
  model: { configured: boolean; name: string }
  corpus: { total: number; distributable: number; bySource?: Readonly<Record<string, number>>; byKnowledge?: Readonly<Record<string, number>> }
  websearch: { enabled: boolean }
  constructors: readonly string[]
  gates: readonly string[]
}

export interface RunEventView {
  step: number
  kind: 'assistant' | 'tool' | 'gate'
  text: string
}

export interface RunView {
  goal: string
  steps: number
  transcript: readonly RunEventView[]
  stored: readonly string[]
  stopped: 'done' | 'max-steps' | 'no-llm'
}

export interface LiveEvent {
  kind: 'stored' | 'rejected' | 'confirmed' | 'run:step'
  at: string
  id?: string
  slot?: string
  by?: string
  text?: string
  step?: number
  verdict?: { gate: string; reason: string; fixable: boolean; hint?: string }
}
