import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { App } from './App.js'
import { makeTheme } from './theme.js'

/**
 * 深浅模式放在这里：主题要包住整个应用，而它又是用户的一个选择。
 * 组件之外只有这一处状态，其余状态都在 App 里（都来自服务端）。
 */
function Root(): React.JSX.Element {
  const [dark, setDark] = useState(false)
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
