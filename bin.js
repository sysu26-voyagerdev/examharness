#!/usr/bin/env node
/**
 * npx examharness —— 组合根。
 *
 * 只做三件事：建 Context、挂 loader、让它读 cordis.yml。
 * 具体挂哪些插件、什么配置，全在 cordis.yml 里（老师改配置不用碰代码）。
 */
import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@deepseek-ai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@deepseek-ai/cordis-plugin-include',
  config: {
    path: process.env.EXAMHARNESS_CONFIG ?? './cordis.yml',
  },
})

process.on('unhandledRejection', (reason) => {
  console.error('[examharness] 未处理的拒绝：', reason)
  process.exitCode = 1
})
