import katex from 'katex'
import { normalize } from './json.js'

/**
 * 数学的**唯一渲染口**：LaTeX 进，MathML 出。
 *
 * 两条自觉：
 *   1. 服务端渲染，界面只显示——和"图由服务端按 spec 渲染"同一套路。
 *      渲染成 MathML 而不是 KaTeX 的 HTML：浏览器原生就能显示（不需要字体与 CSS），
 *      Word 打开导出的卷子也认它。
 *   2. **能编译才算数**：闸门拿 checkTex 卡住写歪的公式（写错的下标、漏掉的括号），
 *      而不是等老师看见一坨红字。
 */

/** 一段行内数学（`$...$`）或块级数学（`$$...$$`） */
const MATH_PATTERN = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g

function render(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      output: 'mathml',
      displayMode,
      throwOnError: true,
      // 不允许 \href / \includegraphics 之类能往外跑的东西
      trust: false,
      strict: false,
    })
  } catch (error) {
    // 渲染不出来时**不要假装**：把原文和原因一起放到页面上
    const reason = error instanceof Error ? error.message : String(error)
    const escaped = escapeHtml(tex)
    return `<span class="tex-broken" title="${escapeHtml(reason)}">${escaped}</span>`
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** LaTeX 是否能编译（闸门用；失败时给出原因，模型才知道怎么改） */
export function checkTex(tex: string): { ok: true } | { ok: false; error: string } {
  try {
    katex.renderToString(tex, { output: 'mathml', displayMode: true, throwOnError: true, trust: false, strict: false })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.split('\n')[0] ?? message }
  }
}

/** 把一个 LaTeX 片段渲染成 MathML（块级） */
export function texToMathml(tex: string): string {
  return render(tex, true)
}

/**
 * 把一段**混着数学的正文**渲染成 HTML：`$...$` 变 MathML，其余原样转义。
 * 模型写的题面就走这条路——它只负责在句子里放 `$...$`，数学本体来自构造。
 */
export function renderMathInText(text: string): string {
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index ?? 0
    const whole = match[0]
    const block = match[1]
    const inline = match[2]
    out += escapeHtml(text.slice(cursor, index))
    out += render(block ?? inline ?? '', block !== undefined)
    cursor = index + whole.length
  }
  out += escapeHtml(text.slice(cursor))
  return out
}

/**
 * 一段文字里出现的数字（归一化之后取）。
 * **只有这一份实现**：查重闸门、语料比对、LaTeX 校验都用它，别各写各的。
 */
export function numbers(text: string): Set<string> {
  return new Set(normalize(text).match(/\d+(?:\.\d+)?/g) ?? [])
}

/** 正文里有没有数学（用来决定要不要上 MathML 那条路） */
export function hasMath(text: string): boolean {
  return /\$[^$\n]+\$/.test(text)
}
