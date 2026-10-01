import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 开发时：前端 5173，API 走 8787（plugin-web 起了什么就代理到什么）
// 生产：构建到 client/dist，由 plugin-web 直接托管
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
