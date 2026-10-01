/**
 * FNV-1a 32 位哈希，输出 8 位十六进制。
 * 用途：给构造出来的题目生成**确定性**短 id（同种子同参数 → 同 id）。
 * 它不是密码学哈希，也从不用于安全用途——只用于稳定标识。
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
