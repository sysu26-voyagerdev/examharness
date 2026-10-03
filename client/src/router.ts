import { useCallback, useEffect, useState } from 'react'

/**
 * 极简 hash 路由（不引路由库，ADR-0015）。
 *
 * 页面就是 URL：`#/paper`、`#/graph`、`#/check`、`#/settings`；空地址落在起始页。
 * 刷新、回退、把地址发给同事，都落在同一页——这比"状态藏在内存里"更适合被演示。
 */

export interface Route {
  page: string
  arg: string
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [page = '', ...rest] = raw.split('/')
  // 默认落在起始页（挑一张卷子 / 开一张新的）——不再有"工作台"这个需要解释的概念
  return { page: page === '' ? 'start' : page, arg: rest.join('/') }
}

export function useRoute(): { route: Route; go: (path: string) => void } {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const go = useCallback((path: string) => {
    window.location.hash = path.startsWith('#') ? path : `#/${path}`
  }, [])

  return { route, go }
}
