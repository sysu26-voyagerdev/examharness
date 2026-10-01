/**
 * 从模型回复里抠出一个 JSON 对象。
 *
 * 模型爱把 JSON 包在 ```json 代码块里，或者在前后加一句话。这里做**保守**处理：
 * 先去掉代码围栏，再截取第一对花括号之间的内容。解析失败返回 undefined——
 * 调用方必须把它当成"模型没按要求回答"，而不是崩掉。
 */
export function parseJsonObject(text: string | null): Record<string, unknown> | undefined {
  if (text === null) return undefined
  const fenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const value: unknown = JSON.parse(fenced.slice(start, end + 1))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 归一化：比对"题面说的是不是同一件事"时用，忽略空格与两种减号 */
export function normalize(text: string): string {
  return text
    .replace(/[\s，,。；;：:（）()]/g, '')
    .replace(/[−–—]/g, '-')
    .toLowerCase()
}
