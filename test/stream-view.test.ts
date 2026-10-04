import { describe, expect, it } from 'vitest'
import { streamBody, streamLabel } from '../client/src/log.js'

/**
 * 实时区那两件事：**标签是什么**、**摆出来的字是什么**。
 *
 * 它们只在界面上起作用，但错了很难看出来（老师不会说"标签错了"，只会说"这一块看不懂"），
 * 所以在这里钉住：想/写分得开、题面数据不把 JSON 键摊出来、正在写的那几个字不许丢。
 */

describe('实时区的标签', () => {
  it('想的那一路说"它在想"，不许说成"它在写"（英文思考会被当成题面）', () => {
    expect(streamLabel('think', '它说', true, false)).toBe('它在想…')
    expect(streamLabel('think', '它说', false, false)).toBe('它刚想的')
  })

  it('正文那一路按"哪一路输出"说清楚它在做什么', () => {
    expect(streamLabel('say', '写题面', true, false)).toBe('它在写题面…')
    expect(streamLabel('say', '改这一道', false, false)).toBe('它刚改的题面')
    expect(streamLabel('say', '它说', true, false)).toBe('它在写…')
    // 没登记的那一路也要有话说，不能露出内部名字
    expect(streamLabel('say', 'spawn_agent', true, false)).toBe('它在写…')
  })

  it('按格式填字段时说"填题面数据"，不说成"它在写"', () => {
    expect(streamLabel('say', '写题面', true, true)).toBe('它在填题面数据…')
    expect(streamLabel('say', '写题面', false, true)).toBe('它刚填的题面数据')
  })

  it('它在给工具填参数时说清"在准备哪一步"（那十几秒界面不能看着像死了）', () => {
    expect(streamLabel('use', '写题型', true, false)).toBe('它在准备「写题型」…')
  })
})

describe('实时区摆出来的字', () => {
  it('人话就原样摆出来（不做任何加工）', () => {
    const sentence = '我先看一下这类题常见的问法。'
    expect(streamBody(sentence)).toEqual({ body: sentence, data: false })
  })

  it('题面数据：键丢掉、值按顺序摆出来，转义还原（这是字符串本来的样子）', () => {
    const json = '{"stem":"如图，$AB$ 是 $\\\\odot O$ 的直径。","answerText":"40°","solution":["由圆周角定理可得。"]}'
    const { body, data } = streamBody(json)
    expect(data).toBe(true)
    expect(body).toBe('如图，$AB$ 是 $\\odot O$ 的直径。\n40°\n由圆周角定理可得。')
    // 键（stem / answerText）是给程序看的，一个都不许出现在老师眼前
    expect(body).not.toContain('stem')
  })

  it('正在写的那几个字不许丢：尾巴上还没闭合的那一段也要摆出来', () => {
    const { body, data } = streamBody('{"stem":"如图，$AB$ 是 $\\odot O$ 的直径，点 $C$ 在劣')
    expect(data).toBe(true)
    expect(body.endsWith('点 $C$ 在劣')).toBe(true)
  })

  it('一个值都挑不出（半截的键名）就退回原文——宁可摆原文，也不许编、也不许留空', () => {
    const { body, data } = streamBody('{"knowle')
    expect(data).toBe(true)
    expect(body).toBe('{"knowle')
    expect(body.trim()).not.toBe('')
  })

  it('工具参数那种纯数字/英文的字典：退回原文，不假装是它说的话', () => {
    const { body } = streamBody('{"seed":7,"count":3}')
    expect(body).toBe('{"seed":7,"count":3}')
  })
})
