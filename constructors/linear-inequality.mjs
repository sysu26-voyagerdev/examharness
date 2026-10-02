/**
 * 一元一次不等式（示例：由 agent 在运行时写的题型模块）
 *
 * 检验点写的是**要被核对的数学事实**：解 x 恰好在边界上（代入左边等于右边），
 * 且 x-1 不满足——这两条一起把"解集边界"钉死，框架的求值器会独立复算。
 */
export const kind = 'dynamic/linear-inequality'
export const covers = ['一元一次不等式']

export function construct(slot, seed) {
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  const a = 2 + Math.floor(next() * 5)          // 正系数（不等号方向不变）
  const x = -6 + Math.floor(next() * 13)        // 解集边界
  const b = -9 + Math.floor(next() * 19)
  const c = a * x + b
  return {
    params: { a, b, c, x },
    stem: `解不等式：${a}x ${b < 0 ? '−' : '+'} ${Math.abs(b)} > ${c}。`,
    answer: `x > ${x}`,
    answerTex: `x > ${x}`,
    solution: [`移项得 ${a}x > ${c - b}`, `两边同除以正数 ${a} 得 x > ${x}`],
    steps: [
      { text: `移项：${a}x > ${c - b}`, basis: '不等式性质' },
      { text: `两边同除以 ${a}（正数，方向不变）：x > ${x}`, basis: '不等式性质' },
    ],
    checks: [
      { expr: 'a*x + b', at: { a, b, x }, expect: c },
      { expr: 'a*(x-1) + b', at: { a, b, x }, expect: c - a },
    ],
  }
}
