import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 查重闸门（原创度）。
 * 结构指纹完全相同 = 撞题；相似度超过阈值 = 太像。两者都拒绝。
 * 通过时把「本卷最高相似度」写进证据——这是对外的原创度凭据。
 */

export const name = 'verify-dedup'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'dedup'
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

/**
 * 生效阈值：设置页改过的值优先（热改），没接设置服务就退回本插件 config。
 * 阈值是**证据的一部分**（原创度凭据要写清按什么标准算的），所以只能有一个来源。
 */
function live(ctx: Context, config: DedupConfig): DedupConfig {
  const settings = ctx.get('settings')
  if (settings === undefined) return config
  const gates = settings.get().gates
  return {
    maxSimilarity: gates.bankMaxSimilarity,
    corpusWordingMax: gates.corpusWordingMax,
    corpusNumbersMin: gates.corpusNumbersMin,
  }
}

export function apply(ctx: Context, config: DedupConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const limits = live(ctx, config)

    const fingerprint = ctx.bank.fingerprint(item)
    let worst = 0
    let worstId: string | undefined

    for (const other of ctx.bank.all()) {
      // 同 id 的三种情形：
      //   · 内容不同 → id 被改写（id 由构造参数算出）——拦下；
      //   · 内容一样、而且这道题**已经被现役闸门全部签过字** → 是重复提交，照旧拦下；
      //   · 内容一样、但缺现役闸门的签字 → 这是**旧题补审**（新闸门上线后重新送一遍），
      //     跳过自身比对放行——不然新闸门永远管不到库里已有的题。
      if (other.id === item.id) {
        if (ctx.bank.fingerprint(other) !== fingerprint) {
          return {
            pass: false,
            gate: name,
            reason: `同一 id 但构造参数不同（${other.id}）：id 由构造参数算出，不该被改写`,
            fixable: false,
            hint: '不要手改题目 id；局部重做应当生成新的构造参数',
          }
        }
        // 看**库里那道题**签没签全（送进来的这次是新鲜构造的，证据当然是空的）
        const unsigned = (ctx.bank.gates?.() ?? []).filter((gate) => other.evidence[gate] === undefined)
        if (unsigned.length > 0) continue
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

    if (worst >= limits.maxSimilarity) {
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
      const hit = corpus.compare(item.prose.stem)
      // 两个条件同时满足才算"抄原题"：数字一样 + 措辞也像。
      // 只看措辞会把"同知识点不同数值"的题全误伤——那是误判，不是查重。
      if (hit.wording >= limits.corpusWordingMax && hit.numbers >= limits.corpusNumbersMin) {
        return {
          pass: false,
          gate: name,
          reason: `与语料库中的原题过于相似：数字 ${hit.numbers.toFixed(2)}、措辞 ${hit.wording.toFixed(2)}（${hit.id ?? '未知'}）`,
          fixable: true,
          hint: '换一组数值与情境，别在原题上换皮',
        }
      }
      corpusNote = `与真实题库最像：数字 ${hit.numbers.toFixed(2)}、措辞 ${hit.wording.toFixed(2)}（阈值 数字≥${limits.corpusNumbersMin.toFixed(2)} 且 措辞≥${limits.corpusWordingMax.toFixed(2)}）`
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          detail: `与题库最高相似度 ${worst.toFixed(2)}（阈值 ${config.maxSimilarity}）`,
        },
        // 原创度报告：只出数字，不出语料原文（ADR-0014）
        originality: { pass: true, detail: corpusNote },
      },
    }
  })
}
