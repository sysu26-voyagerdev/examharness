import type { Item, MaybePromise, Verdict } from './types.js'
// 必须真实导入被增强的模块：TS 只在模块已进入程序时才认这条声明合并
import '@deepseek-ai/cordis'

/**
 * 事件契约。事件名与分发模式在这里一次性登记（Cordis v4 的声明合并）。
 *
 * `item:verify` 用 **waterfall**：每个闸门是一层环绕中间件，
 *   拿到 (item, next)，可裁决（短路返回失败）或放行（`return next()`）。
 *   **验证不能被被验证者调度**——闸门由框架挂载，agent 既不能跳过也不能改写。
 *
 * 注意：Cordis 的 waterfall 本身不 await，因此监听者若需要异步（子进程、模型调用），
 *   必须写成 `async (item, next) => { ... return next() }` 并在调用侧 `await`。
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 闸门链：任一层可短路否决（返回失败判定），否则必须 `return next()` */
    'item:verify'(item: Item, next: () => MaybePromise<Verdict>): MaybePromise<Verdict>
    /** 提交成功、已入库（emit，仅广播） */
    'item:stored'(payload: { item: Item }): void
    /** 被闸门拦下（emit，仅广播；用于界面与轨迹） */
    'item:rejected'(payload: { item: Item; verdict: Verdict }): void
    /** 老师签了字（emit，仅广播；R4 的留痕） */
    'item:confirmed'(payload: { item: Item; by: string }): void
    /** 工作台的一步（emit，仅广播；界面实时显示 agent 在干什么） */
    'run:step'(payload: { step: number; kind: 'assistant' | 'tool' | 'gate'; text: string }): void
  }
}
