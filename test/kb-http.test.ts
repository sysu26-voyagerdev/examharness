import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import * as kbPlugin from '../packages/plugin-kb/src/index.js'
import * as webPlugin from '../packages/plugin-web/src/index.js'

const scratch: string[] = []
const fibers: Fiber[] = []

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-kb-http-'))
  scratch.push(dir)
  const ctx = new Context()
  const emptyBlueprint = { paper: { title: '测试', className: '', totalScore: 0, minutes: 0 }, blueprint: [], constraints: { forbidKnowledge: [] } }
  let finish: ((run: { stopped: string; steps: number }) => void) | undefined
  // 只替换模型运行；上传、索引落盘、HTTP 处理都用真实插件。
  fibers.push(await ctx.plugin({
    name: 'http-fixtures',
    apply(context: Context) {
      const services: Record<string, unknown> = {
        bank: { all: () => [] }, graph: {}, construct: { kinds: () => [] }, paper: {}, figure: {},
        session: { blueprint: () => emptyBlueprint, latest: () => undefined }, llm: {}, settings: {},
        corpus: { size: 0 }, websearch: {}, workspace: { seedLinks: () => 0 },
        workbench: { start: () => ({ runId: 'test-run', workspace: 'test', done: new Promise((resolve) => { finish = resolve }) }) },
      }
      for (const [key, value] of Object.entries(services)) context.provide(key, value)
    },
  }))
  fibers.push(await ctx.plugin(kbPlugin, { dir: join(dir, 'uploads'), index: join(dir, 'kb.json'), extractDir: join(dir, 'extracted'), maxTextBytes: 12 }))
  let port = ''
  const log = vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
    const match = /http:\/\/0\.0\.0\.0:(\d+)/.exec(String(message))
    if (match?.[1] !== undefined) port = match[1]
  })
  fibers.push(await ctx.plugin(webPlugin, { port: 0 }))
  await vi.waitFor(() => expect(port).not.toBe(''))
  log.mockRestore()
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  return { ctx, post, finish: async () => {
    finish?.({ stopped: 'done', steps: 3 })
    await new Promise<void>((resolve) => setImmediate(resolve))
  } }
}

afterEach(async () => {
  await Promise.all(fibers.splice(0).toReversed().map((fiber) => fiber.dispose()))
  vi.restoreAllMocks()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('上传接口拒绝整批中无效的项目，不把部分上传冒充成功', async () => {
  const { ctx, post } = await boot()
  await Promise.all([null, { files: {} }, { files: [null] }, { files: [{ name: 'a.txt', text: 'a' }, { name: '缺内容.txt' }] },
    { files: [{ name: '大.txt', text: '一二三四五' }] }, { files: [{ name: '两种.txt', text: 'a', base64: 'YQ==' }] }].map(async (body) => {
    const response = await post('/api/kb/upload', body)
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    expect(ctx.kb.list()).toHaveLength(0)
  }))
  const response = await post('/api/kb/upload', { name: '有效', files: [{ name: '好.txt', text: '一二三四' }] })
  expect(response.status).toBe(200)
  const batch = await response.json() as { id: string }
  expect(ctx.kb.read(batch.id, '好.txt')?.text).toBe('一二三四')
})

it('整理结束保留 agent 明确的失败结果和说明', async () => {
  const { ctx, post, finish } = await boot()
  const batch = ctx.kb.upload('', [{ name: 'a.txt', text: 'a' }])
  expect((await post('/api/kb/ingest', { batchId: batch.id })).status).toBe(202)
  ctx.kb.mark(batch.id, 'failed', '扫描件模糊，未能提取')
  await finish()
  await vi.waitFor(() => expect(ctx.kb.list()[0]?.status).toBe('failed'))
  expect(ctx.kb.list()[0]?.note).toBe('扫描件模糊，未能提取')
})

it('整理未报告结果时如实标未完成，不能只因循环结束就称为已整理', async () => {
  const { ctx, post, finish } = await boot()
  const batch = ctx.kb.upload('', [{ name: 'a.txt', text: 'a' }])
  await post('/api/kb/ingest', { batchId: batch.id })
  await finish()
  await vi.waitFor(() => expect(ctx.kb.list()[0]?.status).toBe('failed'))
})

it('已确认整理完的结果与具体说明保持不变', async () => {
  const { ctx, post, finish } = await boot()
  const batch = ctx.kb.upload('', [{ name: 'a.txt', text: 'a' }])
  await post('/api/kb/ingest', { batchId: batch.id })
  ctx.kb.mark(batch.id, 'indexed', '核对 3 条，均与原文一致')
  await finish()
  await vi.waitFor(() => expect(ctx.kb.list()[0]?.note).toBe('核对 3 条，均与原文一致'))
  expect(ctx.kb.list()[0]?.status).toBe('indexed')
})
