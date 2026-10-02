export const kind = "answer/polynomial-factor";
export const covers = ["整式与因式分解"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779b1, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function n2(a, b) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b; }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const a = ri(r, 2, 7), t = ri(r, 2, 9), k = ri(r, 2, 5), m = ri(r, 2, 6);
    const v1 = 2 * a * (t + a);
    return {
      params: { mode: 0, a: a, t: t, k: k, m: m, v1: v1, kk: k * m * m },
      stem: "（1）先化简，再求值：$(x+" + a + ")^{2}-(x+" + a + ")(x-" + a + ")$，其中 $x=" + t + "$；\n（2）因式分解：$" + k + "x^{2}-" + (k * m * m) + "$。",
      answer: n2("原式的值为 " + v1, "因式分解得 " + k + "(x-" + m + ")(x+" + m + ")"),
      goal: "整式化简求值与因式分解",
      goals: ["先化简，再求值", "把多项式因式分解"],
      givens: ["求值时代入 $x=" + t + "$"],
      solution: [
        "$(x+" + a + ")^{2}-(x+" + a + ")(x-" + a + ")=(x+" + a + ")\\left[(x+" + a + ")-(x-" + a + ")\\right]=2" + a + "(x+" + a + ")$",
        "当 $x=" + t + "$ 时，原式 $=2\\times " + a + "\\times(" + t + "+" + a + ")=" + v1 + "$",
        "$" + k + "x^{2}-" + (k * m * m) + "=" + k + "(x^{2}-" + (m * m) + ")=" + k + "(x-" + m + ")(x+" + m + ")$"
      ],
      steps: [
        { text: "提公因式后再化简", basis: "提公因式法与整式乘法" },
        { text: "先提出公因式 " + k + "，再用平方差公式", basis: "平方差公式" }
      ],
      checks: [
        { expr: "2*a*(t+a)", at: { a: a, t: t }, expect: v1 },
        { expr: "k*x^2-k*mm", at: { x: m, k: k, mm: m * m }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    const m = ri(r, 3, 9) * 10 + ri(r, 1, 4), d = ri(r, 1, 4), g = ri(r, 2, 6);
    const v1 = m * m - d * d;
    return {
      params: { mode: 1, m: m, d: d, g: g, v1: v1, gg: g * g, sum: m + d, diff: m - d },
      stem: "（1）计算：$" + (m + d) + "\\times " + (m - d) + "$；\n（2）因式分解：$x^{3}-" + (g * g) + "x$。",
      answer: n2("计算结果为 " + v1, "因式分解得 x(x-" + g + ")(x+" + g + ")"),
      goal: "用平方差公式计算与因式分解",
      goals: ["计算给定乘积的值", "把多项式因式分解"],
      givens: [],
      solution: [
        "$" + (m + d) + "\\times " + (m - d) + "=" + m + "^{2}-" + d + "^{2}=" + (m * m) + "-" + (d * d) + "=" + v1 + "$",
        "$x^{3}-" + (g * g) + "x=x(x^{2}-" + (g * g) + ")=x(x-" + g + ")(x+" + g + ")$"
      ],
      steps: [
        { text: "把两个因数写成 $m\\pm d$，用平方差公式", basis: "平方差公式" },
        { text: "先提公因式 $x$，再用平方差公式", basis: "提公因式法与平方差公式" }
      ],
      checks: [
        { expr: "sum*diff", at: { sum: m + d, diff: m - d }, expect: v1 },
        { expr: "m^2-d^2", at: { m: m, d: d }, expect: v1 },
        { expr: "x^3-gg*x", at: { x: g, gg: g * g }, expect: 0 }
      ]
    };
  }

  if (mode === 2) {
    const s = ri(r, 5, 15), q = ri(r, 2, 12);
    const v1 = s * s - 2 * q, v2 = s * s - 4 * q;
    return {
      params: { mode: 2, s: s, q: q, v1: v1, v2: v2 },
      stem: "已知 $x+y=" + s + "$\uff0c$xy=" + q + "$。\n（1）求 $(x+y)^{2}-2xy$ 的值；\n（2）求 $(x+y)^{2}-4xy$ 的值。",
      answer: n2(v1, v2),
      goal: "用完全平方公式的变形求值",
      goals: ["求 $(x+y)^{2}-2xy$ 的值", "求 $(x+y)^{2}-4xy$ 的值"],
      givens: ["$x+y=" + s + "$\uff0c$xy=" + q + "$"],
      solution: [
        "$(x+y)^{2}-2xy=" + s + "^{2}-2\\times " + q + "=" + v1 + "$",
        "$(x+y)^{2}-4xy=" + s + "^{2}-4\\times " + q + "=" + v2 + "$"
      ],
      steps: [
        { text: "把 $x^{2}+y^{2}$ 写成 $(x+y)^{2}-2xy$ 再代入", basis: "完全平方公式的变形" },
        { text: "把 $(x-y)^{2}$ 写成 $(x+y)^{2}-4xy$ 再代入", basis: "完全平方公式的变形" }
      ],
      checks: [
        { expr: "s^2-2*q", at: { s: s, q: q }, expect: v1 },
        { expr: "s^2-4*q", at: { s: s, q: q }, expect: v2 }
      ]
    };
  }

  const p = ri(r, 4, 12), d = ri(r, 2, 9);
  const v1 = p * d, v2 = p * p - d * d;
  return {
    params: { mode: 3, p: p, d: d, v1: v1, v2: v2 },
    stem: "已知 $a+b=" + p + "$\uff0c$a-b=" + d + "$。\n（1）求 $(a+b)(a-b)$ 的值；\n（2）求 $(a+b)^{2}-(a-b)^{2}$ 的值。",
    answer: n2(v1, v2),
    goal: "用平方差公式与完全平方公式的变形求值",
    goals: ["求 $(a+b)(a-b)$ 的值", "求 $(a+b)^{2}-(a-b)^{2}$ 的值"],
    givens: ["$a+b=" + p + "$\uff0c$a-b=" + d + "$"],
    solution: [
      "$(a+b)(a-b)=" + p + "\\times " + d + "=" + v1 + "$",
      "$(a+b)^{2}-(a-b)^{2}=4ab$，而 $4ab=(" + p + ")^{2}-(" + d + ")^{2}=" + v2 + "$"
    ],
    steps: [
      { text: "用平方差公式", basis: "平方差公式" },
      { text: "把 $(a+b)^{2}-(a-b)^{2}$ 化为 $4ab$，再用 $4ab=(a+b)^{2}-(a-b)^{2}$ 计算", basis: "完全平方公式的变形" }
    ],
    checks: [
      { expr: "p*d", at: { p: p, d: d }, expect: v1 },
      { expr: "p*p-d*d", at: { p: p, d: d }, expect: v2 }
    ]
  };
}
