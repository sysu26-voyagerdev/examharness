#!/usr/bin/env node
/**
 * 题型模块的**隔离验收**：在独立进程里跑（限制内存），崩了也只崩它自己。
 *
 * 为什么必须独立进程：模块的**顶层代码**在 import 时就执行，
 * 一个 while 循环就能把宿主进程的内存吃光——我们在真实使用中就被这样搞崩过一次。
 * 主进程只认这里的报告：通过才 import 注册。
 *
 * 用法：node --max-old-space-size=256 scripts/verify-constructor.mjs <模块路径> [样题数]
 * 输出：一行 JSON 报告 { ok, kind, covers, samples, checks, problems:[...] }
 *
 * 另外往 stderr 写**面包屑**（每行 `#phase:xxx`）：进程被内存上限或超时杀掉时，
 * 报告根本来不及输出，但面包屑已经写下去了——主进程据此能说清"崩在哪一步"，
 * 而不是只留一句"验收进程崩了"。agent 拿到的是可改的信息，不是一句"失败了"。
 */

import { pathToFileURL } from 'node:url'

/** 走到哪一步了（stderr，父进程解析；这里失败不影响验收本身） */
const phase = (name) => {
  try {
    process.stderr.write(`#phase:${name}\n`)
  } catch {
    /* 诊断信息，写不出去就算了 */
  }
}

const file = process.argv[2]
const samples = Number(process.argv[3] ?? '30')
const LIMITS = {
  perSampleMs: 80,
  totalMs: 4000,
  textLength: 2000,
  absValue: 1e9,
  paramCount: 64,
  checks: 16,
  steps: 24,
  maxCovers: 6,
}


/* ── 表达式求值器（与 core/expr.ts 同规则；限额是必须的）── */
function tokenize(source) {
  return source.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[+\-*/^()]/g) ?? []
}

function evaluate(source, variables, maxSteps = 4096, maxExponent = 64) {
  const tokens = tokenize(source)
  let position = 0
  let steps = 0
  const spend = () => {
    steps += 1
    if (steps > maxSteps) throw new Error('表达式太复杂')
  }
  const peek = () => tokens[position]
  const next = () => tokens[position++]
  const primary = () => {
    const token = next()
    if (token === undefined) throw new Error('表达式意外结束')
    if (token === '(') {
      const value = sum()
      if (next() !== ')') throw new Error('括号没有配对')
      return value
    }
    if (token === '-') return -primary()
    if (token === '+') return primary()
    if (/^\d/.test(token)) return Number(token)
    if (/^[A-Za-z_]/.test(token)) {
      const value = variables[token]
      if (value === undefined) throw new Error(`未知变量 ${token}`)
      return value
    }
    throw new Error(`不认识的记号 ${token}`)
  }
  const power = () => {
    const base = primary()
    if (peek() !== '^') return base
    next()
    const exponent = power()
    spend()
    if (!Number.isFinite(exponent) || Math.abs(exponent) > maxExponent) throw new Error('指数超出范围')
    return base ** exponent
  }
  const product = () => {
    let value = power()
    for (;;) {
      const token = peek()
      if (token === '*') { next(); spend(); value *= power() }
      else if (token === '/') { next(); spend(); const d = power(); if (d === 0) throw new Error('除以 0'); value /= d }
      else break
    }
    return value
  }
  const sum = () => {
    let value = product()
    for (;;) {
      const token = peek()
      if (token === '+') { next(); spend(); value += product() }
      else if (token === '-') { next(); spend(); value -= product() }
      else break
    }
    return value
  }
  const result = sum()
  if (position !== tokens.length) throw new Error('表达式有多余内容')
  return result
}

/** 检验点是否真的在检验：把参数扰动一下，它必须失败 */
function discriminating(check) {
  let baseline
  try {
    baseline = evaluate(check.expr, check.at)
  } catch (error) {
    return `算不出来：${error.message}`
  }
  if (Math.abs(baseline - check.expect) > 1e-6) return `对正确参数就不成立（算出 ${baseline}，期望 ${check.expect}）`
  for (const [name, value] of Object.entries(check.at)) {
    const delta = Math.abs(value) > 1 ? Math.abs(value) * 0.37 + 0.5 : 0.5
    for (const candidate of [value + delta, value - delta]) {
      try {
        if (Math.abs(evaluate(check.expr, { ...check.at, [name]: candidate }) - check.expect) > 1e-6) return undefined
      } catch {
        return undefined
      }
    }
  }
  return '把参数怎么改它都成立——没有在检验任何东西'
}

/** 契约的字段类型：**每个可选字段都查**，因为下游拿到的就是它们 */
function contractProblems(built) {
  const problems = []
  const text = (name, value) => {
    if (value !== undefined && typeof value !== 'string') problems.push(`${name} 必须是字符串（你给的是 ${Array.isArray(value) ? '数组' : typeof value}）`)
  }
  const texts = (name, value, hint) => {
    if (value === undefined) return
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      problems.push(`${name} 必须是**字符串数组**${hint === undefined ? '' : `（${hint}）`}：你给的是 ${Array.isArray(value) ? '数组里有非字符串' : typeof value}`)
    }
  }
  // **结构与问法必须声明**（回译要拿它核对、分量闸门要用它数分几问）
  const goals = Array.isArray(built.goals) ? built.goals.filter((goal) => typeof goal === 'string' && goal.trim() !== '') : []
  if (built.goals === undefined) {
    if (typeof built.goal !== 'string' || built.goal.trim() === '') {
      problems.push('没有声明 goal / goals：说不出"这道题要求什么"，题面就没人核对得了，也数不出分几问')
    }
  } else if (!Array.isArray(built.goals) || goals.length !== built.goals.length || goals.length === 0) {
    problems.push('goals 必须是**非空的字符串数组**（一问一条）')
  }
  if (!Array.isArray(built.givens) || built.givens.some((given) => typeof given !== 'string')) {
    problems.push('givens 必须是字符串数组（题面显式给出的条件，一条一个；没有条件就给空数组）')
  }
  text('stemTex', built.stemTex)
  text('answerTex', built.answerTex)
  text('goal', built.goal)
  texts('givens', built.givens, '一条一个条件')
  texts('solution', built.solution, '一步一条')
  texts('solutionTex', built.solutionTex, '一步一条，不是一整段字符串')
  if (built.steps !== undefined) {
    if (!Array.isArray(built.steps) || built.steps.some((step) => typeof step?.text !== 'string' || typeof step?.basis !== 'string')) {
      problems.push('steps 必须是 [{ text, basis }]（每条都要说明依据）')
    }
  }
  if (built.options !== undefined) {
    if (!Array.isArray(built.options) || built.options.some((option) => typeof option?.key !== 'string' || typeof option?.text !== 'string')) {
      problems.push('options 必须是 [{ key, text }]')
    }
  }
  if (built.checks !== undefined) {
    for (const check of built.checks) {
      if (typeof check?.expr !== 'string' || typeof check?.expect !== 'number' || check?.at === undefined || typeof check.at !== 'object') {
        problems.push('checks 每一条都要是 { expr: 字符串, at: 对象, expect: 数字 }')
        break
      }
    }
  }
  if (built.figure !== undefined && (typeof built.figure !== 'object' || built.figure === null || Array.isArray(built.figure))) {
    problems.push('figure 必须是对象（图形规范）')
  }
  return problems
}

const problems = []
const heapMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
const done = (extra = {}) => {
  process.stdout.write(JSON.stringify({ ok: problems.length === 0, problems, samples, checks: 0, covers: [], heapMb: heapMb(), ...extra }))
  process.exit(0)
}

if (file === undefined) {
  problems.push('没有给模块路径')
  done()
}

// 内存保护：这个进程自己也有上限，但主进程还活着
const startedAt = Date.now()

let module
phase('import')
try {
  module = await import(pathToFileURL(file).href)
} catch (error) {
  problems.push(`模块顶层代码出错（它在 import 那一刻就在执行）：${error instanceof Error ? error.message : String(error)}`)
  done()
}
phase('import-done')

if (heapMb() > 96) problems.push(`模块顶层就占了 ${heapMb()} MB 堆（上限 96 MB）：顶层不许做重活`)

const kind = typeof module.kind === 'string' ? module.kind : ''
const covers = Array.isArray(module.covers) ? module.covers.map(String) : []
if (kind === '') problems.push('模块必须导出 kind（字符串）')
if (typeof module.construct !== 'function') problems.push('模块必须导出 construct（函数）')
if (covers.length === 0) problems.push('没有声明 covers：不知道这个题型覆盖哪些知识点')
if (covers.length > LIMITS.maxCovers) problems.push(`covers 最多 ${LIMITS.maxCovers} 个：覆盖太多等于"什么都能出"`)
if (Date.now() - startedAt > LIMITS.totalMs) problems.push(`模块顶层就跑了 ${Date.now() - startedAt} ms：顶层不许做重活`)
if (problems.length > 0) done({ kind, covers })

const slot = { key: 'Z1', knowledge: covers.slice(0, 1), cognitive: '掌握', type: '解答', difficulty: [0.6, 0.85], score: 10, count: 1 }
const seen = new Set()
const shapes_ = []
let checkCount = 0

for (let index = 0; index < samples && problems.length === 0; index += 1) {
  const seed = 1000 + index * 7
  const sampleStart = Date.now()
  phase(`sample:${String(index + 1)}`)
  let built
  try {
    built = module.construct(slot, seed)
  } catch (error) {
    problems.push(`第 ${index + 1} 条构造就抛错：${error instanceof Error ? error.message : String(error)}`)
    break
  }
  const sampleMs = Date.now() - sampleStart
  if (sampleMs > LIMITS.perSampleMs) problems.push(`第 ${index + 1} 条构造用了 ${sampleMs} ms（上限 ${LIMITS.perSampleMs}）：太慢或陷进循环了`)
  if (Date.now() - startedAt > LIMITS.totalMs) problems.push(`验收总耗时超过 ${LIMITS.totalMs} ms`)

  // **同种子必须造出同一道题**：题目的 id 是由参数算出来的，"换一道"、"复用已入库的题"、
  // 组卷重来都靠这条。以前这里只写在文档里、没真的查——用 Math.random()/Date.now() 的模块
  // 会照样通过验收，然后在组卷时表现成"同一题位反复出不一样的东西"。
  let again
  try {
    again = module.construct(slot, seed)
  } catch (error) {
    problems.push(`第 ${index + 1} 条构造第二次就抛错（说明它有内部状态）：${error instanceof Error ? error.message : String(error)}`)
    break
  }
  if (JSON.stringify(again) !== JSON.stringify(built)) {
    problems.push(`第 ${index + 1} 条：同一种子两次构造结果不一样——题目必须是种子的确定性函数（不许用 Math.random / Date.now / 模块级计数器）`)
    break
  }

  if (typeof built?.stem !== 'string' || built.stem.trim() === '') problems.push('题面是空的')
  if (typeof built?.answer !== 'string' || built.answer.trim() === '') problems.push('answer 必须是字符串')
  if (built?.params === undefined || typeof built.params !== 'object') problems.push('没有 params：闸门与验收都靠它')
  if (!Array.isArray(built?.checks) || built.checks.length === 0) problems.push('没有 checks：题型必须声明"要被核对的数学事实"')
  if (problems.length > 0) break

  // **契约的每个字段都要看类型**：少看一眼，坏值就会走到下游去崩（真实踩过：
  // solutionTex 写成一整段字符串 → 界面渲染时 (tex.solution ?? []).map 抛错 →
  // 未处理的拒绝把正在跑的那一轮带走，界面再也起不了新一轮）。
  problems.push(...contractProblems(built))
  if (problems.length > 0) break

  const texts = [built.stem, built.answer, ...(Array.isArray(built.solution) ? built.solution.map(String) : [])]
  if (texts.some((text) => typeof text === 'string' && text.length > LIMITS.textLength)) {
    problems.push(`题面/答案/解法超过 ${LIMITS.textLength} 字`)
  }
  const params = built.params
  if (Object.keys(params).length > LIMITS.paramCount) problems.push(`params 字段太多（${Object.keys(params).length}）`)
  if (Object.values(params).some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > LIMITS.absValue)) {
    problems.push(`params 里有非有限数或过大的数（|值| 上限 ${LIMITS.absValue}）`)
  }
  if (built.checks.length > LIMITS.checks) problems.push(`checks 太多（${built.checks.length}）`)
  if (Array.isArray(built.steps) && built.steps.length > LIMITS.steps) problems.push(`解法步骤太多（${built.steps.length}）`)
  if (problems.length > 0) break

  // 检验点：用**框架的求值器**核对（这里复刻一份最小实现，与 core/expr.ts 同规则）
  for (const check of built.checks) {
    checkCount += 1
    const verdict = discriminating(check)
    if (verdict !== undefined) problems.push(`检验点无效（${check.expr}）：${verdict}`)
    if (problems.length > 0) break
  }
  if (problems.length > 0) break
  seen.add(JSON.stringify(built.params))
  // 结构指纹：条件与问法（去掉数字），用来判"同一句式换数字"
  shapes_.push(
    JSON.stringify([built.givens, built.goals ?? [built.goal]]).replace(/\d+(?:\.\d+)?/g, '#'),
  )
}

if (problems.length === 0 && seen.size < Math.max(3, Math.floor(samples / 6))) {
  problems.push(`不同种子只造出 ${seen.size} 种题：参数空间太小，出卷会反复撞同一道题`)
}

// **同一句式换数字不算题型**：把条件和问法里的数字抹掉再指纹，看它到底有几种"结构"。
// 这条是用户拿着卷子指出来的：真题的解答题换情境、换给定、换问法，
// 我们的题型却只是"同一个句子换数字"，整张卷子读起来像同一道题。
if (problems.length === 0) {
  const shapes = new Set(shapes_)
  if (shapes.size < 3) {
    problems.push(
      `30 个种子只造出 ${shapes.size} 种结构（把条件与问法里的数字抹掉后完全一样）：` +
        '这是**同一个句式换数字**，不是题型。让 construct 按种子真的分支——' +
        '换给定的条件组合（已知两点／已知顶点／给表格／给图形…）、换问法（求解析式／求最值／求面积／判断…）',
    )
  }
}

done({ kind, covers, checks: checkCount })
