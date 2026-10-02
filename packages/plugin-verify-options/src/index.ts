import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import { normalize, optionDisplayText } from '@examharness/core'
import z from 'schemastery'

/**
 * 选择题闸门：**选择题必须有四个选项，而且选项本身要能被判**。
 *
 * 为什么要它：蓝图里写着"选择"，但契约里 options 是可选的——
 * 于是真实产出的卷子里出现了"3 分选择题 = 化简：√28。"（没有选项），
 * 或者把 A/B/C/D 直接写进题干文字里。这不是选择题，是伪装成选择题的填空题。
 *
 * 规矩（都可核对）：
 *   1. 选项正好 4 个，代号互不相同（A/B/C/D）；
 *   2. 选项文字两两不同（去空白后）；
 *   3. **正确答案必须在选项里**，而且是**唯一**与构造答案一致的那一个——
 *      这样"选对了"与"算对了"是同一件事，不需要额外声明答案代号。
 *
 * 选项从哪来：题型给 `distractors`（三个**典型错解**：符号错、漏根、忘开方…），
 * 框架把正确答案与错解一起打乱成四个选项——所以正确项的文字就是构造给的答案，
 * 题型不可能把答案写错。
 */

export const name = 'verify-options'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'options'

export const Config = z.object({
  /** 选择题的选项个数（中考都是四个） */
  optionCount: z.number().default(4),
})

export interface OptionsConfig {
  optionCount: number
}

export function apply(ctx: Context, config: OptionsConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict
    if (item.slot.type !== '选择') return verdict

    const options = item.prose.options
    if (options === undefined || options.length === 0) {
      return {
        pass: false,
        gate: name,
        reason: '这是选择题，但没有选项：题面里写 A．B．C．D 也不算，选项必须是题目的结构',
        fixable: true,
        hint:
          '题型里给 distractors（三个典型错解的数字或式子：符号错、漏根、忘开方…），' +
          '框架会把正确答案与它们打乱成四个选项；不要自己拼选项文字',
      }
    }
    if (options.length !== config.optionCount) {
      return {
        pass: false,
        gate: name,
        reason: `选择题要有 ${String(config.optionCount)} 个选项，现在有 ${String(options.length)} 个`,
        fixable: true,
        hint: `给 ${String(config.optionCount - 1)} 个干扰项（典型错解），正确答案由构造给出`,
      }
    }
    const keys = new Set(options.map((option) => option.key))
    if (keys.size !== options.length) {
      return { pass: false, gate: name, reason: '选项代号有重复（A/B/C/D 要各一个）', fixable: true }
    }
    const texts = options.map((option) => normalize(option.text))
    if (new Set(texts).size !== texts.length) {
      return { pass: false, gate: name, reason: '有两个选项文字一样：那样就没有唯一答案了', fixable: true }
    }
    // 两边都按"卷面上的写法"比：`BC=11` 与 `11` 是同一个选项的两种写法
    const answer = normalize(item.witness.answer)
    const same = (text: string): boolean =>
      normalize(text) === answer || normalize(optionDisplayText(text)) === answer || normalize(optionDisplayText(answer)) === normalize(optionDisplayText(text))
    const correct = options.filter((option) => same(option.text))
    if (correct.length === 0) {
      return {
        pass: false,
        gate: name,
        reason: `四个选项里没有正确答案（构造答案是「${item.witness.answer}」）：选项必须包含它`,
        fixable: true,
        hint: '正确项的文字由框架用构造答案生成，不要自己改写答案的文字',
      }
    }
    if (correct.length > 1) {
      return {
        pass: false,
        gate: name,
        reason: `有 ${String(correct.length)} 个选项都等于构造答案：答案不唯一`,
        fixable: true,
        hint: '干扰项必须与正确答案不同（改掉那个重复的错解）',
      }
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: { pass: true, detail: `四个选项，正确答案是 ${correct[0]?.key ?? '?'}` },
      },
    }
  })
}
