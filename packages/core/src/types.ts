/**
 * 领域模型。**唯一的真相在这里。**
 *
 * 约定（见 docs/agent/03-数据模型与接口.md）：
 * - `instance` 是构造出来的结构，答案按构造为真；`prose` 只是它的序列化，可重生成。
 * - `witness` 是解题路径，解析、难度、定解性都从它来。
 * - `evidence` 里每个「通过」都必须能回答「凭什么」。
 * - 改动本文件视为改契约，需要团队确认（AGENTS.md §6）。
 */

/** 认知水平（义务教育数学课程标准的分级） */
export type Cognitive = '了解' | '理解' | '掌握' | '灵活运用'

export type QuestionType = '选择' | '填空' | '解答'

/** 题目的生命周期；needs_review 只能由人改成 verified（ADR/AGENTS R4） */
export type Lifecycle = 'draft' | 'verified' | 'needs_review' | 'rejected' | 'published' | 'frozen'

/** 闸门名，用于在界面与轨迹里定位「是谁拦下的」 */
export type GateName = 'scope' | 'symbolic' | 'dedup' | 'figure' | 'roundtrip' | 'wellposed'

/** 构造出的结构：对象、条件、目标 */
export interface Instance {
  /** 构造器种类，例如 'parabola/roots' */
  kind: string
  /** 构造参数；同一 params + 同一种子必须复现同一道题 */
  params: Readonly<Record<string, number>>
  givens: readonly string[]
  goal: string
}

export interface WitnessStep {
  n: number
  text: string
  /** 这一步依据的定理/性质 */
  basis: string
}

export interface Witness {
  steps: readonly WitnessStep[]
  answer: string
  /** 是否需要辅助构造（辅助线、换元）→ 难度信号 */
  auxiliary: boolean
  /** 表征转换次数（文字↔符号↔图形）→ 难度信号 */
  reprSwitches: number
}

export interface Option {
  key: string
  text: string
  /** 干扰项对应的错误假设（错因库的键），诊断价值从这里来 */
  errorType?: string
}

export interface Prose {
  stem: string
  options?: readonly Option[]
  answerText: string
  solution: readonly string[]
  /** 序列化用的模型与版本：题面可重生成，故留版本 */
  serializer: { model: string; version: number }
}

export interface FunctionGraphSpec {
  kind: 'function-graph'
  functions: readonly { expr: string; domain: readonly [number, number] }[]
  points: readonly { label: string; x: number; y: number }[]
  annotations?: readonly string[]
}

export type FigureSpec = FunctionGraphSpec

export interface Figure {
  spec: FigureSpec
  renderer: 'template' | 'agent'
  /** 冻结后的产物路径；导出只读产物，不重跑 */
  artifact?: string
  /** 图形规范与几何一致性的断言结果 */
  assertions?: Readonly<Record<string, boolean>>
}

export interface EvidenceEntry {
  pass: boolean
  detail?: string
}

export type Evidence = Readonly<Record<string, EvidenceEntry>>

export interface Provenance {
  /** 构造器 id@版本 */
  constructor: string
  /** 随机种子：同种子 + 同构造器版本 = 同一道题 */
  seed: number
  models: Readonly<Record<string, string>>
  createdAt: string
  /** agent 轨迹文件（可审计） */
  trace?: string
}

/** 中央制品：题目。其他一切都是它的视图或派生 */
export interface Item {
  id: string
  /** 蓝图题位（局部重做的最小单位）：题目自带自己的分类信息，闸门才不用回头找蓝图 */
  slot: SlotSpec
  instance: Instance
  witness: Witness
  prose: Prose
  figure?: Figure
  evidence: Evidence
  provenance: Provenance
  lifecycle: Lifecycle
  /** 教师终审签字（R4） */
  review: { confirmedBy: string | null; confirmedAt: string | null }
}

/** 一个题位的分类信息（知识点 × 认知水平 × 题型 × 难度 × 分值） */
export interface SlotSpec {
  /** 题位标识，例如 'S3' */
  key: string
  knowledge: readonly string[]
  cognitive: Cognitive
  type: QuestionType
  difficulty: readonly [number, number]
  score: number
}

/** 蓝图里的一行 = 题位 + 题量 */
export interface BlueprintRow extends SlotSpec {
  count: number
}

/** 命题蓝图 = 双向细目表 */
export interface Blueprint {
  paper: { title: string; totalScore: number; minutes: number; className: string }
  blueprint: readonly BlueprintRow[]
  constraints: {
    /** 未学知识，硬禁用 */
    forbidKnowledge: readonly string[]
    figureRatio?: readonly [number, number]
  }
}

/** 闸门判定。fixable=false 表示结构性违规（如超纲），重做无意义 */
export type Verdict =
  | { pass: true; evidence?: Evidence }
  | { pass: false; gate: string; reason: string; fixable: boolean; hint?: string }

export type MaybePromise<T> = T | Promise<T>
