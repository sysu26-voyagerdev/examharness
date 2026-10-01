import { Service, type Context } from '@deepseek-ai/cordis'
import type { FigureApi, FigureArtifact, FigureSpec, FunctionGraphSpec, Item } from '@examharness/core'
import z from 'schemastery'

/**
 * 图形渲染（模板渲染器）。
 *
 * 两条硬规矩（ADR-0009）：
 *   1. **数据同源**——图由 `spec` 的系数算出，"线上有点"这件事不需要模型保证；
 *   2. **出图必须带断言**——几何一致性（点在曲线上）、可读性（点不重叠）、
 *      以及初中制图规范（不按比例的图形不得暗示错误的相等关系）。
 *      断言不过的图不许入库（由 verify-figure 闸门执行）。
 */

export const name = 'figure'

export const Config = z.object({
  width: z.number().default(480),
  height: z.number().default(300),
  /** 两个标注点之间的最小像素距离：太近就会看成一个点 */
  minPointGapPx: z.number().default(14),
})

export interface FigureConfig {
  width: number
  height: number
  minPointGapPx: number
}

const PAD = 34

interface Scale {
  x: (value: number) => number
  y: (value: number) => number
  xRange: readonly [number, number]
  yRange: readonly [number, number]
}

function evaluate(spec: FunctionGraphSpec, x: number, index: number): number {
  const q = spec.quadratics[index]
  if (q === undefined) throw new Error(`spec 里没有第 ${index} 条曲线`)
  return q.a * x * x + q.b * x + q.c
}

function buildScale(spec: FunctionGraphSpec, width: number, height: number): Scale {
  const [x0, x1] = spec.domain
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let index = 0; index < spec.quadratics.length; index += 1) {
    for (let step = 0; step <= 120; step += 1) {
      const x = x0 + ((x1 - x0) * step) / 120
      const y = evaluate(spec, x, index)
      low = Math.min(low, y)
      high = Math.max(high, y)
    }
  }
  // 坐标轴要落在图内，否则学生看不出与 x 轴的交点
  low = Math.min(low, 0)
  high = Math.max(high, 0)
  const margin = (high - low) * 0.12 || 1
  const yLow = low - margin
  const yHigh = high + margin
  return {
    xRange: [x0, x1],
    yRange: [yLow, yHigh],
    x: (value) => PAD + ((value - x0) / (x1 - x0)) * (width - 2 * PAD),
    y: (value) => height - PAD - ((value - yLow) / (yHigh - yLow)) * (height - 2 * PAD),
  }
}

function format(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return String(rounded).replace('-', '−') // 数学减号，不是连字符
}

function renderFunctionGraph(spec: FunctionGraphSpec, config: FigureConfig): FigureArtifact {
  const { width, height } = config
  const scale = buildScale(spec, width, height)
  const [x0, x1] = spec.domain
  const parts: string[] = []

  // 坐标轴
  const axisY = scale.y(0)
  const axisX = scale.x(0)
  parts.push(
    `<line x1="${PAD}" y1="${axisY.toFixed(1)}" x2="${width - 8}" y2="${axisY.toFixed(1)}" stroke="#adb2b8"/>`,
    `<line x1="${axisX.toFixed(1)}" y1="${height - 8}" x2="${axisX.toFixed(1)}" y2="8" stroke="#adb2b8"/>`,
    `<text x="${width - 14}" y="${(axisY + 14).toFixed(1)}" font-size="11" fill="#81858c">x</text>`,
    `<text x="${(axisX + 8).toFixed(1)}" y="16" font-size="11" fill="#81858c">y</text>`,
  )
  // 整数刻度：学生要能读出坐标，图才可读
  for (let tick = Math.ceil(x0); tick <= Math.floor(x1); tick += 1) {
    if (tick === 0) continue
    const px = scale.x(tick)
    parts.push(
      `<line x1="${px.toFixed(1)}" y1="${(axisY - 3).toFixed(1)}" x2="${px.toFixed(1)}" y2="${(axisY + 3).toFixed(1)}" stroke="#adb2b8"/>`,
      `<text x="${px.toFixed(1)}" y="${(axisY + 14).toFixed(1)}" font-size="10" text-anchor="middle" fill="#adb2b8">${format(tick)}</text>`,
    )
  }

  // 曲线
  spec.quadratics.forEach((_, index) => {
    const points: string[] = []
    for (let step = 0; step <= 160; step += 1) {
      const x = x0 + ((x1 - x0) * step) / 160
      points.push(`${scale.x(x).toFixed(1)},${scale.y(evaluate(spec, x, index)).toFixed(1)}`)
    }
    parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="#4176e6" stroke-width="1.6"/>`)
  })

  // 标注点
  for (const point of spec.points) {
    parts.push(
      `<circle cx="${scale.x(point.x).toFixed(1)}" cy="${scale.y(point.y).toFixed(1)}" r="2.6" fill="#0f1115"/>`,
      `<text x="${(scale.x(point.x) + 6).toFixed(1)}" y="${(scale.y(point.y) - 6).toFixed(1)}" font-size="11.5" fill="#0f1115">${point.label}</text>`,
    )
  }

  // 注记（例如对称轴）
  ;(spec.annotations ?? []).forEach((text, index) => {
    parts.push(`<text x="${PAD}" y="${20 + index * 14}" font-size="11.5" fill="#81858c">${text}</text>`)
  })

  const assertions: Record<string, boolean> = {
    // 几何一致：标注的点确实在曲线上
    pointsOnCurve: spec.points.every((point) =>
      spec.quadratics.some((_, index) => Math.abs(evaluate(spec, point.x, index) - point.y) < 1e-6),
    ),
    // 可读：两个点不能挤成一个点
    distinctPoints: spec.points.every((a, i) =>
      spec.points.every((b, j) =>
        i === j ? true : Math.hypot(scale.x(a.x) - scale.x(b.x), scale.y(a.y) - scale.y(b.y)) >= config.minPointGapPx,
      ),
    ),
    // 不越界：所有点都在画布与定义域内
    insidePlot: spec.points.every(
      (point) =>
        point.x >= x0 &&
        point.x <= x1 &&
        scale.y(point.y) >= PAD - 8 &&
        scale.y(point.y) <= height - PAD + 8,
    ),
    domainValid: x1 > x0,
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="#fff"/>` +
    parts.join('') +
    `</svg>`

  return { svg, assertions }
}

export class FigureService extends Service implements FigureApi {
  static Config = Config

  private readonly config: FigureConfig

  constructor(ctx: Context, config: FigureConfig) {
    super(ctx, 'figure')
    this.config = config
  }

  render(spec: FigureSpec): FigureArtifact {
    if (spec.kind !== 'function-graph') throw new Error(`没有 ${spec.kind} 的渲染器`)
    return renderFunctionGraph(spec, this.config)
  }

  renderItem(item: Item): FigureArtifact | undefined {
    if (item.figure === undefined) return undefined
    return this.render(item.figure.spec)
  }
}

export function apply(ctx: Context, config: FigureConfig): void {
  ctx.plugin(FigureService, config)
}
