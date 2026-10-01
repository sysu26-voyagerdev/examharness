import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Blueprint, BlueprintRow, Item } from '@examharness/core'
import z from 'schemastery'

/**
 * HTTP + SSE。骨架阶段只做三件事：
 * - 把状态（蓝图 + 已入库题）暴露成一个只读接口；
 * - 把闸门的判定实时推给界面（item:stored / item:rejected）；
 * - 提供一个**手动出题**入口，用来验证「唯一写入口 = 闸门链」这条不变式。
 *   真实产品里这一步由 agent 触发，前端不直接写库。
 */

export const name = 'web'
export const inject = ['bank', 'construct']

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

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) client.write(payload)
  }

  ctx.on('item:stored', ({ item }) => broadcast('stored', summarize(item)))
  ctx.on('item:rejected', ({ item, verdict }) => broadcast('rejected', { ...summarize(item), verdict }))

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const path = (req.url ?? '/').split('?')[0] ?? '/'

    if (method === 'GET' && path === '/') {
      const html = readFileSync(resolve(base, 'client/index.html'), 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if (method === 'GET' && path === '/api/state') {
      send(res, 200, { blueprint, items: ctx.bank.all().map(summarize) })
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

    send(res, 404, { error: 'not found' })
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
function summarize(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    slot: item.slot.key,
    knowledge: item.slot.knowledge,
    type: item.slot.type,
    score: item.slot.score,
    lifecycle: item.lifecycle,
    stem: item.prose.stem,
    answer: item.prose.answerText,
    constructor: item.provenance.constructor,
    seed: item.provenance.seed,
    evidence: item.evidence,
  }
}
