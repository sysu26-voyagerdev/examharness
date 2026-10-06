import type { KbStatus } from '../types.js'

export const MATERIAL_STATUS: Readonly<Record<KbStatus, string>> = {
  raw: '待整理', ingesting: '整理中', indexed: '已整理', failed: '未完成',
}

export const MATERIAL_ACCEPT = '.txt,.md,.csv,.jsonl,.json,.pdf,.docx,.xlsx,.xlsm,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff'
export const isTextMaterial = (name: string): boolean => /\.(txt|md|csv|jsonl|json)$/i.test(name)

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
