import type { Blueprint, Item } from '@examharness/core'
import { renderMathInText } from '@examharness/core'
import { mathmlToOmml } from './omml.js'

/**
 * **真 .docx 导出**（不引依赖，自己写 OOXML + zip）。
 *
 * 为什么要有：老师拿到卷子是要**接着改**的——Word 是他改的地方。HTML 只能看，PDF 改不动。
 *
 * 两条取舍（都是明说的，不糊过去）：
 *   · **公式折成 Unicode 文本**（x^{2} → x²、\frac{2}{3} → 2/3、\angle ABC → ∠ABC）：
 *     Word 里可编辑、可打印；OMML 那一套（Word 的原生公式）要另外写一大坨，这版先不做。
 *   · **不带图**：卷面上的图是 SVG，Word 认它的方式很绕（要么光栅化、要么 asvg 扩展）；
 *     要带图的版本用「打印 / 存成 PDF」。docx 里会留一行说明，不让老师以为图丢了。
 */

/** CRC32（zip 头里要） */
const CRC_TABLE: number[] = Array.from({ length: 256 }, (_unused, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0)
  return (crc ^ 0xffffffff) >>> 0
}

/** 极简 zip：**只存不压**（卷子这点体积，省事比省字节值） */
function zip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // 存储
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBytes, entry.data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(entry.data.length, 20)
    dir.writeUInt32LE(entry.data.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt16LE(0, 30)
    dir.writeUInt16LE(0, 32)
    dir.writeUInt16LE(0, 34)
    dir.writeUInt16LE(0, 36)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBytes)
    offset += local.length + nameBytes.length + entry.data.length
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, ...central, end])
}

function escapeXml(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
}

interface ParaOptions {
  size?: number
  bold?: boolean
  align?: 'center' | 'right'
  spaceBefore?: number
  indent?: boolean
}

/**
 * 一个段落（Word 里就是 <w:p>）。
 *
 * `$…$` 里的数学走**真公式**（MathML → OMML），Word 里是排版好的式子（分数线、根号、上下标都在位），
 * 不是 `x^2` 这种半成品。正文则按普通文字排。
 */
function paragraph(text: string, options: ParaOptions = {}): string {
  const size = options.size ?? 22
  const props = [
    options.align === undefined ? '' : `<w:jc w:val="${options.align}"/>`,
    `<w:spacing w:before="${String(options.spaceBefore ?? 0)}" w:line="360" w:lineRule="auto"/>`,
    options.indent === true ? '<w:ind w:left="240"/>' : '',
  ].join('')
  const runProps = `<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="宋体"/><w:sz w:val="${String(size)}"/><w:szCs w:val="${String(size)}"/>${options.bold === true ? '<w:b/>' : ''}</w:rPr>`

  // 拆成：文字段 → 文字 run；$…$ → OMML 公式；换行 → <w:br/>
  const parts: string[] = []
  let cursor = 0
  for (const match of text.matchAll(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/gu)) {
    const index = match.index ?? 0
    const plain = text.slice(cursor, index)
    if (plain !== '') parts.push(plainPart(plain, runProps))
    const body = match[1] ?? match[2] ?? ''
    const omml = mathmlToOmml(renderMathInText(`$${body}$`, 'mathml'))
    parts.push(omml === '' ? plainPart(body, runProps) : omml)
    cursor = index + match[0].length
  }
  const tail = text.slice(cursor)
  if (tail !== '') parts.push(plainPart(tail, runProps))
  return `<w:p><w:pPr>${props}</w:pPr>${parts.join('')}</w:p>`
}

/** 普通文字（含换行）包成一个 run */
function plainPart(text: string, runProps: string): string {
  const body = text
    .split('\n')
    .map((line, index) => `${index === 0 ? '' : '<w:br/>'}${line === '' ? '' : `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`}`)
    .join('')
  return body === '' ? '' : `<w:r>${runProps}${body}</w:r>`
}

const TYPE_ORDER = ['选择', '填空', '解答'] as const
const NUMERALS = ['一', '二', '三', '四', '五']

interface DocxOptions {
  blueprint: Blueprint
  items: readonly Item[]
  /** 要不要把参考答案与解析印在后面（另起一页） */
  withAnswers: boolean
  /** 卷头下面那行"学校/班级/姓名"要不要印 */
  studentLine: boolean
  /** 每道题的图（item id → PNG + 原尺寸）。卷面上的图是 SVG，Word 要 PNG——转不了就没有 */
  figures?: ReadonlyMap<string, { png: Buffer; width: number; height: number }>
}

/** 把一张卷子写成 docx（试卷 + 可选答案与解析） */
export function buildPaperDocx(options: DocxOptions): Buffer {
  const { blueprint, items, withAnswers, studentLine, figures } = options
  const images: { id: string; data: Buffer }[] = []
  const imageXml = (item: Item): string => {
    const figure = figures?.get(item.id)
    if (figure === undefined) return ''
    images.push({ id: item.id, data: figure.png })
    const relId = `rIdImg${String(images.length)}`
    const width = 3_200_000 // ≈ 8.9cm，够看清一张几何图
    // **按原比例**：图被拉扁了比小一点更糟
    const height = Math.round(width * (figure.height / Math.max(1, figure.width)))
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${String(width)}" cy="${String(height)}"/><wp:docPr id="${String(images.length + 10)}" name="fig${String(images.length)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${String(images.length)}" name="fig${String(images.length)}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${String(width)}" cy="${String(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  }
  const paper = blueprint.paper
  const total = items.reduce((sum, item) => sum + item.slot.score, 0)
  const paragraphs: string[] = []

  // 卷头
  paragraphs.push(paragraph(paper.title, { size: 32, bold: true, align: 'center' }))
  paragraphs.push(
    paragraph(`${paper.className}　满分 ${String(total)} 分　时间 ${String(paper.minutes)} 分钟`, {
      size: 20,
      align: 'center',
      spaceBefore: 60,
    }),
  )
  if (studentLine) {
    paragraphs.push(paragraph('学校：＿＿＿＿＿＿　班级：＿＿＿＿＿＿　姓名：＿＿＿＿＿＿　学号：＿＿＿＿＿＿', { size: 20, spaceBefore: 160 }))
  }

  const groups = TYPE_ORDER.map((type) => ({
    type,
    items: items.filter((item) => item.slot.type === type),
  })).filter((group) => group.items.length > 0)

  let running = 0
  groups.forEach((group, groupIndex) => {
    const per = group.items[0]?.slot.score ?? 0
    const sum = group.items.reduce((acc, item) => acc + item.slot.score, 0)
    paragraphs.push(
      paragraph(`${NUMERALS[groupIndex] ?? String(groupIndex + 1)}、${group.type}题（每题 ${String(per)} 分，共 ${String(sum)} 分）`, {
        size: 24,
        bold: true,
        spaceBefore: 240,
      }),
    )
    for (const item of group.items) {
      running += 1
      paragraphs.push(paragraph(`${String(running)}. ${item.prose.stem}`, { spaceBefore: 120 }))
      for (const [index, option] of (item.prose.options ?? []).entries()) {
        paragraphs.push(
          paragraph(`${option.key}. ${option.text}${index % 2 === 0 ? '　　' : ''}`, { indent: true }),
        )
      }
      // 有图：转成 PNG 插进 Word（转不了就如实写一行，不让老师以为图丢了）
      if (item.figure !== undefined) {
        const picture = imageXml(item)
        if (picture === '') paragraphs.push(paragraph('（本题原带图，请看打印版或 PDF 版）', { size: 18, indent: true }))
        else paragraphs.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${picture}</w:p>`)
      }
    }
  })

  if (withAnswers) {
    paragraphs.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    paragraphs.push(paragraph(`${paper.title}·参考答案与解析`, { size: 28, bold: true, align: 'center' }))
    let number = 0
    for (const group of groups) {
      for (const item of group.items) {
        number += 1
        paragraphs.push(paragraph(`${String(number)}. 答案：${item.prose.answerText}`, { spaceBefore: 160, bold: true }))
        for (const step of item.prose.solution) paragraphs.push(paragraph(step, { size: 20, indent: true }))
      }
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  // 图片关系：docx 里图片是独立的 part，document.xml 只引用关系 id
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${images.map((_image, index) => `<Relationship Id="rIdImg${String(index + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/fig${String(index + 1)}.png"/>`).join('')}
</Relationships>`

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
    ...images.map((image, index) => ({ name: `word/media/fig${String(index + 1)}.png`, data: image.data })),
  ])
}
