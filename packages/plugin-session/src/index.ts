import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  Blueprint,
  BlueprintRow,
  Item,
  PaperGap,
  PaperVersion,
  SessionApi,
  SessionMeta,
  SlotBinding,
  SlotChange,
} from '@examharness/core'
import z from 'schemastery'

/**
 * 会话与卷子版本。
 *
 * 分工：`ctx.paper` 只管"按蓝图凑齐一份卷子"（纯约束求解）；
 * 本服务管**它是谁的、第几版、谁签过字**。两件事分开，界面才谈得上版本与 diff。
 *
 * 两条状态迁移在本服务里落地：
 *   - **R4**：`needs_review` → `verified` 只能由人签（`confirm()`），系统不自己升级；
 *   - **R3**：`freeze()` 之后所有写操作一律拒绝——冻结的是"交付物"，不是"代码"。
 */

export const name = 'session'
export const inject = ['bank', 'paper', 'construct']

export const Config = z.object({
  path: z.string().default('data/sessions.json'),
  defaultBlueprint: z.string().default('seed/blueprint.json'),
  defaultClass: z.string().default('初三(2)班'),
  defaultProgress: z.string().default(''),
})

export interface SessionConfig {
  path: string
  defaultBlueprint: string
  defaultClass: string
  defaultProgress: string
}

/** 两个知识点集合是否等价（用于校验"新题没被偷偷换掉分类"） */
function sameKnowledge(left: readonly string[], right: readonly string[]): boolean {
  return left.toSorted().join('|') === right.toSorted().join('|')
}

interface SessionRecord {
  meta: SessionMeta
  versions: PaperVersion[]
}

interface Store {
  currentId: string
  sessions: SessionRecord[]
}

export class SessionService extends Service implements SessionApi {
  static Config = Config

  private readonly config: SessionConfig
  private readonly file: string
  private store: Store

  constructor(ctx: Context, config: SessionConfig) {
    super(ctx, 'session')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.config = config
    this.file = resolve(base, config.path)
    this.base = base
    this.store = this.load() ?? this.seed()
    this.save()
  }

  private readonly base: string

  // ── 会话 CRUD ────────────────────────────────────────────

  list(): readonly SessionMeta[] {
    return this.store.sessions.map((record) => record.meta)
  }

  current(): SessionMeta {
    const found = this.store.sessions.find((record) => record.meta.id === this.store.currentId)
    if (found !== undefined) return found.meta
    const created = this.create()
    return created
  }

  create(patch: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath'>> = {}): SessionMeta {
    const index = this.store.sessions.length + 1
    const meta: SessionMeta = {
      id: `s${String(Date.now())}-${String(index)}`,
      title: patch.title ?? `未命名会话 ${String(index)}`,
      className: patch.className ?? this.config.defaultClass,
      progress: patch.progress ?? this.config.defaultProgress,
      blueprintPath: patch.blueprintPath ?? this.config.defaultBlueprint,
      createdAt: new Date().toISOString(),
      frozen: false,
    }
    this.store.sessions.push({ meta, versions: [] })
    this.store.currentId = meta.id
    this.save()
    return meta
  }

  switch(id: string): SessionMeta {
    const found = this.store.sessions.find((record) => record.meta.id === id)
    if (found === undefined) throw new Error(`没有这个会话：${id}`)
    this.store.currentId = id
    this.save()
    return found.meta
  }

  update(
    patch: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath'>>,
  ): SessionMeta {
    const record = this.record()
    if (record.meta.frozen) throw new Error('本会话已冻结：冻结后不可改动（R3）')
    record.meta = { ...record.meta, ...patch }
    this.save()
    return record.meta
  }

  // ── 版本 ────────────────────────────────────────────────

  versions(): readonly PaperVersion[] {
    return this.record().versions
  }

  latest(): PaperVersion | undefined {
    return this.record().versions.at(-1)
  }

  diff(from?: number, to?: number): readonly SlotChange[] {
    const versions = this.record().versions
    const toIndex = to === undefined ? versions.length - 1 : to - 1
    const fromIndex = from === undefined ? toIndex - 1 : from - 1
    const before = versions[fromIndex]
    const after = versions[toIndex]
    if (before === undefined || after === undefined) return []

    const slots = new Set([...before.bindings.map((b) => b.slot), ...after.bindings.map((b) => b.slot)])
    return [...slots].toSorted().map((slot) => {
      const a = before.bindings.find((binding) => binding.slot === slot)
      const b = after.bindings.find((binding) => binding.slot === slot)
      if (a === undefined && b !== undefined) return { slot, change: 'added' as const, to: b.itemId }
      if (a !== undefined && b === undefined) return { slot, change: 'removed' as const, from: a.itemId }
      if (a !== undefined && b !== undefined && a.itemId !== b.itemId) {
        return { slot, change: 'replaced' as const, from: a.itemId, to: b.itemId }
      }
      return { slot, change: 'same' as const }
    })
  }

  async assemble(reason = '组卷'): Promise<PaperVersion> {
    const record = this.record()
    if (record.meta.frozen) throw new Error('本会话已冻结：冻结后不可改动（R3）')
    const blueprint = this.blueprintOf(record.meta)
    const paper = await this.ctx.paper.assemble(blueprint)
    const previous = this.latest()

    // 同一道题在重组卷后**保持原有签字**：签字是对题目的，不是对版本的
    const bindings: SlotBinding[] = paper.slots.map((slot) => {
      const kept = previous?.bindings.find((binding) => binding.itemId === slot.itemId)
      return {
        slot: slot.key,
        itemId: slot.itemId,
        confirmedBy: kept?.confirmedBy ?? null,
        confirmedAt: kept?.confirmedAt ?? null,
      }
    })
    return this.push(record, reason, bindings, paper.attempts, paper.gaps, blueprint.paper.totalScore)
  }

  async regenerate(slotKey: string, seed?: number): Promise<{ ok: boolean; version?: PaperVersion; reason?: string }> {
    const record = this.record()
    if (record.meta.frozen) return { ok: false, reason: '本会话已冻结：冻结后不可改动（R3）' }

    const blueprint = this.blueprintOf(record.meta)
    const row = blueprint.blueprint.find((entry) => entry.key === slotKey || slotKey.startsWith(`${entry.key}-`))
    if (row === undefined) return { ok: false, reason: `蓝图里没有题位 ${slotKey}` }

    const attemptSeed = seed ?? Math.floor(Math.random() * 1_000_000)
    let item: Item
    try {
      item = this.ctx.construct.generate({ ...row, key: slotKey, count: 1 }, attemptSeed)
    } catch (error) {
      return { ok: false, reason: `构造器不覆盖该题位：${error instanceof Error ? error.message : String(error)}` }
    }

    // **局部重做必须守住蓝图约束**：构造器不许偷偷换知识点/题型/分值
    if (
      !sameKnowledge(item.slot.knowledge, row.knowledge) ||
      item.slot.type !== row.type ||
      item.slot.score !== row.score
    ) {
      return { ok: false, reason: '新题的分类信息与蓝图不符，已放弃这次重做' }
    }

    const result = await this.ctx.bank.submit(item)
    if (!result.ok) return { ok: false, reason: `${result.verdict.gate}：${result.verdict.reason}` }

    const previous = this.latest()
    const bindings = (previous?.bindings ?? []).filter((binding) => binding.slot !== slotKey)
    bindings.push({
      slot: slotKey,
      itemId: result.id,
      confirmedBy: null,
      confirmedAt: null,
    })
    const version = this.push(record, `重做 ${slotKey}`, bindings, 1, previous?.gaps ?? [], blueprint.paper.totalScore)
    return { ok: true, version }
  }

  confirm(itemId: string, by: string): SlotBinding | undefined {
    const item = this.ctx.bank.confirm(itemId, by)
    if (item === undefined) return undefined
    const stamp = { confirmedBy: by, confirmedAt: item.review.confirmedAt }
    let updated: SlotBinding | undefined
    for (const version of this.record().versions) {
      version.bindings = version.bindings.map((binding) => {
        if (binding.itemId !== itemId) return binding
        updated = { ...binding, ...stamp }
        return updated
      })
    }
    this.save()
    return updated
  }

  freeze(): PaperVersion | undefined {
    const record = this.record()
    record.meta = { ...record.meta, frozen: true }
    this.save()
    return this.latest()
  }

  // ── 内部 ────────────────────────────────────────────────

  private record(): SessionRecord {
    const id = this.current().id
    const found = this.store.sessions.find((entry) => entry.meta.id === id)
    if (found === undefined) throw new Error('会话状态损坏')
    return found
  }

  private blueprintOf(meta: SessionMeta): Blueprint {
    return JSON.parse(readFileSync(resolve(this.base, meta.blueprintPath), 'utf8')) as Blueprint
  }

  private push(
    record: SessionRecord,
    reason: string,
    bindings: readonly SlotBinding[],
    attempts: number,
    gaps: readonly PaperGap[],
    blueprintTotal: number,
  ): PaperVersion {
    const items = bindings.flatMap((binding) => {
      const item = this.ctx.bank.get(binding.itemId)
      return item === undefined ? [] : [item]
    })
    const totalScore = items.reduce((sum, item) => sum + item.slot.score, 0)
    const version: PaperVersion = {
      version: record.versions.length + 1,
      at: new Date().toISOString(),
      reason,
      bindings: [...bindings],
      totalScore,
      scoreGap: blueprintTotal - totalScore,
      attempts,
      gaps: [...gaps],
    }
    record.versions.push(version)
    this.save()
    return version
  }

  private load(): Store | undefined {
    if (!existsSync(this.file)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Store
      if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  private seed(): Store {
    const now = new Date().toISOString()
    const meta: SessionMeta = {
      id: 's-default',
      title: '课后作业卷',
      className: this.config.defaultClass,
      progress: this.config.defaultProgress,
      blueprintPath: this.config.defaultBlueprint,
      createdAt: now,
      frozen: false,
    }
    return { currentId: meta.id, sessions: [{ meta, versions: [] }] }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.store, null, 1), 'utf8')
  }
}

/** 供界面显示的题位行（在 web 层组装，避免界面直接看 Item） */
export type { BlueprintRow }

export function apply(ctx: Context, config: SessionConfig): void {
  ctx.plugin(SessionService, config)
}
