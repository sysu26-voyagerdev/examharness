import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { CorpusRecord } from '@examharness/core'
import * as corpusPlugin from '@examharness/plugin-corpus'
import * as kbPlugin from '@examharness/plugin-kb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 知识库测试。盯住三条：
 *   - **素材≠真值**：上传的原料落在 data 侧、**不进语料**；只有 agent 抽出来的记录才进（source = kb:<id>）；
 *   - **分片读**：agent 一次只拿到一段，靠 next 翻页（几 MB 的资料不该一次糊进上下文）；
 *   - **状态如实**：raw → indexed / failed 由 agent 与调用方决定，这里只保证记下来、广播出去。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const fibers: Fiber[] = []
const scratch: string[] = []

const record = (id: string, stem: string): CorpusRecord => ({
  id,
  source: '不该用这个 source', // kb.write 会统一改写成 kb:<批次>
  stem,
  answer: 'm < 1',
  knowledge: ['与坐标轴交点'],
  distributable: false,
})

async function boot(): Promise<{ ctx: Context; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-kb-'))
  scratch.push(dir)
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await ctx.plugin(corpusPlugin, { dirs: [join(dir, 'extracted')], minLength: 8, maxSimilarity: 0.6 }),
    await ctx.plugin(kbPlugin, {
      dir: join(dir, 'uploads'),
      extractDir: join(dir, 'extracted'),
      index: join(dir, 'kb.json'),
      maxTextBytes: 1_000_000,
    }),
  )
  return { ctx, dir }
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('知识库', () => {
  it('上传的原料不进语料；agent 抽出来的记录才进（source = kb:<批次>）', async () => {
    const { ctx, dir } = await boot()
    const batch = ctx.kb.upload('2023真题', [
      { name: '真题.txt', text: '已知抛物线 y = x² - 4x + 3 与 x 轴交于 A、B 两点，求线段 AB 的长。' },
    ])

    expect(batch.status).toBe('raw')
    expect(batch.records).toBe(0)
    expect(existsSync(join(dir, 'uploads', batch.id, '真题.txt'))).toBe(true)

    // 原料在扫描目录之外：重扫也扫不进来
    ctx.corpus.reload()
    expect(ctx.corpus.size).toBe(0)

    const written = ctx.kb.write(batch.id, [record('k1', '已知抛物线 y = x² - 2x + m 与 x 轴有两个交点，求 m 的取值范围。')])
    expect(written).toBe(1)
    expect(existsSync(join(dir, 'extracted', `${batch.id}.jsonl`))).toBe(true)

    // 抽出来的记录进了语料（write 会自动重扫），来源可回溯，且默认不可对外分发
    expect(ctx.corpus.size).toBe(1)
    expect(ctx.corpus.records()[0]?.source).toBe(`kb:${batch.id}`)
    expect(ctx.corpus.records()[0]?.distributable).toBe(false)
    expect(ctx.kb.list()[0]?.records).toBe(1)

    // 不存在的批次不写（别在磁盘上造无主的文件）
    expect(ctx.kb.write('kb-不存在', [record('k2', '随便一道题，足够长的一条题干。')])).toBe(0)
  })

  it('分片读：一次一段，靠 next 翻页；越界文件名读不到', async () => {
    const { ctx } = await boot()
    const text = 'x'.repeat(5000)
    const batch = ctx.kb.upload('厚资料', [{ name: '厚.txt', text }])

    const first = ctx.kb.read(batch.id, '厚.txt', 0, 2000)
    expect(first?.text).toHaveLength(2000)
    expect(first?.total).toBe(5000)
    expect(first?.next).toBe(2000)

    const second = ctx.kb.read(batch.id, '厚.txt', first?.next ?? 0, 2000)
    expect(second?.next).toBe(4000)

    const last = ctx.kb.read(batch.id, '厚.txt', second?.next ?? 0, 2000)
    expect(last?.next).toBeUndefined()
    expect(last?.text).toHaveLength(1000)

    // 目录穿越不给读
    expect(ctx.kb.read(batch.id, '../kb.json', 0, 100)).toBeUndefined()
    expect(ctx.kb.read('kb-不存在', '厚.txt', 0, 100)).toBeUndefined()
  })

  it('状态与记录数落盘并广播（界面靠 kb:changed 刷新）', async () => {
    const { ctx, dir } = await boot()
    const seen: string[] = []
    ctx.on('kb:changed', (payload) => seen.push(`${payload.batchId}:${payload.status}`))

    const batch = ctx.kb.upload('教研笔记', [{ name: '笔记.md', text: '## 一道题\n已知抛物线过 (1,0)、(3,0)，求解析式。\n' }])
    ctx.kb.mark(batch.id, 'ingesting', 'agent 正在整理')
    ctx.kb.write(batch.id, [record('n1', '已知抛物线过 (1,0)、(3,0)，求其解析式。')])
    const done = ctx.kb.mark(batch.id, 'indexed', '整理完成')

    expect(done?.status).toBe('indexed')
    expect(done?.note).toBe('整理完成')
    expect(done?.records).toBe(1)
    expect(seen).toContain(`${batch.id}:raw`)
    expect(seen).toContain(`${batch.id}:ingesting`)
    expect(seen).toContain(`${batch.id}:indexed`)

    // 索引文件真的写了状态，重启后还在
    const onDisk = JSON.parse(readFileSync(join(dir, 'kb.json'), 'utf8')) as { id: string; status: string }[]
    expect(onDisk[0]?.status).toBe('indexed')
  })
})
