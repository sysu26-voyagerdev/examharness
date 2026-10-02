import { useEffect, useState } from 'react'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { AppSettingsView } from '../types.js'

/**
 * 设置：**能改的都当场生效，改不了的明说**。
 *
 * 密钥这块照 DeepSeek Harness 的做法（docs/agent/06 ADR-0022）：
 *   - 后端只回 {已配置/未配置, 来源, 能不能改}，**值从不回传**；所以界面上永远看不到密钥；
 *   - 因为看不到，就**不能整体替换**设置：写入是按路径的补丁（`{path, value}`），
 *     否则"保存"会把界面从没见过的密钥一起删掉；
 *   - 写入带修订号：别人改过了就明确报冲突，而不是默默覆盖。
 */

const MODEL_KEY_REF = 'model.apiKeyEnv'

/** 按叶子路径比对出补丁（数组整片替换，对象逐层下钻） */
function diffOps(base: unknown, next: unknown, path: readonly string[] = []): api.SettingsOp[] {
  if (base === next) return []
  const bothObjects =
    typeof base === 'object' && base !== null && typeof next === 'object' && next !== null && !Array.isArray(base) && !Array.isArray(next)
  if (!bothObjects) return [{ path, value: next }]
  const keys = new Set([...Object.keys(base as object), ...Object.keys(next as object)])
  return [...keys].flatMap((key) =>
    key === MODEL_KEY_REF.split('.').at(-1) && path.length === 1 && path[0] === 'model'
      ? [] // 密钥引用名不在界面上改
      : diffOps((base as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], [...path, key]),
  )
}

export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const { settings, busy, error } = app
  const [draft, setDraft] = useState<AppSettingsView | null>(null)
  const [saved, setSaved] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([])
  const [fetching, setFetching] = useState(false)

  // 只灌一次：之后 SSE 触发的 reload 不该把正在编辑的内容冲掉
  useEffect(() => {
    if (draft === null && settings !== null) {
      const { apiKey: _ignored, ...model } = settings.app.model
      setDraft({ ...settings.app, model })
    }
  }, [settings, draft])

  if (settings === null || draft === null) {
    return (
      <div className="page">
        <div className="wrap">
          <div className="hint">正在读取设置…</div>
        </div>
      </div>
    )
  }

  const runtime = settings.runtime
  const key = settings.app.model.apiKey
  const edit = (patch: Partial<AppSettingsView>): void => {
    setDraft({ ...draft, ...patch })
    setSaved('')
  }
  const dirs = draft.corpusDirs
  const setDir = (index: number, value: string): void => edit({ corpusDirs: dirs.map((dir, at) => (at === index ? value : dir)) })

  /** 保存：只发改动过的那几片（整体替换会删掉密钥） */
  const save = (): void => {
    const ops = diffOps(settings.app, { ...draft, model: { ...draft.model, apiKeyEnv: settings.app.model.apiKeyEnv } })
    if (ops.length === 0) {
      setSaved('没有改动')
      return
    }
    void app.guard('settings', async () => {
      await api.patchSettings(ops, settings.revision)
      setSaved(`已保存 ${String(ops.length)} 项（立刻生效）`)
      await app.reload()
    })
  }

  const saveKey = (): void => {
    if (keyInput === '') return
    void app.guard('key', async () => {
      await api.setCredential(key.ref, keyInput)
      setKeyInput('')
      setSaved('密钥已保存（只进不出，界面上不会再显示）')
      await app.reload()
    })
  }

  const clearKey = (): void => {
    void app.guard('key', async () => {
      await api.setCredential(key.ref, null)
      setSaved('密钥已清除')
      await app.reload()
    })
  }

  const fetchModels = (): void => {
    setFetching(true)
    void app
      .guard('models', async () => {
        // 先试后存：输入框里刚填的新密钥可以一次性带上，不落盘
        const result = await api.discoverModels(
          draft.model.baseUrl,
          keyInput === '' ? undefined : keyInput,
        )
        setModels(result.models)
        setSaved(`拉到 ${String(result.models.length)} 个模型`)
      })
      .finally(() => setFetching(false))
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="pagehd">
          <h1>设置</h1>
          <span className="hint">{saved === '' ? '改动即时生效，落盘 data/settings.json' : saved}</span>
          <span className="r">
            <button className="pri" disabled={busy !== ''} onClick={save}>
              保存
            </button>
          </span>
        </div>

        {error !== '' && <div className="hint err">{error}</div>}

        {/* ── 模型（照 DSH 的模型卡片：地址 / 密钥 / 模型 / 拉列表）── */}
        <div className="panel card2">
          <div className="grid2">
            <div className="field">
              <label>API 地址</label>
              <input
                value={draft.model.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(event) => edit({ model: { ...draft.model, baseUrl: event.target.value } })}
              />
            </div>
            <div className="field">
              <label>模型</label>
              <input
                value={draft.model.model}
                placeholder="deepseek-chat"
                list="model-options"
                onChange={(event) => edit({ model: { ...draft.model, model: event.target.value } })}
              />
              <datalist id="model-options">
                {models.map((entry) => (
                  <option key={entry.id} value={entry.id} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="field">
            <label>
              API 密钥　<span className="mono">{key.ref}</span>
            </label>
            {key.source === 'env' ? (
              <div className="hint">由启动环境提供（只读）：界面改不了，改环境变量再启动</div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <input
                  type="password"
                  style={{ flex: 1 }}
                  value={keyInput}
                  autoComplete="off"
                  placeholder={key.configured ? '已配置——输入新值可替换' : '还没配置'}
                  onChange={(event) => setKeyInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveKey()
                  }}
                />
                <button className="pri" disabled={busy !== '' || keyInput === ''} onClick={saveKey}>
                  保存密钥
                </button>
                {key.configured && (
                  <button className="ghost" disabled={busy !== ''} onClick={clearKey}>
                    清除
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="acts">
            <span className="hint">
              密钥只写不读：存 data/credentials.json（0600），从不回传界面。
              当前：
              {runtime.modelConfigured ? `已配置（${runtime.modelName}，来源 ${runtime.modelSource}）` : '未配置——工作台会拒绝运行'}
            </span>
            <button className="ghost" disabled={busy !== '' || fetching} onClick={fetchModels}>
              获取可用模型
            </button>
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
                真实题库/教材整理件放这里；agent 从知识库抽出来的题落 corpus/extracted
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
                onChange={(event) => edit({ sessionDefaults: { ...draft.sessionDefaults, className: event.target.value } })}
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
            <dt>设置修订号</dt>
            <dd className="mono">r{settings.revision}</dd>
            <dt>需重启才生效</dt>
            <dd className="mono">
              {runtime.restartRequired.length === 0 ? '无（都是热设置）' : runtime.restartRequired.join('、')}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  )
}
