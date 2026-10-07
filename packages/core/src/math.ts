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
      // 关掉"字体里没有这个字符"的告警：`≌`、`⊙` 这类初中卷面天天用，
      // 告警会把服务日志刷满（真实踩过：日志里几千行 No character metrics，排查时什么都看不见）。
      // 真正的语法错误仍然由 throwOnError 抛出来。
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
  // 顺序有讲究：先把 LaTeX 结构与"排版"剥掉，剩下的数才是答案里的数。
  let clean = text
    // **减号有好几种写法**：数学减号 U+2212（模型写 LaTeX 时常带它）、全角减号、短破折号——
    // 它们与 ASCII 的 `-` 是同一个数学事实（真实踩过：`−12.25` 与 `-12.25` 被判成两个答案，
    // 于是好题被回译闸门冤枉、白白重跑一遍模型）。
    .replace(/[\u2212\uFF0D\u2013\u2014\u2015]/g, '-')
    .replace(/[（(]\s*\d+\s*[)）]/g, ' ') // 分问序号（1）
    .replace(/第\s*\d+\s*问/g, ' ')
    .replace(/[①-⑳]/g, ' ')
  // 1) LaTeX 分数：\dfrac{6}{14} → 6/14（先做，否则 6 与 14 会被当成两个数）
  clean = clean.replace(
    /\\(?:d|t)?frac\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g,
    '$1/$2',
  )
  // 1) LaTeX 分数：\dfrac{6}{14} → 6/14（先做，否则 6 与 14 会被当成两个数）
  clean = clean.replace(
    /\\(?:d|t)?frac\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}\s*\{\s*(-?\d+(?:\.\d+)?)\s*\}/g,
    '$1/$2',
  )
  // 2) 指数与下标：x^{2}、x_1 —— 那是排版，不是答案里的数
  clean = clean.replace(/[_^]\s*\{?\s*[-+]?\d+(?:\.\d+)?\s*\}?/g, ' ')
  // 3) 其余 LaTeX 命令（\left \right \cdot \sqrt…）当空白
  clean = clean.replace(/\\[a-zA-Z]+/g, ' ')

  const values: number[] = []
  for (const match of clean.matchAll(
    /(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)/g,
  )) {
    const whole = match[0]
    const at = match.index ?? 0
    // **紧跟字母的数是指数或系数**（a²−2ab+b² 里的 2、2x 里的 2），不是答案的数据；
    // 只有"独立成数"的才参与比对（72、64、5.5、12 个）。
    const after = clean.slice(at + whole.length).trimStart()[0] ?? ''
    const coefficient = /[A-Za-z]/.test(after)
    if (coefficient) continue
    if (match[1] !== undefined && match[2] !== undefined) {
      const denominator = Number(match[2])
      if (denominator !== 0) values.push(Number(match[1]) / denominator)
      continue
    }
    if (match[3] !== undefined) values.push(Number(match[3]))
  }
  return values.toSorted((a, b) => a - b)
}

/**
 * 答案里的字母/字母组合（x、y、AB、S、△ABC 都算）：判定"问的是不是同一类量"。
 *
 * **先剥 LaTeX 命令**：`\quad`、`\left`、`\text`、`\dfrac` 里的字母不是答案里的量。
 * 真实事故（一次组卷里连着两道题被冤枉）：构造答案 `a=1,\ b=6;\quad x=-3` 的字母
 * 被读成 `{a, b, quad, x}`，而回译写的是同一件事、没有 `quad`——
 * 于是"答案不一致"，好题被拦下、白跑一次模型。排版不是数学。
 */
export function answerLetters(text: string): readonly string[] {
  const clean = text.replace(/\\[a-zA-Z]+/g, ' ')
  return [...new Set((clean.match(/[A-Za-z]+/g) ?? []).map((token) => token.toLowerCase()))].toSorted()
}

/** 只留单字母记号（`x`、`y`、`S`）；`△ABC`、`AB` 这种是"哪个图形元素"的名字 */
function singleLetterTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => token.length === 1)
}

/**
 * 两个答案是不是同一个答案：
 *   1. **数值多重集**必须一致（容差比较，顺序无关）——这是主判据，数值不对就是不对；
 *   2. 记号只用来拦"**同一个数被安到别的记号上**"：两边都有单字母记号时，至少要有一个重合。
 *      一侧写成名字（`△ABC 的面积 = 90` 对 `S = 90`）不算冲突——那是措辞，不是数学。
 * 反例（会被判不同）：`x = 2` vs `x = 3`（数值不同）；`5/12` vs `5/13`；`x = 2` vs `y = 2`（记号换了）。
 *
 * 为什么第 2 条从"构造侧字母必须全出现在另一边"放宽成"不许两边都写字母却一个都不重合"：
 * 实测两次冤枉——`S = 90` 对 `△ABC 的面积 = 90`、以及 `\quad` 被当字母，
 * 数值**完全一样**却判不一致，一整道题加一次模型调用就这么没了。
 * 名字怎么起是执笔者的事（R1 管的是数从哪来，不是标签怎么写）。
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
  // 记号只在**两边都写了单字母记号**时比：`圆心O到弦AB的距离 = 12` 与 `12` 是同一个答案，
  // 而 `y = 2x + 2` 与 `y = 3x + 2` 靠数值就已经分开了。
  // 多字母记号（`△ABC`、`AB`）是"哪个图形元素"的名字，措辞层面的事，不参与判定。
  const parsedSingle = new Set(singleLetterTokens(answerLetters(parsed)))
  if (parsedSingle.size === 0) return true
  const constructedSingle = singleLetterTokens(answerLetters(constructed))
  if (constructedSingle.length === 0) return true
  return constructedSingle.some((token) => parsedSingle.has(token))
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
  // `$` 定界符必须成对：不成对时公式会从中间断开，卷面上就是一堆乱码
  // （真实踩过：`边 $AB=7$，边 $BC=5，$AB$ 边上的高为 5$`——多了一个 $）
  if ((text.match(/\$/g) ?? []).length % 2 !== 0) {
    return '题面里的 $ 不成对：数学公式少了（或多了一个）定界符，卷面上会断开'
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
