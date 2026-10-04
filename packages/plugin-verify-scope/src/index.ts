import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 知识边界闸门。
 * 两层判断——本卷禁用的知识点（蓝图约束），以及超出已学范围的前置知识。
 * 都属于结构性违规：改措辞没用，必须换知识点，所以 fixable = false。
 */

export const name = 'verify-scope'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'scope'

/** 判定规则的版本：加一条新判据就 +1（旧签字随即失效，旧题重新送审） */
export const rule = 1
export const inject = ['graph']

export const Config = z.object({
  /** 本卷禁用的知识点（未学内容） */
  forbid: z.array(z.string()).default([]),
})

export interface ScopeConfig {
  forbid: string[]
}

export function apply(ctx: Context, config: ScopeConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey, rule)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const blocked = item.slot.knowledge.filter((key) => config.forbid.includes(key))
    if (blocked.length > 0) {
      return {
        pass: false,
        gate: name,
        reason: `命中本卷禁用知识点：${blocked.join('、')}`,
        fixable: false,
        hint: '换一个已学的知识点组合',
      }
    }

    const missing = ctx.graph.missing(item.slot.knowledge)
    if (missing.length > 0) {
      return {
        pass: false,
        gate: name,
        reason: `超出已学范围：${missing.join('、')}`,
        fixable: false,
        hint: '前置闭包不合法，需要换题位或补前置知识',
      }
    }

    return {
      // 展开上游判定：不然会把它带的标记（例如 needsReview）吃掉
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          detail: `前置闭包合法：${ctx.graph.closure(item.slot.knowledge).join('、')}`,
        },
      },
    }
  })
}
