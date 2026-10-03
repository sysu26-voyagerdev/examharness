import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 测试直接跑 src（无需先 build）；生产走各包的 lib/
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@examharness/core': pkg('core'),
      '@examharness/plugin-bank': pkg('plugin-bank'),
      '@examharness/plugin-graph': pkg('plugin-graph'),
      '@examharness/plugin-verify-scope': pkg('plugin-verify-scope'),
      '@examharness/plugin-verify-symbolic': pkg('plugin-verify-symbolic'),
      '@examharness/plugin-verify-dedup': pkg('plugin-verify-dedup'),
      '@examharness/plugin-construct-parabola': pkg('plugin-construct-parabola'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
