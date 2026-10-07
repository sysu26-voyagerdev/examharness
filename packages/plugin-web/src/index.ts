import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPaperDocx } from './docx.js'
import type { Context } from '@deepseek-ai/cordis'
import { normalize, numberSlots, optionDisplayText, renderMathInText, signedByAll } from '@examharness/core'
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
        .map((option) => `${option.key}. ${renderMathInText(optionDisplayText(option.text), 'mathml')}`)
        .join('  ')
      const figure = figureOf(item)
      // 题面里本来就用 $…$ 写着数学：直接渲染成**行内 MathML**（Word 与浏览器都认），
      // 不再在题面下面单独摆一块公式——那是重复，看着也乱（用户："这个部分意义不大"）。
      return [
        `<div class="q">`,
        `<div class="head"><b>${String(index + 1)}.</b>（${item.slot.type}，${String(item.slot.score)} 分）</div>`,
        `<div class="stem">${renderMathInText(item.prose.stem, 'mathml')}</div>`,
        options === '' ? '' : `<div class="opts">${options}</div>`,
        figure === '' ? '' : `<div class="fig">${figure}</div>`,
        `</div>`,
      ].join('\n')
    })
    .join('\n')

  const answers = items
    .map(
      (item, index) =>
        `<div class="a"><b>${String(index + 1)}.</b> ${renderMathInText(item.prose.answerText, 'mathml')}<ol>${item.prose.solution
          .map((step) => `<li>${renderMathInText(step, 'mathml')}</li>`)
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
<div class="meta">${meta.className} ${meta.progress} 满分 ${String(total)} 分</div>
${rows}
<hr>
<h1>参考答案与解析</h1>
${answers}
</body></html>`
}

/** 导出为 Markdown（图以 SVG 内联，便于进 Git 或再加工） */
export function renderPaperMarkdown(meta: SessionMeta, items: readonly Item[], figureOf: (item: Item) => string): string {
  const lines: string[] = [`# ${meta.title}`, '', `${meta.className} ${meta.progress}`, '']
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
 *
 * **"齐不齐"只认一件事：这个题位出不出得来。** 以前这里数的是题库里落在这个题位上的题，
 * 于是出现过"简报说题位已齐、一 assemble 却缺 S23"的自相矛盾——题库里有题不等于还能再出一道
 * （组卷是**按构造器现造**，不是从题库里挑）。所以这里按组卷的方式**试造一道**：
 * 造不出来就是出不了，并且把构造器给的原话带上——它就是 agent 要改的东西。
 */
function slotProgressOf(ctx: Context, blueprint: Blueprint): { key: string; knowledge: string; want: number; canBuild: boolean; reason: string }[] {
  return blueprint.blueprint.map((row) => {
    const key = `${row.key}-1`
    try {
      ctx.construct.generate({ ...row, key, count: 1 }, 1)
      return { key: row.key, knowledge: row.knowledge.join('、'), want: row.count, canBuild: true, reason: '' }
    } catch (error) {
      return {
        key: row.key,
        knowledge: row.knowledge.join('、'),
        want: row.count,
        canBuild: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
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
  const latest = ctx.session.latest()
  const batches = ctx.kb.list()
  // 缺口只认**上次组卷报出来的**：那是唯一"真的试着出了卷"的地方（带闸门给的原因）。
  // 蓝图改过之后它就不算数了——那时如实说"重新组一次才知道"。
  const expectedKeys = new Set(blueprint.blueprint.map((row) => row.key))
  const assembledKeys = new Set((latest?.bindings ?? []).map((binding) => binding.slot.replace(/-\d+$/, '')))
  const stale = latest !== undefined && [...expectedKeys].some((key) => !assembledKeys.has(key) && !(latest.gaps ?? []).some((gap) => gap.slot.startsWith(key)))
  const gaps = stale ? [] : (latest?.gaps ?? [])
  // **卷面上现在是什么**：agent 要能一眼看到"哪个题位上摆着哪道题"。
  // 没有这一段，它只能看到题位清单，于是它做的事永远停在"往库里加题"——
  // 而老师要的是卷子上那一道变了（这是这套东西最容易走偏的地方）。
  const onPaper = (latest?.bindings ?? []).map((binding) => {
    const item = ctx.bank.get(binding.itemId)
    const stem = item === undefined ? '（题已不在库里）' : item.prose.stem.replace(/\s+/g, ' ').slice(0, 28)
    const kind = item === undefined ? '' : item.instance.kind
    return `  · ${binding.slot}${binding.confirmedBy === null ? '' : `【${binding.confirmedBy}已签，钉住】`} ← ${binding.itemId}（${kind}）：${stem}…`
  })
  const lines = [
    `卷子：${blueprint.paper.title}（${blueprint.paper.className}，卷头 ${String(blueprint.paper.totalScore)} 分 / ${String(blueprint.paper.minutes)} 分钟）`,
    '**产物是这张卷子**：老师看的是卷子。题库只是留档（做过的题堆在那儿，过程不是成果）——',
    'submit_item 只是留档，卷子不会变；要让卷子上某一题变成新出的那道，用 place_item <题位> <候选题>（或 assemble_paper 整卷重出）。',
    `题位（需要 / 有没有构造器）：`,
    ...progress.map(
      (slot) =>
        `  · ${slot.key} ${slot.knowledge}：需 ${String(slot.want)}，${slot.canBuild ? '有构造器' : `**没有构造器**（${slot.reason}）`}`,
    ),
    latest === undefined
      ? '题位状态：还没组过卷，先 assemble_paper 才知道缺什么。'
      : stale
        ? `题位状态：蓝图改过了（上次组卷第 ${String(latest.version)} 版对不上现在这份），先 assemble_paper 重新组一次。`
        : gaps.length === 0
          ? `题位状态：已齐（第 ${String(latest.version)} 版、${String(latest.bindings.length)} 道题、${String(latest.totalScore)} 分）`
          : [
              `题位状态：还缺 ${gaps.map((gap) => gap.slot.replace(/-\d+$/, '')).join('、')}`,
              `上次组卷（第 ${String(latest.version)} 版、${String(latest.bindings.length)} 道题、${String(latest.totalScore)} 分）报出的缺口：`,
              ...gaps.map((gap) => `  · ${gap.slot}（缺 ${String(gap.missing)}）：${gap.reason}`),
            ].join('\n'),
    onPaper.length === 0
      ? '卷面现状：还没有卷子（先 assemble_paper 组一次）'
      : ['卷面现状：', ...onPaper].join('\n'),
    `题库（留档）：${String(ctx.bank.all().length)} 道`,
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

/**
 * 卷面上的图是 SVG，Word 里要 PNG——所以导出时把图**光栅化**一遍。
 *
 * 用系统里的矢量转换器（rsvg-convert / inkscape / ImageMagick，有哪个用哪个）；
 * 一个都没有就返回空表：docx 里会如实写一行"本题原带图，请看打印版或 PDF 版"，
 * 而不是悄悄少一张图让老师到考场上才发现。
 */
function rasterizeFigures(
  items: readonly Item[],
  figureOf: (item: Item) => string,
): ReadonlyMap<string, { png: Buffer; width: number; height: number }> {
  const out = new Map<string, { png: Buffer; width: number; height: number }>()
  if (process.platform === 'win32') return out
  const tools: readonly { command: string; args: (file: string) => string[] }[] = [
    { command: 'rsvg-convert', args: (file) => ['-w', '960', '-f', 'png', '-o', '/dev/stdout', file] },
    { command: 'inkscape', args: (file) => [file, '--export-type=png', '--export-filename=/dev/stdout', '-w', '960'] },
    { command: 'convert', args: (file) => ['-density', '144', `${file}`, 'png:-'] },
  ]
  const available = tools.find((tool) => spawnSync('which', [tool.command]).status === 0)
  if (available === undefined) return out
  for (const item of items) {
    const svg = figureOf(item)
    if (svg === '') continue
    const temp = resolve(tmpdir(), `examharness-fig-${item.id.replace(/[^\w-]/gu, '_')}.svg`)
    try {
      writeFileSync(temp, svg, 'utf8')
      const result = spawnSync(available.command, available.args(temp), { maxBuffer: 32 * 1024 * 1024 })
      if (result.status === 0 && result.stdout.length > 0) {
        const size = /width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/u.exec(svg)
        out.set(item.id, {
          png: result.stdout,
          width: Number(size?.[1] ?? 480),
          height: Number(size?.[2] ?? 300),
        })
      }
    } catch {
      /* 这一张转不了就算了：docx 里会写"请看打印版" */
    } finally {
      rmSync(temp, { force: true })
    }
  }
  return out
}

/**
 * 让模型给这次出题起个卷名（6–12 字，像老师会写在卷头上的名字）。
 *
 * 为什么值得多花一次小调用：会话列表是老师认路的唯一线索，
 * "未命名会话 3" 这种名字等于没有名字。起名只用一句话，失败就算了（不影响出题）。
 */
async function nameThisSession(
  ctx: Context,
  sessionId: string,
  goal: string,
  blueprint: Blueprint,
): Promise<void> {
  if (!ctx.llm.configured) return
  const reply = await ctx.llm.chat([
    {
      role: 'system',
      content:
        '给这次出题起一个卷名：6–12 个汉字，像老师会写在卷子最上面的名字（例：二次函数最值·课后作业、圆与相似·单元测验）。' +
        '只输出这个名字本身，不要引号、不要标点结尾、不要解释。',
    },
    { role: 'user', content: `老师的要求：${goal}\n范围：${blueprint.paper.title}\n班级：${blueprint.paper.className}` },
  ])
  const suggested = (reply.content ?? '')
    .trim()
    .split('\n')[0]
    ?.replace(/^["'「『]|["'」』]$/gu, '')
    .trim()
  // 老师可能已经切到别的卷子了：只改"还是这一张"的时候
  if (suggested === undefined || suggested === '' || suggested.length > 24) return
  if (ctx.session.current().id !== sessionId) return
  ctx.session.update({ title: suggested })
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

/**
 * 读设置改动（ops）。
 *
 * `path` 收两种写法：`["model","model"]`（界面用的）与 `"model.model"`（人和 agent 手写更顺手）。
 * **别的形状当场报错**，不许默默写下去——真实事故：有人按"点号字符串"送来，
 * 而底层把 path 当**数组**用，于是 `"model.model"` 被逐字符拆成
 * `{m:{o:{d:{e:{l:{".":{...}}}}}}}`，设置文件被写进一份谁都不认识的覆盖层，
 * 而模型**没换**（界面照旧显示旧模型，看着像"改了没反应"）。
 */
export function settingsOps(raw: unknown): SettingsOp[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new Error('ops 必须是数组')
  return raw.map((entry) => {
    const op = (entry ?? {}) as { path?: unknown; value?: unknown; unset?: unknown }
    const path =
      typeof op.path === 'string'
        ? op.path.split('.').filter((part) => part !== '')
        : Array.isArray(op.path) && op.path.every((part) => typeof part === 'string')
          ? (op.path as string[])
          : undefined
    if (path === undefined || path.length === 0) {
      throw new Error(`op.path 只能是 ["model","model"] 或 "model.model" 这样的路径，收到的是 ${JSON.stringify(op.path)}`)
    }
    return { path, ...(op.unset === true ? { unset: true as const } : { value: op.value }) }
  })
}

export function apply(ctx: Context, config: WebConfig): void {
  const base = ctx.baseUrl === undefined ? process.cwd() : fileURLToPath(ctx.baseUrl)
  const clients = new Set<ServerResponse>()
  const blueprint = sessionBlueprint(ctx)
  /** 图由 spec 现渲染（骨架阶段不做文件缓存） */
  /**
   * 「第 N 题」的编号表：按卷面上现在这一版的题与题型算（与 agent 用的是同一个函数）。
   * 服务端算一次，界面直接用——编号只有一套，老师说的和 agent 说的才是同一个东西。
   */
  const numbersNow = (): ReadonlyMap<string, number> => {
    const latest = ctx.session.latest()
    if (latest === undefined) return new Map()
    const entries = latest.bindings.flatMap((binding) => {
      const item = ctx.bank.get(binding.itemId)
      return item === undefined ? [] : [{ slot: binding.slot, type: item.slot.type }]
    })
    return numberSlots(entries)
  }
  const summarize = (item: Item): Record<string, unknown> =>
    summarizeWith(
      item,
      ctx.figure.renderItem(item)?.svg ?? '',
      numbersNow().get(item.slot.key),
      !signedByAll(item, ctx.bank.gates?.() ?? []),
    )

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of clients) client.write(payload)
  }

  // 当前在跑的那一轮属于哪个工作区：判定类事件也要归到它名下
  let activeWorkspace = ''
  /** 记录一定有归属：没有正在跑的轮次，就归当前会话。**没有"两边都显示"这种中间态。** */
  const owner = (): string => (activeWorkspace === '' ? ctx.session.current().id : activeWorkspace)
  /**
   * 这次判定发生在**哪一轮**里。
   *
   * 判定行以前只记工作区、不记轮次，界面上按轮分块时它就无家可归——
   * 全都会掉进"这一版做了什么"那个兜底块：一轮里"哪道题被拦下了"和几十条别的事混在一起。
   * 取**最后派出去的那个**（子任务与主线共用一条时间线，正在干活的通常是最新的那个）。
   */
  const activeRunId = (): string | undefined => {
    const here = owner()
    return ctx.workbench
      .active()
      .toReversed()
      .find((run) => run.workspace === here)?.id
  }
  ctx.on('item:stored', ({ item }) => {
    const runId = activeRunId()
    ctx.session.appendLog({
      kind: 'verdict',
      // 不写系统题名（S3-1 这种是内部编号，老师认的是卷面上的"第 N 题"）
      text: `收下一道新题（${item.slot.knowledge.join('、') || item.slot.type}｜${item.slot.type} ${String(item.slot.score)} 分）`,
      workspace: owner(),
      ...(runId === undefined ? {} : { runId }),
    })
    broadcast('stored', summarize(item))
  })
  ctx.on('item:confirmed', ({ item, by }) => {
    // 老师签字是**他自己**做的事，不挂到哪一轮上（挂上去就成了"agent 干的"）
    ctx.session.appendLog({ kind: 'verdict', text: `${by} 确认了第 ${item.slot.key} 题`, workspace: owner() })
    broadcast('confirmed', { ...summarize(item), by })
  })
  ctx.on('run:started', ({ runId, goal, workspace, label, parent }) => {
    activeWorkspace = workspace
    ctx.session.appendLog({
      kind: 'user',
      text: label ?? goal,
      runId,
      workspace: workspace === '' ? owner() : workspace,
      ...(parent === undefined ? {} : { parent }),
    })
    // `parent` 必须跟着一起推：少这一个字段，界面就把子任务当成"老师起的新一轮"
    // （状态行、按停、实时区都会认错人）
    broadcast('run:started', {
      runId,
      goal,
      workspace,
      ...(label === undefined ? {} : { label }),
      ...(parent === undefined ? {} : { parent }),
    })
  })
  /** 模型正在写什么：只推给界面实时显示，**不进记录**（记录只认走完的那一步） */
  ctx.on('llm:delta', ({ runId, label, kind, text, workspace }) => {
    // kind（它在想 / 它在写 / 它在准备哪一步）原样转发：少了它，界面只能把"想"也标成"写"——
    // 而"想"是英文的、还比正文长，标错了老师会以为题面就长那样
    broadcast('delta', { runId, label, kind, text, workspace: workspace === '' ? owner() : workspace })
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
      ...(payload.agent === undefined ? {} : { agent: payload.agent }),
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
    const runId = activeRunId()
    // **要带工作区**：界面按会话严格过滤记录，没有归属的行只会出现在"实时"那一瞬，
    // 刷新（或这一轮结束）之后就再也看不见了——而"哪道题被什么拦下"正是老师最要看的东西
    ctx.session.appendLog({ kind: 'verdict', text: why, workspace: owner(), ...(runId === undefined ? {} : { runId }) })
    broadcast('rejected', { ...summarize(item), verdict })
  })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const path = (req.url ?? '/').split('?')[0] ?? '/'

    /**
     * **题库**：老师要能看见手里有什么题。
     *
     * 以前题库只在接口里（`/api/state` 全量吐出来），界面上没有入口——
     * 于是老师只能看见最终那份卷子，"换一道"是唯一的动作。
     * 这里按条件筛选，并把分面（知识点/题型/分值/状态各有多少）一起给出去，
     * 前端不必自己算。
     */
    if (method === 'GET' && path === '/api/bank') {
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams
      const wantKnowledge = params.get('knowledge') ?? ''
      const wantType = params.get('type') ?? ''
      const wantStatus = params.get('status') ?? ''
      const wantText = (params.get('q') ?? '').trim()
      const limit = Math.min(200, Math.max(1, Number(params.get('limit') ?? '60') || 60))
      const offset = Math.max(0, Number(params.get('offset') ?? '0') || 0)

      const all = ctx.bank.all()
      const matched = all.filter((item) => {
        if (wantType !== '' && item.slot.type !== wantType) return false
        if (wantStatus !== '' && item.lifecycle !== wantStatus) return false
        if (wantKnowledge !== '' && !item.slot.knowledge.includes(wantKnowledge)) return false
        if (wantText !== '' && !item.prose.stem.includes(wantText)) return false
        return true
      })
      const knowledgeFacet = new Map<string, number>()
      const typeFacet = new Map<string, number>()
      const statusFacet = new Map<string, number>()
      for (const item of matched) {
        for (const key of item.slot.knowledge) knowledgeFacet.set(key, (knowledgeFacet.get(key) ?? 0) + 1)
        typeFacet.set(item.slot.type, (typeFacet.get(item.slot.type) ?? 0) + 1)
        statusFacet.set(item.lifecycle, (statusFacet.get(item.lifecycle) ?? 0) + 1)
      }
      send(res, 200, {
        total: matched.length,
        facets: {
          knowledge: facet(knowledgeFacet),
          type: facet(typeFacet),
          status: facet(statusFacet),
        },
        items: matched
          .slice()
          .toReversed()
          .slice(offset, offset + limit)
          .map((item) => summarizeWith(item, ctx.figure.renderItem(item)?.svg ?? '')),
      })
      return
    }

    /**
     * **改这一道**（两条路，都走同一个收尾：重新过闸门）。
     *
     * - `PATCH /api/item/<id>`：老师直接改题面/答案/解析；
     * - `POST /api/item/<id>/polish`：老师写一句要求，让 agent 改说法（数值不许动）。
     *
     * 为什么改完还要过闸门：改的是**语言层**，但语言层也得忠实于构造——
     * 数字来自构造、答案对得上、题面问的还是那几问。闸门给的拒绝理由会原样回到界面。
     */
    const itemEdit = path.match(/^\/api\/item\/([^/]+)$/u)
    const itemPolish = path.match(/^\/api\/item\/([^/]+)\/polish$/u)
    if (method === 'PATCH' && itemEdit !== null) {
      const item = ctx.bank.get(decodeURIComponent(itemEdit[1] ?? ''))
      if (item === undefined) {
        send(res, 404, { error: '题库里没有这道题' })
        return
      }
      const body = (await readBody(req)) as { stem?: string; answerText?: string; solution?: string[] }
      const solution = Array.isArray(body.solution) ? body.solution.map(String).filter((step) => step.trim() !== '') : item.prose.solution
      const revised: Item = {
        ...item,
        prose: {
          ...item.prose,
          stem: (body.stem ?? item.prose.stem).trim(),
          answerText: (body.answerText ?? item.prose.answerText).trim(),
          solution,
          serializer: { model: 'teacher', version: 1 },
        },
        review: { confirmedBy: null, confirmedAt: null },
      }
      const result = await ctx.bank.submit(revised)
      if (!result.ok) {
        send(res, 200, { ok: false, gate: result.verdict.gate, reason: result.verdict.reason, hint: result.verdict.hint ?? '' })
        return
      }
      send(res, 200, { ok: true, id: result.id })
      return
    }

    if (method === 'POST' && itemPolish !== null) {
      const item = ctx.bank.get(decodeURIComponent(itemPolish[1] ?? ''))
      if (item === undefined) {
        send(res, 404, { error: '题库里没有这道题' })
        return
      }
      const body = (await readBody(req)) as { instruction?: string }
      const polish = ctx.workbench.polish?.bind(ctx.workbench)
      if (polish === undefined) {
        send(res, 200, { ok: false, reason: '工作台没有接入改写能力' })
        return
      }
      const polished = await polish(item, String(body.instruction ?? '').trim())
      if (typeof polished === 'string') {
        send(res, 200, { ok: false, reason: polished })
        return
      }
      const result = await ctx.bank.submit(polished)
      if (!result.ok) {
        send(res, 200, { ok: false, gate: result.verdict.gate, reason: result.verdict.reason, hint: result.verdict.hint ?? '' })
        return
      }
      send(res, 200, { ok: true, id: result.id, stem: result.ok ? polished.prose.stem : '' })
      return
    }

    /**
     * **改这道题**（不是改字）：老师指着卷子上某一题说"把 AB 改成 10""再加一问求面积""改成选择题"。
     *
     * 为什么走 agent 而不是让人直接改数值：数值与答案只能来自构造（R1）。
     * agent 有写代码的本事——它可以换参数重造、换题型，甚至现写一个题型来满足要求；
     * 重造出来的题照样要过闸门，过关了才放进那个题位。
     */
    if (method === 'POST' && path === '/api/session/revise') {
      const body = (await readBody(req)) as { slot?: string; instruction?: string }
      const slotKey = String(body.slot ?? '')
      const instruction = String(body.instruction ?? '').trim()
      const meta = ctx.session.current()
      const live = sessionBlueprint(ctx)
      const row = live.blueprint.find((entry) => entry.key === slotKey || slotKey.startsWith(`${entry.key}-`))
      if (row === undefined) {
        send(res, 409, { error: `蓝图里没有题位 ${slotKey}` })
        return
      }
      if (instruction === '') {
        send(res, 409, { error: '说说想怎么改（例如：把 AB 改成 10；再加一问求面积；改成选择题）' })
        return
      }
      const binding = ctx.session.latest()?.bindings.find((entry) => entry.slot === slotKey)
      const current = binding === undefined ? undefined : ctx.bank.get(binding.itemId)
      const goal =
        `老师要改卷子上的一整道题（题位 ${slotKey}：${row.knowledge.join('、')}｜${row.type}｜${String(row.score)} 分）。\n` +
        `他的要求：${instruction}\n\n` +
        (current === undefined
          ? '这个题位现在还没有题。'
          : `现在这道来自题型 ${current.instance.kind}（种子 ${String(current.provenance.seed)}），题面：${current.prose.stem}\n` +
            `答案：${current.witness.answer}；参数：${JSON.stringify(current.instance.params)}。\n`) +
        '\n请按他的要求重造这一道（可以换种子、换题型，必要时用 constructor_write 改题型或写新题型；' +
        '数值与答案必须由构造给出，不要手改）。' +
        '出好后**用 place_item 把它放到这个题位上**（只入库不算改：卷子上没变就是没改），' +
        '然后用一句话告诉我卷子第几版、第几题变成了什么。' +
        '做不到的（比如要求越过了已学范围）如实说。'
      try {
        const started = ctx.workbench.start({
          goal,
          brief: briefOf(ctx, live),
          blueprint: live,
          workspace: meta.id,
          label: `改 ${slotKey}`,
        })
        send(res, 202, { runId: started.runId, slot: slotKey })
      } catch (error) {
        // **它正忙的时候，老师的"改这一道"不该被拒绝**：把要求插进正在跑的那一轮
        // （下一步它就看得见）。以前这里直接报"已经有一轮在跑"，等于老师被自己的 agent 挡住。
        const active = ctx.workbench.active().find((run) => run.workspace === meta.id || run.workspace === '')
        if (active !== undefined && ctx.workbench.interject(active.id, goal)) {
          send(res, 202, { runId: active.id, slot: slotKey, interjected: true })
          return
        }
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    /** 退回某一版（撤回）：按那一版的题列表再出一版，历史留着 */
    if (method === 'POST' && path === '/api/session/restore') {
      const body = (await readBody(req)) as { version?: number }
      const restore = ctx.session.restore?.bind(ctx.session)
      if (restore === undefined) {
        send(res, 200, { ok: false, reason: '会话没有接入版本退回' })
        return
      }
      try {
        const version = restore(Number(body.version ?? 0))
        ctx.session.appendLog({
          kind: 'verdict',
          text: `退回了第 ${String(body.version ?? 0)} 版：这一版 ${String(version.bindings.length)} 道题`,
          workspace: ctx.session.current().id,
        })
        send(res, 200, { ok: true, version })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    /** 把某一道从卷子上拿掉（题位空着，底栏如实显示还缺几道） */
    if (method === 'POST' && path === '/api/session/clear') {
      const body = (await readBody(req)) as { slot?: string }
      const clear = ctx.session.clear?.bind(ctx.session)
      if (clear === undefined) {
        send(res, 200, { ok: false, reason: '会话没有接入删除' })
        return
      }
      try {
        const version = clear(String(body.slot ?? ''))
        ctx.session.appendLog({
          kind: 'verdict',
          text: `从卷子上拿掉了一道：这一版 ${String(version.bindings.length)} 道题`,
          workspace: ctx.session.current().id,
        })
        send(res, 200, { ok: true, version })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && path === '/api/session/place') {
      const body = (await readBody(req)) as { slot?: string; itemId?: string }
      try {
        send(res, 200, await ctx.session.place(String(body.slot ?? ''), String(body.itemId ?? '')))
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    /**
     * **口述出题**：老师说一句"我想要一道……的题"，直接拿回题。
     *
     * 同步返回（不等 agent）：翻译 + 现造 + 过闸门通常十几秒，
     * 界面上一句"正在把这句话变成题…"就够了；造不出来才把活交给 agent（下面的 escalate）。
     */
    if (method === 'POST' && path === '/api/compose') {
      const body = (await readBody(req)) as { text?: string }
      const compose = ctx.workbench.compose?.bind(ctx.workbench)
      if (compose === undefined) {
        send(res, 200, { ok: false, items: [], reason: '工作台没有接入口述出题' })
        return
      }
      const result = await compose(String(body.text ?? ''))
      send(res, 200, {
        ok: result.ok,
        ...(result.spec === undefined ? {} : { spec: result.spec }),
        items: result.items.map(summarize),
        ...(result.similar === undefined ? {} : { similar: result.similar.map(summarize) }),
        ...(result.adjusted === undefined ? {} : { adjusted: result.adjusted }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.attempts === undefined ? {} : { attempts: result.attempts }),
        ...(result.alternatives === undefined ? {} : { alternatives: result.alternatives }),
        ...(result.escalate === undefined ? {} : { escalate: result.escalate }),
      })
      return
    }

    /** 口述出题造不出来时：把这句话交给 agent，让它写题型把它造出来 */
    if (method === 'POST' && path === '/api/compose/escalate') {
      const body = (await readBody(req)) as { goal?: string; label?: string }
      const goal = String(body.goal ?? '').trim()
      const label = String(body.label ?? '').trim()
      if (goal === '') {
        send(res, 409, { error: '没有要交代的活儿' })
        return
      }
      const live = sessionBlueprint(ctx)
      try {
        const started = ctx.workbench.start({
          goal,
          brief: briefOf(ctx, live),
          blueprint: live,
          workspace: ctx.session.current().id,
          label: label === '' ? '口述出题' : label,
        })
        send(res, 202, { runId: started.runId })
      } catch (error) {
        send(res, 409, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

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

    // 知识图谱页：整张图一次拿走（只读；图上每一个结论都要能追到出处）
    if (method === 'GET' && path === '/api/graph') {
      send(res, 200, ctx.graph.overview())
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
      // 新会话按老师的第一句话命名：卷子是给人看的，"未命名会话 3" 谁也认不出是哪张
      if (meta.title.startsWith('未命名') && (body.goal ?? '').trim() !== '') {
        // 先给一个"像话的"名字（去掉内部指令口吻，取第一句），保证列表里立刻不是"未命名会话 N"
        const raw = (body.goal ?? '').trim().replace(/\s+/gu, ' ')
        const short = raw
          .replace(/^老师(要|说|想)/u, '')
          .replace(/^要改这份卷子的设定[:：]?/u, '')
          .replace(/^(改|换)这份卷子的/u, '')
          .split(/[。；;\n]/u)[0] ?? raw
        const title = short.trim() === '' ? raw : short.trim()
        ctx.session.update({ title: title.length > 20 ? `${title.slice(0, 20)}…` : title })
        // 再让模型起一个**像卷名**的名字（不阻塞这一轮：起好之后界面重新拉一次就能看到）
        void nameThisSession(ctx, meta.id, raw, blueprint).catch(() => undefined)
      }
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
        // 每张卷子带上"多少道、多少分、最后哪一版"：起始页的卡片要靠它说清是哪一张
        sessions: ctx.session.list().map((meta) => {
          const latest = ctx.session.versionsOf?.(meta.id)?.at(-1)
          if (latest === undefined) return meta
          return Object.assign({}, meta, {
            version: latest.version,
            items: latest.bindings.length,
            totalScore: latest.totalScore,
            updatedAt: latest.at,
            gaps: latest.gaps.length,
          })
        }),
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
        // **改的是这一张卷子的设定**：先把它变成自己的那份（复制），再改——
        // 以前直接改共享文件，一个老师改"第 2 题考圆"会把另一张卷子也改了
        const next = ctx.session.settingPatch?.(body) ?? ctx.session.updateBlueprint(body, body.expectedRevision)
        const source = ctx.session.blueprintSource()
        const meta = ctx.session.current()
        const own = source.path.startsWith('data/blueprints/') && source.path.includes(meta.id.slice(-4))
        send(res, 200, { blueprint: next, path: source.path, revision: source.revision, own })
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
        const version = await ctx.session.assemble(body.reason ?? '再出一版')
        // **没有 agent 参与的改动也要在记录里说一句**：不然老师按完"再出一版"，
        // 右边那一栏只看到几条"收下一道新题"，像是什么都没发生（真实截图就是这样）。
        ctx.session.appendLog({
          kind: 'verdict',
          text:
            `出了一版：第 ${String(version.version)} 版 · ${String(version.bindings.length)} 道题 · 满分 ${String(version.totalScore)} 分` +
            (version.gaps.length === 0 ? '' : `（还缺 ${String(version.gaps.length)} 道）`),
          workspace: ctx.session.current().id,
        })
        send(res, 200, version)
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
      const body = (await readBody(req)) as { ops?: unknown; expectedRevision?: number }
      let ops: SettingsOp[] = []
      try {
        ops = settingsOps(body.ops)
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }
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
      try {
        const body = (await readBody(req)) as { name?: unknown; files?: unknown } | null
        if (body === null || !Array.isArray(body.files) || (body.name !== undefined && typeof body.name !== 'string')) {
          throw new Error('请提供资料名称和文件清单')
        }
        const files = body.files.map((entry: unknown) => {
          if (entry === null || typeof entry !== 'object') throw new Error('文件清单中有无效项目，请重新选择文件')
          const file = entry as { name?: unknown; text?: unknown; base64?: unknown }
          if (typeof file.name !== 'string' || (typeof file.text === 'string') === (typeof file.base64 === 'string')
            || (file.text !== undefined && typeof file.text !== 'string') || (file.base64 !== undefined && typeof file.base64 !== 'string')) {
            throw new Error('每个文件需要名称和一种有效的内容，请重新选择文件')
          }
          return {
            name: file.name,
            ...(typeof file.text === 'string' ? { text: file.text } : {}),
            ...(typeof file.base64 === 'string' ? { base64: file.base64 } : {}),
          }
        })
        send(res, 200, ctx.kb.upload(body.name ?? '', files))
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
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
          const current = ctx.kb.list().find((entry) => entry.id === batch.id)
          // agent 明确记录的结果和说明不能被通用收尾覆盖，尤其不能把 failed 改成完成。
          if (run.stopped === 'done' && current !== undefined && current.status !== 'ingesting') return
          const done = run.stopped === 'done'
          ctx.kb.mark(
            batch.id,
            'failed',
            done
              ? `本轮已结束，但尚未确认整理结果；已抽到的 ${String(current?.records ?? 0)} 条记录保留，可以继续整理`
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
      const url = new URL(req.url ?? '/', 'http://localhost')
      const format = url.searchParams.get('format') ?? 'html'

      // **Word**：老师拿到卷子是要接着改的（HTML 只能看，PDF 改不动）
      if (format === 'docx') {
        const body = buildPaperDocx({
          blueprint: sessionBlueprint(ctx),
          items,
          withAnswers: url.searchParams.get('answers') === '1',
          studentLine: sessionBlueprint(ctx).paper.studentFields !== false,
          figures: rasterizeFigures(items, figureOf),
        })
        res.writeHead(200, {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${meta.title}.docx`)}`,
          'content-length': String(body.length),
        })
        res.end(body)
        return
      }

      const markdown = format === 'md'
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

/** 分面统计（题库页的筛选器用它）：按数量排，数量相同按名字排 */
function facet(map: Map<string, number>): readonly { key: string; count: number }[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .toSorted((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** 选项在卷面上的写法：**四个选项形式要一致**（混搭的名称全去掉，整齐的留着） */
function optionViews(item: Item): readonly Record<string, unknown>[] {
  const options = item.prose.options ?? []
  const labelled = options.map((option) => /^[^=＝]{1,14}[=＝].+$/.test(option.text.trim()))
  const mixed = labelled.some((value) => value) && !labelled.every((value) => value)
  return options.map((option) => {
    const text = mixed ? optionDisplayText(option.text) : option.text
    const answer = normalize(item.prose.answerText)
    return Object.assign(
      {
        key: option.key,
        html: renderMathInText(text, 'html'),
        correct: normalize(option.text) === answer || normalize(optionDisplayText(option.text)) === answer,
      },
      option.errorType === undefined ? {} : { errorType: option.errorType },
    )
  })
}

/** 推给界面的最小投影：不要整个 Item 糊过去 */
function summarizeWith(item: Item, figureSvg: string, number?: number, stale = false): Record<string, unknown> {
  return {
    id: item.id,
    slot: item.slot.key,
    /**
     * 检查过期：闸门后来加了判据（见 EvidenceEntry.rule），这道题的签字是旧规则的。
     * 界面据此说清"这些题要重新过一遍"，而不是让老师以为它们还是当年那个标准。
     */
    stale,
    /** 卷面上的"第 N 题"（服务端算：界面显示它、agent 也说它） */
    ...(number === undefined ? {} : { number }),
    knowledge: item.slot.knowledge,
    type: item.slot.type,
    score: item.slot.score,
    lifecycle: item.lifecycle,
    stem: item.prose.stem,
    answer: item.prose.answerText,
    // 数学**写在正文里**（$…$），服务端渲染成 KaTeX HTML：界面不引数学库。
    // 以前还会额外带一份"公式层"（tex.stemMath 等）让界面单独摆一块公式——
    // 那是重复（题面里已经写着数学了），已去掉（用户："这个部分意义不大"）。
    stemHtml: renderMathInText(item.prose.stem, 'html'),
    // **选项必须发给界面**：选择题在卷面上没有 A/B/C/D 就等于没有题目
    // （真实踩过：界面上只显示"（  ）"，因为服务端压根没这个字段）。
    options: optionViews(item),
    answerHtml: renderMathInText(item.prose.answerText, 'html'),
    solutionHtml: item.prose.solution.map((step) => renderMathInText(step, 'html')),
    figure: figureSvg,
    constructor: item.provenance.constructor,
    seed: item.provenance.seed,
    evidence: item.evidence,
  }
}
