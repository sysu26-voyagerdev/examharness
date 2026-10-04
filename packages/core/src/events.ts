import type { Item, MaybePromise, Verdict } from './types.js'
import type { LlmDeltaKind } from './services.js'
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
    /** 一轮 agent 循环开始（emit，仅广播；界面据此把"正在跑"显示出来） */
    'run:started'(payload: {
      runId: string
      goal: string
      workspace: string
      label?: string
      /** 这一轮是哪个 agent 派出来的（没有 = 老师直接起的） */
      parent?: string
    }): void
    /** 工作台的一步（emit，仅广播；界面实时显示 agent 在干什么） */
    'run:step'(payload: {
      runId: string
      step: number
      kind: 'assistant' | 'tool' | 'gate' | 'user'
      text: string
      /** 属于哪个工作区：界面靠它把"这个会话的活"和"这一批资料的活"分开 */
      workspace: string
      /** 哪一个 agent 做的（子任务与主任务共用一条时间线时靠它分组） */
      agent?: string
    }): void
    /**
     * **正要做什么**（工具调用开始前就推）：
     * 一次模型调用 + 一次工具跑动可能要几十秒，只在结束时推消息，界面看着像卡住了。
     */
    'run:busy'(payload: { runId: string; agent: string; what: string; workspace: string }): void
    /**
     * **模型正在写什么**（流式）：每吐出一段就发一次，只用于界面实时显示。
     *
     * 它不是记录：记录只认走完的 `run:step`（一段流打完才是一条事实）。
     * 界面拿它显示在最下面那一小块浅字里——十几秒没有输出的时候，那一块是活的。
     *
     * `kind` 是**哪一路**（见 `LlmDeltaKind`）：`think` = 它在想（提供方的 `reasoning_content`，
     * 一个带工具的回合里先来的就是它），`say` = 它写给人看的正文，
     * `use` = 它开始给工具填参数了（这时 `text` 是**工具名**，参数本身不摆出来）。
     * 三路必须分开送：合成一段就等于把"它在想""它在填参数"冒充成"它写出来的话"。
     */
    'llm:delta'(payload: {
      runId: string
      label: string
      kind: LlmDeltaKind
      text: string
      workspace: string
    }): void
    /** 一轮结束（emit，仅广播；界面据此收尾并刷新数据） */
    'run:done'(payload: {
      runId: string
      stopped: 'done' | 'no-llm' | 'stopped' | 'error'
      steps: number
      label?: string
      parent?: string
      stored: readonly string[]
      workspace: string
    }): void
    /** 设置被改（emit，仅广播） */
    'settings:changed'(payload: { restartRequired: readonly string[] }): void
    /** 知识库状态变化（emit，仅广播；界面看得到"整理到哪一步了"） */
    'kb:changed'(payload: { batchId: string; status: string; records?: number }): void
    /** 工作区变了（agent 写了文件 / 跑了命令；界面可以刷新"这一轮留下了什么"） */
    'workspace:changed'(payload: { name: string; files: number }): void
  }
}
