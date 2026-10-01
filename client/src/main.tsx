import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './tokens.css'

const container = document.getElementById('root')
if (container === null) throw new Error('缺少 #root 容器')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
