import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import { stemCompleteness } from '@examharness/core'

/**
 * 题面闸门：**题面得是一道题**，不能只有情境。
 *
 * 真实事故：卷面上 8 道 9 分解答题全是
 * 「一块长方形试验田，长为 6√7 米，宽为 3√7 米。」——有情境、没有问题；
 * 填空题写着「一个袋子里装有 7 个红球和 11 个白球…」就没了；
 * 而且它们**全都过了闸门**，因为分量闸门数的是题型声明的 goals（声明了三问），
 * 不是题面里真的有没有问。
 *
 * 所以这条闸门不看声明，只看**学生读到的那段字**：有没有要求、有几问、填空有没有空位。
 * 判据在 `core` 的 `stemCompleteness`（验收脚本用的是同一套规则）。
 */

export const name = 'verify-question'

/** 证据键，也是向题库报到的名字（两者必须一致） */
export const evidenceKey = 'question'

export function apply(ctx: Context): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const goals = item.instance.goals ?? (item.instance.goal === '' ? [] : [item.instance.goal])
    const problem = stemCompleteness(item.prose.stem, goals, item.slot.type)
    if (problem !== undefined) {
      return {
        pass: false,
        gate: name,
        reason: problem,
        fixable: true,
        hint:
          '让题型把"问什么"写进题面：解答题按 gates 声明分几问就写几问（（1）（2）（3）），' +
          '填空题留出作答空位；情境可以有，但情境不是题目',
      }
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          detail: goals.length >= 2 ? `题面里问了 ${String(goals.length)} 问` : '题面里有明确的要求',
        },
      },
    }
  })
}
