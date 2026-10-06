import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as workspacePlugin from '../packages/plugin-workspace/src/index.js'

it('导入文件夹里的同名资料都送到整理工作区，重复整理不增加副本', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-materials-workspace-'))
  const ctx = new Context()
  const fiber = await ctx.plugin(workspacePlugin, { dir: join(dir, 'workspaces') })
  try {
    mkdirSync(join(dir, '甲')); mkdirSync(join(dir, '乙'))
    const sources = [join(dir, '甲', '笔记.txt'), join(dir, '乙', '笔记.txt')]
    writeFileSync(sources[0] ?? '', '甲的内容')
    writeFileSync(sources[1] ?? '', '乙的内容')
    expect(ctx.workspace.seedLinks('kb-files', sources)).toBe(2)
    const input = join(dir, 'workspaces', 'kb-files', 'in')
    expect(readdirSync(input)).toHaveLength(2)
    expect(readdirSync(input).map((file) => readFileSync(join(input, file), 'utf8')).toSorted()).toEqual(['乙的内容', '甲的内容'])
    ctx.workspace.seedLinks('kb-files', sources.toReversed())
    expect(readdirSync(input)).toHaveLength(2)
  } finally {
    await fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
