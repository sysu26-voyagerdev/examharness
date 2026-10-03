#!/usr/bin/env node
/**
 * 知识图谱重建器（**确定性、不联网**）。
 *
 * 为什么要有它：`seed/knowledge.json` 以前是手写的，只有 17 个节点带前置、字段只有一个。
 * 现在这两个文件（`seed/knowledge.json`、`seed/knowledge-fusion.json`）都是**产物**，
 * 由本脚本从三份真实材料 + 一张人工审定表重建：
 *
 * | 输入 | 用途 |
 * |---|---|
 * | `data/curriculum/课标2022.requirements.jsonl`、`课标2025修订.requirements.jsonl` | 每个知识点的**存在依据**与领域路径 |
 * | `data/curriculum/*.examples.jsonl`（以及 `corpus/extracted/*.jsonl`） | **课标示例依据**（例 64、例 68……） |
 * | `data/zhenti/structure.json` + `data/zhenti/txt/*.txt` | 题型分布、分值、支持卷数、**共现（多知识点融合）**、分问数 |
 * | `scripts/graph-nodes/*.mjs` | 人工审定表：哪个知识点存在、前置是谁、匹配词是什么 |
 *
 * 三类依据在产物里**分得清**（`evidence.level`）：课标 / 课标示例 / 教材+真题 / 推断；
 * 「推断」的节点在 `--report` 里单独列出来——不编依据是这条流水线的底线。
 *
 * 用法：
 *   node scripts/graph-build.mjs                # 重建两个产物文件
 *   node scripts/graph-build.mjs --check        # 只比对：仓库里的产物与重建结果是否逐字节一致（不改文件）
 *   node scripts/graph-build.mjs --report       # 额外打印依据分类清单（哪些是课标来的、哪些是真题来的、哪些是推断）
 *   node scripts/graph-build.mjs --out DIR      # 写到别的目录（测试用）
 *   node scripts/graph-build.mjs --nodes DIR    # 换一份审定表目录（测试用）
 *
 * 版权：产物里**不许出现任何真题原文**——只有关键词、计数、分值区间与人工归纳的问法。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 年级顺序：审定表里用得到，也是"教材章节先后"这条依据的排序基准 */
const GRADES = ['七上', '七下', '八上', '八下', '九上', '九下', '综合']

/** 课标第四学段的领域路径（只认这些，不许自己发明） */
const DOMAINS = [
  '数与代数/数与式',
  '数与代数/方程与不等式',
  '数与代数/函数',
  '图形与几何/图形的性质',
  '图形与几何/图形的变化',
  '图形与几何/图形与坐标',
  '统计与概率/抽样与数据分析',
  '统计与概率/随机事件的概率',
  '综合与实践',
]

const KINDS = ['概念', '性质', '运算', '关系', '应用', '思想方法']

/**
 * 仓库里原有的 27 个知识点名（蓝图、构造器 `covers`、`cordis.yml` 的 learned 都在用它们）。
 * **一个都不能消失、不能改名**——脚本每次构建都会校验。
 */
const LEGACY = [
  '一次函数', '配方', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值',
  '实际问题建模', '动点问题', '实数运算', '实数与二次根式', '整式运算', '整式与因式分解',
  '一元二次方程', '反比例函数', '统计与概率', '三角形与全等', '四边形与特殊平行四边形',
  '相似三角形', '锐角三角函数', '圆的性质', '一元一次不等式', '规律与代数推理',
  '四边形与证明', '圆与切线', '二次函数综合',
]

/** 真题目录里每份卷子的 `txt` 字段是绝对路径；仓库搬家后会失效，所以只取文件名 */
const ZHENTI_TXT_DIR = 'data/zhenti/txt'

// ---------------------------------------------------------------------------
// 0. 命令行
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  const options = { out: 'seed', nodes: 'scripts/graph-nodes', check: false, report: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') options.check = true
    else if (arg === '--report') options.report = true
    else if (arg === '--out') options.out = argv[++i] ?? options.out
    else if (arg === '--nodes') options.nodes = argv[++i] ?? options.nodes
    else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/graph-build.mjs [--check] [--report] [--out DIR] [--nodes DIR]')
      process.exit(0)
    } else {
      console.error(`graph-build: 不认识的参数 ${arg}`)
      process.exit(2)
    }
  }
  return options
}

const OPTIONS = parseArgv(process.argv.slice(2))

function die(message) {
  console.error(`graph-build: ${message}`)
  process.exit(1)
}

const problems = []
const warnings = []

function warn(message) {
  warnings.push(message)
}

// ---------------------------------------------------------------------------
// 1. 读材料（只读；缺材料就停下，不写半成品）
// ---------------------------------------------------------------------------

const CURRICULUM_SOURCES = [
  { label: '课标2022', base: 'data/curriculum/课标2022' },
  { label: '课标2025修订', base: 'data/curriculum/课标2025修订' },
]

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

function fingerprint(relative) {
  const path = resolve(ROOT, relative)
  const bytes = readFileSync(path)
  return {
    file: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
  }
}

/** 「第四学段（7～9年级） / 数与代数 / 函数」→「数与代数/函数」 */
function shortenSection(section) {
  const parts = section
    .split('/')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
  return parts.slice(1).join('/')
}

/** 读课标要求：只要第四学段（7～9 年级）——这是初中。第三学段以前的不进图谱。 */
function loadCurriculum() {
  const requirements = []
  const examples = []
  const usedFiles = []
  for (const { label, base } of CURRICULUM_SOURCES) {
    const reqPath = `${base}.requirements.jsonl`
    const exPath = `${base}.examples.jsonl`
    if (!existsSync(resolve(ROOT, reqPath))) {
      die(`缺少课标材料 ${reqPath}（材料在 data/ 下，不进 Git；请先放回材料再重建）`)
    }
    usedFiles.push(fingerprint(reqPath))
    for (const row of readJsonl(resolve(ROOT, reqPath))) {
      const section = String(row.section ?? '')
      if (!section.includes('第四学段')) continue
      requirements.push({
        source: label,
        section,
        short: shortenSection(section),
        page: row.page ?? null,
        text: String(row.requirement ?? ''),
      })
    }
    if (existsSync(resolve(ROOT, exPath))) {
      usedFiles.push(fingerprint(exPath))
      for (const row of readJsonl(resolve(ROOT, exPath))) {
        const tags = Array.isArray(row.knowledge) ? row.knowledge.map(String) : []
        if (!tags.includes('第四学段')) continue
        examples.push({
          source: label,
          no: String(row.example_no ?? ''),
          title: String(row.title ?? ''),
          tags,
        })
      }
    }
  }
  return { requirements, examples, usedFiles }
}

/**
 * 读真题结构。
 *
 * 纳入统计的卷子：`parseStatus !== 'answer-only'` 且 `usedInStats !== false`
 * （后者标记的是同一份卷子的重复件，只留一份，免得共现卷数被灌水）。
 */
function loadZhenti() {
  const relative = 'data/zhenti/structure.json'
  if (!existsSync(resolve(ROOT, relative))) {
    die(`缺少真题材料 ${relative}（材料在 data/ 下，不进 Git；请先放回材料再重建）`)
  }
  const data = JSON.parse(readFileSync(resolve(ROOT, relative), 'utf8'))
  const papers = []
  const questions = []
  const keywordPapers = new Map()
  for (const paper of data.papers) {
    if (paper.parseStatus === 'answer-only') continue
    if (paper.usedInStats === false) continue
    const key = String(paper.paperKey ?? paper.fileName ?? '')
    const record = {
      key,
      year: paper.year ?? null,
      region: paper.region ?? '',
      txt: typeof paper.txt === 'string' ? basename(paper.txt) : '',
      questions: [],
    }
    for (const question of paper.questions ?? []) {
      const keywords = Array.isArray(question.keywords) ? question.keywords.map(String) : []
      const item = {
        paper: key,
        no: question.no ?? 0,
        type: typeof question.type === 'string' ? question.type : '未知',
        score: typeof question.score === 'number' ? question.score : null,
        domainPath: String(question.domainPath ?? 'unknown'),
        keywords,
      }
      record.questions.push(item)
      questions.push(item)
      for (const keyword of keywords) {
        keywordPapers.set(keyword, (keywordPapers.get(keyword) ?? 0) + 1)
      }
    }
    papers.push(record)
  }
  return { papers, questions, keywordPapers, usedFiles: [fingerprint(relative)] }
}

/** 课标示例：`corpus/extracted/*.jsonl` 里 agent 抽出来的记录带 knowledge 标签，正好能当依据 */
function loadExtractedExamples() {
  const dir = resolve(ROOT, 'corpus/extracted')
  if (!existsSync(dir)) return { records: [], usedFiles: [] }
  const records = []
  const usedFiles = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.jsonl')) continue
    usedFiles.push(fingerprint(join('corpus/extracted', name)))
    for (const row of readJsonl(join(dir, name))) {
      records.push({
        tags: Array.isArray(row.knowledge) ? row.knowledge.map(String) : [],
      })
    }
  }
  return { records, usedFiles }
}

// ---------------------------------------------------------------------------
// 2. 审定表 → 校验（名字、枚举、前置存在、无环、依据齐全）
// ---------------------------------------------------------------------------

/**
 * 审定表里的 grade 可能写成「九上 22.1 二次函数的图象和性质」，
 * 这里把 grade 前缀从 chapter 里剥掉，产物里 chapter 只留章节。
 */
function normalizeChapter(grade, chapter) {
  let text = String(chapter ?? '').trim()
  for (const name of GRADES) {
    if (text.startsWith(name)) {
      text = text.slice(name.length).trim()
      break
    }
  }
  return text === '' ? '（教材未设节）' : text
}

async function loadNodeTable(dir) {
  const files = ['number-algebra.mjs', 'geometry.mjs', 'statistics.mjs']
  const table = []
  for (const file of files) {
    const path = resolve(ROOT, dir, file)
    if (!existsSync(path)) die(`缺少审定表 ${dir}/${file}`)
    let module
    try {
      module = await import(pathToFileURL(path).href)
    } catch (error) {
      die(`审定表 ${file} 读不了：${error instanceof Error ? error.message : String(error)}`)
    }
    const nodes = module.nodes
    if (!Array.isArray(nodes)) die(`审定表 ${file} 没有导出 nodes 数组`)
    for (const node of nodes) table.push(node)
  }
  return table
}

function validateTable(table) {
  const names = new Set()
  for (const node of table) {
    const name = node.name
    if (typeof name !== 'string' || name.trim() === '') die('审定表里有节点没有名字')
    if (names.has(name)) die(`知识点重名：${name}`)
    names.add(name)
    if (!GRADES.includes(node.grade)) die(`${name}：grade「${node.grade}」不在 ${GRADES.join('|')} 里`)
    if (!DOMAINS.includes(node.domain)) die(`${name}：domain「${node.domain}」不是课标第四学段的领域路径`)
    if (!KINDS.includes(node.kind)) die(`${name}：kind「${node.kind}」不在 ${KINDS.join('|')} 里`)
    if (!Array.isArray(node.aliases)) die(`${name}：缺少 aliases 数组（可以为空）`)
    if (!Array.isArray(node.curriculum)) die(`${name}：缺少 curriculum 数组（可以为空）`)
    if (!Array.isArray(node.prereq)) die(`${name}：缺少 prereq 数组（可以为空）`)
    if (typeof node.ask !== 'string' || node.ask.trim() === '') die(`${name}：缺少「常见问法」ask`)
    const role = node.role ?? 'leaf'
    if (!['leaf', 'aggregate', 'fusion'].includes(role)) die(`${name}：role「${role}」不认识`)
    if (role === 'aggregate') {
      if (!Array.isArray(node.parts) || node.parts.length === 0) die(`${name}：容器节点必须写 parts`)
    } else if (!Array.isArray(node.zhenti)) {
      die(`${name}：非容器节点必须写 zhenti 关键词数组（可以为空数组）`)
    }
  }

  // 前置必须存在，而且不能成环——有环的话"前置闭包"就没有意义了（闸门会死循环）
  for (const node of table) {
    for (const edge of node.prereq) {
      const [target, basis] = edge
      if (!names.has(target)) die(`${node.name}：前置「${target}」不在审定表里`)
      if (target === node.name) die(`${node.name}：自己不能是自己的前置`)
      if (typeof basis !== 'string' || basis.trim() === '') die(`${node.name}：前置「${target}」没写依据`)
    }
    for (const part of node.parts ?? []) {
      if (!names.has(part)) die(`${node.name}：parts 里的「${part}」不在审定表里`)
    }
  }

  for (const name of LEGACY) {
    if (!names.has(name)) die(`原有知识点「${name}」不见了——蓝图与构造器都在用它，不能删也不能改名`)
  }

  const byName = new Map(table.map((node) => [node.name, node]))
  const state = new Map()
  const path = []
  const visit = (name) => {
    const seen = state.get(name)
    if (seen === 'done') return
    if (seen === 'open') die(`前置关系成环：${[...path, name].join(' → ')}`)
    state.set(name, 'open')
    path.push(name)
    for (const [target] of byName.get(name)?.prereq ?? []) visit(target)
    path.pop()
    state.set(name, 'done')
  }
  for (const node of table) visit(node.name)
  return byName
}

/** 容器节点的匹配词 = 子节点匹配词的并集（"这道题考了平均数" 也是"考了统计与概率"） */
function resolveKeywords(table) {
  const byName = new Map(table.map((node) => [node.name, node]))
  const cache = new Map()
  const resolveOne = (name) => {
    const cached = cache.get(name)
    if (cached !== undefined) return cached
    const node = byName.get(name)
    const own = Array.isArray(node?.zhenti) ? node.zhenti.map(String) : []
    const fromParts = (node?.parts ?? []).flatMap((part) => resolveOne(part))
    const merged = [...new Set([...own, ...fromParts])].sort()
    cache.set(name, merged)
    return merged
  }
  for (const node of table) resolveOne(node.name)
  return cache
}

/**
 * 匹配词的所有权检查。
 *
 * 为什么这条是硬规矩：共现（"多知识点融合"）是靠"同一道题命中了好几个知识点"数出来的。
 * 如果两个细目节点共用同一个匹配词，那道题必然同时命中两者——共现就被这个共用词灌水了，
 * 统计出来的是"我们写了同一个词"，不是"这两个知识点真的一起考"。
 * 所以：**细目节点的匹配词必须两两不相交**；容器节点之间也不许共用。
 * 综合题节点（role=fusion，如「二次函数综合」）刻意是"超集视角"，允许与别人重叠。
 */
/**
 * 匹配词归口表：**一个匹配词只能有一个主人**。
 *
 * 为什么：共现是靠"同一道题命中了好几个知识点"数出来的。两个细目节点写同一个词，
 * 那道题必然同时命中两者——统计出来的是"我把同一个词抄了两遍"，不是"它们真的一起考"。
 * 归口表里的 `null` 表示"谁都不认领"：这个词不指向某个知识点（「计算」「面积」……），
 * 认领它等于让统计造假，那类题干脆不进统计。
 */
async function loadKeywordOwners(dir) {
  const path = resolve(ROOT, dir, 'keyword-owner.mjs')
  if (!existsSync(path)) return {}
  const module = await import(pathToFileURL(path).href)
  return module.owner ?? {}
}

function applyKeywordOwners(table, owners) {
  const declared = Object.entries(owners)
  for (const node of table) {
    const own = Array.isArray(node.zhenti) ? [...node.zhenti] : []
    if (own.length === 0 && !declared.some(([, owner]) => owner === node.name)) continue
    const kept = own.filter((token) => {
      if (!Object.prototype.hasOwnProperty.call(owners, token)) return true
      return owners[token] === node.name
    })
    for (const [token, owner] of declared) {
      if (owner === node.name && !kept.includes(token)) kept.push(token)
    }
    node.zhenti = kept.sort()
  }
}

function checkKeywordOwnership(table) {
  const leafOwners = new Map()
  const aggregateOwners = new Map()
  for (const node of table) {
    const role = node.role ?? 'leaf'
    const bucket = role === 'leaf' ? leafOwners : role === 'aggregate' ? aggregateOwners : undefined
    if (bucket === undefined) continue
    for (const token of node.zhenti ?? []) {
      bucket.set(token, [...(bucket.get(token) ?? []), node.name])
    }
  }
  const report = (label, owners) => {
    for (const [token, names] of owners) {
      if (names.length > 1) {
        problems.push(`${label}共用匹配词「${token}」：${names.join('、')}（共用会让共现虚高，只能留一个）`)
      }
    }
  }
  report('细目节点', leafOwners)
  report('容器节点', aggregateOwners)
  for (const [token, names] of leafOwners) {
    const also = aggregateOwners.get(token)
    if (also !== undefined) warn(`匹配词「${token}」既属于细目 ${names.join('、')}，也属于容器 ${also.join('、')}`)
  }
  return { leafTokens: leafOwners.size, aggregateTokens: aggregateOwners.size }
}

// ---------------------------------------------------------------------------
// 3. 课标依据：把审定表里的原文片段匹配到真实的课标条目上
// ---------------------------------------------------------------------------

function matchCurriculum(node, curriculum) {
  const hits = []
  for (const pattern of node.curriculum) {
    let found = false
    for (const { label } of CURRICULUM_SOURCES) {
      const hit = curriculum.requirements.find(
        (requirement) => requirement.source === label && requirement.text.includes(pattern),
      )
      if (hit === undefined) continue
      found = true
      hits.push({
        source: hit.source,
        short: hit.short,
        page: hit.page,
        pattern,
      })
    }
    if (!found) {
      warn(`${node.name}：课标片段「${pattern}」在第四学段的要求里匹配不到（如实记为无此依据）`)
    }
  }
  return hits
}

/** 课标示例依据：示例的 knowledge 标签里出现了这个知识点（或它的别名）就算 */
function matchExamples(node, curriculum, extracted) {
  const literals = [node.name, ...node.aliases]
  const hits = []
  for (const example of curriculum.examples) {
    const tag = example.tags.find((piece) => literals.some((literal) => piece === literal))
    if (tag === undefined) continue
    hits.push({
      source: example.source,
      label: `${example.no}${example.title === '' ? '' : `「${example.title}」`}`,
    })
  }
  // agent 从课标示例里抽出来的记录（corpus/extracted）：标签是同一套词
  for (const record of extracted) {
    const tag = record.tags.find(
      (piece) => literals.includes(piece) || (node.name.length >= 2 && piece.includes(node.name)),
    )
    if (tag === undefined) continue
    hits.push({ source: '课标示例（整理件）', label: tag })
  }
  const unique = new Map()
  for (const hit of hits) unique.set(`${hit.source}|${hit.label}`, hit)
  return [...unique.values()]
}

// ---------------------------------------------------------------------------
// 4. 真题统计：题型分布、分值、支持卷数；共现 = 同一道题里一起考
// ---------------------------------------------------------------------------

/** 一道题命中了哪些知识点（整词相等；容器节点由它的 parts 并集命中） */
function matchedNodes(question, keywordsByNode) {
  const hit = new Set()
  const words = new Set(question.keywords)
  for (const [name, keywords] of keywordsByNode) {
    if (keywords.some((keyword) => words.has(keyword))) hit.add(name)
  }
  return hit
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100
}

/** 出现次数最多的几个值（同票按值降序，保证确定性） */
function commonValues(values, count) {
  const tally = new Map()
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)
  return [...tally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]))
    .slice(0, count)
    .map(([value]) => value)
}

// ---------------------------------------------------------------------------
// 5. 分问数：从真题纯文本的题块里数（1）（2）……
//
// 为什么这么算：`structure.json` 只留了题干首行（70 字），（1）（2）在后面几行，
// 所以只能回到 `data/zhenti/txt/*.txt` 里按题号切块再数。
// 丢公式是已知损失（docx 里公式是图片），所以这份统计**如实带上覆盖率**。
// ---------------------------------------------------------------------------

function loadSubQuestionStats(papers) {
  const txtDir = resolve(ROOT, ZHENTI_TXT_DIR)
  const stats = new Map() // paperKey → Map<no, 分问数>
  let parsedPapers = 0
  let eligiblePapers = 0
  let questionsLocated = 0
  let questionsTotal = 0
  for (const paper of papers) {
    questionsTotal += paper.questions.length
    if (paper.txt === '') continue
    const file = join(txtDir, paper.txt)
    if (!existsSync(file)) continue
    eligiblePapers += 1
    const lines = readFileSync(file, 'utf8').split('\n')
    const anchor = lines.findIndex((line) => /^\s*[一二三四五六七八九十]\s*[、.．]/.test(line))
    const start = anchor === -1 ? 0 : anchor + 1
    const located = new Map()
    let cursor = start
    for (const question of paper.questions) {
      const no = question.no
      if (typeof no !== 'number' || no <= 0) continue
      const pattern = new RegExp(`^\\s*${no}(?![0-9])\\s*(?:[.．、]|\\s|$)`)
      let found = -1
      for (let i = cursor; i < lines.length; i += 1) {
        if (pattern.test(lines[i] ?? '')) {
          found = i
          break
        }
      }
      if (found === -1) continue
      located.set(no, found)
      cursor = found + 1
    }
    if (located.size < paper.questions.length * 0.9) continue // 定位不齐就不猜，整份放弃
    parsedPapers += 1
    const starts = [...located.entries()].sort((a, b) => a[1] - b[1])
    const perQuestion = new Map()
    for (let i = 0; i < starts.length; i += 1) {
      const [no, from] = starts[i]
      const to = i + 1 < starts.length ? starts[i + 1][1] : lines.length
      const block = lines.slice(from, to).join(' ')
      const count = (block.match(/[（(]\s*[1-9]\s*[）)]/g) ?? []).length
      perQuestion.set(no, Math.min(Math.max(count, 1), 6))
    }
    stats.set(paper.key, perQuestion)
    questionsLocated += perQuestion.size
  }
  return {
    stats,
    coverage: {
      papersWithText: eligiblePapers,
      papersParsed: parsedPapers,
      locateRate: questionsTotal === 0 ? 0 : Math.round((questionsLocated / questionsTotal) * 1000) / 1000,
    },
  }
}

// ---------------------------------------------------------------------------
// 6. 组装产物
// ---------------------------------------------------------------------------

function sortEntries(entries, compare) {
  return [...entries].sort(compare)
}

async function build() {
  const curriculum = loadCurriculum()
  const zhenti = loadZhenti()
  const extracted = loadExtractedExamples()
  const table = await loadNodeTable(OPTIONS.nodes)
  validateTable(table)
  applyKeywordOwners(table, await loadKeywordOwners(OPTIONS.nodes))
  const keywordsByNode = resolveKeywords(table)
  const tokenStats = checkKeywordOwnership(table)

  // --- 真题：关键词是否真的在语料里出现过（审定表里写了不存在的词 = 假统计）
  for (const node of table) {
    for (const keyword of node.zhenti ?? []) {
      if (!zhenti.keywordPapers.has(keyword)) {
        warn(`${node.name}：匹配词「${keyword}」在真题关键词表里从未出现，已忽略`)
      }
    }
  }

  // --- 逐题命中
  const perNode = new Map(table.map((node) => [node.name, {
    questions: [],
    papers: new Set(),
    scores: [],
    types: new Map(),
    unknownScore: 0,
    subQuestions: new Map(),
    subQuestionsKnown: 0,
  }]))
  const pairTally = new Map()
  const tripleTally = new Map()
  let leafHitQuestions = 0
  let scoredQuestions = 0
  for (const question of zhenti.questions) {
    if (question.score !== null) scoredQuestions += 1
    const hit = matchedNodes(question, keywordsByNode)
    for (const name of hit) {
      const bucket = perNode.get(name)
      if (bucket === undefined) continue
      bucket.questions.push(question)
      bucket.papers.add(question.paper)
      bucket.types.set(question.type, (bucket.types.get(question.type) ?? 0) + 1)
      if (question.score === null) bucket.unknownScore += 1
      else bucket.scores.push(question.score)
    }
    // 共现只统计"细目"（容器节点是它的 parts 的并集，参加共现等于同一件事数两遍；
    // 综合题节点是专门用来描述"多知识点融合"的，也不当共现里的成员）
    const fine = [...hit]
      .filter((name) => (table.find((node) => node.name === name)?.role ?? 'leaf') === 'leaf')
      .sort()
    if (fine.length > 0) leafHitQuestions += 1
    for (let i = 0; i < fine.length; i += 1) {
      for (let j = i + 1; j < fine.length; j += 1) {
        addCooccurrence(pairTally, [fine[i], fine[j]], question)
        for (let k = j + 1; k < fine.length; k += 1) {
          addCooccurrence(tripleTally, [fine[i], fine[j], fine[k]], question)
        }
      }
    }
  }

  // --- 分问数（回到纯文本里数）
  const subQuestions = loadSubQuestionStats(zhenti.papers)
  for (const [name, bucket] of perNode) {
    for (const question of bucket.questions) {
      const perPaper = subQuestions.stats.get(question.paper)
      const parts = perPaper?.get(question.no)
      if (parts === undefined) continue
      bucket.subQuestionsKnown += 1
      bucket.subQuestions.set(parts, (bucket.subQuestions.get(parts) ?? 0) + 1)
    }
    if (bucket.questions.length === 0 && (keywordsByNode.get(name) ?? []).length > 0) {
      warn(`${name}：写了匹配词但一道题都没命中（统计为空，报告里如实列出）`)
    }
  }

  // --- 依据分类 + 节点产物
  // 刻意**不写生成时间**：产物要能逐字节复现（跑两次必须一样），时间在 git 提交里。
  const nodes = {}
  const evidenceStats = { 课标: 0, 课标示例: 0, 教材与真题: 0, 推断: 0 }
  const inferred = []
  for (const node of table) {
    const bucket = perNode.get(node.name)
    const hits = matchCurriculum(node, curriculum)
    const exampleHits = matchExamples(node, curriculum, extracted.records)
    const chapter = normalizeChapter(node.grade, node.chapter)
    const tokens = (keywordsByNode.get(node.name) ?? []).filter((keyword) =>
      zhenti.keywordPapers.has(keyword),
    )
    const sources = []
    for (const hit of hits.slice(0, 4)) {
      sources.push(`${hit.source} §${hit.short} p${hit.page}「${hit.pattern}」`)
    }
    if (hits.length > 4) sources.push(`（课标条目共 ${hits.length} 条，此处只列前 4 条）`)
    for (const hit of exampleHits.slice(0, 2)) {
      sources.push(`${hit.source} 示例 ${hit.label}`)
    }
    sources.push(`人教版${node.grade} ${chapter}`)
    if (bucket !== undefined && tokens.length > 0) {
      sources.push(
        `真题统计：${zhenti.papers.length} 份卷中 ${bucket.papers.size} 卷命中` +
          `（${bucket.questions.length} 题；匹配词 ${tokens.join('、')}）`,
      )
    }
    let level = '推断'
    if (hits.length > 0) level = '课标'
    else if (exampleHits.length > 0) level = '课标示例'
    else if (tokens.length > 0 && (bucket?.questions.length ?? 0) > 0) level = '教材与真题'
    evidenceStats[level] += 1
    if (level === '推断') inferred.push(node.name)
    if (level === '推断' && typeof node.note !== 'string') {
      problems.push(`${node.name}：没有任何课标/示例/真题依据，必须在审定表里写 note 说明`)
    }

    const entry = {
      prerequisites: node.prereq.map(([target]) => target),
      grade: node.grade,
      chapter,
      domain: node.domain,
      kind: node.kind,
      aliases: node.aliases,
      sources,
      prerequisiteBasis: Object.fromEntries(node.prereq.map(([target, basis]) => [target, basis])),
      evidence: {
        level,
        curriculum: [...new Set(hits.map((hit) => `${hit.source} §${hit.short}`))],
        examples: [...new Set(exampleHits.map((hit) => `${hit.source} ${hit.label}`))],
        zhenti: { papers: bucket?.papers.size ?? 0, questions: bucket?.questions.length ?? 0 },
      },
      ...(node.role === undefined ? {} : { role: node.role }),
      ...(node.parts === undefined ? {} : { parts: node.parts }),
      ...(node.note === undefined ? {} : { note: node.note }),
    }
    nodes[node.name] = entry
  }

  // --- 融合证据
  // 共现只留"至少在 2 份卷子里一起出现过"的组合：1 卷的组合多半是偶然，
  // 而且会让产物膨胀到没人看得完（真实数字在 --report 里照实打印）。
  const pairStats = [...pairTally.entries()]
    .map(([key, value]) => ({
      nodes: key.split(' + '),
      papers: value.papers.size,
      questions: value.questions,
    }))
    .filter((pair) => pair.papers >= 2)
    .sort(compareCooccurrence)
  const tripleStats = [...tripleTally.entries()]
    .map(([key, value]) => ({
      nodes: key.split(' + '),
      papers: value.papers.size,
      questions: value.questions,
    }))
    .filter((triple) => triple.papers >= 2)
    .sort(compareCooccurrence)

  const fusionNodes = {}
  for (const node of table) {
    const bucket = perNode.get(node.name)
    if (bucket === undefined) continue
    const withPairs = pairStats
      .filter((pair) => pair.nodes.includes(node.name))
      .slice(0, 5)
      .map((pair) => ({
        with: pair.nodes.find((piece) => piece !== node.name),
        papers: pair.papers,
        questions: pair.questions,
      }))
    const withTriples = tripleStats
      .filter((triple) => triple.nodes.includes(node.name))
      .slice(0, 3)
      .map((triple) => ({
        with: triple.nodes.filter((piece) => piece !== node.name),
        papers: triple.papers,
        questions: triple.questions,
      }))
    fusionNodes[node.name] = {
      questions: bucket.questions.length,
      supportPapers: bucket.papers.size,
      typeDist: Object.fromEntries(
        sortEntries([...bucket.types.entries()], (a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)),
      ),
      score: {
        common: commonValues(bucket.scores, 3),
        median: median(bucket.scores),
        min: bucket.scores.length === 0 ? null : Math.min(...bucket.scores),
        max: bucket.scores.length === 0 ? null : Math.max(...bucket.scores),
        unknown: bucket.unknownScore,
      },
      subQuestions: {
        common: commonValues(
          [...bucket.subQuestions.entries()].flatMap(([parts, count]) => Array.from({ length: count }, () => parts)),
          3,
        ),
        dist: Object.fromEntries(sortEntries([...bucket.subQuestions.entries()], (a, b) => a[0] - b[0])),
        coverage: bucket.questions.length === 0
          ? 0
          : Math.round((bucket.subQuestionsKnown / bucket.questions.length) * 1000) / 1000,
      },
      matchKeywords: (keywordsByNode.get(node.name) ?? []).filter((keyword) =>
        zhenti.keywordPapers.has(keyword),
      ),
      ask: node.ask,
      ...(withPairs.length === 0 ? {} : { with: withPairs }),
      ...(withTriples.length === 0 ? {} : { with3: withTriples }),
      ...(node.role === undefined ? {} : { role: node.role }),
      ...(node.note === undefined ? {} : { note: node.note }),
    }
  }

  const knowledge = {
    version: 2,
    generatedBy: 'scripts/graph-build.mjs',
    source: '课标（2022 / 2025修订）· 课标示例 · 中考真题结构统计 · 人教社教材目录（人工审定表）',
    inputs: [...curriculum.usedFiles, ...zhenti.usedFiles, ...extracted.usedFiles],
    nodes,
  }

  const fusion = {
    version: 1,
    generatedBy: 'scripts/graph-build.mjs',
    method: {
      corpus: `data/zhenti/structure.json：${zhenti.papers.length} 份去重真题卷、${zhenti.questions.length} 道题（answer-only 与重复件已排除）`,
      matching:
        'questions[].keywords 与知识点的匹配词做整词相等匹配；容器节点（role=aggregate）取其 parts 匹配词的并集',
      cooccurrence:
        '同一道题里同时命中的知识点两两成对、三三成组；papers = 去重后的真题卷数，questions = 命中的题数；只统计细目节点（容器与综合题节点不参与，避免同一件事数两遍）',
      subQuestions:
        '分问数从 data/zhenti/txt/*.txt 的题块里数（1）（2）……；公式在 docx 里是图片、抽取时丢失，所以带覆盖率',
      ask: '「常见问法」是审定表里的人工归纳（不是统计出来的，也未经过教师校验）',
      copyright: '本文件只有统计与归纳，不含任何真题原文',
      coveredPapers: zhenti.papers.length,
      subQuestionCoverage: subQuestions.coverage,
    },
    nodes: fusionNodes,
    pairs: pairStats.slice(0, 400),
    triples: tripleStats.slice(0, 200),
  }

  return {
    knowledge,
    fusion,
    evidenceStats,
    inferred,
    table,
    pairCount: pairStats.length,
    tripleCount: tripleStats.length,
    corpus: {
      papers: zhenti.papers.length,
      questions: zhenti.questions.length,
      leafHitQuestions,
      scoredQuestions,
      leafTokens: tokenStats.leafTokens,
      aggregateTokens: tokenStats.aggregateTokens,
      keywordsInCorpus: zhenti.keywordPapers.size,
    },
  }
}

function addCooccurrence(tally, nodes, question) {
  const key = nodes.join(' + ')
  const entry = tally.get(key) ?? { papers: new Set(), questions: 0 }
  entry.papers.add(question.paper)
  entry.questions += 1
  tally.set(key, entry)
}

function compareCooccurrence(a, b) {
  if (a.papers !== b.papers) return b.papers - a.papers
  if (a.questions !== b.questions) return b.questions - a.questions
  return a.nodes.join('+') < b.nodes.join('+') ? -1 : 1
}

// ---------------------------------------------------------------------------
// 7. 写出（字节一致才算确定性）
// ---------------------------------------------------------------------------

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function main() {
  return build().then((result) => {
    const knowledgeText = serialize(result.knowledge)
    const fusionText = serialize(result.fusion)
    const outDir = resolve(ROOT, OPTIONS.out)

    if (OPTIONS.check) {
      let same = true
      for (const [file, text] of [
        ['knowledge.json', knowledgeText],
        ['knowledge-fusion.json', fusionText],
      ]) {
        const path = join(outDir, file)
        const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
        if (current !== text) {
          same = false
          console.error(`graph-build: ${path} 与重建结果不一致`)
        }
      }
      printSummary(result, same ? '产物与重建结果逐字节一致' : '产物与重建结果不一致')
      process.exit(same ? 0 : 1)
    }

    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'knowledge.json'), knowledgeText)
    writeFileSync(join(outDir, 'knowledge-fusion.json'), fusionText)
    printSummary(result, `已写入 ${join(OPTIONS.out, 'knowledge.json')} 与 ${join(OPTIONS.out, 'knowledge-fusion.json')}`)
    if (problems.length > 0) {
      console.error('\n必须处理的问题：')
      for (const problem of problems) console.error(`  - ${problem}`)
      process.exit(1)
    }
  })
}

function printSummary(result, tail) {
  const { evidenceStats, inferred, table, pairCount, tripleCount, fusion, corpus } = result
  const edges = table.reduce((sum, node) => sum + node.prereq.length, 0)
  console.log(`graph-build: ${table.length} 个知识点、${edges} 条前置边；${tail}`)
  console.log(
    `  依据分类：课标 ${evidenceStats['课标']} · 课标示例 ${evidenceStats['课标示例']} · ` +
      `教材与真题 ${evidenceStats['教材与真题']} · 推断 ${evidenceStats['推断']}`,
  )
  console.log(
    `  真题：${corpus.papers} 份卷、${corpus.questions} 道题，其中 ${corpus.leafHitQuestions} 道命中至少一个细目知识点；` +
      `细目匹配词 ${corpus.leafTokens} 个（语料里共 ${corpus.keywordsInCorpus} 个关键词）`,
  )
  console.log(
    `  真题共现：${pairCount} 组知识点对、${tripleCount} 组三元组达到 2 卷以上；` +
      `分问数覆盖率 ${fusion.method.subQuestionCoverage.locateRate}`,
  )
  if (OPTIONS.report) {
    console.log('\n【推断的节点】（没有课标条目、没有课标示例、也没有真题命中）')
    for (const name of inferred) console.log(`  - ${name}`)
    console.log('\n【写了 note 如实说明的节点】')
    for (const node of table) if (typeof node.note === 'string') console.log(`  - ${node.name}：${node.note}`)
  }
  if (warnings.length > 0) {
    console.log(`\n提醒（不阻断构建）：`)
    for (const warning of warnings) console.log(`  - ${warning}`)
  }
  if (problems.length > 0) {
    console.log(`\n严重问题 ${problems.length} 条：`)
    for (const problem of problems) console.log(`  - ${problem}`)
  }
}

main().catch((error) => {
  console.error(`graph-build: 跑挂了：${error instanceof Error ? error.stack : String(error)}`)
  process.exit(1)
})
