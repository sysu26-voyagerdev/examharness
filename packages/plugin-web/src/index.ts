import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item, SessionMeta } from '@examharness/core'
import z from 'schemastery'

/**
 * HTTP + SSE。骨架阶段只做三件事：
 * - 把状态（蓝图 + 已入库题）暴露成一个只读接口；
 * - 把闸门的判定实时推给界面（item:stored / item:rejected）；
 * - 提供一个**手动出题**入口，用来验证「唯一写入口 = 闸门链」这条不变式。
 *   真实产品里这一步由 agent 触发，前端不直接写库。
 */

export const name = 'web'
export const inject = ['bank', 'graph', 'construct', 'paper', 'figure', 'workbench', 'session', 'llm']

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
  const blueprint = loadBlueprint(base)
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
  }
}

/** 导出为 HTML（Word 能直接打开；图内嵌，公式以原文呈现） */
export function renderPaperHtml(meta: SessionMeta, items: readonly Item[], figureOf: (item: Item) => string): string {
  const rows = items
    .map((item, index) => {
      const options = (item.prose.options ?? []).map((option) => `${option.key}. ${option.text}`).join('　　')
      const figure = figureOf(item)
      return [
        `<div class="q">`,
        `<div class="head"><b>${String(index + 1)}.</b>（${item.slot.type}，${String(item.slot.score)} 分）</div>`,
        `<div class="stem">${item.prose.stem}</div>`,
        options === '' ? '' : `<div class="opts">${options}</div>`,
        figure === '' ? '' : `<div class="fig">${figure}</div>`,
        `</div>`,
      ].join('\n')
    })
    .join('\n')

  const answers = items
    .map(
      (item, index) =>
        `<div class="a"><b>${String(index + 1)}.</b> ${item.prose.answerText}<ol>${item.prose.solution
          .map((step) => `<li>${step}</li>`)
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

function loadBlueprint(base: string): Blueprint {
  return JSON.parse(readFileSync(resolve(base, 'seed/blueprint.json'), 'utf8')) as Blueprint
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

export function apply(ctx: Context, config: WebConfig): void {
  const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
  const clients = new Set<ServerResponse>()
  const blueprint = loadBlueprint(base)
  /** 图由 spec 现渲染（骨架阶段不做文件缓存） */
  const summarize = (item: Item): Record<string, unknown> =>
    summarizeWith(item, ctx.figure.renderItem(item)?.svg ?? '')

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) client.write(payload)
  }

  ctx.on('item:stored', ({ item }) => broadcast('stored', summarize(item)))
  ctx.on('item:confirmed', ({ item, by }) => broadcast('confirmed', { ...summarize(item), by }))
  ctx.on('run:step', (payload) => broadcast('run:step', payload))
  ctx.on('item:rejected', ({ item, verdict }) => broadcast('rejected', { ...summarize(item), verdict }))

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

    if (method === 'POST' && path === '/api/run') {
      const body = (await readBody(req)) as { goal?: string }
      const run = await ctx.workbench.run({
        goal: body.goal ?? `按蓝图出一份《${blueprint.paper.title}》`,
        blueprint,
      })
      send(res, 200, run)
      return
    }

    // ── 会话与版本 ────────────────────────────────────────
    if (method === 'GET' && path === '/api/session') {
      send(res, 200, sessionView(ctx, base, summarize))
      return
    }

    if (method === 'GET' && path === '/api/sessions') {
      send(res, 200, { currentId: ctx.session.current().id, sessions: ctx.session.list() })
      return
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = (await readBody(req)) as Partial<SessionMeta>
      send(res, 200, ctx.session.create(body))
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
      const corpus = ctx.get('corpus')
      const websearch = ctx.get('websearch')
      send(res, 200, {
        model: { configured: ctx.llm.configured, name: ctx.llm.model },
        corpus: corpus === undefined ? { total: 0, distributable: 0 } : corpus.stats(),
        websearch: { enabled: websearch?.enabled === true },
        constructors: ctx.construct.kinds(),
        gates: ['verify-symbolic', 'verify-scope', 'verify-dedup', 'verify-figure', 'verify-roundtrip'],
      })
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
  return {
    id: item.id,
    slot: item.slot.key,
    knowledge: item.slot.knowledge,
    type: item.slot.type,
    score: item.slot.score,
    lifecycle: item.lifecycle,
    stem: item.prose.stem,
    answer: item.prose.answerText,
    figure: figureSvg,
    constructor: item.provenance.constructor,
    seed: item.provenance.seed,
    evidence: item.evidence,
  }
}
