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
  /**
   * 题型声明的**检验点**：把 `at` 代入 `expr`，应当得到 `expect`。
   *
   * 有了它，闸门不必认识每个题型——它只要会算数就能独立核对
   * （验收时还会做变异检验：把参数改坏，检验点必须失败，否则判它无效）。
   */
  checks?: readonly { expr: string; at: Readonly<Record<string, number>>; expect: number }[]
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
  /**
   * 数学的 **LaTeX 版**：由**构造器**给出（不是模型写的）。
   *
   * 为什么要单独一份：正文是给人读的散文，数学必须是可编译、可渲染、可比对的东西。
   * 模型只负责把 LaTeX **嵌进**句子（`$...$`），不允许自己改里头的数学（R1）。
   * 回译闸门会拿 LaTeX 里的数字与构造参数比对——写歪了会被拦下。
   */
  tex?: {
    stem?: string
    answer?: string
    solution?: readonly string[]
  }
  /** 序列化用的模型与版本：题面可重生成，故留版本 */
  serializer: { model: string; version: number }
}

/** y = ax² + bx + c */
export interface QuadraticFunction {
  a: number
  b: number
  c: number
}

export interface FunctionGraphSpec {
  kind: 'function-graph'
  /** **数据同源**：曲线由系数决定，渲染器不解析任何字符串 */
  quadratics: readonly QuadraticFunction[]
  domain: readonly [number, number]
  /** 图上标注的点；按约定它们都在曲线上（断言会验证这一点） */
  points: readonly { label: string; x: number; y: number }[]
  annotations?: readonly string[]
}

/**
 * 平面几何图：点、线段、圆、长度标注、直角标记。
 *
 * 规矩与函数图一致（ADR-0009）：**图由坐标算出来**，不解析任何字符串；
 * 标注的长度必须等于两点距离（断言会核），直角标记只画在真正的直角上——
 * **图不能撒谎**：不按比例时也不得暗示错误的相等关系。
 */
export interface PlaneGeometrySpec {
  kind: 'plane-geometry'
  /** 点：名字 + 坐标（世界坐标，渲染器自己缩放） */
  points: readonly { label: string; x: number; y: number }[]
  /** 线段：两端点名 */
  segments: readonly { from: string; to: string; dashed?: boolean }[]
  /** 圆：圆心点名 + 半径 */
  circles?: readonly { center: string; radius: number }[]
  /** 直角标记：顶点 + 两条边上的另一点（渲染前会按坐标核验确实是 90°） */
  rightAngles?: readonly { vertex: string; armA: string; armB: string }[]
  /** 长度标注：写在线段中点附近（值由构造器给出，断言核验 = 两点距离） */
  labels?: readonly { of: string; text: string }[]
}

export type FigureSpec = FunctionGraphSpec | PlaneGeometrySpec

/** 渲染产物：SVG + 断言结果。断言不过就不许入库（见 verify-figure 闸门） */
export interface FigureArtifact {
  svg: string
  assertions: Readonly<Record<string, boolean>>
}

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
  /**
   * 通过。`needsReview = true` 表示**过了但有疑点**（例如非严格模式下没验成），
   * 这种题入库后状态是 `needs_review`，只能由人确认（R4）。
   */
  | { pass: true; evidence?: Evidence; needsReview?: boolean }
  | { pass: false; gate: string; reason: string; fixable: boolean; hint?: string }

export type MaybePromise<T> = T | Promise<T>
