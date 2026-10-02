import { useEffect, useState } from 'react'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { AppSettingsView } from '../types.js'

/**
 * 设置：**能改的都当场生效，改不了的明说**。
 *
 * 分三块：热设置（落盘 data/settings.json，改完立刻生效）、装机配置（只读展示）、
 * 运行期观测值（语料条目、构造器、闸门链——这些是"现在系统里到底有什么"的事实）。
 * 密钥永远不在这里：它只从环境变量取，页面上只告诉你"配了没配"。
 */
export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const { settings, busy, error } = app
  const [draft, setDraft] = useState<AppSettingsView | null>(null)
  const [saved, setSaved] = useState(false)

  // 只灌一次：之后 SSE 触发的 reload 不该把正在编辑的内容冲掉
  useEffect(() => {
    if (draft === null && settings !== null) setDraft(structuredClone(settings.app))
  }, [settings, draft])

  if (settings === null || draft === null) return <div className="page"><div className="wrap"><div className="hint">正在读取设置…</div></div></div>
  const runtime = settings.runtime
  const edit = (patch: Partial<AppSettingsView>): void => {
    setDraft({ ...draft, ...patch })
    setSaved(false)
  }

  const save = (): void => {
    void app.guard('settings', async () => {
      await api.patchSettings(draft)
      setSaved(true)
      await app.reload()
    })
  }

  const dirs = draft.corpusDirs
  const setDir = (index: number, value: string): void => edit({ corpusDirs: dirs.map((dir, at) => (at === index ? value : dir)) })

  return (
    <div className="page">
      <div className="wrap">
        <div className="pagehd">
          <h1>设置</h1>
          <span className="hint">{saved ? '已保存（立刻生效）' : '改动即时生效，落盘 data/settings.json'}</span>
          <span className="r">
            <button className="pri" disabled={busy !== ''} onClick={save}>
              保存
            </button>
          </span>
        </div>

        {error !== '' && <div className="hint err">{error}</div>}

        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>模型网关</label>
              <input value={draft.model.baseUrl} onChange={(event) => edit({ model: { ...draft.model, baseUrl: event.target.value } })} />
            </div>
            <div className="field">
              <label>模型名</label>
              <input value={draft.model.model} onChange={(event) => edit({ model: { ...draft.model, model: event.target.value } })} />
            </div>
          </div>
          <div className="hint">
            密钥只从环境变量取（<span className="mono">EXAMHARNESS_API_KEY</span>），不写进仓库、不落在本页。
            当前：{runtime.modelConfigured ? `已配置，型号 ${runtime.modelName}` : '未配置——工作台会明确拒绝运行'}
          </div>
        </div>

        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>联网搜索</label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.websearch.enabled}
                  onChange={(event) => edit({ websearch: { ...draft.websearch, enabled: event.target.checked } })}
                />
                <span>启用（agent 才看得到 web_search 工具）</span>
              </label>
            </div>
            <div className="field">
              <label>搜索网关</label>
              <input
                value={draft.websearch.endpoint}
                placeholder="留空 = 用内置检索"
                onChange={(event) => edit({ websearch: { ...draft.websearch, endpoint: event.target.value } })}
              />
            </div>
          </div>
          <div className="hint">
            联网是**引导不是闸门**：它帮 agent 找情境，拦不拦得住抄原题由查重闸门负责。当前：
            {runtime.websearchEnabled ? '已开' : '未开'}
          </div>
        </div>

        <div className="panel card2">
          <div className="field">
            <label>语料目录（改完立刻重扫）</label>
            {dirs.map((dir, index) => (
              <div key={`${dir}-${String(index)}`} style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                <input value={dir} onChange={(event) => setDir(index, event.target.value)} style={{ flex: 1 }} />
                <button className="ghost" onClick={() => edit({ corpusDirs: dirs.filter((_, at) => at !== index) })}>
                  移除
                </button>
              </div>
            ))}
            <div className="acts">
              <button className="ghost" onClick={() => edit({ corpusDirs: [...dirs, 'corpus/'] })}>
                加一条
              </button>
              <span className="hint">
                真实题库/教材整理件放这里，默认不可对外分发（<span className="mono">distributable: false</span>）
              </span>
            </div>
          </div>
        </div>

        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>新建会话默认班级</label>
              <input
                value={draft.sessionDefaults.className}
                onChange={(event) =>
                  edit({ sessionDefaults: { ...draft.sessionDefaults, className: event.target.value } })
                }
              />
            </div>
            <div className="field">
              <label>默认教学进度</label>
              <input
                value={draft.sessionDefaults.progress}
                onChange={(event) => edit({ sessionDefaults: { ...draft.sessionDefaults, progress: event.target.value } })}
              />
            </div>
            <div className="field">
              <label>默认蓝图文件</label>
              <input
                value={draft.sessionDefaults.blueprintPath}
                onChange={(event) =>
                  edit({ sessionDefaults: { ...draft.sessionDefaults, blueprintPath: event.target.value } })
                }
              />
            </div>
          </div>
        </div>

        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>与语料库：措辞相似上限</label>
              <input
                className="mono"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={draft.gates.corpusWordingMax}
                onChange={(event) => edit({ gates: { ...draft.gates, corpusWordingMax: Number(event.target.value) } })}
              />
            </div>
            <div className="field">
              <label>与语料库：数字重合下限</label>
              <input
                className="mono"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={draft.gates.corpusNumbersMin}
                onChange={(event) => edit({ gates: { ...draft.gates, corpusNumbersMin: Number(event.target.value) } })}
              />
            </div>
            <div className="field">
              <label>与自家题库相似上限</label>
              <input
                className="mono"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={draft.gates.bankMaxSimilarity}
                onChange={(event) => edit({ gates: { ...draft.gates, bankMaxSimilarity: Number(event.target.value) } })}
              />
            </div>
          </div>
          <div className="hint">两条语料阈值要同时满足才算「抄原题」：只看措辞会把同知识点不同数值的题全误伤。</div>
        </div>

        <div className="panel card2">
          <div className="kpi">
            <div>
              语料条目
              <b>{runtime.corpusTotal}</b>
            </div>
            <div>
              可对外分发
              <b>{runtime.corpusDistributable}</b>
            </div>
            <div>
              构造器
              <b>{runtime.constructors.length}</b>
            </div>
          </div>
          <dl className="kv">
            <dt>来源分布</dt>
            <dd className="mono">
              {Object.entries(runtime.corpusBySource).length === 0
                ? '无'
                : Object.entries(runtime.corpusBySource)
                    .map(([source, count]) => `${source} ${String(count)}`)
                    .join('　')}
            </dd>
            <dt>构造器</dt>
            <dd className="mono">{runtime.constructors.join('、')}</dd>
            <dt>闸门链</dt>
            <dd className="mono">{runtime.gates.join(' → ')}</dd>
            <dt>需重启才生效</dt>
            <dd className="mono">{runtime.restartRequired.length === 0 ? '无（都是热设置）' : runtime.restartRequired.join('、')}</dd>
          </dl>
        </div>
      </div>
    </div>
  )
}
