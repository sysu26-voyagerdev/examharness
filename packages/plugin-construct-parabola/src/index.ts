import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueprintRow, ConstructApi, Constructor, FigureSpec, Item, Option } from '@examharness/core'
import { fnv1a } from '@examharness/core'
import z from 'schemastery'

/**
 * 构造器注册表 + 抛物线构造器（`parabola/roots`）。
 *
 * **构造优先**：题目不是"写"出来的，是在可控空间里造出来的——
 * 先定两根 r1、r2，函数就是 (x − r1)(x − r2)，于是"根是 r1、r2"这件事
 * 按构造为真，不需要模型来保证。文案只是它的序列化。
 */

export const name = 'construct'

export const Config = z.object({
  /** 根的取值范围 [low, high]，闭区间整数 */
  rootRange: z.array(z.number()).default([-4, 5]),
})

/** 本构造器覆盖的题位知识点 */
const COVERED = new Set(['与坐标轴交点', '对称轴', '顶点式'])

export interface ConstructConfig {
  rootRange: number[]
}

/** 确定性伪随机（LCG）：同种子 → 同序列 */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** 数学排版：负号用 U+2212，不用连字符 */
function minus(value: number): string {
  return String(value).replace('-', '−')
}

function poly(b: number, c: number): string {
  const bs = b === 0 ? '' : b > 0 ? ` + ${b}x` : ` − ${-b}x`
  const cs = c === 0 ? '' : c > 0 ? ` + ${c}` : ` − ${-c}`
  return `y = x²${bs}${cs}`
}

/** 同一个多项式的 LaTeX 写法（正文显示用这个；上面的纯文本留给闸门做数字比对） */
function polyTex(b: number, c: number): string {
  const bs = b === 0 ? '' : b > 0 ? ` + ${b}x` : ` - ${-b}x`
  const cs = c === 0 ? '' : c > 0 ? ` + ${c}` : ` - ${-c}`
  return `y = x^{2}${bs}${cs}`
}

export class ConstructService extends Service implements ConstructApi {
  static Config = Config

  private readonly factories = new Map<string, Constructor>()

  constructor(ctx: Context, _config: ConstructConfig) {
    super(ctx, 'construct')
  }

  register(kind: string, factory: Constructor): void {
    this.factories.set(kind, factory)
  }

  kinds(): readonly string[] {
    return [...this.factories.keys()]
  }

  /** 按题位选一个构造器并构造；没有可用构造器就抛错（不静默降级） */
  generate(slot: BlueprintRow, seed: number): Item {
    const kind = this.pick(slot)
    const factory = kind === undefined ? undefined : this.factories.get(kind)
    if (factory === undefined) throw new Error(`没有可用于题位 ${slot.key} 的构造器`)
    return factory(slot, seed)
  }

  /** 抛物线构造器覆盖这几类题位；覆盖不到就不构造（不静默降级） */
  private pick(slot: BlueprintRow): string | undefined {
    if (!slot.knowledge.some((key) => COVERED.has(key))) return undefined
    return this.factories.has('parabola/roots') ? 'parabola/roots' : undefined
  }
}

/** 抛物线构造器：先定根，再导出一致的事实 */
export function createParabolaRoots(config: ConstructConfig): Constructor {
  const low = config.rootRange[0] ?? -4
  const high = config.rootRange[1] ?? 5

  return (slot, seed) => {
    const next = rng(seed)
    const span = high - low + 1
    let r1 = low + Math.floor(next() * span)
    let r2 = low + Math.floor(next() * span)
    let guard = 0
    while (r2 === r1 && guard < 32) {
      r2 = low + Math.floor(next() * span)
      guard += 1
    }
    if (r1 > r2) [r1, r2] = [r2, r1]

    const b = -(r1 + r2)
    const c = r1 * r2
    const h = (r1 + r2) / 2
    const k = -((r2 - r1) ** 2) / 4
    const length = r2 - r1
    const wantsAxis = slot.knowledge.includes('对称轴')
    const wantsVertex = slot.knowledge.includes('顶点式')

    const goal = wantsAxis ? '对称轴' : wantsVertex ? '顶点坐标' : '线段 AB 的长'
    const answer = wantsAxis ? `x = ${minus(h)}` : wantsVertex ? `(${minus(h)}, ${minus(k)})` : `AB = ${length}`

    const figure: FigureSpec = {
      kind: 'function-graph',
      // 数据同源：给系数，不给字符串
      quadratics: [{ a: 1, b, c }],
      domain: [low - 1, high + 1],
      points: [
        { label: 'A', x: r1, y: 0 },
        { label: 'B', x: r2, y: 0 },
      ],
      annotations: [`对称轴 x = ${minus(h)}`],
    }

    const options: readonly Option[] | undefined =
      slot.type === '选择'
        ? [
            { key: 'A', text: answer },
            { key: 'B', text: `AB = ${length + 2}`, errorType: '计算错' },
            { key: 'C', text: `AB = ${length - 1}`, errorType: '漏解' },
            { key: 'D', text: `AB = ${r1 + r2}`, errorType: '把中点当交点' },
          ]
        : undefined

    const item: Item = {
      id: `it-${slot.key}-${seed}-${fnv1a(`parabola/roots|${r1}|${r2}`)}`,
      slot,
      instance: {
        kind: 'parabola/roots',
        params: { a: 1, b, c, r1, r2 },
        givens: [`抛物线 ${poly(b, c)}`, `与 x 轴交于 A、B 两点`],
        goal,
      },
      witness: {
        steps: [
          { n: 1, text: `令 y = 0，得 (x − ${r1})(x − ${r2}) = 0`, basis: '因式分解' },
          { n: 2, text: `解得 x₁ = ${r1}，x₂ = ${r2}`, basis: '一元二次方程' },
          {
            n: 3,
            text: wantsAxis
              ? `对称轴是两根中点：x = ${h}`
              : wantsVertex
                ? `顶点横坐标为两根中点 ${h}，代入得纵坐标 ${k}`
                : `AB = |x₂ − x₁| = ${length}`,
            basis: '抛物线的对称性',
          },
        ],
        answer,
        auxiliary: false,
        reprSwitches: 2,
      },
      prose: {
        stem: `已知抛物线 ${poly(b, c)} 与 x 轴交于 A、B 两点。求${goal}。`,
        ...(options === undefined ? {} : { options }),
        answerText: answer,
        solution: [`令 y = 0： (x − ${r1})(x − ${r2}) = 0`, `得 x₁ = ${r1}，x₂ = ${r2}`, `所以${answer}`],
        // 数学本体用 LaTeX 给一份（构造给真值，模型只负责把它嵌进句子里）
        tex: {
          stem: `${polyTex(b, c)}`,
          answer: wantsAxis
            ? `x = ${h}`
            : wantsVertex
              ? `\\left(${h},\\,${k}\\right)`
              : `\\left|x_{2} - x_{1}\\right| = ${length}`,
          solution: [
            `(x - ${r1})(x - ${r2}) = 0`,
            `x_{1} = ${r1},\\quad x_{2} = ${r2}`,
            wantsAxis
              ? `x = \\dfrac{x_{1} + x_{2}}{2} = ${h}`
              : wantsVertex
                ? `\\left(\\dfrac{x_{1} + x_{2}}{2},\\,f\\left(\\dfrac{x_{1} + x_{2}}{2}\\right)\\right) = \\left(${h},\\,${k}\\right)`
                : `AB = \\left|x_{2} - x_{1}\\right| = ${length}`,
          ],
        },
        serializer: { model: 'template', version: 1 },
      },
      figure: { spec: figure, renderer: 'template' },
      evidence: {},
      provenance: {
        constructor: 'parabola/roots@v1',
        seed,
        models: {},
        createdAt: new Date(0).toISOString(),
      },
      lifecycle: 'draft',
      review: { confirmedBy: null, confirmedAt: null },
    }
    return item
  }
}

export function apply(ctx: Context, config: ConstructConfig): void {
  ctx.plugin(ConstructService, config)
  ctx.inject(['construct'], (scope) => {
    scope.construct.register('parabola/roots', createParabolaRoots(config))
  })
}
