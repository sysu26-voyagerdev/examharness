import { createTheme, type Theme } from '@mui/material/styles'

/**
 * 主题：用 MUI 自己的设计语言（层次靠 elevation，卡片就是卡片），
 * 只改三件事——中文排版、圆角略大、主色用一个稳的深蓝。
 * 以前那版把阴影全关掉、字号压到四档，结果整个界面"没有层次"，看起来又空又丑。
 */

const SANS =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

export const MONO_FONT = MONO

export function makeTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#2f5bd7' : '#8ab4f8' },
      secondary: { main: mode === 'light' ? '#0f766e' : '#5eead4' },
      success: { main: mode === 'light' ? '#2e7d32' : '#81c784' },
      warning: { main: mode === 'light' ? '#ed6c02' : '#ffb74d' },
      error: { main: mode === 'light' ? '#d32f2f' : '#e57373' },
      background: mode === 'light' ? { default: '#f4f6f8', paper: '#ffffff' } : { default: '#121212', paper: '#1e1e1e' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: SANS,
      h4: { fontSize: 24, fontWeight: 600 },
      h5: { fontSize: 20, fontWeight: 600 },
      h6: { fontSize: 17, fontWeight: 600 },
      subtitle1: { fontSize: 15, fontWeight: 600 },
      subtitle2: { fontSize: 13, fontWeight: 600 },
      body1: { fontSize: 15, lineHeight: 1.75 },
      body2: { fontSize: 14, lineHeight: 1.7 },
      caption: { fontSize: 12.5 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'math': { fontFamily: SANS, fontSize: '1.05em' },
          'math[display="block"]': { margin: '0.6em 0' },
        },
      },
      MuiAppBar: {
        defaultProps: { position: 'fixed' },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRight: `1px solid ${theme.palette.divider}`,
            backgroundImage: 'none',
          }),
        },
      },
      MuiCard: { defaultProps: { elevation: 1 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiListItemText: { defaultProps: { slotProps: { secondary: { variant: 'body2' } } } },
      MuiButton: { defaultProps: { disableElevation: false } },
      MuiChip: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
      MuiTab: { styleOverrides: { root: { minHeight: 44, textTransform: 'none', fontWeight: 600 } } },
    },
  })
}
