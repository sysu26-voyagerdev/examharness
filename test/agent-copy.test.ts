import { describe, expect, it } from 'vitest'
import { RISK, TOOL_LABEL, gateLabel, humanLine, toolLabel } from '../client/src/log.js'

/**
 * agent 栏里那些字是**给老师看的**（`client/src/log.ts`）。
 *
 * 这里盯的是一个真实踩过的坑：系统词漏到老师眼前。
 * 记录里曾经原样出现过 `material_search`、`place_item`、`it-口述出题-63096-2e3be86b`、
 * `未知工具 change_setting`、`没放进题位 S4`——这些都不是人话，
 * 老师要读的是"它干了什么、成了没成"。
 */

/** plugin-workbench 注册的工具名（照 `tools()` 抄一份，漏一个就是漏一个英文词） */
const TOOLS: readonly string[] = [
  'agent_status',
  'agent_wait',
  'assemble_paper',
  'bank_stats',
  'blueprint_create',
  'blueprint_list',
  'blueprint_read',
  'blueprint_update',
  'blueprint_use',
  'change_setting',
  'construct_item',
  'constructor_write',
  'corpus_compare',
  'corpus_read',
  'corpus_search',
  'doc_build',
  'doc_extract',
  'doc_ocr',
  'doc_probe',
  'gap_report',
  'graph_query',
  'item_read',
  'kb_list',
  'kb_mark',
  'kb_read',
  'kb_write',
  'knowledge_lookup',
  'material_search',
  'place_item',
  'quick_question',
  'reaudit_paper',
  'serialize_item',
  'spawn_agent',
  'submit_item',
  'web_search',
  'ws_grep',
  'ws_ls',
  'ws_read',
  'ws_run',
  'ws_write',
]

/** 卷子上的第几题：认得出 S3-1 就是"第 3 题"，认不出（S7-2 不在卷面上）就退回编号 */
const number = (slot: string): string | undefined => (slot === 'S3-1' ? '第 3 题' : undefined)

/** 真正跑出来过的一轮记录（照会话记录抄的），左边是服务端原文 */
const REAL_LINES: readonly string[] = [
  '没通过「verify-dedup」：与已入库题目结构完全相同（it-S24-1-630780034-036e44c3）',
  '被 verify-roundtrip 拦下 —— 回译不一致：题面 1 条，构造 2 条',
  'place_item：it-口述出题-63096-2e3be86b 过了闸门，但没放进题位 S4 —— 这是选择题，题位 S4 要的是解答题',
  'item_read：卷子上没有题位 S4（先 assemble_paper 或者问老师是哪一个题位）',
  'blueprint_use：这个会话改用「五道几何大题」（蓝图为 data/blueprints/五道几何大题.json）。下一步按新题位看缺口。',
  'blueprint_read：五道几何大题（5 个题位，45 分）',
  'gap_report：没有缺口，题位都齐了。',
  '这一轮出错停下了（不是"做完了"）：undefined is not iterable',
  'cand-8（某班随机抽取 8 名学生的成绩，求这组数据的平均数）',
]

describe('agent 栏的文案翻译', () => {
  it('每个注册的工具名都有一个人话标签，一个英文词都不剩', () => {
    for (const tool of TOOLS) expect(toolLabel(tool), tool).not.toBe('')
  })

  it('标签是人话（不含拉丁字母），没登记的也不把英文名露出来', () => {
    for (const [tool, label] of Object.entries(TOOL_LABEL)) {
      expect(label, tool).not.toMatch(/[A-Za-z_]/u)
    }
    expect(toolLabel('made_up_tool')).toBe('')
    expect(toolLabel(undefined)).toBe('')
  })

  it('真实记录里没有系统词：verify-xxx、内部编号、闸门、题位、工具名', () => {
    for (const line of REAL_LINES) {
      const said = humanLine(line)
      expect(said, line).not.toMatch(/verify-/u)
      expect(said, line).not.toMatch(/\bit-[\w\u4e00-\u9fa5-]/u)
      expect(said, line).not.toMatch(/cand-\d/u)
      expect(said, line).not.toMatch(/\bS\d/u)
      expect(said, line).not.toMatch(/闸门/u)
      expect(said, line).not.toMatch(/题位/u)
      expect(said, line).not.toMatch(/蓝图/u)
      for (const tool of TOOLS) expect(said, `${line} → ${tool}`).not.toContain(tool)
    }
  })

  it('翻出来还是人话（抽查几句，别翻成乱码）', () => {
    expect(humanLine('没通过「verify-dedup」：与已入库题目结构完全相同（it-S24-1-630780034-036e44c3）')).toBe(
      '没通过「与已有题目太像」：与已入库题目结构完全相同（这道题）',
    )
    expect(humanLine('item_read：卷子上没有题位 S4（先 assemble_paper 或者问老师是哪一个题位）')).toBe(
      '看这一道：卷子上没有第 4 题（先 出一版 或者问老师是哪一个题）',
    )
    expect(humanLine('gap_report：没有缺口，题位都齐了。')).toBe('看缺口：没有缺口，题都齐了。')
  })

  it('题号能给"卷子上的第几题"时就用它（认不出来才退回设定里的编号）', () => {
    expect(humanLine('改 S3-1', number)).toBe('改 第 3 题')
    expect(humanLine('改 S7-2', number)).toBe('改 第 7 题')
  })

  it('闸门名一律翻成"这意味着什么"，认不出来的也不裸奔', () => {
    expect(RISK.dedup).toBe('与已有题目太像')
    expect(gateLabel('verify-options')).toBe('选项可判')
    expect(humanLine('被 verify-unknownthing 拦下：不清楚')).toBe('这项检查：不清楚')
    expect(gateLabel('某个没登记的闸门')).toBe('这项检查')
  })
})
