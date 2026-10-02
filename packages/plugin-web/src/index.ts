import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { renderMathInText, texToHtml, texToMathml } from '@examharness/core'
import type {
  Blueprint,
  BlueprintPatch,
  BlueprintRow,
  Item,
  SessionMeta,
  SettingsOp,
  WorkbenchRun,
} from '@examharness/core'
import z from 'schemastery'

/**
 * HTTP + SSE。骨架阶段只做三件事：
 * - 把状态（蓝图 + 已入库题）暴露成一个只读接口；
 * - 把闸门的判定实时推给界面（item:stored / item:rejected）；
 * - 提供一个**手动出题**入口，用来验证「唯一写入口 = 闸门链」这条不变式。
 *   真实产品里这一步由 agent 触发，前端不直接写库。
 */

export const name = 'web'
export const inject = [
  'bank',
  'graph',
  'construct',
  'paper',
  'figure',
  'workbench',
  'session',
  'llm',
  'settings',
  'kb',
  'corpus',
  'websearch',
  'workspace',
]

export const Config = z.object({
  port: z.number().default(8787),
})

export interface WebConfig {
  port: number
}

/** 客户端请求体（生成一道题） */
export interface GenerateRequest {
  slotKey: string
  seed: number
}

/** 会话视图：卷子页签要的东西一次给全（题位顺序、题、图、证据、签字、版本、diff） */
function sessionView(
  ctx: Context,
  base: string,
  summarize: (item: Item) => Record<string, unknown>,
): Record<string, unknown> {
  const meta = ctx.session.current()
  const latest = ctx.session.latest()
  const blueprint = sessionBlueprint(ctx)
  const slots = [...(latest?.bindings ?? [])]
    .toSorted((a, b) => a.slot.localeCompare(b.slot))
    .flatMap((binding) => {
      const item = ctx.bank.get(binding.itemId)
      if (item === undefined) return []
      const row = blueprint.blueprint.find((entry) => entry.key === binding.slot || binding.slot.startsWith(`${entry.key}-`))
      return [
        {
          ...summarize(item),
          slotKey: binding.slot,
          difficulty: item.slot.difficulty,
          confirmedBy: binding.confirmedBy,
          confirmedAt: binding.confirmedAt,
          knowledgeWanted: row?.knowledge ?? [],
        },
      ]
    })

  return {
    meta,
    blueprint,
    slots,
    // 每个版本都带完整绑定：界面要能"翻到 v1 看看当时是什么"（题都还在题库里）
    versions: ctx.session.versions().map((version) => ({
      version: version.version,
      at: version.at,
      reason: version.reason,
      totalScore: version.totalScore,
      scoreGap: version.scoreGap,
      gaps: version.gaps,
      attempts: version.attempts,
      bindings: version.bindings,
    })),
    diff: ctx.session.diff(),
    // 会话记录：老师说的、agent 做的、闸门判的，按时间排好（刷新页面不丢）
    log: ctx.session.log(),
  }
}

/** 导出为 HTML（Word 能直接打开；图内嵌，公式是 MathML——Word 与浏览器都认） */
export function renderPaperHtml(meta: SessionMeta, items: readonly Item[], figureOf: (item: Item) => string): string {
  const rows = items
    .map((item, index) => {
      const options = (item.prose.options ?? [])
        .map((option) => `${option.key}. ${renderMathInText(option.text)}`)
        .join('　　')
      const figure = figureOf(item)
      const stemTex = item.prose.tex?.stem
      return [
        `<div class="q">`,
        `<div class="head"><b>${String(index + 1)}.</b>（${item.slot.type}，${String(item.slot.score)} 分）</div>`,
        `<div class="stem">${renderMathInText(item.prose.stem)}</div>`,
        stemTex === undefined ? '' : `<div class="formula">${texToMathml(stemTex)}</div>`,
        options === '' ? '' : `<div class="opts">${options}</div>`,
        figure === '' ? '' : `<div class="fig">${figure}</div>`,
        `</div>`,
      ].join('\n')
    })
    .join('\n')

  const answers = items
    .map(
      (item, index) =>
        `<div class="a"><b>${String(index + 1)}.</b> ${renderMathInText(item.prose.answerText)}<ol>${item.prose.solution
          .map((step, stepIndex) => {
            const tex = item.prose.tex?.solution?.[stepIndex]
            return `<li>${renderMathInText(step)}${tex === undefined ? '' : `<div class="formula">${texToMathml(tex)}</div>`}</li>`
          })
          .join('')}</ol></div>`,
    )
    .join('\n')

  const total = items.reduce((sum, item) => sum + item.slot.score, 0)
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${meta.title}</title>
<style>
body{font:14px/1.9 "Songti SC","SimSun",serif;max-width:820px;margin:32px auto;padding:0 24px;color:#111}
h1{font-size:20px;text-align:center}
.meta{text-align:center;color:#666;font-size:12px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:16px}
.q{margin:14px 0}
.head b{font-weight:600}
.opts{margin-top:4px}
.fig{margin-top:6px}
hr{border:0;border-top:1px dashed #bbb;margin:24px 0}
.a{margin:10px 0}
.a ol{margin:4px 0 0 20px}
</style></head><body>
<h1>${meta.title}</h1>
<div class="meta">${meta.className}　${meta.progress}　满分 ${String(total)} 分</div>
${rows}
<hr>
<h1>参考答案与解析</h1>
${answers}
</body></html>`
}

/** 导出为 Markdown（图以 SVG 内联，便于进 Git 或再加工） */
export function renderPaperMarkdown(meta: SessionMeta, items: readonly Item[], figureOf: (item: Item) => string): string {
  const lines: string[] = [`# ${meta.title}`, '', `${meta.className}　${meta.progress}`, '']
  items.forEach((item, index) => {
    lines.push(`## ${String(index + 1)}. （${item.slot.type}，${String(item.slot.score)} 分）`, '', item.prose.stem, '')
    for (const option of item.prose.options ?? []) lines.push(`- ${option.key}. ${option.text}`)
    const figure = figureOf(item)
    if (figure !== '') lines.push('', figure)
    lines.push('')
  })
  lines.push('---', '', '## 参考答案与解析', '')
  items.forEach((item, index) => {
    lines.push(`**${String(index + 1)}.** ${item.prose.answerText}`, '')
    for (const step of item.prose.solution) lines.push(`- ${step}`)
    lines.push('')
  })
  return lines.join('\n')
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
}

/**
 * 现在该用哪份蓝图 = **会话绑定的那一份**。
 *
 * 踩过的坑：这里原来直接读 seed/blueprint.json（默认那份），于是老师改了题位、
 * 甚至换了整份蓝图，agent 和界面看到的还是默认那份——"改了题位它好像没看见"就是这么来的。
 */
function sessionBlueprint(ctx: Context): Blueprint {
  return ctx.session.blueprint()
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((settle, fail) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') return settle({})
      try {
        settle(JSON.parse(text))
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    req.on('error', fail)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

/**
 * 现状简报：**框架比模型更清楚现在的状况**，所以直接告诉它，别让它每轮用五到八次工具去查。
 * 只放事实（题位、缺口、资料、题库规模），不放建议——怎么干是它的活。
 */
function slotProgressOf(ctx: Context, blueprint: Blueprint): { key: string; knowledge: string; want: number; have: number }[] {
  const all = ctx.bank.all()
  return blueprint.blueprint.map((row) => {
    const have = all.filter((item) => item.slot.key === row.key || item.slot.key.startsWith(`${row.key}-`)).length
    return { key: row.key, knowledge: row.knowledge.join('、'), want: row.count, have }
  })
}

/** 把库里所有资料铺进工作区（会话没绑定某一批时的兜底） */
function seedAllKb(ctx: Context, workspaceName: string): number | undefined {
  const batches = ctx.kb.list()
  if (batches.length === 0) return undefined
  const paths = batches.flatMap((batch) => ctx.kb.sourcePaths(batch.id))
  if (paths.length === 0) return undefined
  return ctx.workspace.seedLinks(workspaceName, paths)
}

function briefOf(ctx: Context, blueprint: Blueprint): string {
  const progress = slotProgressOf(ctx, blueprint)
  const missing = progress.filter((slot) => slot.have < slot.want)
  const latest = ctx.session.latest()
  const batches = ctx.kb.list()
  const lines = [
    `卷子：${blueprint.paper.title}（${blueprint.paper.className}，卷头 ${String(blueprint.paper.totalScore)} 分 / ${String(blueprint.paper.minutes)} 分钟）`,
    `题位（需要 / 已有）：`,
    ...progress.map((slot) => `  · ${slot.key} ${slot.knowledge}：需 ${String(slot.want)}，已有 ${String(slot.have)}${slot.have >= slot.want ? '（齐）' : '（缺）'}`),
    missing.length === 0 ? '题位状态：已齐' : `题位状态：还缺 ${missing.map((slot) => `${slot.key}（缺 ${String(slot.want - slot.have)}）`).join('、')}`,
    `卷子版本：${latest === undefined ? '还没组过卷' : `最新第 ${String(latest.version)} 版、${String(latest.bindings.length)} 道题、${String(latest.totalScore)} 分`}`,
    `题库：${String(ctx.bank.all().length)} 道`,
    `本卷禁用：${blueprint.constraints.forbidKnowledge.join('、') || '无'}`,
    batches.length === 0
      ? '资料：还没有导入任何资料（没有可参考的真实题，查重只对自家题库）'
      : [
          `资料：${batches.map((batch) => `${batch.name}（${batch.status === 'indexed' ? `${String(batch.records)} 条` : '未整理'}，${String(batch.files.length)} 份文件）`).join('；')}`,
          '资料文件已经铺在工作区的 in/ 里（ws_ls 看清单）；PDF 多半是扫描件：',
          '先 doc_extract 整份读成文字（会自动 OCR，结果落在 out/extract/），再按需要 ws_grep / ws_read 取用。',
        ].join('\n'),
  ]
  return lines.join('\n')
}

/** 没给目标时的默认目标：把缺的题位补齐，然后组卷——这才是老师想要的默认结果 */
function defaultGoal(brief: string): string {
  const missing = /题位状态：还缺 ([^\n]+)/.exec(brief)?.[1]
  return missing === undefined
    ? '题位已经齐了：直接 assemble_paper 组卷，然后用一句话报告版本与题位。'
    : `把还缺的题位补齐（${missing}），然后 assemble_paper 组卷。`
}

/**
 * 把某个知识库批次的**原件副本**铺进工作区的 in/。
 * 原件本身不动手（它们是老师的资料）；工作区里的是副本，agent 随便折腾。
 * 返回铺了几个文件；没接知识库/工作区、或批次不存在时返回 undefined（诚实地说"没铺"）。
 */
function seedFromKb(ctx: Context, workspaceName: string, batchId: string): number | undefined {
  if (batchId === '') return undefined
  const batch = ctx.kb.list().find((entry) => entry.id === batchId)
  const dir = ctx.kb.dirOf(batchId)
  if (batch === undefined || dir === undefined) return undefined
  // 用链接而不是复制：导入的教材可能几十 GB
  return ctx.workspace.seedLinks(workspaceName, ctx.kb.sourcePaths(batchId))
}

export function apply(ctx: Context, config: WebConfig): void {
  const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
  const clients = new Set<ServerResponse>()
  const blueprint = sessionBlueprint(ctx)
  /** 图由 spec 现渲染（骨架阶段不做文件缓存） */
  const summarize = (item: Item): Record<string, unknown> =>
    summarizeWith(item, ctx.figure.renderItem(item)?.svg ?? '')

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) client.write(payload)
  }

  // 当前在跑的那一轮属于哪个工作区：判定类事件也要归到它名下
  let activeWorkspace = ''
  /** 记录一定有归属：没有正在跑的轮次，就归当前会话。**没有"两边都显示"这种中间态。** */
  const owner = (): string => (activeWorkspace === '' ? ctx.session.current().id : activeWorkspace)
  ctx.on('item:stored', ({ item }) => {
    ctx.session.appendLog({ kind: 'verdict', text: `入库：第 ${item.slot.key} 题`, workspace: owner() })
    broadcast('stored', summarize(item))
  })
  ctx.on('item:confirmed', ({ item, by }) => {
    ctx.session.appendLog({ kind: 'verdict', text: `${by} 确认了第 ${item.slot.key} 题`, workspace: owner() })
    broadcast('confirmed', { ...summarize(item), by })
  })
  ctx.on('run:started', ({ runId, goal, workspace, label }) => {
    activeWorkspace = workspace
    ctx.session.appendLog({ kind: 'user', text: label ?? goal, runId, workspace: workspace === '' ? owner() : workspace })
    broadcast('run:started', { runId, goal, workspace, ...(label === undefined ? {} : { label }) })
  })
  ctx.on('run:step', (payload) => {
    // 正文里的 `工具名：` 前缀拆出来单独存：界面用人话显示工具，正文不再重复一遍
    const match = /^([a-z][a-z0-9_]*)：([\s\S]*)$/.exec(payload.text)
    const tool = match?.[1] === undefined ? undefined : match[1]
    ctx.session.appendLog({
      kind: payload.kind === 'user' ? 'user' : payload.kind,
      text: tool === undefined ? payload.text : (match?.[2] ?? ''),
      runId: payload.runId,
      workspace: payload.workspace === '' ? owner() : payload.workspace,
      ...(tool === undefined || payload.kind !== 'tool' ? {} : { tool }),
    })
    broadcast('run:step', payload)
  })
  ctx.on('run:done', ({ workspace }) => {
    if (workspace === activeWorkspace) activeWorkspace = ''
  })
  ctx.on('run:done', (payload) => broadcast('run:done', payload))
  ctx.on('workspace:changed', (payload) => broadcast('workspace:changed', payload))
  ctx.on('kb:changed', (payload) => broadcast('kb:changed', payload))
  ctx.on('settings:changed', (payload) => broadcast('settings:changed', payload))
  ctx.on('item:rejected', ({ item, verdict }) => {
    // 判定联合类型：只有失败那一支带 gate/reason
    const why = verdict.pass ? '（判定说通过，但仍被拦下）' : `没通过「${verdict.gate}」：${verdict.reason}`
    ctx.session.appendLog({ kind: 'verdict', text: why })
    broadcast('rejected', { ...summarize(item), verdict })
  })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const path = (req.url ?? '/').split('?')[0] ?? '/'

    if (method === 'GET' && path === '/api/state') {
      send(res, 200, {
        blueprint,
        items: ctx.bank.all().map(summarize),
        knowledge: {
          nodes: ctx.graph.nodes().map((key) => ({ key, prerequisites: ctx.graph.prerequisites([key]) })),
          learned: ctx.graph.learnedKeys(),
        },
      })
      return
    }

    if (method === 'GET' && path === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      clients.add(res)
      res.on('close', () => clients.delete(res))
      return
    }

    if (method === 'POST' && path === '/api/generate') {
      const body = (await readBody(req)) as Partial<GenerateRequest>
      const slot: BlueprintRow | undefined = blueprint.blueprint.find((row) => row.key === body.slotKey)
      if (slot === undefined) {
        send(res, 400, { error: `蓝图里没有题位 ${String(body.slotKey)}` })
        return
      }
      const seed = typeof body.seed === 'number' ? body.seed : Math.floor(Math.random() * 1_000_000)
      let item: Item
      try {
        item = ctx.construct.generate(slot, seed)
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      // 唯一的入库路径：闸门链在 bank.submit 内部跑，这里绕不过去
      const result = await ctx.bank.submit(item)
      send(res, result.ok ? 200 : 422, result.ok ? { ok: true, id: result.id } : { ok: false, verdict: result.verdict })
      return
    }

    if (method === 'POST' && path === '/api/paper') {
      const paper = await ctx.paper.assemble(blueprint)
      send(res, 200, {
        totalScore: paper.totalScore,
        scoreGap: paper.scoreGap,
        attempts: paper.attempts,
        gaps: paper.gaps,
        slots: paper.order.flatMap((id) => {
          const item = ctx.bank.get(id)
          return item === undefined ? [] : [{ ...summarize(item), difficulty: item.slot.difficulty }]
        }),
      })
      return
    }

    // ── agent 循环：起一轮、看得见过程、能插话能叫停 ──────────
    if (method === 'GET' && path === '/api/runs') {
      send(res, 200, { active: ctx.workbench.active() })
      return
    }

    if (method === 'POST' && path === '/api/run') {
      const body = (await readBody(req)) as { goal?: string; brief?: boolean }
      // 主 agent 也在工作区里干活：会话若绑了知识库，就把那批原件铺进 in/（副本，原件不动）
      const meta = ctx.session.current()
      // 资料要**看得见**：优先用会话绑定的那批；没绑就把库里的资料都铺进来
      // （以前只在整理资料时才铺，结果主 agent 的工作区是空的，"我传的资料呢"就是这么来的）
      const seeded = seedFromKb(ctx, meta.id, meta.kbId) ?? seedAllKb(ctx, meta.id)
      try {
        const brief = briefOf(ctx, blueprint)
        const started = ctx.workbench.start({
          goal: body.goal ?? defaultGoal(brief),
          brief,
          blueprint,
          workspace: meta.id,
        })
        // HTTP 不等它跑完：立刻回 runId，过程走 SSE（界面看得见每一步）
        send(res, 202, {
          runId: started.runId,
          workspace: started.workspace,
          goal: body.goal ?? '',
          ...(seeded === undefined ? {} : { seeded }),
        })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/run/interject') {
      const body = (await readBody(req)) as { runId?: string; text?: string }
      const ok = ctx.workbench.interject(String(body.runId ?? ''), String(body.text ?? ''))
      send(res, ok ? 200 : 404, ok ? { ok } : { error: '这一轮已经不在跑了' })
      return
    }

    if (method === 'POST' && path === '/api/run/stop') {
      const body = (await readBody(req)) as { runId?: string }
      const ok = ctx.workbench.stop(String(body.runId ?? ''))
      send(res, ok ? 200 : 404, ok ? { ok } : { error: '这一轮已经不在跑了' })
      return
    }

    // ── 工作区：agent 留下了什么，老师要能复查 ──────────────
    if (method === 'GET' && path === '/api/workspace') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const wsName = url.searchParams.get('name') ?? ''
      const wsPath = ctx.workspace.dirOf(wsName)
      if (wsPath === undefined) {
        send(res, 400, { error: '工作区名字不合法' })
        return
      }
      send(res, 200, {
        name: wsName,
        path: wsPath,
        venv: ctx.workspace.venvPython() ?? null,
        files: ctx.workspace.list(wsName),
      })
      return
    }

    if (method === 'GET' && path === '/api/workspace/file') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const chunk = ctx.workspace.read(
        url.searchParams.get('name') ?? '',
        url.searchParams.get('file') ?? '',
        Number(url.searchParams.get('offset') ?? '0'),
        4000,
      )
      if (chunk === undefined) {
        send(res, 404, { error: '读不到这个文件（可能是二进制）' })
        return
      }
      send(res, 200, chunk)
      return
    }

    // ── 会话与版本 ────────────────────────────────────────
    if (method === 'GET' && path === '/api/session') {
      send(res, 200, sessionView(ctx, base, summarize))
      return
    }

    if (method === 'GET' && path === '/api/sessions') {
      send(res, 200, {
        currentId: ctx.session.current().id,
        sessions: ctx.session.list(),
        groups: ctx.session.groups(),
        defaults: ctx.settings.get().sessionDefaults,
      })
      return
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = (await readBody(req)) as Partial<SessionMeta>
      send(res, 200, ctx.session.create(body))
      return
    }

    // ── 蓝图库：老师手上是一套模板，不是一个蓝图 ──────────
    if (method === 'GET' && path === '/api/blueprints') {
      const source = ctx.session.blueprintSource()
      send(res, 200, { blueprints: ctx.session.blueprintList(), current: source.path, revision: source.revision })
      return
    }

    if (method === 'POST' && path === '/api/blueprints') {
      const body = (await readBody(req)) as { name?: string; blueprint?: Blueprint }
      if (body.blueprint === undefined) {
        send(res, 400, { error: '没有蓝图内容' })
        return
      }
      try {
        send(res, 200, ctx.session.blueprintCreate(String(body.name ?? ''), body.blueprint, 'teacher'))
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'PATCH' && path === '/api/blueprints') {
      const body = (await readBody(req)) as { name?: string; patch?: BlueprintPatch; expectedRevision?: string }
      if (body.patch === undefined) {
        send(res, 400, { error: '没有要改的内容' })
        return
      }
      try {
        send(res, 200, {
          blueprint: ctx.session.blueprintUpdate(String(body.name ?? ''), body.patch, body.expectedRevision),
        })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/blueprints/use') {
      const body = (await readBody(req)) as { name?: string }
      try {
        send(res, 200, ctx.session.blueprintUse(String(body.name ?? '')))
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    // ── 当前会话的蓝图：题位是老师下发的，必须能看能改 ──────
    if (method === 'GET' && path === '/api/session/blueprint') {
      const source = ctx.session.blueprintSource()
      send(res, 200, { blueprint: ctx.session.blueprint(), path: source.path, revision: source.revision })
      return
    }

    if (method === 'PATCH' && path === '/api/session/blueprint') {
      const body = (await readBody(req)) as BlueprintPatch & { expectedRevision?: string }
      try {
        const next = ctx.session.updateBlueprint(body, body.expectedRevision)
        const source = ctx.session.blueprintSource()
        send(res, 200, { blueprint: next, path: source.path, revision: source.revision })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/session/switch') {
      const body = (await readBody(req)) as { id?: string }
      try {
        send(res, 200, ctx.session.switch(String(body.id ?? '')))
      } catch (error) {
        send(res, 404, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'PATCH' && path === '/api/session') {
      const body = (await readBody(req)) as Partial<SessionMeta>
      try {
        send(res, 200, ctx.session.update(body))
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/session/regenerate') {
      const body = (await readBody(req)) as { slotKey?: string; seed?: number }
      const result = await ctx.session.regenerate(
        String(body.slotKey ?? ''),
        typeof body.seed === 'number' ? body.seed : undefined,
      )
      send(res, result.ok ? 200 : 409, result)
      return
    }

    if (method === 'POST' && path === '/api/session/confirm') {
      const body = (await readBody(req)) as { itemId?: string; by?: string }
      const binding = ctx.session.confirm(String(body.itemId ?? ''), body.by ?? '老师')
      if (binding === undefined) {
        send(res, 404, { error: '没有这道题' })
        return
      }
      send(res, 200, binding)
      return
    }

    if (method === 'POST' && path === '/api/session/freeze') {
      send(res, 200, { frozen: true, version: ctx.session.freeze()?.version ?? null })
      return
    }

    if (method === 'POST' && path === '/api/session/assemble') {
      const body = (await readBody(req)) as { reason?: string }
      try {
        send(res, 200, await ctx.session.assemble(body.reason ?? '组卷'))
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'GET' && path === '/api/settings') {
      const stats = ctx.corpus.stats()
      const app = ctx.settings.get()
      const keyRef = app.model.apiKeyEnv
      send(res, 200, {
        // **脱敏**：密钥字段不进响应，只回"配没配 + 从哪来"（ADR-0022）
        app: { ...app, model: { ...app.model, apiKey: ctx.settings.credentials.describe(keyRef) } },
        revision: ctx.settings.revision(),
        runtime: {
          modelConfigured: ctx.llm.configured,
          modelName: ctx.llm.model,
          modelSource: ctx.llm.source,
          corpusTotal: stats.total,
          corpusDistributable: stats.distributable,
          corpusBySource: stats.bySource,
          websearchEnabled: ctx.websearch.enabled,
          restartRequired: ctx.settings.restartRequired(),
          constructors: ctx.construct.kinds(),
          gates: ['verify-symbolic', 'verify-scope', 'verify-dedup', 'verify-figure', 'verify-roundtrip'],
        },
      })
      return
    }

    if (method === 'PATCH' && path === '/api/settings') {
      const body = (await readBody(req)) as { ops?: SettingsOp[]; expectedRevision?: number }
      const ops = Array.isArray(body.ops) ? body.ops : []
      if (ops.length === 0) {
        send(res, 400, { error: '没有要改的字段（要按路径给 ops：{path, value}）' })
        return
      }
      try {
        ctx.settings.mutate(ops, typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined)
      } catch (error) {
        const conflict = error instanceof Error && error.name === 'SettingsConflict'
        send(res, conflict ? 409 : 400, {
          error: error instanceof Error ? error.message : String(error),
          ...(conflict ? { code: 'SETTINGS_CONFLICT' } : {}),
        })
        return
      }
      const updated = ctx.settings.get()
      send(res, 200, {
        app: { ...updated, model: { ...updated.model, apiKey: ctx.settings.credentials.describe(updated.model.apiKeyEnv) } },
        revision: ctx.settings.revision(),
      })
      return
    }

    // 密钥：**只写不读**（写进去之后只会拿到"已配置/未配置"）
    if (method === 'POST' && path === '/api/settings/credential') {
      const body = (await readBody(req)) as { ref?: string; value?: string; unset?: boolean }
      const ref = String(body.ref ?? ctx.settings.get().model.apiKeyEnv)
      try {
        const info =
          body.unset === true ? ctx.settings.credentials.unset(ref) : ctx.settings.credentials.set(ref, String(body.value ?? ''))
        send(res, 200, info)
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    // 拉可用模型列表（照 DSH：GET {baseURL}/models，结果不落盘）。密钥可以一次性带在请求里"先试后存"。
    if (method === 'POST' && path === '/api/settings/models') {
      const body = (await readBody(req)) as { baseUrl?: string; apiKey?: string }
      const live = ctx.settings.get().model
      const baseUrl = (body.baseUrl ?? live.baseUrl).replace(/\/+$/, '')
      const key = body.apiKey ?? ctx.settings.credentials.get(live.apiKeyEnv)
      if (baseUrl === '') {
        send(res, 400, { error: '先填 API 地址（例如 https://api.deepseek.com/v1）' })
        return
      }
      try {
        const response = await fetch(`${baseUrl}/models`, {
          headers: { accept: 'application/json', ...(key === '' ? {} : { authorization: `Bearer ${key}` }) },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) {
          send(res, 502, { error: `${String(response.status)} ${response.statusText}（检查地址与密钥）` })
          return
        }
        const text = await response.text()
        if (text.length > 4_194_304) {
          send(res, 502, { error: '模型列表太大（>4 MiB），不像正常的 /models 响应' })
          return
        }
        const parsed = JSON.parse(text) as { data?: { id?: unknown; name?: unknown }[] }
        const models = (parsed.data ?? [])
          .flatMap((entry) => (typeof entry.id === 'string' && entry.id !== '' ? [{ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id }] : []))
          .toSorted((a, b) => a.id.localeCompare(b.id))
        send(res, 200, { models, source: body.apiKey === undefined ? ctx.settings.credentials.describe(live.apiKeyEnv).source : 'one-shot' })
      } catch (error) {
        send(res, 502, { error: `拉取失败：${error instanceof Error ? error.message : String(error)}` })
      }
      return
    }

    // ── 知识库：上传的是原料，整理交给 agent ──────────────
    if (method === 'GET' && path === '/api/kb') {
      send(res, 200, { batches: ctx.kb.list(), corpusTotal: ctx.corpus.size })
      return
    }

    // 从本机文件夹导入：教材/课标这类大资料原地不动，整理时用链接铺进工作区
    if (method === 'POST' && path === '/api/kb/import') {
      const body = (await readBody(req)) as { name?: string; dir?: string }
      try {
        const batch = ctx.kb.importDir(body.name ?? '', String(body.dir ?? ''))
        ctx.workspace.seedLinks(batch.id, ctx.kb.sourcePaths(batch.id))
        send(res, 200, batch)
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/kb/upload') {
      const body = (await readBody(req)) as {
        name?: string
        files?: { name?: string; text?: string; base64?: string }[]
      }
      const files: { name: string; text?: string; base64?: string }[] = (body.files ?? []).flatMap((file) => {
        if (typeof file.name !== 'string') return []
        // 文本给 text，二进制给 base64（PDF / Word / 图片按原样存，整理时再解析）
        if (typeof file.text === 'string') return [{ name: file.name, text: file.text }] as { name: string; text?: string; base64?: string }[]
        if (typeof file.base64 === 'string') return [{ name: file.name, base64: file.base64 }] as { name: string; text?: string; base64?: string }[]
        return [] as { name: string; text?: string; base64?: string }[]
      })
      if (files.length === 0) {
        send(res, 400, { error: '没有可用的文件：文本给 text，PDF/图片给 base64' })
        return
      }
      send(res, 200, ctx.kb.upload(body.name ?? '', files))
      return
    }

    if (method === 'GET' && path === '/api/kb/preview') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const chunk = ctx.kb.read(
        url.searchParams.get('batchId') ?? '',
        url.searchParams.get('file') ?? '',
        Number(url.searchParams.get('offset') ?? '0'),
        2000,
      )
      if (chunk === undefined) {
        send(res, 404, { error: '没有这个文件' })
        return
      }
      send(res, 200, chunk)
      return
    }

    if (method === 'POST' && path === '/api/kb/ingest') {
      const body = (await readBody(req)) as { batchId?: string }
      const batch = ctx.kb.list().find((entry) => entry.id === String(body.batchId ?? ''))
      if (batch === undefined) {
        send(res, 404, { error: '没有这个知识库' })
        return
      }

      // 原件副本铺进工作区：agent 可以拿 python / pdftotext 把 PDF、表格、扫描件转成文本再说
      const seeded = seedFromKb(ctx, batch.id, batch.id)
      const files = batch.files.map((file) => file.name).join('、')
      let started: { runId: string; workspace: string; done: Promise<WorkbenchRun> }
      try {
        started = ctx.workbench.start({
          goal: [
            `把知识库「${batch.name}」整理成可检索的语料（批次 ${batch.id}）。`,
            `文件：${files}`,
            '',
            `工作区：${batch.id}（资料在 in/，脚本写 tmp/，产物放 out/）`,
            '**先判断这批是什么**，再决定抽什么：真题/试卷 → 抽题目；课标/教材/教参 → 抽示例题与知识点要求；',
            '读不懂或整批都是糊页 → 如实说，别硬凑。',
            '',
            '标准做法（成套资料尤其这样，别一页页翻）：',
            '1) doc_build {"paths":["in/xx.pdf", ...]} —— **整份**读成结构化数据：扫描件会自动 OCR，',
            '   产出 out/curriculum/ 下的全书文本与 JSONL（示例题、内容要求），并报告每本多少页、抽到多少条。',
            '   这一步可能要几分钟，正常。',
            '2) 看产出：ws_read 分片读 JSONL、ws_grep 找特定段落（文本里有「（第 N 页）」标记）。',
            '3) 要入库的用 kb_write **一次写多条**（records 数组），别一条一条写。',
            '4) **自检**：随机挑几条（≥3）回原文核对（ws_grep 搜题干片段），把"核对了几条、对没对上"写进结论。',
            '5) kb_mark 标状态 + 一句话交代：读了几本、抽了多少条、哪些没处理成。',
            '',
            '要跑的东西先落成脚本文件再 ws_run（不许内联代码）；写脚本是本事，',
            '但成套资料的 OCR 与切分先用 doc_build——分页与页码定位它已经处理好了。',
          ].join('\n'),
          brief: briefOf(ctx, sessionBlueprint(ctx)),
          blueprint: sessionBlueprint(ctx),
          workspace: batch.id,
          label: `整理「${batch.name}」（${String(batch.files.length)} 份资料）`,
        })
      } catch (error) {
        // 起轮被拒（比如已经有 agent 在跑）时**不能**把批次留在"整理中"：
        // 以前是先标 ingesting 再起轮，被拒之后那一批就永远卡住了
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      // 真正跑起来了，才标"整理中"
      ctx.kb.mark(batch.id, 'ingesting', '正在整理')
      // 异步收尾：跑完再落状态。只有 agent 自己跑完（done）才算整理完成；
      // 步数用尽 / 没有模型 / 被叫停都如实标成未完成，并写清为什么。
      void started.done
        .then((run) => {
          const done = run.stopped === 'done'
          ctx.kb.mark(
            batch.id,
            done ? 'indexed' : 'failed',
            done
              ? `agent 整理完成：${String(run.steps)} 步`
              : run.stopped === 'no-llm'
                ? '模型未配置，无法整理'
                : `已按停：跑了 ${String(run.steps)} 步，抽到的记录都保留着`,
          )
        })
        .catch((error: unknown) => {
          ctx.kb.mark(batch.id, 'failed', `整理出错：${error instanceof Error ? error.message : String(error)}`)
        })
      send(res, 202, { runId: started.runId, workspace: started.workspace, batch, seeded })
      return
    }

    // ── 会话分组 ────────────────────────────────────────
    if (method === 'POST' && path === '/api/groups') {
      const body = (await readBody(req)) as { name?: string }
      send(res, 200, ctx.session.createGroup(body.name ?? ''))
      return
    }

    if (method === 'PATCH' && path === '/api/groups') {
      const body = (await readBody(req)) as { id?: string; name?: string }
      const group = ctx.session.renameGroup(String(body.id ?? ''), body.name ?? '')
      send(res, group === undefined ? 404 : 200, group ?? { error: '没有这个分组' })
      return
    }

    if (method === 'POST' && path === '/api/session/group') {
      const body = (await readBody(req)) as { sessionId?: string; groupId?: string }
      const meta = ctx.session.moveToGroup(String(body.sessionId ?? ''), body.groupId ?? '')
      send(res, meta === undefined ? 404 : 200, meta ?? { error: '没有这个会话' })
      return
    }

    if (method === 'GET' && path === '/api/export') {
      const meta = ctx.session.current()
      const latest = ctx.session.latest()
      const items = [...(latest?.bindings ?? [])]
        .toSorted((a, b) => a.slot.localeCompare(b.slot))
        .flatMap((binding) => {
          const item = ctx.bank.get(binding.itemId)
          return item === undefined ? [] : [item]
        })
      const figureOf = (item: Item): string => ctx.figure.renderItem(item)?.svg ?? ''
      const markdown = (req.url ?? '').includes('format=md')
      const body = markdown ? renderPaperMarkdown(meta, items, figureOf) : renderPaperHtml(meta, items, figureOf)
      res.writeHead(200, {
        'content-type': markdown ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.title)}.${markdown ? 'md' : 'html'}`,
      })
      res.end(body)
      return
    }

    if (method === 'GET' && !path.startsWith('/api/')) {
      serveClient(path, res)
      return
    }

    send(res, 404, { error: 'not found' })
  }

  /** 托管构建好的前端；没构建就明确说清楚该跑什么命令，而不是给个白屏 */
  const serveClient = (path: string, res: ServerResponse): void => {
    const dist = resolve(base, 'client/dist')
    const file = resolve(dist, path === '/' ? 'index.html' : path.replace(/^\//, ''))
    if (!file.startsWith(dist)) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (existsSync(file) && extname(file) !== '') {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(readFileSync(file))
      return
    }
    const fallback = resolve(dist, 'index.html')
    if (existsSync(fallback)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(readFileSync(fallback))
      return
    }
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('前端还没构建：先跑 pnpm --filter @examharness/client build')
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })

  server.listen(config.port, () => {
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : config.port
    console.log(`命题组已启动：http://0.0.0.0:${port}  （构造器：${ctx.construct.kinds().join(', ')}）`)
  })

  ctx.effect(
    () => () => {
      for (const client of clients) client.end()
      server.close()
      clients.clear()
    },
    'plugin-web: http server',
  )
}

/** 推给界面的最小投影：不要整个 Item 糊过去 */
function summarizeWith(item: Item, figureSvg: string): Record<string, unknown> {
  const tex = item.prose.tex
  return {
    id: item.id,
    slot: item.slot.key,
    knowledge: item.slot.knowledge,
    type: item.slot.type,
    score: item.slot.score,
    lifecycle: item.lifecycle,
    stem: item.prose.stem,
    answer: item.prose.answerText,
    // 正文里的 $...$ 与构造给的 LaTeX 都在服务端渲染成 MathML：界面不引数学库
    stemHtml: renderMathInText(item.prose.stem, 'html'),
    answerHtml: renderMathInText(item.prose.answerText, 'html'),
    solutionHtml: item.prose.solution.map((step) => renderMathInText(step, 'html')),
    ...(tex === undefined
      ? {}
      : {
          tex: {
            ...(tex.stem === undefined ? {} : { stem: tex.stem, stemMath: texToHtml(tex.stem) }),
            ...(tex.answer === undefined ? {} : { answer: tex.answer, answerMath: texToHtml(tex.answer) }),
            solution: (tex.solution ?? []).map((part) => ({ tex: part, math: texToHtml(part) })),
          },
        }),
    figure: figureSvg,
    constructor: item.provenance.constructor,
    seed: item.provenance.seed,
    evidence: item.evidence,
  }
}
