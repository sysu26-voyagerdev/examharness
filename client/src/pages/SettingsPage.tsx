import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined'
import { gateLabel } from '../log.js'
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

/** 设置页里给"检查"起的中文名（比闸门名好懂） */
const GATE_TEXT: Readonly<Record<string, string>> = {
  'verify-scope': '不超纲',
  'verify-symbolic': '算式核对',
  'verify-dedup': '不与旧题重复、不是抄原题',
  'verify-figure': '图形自洽',
  'verify-roundtrip': '题面忠实（回译对得上）',
  'verify-parts': '分量够（解答题要分问）',
  'verify-options': '选项可判（选择题四个选项）',
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
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">设置</Typography>
        <Typography variant="caption" color="text.secondary">
          {note === '' ? '改完点保存，立刻生效' : note}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="small" disabled={busy !== ''} onClick={save}>
          保存
        </Button>
      </Stack>

      <Card sx={{ mb: 2 }}>
        <CardHeader title="模型" subheader="地址、密钥、型号；密钥只写不读，页面上不会回显" />
        <CardContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
          <TextField
            label="API 地址"
            value={draft.model.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(event) => edit({ model: { ...draft.model, baseUrl: event.target.value } })}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
            <TextField
              label="模型"
              fullWidth
              value={draft.model.model}
              placeholder="deepseek-chat"
              onChange={(event) => edit({ model: { ...draft.model, model: event.target.value } })}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={busy !== '' || fetching}
              onClick={fetchModels}
              sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {fetching ? '正在取…' : '获取可用模型'}
            </Button>
          </Stack>
          <TextField
            select
            label="思考等级"
            value={draft.model.reasoningEffort ?? ''}
            helperText="想得越少越快。实测同一段上下文：默认 2.5 秒/步、想 1214 字；低 1.8 秒、想 417 字，出的工具一样。"
            onChange={(event) => edit({ model: { ...draft.model, reasoningEffort: event.target.value } })}
          >
            <MenuItem value="">提供方默认</MenuItem>
            <MenuItem value="minimal">最低</MenuItem>
            <MenuItem value="low">低（推荐）</MenuItem>
            <MenuItem value="medium">中</MenuItem>
            <MenuItem value="high">高</MenuItem>
          </TextField>
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
            </Typography>
            {key.source === 'env' ? (
              <Typography variant="caption">由启动时的环境变量提供，页面上改不了：改环境变量再重启。</Typography>
            ) : (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
              </Stack>
            )}
            <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
              密钥只写不读：存在本机的 data/credentials.json（只有本人可读），
              页面和接口都不会把它读回来。变量名 {key.ref} 只在启动时用得到。
              {runtime.modelConfigured ? `　当前可用：${runtime.modelName}` : '　当前还没有可用的模型。'}
            </Typography>
          </Box>
        </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardHeader title="联网搜索" />
        <CardContent sx={{ pt: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
          <Switch
            checked={draft.websearch.enabled}
            onChange={(event) => edit({ websearch: { ...draft.websearch, enabled: event.target.checked } })}
          />
          <Typography variant="body2">允许 agent 上网查资料</Typography>
        </Stack>
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
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardHeader title="资料目录" />
        <CardContent sx={{ pt: 0 }}>
        <Stack spacing={1}>
          {dirs.map((dir, index) => (
            <Stack key={`${dir}-${String(index)}`} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                fullWidth
                value={dir}
                onChange={(event) => edit({ corpusDirs: dirs.map((entry, at) => (at === index ? event.target.value : entry)) })}
              />
              <Button size="small" onClick={() => edit({ corpusDirs: dirs.filter((_, at) => at !== index) })}>
                移除
              </Button>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" onClick={() => edit({ corpusDirs: [...dirs, 'corpus/'] })}>
              加一条
            </Button>
            <Typography variant="caption" sx={{ flex: 1 }}>
              agent 从资料里抽出来的题会落在 corpus/extracted。
            </Typography>
          </Stack>
        </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardHeader title="判重标准" />
        <CardContent sx={{ pt: 0 }}>
        <Stack direction="row" spacing={2}>
          <TextField
            label="数字重合度"
            helperText="题面里的数与原题有多重合"
            type="number"
            value={draft.gates.corpusNumbersMin}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, corpusNumbersMin: Number(event.target.value) } })}
          />
          <TextField
            label="措辞相似度"
            helperText="句子写得有多像"
            type="number"
            value={draft.gates.corpusWordingMax}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, corpusWordingMax: Number(event.target.value) } })}
          />
          <TextField
            label="与自家题库"
            helperText="超过就当撞题"
            type="number"
            value={draft.gates.bankMaxSimilarity}
            slotProps={{ htmlInput: { step: 0.05, min: 0, max: 1 } }}
            onChange={(event) => edit({ gates: { ...draft.gates, bankMaxSimilarity: Number(event.target.value) } })}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          与资料里的题比对时，**数字**与**措辞**同时超过标准才算"太像"——
          只看措辞会把"同一知识点、换了数字"的题全误伤。与自家题库那条是撞题线：超过就当重复。
        </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardHeader title="新会话默认值" />
        <CardContent sx={{ pt: 0 }}>
        <Stack spacing={2}>
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
        </Stack>
        </CardContent>
      </Card>

      {/* 现状：**说人话**。内部名字（题型 id、闸门 id）留给日志，
          这里只回答两个问题：现在能出什么题、每道题要过哪几关。 */}
      <Card>
        <CardHeader title="现在的状况" subheader="出题前先看一眼，心里有数" />
        <CardContent sx={{ pt: 0 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip size="small" variant="outlined" label={`能出 ${String(runtime.constructors.length)} 种题型`} />
              <Chip
                size="small"
                variant="outlined"
                label={runtime.corpusTotal === 0 ? '还没导入资料' : `资料里的题 ${String(runtime.corpusTotal)} 条`}
              />
              {runtime.corpusTotal > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={runtime.corpusDistributable > 0 ? 'default' : 'warning'}
                  label={`可对外用 ${String(runtime.corpusDistributable)} 条`}
                />
              )}
            </Stack>
            <Box>
              <Typography variant="caption" color="text.secondary">
                每道题都要过这几关
              </Typography>
              <Typography variant="body2">{runtime.gates.map((gate) => GATE_TEXT[gate] ?? gateLabel(gate)).join(' → ')}</Typography>
            </Box>
            <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />} sx={{ px: 0, minHeight: 32 }}>
                <Typography variant="caption" color="text.secondary">
                  看细节（题型与技术名字）
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 0 }}>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
                  {runtime.constructors.join('、')}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block', mt: 1, wordBreak: 'break-all' }}>
                  {runtime.gates.join(' → ')}
                </Typography>
              </AccordionDetails>
            </Accordion>
            {runtime.corpusTotal === 0 && (
              <Typography variant="caption" color="text.secondary">
                资料是空的时候：出题不会拿它做参考，判重也只跟自家题库比。
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  )
}
