import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'

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

const MIN_DOC = 700
const MIN_SIDE = 200
const MAX_SIDE = 720
const DEFAULT_LEFT = 250
const DEFAULT_RIGHT = 400
const DEFAULT_BOTTOM = 320
const STORE_KEY = 'examharness.panes.v1'
/** 窗口窄于这个宽度：左栏自动折起；再窄：agent 栏也折起 */
const NARROW_LEFT = 1180
const NARROW_RIGHT = 980

export interface PaneState {
  left: number
  right: number
  bottom: number
  leftOpen: boolean
  rightOpen: boolean
  /** agent 栏放在右边还是底部（宽屏放下面读得顺，窄屏放右边不挤卷面） */
  dock: 'right' | 'bottom'
}

function load(): PaneState {
  const fallback: PaneState = {
    left: DEFAULT_LEFT,
    right: DEFAULT_RIGHT,
    bottom: DEFAULT_BOTTOM,
    leftOpen: true,
    rightOpen: true,
    dock: 'right',
  }
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
  beginDrag: (which: 'left' | 'right' | 'bottom') => (event: React.PointerEvent) => void
  reset: (which: 'left' | 'right' | 'bottom') => void
} {
  /** 存下来的只有**用户自己的偏好**（宽度、开合、位置） */
  const [pref, setPref] = useState<PaneState>(load)
  const [width, setWidth] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)
  /** 用户手动开过的栏：自动折叠不跟他抢（这一窗口里有效） */
  const manual = useRef<{ left: boolean; right: boolean }>({ left: false, right: false })

  /**
   * **自动折叠是算出来的，不是存下来的**。
   * 踩过：把"窗口小所以折起"写进偏好，窗口变大之后那两栏就再也回不来了
   *（截图里两栏一起变成窄条就是这么来的）。窗口宽度只影响"现在显不显示"。
   */
  const panes: PaneState = {
    ...pref,
    leftOpen: manual.current.left ? pref.leftOpen : pref.leftOpen && width >= NARROW_LEFT,
    rightOpen: manual.current.right ? pref.rightOpen : pref.rightOpen && width >= NARROW_RIGHT,
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

  // 窗口宽度：resize + ResizeObserver 两条都听（投影切换、侧栏抽屉都可能改宽度）
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    observer.observe(document.documentElement)
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [])

  const beginDrag = useCallback(
    (which: 'left' | 'right' | 'bottom') => (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startY = event.clientY
      const start = which === 'left' ? panes.left : which === 'right' ? panes.right : panes.bottom
      setDragging(true)

      const move = (moveEvent: PointerEvent): void => {
        if (which === 'bottom') {
          const next = Math.min(600, Math.max(140, start + (startY - moveEvent.clientY)))
          set({ bottom: next })
          return
        }
        // 左栏往右拖变宽，右栏往左拖变宽（相对位移方向相反）
        const delta = which === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX
        // 上界还要看卷面：卷面不能被挤到 MIN_DOC 以下
        const other = which === 'left' ? panes.rightOpen && panes.dock === 'right' ? panes.right : 0 : panes.leftOpen ? panes.left : 0
        const room = window.innerWidth - other - MIN_DOC
        const next = Math.min(Math.min(MAX_SIDE, room), Math.max(MIN_SIDE, start + delta))
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
    (which: 'left' | 'right' | 'bottom') => {
      set(which === 'left' ? { left: DEFAULT_LEFT } : which === 'right' ? { right: DEFAULT_RIGHT } : { bottom: DEFAULT_BOTTOM })
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
