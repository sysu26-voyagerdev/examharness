import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 知识边界闸门。
 * 两层判断——本卷禁用的知识点（蓝图约束），以及超出已学范围的前置知识。
 * 都属于结构性违规：改措辞没用，必须换知识点，所以 fixable = false。
 */

export const name = 'verify-scope'
export const inject = ['graph']

export const Config = z.object({
  /** 本卷禁用的知识点（未学内容） */
  forbid: z.array(z.string()).default([]),
})

export interface ScopeConfig {
  forbid: string[]
}

export function apply(ctx: Context, config: ScopeConfig): void {
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
      pass: true,
      evidence: {
        ...verdict.evidence,
        scope: {
          pass: true,
          detail: `前置闭包合法：${ctx.graph.closure(item.slot.knowledge).join('、')}`,
        },
      },
    }
  })
}
