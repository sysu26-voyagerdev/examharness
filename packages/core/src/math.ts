import katex from 'katex'
import { normalize } from './json.js'
import { closeEnough } from './expr.js'

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

/**
 * 渲染成什么：
 *   - `html`（默认）：KaTeX 的 HTML + 官方 CSS —— **界面用这个**。MathML 那条路试过，
 *     浏览器里的排版不可靠（逐字符竖排），页面上直接崩；
 *   - `mathml`：**导出用**。Word 认 MathML，浏览器也认，且不依赖字体与 CSS。
 */
type MathMode = 'html' | 'mathml'

function render(tex: string, displayMode: boolean, mode: MathMode): string {
  try {
    return katex.renderToString(tex, {
      output: mode,
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
    katex.renderToString(tex, { output: 'html', displayMode: true, throwOnError: true, trust: false, strict: false })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message.split('\n')[0] ?? message }
  }
}

/** 一个 LaTeX 片段 → MathML（导出用；Word 与浏览器都认） */
export function texToMathml(tex: string): string {
  return render(tex, true, 'mathml')
}

/** 一个 LaTeX 片段 → KaTeX HTML（界面用） */
export function texToHtml(tex: string, display = true): string {
  return render(tex, display, 'html')
}

/**
 * 把一段**混着数学的正文**渲染成 HTML：`$...$` 变 MathML，其余原样转义。
 * 模型写的题面就走这条路——它只负责在句子里放 `$...$`，数学本体来自构造。
 */
/**
 * 答案的"值签名"：把一段答案文字里的**数**取出来（分数按值算），字母序列单独取。
 *
 * 为什么要它：答案是人写的，同一个人不同次写出来也会不一样——
 * `（1）平均数 = 6；（2）中位数 = 5.5` 与 `平均数 = 6；中位数 = 5.5` 是同一个答案，
 * 带不带分问序号、带不带名称，都不该影响判定。**比的是数学事实，不是字符串。**
 */
export function answerValues(text: string): readonly number[] {
  // 先剥掉分问序号（（1）(1)①第1问）——那是排版，不是答案的一部分
  const clean = text
    .replace(/[（(]\s*\d+\s*[)）]/g, ' ')
    .replace(/第\s*\d+\s*问/g, ' ')
    .replace(/[①-⑳]/g, ' ')
  const values: number[] = []
  // 分数（3/4）与小数、整数都算"数"
  for (const match of clean.matchAll(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)/g)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      const denominator = Number(match[2])
      if (denominator !== 0) values.push(Number(match[1]) / denominator)
      continue
    }
    if (match[3] !== undefined) values.push(Number(match[3]))
  }
  return values.toSorted((a, b) => a - b)
}

/** 答案里的字母/字母组合（x、y、AB、S、△ABC 都算）：判定"问的是不是同一类量" */
export function answerLetters(text: string): readonly string[] {
  return [...new Set((text.match(/[A-Za-z]+/g) ?? []).map((token) => token.toLowerCase()))].toSorted()
}

/**
 * 两个答案是不是同一个答案：
 *   1. **数值多重集**必须一致（容差比较，顺序无关）；
 *   2. 构造侧的字母必须都出现在另一边（标签、名称、多写的量都不影响）。
 * 反例（会被判不同）：`x = 2` vs `x = 3`（数值不同）；`5/12` vs `5/13`。
 */
export function sameAnswer(constructed: string, parsed: string, tolerance = 1e-6): boolean {
  const left = answerValues(constructed)
  const right = answerValues(parsed)
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined || !closeEnough(a, b, tolerance)) return false
  }
  const letters = new Set(answerLetters(parsed))
  return answerLetters(constructed).every((token) => letters.has(token))
}

/** 题面里出现这些，说明它在"要求做点什么"，而不是只摆了一段情境 */
const ASK = /求|证明|求证|判断|说明|计算|比较|是否|试(?:求|判断|说明|计算|证明|画出?|比较|探索|用)|画出|探索|猜想|化简|解方程|解不等式|分解因式|因式分解|（\s*）|\(\s*\)|_{3,}|？|\?/
/** 分问标记：（1）(1)① 之类 */
const PART_MARK = /[（(]\s*\d+\s*[)）]|[①-⑳]/g

/**
 * 题面是不是**一道题**（而不只是一段情境）。
 *
 * 真实事故：卷子上 8 道 9 分解答题全是"一块长方形试验田，长为 6√7 米，宽为 3√7 米。"——
 * 有情境、没有问；填空题写着"一个袋子里有 7 个红球…"就没了。原因是**分量闸门数的是题型声明的 goals，
 * 不是题面里真的有没有问**：声明了三问，题面一句问都没有，照样入库。
 *
 * 判据（都能一眼看懂）：
 *   1. 题面里要有"要求"（求/证明/判断/化简/…/填空横线/问号）；
 *   2. 声明了几问，题面里就要有几分问标记（（1）（2）…）；
 *   3. 填空题要有作答空位（______ 或（  ））。
 */
export function stemCompleteness(stem: string, goals: readonly string[], type: string): string | undefined {
  const text = stem ?? ''
  if (text.trim() === '') return '题面是空的'
  if (!ASK.test(text)) {
    return '题面只有情境/条件，**没有问题**：学生不知道要做什么（要写出"求…""证明…""…是（  ）"这样的要求）'
  }
  const marks = [...text.matchAll(PART_MARK)].length
  if (goals.length >= 2 && marks < goals.length) {
    return `题型声明了 ${String(goals.length)} 问，题面里只有 ${String(marks)} 处分问标记：把每一问写进题面（（1）…（2）…）`
  }
  if (type === '填空' && !/_{3,}|（\s*）|\(\s*\)/.test(text)) {
    return '填空题要给出作答空位（______ 或（  ）），不然学生不知道往哪儿写'
  }
  return undefined
}

/**
 * 一段文字里的数学片段（`$...$` / `$$...$$` 的内容）。
 * 闸门用它做两件事：**编译都过**、**公式里的数字都来自构造**——
 * 数学写在正文里，所以检查的也必须是正文（不再另设一份"公式层"）。
 */
export function mathSegments(text: string): readonly string[] {
  const out: string[] = []
  for (const match of text.matchAll(MATH_PATTERN)) {
    const body = match[1] ?? match[2]
    if (body !== undefined && body.trim() !== '') out.push(body)
  }
  return out
}

/**
 * 选项在卷面上的写法：**去掉"标签="前缀**（`BD=32` → `32`，`k=12` → `12`）。
 * 四个选项要长得一样——真题里不会出现 `A. 24 B. 16 C. 40 D. BD=32` 这种混搭。
 * 放在 core 是因为**展示与导出都要用**，而且库里早先存的题也得照这个显示。
 */
export function optionDisplayText(raw: string): string {
  const trimmed = raw.trim()
  const labelled = /^[^=＝]{1,14}[=＝](.+)$/.exec(trimmed)
  const value = (labelled?.[1] ?? trimmed).trim()
  return value === '' ? trimmed : value
}

export function renderMathInText(text: string, mode: MathMode = 'html'): string {
  let out = ''
  let cursor = 0
  for (const match of text.matchAll(MATH_PATTERN)) {
    const index = match.index ?? 0
    const whole = match[0]
    const block = match[1]
    const inline = match[2]
    out += escapeHtml(text.slice(cursor, index))
    out += render(block ?? inline ?? '', block !== undefined, mode)
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
