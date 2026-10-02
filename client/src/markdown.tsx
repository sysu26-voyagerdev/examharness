import type { JSX } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 模型的答复按 Markdown 渲染。
 *
 * 它偶尔会写标题、表格、列表——以前这些记号（`**`、`##`、`|`）是直接糊在气泡里的，
 * 看着像坏掉的文本。这里用 react-markdown 渲染，并把元素映射成 MUI 组件，
 * 让它跟界面是一套东西（字号、表格线、代码底色都走主题）。
 */
export function MarkdownText({ children }: { children: string }): JSX.Element {
  return (
    <Box
      sx={{
        '& > :first-of-type': { mt: 0 },
        '& > :last-of-type': { mb: 0 },
        '& p': { my: 1 },
        '& ul, & ol': { my: 1, pl: 3 },
        '& li': { mb: 0.5 },
        '& code': {
          fontFamily: 'monospace',
          fontSize: '0.88em',
          bgcolor: 'action.hover',
          px: 0.5,
          py: 0.15,
          borderRadius: 0.75,
        },
        '& pre': { bgcolor: 'action.hover', borderRadius: 2, p: 1.5, overflowX: 'auto', my: 1.5 },
        '& pre code': { bgcolor: 'transparent', p: 0 },
        '& blockquote': { borderLeft: 3, borderColor: 'divider', pl: 1.5, my: 1, color: 'text.secondary' },
      }}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: text }) => (
            <Typography variant="h6" sx={{ mt: 2 }}>
              {text}
            </Typography>
          ),
          h2: ({ children: text }) => (
            <Typography variant="subtitle1" sx={{ mt: 2 }}>
              {text}
            </Typography>
          ),
          h3: ({ children: text }) => (
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              {text}
            </Typography>
          ),
          h4: ({ children: text }) => (
            <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
              {text}
            </Typography>
          ),
          p: ({ children: text }) => <Typography variant="body2" component="p" sx={{ lineHeight: 1.8 }}>{text}</Typography>,
          strong: ({ children: text }) => <Box component="strong" sx={{ fontWeight: 700 }}>{text}</Box>,
          ul: ({ children: items }) => (
            <List dense disablePadding component="ul" sx={{ pl: 2, listStyle: 'disc' }}>
              {items}
            </List>
          ),
          ol: ({ children: items }) => (
            <List dense disablePadding component="ol" sx={{ pl: 2, listStyle: 'decimal' }}>
              {items}
            </List>
          ),
          li: ({ children: item }) => (
            <ListItem component="li" sx={{ display: 'list-item', py: 0.25, px: 0 }}>
              {item}
            </ListItem>
          ),
          a: ({ children: text, href }) => (
            <Link href={href} target="_blank" rel="noreferrer">
              {text}
            </Link>
          ),
          hr: () => <Divider sx={{ my: 2 }} />,
          table: ({ children: rows }) => (
            <Paper variant="outlined" sx={{ my: 1.5, overflowX: 'auto' }}>
              <Table size="small">{rows}</Table>
            </Paper>
          ),
          thead: ({ children: rows }) => <TableHead>{rows}</TableHead>,
          tbody: ({ children: rows }) => <TableBody>{rows}</TableBody>,
          tr: ({ children: cells }) => <TableRow>{cells}</TableRow>,
          th: ({ children: cell }) => (
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {cell}
              </Typography>
            </TableCell>
          ),
          td: ({ children: cell }) => (
            <TableCell>
              <Typography variant="caption">{cell}</Typography>
            </TableCell>
          ),
        }}
      >
        {children}
      </Markdown>
    </Box>
  )
}
