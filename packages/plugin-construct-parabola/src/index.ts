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
const COVERED = ['与坐标轴交点', '对称轴', '顶点式'] as const

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
  const bs = b === 0 ? '' : b > 0 ? ` + ${b === 1 ? '' : String(b)}x` : ` − ${-b === 1 ? '' : String(-b)}x`
  const cs = c === 0 ? '' : c > 0 ? ` + ${String(c)}` : ` − ${String(-c)}`
  return `y = x²${bs}${cs}`
}

/** 同一个多项式的 LaTeX 写法（正文显示用这个；上面的纯文本留给闸门做数字比对） */
function polyTex(b: number, c: number): string {
  const bs = b === 0 ? '' : b > 0 ? ` + ${b === 1 ? '' : String(b)}x` : ` - ${-b === 1 ? '' : String(-b)}x`
  const cs = c === 0 ? '' : c > 0 ? ` + ${c}` : ` - ${-c}`
  return `y = x^{2}${bs}${cs}`
}

export class ConstructService extends Service implements ConstructApi {
  static Config = Config

  private readonly factories = new Map<string, Constructor>()
  /** kind → 它覆盖的知识点：**选题位靠这个匹配**，不由某个插件私藏一张表 */
  private readonly covers = new Map<string, readonly string[]>()

  constructor(ctx: Context, _config: ConstructConfig) {
    super(ctx, 'construct')
  }

  register(kind: string, factory: Constructor, covers: readonly string[] = []): void {
    this.factories.set(kind, factory)
    this.covers.set(kind, covers)
  }

  /** 每个构造器覆盖哪些知识点（界面与文档都靠它说清"现在能出什么题"） */
  coverage(): Readonly<Record<string, readonly string[]>> {
    return Object.fromEntries(this.covers)
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

  /** 题位能用哪些构造器（按注册顺序；组装时挨个试，小题过不了分量闸门就换下一个） */
  candidates(slot: BlueprintRow): readonly string[] {
    return [...this.covers]
      .filter(([, keys]) => slot.knowledge.some((key) => keys.includes(key)))
      .map(([kind]) => kind)
  }

  /** 用指定的构造器构造（kind 不在注册表里就抛错，不做静默降级） */
  generateWith(slot: BlueprintRow, seed: number, kind: string): Item {
    const factory = this.factories.get(kind)
    if (factory === undefined) throw new Error(`没有叫 ${kind} 的构造器`)
    return factory(slot, seed)
  }

  /**
   * 按题位选构造器：找第一个**声明覆盖了该题位知识点**的 kind。
   * 覆盖不到就不构造（不静默降级）——蓝图里写系统出不了的题位，就必须如实报缺口。
   */
  private pick(slot: BlueprintRow): string | undefined {
    for (const [kind, keys] of this.covers) {
      if (slot.knowledge.some((key) => keys.includes(key))) return kind
    }
    return undefined
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
    // 卷面上显示的答案（行内 LaTeX）；witness.answer 保持朴素写法给闸门做比对
    // 注意：模板字符串里 LaTeX 的反斜杠要写两个（`\left`）——
    // 写一个会被当成转义吃掉（`\r` 还会变成回车），这个坑有专门的测试盯着
    const answerTex = wantsAxis
      ? `x = ${minus(h)}`
      : wantsVertex
        ? `\\left(${minus(h)},\\,${minus(k)}\\right)`
        : `AB = \\left|x_{2} - x_{1}\\right| = ${String(length)}`

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

    // 干扰项**必须与问法一致**：问对称轴就给"对称轴的典型错解"，
    // 不能拿"AB 的长度"去当干扰项（真实踩过：卷面上问对称轴，三个选项却是 AB = 11/8/1）。
    const wrongPool: readonly { text: string; errorType: string }[] = wantsAxis
      ? [
          { text: `x = ${minus(-h)}`, errorType: '对称轴符号写反' },
          { text: `x = ${minus(r1)}`, errorType: '拿一个交点当对称轴' },
          { text: `x = ${minus(r2)}`, errorType: '拿另一个交点当对称轴' },
          { text: `x = ${minus(-b)}`, errorType: '把一次项系数当对称轴' },
        ]
      : wantsVertex
        ? [
            { text: `(${minus(h)}, ${minus(-k)})`, errorType: '顶点纵坐标符号写反' },
            { text: `(${minus(-h)}, ${minus(k)})`, errorType: '顶点横坐标符号写反' },
            { text: `(${minus(r1)}, ${minus(r2)})`, errorType: '把交点当成顶点' },
            { text: `(${minus(h)}, ${minus(k + 1)})`, errorType: '计算错' },
          ]
        : [
            { text: `AB = ${String(length + 2)}`, errorType: '计算错' },
            { text: `AB = ${String(length - 1)}`, errorType: '漏解' },
            { text: `AB = ${String(Math.abs(r1 - r2) + 3)}`, errorType: '计算错' },
            { text: `AB = ${String(Math.abs(r1) + Math.abs(r2))}`, errorType: '把两根绝对值相加' },
          ]
    const options: readonly Option[] | undefined =
      slot.type === '选择'
        ? [
            { key: 'A', text: answer },
            ...wrongPool
              .filter((entry) => entry.text !== answer)
              // 长度题的选项不能是负数或 0（真卷子不会给"长为 −6"的选项）
              .filter((entry) => !/^-?\d+(\.\d+)?$/.test(entry.text) || Number(entry.text) > 0)
              .filter((entry, index, all) => all.findIndex((other) => other.text === entry.text) === index)
              .slice(0, 3)
              .map((entry, index) => ({
                key: ['B', 'C', 'D'][index] ?? 'D',
                text: entry.text,
                errorType: entry.errorType,
              })),
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
        // 数学**写在题面里**（行内 LaTeX）：卷面直接由 KaTeX 渲染，
        // 不再另给一份"公式层"让界面单独摆一块（那是重复，用户也说了没意义）。
        stem: `已知抛物线 $${polyTex(b, c)}$ 与 $x$ 轴交于 $A$、$B$ 两点。求${goal}。`,
        ...(options === undefined ? {} : { options }),
        answerText: answerTex,
        solution: [
          `令 $y = 0$：$(x - ${r1})(x - ${r2}) = 0$`,
          `得 $x_{1} = ${r1}$，$x_{2} = ${r2}$`,
          `所以 $${answerTex}$`,
        ],
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
    // 第三个参数声明覆盖的知识点：**选题位靠它匹配**（以前这张表私藏在这，别的构造器接不进来）
    scope.construct.register('parabola/roots', createParabolaRoots(config), COVERED)
  })
}
