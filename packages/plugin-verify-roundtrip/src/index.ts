import type { Context } from '@deepseek-ai/cordis'
import type { Item, Verdict } from '@examharness/core'
import { checkTex, normalize, numbers, parseJsonObject } from '@examharness/core'
import z from 'schemastery'

/**
 * 回译闸门（语言保真）。
 *
 * 原理（docs/agent/01 §2）：题面终究要给人读，所以序列化不可省，
 * 但"这题写得对不对"这个无法回答的问题，可以换成
 * **"题面是否忠实编码了我知道为真的那个结构"**——后者是可回答的：
 *
 *     构造实例 →（LLM 序列化）→ 题面 →（LLM 回译）→ 结构′ → 与实例比对
 *
 * 这是编译器里的 round-trip 测试。它**不是**在验证答案（答案由构造保证），
 * 而是在验证语言层有没有把条件写漏、写错、写成另一道题。
 *
 * 只对**模型序列化**的题面生效：模板序列化是确定性的，不需要往返。
 */

export const name = 'verify-roundtrip'

/**
 * 证据键：写进 item.evidence 的名字，**也是向题库报到的名字**。
 * 两者必须一致——不然"每道现役闸门都签过字"永远对不上，旧题就没法复用（真踩过）。
 */
export const evidenceKey = 'roundtrip'
export const inject = ['llm']

export const Config = z.object({
  /** 严格模式：回译拿不到结构就判定失败（默认如此，宁可退回重写） */
  strict: z.boolean().default(true),
})

export interface RoundTripConfig {
  strict: boolean
}

const PARSER_PROMPT = [
  '你是题面解析器。给你一段初中数学题的题干，把它还原成结构，只输出 JSON：',
  '{"goals": ["题面要求做的每一件事，一问一条"], "givensCount": 条件的条数,',
  ' "answer": "你解出的答案", "numbers": [题面里出现的每一个数字]}',
  '要求：',
  '1. 只依据题面字面信息，不要脑补任何未写出的条件；',
  '2. givensCount 数的是**题面显式给出的条件**条数；',
  '3. goals 要**逐问**写：题面分（1）（2）（3）就写三条；一问到底就写一条；',
  '4. answer 用与题面一致的记法（例如 "AB = 8" 或 "x = −2.5"）；',
  '5. numbers 写**所有**数字（含情境里的、条件里的、单位前的），不要漏；分问标号（1）（2）不算；',
  '6. 不要输出 JSON 以外的任何内容。',
].join('\n')

interface ParsedStem {
  goals: readonly string[]
  givensCount: number
  answer: string
  numbers: readonly string[]
}

function readParsed(value: Record<string, unknown> | undefined): ParsedStem | undefined {
  if (value === undefined) return undefined
  const count = value.givensCount
  const answer = value.answer
  // numbers 允许是数字或字符串（模型多半写成数字）：统一成字符串再比
  const raw = value.numbers
  const stated = Array.isArray(raw) ? raw.map((item) => (typeof item === 'number' ? String(item) : item)) : raw
  // goals 允许写成字符串（兼容旧提示词的 goal 字段），但优先数组
  const goals = Array.isArray(value.goals)
    ? value.goals.filter((item): item is string => typeof item === 'string')
    : typeof value.goals === 'string'
      ? [value.goals]
      : typeof value.goal === 'string'
        ? [value.goal]
        : undefined
  if (answer === undefined || typeof answer !== 'string') return undefined
  if (typeof count !== 'number' || !Number.isFinite(count)) return undefined
  if (goals === undefined || goals.length === 0) return undefined
  if (!Array.isArray(stated) || stated.some((item) => typeof item !== 'string')) return undefined
  return { goals, givensCount: count, answer, numbers: stated }
}

/** 目标是否讲的是同一件事：用实例目标里的关键词做包含判定 */
function goalMatches(instanceGoal: string, parsedGoal: string): boolean {
  const tokens = instanceGoal.split(/[\s/]+/).filter((token) => token !== '')
  if (tokens.length === 0) return false
  const normalized = normalize(parsedGoal)
  return tokens.some((token) => normalized.includes(normalize(token)))
}

/** 构造侧声明的"问几问"：优先用分条的 goals，退回单条 goal */
function declaredGoalsOf(item: Item): readonly string[] {
  const goals = item.instance.goals
  if (goals !== undefined && goals.length > 0) return goals.filter((goal) => goal.trim() !== '')
  return item.instance.goal === '' ? [] : [item.instance.goal]
}

/** 太小的整数多半是"第1个""两条边"这类结构词，不是题目数据 */
const STRUCTURAL_NUMBERS = new Set(['0', '1', '2', '90', '180', '360'])

/**
 * 题面里出现的、构造参数里没有的数字。
 * 分问标号与幂次先剥掉（见 withoutStructure），结构性数字跳过。
 */
function strayNumbers(item: Item, numbers_: readonly string[]): readonly string[] {
  const allowed = new Set(numbers(JSON.stringify(item.instance.params)))
  const stray: string[] = []
  for (const raw of numbers_) {
    for (const value of numbers(withoutStructure(raw))) {
      if (STRUCTURAL_NUMBERS.has(value) || allowed.has(value)) continue
      if (!stray.includes(value)) stray.push(value)
    }
  }
  return stray
}

/**
 * 去掉**结构性数字**：分问标号（（1）（2）（3）、(1)、①）与幂次（x^{2} 里的 2）。
 * 它们不是题目数据，查它们只会把写对的题面判成错的——
 * 这一条是踩出来的：中考解答题的分问标号一定会出现，动态题型的题面公式里也一定有幂次。
 */
function withoutStructure(text: string): string {
  return text.replace(/[（(]\s*\d+\s*[)）]/g, '').replace(/\^\s*\{?\s*\d+\s*\}?/g, '')
}

/**
 * LaTeX 这一层也要卡：公式写歪了（下标写错、括号漏了）不该等到老师看见，
 * 而且**公式里的数字必须与构造实例一致**——否则就是"构造是对的、写出来是另一道题"。
 */
function checkTexLayer(item: Item): Verdict | undefined {
  const tex = item.prose.tex
  if (tex === undefined) return undefined
  const fragments: [string, string][] = [
    ...(tex.stem === undefined ? [] : ([['题面公式', tex.stem]] as [string, string][])),
    ...(tex.answer === undefined ? [] : ([['答案公式', tex.answer]] as [string, string][])),
    ...(tex.solution ?? []).map((part, index) => [`解析第 ${String(index + 1)} 步`, part] as [string, string]),
  ]
  for (const [label, fragment] of fragments) {
    const result = checkTex(fragment)
    if (!result.ok) {
      return {
        pass: false,
        gate: name,
        reason: `${label}的 LaTeX 编译不过：${result.error}`,
        fixable: true,
        // 最常见的错法：把正文连同 $…$ 定界符一起塞进公式字段。
        // 这里必须说清怎么改，否则 agent 只会换个写法再撞一次。
        hint: fragment.includes('$')
          ? '这个字段是**数学模式下的公式片段**，不要再带 $ 定界符（也别把"已知抛物线…与 x 轴交于…"整句塞进来）：' +
            '正文留在题面里，这里只写给公式本身（例如 y=-2(x-4)^{2}-2）'
          : '数学由构造给出，别自己改写公式；只把它嵌进句子里',
      }
    }
  }

  // **题面公式**的数字必须是构造参数里出现过的：题面说的就是那道题，数字不许飘。
  // 答案与解析里会出现**推导出来的量**（比如两点间距离 = |x₂ − x₁|），那些本来就不在参数里，
  // 所以只对题面做这条检查——多查一步会把正确的推导当成错的。
  if (tex.stem !== undefined) {
    const allowed = new Set(numbers(JSON.stringify(item.instance.params)))
    for (const value of numbers(withoutStructure(tex.stem))) {
      // 结构性数字不是题目数据：查它们只会误伤——
      // 0/1（「= 0」「系数 1」）、角度常量（「∠A = 90°」「内角和 180°」「360°」）
      if (value === '0' || value === '1' || value === '90' || value === '180' || value === '360') continue
      if (!allowed.has(value)) {
        return {
          pass: false,
          gate: name,
          reason: `题面公式里出现了构造参数里没有的数字（${value}）`,
          fixable: true,
          hint: '题面公式必须照着构造写，数字不要手改',
        }
      }
    }
  }
  return undefined
}

export function apply(ctx: Context, config: RoundTripConfig): void {
  // 报到：题库据此判断"旧题能不能直接复用"（新闸门上线后，旧题要被重新验一遍）
  ctx.get('bank')?.declareGate?.(evidenceKey)
  ctx.on('item:verify', async (item, next) => {
    const verdict: Verdict = await next()
    if (!verdict.pass) return verdict

    // LaTeX 层对**任何**序列化方式都成立（模板也一样），先卡它
    const texVerdict = checkTexLayer(item)
    if (texVerdict !== undefined) return { ...verdict, ...texVerdict }

    // 模板序列化是确定性的：不需要往返（也就不会白花一次模型调用）。
    // 但**照样要留痕**：题库靠"每道现役闸门都签过字"判断旧题能不能复用（BankApi.declareGate），
    // 不留痕会让所有模板题永远无法复用、每次组卷都重跑一遍闸门。
    if (item.prose.serializer.model === 'template') {
      return {
        ...verdict,
        pass: true,
        evidence: {
          ...verdict.evidence,
          [evidenceKey]: { pass: true, detail: '模板序列化（确定性题面）：不需要回译' },
        },
      }
    }

    if (!ctx.llm.configured) {
      return {
        pass: false,
        gate: name,
        reason: '题面由模型序列化，但没有可用的模型做回译校验',
        fixable: false,
        hint: '要么配置模型密钥，要么改用模板序列化',
      }
    }

    const reply = await ctx.llm.chat([
      { role: 'system', content: PARSER_PROMPT },
      { role: 'user', content: item.prose.stem },
    ])
    const parsed = readParsed(parseJsonObject(reply.content))

    if (parsed === undefined) {
      if (config.strict) {
        return {
          pass: false,
          gate: name,
          reason: '回译失败：题面没能被还原成结构（这一步是让模型把题面读回结构，它这次没按约定回话）',
          fixable: true,
          hint: '先按原样再交一次（换个种子也行）；若连续失败，再看题面是不是表述不清或缺少 goals 声明',
        }
      }
      // 非严格模式：留痕放行，但**必须标 needsReview**——没验成就是没验成，
      // 这种题要落到"待复核"，等老师签字（R4）
      return {
        pass: true,
        needsReview: true,
        evidence: {
          ...verdict.evidence,
          [evidenceKey]: { pass: true, detail: '非严格模式：回译未拿到结构，本项未验成，需人工复核' },
        },
      }
    }

    const problems: string[] = []
    // **没声明就核对不了**：构造实例里没有"目标/条件"，回译就没有对照物。
    // 这时既不能假装通过（那是假验证），也不该判题面写错（那是冤枉）——
    // 如实标 needsReview，交给老师看一眼（R4）。题型模块声明 goal / givens 之后，
    // 这两项才会真的被核对。
    const unverifiable: string[] = []
    const declaredGoals = declaredGoalsOf(item)
    if (declaredGoals.length === 0) unverifiable.push('目标')
    else if (declaredGoals.length !== parsed.goals.length) {
      problems.push(`分问数不一致（题面 ${String(parsed.goals.length)} 问，构造 ${String(declaredGoals.length)} 问：${declaredGoals.join('／')}）`)
    } else {
      // 逐问核对：每一条声明的目标都要能在回译出来的问法里找到对应的一条
      for (const goal of declaredGoals) {
        if (!parsed.goals.some((parsedGoal) => goalMatches(goal, parsedGoal))) {
          problems.push(`目标不一致（题面里找不到「${goal}」，回译得到的是「${parsed.goals.join('／')}」）`)
          break
        }
      }
    }
    if (item.instance.givens.length === 0 && parsed.givensCount > 0) unverifiable.push('条件条数')
    else if (parsed.givensCount !== item.instance.givens.length) {
      problems.push(`条件条数不一致（题面 ${String(parsed.givensCount)} 条，构造 ${String(item.instance.givens.length)} 条）`)
    }
    if (normalize(parsed.answer) !== normalize(item.witness.answer)) {
      problems.push(`答案不一致（回译得到「${parsed.answer}」，构造答案是「${item.witness.answer}」）`)
    }
    // **题面里出现的数字必须来自构造**：允许模型写情境，但不许它自己编数据。
    // 情境里的"每件 40 元、进了 200 件"这种数，必须是题型放进 params 的构造参数；
    // 否则就是"文字里另造了一道题"，而那正是真值被模型改写的老路（R1）。
    const stray = strayNumbers(item, parsed.numbers)
    if (stray.length > 0) {
      problems.push(`题面里出现了构造参数里没有的数字（${stray.join('、')}）`)
    }

    if (problems.length > 0) {
      return {
        pass: false,
        gate: name,
        reason: `回译不一致：${problems.join('；')}`,
        fixable: true,
        hint:
          stray.length > 0
            ? '题面（含情境）里的数字只能来自构造：要写"进了 200 件"这类情境数据，就得让题型把它们放进 params'
            : '题面没有忠实表达构造出来的结构，重写题面（不要改数学）',
      }
    }

    if (unverifiable.length > 0) {
      return {
        pass: true,
        needsReview: true,
        evidence: {
          ...verdict.evidence,
          [evidenceKey]: {
            pass: true,
            detail: `答案「${parsed.answer}」对得上、题面数字都来自构造；但构造实例没声明${unverifiable.join('与')}，这项没验成，落待复核`,
          },
        },
      }
    }

    return {
      ...verdict,
      pass: true,
      evidence: {
        ...verdict.evidence,
        [evidenceKey]: {
          pass: true,
          detail: `回译一致：${String(declaredGoals.length)} 问、条件 ${String(parsed.givensCount)} 条、答案「${parsed.answer}」、题面数字都来自构造`,
        },
      },
    }
  })
}
