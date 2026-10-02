export const kind = "fill/quadratic-equation";
export const covers = ["一元二次方程"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779b9, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function lin(b) {
  if (b > 0) return "+" + b + "x";
  if (b < 0) return "-" + (-b) + "x";
  return "";
}
function con(c) {
  if (c > 0) return "+" + c;
  if (c < 0) return "-" + (-c);
  return "";
}
const BLANK = "\uff08  \uff09";

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const t = ri(r, 1, 8);
    const b = 2 * t, m = t * t;
    return {
      params: { mode: 0, b: b, m: m, half: t },
      stem: "若关于 $x$ 的方程 $x^{2}" + lin(b) + "+m=0$ 有两个相等的实数根，则 $m$ 的值是" + BLANK + "。",
      answer: String(m),
      goal: "由判别式为零求参数 $m$",
      goals: ["求 $m$ 的值"],
      givens: ["关于 $x$ 的方程 $x^{2}" + lin(b) + "+m=0$ 有两个相等的实数根"],
      solution: [
        "方程有两个相等实根，判别式 $\u0394=" + b + "^{2}-4m=0$",
        "解得 $m=" + m + "$"
      ],
      steps: [{ text: "令判别式为 $0$ 解出 $m$", basis: "一元二次方程根的判别式" }],
      checks: [{ expr: "b^2-4*m", at: { b: b, m: m }, expect: 0 }]
    };
  }

  if (mode === 1) {
    const u = ri(r, 1, 8) * (r() < 0.5 ? -1 : 1);
    const b = ri(r, -7, 7);
    const m = -(u * u + b * u);
    return {
      params: { mode: 1, u: u, b: b, m: m },
      stem: "已知 $x=" + u + "$ 是关于 $x$ 的方程 $x^{2}" + lin(b) + "+m=0$ 的一个根，则 $m$ 的值是" + BLANK + "。",
      answer: String(m),
      goal: "把一个根代入方程求参数",
      goals: ["求 $m$ 的值"],
      givens: ["$x=" + u + "$ 是关于 $x$ 的方程 $x^{2}" + lin(b) + "+m=0$ 的一个根"],
      solution: [
        "把 $x=" + u + "$ 代入方程，得关于 $m$ 的一次方程",
        "解得 $m=" + m + "$"
      ],
      steps: [{ text: "代入已知根，解出参数", basis: "方程解的意义" }],
      checks: [{ expr: "u^2+b*u+m", at: { u: u, b: b, m: m }, expect: 0 }]
    };
  }

  if (mode === 2) {
    let p = ri(r, 1, 6) * (r() < 0.5 ? -1 : 1);
    let q = ri(r, 1, 6) * (r() < 0.5 ? -1 : 1);
    if (q === p) q = -q;
    const b = -(p + q), c = p * q;
    const val = c - b + 1;
    return {
      params: { mode: 2, p: p, q: q, b: b, c: c, value: val },
      stem: "已知 $x_{1}$，$x_{2}$ 是方程 $x^{2}" + lin(b) + con(c) + "=0$ 的两个根，则 $(x_{1}+1)(x_{2}+1)$ 的值是" + BLANK + "。",
      answer: String(val),
      goal: "用根与系数关系求式子的值",
      goals: ["求 $(x_{1}+1)(x_{2}+1)$ 的值"],
      givens: ["方程 $x^{2}" + lin(b) + con(c) + "=0$ 的两个根为 $x_{1}$，$x_{2}$"],
      solution: [
        "由根与系数关系：$x_{1}+x_{2}=" + (-b) + "$\uff0c$x_{1}x_{2}=" + c + "$",
        "$(x_{1}+1)(x_{2}+1)=x_{1}x_{2}+(x_{1}+x_{2})+1=" + val + "$"
      ],
      steps: [{ text: "展开后用两根和与积代入", basis: "根与系数的关系" }],
      checks: [
        { expr: "(p+1)*(q+1)", at: { p: p, q: q }, expect: val },
        { expr: "c-b+1", at: { b: b, c: c }, expect: val }
      ]
    };
  }

  const t = ri(r, 1, 7);
  const b = 2 * t;
  const c = ri(r, -9, 9);
  const q = t * t - c;
  return {
    params: { mode: 3, t: t, b: b, c: c, q: q },
    stem: "把方程 $x^{2}" + lin(b) + con(c) + "=0$ 配方成 $(x+" + t + ")^{2}=q$ 的形式，则 $q$ 的值是" + BLANK + "。",
    answer: String(q),
    goal: "配方后读出右边的常数",
    goals: ["求 $q$ 的值"],
    givens: ["方程 $x^{2}" + lin(b) + con(c) + "=0$ 配方后为 $(x+" + t + ")^{2}=q$"],
    solution: [
      "移项后两边加上 $" + t + "^{2}$：$(x+" + t + ")^{2}=" + t + "^{2}" + con(-c) + "$",
      "所以 $q=" + q + "$"
    ],
    steps: [{ text: "配方：加上一次项系数一半的平方", basis: "配方法" }],
    checks: [{ expr: "t^2-c", at: { t: t, c: c }, expect: q }]
  };
}
