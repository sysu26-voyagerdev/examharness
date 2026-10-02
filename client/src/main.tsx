import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
// 数学排版靠 KaTeX 自己的 CSS（界面用它的 HTML 输出；导出才用 MathML）
import 'katex/dist/katex.min.css'
import { App } from './App.js'
import { makeTheme } from './theme.js'

/**
 * 深浅模式放在这里：主题要包住整个应用，而它又是用户的一个选择。
 * 组件之外只有这一处状态，其余状态都在 App 里（都来自服务端）。
 */
function Root(): React.JSX.Element {
  // 深色偏好要**记住**：刷新一下又变回浅色，是"设置不生效"里最恼人的一种
  const [dark, setDark] = useState(() => localStorage.getItem('examharness.dark') === '1')
  useEffect(() => {
    localStorage.setItem('examharness.dark', dark ? '1' : '0')
  }, [dark])
  return (
    <ThemeProvider theme={makeTheme(dark ? 'dark' : 'light')}>
      <CssBaseline />
      <App dark={dark} onToggleDark={() => setDark((previous) => !previous)} />
    </ThemeProvider>
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 容器')

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
