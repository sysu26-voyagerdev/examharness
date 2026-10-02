import { Service, type Context } from '@deepseek-ai/cordis'
import { fnv1a } from '@examharness/core'
import type { BlueprintRow, Constructor, FigureSpec, Item, Option } from '@examharness/core'
import z from 'schemastery'

/**
 * 几何构造器（直角三角形 / 矩形 / 圆·垂径）。
 *
 * 几何题的关键是**图**，而图最容易撒谎：随手画一个"看起来是直角"的角、
 * 标注一个和实际长度不符的数字——学生就被带沟里了。
 * 所以这里的图与函数图同一套规矩（ADR-0009）：
 *   - 坐标由参数算出来，渲染器不解析任何字符串；
 *   - 直角标记只在**真的是 90°** 的地方画（渲染前按坐标核验）；
 *   - 长度标注必须等于两点距离（断言对不上就记 false，闸门会拦）。
 *
 * 覆盖的题位（蓝图 knowledge 用这些词）：锐角三角函数 / 四边形与特殊平行四边形 / 圆的性质
 */

export const name = 'construct-geometry'

export const Config = z.object({
  /** 勾股数组的倍数上限 */
  maxScale: z.number().default(4),
})

export interface GeometryConfig {
  maxScale: number
}

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pickInt(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1))
}

/** 组装题目（与代数构造器同一形状）：真值、题面、LaTeX、图一起定形 */
function buildItem(input: {
  slot: BlueprintRow
  seed: number
  kind: string
  params: Record<string, number>
  givens: readonly string[]
  goal: string
  answer: string
  answerTex: string
  steps: readonly { text: string; basis: string }[]
  stem: string
  stemTex: string
  solution: readonly string[]
  solutionTex: readonly string[]
  figure: FigureSpec
  options?: readonly { key: string; text: string }[]
}): Item {
  const mid = (input.slot.difficulty[0] + input.slot.difficulty[1]) / 2
  return {
    id: `it-${input.slot.key}-${String(input.seed)}-${fnv1a(`${input.kind}|${JSON.stringify(input.params)}`)}`,
    slot: { ...input.slot, difficulty: [Math.max(0, mid - 0.06), Math.min(1, mid + 0.06)] },
    instance: { kind: input.kind, params: input.params, givens: input.givens, goal: input.goal },
    witness: {
      steps: input.steps.map((step, index) => ({ n: index + 1, text: step.text, basis: step.basis })),
      answer: input.answer,
      auxiliary: false,
      reprSwitches: 1,
    },
    prose: {
      stem: input.stem,
      ...(input.options === undefined ? {} : { options: input.options.map((option): Option => ({ key: option.key, text: option.text })) }),
      answerText: input.answer,
      solution: input.solution,
      tex: { stem: input.stemTex, answer: input.answerTex, solution: input.solutionTex },
      serializer: { model: 'template', version: 1 },
    },
    figure: { spec: input.figure, renderer: 'template' },
    evidence: {},
    provenance: { constructor: `${input.kind}@v1`, seed: input.seed, models: {}, createdAt: new Date(0).toISOString() },
    lifecycle: 'draft',
    review: { confirmedBy: null, confirmedAt: null },
  }
}

/* ────────────── 1. 直角三角形：锐角三角函数 ────────────── */

const PYTHAGOREAN: readonly (readonly [number, number, number])[] = [
  [3, 4, 5],
  [6, 8, 10],
  [5, 12, 13],
  [8, 15, 17],
  [9, 12, 15],
  [7, 24, 25],
  [20, 21, 29],
]

function createRightTriangle(_config: GeometryConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const triple = PYTHAGOREAN[pickInt(random, 0, PYTHAGOREAN.length - 1)] ?? [3, 4, 5]
    const [a, b, c] = triple
    const wantsSin = random() < 0.5
    // 直角在 A：AB = b（水平），AC = a（竖直），斜边 BC = c
    const figure: FigureSpec = {
      kind: 'plane-geometry',
      points: [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: b, y: 0 },
        { label: 'C', x: 0, y: a },
      ],
      segments: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'A' },
      ],
      rightAngles: [{ vertex: 'A', armA: 'B', armB: 'C' }],
      labels: [
        { of: 'A-B', text: String(b) },
        { of: 'A-C', text: String(a) },
        { of: 'B-C', text: String(c) },
      ],
    }
    const answerText = wantsSin ? `sin B = ${String(a)}/${String(c)}` : `cos B = ${String(b)}/${String(c)}`
    return buildItem({
      slot,
      seed,
      kind: 'geometry/right-triangle',
      params: { a, b, c },
      givens: ['∠A = 90°', `AB = ${String(b)}`, `AC = ${String(a)}`],
      goal: wantsSin ? '求 sin B' : '求 cos B',
      answer: answerText,
      answerTex: wantsSin ? `\\sin B = \\dfrac{${String(a)}}{${String(c)}}` : `\\cos B = \\dfrac{${String(b)}}{${String(c)}}`,
      steps: [
        { text: '∠A = 90°，所以 BC 是斜边', basis: '直角三角形的定义' },
        { text: `由勾股定理：BC = √(${String(b)}² + ${String(a)}²) = ${String(c)}`, basis: '勾股定理' },
        {
          text: wantsSin ? `sin B = ∠B 的对边 / 斜边 = AC / BC = ${String(a)}/${String(c)}` : `cos B = ∠B 的邻边 / 斜边 = AB / BC = ${String(b)}/${String(c)}`,
          basis: '锐角三角函数的定义',
        },
      ],
      stem: `如图，在 Rt△ABC 中，∠A = 90°，AB = ${String(b)}，AC = ${String(a)}，求 ${wantsSin ? 'sin B' : 'cos B'}。`,
      stemTex: `\\angle A = 90^{\\circ},\\quad AB = ${String(b)},\\quad AC = ${String(a)}`,
      solution: [`BC = √(${String(b)}² + ${String(a)}²) = ${String(c)}`, wantsSin ? `sin B = AC/BC = ${String(a)}/${String(c)}` : `cos B = AB/BC = ${String(b)}/${String(c)}`],
      solutionTex: [
        `BC = \\sqrt{${String(b)}^{2} + ${String(a)}^{2}} = ${String(c)}`,
        wantsSin ? `\\sin B = \\dfrac{AC}{BC} = \\dfrac{${String(a)}}{${String(c)}}` : `\\cos B = \\dfrac{AB}{BC} = \\dfrac{${String(b)}}{${String(c)}}`,
      ],
      figure,
      options: [
        { key: 'A', text: wantsSin ? `${String(a)}/${String(c)}` : `${String(b)}/${String(c)}` },
        { key: 'B', text: wantsSin ? `${String(b)}/${String(c)}` : `${String(a)}/${String(c)}` },
        { key: 'C', text: `${String(a)}/${String(b)}` },
        { key: 'D', text: `${String(b)}/${String(a)}` },
      ],
    })
  }
}

/* ────────────── 2. 矩形：周长与面积 ────────────── */

function createRectangle(config: GeometryConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    const width = pickInt(random, 3, 3 + config.maxScale * 3)
    let height = pickInt(random, 2, 2 + config.maxScale * 2)
    if (height === width) height = width + 2
    const perimeter = 2 * (width + height)
    const area = width * height
    const figure: FigureSpec = {
      kind: 'plane-geometry',
      points: [
        { label: 'A', x: 0, y: 0 },
        { label: 'B', x: width, y: 0 },
        { label: 'C', x: width, y: height },
        { label: 'D', x: 0, y: height },
      ],
      segments: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'D' },
        { from: 'D', to: 'A' },
        { from: 'A', to: 'C', dashed: true },
      ],
      rightAngles: [
        { vertex: 'A', armA: 'B', armB: 'D' },
        { vertex: 'B', armA: 'C', armB: 'A' },
      ],
      labels: [
        { of: 'A-B', text: String(width) },
        { of: 'B-C', text: String(height) },
      ],
    }
    return buildItem({
      slot,
      seed,
      kind: 'geometry/rectangle',
      params: { width, height, perimeter, area },
      givens: [`AB = ${String(width)}`, `BC = ${String(height)}`],
      goal: '求周长与面积',
      answer: `周长 ${String(perimeter)}，面积 ${String(area)}`,
      answerTex: `C = ${String(perimeter)},\\quad S = ${String(area)}`,
      steps: [
        { text: `周长 = 2 × (${String(width)} + ${String(height)}) = ${String(perimeter)}`, basis: '矩形的周长公式' },
        { text: `面积 = ${String(width)} × ${String(height)} = ${String(area)}`, basis: '矩形的面积公式' },
      ],
      stem: `如图，矩形 ABCD 中，AB = ${String(width)}，BC = ${String(height)}。求这个矩形的周长与面积。`,
      stemTex: `AB = ${String(width)},\\quad BC = ${String(height)}`,
      solution: [`周长 ${String(perimeter)}`, `面积 ${String(area)}`],
      solutionTex: [`C = 2(${String(width)} + ${String(height)}) = ${String(perimeter)}`, `S = ${String(width)} \\times ${String(height)} = ${String(area)}`],
      figure,
    })
  }
}

/* ────────────── 3. 圆·垂径定理：弦长 ────────────── */

function createCircleChord(_config: GeometryConfig): Constructor {
  return (slot, seed) => {
    const random = rng(seed)
    // 弦心距与半弦长取勾股数：弦长一定是整数，答案可精确验证
    const triple = PYTHAGOREAN[pickInt(random, 0, PYTHAGOREAN.length - 1)] ?? [3, 4, 5]
    const [d, half, radius] = triple
    const chord = 2 * half
    const figure: FigureSpec = {
      kind: 'plane-geometry',
      points: [
        { label: 'O', x: 0, y: 0 },
        { label: 'A', x: -half, y: -d },
        { label: 'B', x: half, y: -d },
        { label: 'H', x: 0, y: -d },
      ],
      segments: [
        { from: 'A', to: 'B' },
        { from: 'O', to: 'A' },
        { from: 'O', to: 'H', dashed: true },
      ],
      circles: [{ center: 'O', radius }],
      rightAngles: [{ vertex: 'H', armA: 'O', armB: 'A' }],
      labels: [
        { of: 'O-A', text: String(radius) },
        { of: 'O-H', text: String(d) },
      ],
    }
    return buildItem({
      slot,
      seed,
      kind: 'geometry/circle-chord',
      params: { radius, distance: d, half, chord },
      givens: [`半径 OA = ${String(radius)}`, `弦心距 OH = ${String(d)}`, 'OH ⊥ AB'],
      goal: '求弦 AB 的长',
      answer: `AB = ${String(chord)}`,
      answerTex: `AB = ${String(chord)}`,
      steps: [
        { text: 'OH ⊥ AB，所以 H 是 AB 的中点', basis: '垂径定理' },
        { text: `在 Rt△OHA 中：AH = √(${String(radius)}² − ${String(d)}²) = ${String(half)}`, basis: '勾股定理' },
        { text: `AB = 2 × AH = ${String(chord)}`, basis: '垂径定理' },
      ],
      stem: `如图，⊙O 的半径 OA = ${String(radius)}，弦 AB 的弦心距 OH = ${String(d)}，求弦 AB 的长。`,
      stemTex: `OA = ${String(radius)},\\quad OH = ${String(d)},\\quad OH \\perp AB`,
      solution: [`AH = √(${String(radius)}² − ${String(d)}²) = ${String(half)}`, `AB = 2AH = ${String(chord)}`],
      solutionTex: [`AH = \\sqrt{${String(radius)}^{2} - ${String(d)}^{2}} = ${String(half)}`, `AB = 2 \\times ${String(half)} = ${String(chord)}`],
      figure,
    })
  }
}

export const inject = ['construct']

export class ConstructGeometryService extends Service {
  static Config = Config

  constructor(ctx: Context, config: GeometryConfig) {
    super(ctx, 'constructGeometry')
    const factories: readonly [string, Constructor, readonly string[]][] = [
      ['geometry/right-triangle', createRightTriangle(config), ['锐角三角函数']],
      ['geometry/rectangle', createRectangle(config), ['四边形与特殊平行四边形']],
      ['geometry/circle-chord', createCircleChord(config), ['圆的性质']],
    ]
    for (const [kind, factory, covers] of factories) {
      ctx.construct.register(kind, factory, covers)
    }
  }
}

export function apply(ctx: Context, config: GeometryConfig): void {
  ctx.plugin(ConstructGeometryService, config)
}
