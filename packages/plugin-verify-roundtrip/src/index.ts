import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import { normalize, parseJsonObject } from '@examharness/core'
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

export function apply(ctx: Context, config: RoundTripConfig): void {
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

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
      // 非严格模式：留痕放行，但要在证据里写清楚"这一项没验成"
      return {
        pass: true,
        evidence: {
          ...verdict.evidence,
          roundtrip: { pass: true, detail: '非严格模式：回译未拿到结构，本项未验成' },
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
