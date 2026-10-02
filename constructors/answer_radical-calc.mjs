export const kind = "answer/radical-calc";
export const covers = ["实数与二次根式"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x2545f491, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function ans2(v1, v2) { return String(v1) + "\uff1b" + String(v2); }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const p = ri(r, 2, 9), q = ri(r, 2, 9), t = ri(r, 2, 9);
    const v1 = p - q + t;
    const m = ri(r, 3, 12), n = ri(r, 2, m - 1);
    const v2 = m - n;
    return {
      params: {
        mode: 0, p: p, q: q, t: t, v1: v1, m: m, n: n, v2: v2,
        a: p * p, b: q * q, c: t * t
      },
      stem: "（1）计算：$\\sqrt{" + (p * p) + "}-\\sqrt{" + (q * q) + "}+\\sqrt{" + (t * t) + "}$；\n（2）计算：$(\\sqrt{" + m + "}+\\sqrt{" + n + "})(\\sqrt{" + m + "}-\\sqrt{" + n + "})$。",
      answer: ans2(v1, v2),
      goal: "二次根式的加减与乘法运算",
      goals: [
        "计算 $\\sqrt{" + (p * p) + "}-\\sqrt{" + (q * q) + "}+\\sqrt{" + (t * t) + "}$ 的值",
        "计算 $(\\sqrt{" + m + "}+\\sqrt{" + n + "})(\\sqrt{" + m + "}-\\sqrt{" + n + "})$ 的值"
      ],
      givens: [],
      solution: [
        "$\\sqrt{" + (p * p) + "}=" + p + "$\uff0c$\\sqrt{" + (q * q) + "}=" + q + "$\uff0c$\\sqrt{" + (t * t) + "}=" + t + "$",
        "所以 $\\sqrt{" + (p * p) + "}-\\sqrt{" + (q * q) + "}+\\sqrt{" + (t * t) + "}=" + p + "-" + q + "+" + t + "=" + v1 + "$",
        "$(\\sqrt{" + m + "}+\\sqrt{" + n + "})(\\sqrt{" + m + "}-\\sqrt{" + n + "})=(" + m + ")-(" + n + ")=" + v2 + "$"
      ],
      steps: [
        { text: "把能开方的二次根式化成整数", basis: "二次根式的性质 $\\sqrt{a^{2}}=a$" },
        { text: "用平方差公式化简", basis: "平方差公式与二次根式的乘法" }
      ],
      checks: [
        { expr: "p-q+t", at: { p: p, q: q, t: t }, expect: v1 },
        { expr: "m-n", at: { m: m, n: n }, expect: v2 }
      ]
    };
  }

  if (mode === 1) {
    const sp = ri(r, 2, 9), b = ri(r, 2, 15), p = ri(r, 2, 9);
    const v1 = 2 - sp + b;
    const v2 = p * p;
    return {
      params: { mode: 1, sp: sp, root: sp * sp, b: b, p: p, v1: v1, v2: v2 },
      stem: "（1）计算：$(\\dfrac{1}{2})^{-1}-\\sqrt{" + (sp * sp) + "}+|-" + b + "|$；\n（2）若 $\\sqrt{x}=" + p + "$，求 $x$ 的值。",
      answer: ans2(v1, v2),
      goal: "负整数指数幂、二次根式与绝对值的计算",
      goals: [
        "计算 $(\\dfrac{1}{2})^{-1}-\\sqrt{" + (sp * sp) + "}+|-" + b + "|$ 的值",
        "求 $x$ 的值"
      ],
      givens: ["若 $\\sqrt{x}=" + p + "$"],
      solution: [
        "$(\\dfrac{1}{2})^{-1}=2$\uff0c$\\sqrt{" + (sp * sp) + "}=" + sp + "$\uff0c$|-" + b + "|=" + b + "$",
        "$2-" + sp + "+" + b + "=" + v1 + "$",
        "由 $\\sqrt{x}=" + p + "$ 得 $x=" + p + "^{2}=" + v2 + "$"
      ],
      steps: [
        { text: "分别算出负整数指数幂、算术平方根、绝对值", basis: "实数运算与二次根式的性质" },
        { text: "两边平方消去根号", basis: "算术平方根的意义" }
      ],
      checks: [
        { expr: "2-sp+b", at: { sp: sp, b: b }, expect: v1 },
        { expr: "p^2", at: { p: p }, expect: v2 }
      ]
    };
  }

  if (mode === 2) {
    const p = ri(r, 3, 12), q = ri(r, 2, 9);
    const v1 = p - q, v2 = -p * q;
    return {
      params: { mode: 2, p: p, q: q, v1: v1, v2: v2 },
      stem: "已知实数 $a$，$b$ 满足 $\\sqrt{a-" + p + "}+|b+" + q + "|=0$。\n（1）求 $a+b$ 的值；\n（2）求 $ab$ 的值。",
      answer: ans2(v1, v2),
      goal: "由非负数的和为 0 求字母的值，再求代数式的值",
      goals: ["求 $a+b$ 的值", "求 $ab$ 的值"],
      givens: ["实数 $a$，$b$ 满足 $\\sqrt{a-" + p + "}+|b+" + q + "|=0$"],
      solution: [
        "$\\sqrt{a-" + p + "}\\ge 0$\uff0c$|b+" + q + "|\\ge 0$，它们的和为 $0$，所以每一项都为 $0$",
        "得 $a=" + p + "$\uff0c$b=-" + q + "$",
        "$a+b=" + p + "+(-" + q + ")=" + v1 + "$\uff0c$ab=" + p + "\\times(-" + q + ")=" + v2 + "$"
      ],
      steps: [
        { text: "非负数之和为 0，则每个非负数都是 0", basis: "算术平方根与绝对值的非负性" },
        { text: "代入求值", basis: "有理数的运算" }
      ],
      checks: [
        { expr: "p-q", at: { p: p, q: q }, expect: v1 },
        { expr: "-p*q", at: { p: p, q: q }, expect: v2 }
      ]
    };
  }

  const s2 = ri(r, 2, 9), k = ri(r, 1, 6);
  const big = s2 * s2;
  const v1 = big, v2 = s2;
  return {
    params: { mode: 3, s: big, root: s2, k: k, v1: v1, v2: v2 },
    stem: "已知 $x=\\sqrt{" + big + "}+" + k + "$。\n（1）求 $(x-" + k + ")^{2}$ 的值；\n（2）求 $x-" + k + "$ 的值。",
    answer: ans2(v1, v2),
    goal: "用二次根式的性质求代数式的值",
    goals: ["求 $(x-" + k + ")^{2}$ 的值", "求 $x-" + k + "$ 的值"],
    givens: ["$x=\\sqrt{" + big + "}+" + k + "$"],
    solution: [
      "由 $x=\\sqrt{" + big + "}+" + k + "$ 得 $x-" + k + "=\\sqrt{" + big + "}$",
      "$(x-" + k + ")^{2}=" + big + "$\uff0c$x-" + k + "=" + s2 + "$"
    ],
    steps: [
      { text: "先算出 $x-" + k + "$", basis: "代数式的代入" },
      { text: "由算术平方根求值", basis: "二次根式的性质" }
    ],
    checks: [
      { expr: "(x-k)^2", at: { x: s2 + k, k: k }, expect: v1 },
      { expr: "x-k", at: { x: s2 + k, k: k }, expect: v2 }
    ]
  };
}
