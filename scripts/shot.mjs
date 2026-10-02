#!/usr/bin/env node
/**
 * 给界面截图（开发时**用眼睛验收**用）。
 *
 * 为什么不用 `chrome --screenshot`：本项目的界面开着一条 SSE 长连接（工作记录实时推送），
 * Chrome 的 `--virtual-time-budget` 会一直等"网络空闲"，于是截图**永远不返回**。
 * 这里直接用 CDP：导航 → 等一会儿 → 抓图，自己控制节奏。
 *
 * 用法：node scripts/shot.mjs <url> <输出.png> [等多久毫秒] [宽] [高] [预置 JS]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, out, waitMs = '5000', width = '1440', height = '1200', initScript] = process.argv.slice(2)
if (url === undefined || out === undefined) {
  console.error('用法：node scripts/shot.mjs <url> <输出.png> [等多久毫秒] [宽] [高]')
  process.exit(2)
}

const PORT = 9333 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(tmpdir(), 'examharness-shot-'))
const chrome = spawn(
  'google-chrome-stable',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${String(PORT)}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function targets() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)
      const list = await response.json()
      const page = list.find((entry) => entry.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('Chrome 没起来')
}

const socketUrl = await targets()
const socket = new WebSocket(socketUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let counter = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const resolve = pending.get(message.id)
  if (resolve !== undefined) {
    pending.delete(message.id)
    resolve(message.result)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve) => {
    counter += 1
    pending.set(counter, resolve)
    socket.send(JSON.stringify({ id: counter, method, params }))
  })

await send('Page.enable')
// 预置脚本（例如把深色偏好塞进 localStorage）：在页面脚本之前执行
if (initScript !== undefined && initScript !== '') {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript })
}
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url })
await sleep(Number(waitMs))
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`已写入 ${out}`)

socket.close()
chrome.kill('SIGKILL')
