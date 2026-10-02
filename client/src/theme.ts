import { createTheme, type Theme } from '@mui/material/styles'

/**
 * 主题：**克制**。
 *
 * 参照的是 Apple 那套做法，而不是 Material 的展示版：
 *   - 平面优先（不要阴影、不要浮起来的卡片），分层靠 1px 细线和留白；
 *   - 颜色只用来表达状态（通过 / 需要注意 / 出错），不用来装饰；
 *   - 字号只有四档（标题 17 / 正文 14 / 次要 13 / 说明 12），行高宽松一点；
 *   - 一个界面里只有一个"实心按钮"，其余都是文字按钮。
 *
 * 深色不是反色：底更沉、字更亮，细线跟着亮一点。
 */

const SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export function makeTheme(mode: 'light' | 'dark'): Theme {
  const light = mode === 'light'
  const ink = light ? '#1d1d1f' : '#f5f5f7'
  const ink2 = light ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.66)'
  const ink3 = light ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.44)'
  const line = light ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.12)'
  const paper = light ? '#ffffff' : '#1c1c1e'
  const bg = light ? '#fbfbfd' : '#141416'

  return createTheme({
    cssVariables: false,
    shape: { borderRadius: 10 },
    palette: {
      mode,
      primary: { main: light ? '#0071e3' : '#0a84ff', contrastText: '#ffffff' },
      error: { main: light ? '#d70015' : '#ff453a' },
      warning: { main: light ? '#8a5a00' : '#ffd60a' },
      success: { main: light ? '#1d7a46' : '#30d158' },
      text: { primary: ink, secondary: ink2, disabled: ink3 },
      divider: line,
      background: { default: bg, paper },
    },
    typography: {
      fontFamily: SANS,
      fontSize: 14,
      h1: { fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' },
      h2: { fontSize: 17, fontWeight: 600 },
      h3: { fontSize: 15, fontWeight: 600 },
      body1: { fontSize: 14, lineHeight: 1.6 },
      body2: { fontSize: 13, lineHeight: 1.6, color: ink2 },
      caption: { fontSize: 12, lineHeight: 1.5, color: ink3 },
      button: { textTransform: 'none', fontWeight: 500, fontSize: 14 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { background: bg },
          '::selection': { background: light ? 'rgba(0,113,227,0.16)' : 'rgba(10,132,255,0.28)' },
          // 数学（MathML）跟着正文走，别用浏览器的默认大字
          'math': { fontFamily: SANS, fontSize: '1.02em' },
          'math[display="block"]': { margin: '0.5em 0' },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          root: { background: paper, color: ink, borderBottom: `1px solid ${line}`, boxShadow: 'none' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: true },
        styleOverrides: {
          root: { borderRadius: 8, paddingInline: 14, minHeight: 34 },
          text: { paddingInline: 10, '&:hover': { background: light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)' } },
          outlined: { borderColor: line },
          contained: { '&:hover': { boxShadow: 'none' } },
        },
      },
      MuiIconButton: {
        defaultProps: { disableRipple: true, size: 'small' },
        styleOverrides: { root: { borderRadius: 8, color: ink2 } },
      },
      MuiTabs: { defaultProps: { variant: 'scrollable' }, styleOverrides: { root: { minHeight: 38 }, indicator: { height: 2 } } },
      MuiTab: {
        defaultProps: { disableRipple: true },
        styleOverrides: { root: { textTransform: 'none', minHeight: 38, minWidth: 0, fontSize: 14, fontWeight: 500, paddingInline: 12 } },
      },
      MuiChip: {
        defaultProps: { size: 'small', variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 7, fontSize: 12, height: 22 }, label: { paddingInline: 7 } },
      },
      MuiListItemButton: {
        defaultProps: { disableRipple: true },
        styleOverrides: { root: { borderRadius: 8, paddingBlock: 7 } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 8, background: light ? '#fff' : 'rgba(255,255,255,0.04)' } } },
      MuiTooltip: {
        defaultProps: { arrow: false },
        styleOverrides: { tooltip: { fontSize: 12, borderRadius: 6, background: light ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.9)', color: light ? '#fff' : '#111' } },
      },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 14, border: `1px solid ${line}`, backgroundImage: 'none' } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10, fontSize: 13, alignItems: 'center' } } },
      MuiDivider: { styleOverrides: { root: { borderColor: line } } },
      MuiLinearProgress: { styleOverrides: { root: { height: 2, borderRadius: 0 } } },
      MuiListItemText: { styleOverrides: { primary: { fontSize: 14 }, secondary: { fontSize: 12.5 } } },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 10, border: `1px solid ${line}`, marginTop: 6 } } },
    },
  })
}

export const MONO_FONT = MONO
