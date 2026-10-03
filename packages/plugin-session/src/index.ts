import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'
import { fnv1a, shapeOf } from '@examharness/core'
import type {
  Blueprint,
  BlueprintInfo,
  BlueprintPatch,
  SessionGroup,
  BlueprintRow,
  Item,
  PaperGap,
  PaperVersion,
  SessionApi,
  SessionLogEntry,
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
  /** 没配就挨着会话文件放（`<path>.log.json`）——少一个字段不该让整个会话服务起不来 */
  logPath?: string
  blueprintsDir?: string
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
  groups: SessionGroup[]
}

/** 会话记录留最近这么多条（再久远的翻不到了，但文件不会无限长） */
const LOG_LIMIT = 500

export class SessionService extends Service implements SessionApi {
  static Config = Config

  private readonly config: SessionConfig
  private readonly file: string
  private readonly logFile: string
  private store: Store
  /** 每个会话一条记录（刷新页面不丢；这是"这个会话发生过什么"的凭据） */
  private logs = new Map<string, SessionLogEntry[]>()
  private logCounter = 0

  constructor(ctx: Context, config: SessionConfig) {
    super(ctx, 'session')
    const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
    this.config = { ...config, blueprintsDir: config.blueprintsDir ?? 'seed/blueprints' }
    this.file = resolve(base, config.path)
    this.logFile = resolve(base, config.logPath ?? `${config.path}.log.json`)
    this.base = base
    this.store = this.load() ?? this.seed()
    this.save()
    this.loadLogs()
  }

  private readonly base: string

  // ── 会话 CRUD ────────────────────────────────────────────

  /** 追加一行会话记录；会话冻结后不再记（冻结 = 这一版到此为止） */
  appendLog(entry: Omit<SessionLogEntry, 'id' | 'at'>): SessionLogEntry | undefined {
    const current = this.currentRecord()
    if (current === undefined || current.meta.frozen) return undefined
    const row: SessionLogEntry = {
      id: `l${String(Date.now())}-${String((this.logCounter += 1))}`,
      at: new Date().toISOString(),
      ...entry,
    }
    this.logs.set(current.meta.id, [...(this.logs.get(current.meta.id) ?? []), row].slice(-LOG_LIMIT))
    this.saveLogs()
    return row
  }

  log(): readonly SessionLogEntry[] {
    const current = this.currentRecord()
    return current === undefined ? [] : (this.logs.get(current.meta.id) ?? [])
  }

  private currentRecord(): SessionRecord | undefined {
    return this.store.sessions.find((entry) => entry.meta.id === this.store.currentId)
  }

  list(): readonly SessionMeta[] {
    return this.store.sessions.map((record) => record.meta)
  }

  groups(): readonly SessionGroup[] {
    return this.store.groups
  }

  createGroup(title: string): SessionGroup {
    const group: SessionGroup = { id: `g-${String(Date.now())}`, name: title === '' ? '未命名分组' : title }
    this.store.groups.push(group)
    this.save()
    return group
  }

  renameGroup(id: string, title: string): SessionGroup | undefined {
    const group = this.store.groups.find((entry) => entry.id === id)
    if (group === undefined) return undefined
    group.name = title
    this.save()
    return group
  }

  moveToGroup(sessionId: string, groupId: string): SessionMeta | undefined {
    const record = this.store.sessions.find((entry) => entry.meta.id === sessionId)
    if (record === undefined) return undefined
    record.meta = { ...record.meta, groupId }
    this.save()
    return record.meta
  }

  current(): SessionMeta {
    const found = this.store.sessions.find((record) => record.meta.id === this.store.currentId)
    if (found !== undefined) return found.meta
    const created = this.create()
    return created
  }

  create(
    patch: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath' | 'groupId' | 'kbId'>> = {},
  ): SessionMeta {
    const index = this.store.sessions.length + 1
    const meta: SessionMeta = {
      id: `s${String(Date.now())}-${String(index)}`,
      title: patch.title ?? `未命名会话 ${String(index)}`,
      className: patch.className ?? this.config.defaultClass,
      progress: patch.progress ?? this.config.defaultProgress,
      blueprintPath: patch.blueprintPath ?? this.config.defaultBlueprint,
      createdAt: new Date().toISOString(),
      frozen: false,
      groupId: patch.groupId ?? '',
      kbId: patch.kbId ?? '',
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
    patch: Partial<Pick<SessionMeta, 'title' | 'className' | 'progress' | 'blueprintPath' | 'groupId' | 'kbId'>>,
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
    // **再出一版 = 现造**：给一个这次组卷专属的 nonce，并把这张会话用过的结构交给组卷去避开
    const usedShapes = this.usedShapes(record)
    // 老师签过字的那几道**钉住不动**：签的是那道题，重组卷不该把它换掉
    const pinned: Record<string, string> = {}
    for (const binding of this.latest()?.bindings ?? []) {
      if (binding.confirmedBy !== null) pinned[binding.slot] = binding.itemId
    }
    const paper = await this.ctx.paper.assemble(blueprint, {
      nonce: `${record.meta.id}|${String(Date.now())}`,
      usedShapes,
      pinned,
    })
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

  /**
   * 这张会话**已经用过的结构**（最近几版卷子里题目的"条件+问法"指纹）。
   *
   * 组卷时拿它去避开：新卷子应该在**结构**上也是新的，而不只是换数字。
   * 只用最近几版：太久以前的题忘掉没关系，重要的是"最近别老是那几种"。
   */
  private usedShapes(record: SessionRecord): string[] {
    const recent = record.versions.slice(-3)
    const shapes: string[] = []
    for (const version of recent) {
      for (const binding of version.bindings) {
        const item = this.ctx.bank.get(binding.itemId)
        if (item !== undefined) shapes.push(shapeOf(item))
      }
    }
    return shapes
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

  /**
   * **老师指定用这一道**：把题库里已有的题放进某个题位。
   *
   * 与"重做"的区别：重做是让机器再造一道，这里是**老师挑好了**。
   * 所以要守的规矩是"不许悄悄换掉题位的类型"（选择题填不进解答题位），
   * 其余交给闸门：这道题若还没被现役闸门全部签过字，就重新送审一遍再放。
   */
  async place(slotKey: string, itemId: string): Promise<{ ok: boolean; version?: PaperVersion; reason?: string }> {
    const record = this.record()
    if (record.meta.frozen) return { ok: false, reason: '本会话已冻结：冻结后不可改动（R3）' }

    const blueprint = this.blueprintOf(record.meta)
    const row = blueprint.blueprint.find((entry) => entry.key === slotKey || slotKey.startsWith(`${entry.key}-`))
    if (row === undefined) return { ok: false, reason: `蓝图里没有题位 ${slotKey}` }

    const item = this.ctx.bank.get(itemId)
    if (item === undefined) return { ok: false, reason: '题库里没有这道题' }
    if (item.slot.type !== row.type) {
      return { ok: false, reason: `这是${item.slot.type}题，题位 ${slotKey} 要的是${row.type}题` }
    }

    // 没被现役闸门签过字的旧题：重新送审（通过才放，不通过就把原因说清）
    const unsigned = (this.ctx.bank.gates?.() ?? []).filter((gate) => item.evidence[gate] === undefined)
    if (unsigned.length > 0) {
      const verdict = await this.ctx.bank.submit(item)
      if (!verdict.ok) return { ok: false, reason: `${verdict.verdict.gate}：${verdict.verdict.reason}` }
    }

    const previous = this.latest()
    const bindings = (previous?.bindings ?? []).filter((binding) => binding.slot !== slotKey)
    bindings.push({ slot: slotKey, itemId, confirmedBy: null, confirmedAt: null })
    const version = this.push(record, `指定 ${slotKey}`, bindings, 0, previous?.gaps ?? [], blueprint.paper.totalScore)
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

  blueprint(): Blueprint {
    return this.blueprintOf(this.current())
  }

  /**
   * 蓝图库：**老师手上是一套模板，不是一个蓝图**（课后作业、单元测验、期中卷…）。
   * 内置的随仓库走（seed/blueprints），自己和 agent 新建的放 data/blueprints。
   */
  blueprintList(): readonly BlueprintInfo[] {
    const out: BlueprintInfo[] = []
    const dirs = [this.config.blueprintsDir ?? 'seed/blueprints', 'data/blueprints']
    for (const dir of dirs) {
      const abs = resolve(this.base, dir)
      if (!existsSync(abs)) continue
      for (const file of readdirSync(abs)) {
        if (!file.endsWith('.json')) continue
        const full = resolve(abs, file)
        try {
          const parsed = JSON.parse(readFileSync(full, 'utf8')) as Blueprint & { createdBy?: 'agent' | 'teacher' }
          if (!Array.isArray(parsed.blueprint)) continue
          out.push({
            name: file.replace(/\.json$/, ''),
            path: `${dir}/${file}`,
            title: parsed.paper.title,
            totalScore: parsed.paper.totalScore,
            minutes: parsed.paper.minutes,
            slots: parsed.blueprint.length,
            builtin: dir === (this.config.blueprintsDir ?? 'seed/blueprints'),
            ...(parsed.createdBy === undefined ? {} : { createdBy: parsed.createdBy }),
          })
        } catch {
          /* 坏的蓝图列不出来，但也不该让整个库挂掉 */
        }
      }
    }
    return out
  }

  blueprintRead(bluepName: string): Blueprint {
    return JSON.parse(readFileSync(this.blueprintFile(bluepName), 'utf8')) as Blueprint
  }

  /** 新建一份蓝图（agent 也用它）：默认落在 data/blueprints，不碰仓库里内置的那些 */
  blueprintCreate(bluepName: string, blueprint: Blueprint, createdBy: 'agent' | 'teacher' = 'teacher'): BlueprintInfo {
    const safe = safeName(bluepName)
    const file = resolve(this.base, 'data/blueprints', `${safe}.json`)
    if (existsSync(file)) throw new Error(`已经有一份蓝图叫「${bluepName}」了：换个名字，或者去改那一份`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ ...blueprint, createdBy }, null, 2), 'utf8')
    return this.blueprintList().find((info) => info.name === safe) ?? {
      name: safe,
      path: `data/blueprints/${safe}.json`,
      title: blueprint.paper.title,
      totalScore: blueprint.paper.totalScore,
      minutes: blueprint.paper.minutes,
      slots: blueprint.blueprint.length,
      builtin: false,
      createdBy,
    }
  }

  /** 改库里任意一份（共享文件，带修订号防互相覆盖） */
  blueprintUpdate(bluepName: string, patch: BlueprintPatch, expectedRevision?: string): Blueprint {
    const file = this.blueprintFile(bluepName)
    const actual = revisionOf(file)
    if (expectedRevision !== undefined && expectedRevision !== actual) {
      throw new Error(`这份蓝图刚被别处改过（你手上是 ${expectedRevision}，现在是 ${actual}）：重新读一遍再改`)
    }
    const after = normalizeBlueprint(JSON.parse(readFileSync(file, 'utf8')) as Blueprint, patch)
    writeFileSync(file, JSON.stringify(after, null, 2), 'utf8')
    return after
  }

  /** 这个会话就用这份蓝图（题位随之变化；已出的题留在题库里，不会丢） */
  blueprintUse(bluepName: string): SessionMeta {
    const path = relative(this.base, this.blueprintFile(bluepName)).split('\\').join('/')
    return this.update({ blueprintPath: path })
  }

  private blueprintFile(bluepName: string): string {
    const found = this.blueprintList().find((info) => info.name === bluepName)
    if (found === undefined) throw new Error(`库里没有蓝图「${bluepName}」`)
    return resolve(this.base, found.path)
  }

  /** 当前蓝图的来源（路径 + 修订号）：界面靠它判断"是不是被别人改过了" */
  blueprintSource(): { path: string; revision: string } {
    const meta = this.current()
    const file = resolve(this.base, meta.blueprintPath)
    return { path: meta.blueprintPath, revision: revisionOf(file) }
  }

  /**
   * 改蓝图。蓝图**是共享的**（一份文件可能被多个会话、多个老师用），
   * 所以直接改那个文件，并用修订号防止互相覆盖：
   * 拿到的是旧修订号就拒绝写入，让界面重新读一遍再改。
   */
  updateBlueprint(patch: BlueprintPatch, expectedRevision?: string): Blueprint {
    const current = this.record()
    if (current === undefined) throw new Error('没有当前会话')
    if (current.meta.frozen) throw new Error('本会话已冻结：冻结后不可改动（R3）')

    const file = resolve(this.base, current.meta.blueprintPath)
    const actual = revisionOf(file)
    if (expectedRevision !== undefined && expectedRevision !== actual) {
      throw new Error(`这份蓝图刚被别处改过（你手上是 ${expectedRevision}，现在是 ${actual}）：重新打开再改`)
    }

    const before = JSON.parse(readFileSync(file, 'utf8')) as Blueprint
    const after = normalizeBlueprint(before, patch)
    writeFileSync(file, JSON.stringify(after, null, 2), 'utf8')
    return after
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
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Store>
      if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return undefined
      // 老存档没有 groups / groupId / kbId——**在这里补齐**。
      // 不能让 undefined 渗到接口层：JSON.stringify 会直接丢掉 undefined 的键，
      // 界面拿到的是"根本没有这个字段"，于是按分组过滤会静默判错（所有会话都落不进分组）。
      return {
        currentId: parsed.currentId ?? parsed.sessions[0]?.meta.id ?? '',
        sessions: parsed.sessions.map((record) => ({
          ...record,
          meta: { ...record.meta, groupId: record.meta.groupId ?? '', kbId: record.meta.kbId ?? '' },
        })),
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      }
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
      groupId: '',
      kbId: '',
    }
    return { currentId: meta.id, sessions: [{ meta, versions: [] }], groups: [] }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.store, null, 1), 'utf8')
  }

  /** 记录单独存一份：它是流水，别和卷子版本混在一个文件里 */
  private saveLogs(): void {
    mkdirSync(dirname(this.logFile), { recursive: true })
    writeFileSync(this.logFile, JSON.stringify(Object.fromEntries(this.logs), null, 1), 'utf8')
  }

  private loadLogs(): void {
    if (!existsSync(this.logFile)) return
    try {
      const parsed = JSON.parse(readFileSync(this.logFile, 'utf8')) as Record<string, SessionLogEntry[]>
      for (const [id, rows] of Object.entries(parsed)) {
        if (Array.isArray(rows)) this.logs.set(id, rows)
      }
      this.logCounter = [...this.logs.values()].reduce((sum, rows) => sum + rows.length, 0)
    } catch {
      /* 记录坏了就当没有：不能因为流水读不出来而打不开卷子 */
    }
  }
}

/**
 * 规整一份蓝图：空编号补上、道数与分值至少是 1，**卷头分数按题位算**。
 * "卷头 100 分、题位只有 20 分"这种自相矛盾，从入口就掐掉。
 *
 * **规整 ≠ 重写**：我们不认识的字段要原样留着。真实踩过——题位上的 `_evidence`
 * （这个题位依据哪些真题统计出来的、支持多少份卷）在一次界面保存后**全部消失**了，
 * 依据没了，蓝图就只剩一串数字。所以这里按 key 把原题位的"旁注"捡回来再拼。
 */
function normalizeBlueprint(before: Blueprint, patch: BlueprintPatch): Blueprint {
  const KNOWN = new Set(['key', 'knowledge', 'cognitive', 'type', 'count', 'difficulty', 'score'])
  const notesOf = (row: object): Record<string, unknown> =>
    Object.fromEntries(Object.entries(row).filter(([field]) => !KNOWN.has(field)))
  const priorByKey = new Map(before.blueprint.map((row) => [row.key, notesOf(row)]))
  // 原题位的旁注 + 这次补丁里带的旁注（补丁优先，比如直接改依据）
  const rows = (patch.blueprint ?? before.blueprint).map((row) =>
    Object.assign(Object.create(null) as Record<string, unknown>, priorByKey.get(row.key), notesOf(row), {
      key: row.key === '' ? nextKey(before.blueprint) : row.key,
      knowledge: row.knowledge,
      cognitive: row.cognitive,
      type: row.type,
      count: Math.max(1, Math.round(row.count)),
      difficulty: row.difficulty,
      score: Math.max(1, Math.round(row.score)),
    }),
  ) as unknown as BlueprintRow[]
  return {
    paper: { ...before.paper, ...patch.paper, totalScore: rows.reduce((sum, row) => sum + row.score * row.count, 0) },
    blueprint: rows,
    constraints: { ...before.constraints, ...patch.constraints },
  }
}

/** 蓝图文件名：别让名字里带路径分隔符 */
function safeName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60) || `蓝图-${String(Date.now())}`
}

/** 蓝图文件的修订号（内容哈希）：共享文件靠它发现"别人刚改过" */
function revisionOf(file: string): string {
  if (!existsSync(file)) return 'missing'
  return String(fnv1a(readFileSync(file, 'utf8')))
}

/**
 * 题位编号：从现有最大编号往后排（S3、S4……）。
 * 卷头分数由题位合计决定——**不允许**再出现"卷头 100 分、题位 20 分"。
 */
function nextKey(rows: readonly { key: string }[]): string {
  const numbers = rows
    .map((row) => /^S(\d+)/.exec(row.key)?.[1])
    .flatMap((value) => (value === undefined ? [] : [Number(value)]))
  return `S${String(Math.max(0, ...numbers) + 1)}`
}

/** 供界面显示的题位行（在 web 层组装，避免界面直接看 Item） */
export type { BlueprintRow }

export function apply(ctx: Context, config: SessionConfig): void {
  ctx.plugin(SessionService, config)
}
