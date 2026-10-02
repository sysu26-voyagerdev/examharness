export const kind = "choice/quadratic-equation";
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
function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
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

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);
  const sign = () => (r() < 0.5 ? -1 : 1);
  let p = ri(r, 1, 9) * sign();
  let q = ri(r, 1, 9) * sign();
  if (q === p) q = -q;
  const b = -(p + q), c = p * q;
  const sorted = [p, q].sort((a, z) => a - z);
  const u = sorted[0], v = sorted[1];
  const eqn = "$x^{2}" + lin(b) + con(c) + "=0$";

  if (mode === 0) {
    const stem = "\u65b9\u7a0b " + eqn + " \u7684\u89e3\u662f\uff08  \uff09";
    const answer = "$x_{1}=" + u + "$\uff0c$x_{2}=" + v + "$";
    const cands = [[-u, -v], [u, -v], [-u, v], [u + 1, v], [u - 1, v], [u, v + 1], [u, v - 1]];
    const ds = [];
    for (const pair of cands) {
      const s2 = [pair[0], pair[1]].sort((a, z) => a - z);
      if (s2[0] === u && s2[1] === v) continue;
      const t = "$x_{1}=" + s2[0] + "$\uff0c$x_{2}=" + s2[1] + "$";
      if (ds.indexOf(t) >= 0) continue;
      ds.push(t);
      if (ds.length === 3) break;
    }
    return {
      params: { mode: 0, b: b, c: c, root1: u, root2: v, p: p, q: q },
      stem: stem,
      answer: answer,
      distractors: ds,
      goal: "\u6c42\u51fa\u65b9\u7a0b\u7684\u4e24\u4e2a\u5b9e\u6570\u89e3",
      goals: ["\u89e3\u65b9\u7a0b\uff0c\u5f97\u5230\u5b83\u7684\u4e24\u4e2a\u89e3"],
      givens: ["\u4e00\u5143\u4e8c\u6b21\u65b9\u7a0b " + eqn],
      solution: [
        "\u628a\u5de6\u8fb9\u5206\u89e3\u56e0\u5f0f\uff1a$(x" + con(-u) + ")(x" + con(-v) + ")=0$",
        "\u7531\u56e0\u5f0f\u4e58\u79ef\u4e3a\u96f6\uff0c\u5f97 $x=" + u + "$ \u6216 $x=" + v + "$"
      ],
      steps: [{ text: "\u56e0\u5f0f\u5206\u89e3\u540e\u4ee4\u6bcf\u4e2a\u56e0\u5f0f\u4e3a\u96f6", basis: "\u4e00\u5143\u4e8c\u6b21\u65b9\u7a0b\u7684\u56e0\u5f0f\u5206\u89e3\u6cd5" }],
      checks: [
        { expr: "x^2+b*x+c", at: { x: u, b: b, c: c }, expect: 0 },
        { expr: "x^2+b*x+c", at: { x: v, b: b, c: c }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    const stem = "\u5df2\u77e5\u5173\u4e8e $x$ \u7684\u65b9\u7a0b " + eqn + " \u7684\u4e00\u4e2a\u89e3\u662f $x=" + u + "$\uff0c\u5219\u8fd9\u4e2a\u65b9\u7a0b\u7684\u53e6\u4e00\u4e2a\u89e3\u662f\uff08  \uff09";
    const ds = [];
    for (const t of [-u, -v, u, u + v, u - v]) {
      const s2 = String(t);
      if (s2 === String(v) || ds.indexOf(s2) >= 0) continue;
      ds.push(s2);
      if (ds.length === 3) break;
    }
    return {
      params: { mode: 1, b: b, c: c, root1: u, root2: v, known: u, p: p, q: q },
      stem: stem,
      answer: String(v),
      distractors: ds,
      goal: "\u7531\u4e00\u4e2a\u89e3\u6c42\u53e6\u4e00\u4e2a\u89e3",
      goals: ["\u6c42\u51fa\u65b9\u7a0b\u7684\u53e6\u4e00\u4e2a\u89e3"],
      givens: [
        "\u5173\u4e8e $x$ \u7684\u65b9\u7a0b " + eqn,
        "$x=" + u + "$ \u662f\u65b9\u7a0b\u7684\u4e00\u4e2a\u89e3"
      ],
      solution: [
        "\u628a $x=" + u + "$ \u4ee3\u5165\u65b9\u7a0b\u6821\u9a8c\uff0c\u53ef\u5206\u89e3\u4e3a $(x" + con(-u) + ")(x" + con(-v) + ")=0$",
        "\u53e6\u4e00\u4e2a\u89e3\u4e3a $x=" + v + "$"
      ],
      steps: [{ text: "\u4ee3\u5165\u5df2\u77e5\u89e3\u6216\u7528\u4e24\u6839\u5173\u7cfb", basis: "\u65b9\u7a0b\u89e3\u7684\u5b9a\u4e49\u4e0e\u56e0\u5f0f\u5206\u89e3" }],
      checks: [
        { expr: "x^2+b*x+c", at: { x: u, b: b, c: c }, expect: 0 },
        { expr: "x^2+b*x+c", at: { x: v, b: b, c: c }, expect: 0 }
      ]
    };
  }

  if (mode === 2) {
    const val = u * u + v * v;
    const stem = "\u5df2\u77e5 $x_{1}$\uff0c$x_{2}$ \u662f\u65b9\u7a0b " + eqn + " \u7684\u4e24\u4e2a\u5b9e\u6570\u6839\uff0c\u5219 $x_{1}^{2}+x_{2}^{2}$ \u7684\u503c\u662f\uff08  \uff09";
    const cand = [(u + v) * (u + v), (u - v) * (u - v), -(u * u + v * v), u * u - v * v, (u + v) * (u + v) + 2 * u * v];
    const ds = [];
    for (const t of cand) {
      if (t === val || ds.indexOf(String(t)) >= 0) continue;
      ds.push(String(t));
      if (ds.length === 3) break;
    }
    return {
      params: { mode: 2, b: b, c: c, root1: u, root2: v, sum: u + v, prod: u * v, value: val, p: p, q: q },
      stem: stem,
      answer: String(val),
      distractors: ds,
      goal: "\u7528\u6839\u4e0e\u7cfb\u6570\u5173\u7cfb\u6c42 $x_{1}^{2}+x_{2}^{2}$",
      goals: ["\u6c42 $x_{1}^{2}+x_{2}^{2}$ \u7684\u503c"],
      givens: [
        "\u65b9\u7a0b " + eqn + " \u7684\u4e24\u6839\u4e3a $x_{1}$\uff0c$x_{2}$",
        "$x_{1}+x_{2}=" + (-b) + "$\uff0c$x_{1}x_{2}=" + c + "$"
      ],
      solution: [
        "\u6839\u636e\u6839\u4e0e\u7cfb\u6570\u5173\u7cfb\uff0c$x_{1}+x_{2}=" + (-b) + "$\uff0c$x_{1}x_{2}=" + c + "$",
        "$x_{1}^{2}+x_{2}^{2}=(x_{1}+x_{2})^{2}-2x_{1}x_{2}=" + val + "$"
      ],
      steps: [{ text: "\u628a\u5e73\u65b9\u548c\u6539\u5199\u6210\u4e24\u6839\u548c\u4e0e\u79ef", basis: "\u6839\u4e0e\u7cfb\u6570\u5173\u7cfb" }],
      checks: [
        { expr: "(u+v)^2-2*u*v", at: { u: u, v: v }, expect: val },
        { expr: "b^2-2*c", at: { b: b, c: c }, expect: val }
      ]
    };
  }

  const t = ri(r, 0, 2);
  let B, C, disc, ansText, others;
  if (t === 0) {
    B = b; C = c; disc = (p - q) * (p - q);
    ansText = "\u6709\u4e24\u4e2a\u4e0d\u76f8\u7b49\u7684\u5b9e\u6570\u6839";
  } else if (t === 1) {
    const k = ri(r, 1, 8);
    B = -2 * k; C = k * k; disc = 0;
    ansText = "\u6709\u4e24\u4e2a\u76f8\u7b49\u7684\u5b9e\u6570\u6839";
  } else {
    B = ri(r, -6, 6);
    C = Math.floor(B * B / 4) + ri(r, 1, 5);
    disc = B * B - 4 * C;
    ansText = "\u6ca1\u6709\u5b9e\u6570\u6839";
  }
  others = ["\u6709\u4e24\u4e2a\u4e0d\u76f8\u7b49\u7684\u5b9e\u6570\u6839", "\u6709\u4e24\u4e2a\u76f8\u7b49\u7684\u5b9e\u6570\u6839", "\u6ca1\u6709\u5b9e\u6570\u6839", "\u65e0\u6cd5\u786e\u5b9a"].filter(function (s) { return s !== ansText; }).slice(0, 3);
  const eqn2 = "$x^{2}" + lin(B) + con(C) + "=0$";
  return {
    params: { mode: 3, b: B, c: C, discriminant: disc },
    stem: "\u5173\u4e8e $x$ \u7684\u65b9\u7a0b " + eqn2 + " \u7684\u6839\u7684\u60c5\u51b5\u662f\uff08  \uff09",
    answer: ansText,
    distractors: others,
    goal: "\u7528\u5224\u522b\u5f0f\u5224\u65ad\u65b9\u7a0b\u6839\u7684\u60c5\u51b5",
    goals: ["\u4e0d\u89e3\u65b9\u7a0b\uff0c\u5224\u65ad\u65b9\u7a0b\u6839\u7684\u60c5\u51b5"],
    givens: ["\u5173\u4e8e $x$ \u7684\u4e00\u5143\u4e8c\u6b21\u65b9\u7a0b " + eqn2],
    solution: [
      "\u8ba1\u7b97\u5224\u522b\u5f0f $\u0394=" + B + "^{2}-4\times(" + C + ")=" + disc + "$",
      "\u7531 $\u0394$ \u7684\u7b26\u53f7\u5f97\u7ed3\u8bba\uff1a" + ansText
    ],
    steps: [{ text: "\u7b97\u51fa\u5224\u522b\u5f0f\u5e76\u770b\u7b26\u53f7", basis: "\u4e00\u5143\u4e8c\u6b21\u65b9\u7a0b\u6839\u7684\u5224\u522b\u5f0f" }],
    checks: [
      { expr: "b^2-4*c", at: { b: B, c: C }, expect: disc }
    ]
  };
}
