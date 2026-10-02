import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BankApi, Item, SearchQuery, SubmitResult } from '@examharness/core'
import z from 'schemastery'

/**
 * 题库。**R2 的落点**：唯一的写入口是 `submit()`，而它必然先跑闸门链。
 * agent 的工作区对题库只读——没有别的路能进来。
 */

export const name = 'bank'

export const Config = z.object({
  path: z.string().default('data/bank.jsonl'),
})

export interface BankConfig {
  path: string
}

export class BankService extends Service implements BankApi {
  static Config = Config

  private readonly file: string
  private readonly items = new Map<string, Item>()

  constructor(ctx: Context, config: BankConfig) {
    super(ctx, 'bank')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.file = resolve(base, config.path)
    this.load()
  }

  /** 某题位当前已有的题 */
  bySlot(key: string): readonly Item[] {
    return this.all().filter((item) => item.slot.key === key)
  }

  /** 检索：按知识点与难度区间过滤 */
  search(query: SearchQuery = {}): readonly Item[] {
    const knowledge = query.knowledge ?? []
    const [low, high] = query.difficulty ?? [-Infinity, Infinity]
    const hit = this.all().filter((item) => {
      if (!knowledge.every((key) => item.slot.knowledge.includes(key))) return false
      const mid = (item.slot.difficulty[0] + item.slot.difficulty[1]) / 2
      return mid >= low && mid <= high
    })
    return query.limit === undefined ? hit : hit.slice(0, query.limit)
  }

  /** 给命题 agent 的风格样例（只对齐风格与难度，不引用原题） */
  fewShot(knowledge: readonly string[], count: number): readonly Item[] {
    return this.search({ knowledge, limit: count })
  }

  /** 结构指纹：构造器 + 参数，排序后拼接（确定性） */
  fingerprint(item: Item): string {
    const params = Object.entries(item.instance.params)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',')
    return `${item.instance.kind}|${params}`
  }

  /** 相似度：参数字面量 + 知识点的 Jaccard。简单、可解释、无模型调用 */
  similarity(a: Item, b: Item): number {
    const left = this.tokens(a)
    const right = this.tokens(b)
    const union = new Set([...left, ...right])
    if (union.size === 0) return 0
    let shared = 0
    for (const token of union) if (left.has(token) && right.has(token)) shared += 1
    return shared / union.size
  }

  /**
   * ★ 唯一写入口。先过闸门链（waterfall），通过才入库。
   * 判定不通过时**什么都不写**，只发一条 item:rejected 供界面与轨迹记录。
   */
  async submit(item: Item): Promise<SubmitResult> {
    // waterfall 的调用侧要给出最内层的 next：框架把它交给最外层监听者，逐层向内
    const verdict = await this.ctx.waterfall('item:verify', item, () => ({ pass: true }))
    if (!verdict.pass) {
      this.ctx.emit('item:rejected', { item, verdict })
      return { ok: false, verdict }
    }
    // 过了但有疑点 → needs_review：**只能由人**改成 verified（R4），系统不许自己升级
    const stored: Item = {
      ...item,
      lifecycle: verdict.needsReview === true ? 'needs_review' : 'verified',
      evidence: { ...item.evidence, ...verdict.evidence },
    }
    this.items.set(stored.id, stored)
    this.append(stored)
    this.ctx.emit('item:stored', { item: stored })
    return { ok: true, id: stored.id, verdict }
  }

  get(id: string): Item | undefined {
    return this.items.get(id)
  }

  /** 人工终审签字：把题目落成 verified 并把"谁、何时"写进 review。 */
  confirm(id: string, by: string): Item | undefined {
    const item = this.items.get(id)
    if (item === undefined) return undefined
    const confirmed: Item = {
      ...item,
      lifecycle: 'verified',
      review: { confirmedBy: by, confirmedAt: new Date().toISOString() },
    }
    this.items.set(id, confirmed)
    this.ctx.emit('item:confirmed', { item: confirmed, by })
    return confirmed
  }

  /** 现役闸门名单：闸门挂载时自己来报到（见 BankApi.declareGate 的说明） */
  private readonly gateNames: string[] = []

  declareGate(gate: string): void {
    if (!this.gateNames.includes(gate)) this.gateNames.push(gate)
  }

  gates(): readonly string[] {
    return [...this.gateNames]
  }

  all(): readonly Item[] {
    return [...this.items.values()]
  }

  private tokens(item: Item): Set<string> {
    const out = new Set<string>(item.slot.knowledge)
    for (const [key, value] of Object.entries(item.instance.params)) out.add(`${key}=${value}`)
    return out
  }

  private load(): void {
    if (!existsSync(this.file)) return
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      const text = line.trim()
      if (text === '') continue
      const item = JSON.parse(text) as Item
      this.items.set(item.id, item)
    }
  }

  private append(item: Item): void {
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(item)}\n`, 'utf8')
  }
}

export function apply(ctx: Context, config: BankConfig): void {
  ctx.plugin(BankService, config)
}
