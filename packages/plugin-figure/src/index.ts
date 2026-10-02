import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  FigureApi,
  FigureArtifact,
  FigureSpec,
  FunctionGraphSpec,
  Item,
  PlaneGeometrySpec,
} from '@examharness/core'
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

/* ────────────── 平面几何：按坐标画，标注与直角都从坐标核验 ────────────── */

function geometryScale(spec: PlaneGeometrySpec, width: number, height: number): (point: { x: number; y: number }) => { x: number; y: number } {
  const xs = spec.points.map((point) => point.x)
  const ys = spec.points.map((point) => point.y)
  const radius = Math.max(0, ...(spec.circles ?? []).map((circle) => circle.radius))
  const lowX = Math.min(...xs) - radius
  const highX = Math.max(...xs) + radius
  const lowY = Math.min(...ys) - radius
  const highY = Math.max(...ys) + radius
  const spanX = highX - lowX || 1
  const spanY = highY - lowY || 1
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY)
  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2
  return (point) => ({
    x: offsetX + (point.x - lowX) * scale,
    y: height - offsetY - (point.y - lowY) * scale,
  })
}

function findPoint(spec: PlaneGeometrySpec, label: string): { label: string; x: number; y: number } {
  const found = spec.points.find((point) => point.label === label)
  if (found === undefined) throw new Error(`几何图里没有点 ${label}`)
  return found
}

/** 两条边的夹角（度）：直角标记只画在真的是直角的地方 */
function angleAt(spec: PlaneGeometrySpec, vertex: string, armA: string, armB: string): number {
  const v = findPoint(spec, vertex)
  const a = findPoint(spec, armA)
  const b = findPoint(spec, armB)
  const v1 = { x: a.x - v.x, y: a.y - v.y }
  const v2 = { x: b.x - v.x, y: b.y - v.y }
  const dot = v1.x * v2.x + v1.y * v2.y
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
  if (mag === 0) return 0
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI
}

function renderGeometry(spec: PlaneGeometrySpec, width: number, height: number, minGap: number): FigureArtifact {
  const to = geometryScale(spec, width, height)
  const parts: string[] = []
  const assertions: Record<string, boolean> = {}

  // 圆
  for (const circle of spec.circles ?? []) {
    const center = to(findPoint(spec, circle.center))
    const edge = to({ x: findPoint(spec, circle.center).x + circle.radius, y: findPoint(spec, circle.center).y })
    parts.push(`<circle cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="${Math.abs(edge.x - center.x).toFixed(1)}" fill="none" stroke="var(--ink,#222)" stroke-width="1.2"/>`)
  }

  // 线段（虚线用于辅助线）
  for (const segment of spec.segments) {
    const from = to(findPoint(spec, segment.from))
    const target = to(findPoint(spec, segment.to))
    parts.push(
      `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}" stroke="var(--ink,#222)" stroke-width="1.2"${segment.dashed === true ? ' stroke-dasharray="4 3"' : ''}/>`,
    )
  }

  // 直角标记：**先核验再画**（不是直角就不画，并把断言记成 false）
  for (const mark of spec.rightAngles ?? []) {
    const angle = angleAt(spec, mark.vertex, mark.armA, mark.armB)
    assertions[`直角 ${mark.vertex}（实际 ${angle.toFixed(1)}°）`] = Math.abs(angle - 90) < 0.5
    if (Math.abs(angle - 90) >= 0.5) continue
    const v = to(findPoint(spec, mark.vertex))
    const a = to(findPoint(spec, mark.armA))
    const b = to(findPoint(spec, mark.armB))
    const size = 9
    const unit = (from: { x: number; y: number }, toPoint: { x: number; y: number }): { x: number; y: number } => {
      const dx = toPoint.x - from.x
      const dy = toPoint.y - from.y
      const length = Math.hypot(dx, dy) || 1
      return { x: (dx / length) * size, y: (dy / length) * size }
    }
    const ua = unit(v, a)
    const ub = unit(v, b)
    parts.push(
      `<path d="M ${(v.x + ua.x).toFixed(1)} ${(v.y + ua.y).toFixed(1)} L ${(v.x + ua.x + ub.x).toFixed(1)} ${(v.y + ua.y + ub.y).toFixed(1)} L ${(v.x + ub.x).toFixed(1)} ${(v.y + ub.y).toFixed(1)}" fill="none" stroke="var(--ink,#222)" stroke-width="1"/>`,
    )
  }

  // 顶点与名字
  for (const point of spec.points) {
    const screen = to(point)
    parts.push(`<circle cx="${screen.x.toFixed(1)}" cy="${screen.y.toFixed(1)}" r="2" fill="var(--ink,#222)"/>`)
    parts.push(
      `<text x="${(screen.x + 6).toFixed(1)}" y="${(screen.y - 6).toFixed(1)}" font-size="12" fill="var(--ink,#222)">${point.label}</text>`,
    )
  }

  // 长度标注：值必须等于两点距离（对不上就把断言记成 false，图也照画但要能看出来）
  for (const label of spec.labels ?? []) {
    const [fromLabel, toLabel] = label.of.split('-')
    const from = findPoint(spec, fromLabel ?? '')
    const target = findPoint(spec, toLabel ?? '')
    const distance = Math.hypot(target.x - from.x, target.y - from.y)
    const stated = Number(label.text.replace(/[^\d.]/g, ''))
    assertions[`标注 ${label.of} = ${label.text}（实际 ${distance.toFixed(2)}）`] = Number.isFinite(stated) && Math.abs(stated - distance) < 0.01
    const middle = to({ x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 })
    parts.push(
      `<text x="${(middle.x + 5).toFixed(1)}" y="${(middle.y - 5).toFixed(1)}" font-size="12" fill="var(--ink,#222)">${label.text}</text>`,
    )
  }

  // 可读性：任意两点在屏幕上不能挤在一起
  const screens = spec.points.map((point) => to(point))
  let tooClose = false
  for (let i = 0; i < screens.length; i += 1) {
    for (let j = i + 1; j < screens.length; j += 1) {
      const a = screens[i]
      const b = screens[j]
      if (a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) < minGap) tooClose = true
    }
  }
  assertions['点不重叠'] = !tooClose

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}">${parts.join('')}</svg>`
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
    if (spec.kind === 'plane-geometry') {
      return renderGeometry(spec, this.config.width, this.config.height, this.config.minPointGapPx)
    }
    // 走到这里只剩函数图（联合类型已被上面的分支收窄）
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
