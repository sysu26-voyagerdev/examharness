import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Flex } from '../components.js'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { AppSettingsView } from '../types.js'

/**
 * 设置：模型、联网、资料目录、新会话默认值、判重标准。
 *
 * 两条规矩：
 *   1. **密钥只写不读**——页面上永远看不到它，只显示"配没配"和"从哪来"（照 DSH 的做法）；
 *   2. 保存是**按路径改**而不是整体覆盖：界面看不到密钥，整体覆盖会把它一起抹掉。
 */

function diffOps(base: unknown, next: unknown, path: readonly string[] = []): api.SettingsOp[] {
  if (base === next) return []
  const bothObjects =
    typeof base === 'object' && base !== null && typeof next === 'object' && next !== null && !Array.isArray(base) && !Array.isArray(next)
  if (!bothObjects) return [{ path, value: next }]
  return [...new Set([...Object.keys(base as object), ...Object.keys(next as object)])].flatMap((key) =>
    // 密钥的引用名不在界面上改
    path.length === 1 && path[0] === 'model' && key === 'apiKeyEnv'
      ? []
      : diffOps((base as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], [...path, key]),
  )
}

export function SettingsPage(): React.JSX.Element {
  const app = useApp()
  const { settings, busy } = app
  const [draft, setDraft] = useState<AppSettingsView | null>(null)
  const [note, setNote] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([])
  const [fetching, setFetching] = useState(false)

  // 只灌一次：后台刷新不该把正在编辑的内容冲掉
  useEffect(() => {
    if (draft === null && settings !== null) {
      const { apiKey: _info, ...model } = settings.app.model
      setDraft({ ...settings.app, model })
    }
  }, [settings, draft])

  if (settings === null || draft === null) {
    return (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          正在读取…
        </Typography>
      </Container>
    )
  }

  const runtime = settings.runtime
  const key = settings.app.model.apiKey
  const edit = (patch: Partial<AppSettingsView>): void => {
    setDraft({ ...draft, ...patch })
    setNote('')
  }
  const dirs = draft.corpusDirs

  const save = (): void => {
    const ops = diffOps(settings.app, { ...draft, model: { ...draft.model, apiKeyEnv: settings.app.model.apiKeyEnv } })
    if (ops.length === 0) {
      setNote('没有改动')
      return
    }
    void app.guard('settings', async () => {
      await api.patchSettings(ops, settings.revision)
      setNote('已保存')
      await app.reload()
    })
  }

  const saveKey = (): void => {
    if (keyInput === '') return
    void app.guard('key', async () => {
      await api.setCredential(key.ref, keyInput)
      setKeyInput('')
      setNote('密钥已保存（页面上不会再显示它）')
      await app.reload()
    })
  }

  const fetchModels = (): void => {
    setFetching(true)
    void app
      .guard('models', async () => {
        const result = await api.discoverModels(draft.model.baseUrl, keyInput === '' ? undefined : keyInput)
        setModels(result.models)
        setNote(`找到了 ${String(result.models.length)} 个模型`)
      })
      .finally(() => setFetching(false))
  }

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Flex row gap={2} align="center" sx={{ mb: 2 }}>
        <Typography variant="h2">设置</Typography>
        <Typography variant="caption">{note === '' ? '改完立刻生效' : note}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="small" disabled={busy !== ''} onClick={save}>
          保存
        </Button>
      </Flex>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          模型
        </Typography>
        <Flex gap={2}>
          <TextField
            label="API 地址"
            value={draft.model.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(event) => edit({ model: { ...draft.model, baseUrl: event.target.value } })}
          />
          <Flex row gap={1} align="flex-end">
            <TextField
              label="模型"
              fullWidth
              value={draft.model.model}
              placeholder="deepseek-chat"
              onChange={(event) => edit({ model: { ...draft.model, model: event.target.value } })}
            />
            <Button size="small" disabled={busy !== '' || fetching} onClick={fetchModels}>
              获取可用模型
            </Button>
          </Flex>
          {models.length > 0 && (
            <TextField
              select
              label="从拉到的列表里选"
              value=""
              onChange={(event) => edit({ model: { ...draft.model, model: event.target.value } })}
            >
              {models.map((entry) => (
                <MenuItem key={entry.id} value={entry.id}>
                  {entry.id}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Divider />
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              API 密钥
              <Typography component="span" variant="caption" sx={{ ml: 1, fontFamily: 'monospace' }}>
                {key.ref}
              </Typography>
            </Typography>
            {key.source === 'env' ? (
              <Typography variant="caption">由启动时的环境变量提供，页面上改不了：改环境变量再重启。</Typography>
            ) : (
              <Flex row gap={1} align="center">
                <TextField
                  fullWidth
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  placeholder={key.configured ? '已配置——输入新值可替换' : '还没有配置'}
                  onChange={(event) => setKeyInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveKey()
                  }}
                />
                <Button variant="contained" size="small" disabled={busy !== '' || keyInput === ''} onClick={saveKey}>
                  保存
                </Button>
                {key.configured && (
                  <Button
                    size="small"
                    disabled={busy !== ''}
                    onClick={() =>
                      void app.guard('key', async () => {
                        await api.setCredential(key.ref, null)
                        setNote('密钥已清除')
                        await app.reload()
                      })
                    }
                  >
                    清除
                  </Button>
                )}
              </Flex>
            )}
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              密钥只写不读：存本机 data/credentials.json（仅本人可读），页面与接口都不会回传它。
              {runtime.modelConfigured ? `　当前可用：${runtime.modelName}` : '　当前还没有可用的模型。'}
            </Typography>
          </Box>
        </Flex>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          联网搜索
        </Typography>
        <Flex row gap={1} align="center" sx={{ mb: 1.5 }}>
          <Switch
            checked={draft.websearch.enabled}
            onChange={(event) => edit({ websearch: { ...draft.websearch, enabled: event.target.checked } })}
          />
          <Typography variant="body2">允许 agent 上网查资料</Typography>
        </Flex>
        <TextField
          label="搜索网关"
          fullWidth
          value={draft.websearch.endpoint}
          placeholder="留空就是不启用"
          onChange={(event) => edit({ websearch: { ...draft.websearch, endpoint: event.target.value } })}
        />
        <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
          联网只是帮它找情境和数据；拦不拦得住抄原题，由判重负责。
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          资料目录
        </Typography>
        <Flex gap={1}>
          {dirs.map((dir, index) => (
            <Flex key={`${dir}-${String(index)}`} row gap={1} align="center">
              <TextField
                fullWidth
                value={dir}
                onChange={(event) => edit({ corpusDirs: dirs.map((entry, at) => (at === index ? event.target.value : entry)) })}
              />
              <Button size="small" onClick={() => edit({ corpusDirs: dirs.filter((_, at) => at !== index) })}>
                移除
              </Button>
            </Flex>
          ))}
          <Flex row gap={1} align="center">
            <Button size="small" onClick={() => edit({ corpusDirs: [...dirs, 'corpus/'] })}>
              加一条
            </Button>
            <Typography variant="caption" sx={{ flex: 1 }}>
              agent 从资料里抽出来的题会落在 corpus/extracted。
            </Typography>
          </Flex>
        </Flex>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          判重标准
        </Typography>
        <Flex row gap={2}>
          <TextField
            label="数字重合度"
            type="number"
            value={draft.gates.corpusNumbersMin}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, corpusNumbersMin: Number(event.target.value) } })}
          />
          <TextField
            label="措辞相似度"
            type="number"
            value={draft.gates.corpusWordingMax}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, corpusWordingMax: Number(event.target.value) } })}
          />
          <TextField
            label="与自家题库"
            type="number"
            value={draft.gates.bankMaxSimilarity}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, bankMaxSimilarity: Number(event.target.value) } })}
          />
        </Flex>
        <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
          数字和措辞**同时**超过标准，才算跟资料里那道题太像——只看措辞会把"同一知识点、换了数字"的题全误伤。
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          新会话默认值
        </Typography>
        <Flex gap={2}>
          <TextField
            label="班级"
            value={draft.sessionDefaults.className}
            onChange={(event) => edit({ sessionDefaults: { ...draft.sessionDefaults, className: event.target.value } })}
          />
          <TextField
            label="讲到哪里了"
            value={draft.sessionDefaults.progress}
            onChange={(event) => edit({ sessionDefaults: { ...draft.sessionDefaults, progress: event.target.value } })}
          />
          <TextField
            label="蓝图"
            value={draft.sessionDefaults.blueprintPath}
            onChange={(event) => edit({ sessionDefaults: { ...draft.sessionDefaults, blueprintPath: event.target.value } })}
          />
        </Flex>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography variant="h3" sx={{ mb: 1.5 }}>
          现在的状况
        </Typography>
        <Flex gap={0.75}>
          <Typography variant="body2">
            资料里的题：{runtime.corpusTotal} 条　可以对外用：{runtime.corpusDistributable} 条
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            能造的题型：{runtime.constructors.join('、')}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            出题时的检查顺序：{runtime.gates.join(' → ')}
          </Typography>
          {runtime.corpusTotal === 0 && (
            <Typography variant="caption">
              现在资料是空的：出题不会拿它做参考，判重也只会跟自家题库比。
            </Typography>
          )}
        </Flex>
      </Paper>
    </Container>
  )
}
