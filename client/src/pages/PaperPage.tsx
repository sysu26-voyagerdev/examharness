import { useCallback, useEffect, useMemo, useState } from 'react'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import SendIcon from '@mui/icons-material/Send'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import { BlueprintDialog } from '../blueprint-dialog.js'
import { AgentComposer, AgentPane } from '../agent-pane.js'
import { PaperView, ReviseDialog, humanLine, questionNumbers } from '../components.js'
import { forWorkspace } from '../log.js'
import { Rail, Sash, usePanes } from '../panes.js'
import { IndexPane } from '../index-pane.js'
import type { ItemView, VersionView } from '../types.js'

/**
 * 一张卷子：**一屏三栏 + 一条底栏**。
 *
 * 为什么是这样（Office / VS Code 的答案）：文档占主位，动作在顶栏按任务分组，
 * 索引与 agent 是常驻窗格（可拖宽、可折成窄条、不遮挡），事实在底栏一直看得见。
 * 抽屉不行——它遮住内容，而"看着它改"正是这个产品的全部价值所在。
 *
 * 一栏只显示**这一次出题**的 loop：一次出题 = 一个会话 = 一张卷子，
 * 切会话就整屏都换，别的出题在别处跑（顶栏只提示一句），绝不并排串流。
 */

/** 两版之间的题位变化（服务端只算最新一版，界面要能看任意两版） */
function diffVersions(before: VersionView | undefined, after: VersionView): readonly { slot: string; change: 'added' | 'removed' | 'replaced' | 'same'; from?: string; to?: string }[] {
  if (before === undefined) return []
  const slots = new Set([...before.bindings.map((b) => b.slot), ...after.bindings.map((b) => b.slot)])
  return [...slots].toSorted().map((slot) => {
    const a = before.bindings.find((b) => b.slot === slot)
    const b = after.bindings.find((c) => c.slot === slot)
    if (a === undefined && b !== undefined) return { slot, change: 'added' as const, to: b.itemId }
    if (a !== undefined && b === undefined) return { slot, change: 'removed' as const, from: a.itemId }
    if (a !== undefined && b !== undefined && a.itemId !== b.itemId) return { slot, change: 'replaced' as const, from: a.itemId, to: b.itemId }
    return { slot, change: 'same' as const }
  })
}

export function PaperPage(): React.JSX.Element {
  const app = useApp()
  const { session, state, log, running, elsewhere, doing, stream } = app
  const panes = usePanes()

  const [draft, setDraft] = useState('')
  const [answers, setAnswers] = useState(false)
  const [viewVersion, setViewVersion] = useState<number | null>(null)
  const [editingBlueprint, setEditingBlueprint] = useState(false)
  const [revising, setRevising] = useState<{ slot: string; item: ItemView } | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const versions = session?.versions ?? []
  const latest = versions.at(-1)
  const shown = useMemo(
    () => (viewVersion === null ? latest : versions.find((v) => v.version === viewVersion)),
    [latest, versions, viewVersion],
  )
  const viewingOld = shown !== undefined && latest !== undefined && shown.version !== latest.version

  const itemsById = useMemo(() => {
    const map = new Map<string, ItemView>()
    for (const item of state?.items ?? []) map.set(item.id, item)
    for (const item of session?.slots ?? []) map.set(item.id, item)
    return map
  }, [session, state])

  const rows = (shown?.bindings ?? []).flatMap((binding) => {
    const item = itemsById.get(binding.itemId)
    return item === undefined ? [] : [{ binding, item }]
  })

  const frozen = session?.meta.frozen === true
  /** 系统编号（S3-1）在界面上**不存在**：一律翻成"第 3 题" */
  const numbers = useMemo(() => questionNumbers(rows), [rows])
  const translate = useCallback(
    (text: string): string =>
      humanLine(text, (slot) => {
        const number = numbers.get(slot)
        return number === undefined ? undefined : `第 ${String(number)} 题`
      }),
    [numbers],
  )
  const entries = useMemo(() => forWorkspace(log, session?.meta.id ?? ''), [log, session?.meta.id])

  /** 底栏的事实：一直看得见，不用问人 */
  const facts = useMemo(() => {
    const unconfirmed = rows.filter(({ binding }) => binding.confirmedBy === null).length
    const gaps = shown?.gaps.length ?? 0
    const scores = rows.map(({ item }) => item.difficulty).filter((d): d is readonly [number, number] => d !== undefined)
    const low = scores.length === 0 ? 0 : Math.min(...scores.map((d) => d[0]))
    const high = scores.length === 0 ? 0 : Math.max(...scores.map((d) => d[1]))
    return { unconfirmed, gaps, low, high, count: rows.length }
  }, [rows, shown])

  /** 说了就办：它空闲就开一轮；它正忙就插进去（不挡老师，也不打断它） */
  const send = (): void => {
    const text = draft.trim()
    void app.ask(text === '' ? '按设定出一份卷子' : text)
    setDraft('')
    setViewVersion(null)
  }

  const regenerateAll = useCallback((): void => {
    void app.guard('assemble', async () => {
      await api.assemble('再出一版')
      setViewVersion(null)
      await app.reload()
    })
  }, [app])

  useEffect(() => {
    setViewVersion(null)
  }, [session?.meta.id])

  const document = (
    <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', bgcolor: 'action.hover' }}>
      <PaperView
        version={shown}
        paperTitle={session?.blueprint.paper.title ?? '试卷'}
        rows={rows}
        changes={shown === undefined ? [] : diffVersions(versions[shown.version - 2], shown)}
        frozen={frozen}
        viewingOld={viewingOld}
        busy={app.busyWith('regen') || app.busyWith('confirm')}
        bankSize={state?.items.length ?? 0}
        answers={answers}
        chrome="doc"
        onSyncHeader={(totalScore) =>
          void app.guard('blueprint', async () => {
            const current = await api.getBlueprint()
            await api.patchBlueprint({ paper: { ...current.blueprint.paper, totalScore } }, current.revision)
            await app.reload()
          })
        }
        onRegenerate={(slotKey) =>
          void app.guard(`regen:${slotKey}`, async () => {
            const result = await api.regenerate(slotKey)
            if (!result.ok) throw new Error(result.reason ?? '这道题没能重做，换个要求再试')
            setViewVersion(null)
            await app.reload()
          })
        }
        onRevise={(slotKey, item) => setRevising({ slot: slotKey, item })}
        onConfirm={(itemId) =>
          void app.guard(`confirm:${itemId}`, async () => {
            await api.confirmItem(itemId, '老师')
            await app.reload()
          })
        }
        onPatchText={(itemId, stem) => api.patchItem(itemId, { stem })}
        onDelete={(slotKey) =>
          void app.guard(`clear:${slotKey}`, async () => {
            await api.clearSlot(slotKey)
            await app.reload()
          })
        }
        onAssemble={regenerateAll}
      />
    </Box>
  )

  const agent = (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <AgentPane
          entries={entries}
          running={running}
          doing={doing}
          stream={stream}
          translate={translate}
          onExample={(example) => setDraft(example)}
          onStop={() => void app.stopRun()}
        />
      </Box>
      <AgentComposer
        draft={draft}
        onDraft={setDraft}
        onSend={send}
        running={running}
        elsewhere={elsewhere}
      />
    </Box>
  )

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* 这一张卷子的动词：少而稳定，其余全靠说话 */}
      <Stack direction="row" spacing={1} sx={{ px: 2, py: 0.75, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }} data-print-hide>
        <Typography variant="subtitle2">{session?.meta.title ?? '（没有卷子）'}</Typography>
        <Chip size="small" variant="outlined" label={session?.meta.className ?? ''} />
        {frozen && <Chip size="small" color="warning" variant="outlined" label="已定稿" />}
        {viewingOld && (
          <Chip size="small" color="info" variant="outlined" label={`在看第 ${String(shown?.version ?? 0)} 版`} onClick={() => setViewVersion(null)} />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<SettingsOutlinedIcon />} onClick={() => setEditingBlueprint(true)}>
          设定
        </Button>
        <Button size="small" variant="outlined" disabled={frozen || app.busyWith('assemble')} onClick={regenerateAll}>
          再出一版
        </Button>
        <Button size="small" startIcon={<HistoryOutlinedIcon />} disabled={versions.length === 0} onClick={() => setVersionsOpen((value) => !value)}>
          版本
        </Button>
        <Button
          size="small"
          startIcon={<FactCheckOutlinedIcon />}
          disabled={rows.length === 0}
          onClick={() => {
            setAnswers(true)
            app.go('check')
          }}
        >
          体检
        </Button>
        <Button
          size="small"
          variant="contained"
          disableElevation
          startIcon={<DownloadOutlinedIcon />}
          disabled={versions.length === 0}
          href={api.exportUrl('html')}
        >
          导出
        </Button>
      </Stack>

      {versionsOpen && versions.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ px: 2, py: 0.75, alignItems: 'center', flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }} data-print-hide>
          <Typography variant="caption" color="text.secondary">
            版本历史
          </Typography>
          {versions
            .toReversed()
            .slice(0, 12)
            .map((version) => (
              <Chip
                key={version.version}
                size="small"
                variant={shown?.version === version.version ? 'filled' : 'outlined'}
                color={shown?.version === version.version ? 'primary' : 'default'}
                label={`第 ${String(version.version)} 版 · ${String(version.bindings.length)} 题`}
                onClick={() => setViewVersion(version.version)}
              />
            ))}
          <TextField
            select
            size="small"
            value=""
            onChange={(event) => setViewVersion(Number(event.target.value))}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">更早的版本…</MenuItem>
            {versions
              .toReversed()
              .slice(12, 80)
              .map((version) => (
                <MenuItem key={version.version} value={version.version}>
                  第 {String(version.version)} 版（{String(version.bindings.length)} 题 · {String(version.totalScore)} 分）
                </MenuItem>
              ))}
          </TextField>
          {viewingOld && (
            <>
              <Chip size="small" variant="outlined" label="回到最新" onClick={() => setViewVersion(null)} />
              <Button
                size="small"
                variant="outlined"
                disabled={frozen || app.busyWith('restore')}
                onClick={() =>
                  void app.guard('restore', async () => {
                    await api.restoreVersion(shown?.version ?? 0)
                    setViewVersion(null)
                    await app.reload()
                  })
                }
              >
                退回这一版
              </Button>
            </>
          )}
        </Stack>
      )}

      {/* 三栏：索引 | 卷子 | agent（可拖宽、双击复位、可折成窄条） */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {panes.panes.leftOpen ? (
          <>
            <IndexPane
              rows={rows}
              width={panes.panes.left}
              onClose={panes.toggleLeft}
              onRevise={(slot, item) => setRevising({ slot, item })}
            />
            <Sash orientation="vertical" onPointerDown={panes.beginDrag('left')} onDoubleClick={() => panes.reset('left')} />
          </>
        ) : (
          <Rail title="索引" side="left" onClick={panes.toggleLeft} />
        )}

        {/*
          卷面：文档占主位。除了拖动的护栏（panes.tsx），这里再兜一道 CSS 底线——
          宁可整屏出现横向滚动，也不把卷子挤成一条（用户："拉大时有问题"）。
        */}
        <Box sx={{ flex: 1, minWidth: 'min(100%, 520px)', minHeight: 0, display: 'flex', flexDirection: 'column' }}>{document}</Box>

        {panes.panes.rightOpen ? (
          <>
            <Sash orientation="vertical" onPointerDown={panes.beginDrag('right')} onDoubleClick={() => panes.reset('right')} />
            <Box
              sx={{
                width: panes.panes.right,
                flexShrink: 0,
                borderLeft: 1,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
              }}
            >
              {agent}
            </Box>
          </>
        ) : (
          <Rail title="agent" side="right" onClick={panes.toggleRight} />
        )}
      </Box>

      {/* 底栏：左边是这张卷子的两种视图，右边是一直要看的事实 */}
      <Stack
        direction="row"
        spacing={1.5}
        data-print-hide
        sx={{ px: 1.5, py: 0.5, alignItems: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', flexWrap: 'wrap' }}
      >
        <Chip size="small" variant={answers ? 'outlined' : 'filled'} color={answers ? 'default' : 'primary'} label="试卷" onClick={() => setAnswers(false)} />
        <Chip size="small" variant={answers ? 'filled' : 'outlined'} color={answers ? 'primary' : 'default'} label="答案与解析" onClick={() => setAnswers(true)} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {facts.count} 题 · {String(shown?.totalScore ?? 0)} 分 · {String(session?.blueprint.paper.minutes ?? 0)} 分钟
          {facts.count > 0 && ` · 难度 ${facts.low.toFixed(2)}–${facts.high.toFixed(2)}`}
        </Typography>
        {facts.count === 0 ? (
          <Typography variant="caption" color="text.secondary">
            还是空的
          </Typography>
        ) : facts.gaps > 0 ? (
          <Typography variant="caption" color="warning.main">
            还缺 {String(facts.gaps)} 道
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            齐了
          </Typography>
        )}
        {facts.unconfirmed > 0 && (
          <Typography variant="caption" color="text.secondary">
            {String(facts.unconfirmed)} 道没签字
          </Typography>
        )}
        {shown !== undefined && shown.scoreGap !== 0 && (
          <Typography variant="caption" color="warning.main">
            卷头差 {String(Math.abs(shown.scoreGap))} 分
          </Typography>
        )}
      </Stack>

      {revising !== null && (
        <ReviseDialog
          slot={revising.slot}
          item={revising.item}
          busy={app.busyWith('regen') || app.busyWith('confirm')}
          onClose={() => setRevising(null)}
          onRevise={async (slotKey, instruction) => {
            await api.reviseItem(slotKey, instruction)
            setViewVersion(null)
            await app.reload()
          }}
          onPatch={api.patchItem}
        />
      )}

      {editingBlueprint && (
        <BlueprintDialog
          onClose={() => {
            setEditingBlueprint(false)
            void app.reload()
          }}
        />
      )}

      {rows.length === 0 && shown === undefined && (
        <Alert severity="info" icon={<AutoAwesomeIcon />} sx={{ m: 2 }} data-print-hide>
          这份卷子还是空的。下边那句说一句就行（"初三二次函数，一道选择两道大题"），它会先给设计和题。
        </Alert>
      )}
    </Box>
  )
}
