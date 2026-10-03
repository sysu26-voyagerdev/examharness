/**
 * MathML → **OMML**（Office 原生公式），Word 里显示的是真公式。
 *
 * 为什么不用"LaTeX 折成 Unicode 文本"那套：老师打开 docx 看到的应该是**排版好的公式**
 *（分数线、根号、上下标、∠、⊙ 都在它该在的位置），而不是 x^2 这种半成品。
 * Word 的原生公式就是 OMML——它的结构与 MathML 几乎一一对应，转过去即可。
 *
 * 只转 KaTeX 实际会吐出来的那些元素；不认识的一律**降级成它的文字内容**（宁可朴素，不可丢内容）。
 */

const MATHML_NS = /<\/?m:?[a-zA-Z]+[^>]*>/u

interface Node {
  tag: string
  attrs: Record<string, string>
  children: Node[]
  text: string
}

/** 极简 XML 解析：MathML 由 KaTeX 生成，结构规整，不需要通用 XML 解析器 */
function parse(source: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: Node[] = [root]
  const tokens = source.match(/<[^>]+>|[^<]+/gu) ?? []
  for (const token of tokens) {
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop()
      continue
    }
    if (token.startsWith('<')) {
      const selfClosing = token.endsWith('/>')
      const name = /^<\s*([a-zA-Z][\w:-]*)/u.exec(token)?.[1] ?? ''
      const attrs: Record<string, string> = {}
      for (const match of token.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/gu)) {
        const key = match[1]
        const value = match[2]
        if (key !== undefined && value !== undefined) attrs[key] = value
      }
      const node: Node = { tag: name.replace(/^m:/u, ''), attrs, children: [], text: '' }
      stack[stack.length - 1]?.children.push(node)
      if (!selfClosing) stack.push(node)
      continue
    }
    const current = stack[stack.length - 1]
    if (current !== undefined) current.text += token
  }
  return root
}

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/** 一个公式里的文字片段（OMML 的 m:r） */
function run(text: string, options: { italic?: boolean; style?: string } = {}): string {
  const props =
    options.italic === false
      ? '<m:rPr><m:sty m:val="p"/></m:rPr>'
      : options.style === undefined
        ? ''
        : `<m:rPr><m:sty m:val="${options.style}"/></m:rPr>`
  return `<m:r>${props}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`
}

/** 把一串子节点转成 OMML 片段（包在 m:e / m:num 这类容器里的东西） */
function inner(nodes: readonly Node[]): string {
  return nodes.map((node) => convert(node)).join('')
}

function allText(node: Node): string {
  return `${node.text}${node.children.map((entry) => allText(entry)).join('')}`
}

function child(node: Node, tag: string): Node | undefined {
  return node.children.find((entry) => entry.tag === tag)
}

/** 单个 MathML 节点 → OMML */
function convert(node: Node): string {
  switch (node.tag) {
    // 文本型：数字、标识符、算符
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return run(node.text.trim() === '' ? allText(node) : node.text, {
        italic: node.tag === 'mi' ? node.attrs['mathvariant'] !== 'normal' : false,
      })

    case 'mspace':
      return run(' ')

    case 'mrow':
    case 'math':
    case 'semantics':
    case 'mstyle':
    case 'mpadded':
    case 'mphantom':
      // semantics 里第一个子节点才是内容（后面是注释），只取第一个
      return inner(node.tag === 'semantics' ? node.children.slice(0, 1) : node.children)

    case 'mfrac': {
      const numerator = child(node, 'num')
      const denominator = child(node, 'den')
      return `<m:f><m:num>${numerator === undefined ? '' : inner(numerator.children)}</m:num><m:den>${denominator === undefined ? '' : inner(denominator.children)}</m:den></m:f>`
    }

    case 'msqrt': {
      const base = child(node, 'mrow') ?? node
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${inner(base.children)}</m:e></m:rad>`
    }

    case 'mroot': {
      const base = child(node, 'mrow')
      const degree = child(node, 'mrow')
      return `<m:rad><m:deg>${degree === undefined ? '' : inner(degree.children)}</m:deg><m:e>${base === undefined ? '' : inner(base.children)}</m:e></m:rad>`
    }

    case 'msup': {
      const base = child(node, 'mrow') ?? node.children[0]
      const sup = node.children.at(-1)
      return `<m:sSup><m:e>${base === undefined ? '' : convert(base)}</m:e><m:sup>${sup === undefined ? '' : convert(sup)}</m:sup></m:sSup>`
    }

    case 'msub': {
      const base = node.children[0]
      const sub = node.children.at(-1)
      return `<m:sSub><m:e>${base === undefined ? '' : convert(base)}</m:e><m:sub>${sub === undefined ? '' : convert(sub)}</m:sub></m:sSub>`
    }

    case 'msubsup': {
      const base = node.children[0]
      const sub = node.children[1]
      const sup = node.children[2]
      return `<m:sSubSup><m:e>${base === undefined ? '' : convert(base)}</m:e><m:sub>${sub === undefined ? '' : convert(sub)}</m:sub><m:sup>${sup === undefined ? '' : convert(sup)}</m:sup></m:sSubSup>`
    }

    case 'mover': {
      const base = node.children[0]
      const over = node.children[1]
      // 顶上加横线（\overline）→ m:bar；其余（\vec、\hat 之类）→ 重音
      if (over !== undefined && (over.text.includes('‾') || over.text.includes('¯') || over.text.includes('—'))) {
        return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${base === undefined ? '' : convert(base)}</m:e></m:bar>`
      }
      return `<m:acc><m:accPr><m:chr m:val="${escapeXml((over?.text ?? '^').trim().slice(0, 1) || '^')}"/></m:accPr><m:e>${base === undefined ? '' : convert(base)}</m:e></m:acc>`
    }

    case 'munderover': {
      const base = node.children[0]
      const under = node.children[1]
      const over = node.children[2]
      return `<m:limUpp><m:e><m:limLow><m:e>${base === undefined ? '' : convert(base)}</m:e><m:lim>${under === undefined ? '' : convert(under)}</m:lim></m:limLow></m:e><m:lim>${over === undefined ? '' : convert(over)}</m:lim></m:limUpp>`
    }

    case 'munder': {
      const base = node.children[0]
      const under = node.children[1]
      return `<m:limLow><m:e>${base === undefined ? '' : convert(base)}</m:e><m:lim>${under === undefined ? '' : convert(under)}</m:lim></m:limLow>`
    }

    case 'mfenced': {
      const open = node.attrs['open'] ?? '('
      const close = node.attrs['close'] ?? ')'
      return `${run(open)}${inner(node.children)}${run(close)}`
    }

    case 'mtable': {
      // 行列式/方程组：按行拼（Word 里用矩阵容器）
      const rows = node.children.filter((entry) => entry.tag === 'mtr')
      const cells = rows
        .map((row) => `<m:mr>${row.children.map((cell) => `<m:e>${inner(cell.children)}</m:e>`).join('')}</m:mr>`)
        .join('')
      return `<m:m>${cells}</m:m>`
    }

    case '#root':
      return inner(node.children)

    default:
      // 不认识的元素：降级成它的文字内容（宁可朴素，不可丢内容）
      return node.children.length === 0 ? run(allText(node)) : inner(node.children)
  }
}

/** 把 KaTeX 生成的 MathML 转成 Word 认的 OMML（内联公式） */
export function mathmlToOmml(mathml: string): string {
  if (!MATHML_NS.test(mathml)) return ''
  const tree = parse(mathml)
  const math = tree.children.find((node) => node.tag === 'math') ?? tree
  return `<m:oMath>${inner(math.children)}</m:oMath>`
}
