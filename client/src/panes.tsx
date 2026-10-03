import { useCallback, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import useMediaQuery from '@mui/material/useMediaQuery'

/**
 * 分栏（像 VS Code 那样）：可拖宽、双击复位、可折成窄条、位置可换、宽度记住。
 *
 * 为什么不用抽屉：抽屉是"临时看一眼"（设置、帮助）的形态；而这三栏——这道卷子的索引、
 * 卷子本身、agent 的对话与 loop——是**全程伴随**的：边看卷子边看它怎么改，才谈得上控制感。
 * 抽屉会遮住内容，来回开合就是"串"的来源。
 *
 * 两条护栏：
 *   · 卷面（中栏）任何时候都不窄于 MIN_DOC（文档不能被挤到不可读，这是专业软件的取舍）；
 *   · 窗口变窄时自动折起左右栏（但记住用户手动展开过，不跟他抢）。
 */

const MIN_SIDE = 200
const MAX_SIDE = 760
/** 卷面（中栏）的底线：这是**硬护栏**——文档不能被挤到读不了（专业软件的取舍） */
const DOC_FLOOR = 520
const DEFAULT_LEFT = 250
const DEFAULT_RIGHT = 400
const STORE_KEY = 'examharness.panes.v1'
/** 窗口窄于这个宽度：左栏自动折起；再窄：agent 栏也折起 */
const NARROW_LEFT = 1180
const NARROW_RIGHT = 980

export interface PaneState {
  left: number
  right: number
  leftOpen: boolean
  rightOpen: boolean
}

function load(): PaneState {
  const fallback: PaneState = { left: DEFAULT_LEFT, right: DEFAULT_RIGHT, leftOpen: true, rightOpen: true }
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<PaneState>
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

export function usePanes(): {
  panes: PaneState
  set: (patch: Partial<PaneState>) => void
  toggleLeft: () => void
  toggleRight: () => void
  /** 拖动中（拖动时禁掉卷面的文字选择与过渡） */
  dragging: boolean
  beginDrag: (which: 'left' | 'right') => (event: React.PointerEvent) => void
  reset: (which: 'left' | 'right') => void
} {
  /** 存下来的只有**用户自己的偏好**（宽度、开合） */
  const [pref, setPref] = useState<PaneState>(load)
  const [dragging, setDragging] = useState(false)
  /**
   * 窗口够不够宽：**用媒体查询问**，不靠 resize 事件。
   *
   * 踩过两次：靠 resize/ResizeObserver 时，首屏（或截图环境的视口变化）拿到的宽度是旧的，
   * 结果两栏一起被折成窄条，而它们再也回不来——用户看到的就是"分栏自己没了"。
   * matchMedia 是浏览器自己维护的状态，首屏就是对的，视口一变就回调。
   */
  const wideLeft = useMediaQuery(`(min-width:${String(NARROW_LEFT)}px)`)
  const wideRight = useMediaQuery(`(min-width:${String(NARROW_RIGHT)}px)`)
  const width = typeof window === 'undefined' ? 1440 : window.innerWidth
  /** 用户手动开过的栏：自动折叠不跟他抢（这一窗口里有效） */
  const manual = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })

  /**
   * **自动折叠是算出来的，不是存下来的**。
   * 踩过：把"窗口小所以折起"写进偏好，窗口变大之后那两栏就再也回不来了
   *（截图里两栏一起变成窄条就是这么来的）。窗口宽度只影响"现在显不显示"。
   */
  const leftOpen = manual.current.left ? pref.leftOpen : pref.leftOpen && wideLeft
  const rightOpen = manual.current.right ? pref.rightOpen : pref.rightOpen && wideRight
  /**
   * 宽度也要**派生**：窗口变窄时，存下来的宽度可能已经超过窗口——
   * 那就必须让位给卷面（真实踩过：把 agent 拉宽之后窗口一小，卷面被挤成一条）。
   */
  const panes: PaneState = {
    left: leftOpen ? Math.min(pref.left, Math.max(MIN_SIDE, width - (rightOpen ? pref.right : 0) - DOC_FLOOR)) : pref.left,
    right: rightOpen ? Math.min(pref.right, Math.max(MIN_SIDE, width - (leftOpen ? pref.left : 0) - DOC_FLOOR)) : pref.right,
    leftOpen,
    rightOpen,
  }

  const set = useCallback((patch: Partial<PaneState>) => {
    setPref((previous) => {
      const next = { ...previous, ...patch }
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(next))
      } catch {
        /* 存不下就只影响"记住宽度"，不影响用 */
      }
      return next
    })
  }, [])

  const beginDrag = useCallback(
    (which: 'left' | 'right') => (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const start = which === 'left' ? panes.left : panes.right
      setDragging(true)

      const move = (moveEvent: PointerEvent): void => {
        // 左栏往右拖变宽，右栏往左拖变宽（相对位移方向相反）
        const delta = which === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX
        const other = which === 'left' ? (panes.rightOpen ? panes.right : 0) : panes.leftOpen ? panes.left : 0
        // **上界是硬的**：卷面留够 DOC_FLOOR 之后还有多少，就最多能拉多宽。
        // 以前只做 Math.min，窗口窄的时候会把卷面继续挤小（用户："拉大时有问题"）。
        const limit = Math.min(MAX_SIDE, window.innerWidth - other - DOC_FLOOR)
        const next = Math.max(MIN_SIDE, Math.min(limit, start + delta))
        if (next < MIN_SIDE) return
        set(which === 'left' ? { left: next } : { right: next })
      }
      const up = (): void => {
        setDragging(false)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [panes, set],
  )

  const reset = useCallback(
    (which: 'left' | 'right') => {
      set(which === 'left' ? { left: DEFAULT_LEFT } : { right: DEFAULT_RIGHT })
    },
    [set],
  )

  return {
    panes,
    set,
    dragging,
    beginDrag,
    reset,
    toggleLeft: () => {
      manual.current.left = true
      set({ leftOpen: !panes.leftOpen })
    },
    toggleRight: () => {
      manual.current.right = true
      set({ rightOpen: !panes.rightOpen })
    },
  }
}

/** 分隔条：拖它改宽度，双击回到默认宽度 */
export function Sash({
  orientation,
  onPointerDown,
  onDoubleClick,
}: {
  orientation: 'vertical' | 'horizontal'
  onPointerDown: (event: React.PointerEvent) => void
  onDoubleClick: () => void
}): React.JSX.Element {
  return (
    <Box
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      data-print-hide
      sx={{
        flexShrink: 0,
        cursor: orientation === 'vertical' ? 'col-resize' : 'row-resize',
        bgcolor: 'divider',
        ...(orientation === 'vertical'
          ? { width: '2px', '&:hover': { bgcolor: 'primary.main' } }
          : { height: '2px', '&:hover': { bgcolor: 'primary.main' } }),
      }}
    />
  )
}

/** 折起来的窄条（"有的"这件事一直可见，这也是不让人焦虑的关键） */
export function Rail({
  title,
  onClick,
  side,
}: {
  title: string
  onClick: () => void
  side: 'left' | 'right'
}): React.JSX.Element {
  return (
    <Box
      onClick={onClick}
      data-print-hide
      title={`展开${title}`}
      sx={{
        flexShrink: 0,
        width: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'action.hover',
        borderRight: side === 'left' ? 1 : 0,
        borderLeft: side === 'right' ? 1 : 0,
        borderColor: 'divider',
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.selected' },
      }}
    >
      <Box sx={{ writingMode: 'vertical-rl', fontSize: 12, color: 'text.secondary', letterSpacing: 1 }}>
        {title}
      </Box>
    </Box>
  )
}
