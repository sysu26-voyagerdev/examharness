export const kind = "fill/number-pattern";
export const covers = ["规律与代数推理"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x7feb352d, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
const BLANK = "\uff08  \uff09";

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const a1 = ri(r, 2, 9), d = ri(r, 2, 6), n = ri(r, 8, 15);
    const val = a1 + (n - 1) * d;
    return {
      params: { mode: 0, a1: a1, d: d, n: n, value: val },
      stem: "按规律排列的一列数：$" + a1 + "$\uff0c$" + (a1 + d) + "$\uff0c$" + (a1 + 2 * d) + "$\uff0c$\u2026\uff0c则第 " + n + " 个数是" + BLANK + "。",
      answer: String(val),
      goal: "由数列的规律写出第 n 项",
      goals: ["求第 " + n + " 个数"],
      givens: ["一列数依次为 $" + a1 + "$\uff0c$" + (a1 + d) + "$\uff0c$" + (a1 + 2 * d) + "$\uff0c$\u2026"],
      solution: [
        "相邻两项相差 " + d + "，第 $n$ 个数为 $" + a1 + "+" + d + "(n-1)$",
        "当 $n=" + n + "$ 时，值为 $" + a1 + "+" + d + "\\times " + (n - 1) + "=" + val + "$"
      ],
      steps: [{ text: "认出差为 " + d + " 的等差数列，代入第 n 项", basis: "用代数式表示规律" }],
      checks: [{ expr: "a1+(n-1)*d", at: { a1: a1, d: d, n: n }, expect: val }]
    };
  }

  if (mode === 1) {
    const n = ri(r, 6, 15);
    const val = n * n;
    return {
      params: { mode: 1, n: n, value: val },
      stem: "按规律排列的一列数：$1$\uff0c$4$\uff0c$9$\uff0c$16$\uff0c$\u2026\uff0c则第 " + n + " 个数是" + BLANK + "。",
      answer: String(val),
      goal: "由平方数的规律求第 n 项",
      goals: ["求第 " + n + " 个数"],
      givens: ["一列数依次为 $1$\uff0c$4$\uff0c$9$\uff0c$16$\uff0c$\u2026"],
      solution: [
        "第 $n$ 个数是 $n^{2}$",
        "当 $n=" + n + "$ 时，$" + n + "^{2}=" + val + "$"
      ],
      steps: [{ text: "发现第 n 项为 n 的平方", basis: "用代数式表示规律" }],
      checks: [{ expr: "n^2", at: { n: n }, expect: val }]
    };
  }

  if (mode === 2) {
    const a1 = ri(r, 4, 9), d = ri(r, 2, 5), n = ri(r, 10, 20);
    const val = a1 + (n - 1) * d;
    return {
      params: { mode: 2, a1: a1, d: d, n: n, value: val },
      stem: "用火柴棒按规律搭图形：第 1 个图形用 " + a1 + " 根，第 2 个图形用 " + (a1 + d) + " 根，第 3 个图形用 " + (a1 + 2 * d) + " 根，\u2026\uff0c则第 " + n + " 个图形用" + BLANK + "根。",
      answer: String(val),
      goal: "由图形规律求第 n 个图形所需数量",
      goals: ["求第 " + n + " 个图形所用的火柴棒根数"],
      givens: ["第 1 个图形用 " + a1 + " 根火柴棒，以后每个图形都比前一个多用 " + d + " 根"],
      solution: [
        "第 $n$ 个图形用 $" + a1 + "+" + d + "(n-1)$ 根",
        "当 $n=" + n + "$ 时，$" + a1 + "+" + d + "\\times " + (n - 1) + "=" + val + "$"
      ],
      steps: [{ text: "每多一个图形多 " + d + " 根，列出第 n 个的代数式", basis: "用代数式表示图形规律" }],
      checks: [{ expr: "a1+(n-1)*d", at: { a1: a1, d: d, n: n }, expect: val }]
    };
  }

  const n = ri(r, 10, 30);
  const val = n * (n + 1) / 2;
  return {
    params: { mode: 3, n: n, value: val },
    stem: "计算 $1+2+3+\\cdots+" + n + "$ 的结果是" + BLANK + "。",
    answer: String(val),
    goal: "用求和规律计算连续正整数的和",
    goals: ["求这 " + n + " 个连续正整数的和"],
    givens: ["求从 $1$ 到 $" + n + "$ 的所有整数的和"],
    solution: [
      "首尾配对：$1+" + n + "=" + (n + 1) + "$\uff0c共有 $" + n + "\\div 2$ 对",
      "和 $=\\dfrac{" + n + "\\times(" + n + "+1)}{2}=" + val + "$"
    ],
    steps: [{ text: "首尾配对求连续整数和", basis: "用代数式表示求和规律" }],
    checks: [{ expr: "n*(n+1)/2", at: { n: n }, expect: val }]
  };
}
