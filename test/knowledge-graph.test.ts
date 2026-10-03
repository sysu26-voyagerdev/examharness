import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import type { KnowledgeFusion, KnowledgeGraph } from '@examharness/core'
import * as graphPlugin from '@examharness/plugin-graph'
import { afterEach, describe, expect, it } from 'vitest'
import { learnedClosure } from './helpers/learned.js'

/**
 * 知识图谱的验收测试。
 *
 * 要证明的是**这份图谱是真的从材料里长出来的**，而不是换了个写法的手写表：
 *   1. 老契约没破：原有 27 个知识点名一个不少（蓝图、构造器、cordis.yml 都在用它们）；
 *   2. 结构是对的：前置是有向无环图、前置一定存在、每个节点都写出处；
 *   3. 依据分得清：哪些是课标来的、哪些是课标示例来的、哪些是真题统计来的、哪些是推断；
 *   4. 新增能力真的有用：`search('抛物线')` 能找到「二次函数图象」，
 *      `fusion()` 返回的共现**带支持卷数**（多知识点融合的证据）；
 *   5. 超纲判定没被放宽：老名字照旧合法，未学的新知识点照旧拦得住。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const KNOWLEDGE_PATH = join(ROOT, 'seed/knowledge.json')
const FUSION_PATH = join(ROOT, 'seed/knowledge-fusion.json')

/** 原有 27 个知识点名（**契约**：蓝图、构造器 covers、cordis.yml 的 learned 都用它们做键） */
const LEGACY = [
  '一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值',
  '实际问题建模', '动点问题', '实数运算', '实数与二次根式', '整式运算', '整式与因式分解',
  '一元二次方程', '反比例函数', '统计与概率', '三角形与全等', '四边形与特殊平行四边形',
  '相似三角形', '锐角三角函数', '圆的性质', '一元一次不等式', '规律与代数推理',
  '四边形与证明', '圆与切线', '二次函数综合',
]

/** cordis.yml 里那一份「已学」前沿（与配置文件同源；改了配置这里要跟着改） */
const LEARNED_FRONTIER = [
  '实数运算', '实数与二次根式', '整式运算', '整式与因式分解', '一元一次不等式', '一次函数',
  '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值', '一元二次方程',
  '反比例函数', '统计与概率', '三角形与全等', '相似三角形', '锐角三角函数',
  '四边形与特殊平行四边形', '圆的性质', '规律与代数推理', '四边形与证明', '圆与切线',
  '二次函数综合',
]

const graph = JSON.parse(readFileSync(KNOWLEDGE_PATH, 'utf8')) as KnowledgeGraph
const fusion = JSON.parse(readFileSync(FUSION_PATH, 'utf8')) as KnowledgeFusion

const fibers: Fiber[] = []

afterEach(async () => {
  // oxlint-disable-next-line no-await-in-loop -- 收尾必须串行
  for (const fiber of fibers.splice(0)) await fiber.dispose()
})

async function boot(learned: readonly string[]): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(await ctx.plugin(graphPlugin, { path: 'seed/knowledge.json', learned: [...learned] }))
  return ctx
}

describe('知识图谱：老契约', () => {
  it('原有 27 个知识点名一个都没少（不能删、不能改名）', () => {
    const missing = LEGACY.filter((name) => graph.nodes[name] === undefined)
    expect(missing).toEqual([])
  })

  it('每个节点都有名字之外的信息：年级、章节、领域、类型、出处', () => {
    const broken = Object.entries(graph.nodes)
      .filter(([, node]) => {
        return (
          typeof node.grade !== 'string' ||
          typeof node.chapter !== 'string' ||
          typeof node.domain !== 'string' ||
          typeof node.kind !== 'string' ||
          !Array.isArray(node.aliases) ||
          !Array.isArray(node.sources) ||
          node.sources.length === 0
        )
      })
      .map(([key]) => key)
    expect(broken).toEqual([])
    // 从 27 个手写节点长到覆盖第四学段，节点数必须真的涨了
    expect(Object.keys(graph.nodes).length).toBeGreaterThan(100)
  })

  it('节点形状向后兼容：prerequisites 仍然是"知识点名数组"，旧消费者不用改', () => {
    for (const node of Object.values(graph.nodes)) {
      expect(Array.isArray(node.prerequisites)).toBe(true)
      for (const prerequisite of node.prerequisites ?? []) {
        expect(typeof prerequisite).toBe('string')
      }
    }
  })
})

describe('知识图谱：结构正确性', () => {
  it('前置关系是有向无环图（有环的话"前置闭包"就没意义了）', () => {
    const state = new Map<string, 'open' | 'done'>()
    const visit = (name: string, path: string[]): void => {
      if (state.get(name) === 'done') return
      expect(state.get(name), `前置成环：${[...path, name].join(' → ')}`).not.toBe('open')
      state.set(name, 'open')
      for (const prerequisite of graph.nodes[name]?.prerequisites ?? []) {
        visit(prerequisite, [...path, name])
      }
      state.set(name, 'done')
    }
    for (const name of Object.keys(graph.nodes)) visit(name, [])
  })

  it('前置一定存在（指向空气的前置 = 闸门算不出闭包）', () => {
    const dangling: string[] = []
    for (const [name, node] of Object.entries(graph.nodes)) {
      for (const prerequisite of node.prerequisites ?? []) {
        if (graph.nodes[prerequisite] === undefined) dangling.push(`${name} → ${prerequisite}`)
      }
    }
    expect(dangling).toEqual([])
  })

  it('每条前置边都写了依据（课标先后 / 教材章节先后 / 定义依赖）', () => {
    const noBasis: string[] = []
    for (const [name, node] of Object.entries(graph.nodes)) {
      const basis = (node.prerequisiteBasis ?? {}) as Record<string, string>
      for (const prerequisite of node.prerequisites ?? []) {
        if (typeof basis[prerequisite] !== 'string' || basis[prerequisite] === '') {
          noBasis.push(`${name} → ${prerequisite}`)
        }
      }
    }
    expect(noBasis).toEqual([])
  })

  it('依据分类分得清，而且"有依据"的比例够高（课标 / 课标示例 / 教材+真题），推断的必须写明原因', () => {
    const levels = { 课标: 0, 课标示例: 0, 教材与真题: 0, 推断: 0 } as Record<string, number>
    const unexplained: string[] = []
    for (const [name, node] of Object.entries(graph.nodes)) {
      const evidence = (node.evidence ?? {}) as { level?: string }
      const level = evidence.level ?? '推断'
      levels[level] = (levels[level] ?? 0) + 1
      if (level === '推断' && typeof node.note !== 'string') unexplained.push(name)
    }
    expect(unexplained).toEqual([])
    const total = Object.keys(graph.nodes).length
    const grounded = total - (levels['推断'] ?? 0)
    // 有依据的比例：低于 85% 说明图谱里混进了太多"我觉得有"的节点
    expect(grounded / total).toBeGreaterThan(0.85)
  })
})

describe('知识图谱 API：search / neighbors / fusion', () => {
  it('search 靠别名就能找到「二次函数图象」（agent 不必一字不差）', async () => {
    const ctx = await boot(LEARNED_FRONTIER)
    const hits = ctx.graph.search('抛物线')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.map((hit) => hit.key)).toContain('二次函数图象')
  })

  it('search 支持部分词、写错一个字也能给候选，找不到就老实返回空', async () => {
    const ctx = await boot(LEARNED_FRONTIER)
    expect(ctx.graph.search('二次函数').map((hit) => hit.key)).toContain('二次函数图象')
    expect(ctx.graph.search('中位数').map((hit) => hit.key).length).toBeGreaterThan(0)
    expect(ctx.graph.search('这种东西根本不存在')).toEqual([])
  })

  it('neighbors 给前置与后继（两个方向都要看得见）', async () => {
    const ctx = await boot(LEARNED_FRONTIER)
    const neighbors = ctx.graph.neighbors('顶点式')
    expect(neighbors?.prerequisites.length).toBeGreaterThan(0)
    expect(neighbors?.prerequisites).toContain('二次函数图象')
    expect(ctx.graph.neighbors('顶点式')?.successors).toContain('对称轴')
    expect(ctx.graph.neighbors('不存在的知识点')).toBeUndefined()
  })

  it('fusion 返回的共现**带支持卷数**，而且 2 卷以下的不进产物', async () => {
    const ctx = await boot(LEARNED_FRONTIER)
    const view = ctx.graph.fusion('二次函数图象')
    expect(view.stat?.supportPapers ?? 0).toBeGreaterThan(10)
    expect(view.together.length).toBeGreaterThan(0)
    for (const item of view.together) {
      expect(item.papers).toBeGreaterThanOrEqual(2)
      expect(graph.nodes[item.with]).toBeDefined()
    }
    // 分问数与题型分布是"这题长什么样"的两条，必须有
    expect(Object.keys(view.stat?.typeDist ?? {}).length).toBeGreaterThan(0)
    expect(view.stat?.ask).not.toBe('')
  })

  it('融合数据覆盖了大部分重点知识点（每卷统计的卷数 = 183 份去重真题）', () => {
    const method = (fusion.method ?? {}) as { coveredPapers?: number }
    expect(method.coveredPapers).toBe(183)
    const covered = Object.values(fusion.nodes).filter((stat) => stat.supportPapers > 0).length
    expect(covered / Object.keys(fusion.nodes).length).toBeGreaterThan(0.6)
    expect((fusion.pairs ?? []).length).toBeGreaterThan(50)
  })

  it('融合数据里不许有真题原文（版权红线：只有统计与归纳）', () => {
    const text = readFileSync(FUSION_PATH, 'utf8')
    // 题干会有"如图""求"这类句式；这里是粗筛，防止有人把题面粘进来
    for (const forbidden of ['如图', '（1）求', '（2）求', '下列说法的']) {
      expect(text.includes(forbidden)).toBe(false)
    }
  })
})

describe('知识图谱：超纲判定没有被放宽', () => {
  it('老名字（已学）照旧合法；未学的知识点照旧被拦下', async () => {
    const ctx = await boot(LEARNED_FRONTIER)
    for (const name of LEARNED_FRONTIER) {
      expect(ctx.graph.missing([name]), `${name} 不该超纲`).toEqual([])
    }
    // 「动点问题」「实际问题建模」是这一卷明说没学的：它们自己必须出现在越界清单里，
    // 而且**不许**把已学的前置知识牵连进来（否则闸门的报错就在骗老师）
    for (const name of ['动点问题', '实际问题建模']) {
      const missing = ctx.graph.missing([name])
      expect(missing).toContain(name)
      expect(missing.filter((key) => LEARNED_FRONTIER.includes(key))).toEqual([])
    }
  })

  it('已学集合按前置闭包写进配置后，老蓝图要的题位依然合法', async () => {
    const ctx = await boot(learnedClosure(LEARNED_FRONTIER))
    for (const name of ['与坐标轴交点', '对称轴', '顶点式', '二次函数综合', '圆与切线']) {
      expect(ctx.graph.missing([name]), `${name} 不该超纲`).toEqual([])
    }
  })
})

describe('知识图谱：构建产物可复现', () => {
  const hasMaterial = existsSync(resolve(ROOT, 'data/zhenti/structure.json'))

  it.skipIf(!hasMaterial)('脚本跑出来的产物与仓库里的逐字节一致（确定性重建）', async () => {
    const { execFileSync } = await import('node:child_process')
    const out = join(ROOT, 'data/cache/graph-build-test')
    execFileSync('node', ['scripts/graph-build.mjs', '--out', out], { cwd: ROOT, stdio: 'pipe' })
    for (const file of ['knowledge.json', 'knowledge-fusion.json']) {
      const rebuilt = readFileSync(join(out, file), 'utf8')
      const committed = readFileSync(join(ROOT, 'seed', file), 'utf8')
      expect(rebuilt).toBe(committed)
    }
  }, 120_000)

  it('没有真材料时，产物仍然能加载（图谱是提交进仓库的，不依赖本地材料）', () => {
    expect(existsSync(KNOWLEDGE_PATH)).toBe(true)
    expect(existsSync(FUSION_PATH)).toBe(true)
  })
})
