import type { Context } from '@deepseek-ai/cordis'
import type { Item, Verdict } from '@examharness/core'
import { checkTex, normalize, numbers, parseJsonObject } from '@examharness/core'
import z from 'schemastery'

/**
 * 回译闸门（语言保真）。
 *
 * 原理（docs/agent/01 §2）：题面终究要给人读，所以序列化不可省，
 * 但"这题写得对不对"这个无法回答的问题，可以换成
 * **"题面是否忠实编码了我知道为真的那个结构"**——后者是可回答的：
 *
 *     构造实例 →（LLM 序列化）→ 题面 →（LLM 回译）→ 结构′ → 与实例比对
 *
 * 这是编译器里的 round-trip 测试。它**不是**在验证答案（答案由构造保证），
 * 而是在验证语言层有没有把条件写漏、写错、写成另一道题。
 *
 * 只对**模型序列化**的题面生效：模板序列化是确定性的，不需要往返。
 */

export const name = 'verify-roundtrip'
export const inject = ['llm']

export const Config = z.object({
  /** 严格模式：回译拿不到结构就判定失败（默认如此，宁可退回重写） */
  strict: z.boolean().default(true),
})

export interface RoundTripConfig {
  strict: boolean
}

const PARSER_PROMPT = [
  '你是题面解析器。给你一段初中数学题的题干，把它还原成结构，只输出 JSON：',
  '{"goal": "题目要求什么", "givensCount": 条件的条数, "answer": "你解出的答案"}',
  '要求：',
  '1. 只依据题面字面信息，不要脑补任何未写出的条件；',
  '2. givensCount 数的是**题面显式给出的条件**条数；',
  '3. answer 用与题面一致的记法（例如 "AB = 8" 或 "x = −2.5"）；',
  '4. 不要输出 JSON 以外的任何内容。',
].join('\n')

interface ParsedStem {
  goal: string
  givensCount: number
  answer: string
}

function readParsed(value: Record<string, unknown> | undefined): ParsedStem | undefined {
  if (value === undefined) return undefined
  const goal = value.goal
  const count = value.givensCount
  const answer = value.answer
  if (typeof goal !== 'string' || typeof answer !== 'string') return undefined
  if (typeof count !== 'number' || !Number.isFinite(count)) return undefined
  return { goal, givensCount: count, answer }
}

/** 目标是否讲的是同一件事：用实例目标里的关键词做包含判定 */
function goalMatches(instanceGoal: string, parsedGoal: string): boolean {
  const tokens = instanceGoal.split(/[\s/]+/).filter((token) => token !== '')
  if (tokens.length === 0) return false
  const normalized = normalize(parsedGoal)
  return tokens.some((token) => normalized.includes(normalize(token)))
}

/**
 * LaTeX 这一层也要卡：公式写歪了（下标写错、括号漏了）不该等到老师看见，
 * 而且**公式里的数字必须与构造实例一致**——否则就是"构造是对的、写出来是另一道题"。
 */
function checkTexLayer(item: Item): Verdict | undefined {
  const tex = item.prose.tex
  if (tex === undefined) return undefined
  const fragments: [string, string][] = [
    ...(tex.stem === undefined ? [] : ([['题面公式', tex.stem]] as [string, string][])),
    ...(tex.answer === undefined ? [] : ([['答案公式', tex.answer]] as [string, string][])),
    ...(tex.solution ?? []).map((part, index) => [`解析第 ${String(index + 1)} 步`, part] as [string, string]),
  ]
  for (const [label, fragment] of fragments) {
    const result = checkTex(fragment)
    if (!result.ok) {
      return {
        pass: false,
        gate: name,
        reason: `${label}的 LaTeX 编译不过：${result.error}`,
        fixable: true,
        hint: '数学由构造给出，别自己改写公式；只把它嵌进句子里',
      }
    }
  }

  // **题面公式**的数字必须是构造参数里出现过的：题面说的就是那道题，数字不许飘。
  // 答案与解析里会出现**推导出来的量**（比如两点间距离 = |x₂ − x₁|），那些本来就不在参数里，
  // 所以只对题面做这条检查——多查一步会把正确的推导当成错的。
  if (tex.stem !== undefined) {
    const allowed = new Set(numbers(JSON.stringify(item.instance.params)))
    for (const value of numbers(tex.stem)) {
      // 0 与 1 是结构性数字（「= 0」「系数 1」），不是题目数据：查它们只会误伤
      if (value === '0' || value === '1') continue
      if (!allowed.has(value)) {
        return {
          pass: false,
          gate: name,
          reason: `题面公式里出现了构造参数里没有的数字（${value}）`,
          fixable: true,
          hint: '题面公式必须照着构造写，数字不要手改',
        }
      }
    }
  }
  return undefined
}

export function apply(ctx: Context, config: RoundTripConfig): void {
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    // LaTeX 层对**任何**序列化方式都成立（模板也一样），先卡它
    const texVerdict = checkTexLayer(item)
    if (texVerdict !== undefined) return { ...verdict, ...texVerdict }

    // 模板序列化是确定性的：不需要往返（也就不会白花一次模型调用）
    if (item.prose.serializer.model === 'template') return verdict

    if (!ctx.llm.configured) {
      return {
        pass: false,
        gate: name,
        reason: '题面由模型序列化，但没有可用的模型做回译校验',
        fixable: false,
        hint: '要么配置模型密钥，要么改用模板序列化',
      }
    }

    const reply = await ctx.llm.chat([
      { role: 'system', content: PARSER_PROMPT },
      { role: 'user', content: item.prose.stem },
    ])
    const parsed = readParsed(parseJsonObject(reply.content))

    if (parsed === undefined) {
      if (config.strict) {
        return {
          pass: false,
          gate: name,
          reason: '回译失败：题面无法被还原成结构',
          fixable: true,
          hint: '题面表述有歧义，重写一遍',
        }
      }
      // 非严格模式：留痕放行，但**必须标 needsReview**——没验成就是没验成，
      // 这种题要落到"待复核"，等老师签字（R4）
      return {
        pass: true,
        needsReview: true,
        evidence: {
          ...verdict.evidence,
          roundtrip: { pass: true, detail: '非严格模式：回译未拿到结构，本项未验成，需人工复核' },
        },
      }
    }

    const problems: string[] = []
    if (!goalMatches(item.instance.goal, parsed.goal)) {
      problems.push(`目标不一致（题面要求「${parsed.goal}」，构造目标是「${item.instance.goal}」）`)
    }
    if (parsed.givensCount !== item.instance.givens.length) {
      problems.push(`条件条数不一致（题面 ${parsed.givensCount} 条，构造 ${item.instance.givens.length} 条）`)
    }
    if (normalize(parsed.answer) !== normalize(item.witness.answer)) {
      problems.push(`答案不一致（回译得到「${parsed.answer}」，构造答案是「${item.witness.answer}」）`)
    }

    if (problems.length > 0) {
      return {
        pass: false,
        gate: name,
        reason: `回译不一致：${problems.join('；')}`,
        fixable: true,
        hint: '题面没有忠实表达构造出来的结构，重写题面（不要改数学）',
      }
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        roundtrip: {
          pass: true,
          detail: `回译一致：目标、条件 ${parsed.givensCount} 条、答案「${parsed.answer}」`,
        },
      },
    }
  })
}
