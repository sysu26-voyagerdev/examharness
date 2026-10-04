/**
 * LaTeX → **纯文本**（用于 Word 导出）。
 *
 * 为什么需要它：Word 版里公式不能是图片，也不该是一堆反斜杠——老师拿到 docx 是要**接着改**的。
 * 所以把常见记号折成 Unicode（x^{2} → x²、\frac{2}{3} → 2/3、\angle ABC → ∠ABC、\odot O → ⊙O …），
 * 排版上不追求和卷面完全一致，但**人读得懂、能编辑、能打印**。
 *
 * 覆盖的是初中数学实际会用到的那一小撮；不认识的命令原样留着（宁可露出来，也不要悄悄吃掉）。
 */

/** 上标：能折成 Unicode 的字符 */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
}

const SUBSCRIPT: Readonly<Record<string, string>> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  a: 'ₐ',
  e: 'ₑ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  s: 'ₛ',
  t: 'ₜ',
  x: 'ₓ',
}

/** 记号与希腊字母：反斜杠命令 → Unicode */
const SYMBOLS: Readonly<Record<string, string>> = {
  angle: '∠',
  odot: '⊙',
  triangle: '△',
  parallel: '∥',
  perp: '⊥',
  cong: '≌',
  sim: '∽',
  simeq: '≃',
  approx: '≈',
  neq: '≠',
  ne: '≠',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  cdot: '·',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  infty: '∞',
  circ: '°',
  degree: '°',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Delta: 'Δ',
  Gamma: 'Γ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω',
  quad: ' ',
  qquad: '  ',
  ' ': ' ',
  ',': ' ',
  ';': ' ',
  '!': '',
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftrightarrow: '⇔',
  leftrightarrow: '↔',
  sum: '∑',
  int: '∫',
  prod: '∏',
  sqrt: '√',
  because: '∵',
  therefore: '∴',
}

/** 单项式（能安全省掉括号）：\frac{2}{3} 写成 2/3，\frac{x+1}{2} 写成 (x+1)/2 */
function atomic(text: string): boolean {
  return /^[\w.]+$/u.test(text)
}

/** 把一串字符折成上标（有不认识的就退回 ^(...) 写法） */
function superscript(text: string): string {
  const mapped = [...text].map((char) => SUPERSCRIPT[char])
  return mapped.every((char) => char !== undefined) ? mapped.join('') : `^(${text})`
}

function subscript(text: string): string {
  const mapped = [...text].map((char) => SUBSCRIPT[char])
  return mapped.every((char) => char !== undefined) ? mapped.join('') : `_(${text})`
}

/** 读一对花括号里的内容（没有花括号就读一个字符） */
function braced(source: string, at: number): { body: string; next: number } {
  if (source[at] !== '{') return { body: source[at] ?? '', next: at + 1 }
  let depth = 0
  for (let index = at; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return { body: source.slice(at + 1, index), next: index + 1 }
    }
  }
  return { body: source.slice(at + 1), next: source.length }
}

/** 一段数学（不含 $ 定界符）→ 纯文本 */
export function latexToText(source: string): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    const rest = source.slice(index)
    const char = source[index]

    // 分数：\frac{a}{b} / \dfrac / \tfrac → (a)/(b)（分母是单项时省括号）
    const frac = /^\\(?:d|t)?frac/.exec(rest)
    if (frac !== null) {
      const numerator = braced(source, index + frac[0].length)
      const denominator = braced(source, numerator.next)
      const top = latexToText(numerator.body)
      const bottom = latexToText(denominator.body)
      out += atomic(top) && atomic(bottom) ? `${top}/${bottom}` : `(${top})/(${bottom})`
      index = denominator.next
      continue
    }

    // 根号：\sqrt{x} / \sqrt[3]{x}
    const sqrt = /^\\sqrt/.exec(rest)
    if (sqrt !== null) {
      let at = index + sqrt[0].length
      let order = ''
      if (source[at] === '[') {
        const close = source.indexOf(']', at)
        order = source.slice(at + 1, close === -1 ? at : close)
        at = close === -1 ? at : close + 1
      }
      const body = braced(source, at)
      const inner = latexToText(body.body)
      out += order === '' ? `√(${inner})` : `${order}√(${inner})`
      index = body.next
      continue
    }

    // \overline{AB} / \vec{a}：折成"AB、a"（上面的横线在纯文本里没法还原）
    const over = /^\\(?:overline|vec|overrightarrow)/.exec(rest)
    if (over !== null) {
      const body = braced(source, index + over[0].length)
      out += latexToText(body.body)
      index = body.next
      continue
    }

    // \text{…} / \mathrm{…} / \operatorname{…}：里面的内容原样（不走数学折换）
    const wrapper = /^\\(?:text|mathrm|mathbf|operatorname|mbox)/.exec(rest)
    if (wrapper !== null) {
      const body = braced(source, index + wrapper[0].length)
      out += body.body
      index = body.next
      continue
    }

    // \left \right：只当括号的排版指示，丢掉命令留下括号
    const sized = /^\\(?:left|right|big|Big|bigg|Bigg)/.exec(rest)
    if (sized !== null) {
      index += sized[0].length
      continue
    }

    // 上标 / 下标：x^{2}、a_1
    if (char === '^' || char === '_') {
      const body = braced(source, index + 1)
      const inner = latexToText(body.body)
      out += char === '^' ? superscript(inner) : subscript(inner)
      index = body.next
      continue
    }

    // 反斜杠命令
    if (char === '\\') {
      const command = /^\\([a-zA-Z]+)/.exec(rest)
      if (command === null) {
        // \{ \} \% \$ 这种：转义的普通字符
        out += source[index + 1] ?? ''
        index += 2
        continue
      }
      const name = command[1] ?? ''
      const mapped = SYMBOLS[name]
      if (mapped !== undefined) {
        out += mapped
        index += command[0].length
        // \circ 后面常跟 { }：吃掉空的
        if (name === 'circ') {
          const body = braced(source, index)
          if (body.body === '') index = body.next
        }
        continue
      }
      // 不认识的命令：原样留着（宁可露出来，也不要悄悄吃掉）
      out += command[0]
      index += command[0].length
      continue
    }

    out += char
    index += 1
  }
  return out.replace(/\s+/gu, ' ').trim()
}

/** 正文里的 `$…$` / `$$…$$` → 纯文本（导出 Word 时用） */
export function mathToPlainText(text: string): string {
  return text.replace(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/gu, (_all, block: string | undefined, inline: string | undefined) => {
    const body = block ?? inline ?? ''
    const plain = latexToText(body)
    return block === undefined ? plain : ` ${plain} `
  })
}
