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
const SQ = "\u00b2";
const CU = "\u00b3";
const BASE = { two: 2, four: 4, e2: 2, e3: 3 };

function withBase(obj) {
  const out = {};
  const keys = Object.keys(BASE);
  for (let i = 0; i < keys.length; i++) out[keys[i]] = BASE[keys[i]];
  const k2 = Object.keys(obj);
  for (let i = 0; i < k2.length; i++) out[k2[i]] = obj[k2[i]];
  return out;
}

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const m = ri(r, 3, 9) * 10 + ri(r, 1, 4), d = ri(r, 1, 4);
    const v1 = m * m - d * d;
    const v2 = 4 * m * d;
    return {
      params: withBase({ mode: 0, m: m, d: d, v1: v1, v2: v2, sum: m + d, diff: m - d }),
      stem: "（1）计算：$" + (m + d) + "\\times " + (m - d) + "$；\n（2）计算：$" + (m + d) + "^{2}-" + (m - d) + "^{2}$。",
      answer: n2(v1, v2),
      goal: "用平方差公式计算",
      goals: ["计算乘积的值", "计算两个平方的差"],
      givens: [],
      solution: [
        "$" + (m + d) + "\\times " + (m - d) + "=" + m + "^{2}-" + d + "^{2}=" + v1 + "$",
        "$" + (m + d) + "^{2}-" + (m - d) + "^{2}=4\\times " + m + "\\times " + d + "=" + v2 + "$"
      ],
      steps: [
        { text: "用平方差公式算两个数的积", basis: "平方差公式" },
        { text: "用平方差公式算两个平方的差", basis: "平方差公式" }
      ],
      checks: [
        { expr: "sum*diff", at: { sum: m + d, diff: m - d }, expect: v1 },
        { expr: "m^2-d^2", at: { m: m, d: d }, expect: v1 },
        { expr: "4*m*d", at: { m: m, d: d }, expect: v2 }
      ]
    };
  }

  if (mode === 1) {
    const a = ri(r, 2, 6), t = ri(r, 2, 9), g = ri(r, 2, 6);
    const v1 = 2 * a * (t + a);
    return {
      params: withBase({ mode: 1, a: a, t: t, g: g, v1: v1, gg: g * g, aa: 2 * a }),
      stem: "（1）先化简，再求值：$(x+" + a + ")^{2}-(x+" + a + ")(x-" + a + ")$，其中 $x=" + t + "$；\n（2）因式分解：$x^{3}-" + (g * g) + "x$。",
      answer: n2("(x+" + a + ")" + SQ + "-(x+" + a + ")(x-" + a + ")=" + (2 * a) + "x+" + (2 * a * a) + "\uff0c\u5f53 x=" + t + " \u65f6\u503c\u4e3a " + v1, "x" + CU + "-" + (g * g) + "x=x(x+" + g + ")(x-" + g + ")"),
      goal: "先化简再求值，并用提公因式与平方差公式因式分解",
      goals: ["先化简，再求当 $x=" + t + "$ 时的值", "把多项式因式分解"],
      givens: ["求值时代入 $x=" + t + "$"],
      solution: [
        "$(x+" + a + ")^{2}-(x+" + a + ")(x-" + a + ")=(x+" + a + ")\\left[(x+" + a + ")-(x-" + a + ")\\right]=" + (2 * a) + "x+" + (2 * a * a) + "$",
        "当 $x=" + t + "$ 时，原式 $=" + (2 * a) + "\\times " + t + "+" + (2 * a * a) + "=" + v1 + "$",
        "$x^{3}-" + (g * g) + "x=x(x^{2}-" + (g * g) + ")=x(x+" + g + ")(x-" + g + ")$"
      ],
      steps: [
        { text: "提取公因式 $(x+" + a + ")$ 后再化简", basis: "提公因式法与整式乘法" },
        { text: "代入求值", basis: "代入求值" },
        { text: "先提公因式 $x$，再用平方差公式", basis: "提公因式法与平方差公式" }
      ],
      checks: [
        { expr: "aa*t+2*a*a", at: { aa: 2 * a, t: t, a: a }, expect: v1 },
        { expr: "x^3-gg*x", at: { x: g, gg: g * g }, expect: 0 }
      ]
    };
  }

  if (mode === 2) {
    const s = ri(r, 5, 15), q = ri(r, 2, 12);
    const v1 = s * s - 2 * q, v2 = s * s - 4 * q;
    return {
      params: withBase({ mode: 2, s: s, q: q, v1: v1, v2: v2, twoq: 2 * q, fourq: 4 * q }),
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
        { expr: "s^2-twoq", at: { s: s, twoq: 2 * q }, expect: v1 },
        { expr: "s^2-fourq", at: { s: s, fourq: 4 * q }, expect: v2 }
      ]
    };
  }

  const p = ri(r, 4, 12), d = ri(r, 2, 9);
  const v1 = p * d, v2 = p * p - d * d;
  return {
    params: withBase({ mode: 3, p: p, d: d, v1: v1, v2: v2 }),
    stem: "已知 $a+b=" + p + "$\uff0c$a-b=" + d + "$。\n（1）求 $(a+b)(a-b)$ 的值；\n（2）求 $(a+b)^{2}-(a-b)^{2}$ 的值。",
    answer: n2(v1, v2),
    goal: "用平方差公式与完全平方公式的变形求值",
    goals: ["求 $(a+b)(a-b)$ 的值", "求 $(a+b)^{2}-(a-b)^{2}$ 的值"],
    givens: ["$a+b=" + p + "$\uff0c$a-b=" + d + "$"],
    solution: [
      "$(a+b)(a-b)=" + p + "\\times " + d + "=" + v1 + "$",
      "$(a+b)^{2}-(a-b)^{2}=4ab$，由 $(a+b)^{2}-(a-b)^{2}=" + p + "^{2}-" + d + "^{2}=" + v2 + "$"
    ],
    steps: [
      { text: "用平方差公式", basis: "平方差公式" },
      { text: "化为 $4ab$ 后用两个平方差计算", basis: "完全平方公式的变形" }
    ],
    checks: [
      { expr: "p*d", at: { p: p, d: d }, expect: v1 },
      { expr: "p*p-d*d", at: { p: p, d: d }, expect: v2 }
    ]
  };
}
