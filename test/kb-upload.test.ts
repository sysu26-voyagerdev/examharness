import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as kbPlugin from '../packages/plugin-kb/src/index.js'

const scratch: string[] = []
const fibers: Fiber[] = []

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-upload-'))
  scratch.push(dir)
  const ctx = new Context()
  fibers.push(await ctx.plugin(kbPlugin, {
    dir: join(dir, 'uploads'), extractDir: join(dir, 'extracted'), index: join(dir, 'kb.json'),
    maxTextBytes: 12, maxFileBytes: 16,
  }))
  return { ctx, dir }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fibers.splice(0).toReversed().map((fiber) => fiber.dispose()))
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('资料上传完整性', () => {
  it('按 UTF-8 字节拒绝超限文本，整批不落盘，不截断中文', async () => {
    const { ctx, dir } = await boot()
    expect(() => ctx.kb.upload('超限', [
      { name: '先.txt', text: '正常' }, { name: '后.txt', text: '一二三四五' },
    ])).toThrow(/后.txt.*超/)
    expect(ctx.kb.list()).toHaveLength(0)
    expect(readdirSync(join(dir, 'uploads'))).toEqual([])
    const batch = ctx.kb.upload('边界', [{ name: '好.txt', text: '一二三四' }])
    expect(readFileSync(join(dir, 'uploads', batch.id, '好.txt'), 'utf8')).toBe('一二三四')
  })

  it('拒绝超限二进制，允许的二进制逐字节保存', async () => {
    const { ctx, dir } = await boot()
    expect(() => ctx.kb.upload('', [{ name: '大.pdf', base64: Buffer.alloc(17).toString('base64') }])).toThrow(/超/)
    expect(() => ctx.kb.upload('', [{ name: '更大.pdf', base64: Buffer.alloc(5_242_881).toString('base64') }])).toThrow(/超/)
    const bytes = Buffer.from([0, 255, 128, 13, 10, 37, 80, 68, 70])
    const batch = ctx.kb.upload('', [{ name: '原件.pdf', base64: bytes.toString('base64') }])
    expect(readFileSync(join(dir, 'uploads', batch.id, '原件.pdf'))).toEqual(bytes)
  })

  it('拒绝空批次、空文件、损坏的编码和无效文件名', async () => {
    const { ctx, dir } = await boot()
    for (const files of [[], [{ name: '空.txt', text: '' }], [{ name: '.', text: 'x' }],
      [{ name: '..', text: 'x' }], [{ name: '坏.pdf', base64: '%%%not-base64' }],
      [{ name: '缺.txt' }], [{ name: '冲突.txt', text: 'x', base64: 'eA==' }]]) {
      expect(() => ctx.kb.upload('', files)).toThrow()
    }
    expect(ctx.kb.list()).toHaveLength(0)
    expect(readdirSync(join(dir, 'uploads'))).toEqual([])
  })

  it('重名、清理后重名与大小写重名均保留所有原件', async () => {
    const { ctx, dir } = await boot()
    const batch = ctx.kb.upload('重名', [
      { name: 'A.txt', text: '1' }, { name: 'a.txt', text: '2' },
      { name: 'A.txt', text: '3' }, { name: 'a?.txt', text: '4' }, { name: 'a*.txt', text: '5' },
    ])
    expect(new Set(batch.files.map((file) => file.name.toLowerCase())).size).toBe(5)
    expect(batch.files.map((file) => readFileSync(join(dir, 'uploads', batch.id, file.name), 'utf8'))).toEqual(['1', '2', '3', '4', '5'])
  })

  it('同一毫秒上传和导入仍是不同批次', async () => {
    const { ctx, dir } = await boot()
    vi.spyOn(Date, 'now').mockReturnValue(123456789)
    const source = join(dir, 'source')
    mkdirSync(source)
    writeFileSync(join(source, '三.txt'), '3')
    const a = ctx.kb.upload('', [{ name: '一.txt', text: '1' }])
    const b = ctx.kb.upload('', [{ name: '二.txt', text: '2' }])
    const c = ctx.kb.importDir('', source)
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(ctx.kb.read(a.id, '一.txt')?.text).toBe('1')
    expect(ctx.kb.read(b.id, '二.txt')?.text).toBe('2')
  })

  it('预览只允许读取本批次登记的文件，不能跨批次或借未知批次读磁盘', async () => {
    const { ctx } = await boot()
    const a = ctx.kb.upload('甲', [{ name: 'a.txt', text: '1' }])
    const b = ctx.kb.upload('乙', [{ name: 'b.txt', text: '2' }])
    expect(ctx.kb.read(a.id, `../${b.id}/b.txt`)).toBeUndefined()
    expect(ctx.kb.read('不存在', `../${a.id}/a.txt`)).toBeUndefined()
    expect(ctx.kb.dirOf('..')).toBeUndefined()
  })
})
