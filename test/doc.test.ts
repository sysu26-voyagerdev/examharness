import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { checkTex, renderMathInText, texToHtml, texToMathml } from '@examharness/core'
import * as docPlugin from '@examharness/plugin-doc'
import * as workspacePlugin from '@examharness/plugin-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * 内置读文档与 OCR 的测试。用的是**真文件、真 python、真 tesseract**：
 * 假数据在这一层没有意义——这一层的全部价值就是"真资料它读不读得动"。
 *
 * 环境不够（没有 .venv / 没有 tesseract / 没有语言包）时**不跳过断言**，
 * 而是断言"它如实说了缺什么"——那本身就是要验证的行为之一。
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VENV = join(ROOT, '.venv', 'bin', 'python3')
const fibers: Fiber[] = []
const scratch: string[] = []

async function boot(): Promise<{ ctx: Context; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'examharness-doc-'))
  scratch.push(dir)
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(ROOT).href
  fibers.push(
    await ctx.plugin(workspacePlugin, {
      dir: join(dir, 'workspaces'),
      venv: join(ROOT, '.venv'),
      allow: ['python3'],
      allowInstall: false,
      timeoutMs: 120_000,
      maxOutputBytes: 20_000,
      maxFileBytes: 2_000_000,
      maxListed: 100,
    }),
    await ctx.plugin(docPlugin, { script: 'scripts/extract.py', maxChars: 20_000, timeoutMs: 120_000 }),
  )
  return { ctx, dir }
}

/** 在工作区里跑一段 python 造测试文件（真 python，不是 mock） */
function makeWithPython(dir: string, code: string): void {
  const script = join(dir, 'make.py')
  writeFileSync(script, code, 'utf8')
  const result = spawnSync(VENV, [script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`造文件失败：${result.stderr}`)
}

beforeEach(() => {
  fibers.length = 0
})

afterEach(async () => {
  await Promise.all(fibers.toReversed().map((fiber) => fiber.dispose()))
  fibers.length = 0
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('文档与 OCR', () => {
  it('文本文件：直接读出来；路径跑不出工作区', async () => {
    const { ctx, dir } = await boot()
    ctx.workspace.open('kb-1')
    ctx.workspace.write('kb-1', 'in/真题.txt', '已知抛物线 y = x² - 4x + 3 与 x 轴交于 A、B 两点，求 AB 的长。')

    const read = ctx.doc.extract('kb-1', 'in/真题.txt')
    expect(read.ok).toBe(true)
    expect(read.kind).toBe('text')
    expect(read.text).toContain('求 AB 的长')

    expect(ctx.doc.probe('kb-1', 'in/真题.txt').ok).toBe(true)

    // 出圈一律不许
    const escaped = ctx.doc.extract('kb-1', '../secrets.txt')
    expect(escaped.ok).toBe(false)
    expect(escaped.error).toContain('工作区')

    // 不存在的文件也要说清楚，而不是返回空字符串假装成功
    const missing = ctx.doc.extract('kb-1', 'in/没有这个.txt')
    expect(missing.ok).toBe(false)
    expect(missing.error ?? '').not.toBe('')

    expect(existsSync(dir)).toBe(true)
  })

  it('Word 文档：段落与表格都读出来（真 docx，真 python-docx）', async () => {
    const { ctx, dir } = await boot()
    mkdirSync(join(dir, 'work'), { recursive: true })
    const docxPath = join(dir, 'work', '资料.docx')
    makeWithPython(
      dir,
      [
        'import docx',
        `d = docx.Document()`,
        `d.add_paragraph('抛物线 y = x^2 - 2x + m 与 x 轴有两个交点，求 m 的取值范围。')`,
        `t = d.add_table(rows=1, cols=2)`,
        `t.rows[0].cells[0].text = '知识点'`,
        `t.rows[0].cells[1].text = '与坐标轴交点'`,
        `d.save(${JSON.stringify(docxPath)})`,
      ].join('\n'),
    )
    ctx.workspace.open('kb-2')
    ctx.workspace.seed('kb-2', [docxPath])

    const read = ctx.doc.extract('kb-2', 'in/资料.docx')
    expect(read.ok).toBe(true)
    expect(read.kind).toBe('docx')
    expect(read.text).toContain('求 m 的取值范围')
    expect(read.text).toContain('与坐标轴交点')
  })

  it('OCR：真图真识别；缺语言包时如实说缺什么（而不是假装识别成功）', async () => {
    const { ctx, dir } = await boot()
    mkdirSync(join(dir, 'work'), { recursive: true })
    const imagePath = join(dir, 'work', '扫描页.png')
    makeWithPython(
      dir,
      [
        'from PIL import Image, ImageDraw, ImageFont',
        `img = Image.new('RGB', (900, 200), 'white')`,
        `draw = ImageDraw.Draw(img)`,
        `draw.text((30, 60), 'AB = 2   x1 = 3', fill='black', font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 44))`,
        `img.save(${JSON.stringify(imagePath)})`,
      ].join('\n'),
    )
    ctx.workspace.open('kb-3')
    ctx.workspace.seed('kb-3', [imagePath])

    const read = ctx.doc.ocr('kb-3', 'in/扫描页.png', 'eng')
    if (read.ok) {
      // 识别出来的文字必须来自图上写的东西（数字最稳）
      expect(read.text).toMatch(/[Aa][Bb]/)
      expect(read.text).toMatch(/[123]/)
      expect(read.chars).toBeGreaterThan(0)
    } else {
      // 环境里没有 tesseract / 语言包：报错必须指名道姓
      expect(`${read.error ?? ''} ${read.notes.join(' ')}`).toMatch(/tesseract|语言包|没有/)
    }

    // probe 对图片应当说"要 OCR"
    const probed = ctx.doc.probe('kb-3', 'in/扫描页.png')
    expect(probed.kind).toBe('image')
    expect(probed.needsOcr).toBe(true)
  })
})

describe('数学（LaTeX）', () => {
  it('能编译才放行：写歪的公式给出原因', () => {
    expect(checkTex('y = x^{2} - 4x + 3').ok).toBe(true)
    const broken = checkTex('\\frac{1}{')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error.length).toBeGreaterThan(0)
  })

  it('正文里的 $...$ 渲染出来，其余照原样转义（不许把 HTML 带进去）', () => {
    // 界面用 KaTeX 的 HTML 输出（配官方 CSS）；MathML 那条路在浏览器里排崩过
    const html = renderMathInText('已知抛物线 $y = x^{2} - 4x + 3$ 与 x 轴交于两点 <script>alert(1)</script>')
    expect(html).toContain('class="katex"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')

    // 编译不过的公式：不假装渲染成功，带着原因把原文放出来
    const bad = renderMathInText('这里坏掉了：$\\frac{1}{$')
    expect(bad).toContain('tex-broken')

    // 导出走 MathML（Word 认），这条不能跟着界面一起变
    expect(texToMathml('x_{1} = 3')).toContain('<math')
    expect(renderMathInText('$x_{1} = 3$', 'mathml')).toContain('<math')
    expect(texToHtml('x_{1} = 3')).toContain('class="katex"')
  })
})

describe('整理资料时的工具选择', () => {
  it('内置工具读得了的资料，不需要 agent 自己写脚本', async () => {
    const { ctx, dir } = await boot()
    mkdirSync(join(dir, 'work'), { recursive: true })
    const docxPath = join(dir, 'work', '题目.docx')
    makeWithPython(
      dir,
      [
        'import docx',
        `d = docx.Document()`,
        `d.add_paragraph('已知二次函数 y = x^2 - 2x + m 的图象与 x 轴有两个不同交点，求 m 的取值范围。')`,
        `d.save(${JSON.stringify(docxPath)})`,
      ].join('\n'),
    )
    ctx.workspace.open('kb-9')
    ctx.workspace.seed('kb-9', [docxPath])

    // 先探一下：工具要能自己说清"这是什么、要不要 OCR"
    const probed = ctx.doc.probe('kb-9', 'in/题目.docx')
    expect(probed.ok).toBe(true)
    expect(probed.kind).toBe('docx')
    expect(probed.needsOcr).toBe(false)

    // 再读：抽出来的文字必须来自原文
    const read = ctx.doc.extract('kb-9', 'in/题目.docx')
    expect(read.text).toContain('求 m 的取值范围')
    expect(read.notes).toEqual([])
  })
})
