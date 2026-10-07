import { settingsOps } from '@examharness/plugin-web'
import { describe, expect, it } from 'vitest'

/**
 * 设置改动的路径写法。
 *
 * 真实事故：按"点号字符串"送 `"model.model"`，而底层把 path 当**数组**用，
 * 于是它被逐字符拆成 `{m:{o:{d:{e:{l:{".":…}}}}}}` —— 设置文件被写进一份
 * 谁都不认识的覆盖层，**模型却没换**（界面照旧显示旧模型，看着像"改了没反应"）。
 * 所以：两种写法都收，别的形状**当场报错**。
 */
describe('设置改动的路径', () => {
  it('数组路径照旧', () => {
    expect(settingsOps([{ path: ['model', 'model'], value: 'deepseek-chat' }])).toEqual([
      { path: ['model', 'model'], value: 'deepseek-chat' },
    ])
  })

  it('点号字符串也认（人和 agent 手写更顺手）', () => {
    expect(settingsOps([{ path: 'model.model', value: 'deepseek-chat' }])).toEqual([
      { path: ['model', 'model'], value: 'deepseek-chat' },
    ])
  })

  it('unset 照旧只带路径', () => {
    expect(settingsOps([{ path: 'm', unset: true }])).toEqual([{ path: ['m'], unset: true }])
  })

  it('别的形状当场报错，不许默默写下去', () => {
    expect(() => settingsOps([{ path: 3, value: 1 }])).toThrow(/op\.path/)
    expect(() => settingsOps([{ path: [], value: 1 }])).toThrow(/op\.path/)
    expect(() => settingsOps([{ path: ['a', 2], value: 1 }])).toThrow(/op\.path/)
    expect(() => settingsOps('model.model')).toThrow(/ops 必须是数组/)
  })
})
