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
  /** 与**我们自己**题库的相似度上限：太高就是重复出题 */
  maxSimilarity: z.number().min(0).max(1).default(0.85),
  /** 与语料库：措辞相似度上限 */
  corpusWordingMax: z.number().min(0).max(1).default(0.55),
  /** 与语料库：**数字/条件重合度下限**（这一条才是"是不是同一道题"） */
  corpusNumbersMin: z.number().min(0).max(1).default(0.8),
})

export interface DedupConfig {
  maxSimilarity: number
  corpusWordingMax: number
  corpusNumbersMin: number
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

    // 语料库是**可选**能力：没有就跳过（不因此拦人），有就把原创度写进证据
    const corpus = ctx.get('corpus')
    let corpusNote = '未接入语料库'
    if (corpus !== undefined && corpus.size > 0) {
      const hit = corpus.maxSimilarity(item.prose.stem)
      // 两个条件同时满足才算"抄原题"：数字一样 + 措辞也像。
      // 只看措辞会把"同知识点不同数值"的题全误伤——那是误判，不是查重。
      if (hit.wording >= config.corpusWordingMax && hit.numbers >= config.corpusNumbersMin) {
        return {
          pass: false,
          gate: name,
          reason: `与语料库中的原题过于相似：数字 ${hit.numbers.toFixed(2)}、措辞 ${hit.wording.toFixed(2)}（${hit.id ?? '未知'}）`,
          fixable: true,
          hint: '换一组数值与情境，别在原题上换皮',
        }
      }
      corpusNote = `与真实题库最像：数字 ${hit.numbers.toFixed(2)}、措辞 ${hit.wording.toFixed(2)}（阈值 数字≥${config.corpusNumbersMin} 且 措辞≥${config.corpusWordingMax}）`
    }

    return {
      pass: true,
      evidence: {
        ...verdict.evidence,
        dedup: {
          pass: true,
          detail: `与题库最高相似度 ${worst.toFixed(2)}（阈值 ${config.maxSimilarity}）`,
        },
        // 原创度报告：只出数字，不出语料原文（ADR-0014）
        originality: { pass: true, detail: corpusNote },
      },
    }
  })
}
