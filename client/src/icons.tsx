import type { JSX } from 'react'

/**
 * 单一线性图标集：16px 视框、stroke 1.4、currentColor。
 * 规矩（ADR-0015）：**不要混用 Unicode 符号**（✗ ✓ → 这种既不是图标也不是标点）。
 */
const PATHS: Readonly<Record<string, JSX.Element>> = {
  sliders: (
    <>
      <path d="M3 5.5h10M3 10.5h10" />
      <circle cx="6" cy="5.5" r="1.7" />
      <circle cx="10" cy="10.5" r="1.7" />
    </>
  ),
  grid: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.6" />
      <path d="M2.8 8h10.4M8 2.8v10.4" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.5 10.5L13.6 13.6" />
    </>
  ),
  graph: (
    <>
      <circle cx="4" cy="12" r="2.1" />
      <circle cx="12" cy="4" r="2.1" />
      <path d="M5.6 10.4l4.8-4.8" />
    </>
  ),
  calc: (
    <>
      <rect x="3.2" y="2.4" width="9.6" height="11.2" rx="1.6" />
      <path d="M5.8 5.6h4.4M5.8 8.6h1.6M8.8 8.6h1.4M5.8 11.2h1.6M8.8 11.2h1.4" />
    </>
  ),
  image: (
    <>
      <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6" />
      <path d="M2.4 10.2l3.2-3 2.6 2.6L11 6.6l2.6 2.6" />
    </>
  ),
  upload: (
    <>
      <path d="M8 11.2V3.6M4.8 6.8L8 3.6l3.2 3.2" />
      <path d="M3 12.4h10" />
    </>
  ),
  chart: <path d="M3.4 12.6V8.4M7 12.6V3.8M10.6 12.6V9.4M14 12.6V6.2" />,
  refresh: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.9" />
      <path d="M13.4 2.8v2.8h-2.8" />
    </>
  ),
  check: <path d="M3.4 8.4l3 3 6.2-6.8" />,
  alert: (
    <>
      <path d="M8 3.2l5.6 9.6h-11.2z" />
      <path d="M8 6.8v2.6M8 11.2h.01" />
    </>
  ),
  chat: (
    <>
      <path d="M2.8 4.4A1.6 1.6 0 0 1 4.4 2.8h7.2a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6H6.8L3.4 13.2z" />
    </>
  ),
  tool: (
    <>
      <path d="M9.8 3.2a3.2 3.2 0 0 1 3.6 4.4l-6.6 6.6-2.2-2.2 6.6-6.6a3.2 3.2 0 0 1-1.4-2.2z" />
    </>
  ),
  play: <path d="M5.4 3.4l7 4.6-7 4.6z" />,
  layers: (
    <>
      <path d="M8 2.6l5.4 2.8L8 8.2 2.6 5.4z" />
      <path d="M2.6 9.2L8 12l5.4-2.8" />
    </>
  ),
  send: <path d="M8 12.5V3.8M4.6 7.2L8 3.8l3.4 3.4" />,
  folder: (
    <>
      <path d="M2.4 4.4a1 1 0 0 1 1-1h2.2l1.2 1.6h5.8a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1z" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1" />
    </>
  ),
  moon: <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6z" />,
  paper: (
    <>
      <path d="M4 2.6h5l3 3v7.8H4z" />
      <path d="M9 2.6v3h3" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M2.6 8h10.8M8 2.6c1.6 1.6 2.4 3.4 2.4 5.4S9.6 11.8 8 13.4C6.4 11.8 5.6 10 5.6 8S6.4 4.2 8 2.6z" />
    </>
  ),
}

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  )
}
