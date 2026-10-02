import type { JSX } from 'react'

/**
 * 显示服务端渲染好的数学（MathML）。
 *
 * 为什么不引前端数学库：和"图由服务端渲染"一样——题面、答案、解析里的公式
 * 在服务端就已经是 MathML 了（`stemHtml` / `answerHtml` / `tex.*.math`），
 * 界面只负责把它放进页面。少一个运行时、少一套字体，深色模式也不用另配颜色。
 *
 * 服务端渲染 MathML 时会转义正文，只有公式部分是它自己生成的标记：
 * 所以这里用 dangerouslySetInnerHTML 是**有边界的**，不是随便塞 HTML。
 */
export function MathText({
  html,
  display = false,
  style,
}: {
  html: string
  display?: boolean
  style?: React.CSSProperties
}): JSX.Element {
  return (
    <span
      style={display ? { display: 'block', overflowX: 'auto', ...style } : style}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
