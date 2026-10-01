/**
 * 服务端投影的类型。
 * 注意：这里是**界面拿到的东西**，不是领域模型——界面不该看到整个 Item。
 * 服务端对应实现见 packages/plugin-web/src/index.ts 的 summarizeWith()。
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
  /** 图由服务端由 spec 渲染好，界面只负责显示（不解析、不重画） */
  figure: string
  constructor: string
  seed: number
  evidence: Readonly<Record<string, EvidenceView>>
  /** 只有 /api/paper 会带上 */
  difficulty?: readonly [number, number]
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

export interface KnowledgeView {
  nodes: readonly { key: string; prerequisites: readonly string[] }[]
  learned: readonly string[]
}

export interface StateView {
  blueprint: BlueprintView
  items: readonly ItemView[]
  knowledge: KnowledgeView
}

export interface PaperView {
  totalScore: number
  scoreGap: number
  attempts: number
  gaps: readonly { slot: string; missing: number; reason: string }[]
  slots: readonly ItemView[]
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

export interface GenerateView {
  ok: boolean
  id?: string
  error?: string
  verdict?: { gate: string; reason: string; fixable: boolean; hint?: string }
}

/** SSE 推来的实时事件（闸门判定一发生就到达界面） */
export interface LiveEvent {
  kind: 'stored' | 'rejected'
  at: string
  id: string
  slot: string
  stem: string
  verdict?: { gate: string; reason: string; fixable: boolean; hint?: string }
}
