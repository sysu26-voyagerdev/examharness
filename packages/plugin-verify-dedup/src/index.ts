import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 查重闸门（原创度）。
 * 结构指纹完全相同 = 撞题；相似度超过阈值 = 太像。两者都拒绝。
 * 通过时把「本卷最高相似度」写进证据——这是对外的原创度凭据。
 */

export const name = 'verify-dedup'
export const inject = ['bank']

export const Config = z.object({
  maxSimilarity: z.number().min(0).max(1).default(0.85),
})

export interface DedupConfig {
  maxSimilarity: number
}

export function apply(ctx: Context, config: DedupConfig): void {
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const fingerprint = ctx.bank.fingerprint(item)
    let worst = 0
    let worstId: string | undefined

    for (const other of ctx.bank.all()) {
      // 同 id = 同一道题又提了一次（submit 是插入语义，没有"更新"这条路）
      if (other.id === item.id) {
        return {
          pass: false,
          gate: name,
          reason: `该题已在库中（${other.id}）`,
          fixable: false,
          hint: '题位局部重做应当生成新的构造参数',
        }
      }
      if (ctx.bank.fingerprint(other) === fingerprint) {
        return {
          pass: false,
          gate: name,
          reason: `与已入库题目结构完全相同（${other.id}）`,
          fixable: true,
          hint: '换一组构造参数',
        }
      }
      const score = ctx.bank.similarity(item, other)
      if (score > worst) {
        worst = score
        worstId = other.id
      }
    }

    if (worst >= config.maxSimilarity) {
      return {
        pass: false,
        gate: name,
        reason: `与原题相似度过高：${worst.toFixed(2)}（${worstId ?? '未知'}）`,
        fixable: true,
        hint: '换情境或改条件',
      }
    }

    return {
      pass: true,
      evidence: {
        ...verdict.evidence,
        dedup: {
          pass: true,
          detail: `与题库最高相似度 ${worst.toFixed(2)}（阈值 ${config.maxSimilarity}）`,
        },
      },
    }
  })
}
