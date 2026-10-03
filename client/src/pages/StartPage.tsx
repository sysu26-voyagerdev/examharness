import { useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import * as api from '../api.js'
import { useApp } from '../app-context.js'
import type { SessionMetaView } from '../types.js'

/**
 * 起始页：**回到那张卷子**，或者开一次新的出题。
 *
 * 老师的一天不是"登录进一个系统"，而是"继续改昨天那张 / 新出一张"。
 * 所以这一页只做两件事：列出历次出题（点回去继续，带记忆），和一句话新建。
 * 原来那套侧边栏（工作台/题库/会话/资料/设置）是把系统的插件分类摆给老师看，已经删掉。
 */

const TEMPLATES: readonly { label: string; text: string }[] = [
  { label: '课后作业', text: '出一份课后作业：' },
  { label: '单元测验', text: '出一份单元测验：' },
  { label: '期中/期末', text: '出一份期末复习卷：' },
  { label: '中考模拟', text: '出一份中考模拟卷：' },
]

export function StartPage(): React.JSX.Element {
  const app = useApp()
  const { sessions, session, busy } = app
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState('')
  const [title, setTitle] = useState('')
  const list = sessions?.sessions ?? []

  const open = (meta: SessionMetaView): void => {
    void app.guard('switch', async () => {
      if (meta.id !== session?.meta.id) await api.switchSession(meta.id)
      await app.reload()
      app.go('paper')
    })
  }

  const start = (text: string): void => {
    const goal = text.trim()
    if (goal === '') return
    void app.guard('new', async () => {
      await api.createSession()
      await app.reload()
      app.go('paper')
      // 一句话就是这次的第一个目标：它带着这句话开工（时间、地点、要求都在里面）
      await app.startRun(goal)
    })
    setDraft('')
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: 3, py: 6 }}>
      <Typography variant="h5" gutterBottom>
        这次要出什么卷子
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        说一句就够了——范围、时长、难易、什么场合考，它先给设计和题，你再一句句改。
      </Typography>

      <TextField
        fullWidth
        multiline
        maxRows={4}
        autoFocus
        placeholder="例如：初三(2)班，二次函数最值，20 分钟，一道大题两道小题，别太难"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            start(draft)
          }
        }}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        {TEMPLATES.map((template) => (
          <Chip
            key={template.label}
            size="small"
            variant="outlined"
            label={template.label}
            disabled={busy !== ''}
            onClick={() => setDraft(`${template.text}`)}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disableElevation disabled={busy !== '' || draft.trim() === ''} onClick={() => start(draft)}>
          开始出题
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 5, mb: 1.5 }}>
        <Typography variant="subtitle1">继续改</Typography>
        <Typography variant="caption" color="text.secondary">
          点回去接着出——它记得你们之前说过什么
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={busy !== ''}
          onClick={() =>
            void app.guard('new', async () => {
              await api.createSession()
              await app.reload()
              app.go('paper')
            })
          }
        >
          空白一张
        </Button>
      </Stack>

      {list.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          还没有出过卷子。
        </Typography>
      ) : (
        <Stack spacing={1}>
          {list
            .toReversed()
            .map((meta) => (
              <Card key={meta.id} variant="outlined">
                <CardActionArea onClick={() => open(meta)} sx={{ px: 2, py: 1.25 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {renaming === meta.id ? (
                      <TextField
                        size="small"
                        autoFocus
                        value={title}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={() => {
                          void app.guard('rename', async () => {
                            if (title.trim() !== '') await api.updateSession({ title: title.trim() })
                            setRenaming('')
                            await app.reload()
                          })
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                        }}
                      />
                    ) : (
                      <Typography variant="body1" sx={{ minWidth: 0 }} noWrap>
                        {meta.title}
                      </Typography>
                    )}
                    {meta.id === session?.meta.id && <Chip size="small" label="正在改" />}
                    {meta.frozen && <Chip size="small" color="warning" variant="outlined" label="已定稿" />}
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.secondary">
                      {meta.className}
                    </Typography>
                    <Tooltip title="改卷名">
                      <IconButton
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenaming(meta.id)
                          setTitle(meta.title)
                        }}
                      >
                        <Typography variant="caption">改名</Typography>
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </CardActionArea>
              </Card>
            ))}
        </Stack>
      )}
    </Box>
  )
}
