/**
 * 一次性生成 `知识/` 下的知识点文件（迁移用，**保留在仓库里**：以后要重放这次迁移还能跑）。
 *
 *   pnpm build && node scripts/seed-knowledge-notes.mjs          # 只填空，已存在的文件不动
 *   pnpm build && node scripts/seed-knowledge-notes.mjs --force  # 覆盖重写（会冲掉备注正文，慎用）
 *
 * 用编译产物 `packages/core/lib` 而不是源码：Node 的类型剥离不认 `./graph.js` 这种
 * TS 约定的写法（源码里写 .js、实际是 .ts），会当成真的文件去找而报错。
 *
 * 前置关系从 `seed/knowledge.json` 读——那是这次迁移的**来源**。
 * 迁移完成后，真相就在 `知识/*.md` 里；这个脚本不再是事实来源。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeKnowledgeNote } from '../packages/core/lib/knowledge-note.js'

const OUT = '知识'
const force = process.argv.includes('--force')

/** 分组与显示名：只有这两样没法从 JSON 推出来，是这次迁移里"人补的信息" */
const GROUP_OF = {
  数与式: ['实数运算', '实数与二次根式', '整式运算', '整式与因式分解'],
  方程与不等式: ['一元一次不等式', '一元二次方程', '配方'],
  函数: ['一次函数', '反比例函数', '图象平移', '二次函数图象', '顶点式', '对称轴', '与坐标轴交点', '最值', '二次函数综合'],
  图形与几何: ['三角形与全等', '四边形与特殊平行四边形', '四边形与证明', '相似三角形', '锐角三角函数', '圆的性质', '圆与切线'],
  统计与概率: ['统计与概率'],
  推理与建模: ['规律与代数推理', '实际问题建模', '动点问题'],
}

const TITLE_OF = {
  二次函数图象: '二次函数的图象',
  一元二次方程: '一元二次方程',
  一元一次不等式: '一元一次不等式',
  四边形与特殊平行四边形: '四边形与特殊平行四边形',
  规律与代数推理: '规律与代数推理',
  实际问题建模: '实际问题建模',
  动点问题: '动点问题',
}

/** 一句话说清"这个知识点是什么"——老师扫一眼就知道该不该挂这条线 */
const GLOSS = {
  实数运算: '有理数、无理数的加減乘除与乘方开方',
  实数与二次根式: '二次根式的化简、分母有理化与混合运算',
  整式运算: '整式的加减乘除与幂的运算法则',
  整式与因式分解: '提公因式、公式法、十字相乘',
  一元一次不等式: '不等式的性质、解集与数轴表示',
  一元二次方程: '配方法、公式法、因式分解法解一元二次方程',
  配方: '把二次式配成完全平方，是顶点式与求根公式的共同来源',
  一次函数: 'y = kx + b 的图象、性质与待定系数法',
  反比例函数: 'y = k/x 的图象、性质与 k 的几何意义',
  图象平移: '左右平移与上下平移对解析式的影响',
  二次函数图象: '抛物线的开口方向、对称性与五点作图',
  顶点式: 'y = a(x-h)² + k：顶点坐标一眼可见的那一种写法',
  对称轴: 'x = -b/(2a)，以及由对称性推等量关系',
  与坐标轴交点: '令 y=0 或 x=0 求交点，与一元二次方程判别式相连',
  最值: '闭区间上的最大值最小值，含顶点在区间内外的讨论',
  二次函数综合: '二次函数与几何、方程、不等式混在一起的问题',
  三角形与全等: '全等三角形的判定与性质',
  四边形与特殊平行四边形: '平行四边形、矩形、菱形、正方形的判定与性质',
  四边形与证明: '以四边形为载体的推理与证明书写',
  相似三角形: '相似判定、比例线段与对应边',
  锐角三角函数: 'sin/cos/tan 的定义、特殊角与解直角三角形',
  圆的性质: '圆周角、垂径定理等圆内基本关系',
  圆与切线: '切线判定与性质、切线长定理',
  统计与概率: '平均数、中位数、众数、方差与简单概率',
  规律与代数推理: '从图形或数列里找规律并用代数式表达',
  实际问题建模: '把实际问题翻译成方程/函数再解回去',
  动点问题: '图形上点的运动引发的变量关系与分类讨论',
}

const graph = JSON.parse(readFileSync('seed/knowledge.json', 'utf8'))
const nodes = Object.keys(graph.nodes)
const groupOf = new Map()
for (const [group, keys] of Object.entries(GROUP_OF)) for (const key of keys) groupOf.set(key, group)
/** 教学顺序：组内按我给的顺序编号，跨组按组的先后 */
const orderOf = new Map()
{
  let base = 0
  for (const keys of Object.values(GROUP_OF)) {
    for (const [index, key] of keys.entries()) orderOf.set(key, base + (index + 1) * 10)
    base += keys.length * 10 + 100
  }
}

mkdirSync(OUT, { recursive: true })
const existing = new Set(readdirSync(OUT).filter((name) => name.endsWith('.md')))
let written = 0
let skipped = 0
const missingGroup = []

for (const key of nodes) {
  const group = groupOf.get(key)
  if (group === undefined) missingGroup.push(key)
  const note = {
    key,
    title: TITLE_OF[key] ?? key,
    order: orderOf.get(key) ?? 0,
    group: group ?? '',
    aliases: [],
    prerequisites: [...(graph.nodes[key].prerequisites ?? [])],
    note: [
      GLOSS[key] ?? '',
      '',
      '## 学生常在这儿卡住',
      '',
      '（老师自己填。这里写的是"这棵树上这条线的意义"，不是知识点本身的定义。）',
    ]
      .join('\n')
      .trim(),
  }
  const file = join(OUT, `${key}.md`)
  if (existing.has(`${key}.md`) && !force) {
    skipped += 1
    continue
  }
  writeFileSync(file, serializeKnowledgeNote(note), 'utf8')
  written += 1
}

console.log(`写好 ${String(written)} 个知识点文件，跳过 ${String(skipped)} 个已存在的。`)
if (missingGroup.length > 0) console.log(`没有分组（要补 GROUP_OF）：${missingGroup.join('、')}`)
const withPrereq = nodes.filter((key) => (graph.nodes[key].prerequisites ?? []).length > 0).length
console.log(`其中 ${String(withPrereq)} 个带前置连线，共 ${String(nodes.length)} 个知识点。`)
