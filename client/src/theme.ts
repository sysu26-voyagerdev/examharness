import { createTheme, type Theme } from '@mui/material/styles'

/**
 * 主题：**中性表面 + 颜色只用于交互**。
 *
 * 上一版把 AppBar 刷成主色，一大块蓝压在整个界面上——那是十年前的后台。
 * 现在：顶栏/抽屉/卡片都是表面色，靠细线与极轻的阴影分层；
 * 主色只出现在按钮、选中态、状态标签上，面积很小。
 */

const SANS =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

export const MONO_FONT = MONO

export function makeTheme(mode: 'light' | 'dark'): Theme {
  const light = mode === 'light'
  return createTheme({
    palette: {
      mode,
      primary: { main: light ? '#2b5cd9' : '#8ab4f8' },
      secondary: { main: light ? '#0f766e' : '#5eead4' },
      success: { main: light ? '#2e7d32' : '#81c784' },
      warning: { main: light ? '#b26a00' : '#ffb74d' },
      error: { main: light ? '#c62828' : '#e57373' },
      info: { main: light ? '#0277bd' : '#4fc3f7' },
      divider: light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)',
      background: { default: light ? '#f5f6f8' : '#101114', paper: light ? '#ffffff' : '#1a1b1f' },
      text: light
        ? { primary: 'rgba(0,0,0,0.87)', secondary: 'rgba(0,0,0,0.60)', disabled: 'rgba(0,0,0,0.38)' }
        : { primary: '#f2f3f5', secondary: 'rgba(255,255,255,0.68)', disabled: 'rgba(255,255,255,0.40)' },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: SANS,
      h5: { fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em' },
      h6: { fontSize: 17, fontWeight: 600 },
      subtitle1: { fontSize: 15, fontWeight: 600 },
      subtitle2: { fontSize: 13.5, fontWeight: 600 },
      body1: { fontSize: 15, lineHeight: 1.8 },
      body2: { fontSize: 14, lineHeight: 1.7 },
      caption: { fontSize: 12.5, lineHeight: 1.6 },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'math': { fontFamily: SANS, fontSize: '1.05em' },
          'math[display="block"]': { margin: '0.6em 0' },
        },
      },
      MuiAppBar: {
        defaultProps: { position: 'fixed', elevation: 0, color: 'default' },
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            borderBottom: `1px solid ${theme.palette.divider}`,
            backgroundImage: 'none',
          }),
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: ({ theme }) => ({ borderRight: `1px solid ${theme.palette.divider}`, backgroundImage: 'none' }),
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0, variant: 'outlined' },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiCardHeader: { styleOverrides: { root: { paddingBottom: 8 } } },
      MuiListItemButton: {
        defaultProps: { disableRipple: true },
        styleOverrides: { root: { borderRadius: 8, marginBottom: 2 } },
      },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiChip: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiTabs: { styleOverrides: { root: { minHeight: 46 } } },
      MuiTab: { styleOverrides: { root: { minHeight: 46, textTransform: 'none', fontWeight: 600, fontSize: 14 } } },
      MuiAlert: { styleOverrides: { root: { alignItems: 'center' } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    },
  })
}
