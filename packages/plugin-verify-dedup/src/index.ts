import { signedByAll } from '@examharness/core'
import type { Context } from '@deepseek-ai/cordis'
import type { Verdict } from '@examharness/core'
import z from 'schemastery'

/**
 * 查重闸门（原创度）。
 * 结构指纹完全相同 = 撞题；相似度超过阈值 = 太像。两者都拒绝。
 * 通过时把「本卷最高相似度」写进证据——这是对外的原创度凭据。
 */

export const name = 'verify-dedup'

/** 题面层的指纹：用来区分"同一道题又提了一次"与"同一道题的修订" */
function proseOf(entry: { prose: { stem: string; answerText: string; solution: readonly string[] } }): string {
  return `${entry.prose.stem}|${entry.prose.answerText}|${entry.prose.solution.join('|')}`
}

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'dedup'

/**
 * **什么才算"已有的题目"**：在用的题。三样都算，别的都不算：
 *
 * 1. 本卷用过的（当前会话每一版题位上引用过的题号）；
 * 2. 老师确认过的（`review.confirmedBy`——他签过字，就是要留着）；
 * 3. 这次运行里刚收下的（组卷刚放上卷子的那些，`bank.fresh()`）。
 *
 * 为什么要把范围收窄（实测，不是推测）：题库里两千余道题中，同一题位堆了 116 道、
 * 全是早先"每个候选都 submit"留下的、**没在任何卷子上**。拿它们当"已有题目"，
 * 新造出来的题几乎必然撞上其中一道 → 组卷一遍遍换种子 → 老师等到的是"还没出结果"。
 * 查重是为了不重复出题，不是为了守护历史垃圾。库里那些照样进**相似度报告**
 * （证据里写出来给老师看），只是不再**拦人**。
 */
function usedIds(ctx: Context): ReadonlySet<string> {
  const used = new Set<string>(ctx.bank.fresh?.() ?? [])
  for (const item of ctx.bank.all()) {
    if (item.review.confirmedBy !== null) used.add(item.id)
  }
  // 会话可选：没有会话（极简宿主 / 单测）时，只剩"这次刚收下的"和"老师签过的"
  const session = ctx.get('session')
  for (const version of session?.versions?.() ?? []) {
    for (const binding of version.bindings) used.add(binding.itemId)
  }
  return used
}

/**
 * 判定规则的版本：**加一条新判据**就 +1（旧签字随即失效，旧题重新送审）。
 *
 * 这次改了比对范围（只跟"在用的题"比，见 usedIds），但**故意不 +1**：
 * 规则号是给"判据变严"用的——旧签字是在**更严**的范围下拿到的（当时跟库里全部比），
 * 按新范围必然也过，签字仍然成立。真 +1 的后果是当场把全库签字作废，
 * "组卷=补齐"和"沿用上一版"一起失灵（实测：重出一版把 5 个题位全换掉了）。
 * 判据变松不用重审；判据变严才要。
 */
export const rule = 1
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
  ctx.get('bank')?.declareGate?.(evidenceKey, rule)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    const limits = live(ctx, config)

    const fingerprint = ctx.bank.fingerprint(item)
    let worst = 0
    let worstId: string | undefined
    // 库里**没人在用**的同结构旧候选：不拦人，但要如实报出来（老师有权知道库里躺着一堆）
    let stale = 0
    const inUse = usedIds(ctx)

    for (const other of ctx.bank.all()) {
      // 同 id 的三条判据**不受"在用"范围影响**：那是完整性检查（id 被改写、同一道题又提一次），
      // 与"跟谁比算撞题"是两件事。放行重复提交会往盘上再追一行同样的题。
      const sameId = other.id === item.id
      if (!sameId && !inUse.has(other.id)) {
        if (ctx.bank.fingerprint(other) === fingerprint) stale += 1
        continue
      }
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
        // 同 id + 同参数，还要看**文字**：
        //   · 文字也一样 = 同一道题又提了一次 → 拦（避免手滑重复入库）；
        //   · 文字变了 = **同一道题的修订**（老师改了题面、或让 agent 润色过）→ 放行，
        //     让其它闸门去管语言层（题面忠实、数字来自构造、算式核对）。
        //   以前这里一律拦，于是"改这一道"这条路根本走不通。
        if (proseOf(other) !== proseOf(item)) continue
        // 没签全、或签的是**旧版规则**（闸门后来加了判据）→ 这是重审，放行让闸门重新判一遍
        // （不这么放，"闸门加判据"就永远管不到库里已有的题；库里 127 道"如图没图"就是这种）
        if (!signedByAll(other, ctx.bank.gates?.() ?? [])) continue
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
          detail:
            `与在用的题最高相似度 ${worst.toFixed(2)}（阈值 ${config.maxSimilarity}）` +
            (stale === 0 ? '' : `；库里另有 ${String(stale)} 道同结构的旧草稿（没人用过，不算撞题）`),
        },
        // 原创度报告：只出数字，不出语料原文（ADR-0014）
        originality: { pass: true, detail: corpusNote },
      },
    }
  })
}
