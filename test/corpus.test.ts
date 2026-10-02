import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item } from '@examharness/core'
import * as bankPlugin from '@examharness/plugin-bank'
import * as constructPlugin from '@examharness/plugin-construct-parabola'
import * as corpusPlugin from '@examharness/plugin-corpus'
import * as figurePlugin from '@examharness/plugin-figure'
import * as graphPlugin from '@examharness/plugin-graph'
import * as dedupPlugin from '@examharness/plugin-verify-dedup'
import * as figureGate from '@examharness/plugin-verify-figure'
import * as scopePlugin from '@examharness/plugin-verify-scope'
import * as symbolicPlugin from '@examharness/plugin-verify-symbolic'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 语料库测试。要盯住两件事：
 *   1. **摄入**：.jsonl / .csv / .md / .txt 都能吃；默认**不可分发**（版权红线 ADR-0014）；
 *   2. **原创度判定不能误伤**：数学题的"像"要看**数字与条件**，只看措辞会把
 *      "同一知识点、不同数值"的题全判成抄原题——那会让整套流水线瘫掉。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEARNED = ['一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值']
const blueprint = JSON.parse(readFileSync(join(ROOT, 'seed/blueprint.json'), 'utf8')) as Blueprint

/** 一条真实的（这里自写的）原题：注意它和我们的模板措辞很像，但数值不同 */
const CORPUS_STEM = '已知抛物线 y = x² - 4x + 3 与 x 轴交于 A、B 两点，求线段 AB 的长。'

const fibers: Fiber[] = []
const scratch: string[] = []

function slot(): BlueprintRow {
  const row = blueprint.blueprint[0]
  if (row === undefined) throw new Error('蓝图缺少 S1')
  return row
}

/** 造一个语料目录，四种格式各来一份 */
function makeCorpusDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-corpus-'))
  scratch.push(dir)
  writeFileSync(
    join(dir, 'a.jsonl'),
    [
      JSON.stringify({ id: 'c-1', stem: CORPUS_STEM, answer: 'AB = 2', knowledge: ['与坐标轴交点'], difficulty: 0.72 }),
      JSON.stringify({ id: 'c-2', stem: '已知抛物线的对称轴为 x = 3，求它与 y 轴的交点。', distributable: true }),
      JSON.stringify({ stem: '短' }), // 太短：应被丢弃
      '',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(dir, 'b.csv'),
    ['stem,answer,knowledge,type,difficulty', '"将抛物线 y = x² 向右平移 3 个单位，写出新解析式。","y = (x − 3)²","图象平移","填空",0.7'].join('\n'),
    'utf8',
  )
  writeFileSync(join(dir, 'c.md'), `## 二次函数 y = x² + 2x + m 与 x 轴只有一个交点，求 m。\n判别式为 0，故 m = 1。\n`, 'utf8')
  writeFileSync(join(dir, 'd.txt'), '求抛物线 y = x² - 1 与 x 轴交点之间的距离。\n', 'utf8')
  return dir
}

async function boot(options: { withCorpus?: string | undefined }): Promise<Context> {
  const context = new Context()
  context.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await context.plugin(graphPlugin, { path: 'seed/knowledge.json', paths: [], learned: LEARNED }),
    await context.plugin(bankPlugin, { path: join(mkdtempSync(join(tmpdir(), 'examharness-bank-')), 'b.jsonl') }),
    await context.plugin(scopePlugin, { forbid: [...blueprint.constraints.forbidKnowledge] }),
    await context.plugin(symbolicPlugin, { tolerance: 1e-9 }),
    await context.plugin(dedupPlugin, { maxSimilarity: 0.85, corpusWordingMax: 0.55, corpusNumbersMin: 0.8 }),
    await context.plugin(figurePlugin, { width: 480, height: 300, minPointGapPx: 14 }),
    await context.plugin(figureGate, { requireFigure: false }),
    await context.plugin(constructPlugin, { rootRange: [-4, 5] }),
  )
  if (options.withCorpus !== undefined) {
    fibers.push(
      await context.plugin(corpusPlugin, { dirs: [options.withCorpus], minLength: 8, maxSimilarity: 0.6 }),
    )
  }
  return context
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('语料库', () => {
  it('四种格式都能摄入；默认不可分发，过短的条目被丢弃', async () => {
    const ctx = await boot({ withCorpus: makeCorpusDir() })
    const stats = ctx.corpus.stats()

    expect(ctx.corpus.size).toBe(5) // jsonl 2 + csv 1 + md 1 + txt 1（"短"被丢）
    expect(ctx.corpus.records().map((record) => record.id)).toContain('c-1')
    expect(ctx.corpus.records().filter((record) => record.distributable).map((record) => record.id)).toEqual(['c-2'])
    expect(stats.bySource['a.jsonl']).toBe(2)
  })

  it('语料原文不会因为"可分发"以外的原因外流：记录里带 source 便于回溯', async () => {
    const ctx = await boot({ withCorpus: makeCorpusDir() })
    const record = ctx.corpus.records().find((entry) => entry.id === 'c-1')
    expect(record?.source).toBe('a.jsonl')
    expect(record?.distributable).toBe(false)
  })

  it('抄原题被拦：数字与措辞同时像', async () => {
    const ctx = await boot({ withCorpus: makeCorpusDir() })
    const item = ctx.construct.generate(slot(), 42)
    // 把题面换成语料原文——这就是"在原题上换皮"的极端情况
    const copied: Item = { ...item, prose: { ...item.prose, stem: CORPUS_STEM } }

    const result = await ctx.bank.submit(copied)
    expect(result.ok).toBe(false)
    const verdict = result.ok ? undefined : result.verdict
    expect(verdict?.gate).toBe('verify-dedup')
    expect(verdict?.reason).toContain('语料库')
    expect(ctx.bank.all()).toHaveLength(0)
  })

  it('同知识点、不同数值**不**算抄——否则整套流水线会被误伤', async () => {
    const ctx = await boot({ withCorpus: makeCorpusDir() })
    const item = ctx.construct.generate(slot(), 42) // 数字与语料不同、措辞很像

    const result = await ctx.bank.submit(item)
    expect(result.ok).toBe(true)

    const stored = ctx.bank.all()[0]
    expect(stored?.evidence.originality?.pass).toBe(true)
    // 证据里给出两个数字，但**不出原文**
    expect(stored?.evidence.originality?.detail).toContain('数字')
    expect(stored?.evidence.originality?.detail).toContain('措辞')
    expect(JSON.stringify(stored?.evidence)).not.toContain('x² - 4x + 3')
  })

  it('没接语料库时也能跑（原创度标注为未接入，而不是拦人）', async () => {
    const ctx = await boot({})
    const result = await ctx.bank.submit(ctx.construct.generate(slot(), 42))

    expect(result.ok).toBe(true)
    expect(ctx.bank.all()[0]?.evidence.originality?.detail).toBe('未接入语料库')
  })
})
