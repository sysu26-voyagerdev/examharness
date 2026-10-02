export const kind = "fill/parabola-intercepts";
export const covers = ["与坐标轴交点", "对称轴"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x85ebca6b, 2246822519) >>> 0) || 2463534242;
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

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    let p = ri(r, 1, 7) * (r() < 0.5 ? -1 : 1);
    let q = ri(r, 1, 7) * (r() < 0.5 ? -1 : 1);
    if (q === p) q = -q;
    const b = -(p + q), c = p * q;
    const s = [p, q].sort(function (a, z) { return a - z; });
    const u = s[0], v = s[1];
    return {
      params: { mode: 0, p: p, q: q, b: b, c: c, x1: u, x2: v },
      stem: "抛物线 $y=x^{2}" + lin(b) + con(c) + "$ 与 $x$ 轴交点的坐标是（　）。",
      answer: "$(" + u + ",0)$\uff0c$(" + v + ",0)$",
      goal: "令 $y=0$ 求抛物线与 $x$ 轴的交点",
      goals: ["求抛物线与 $x$ 轴交点的坐标"],
      givens: ["抛物线 $y=x^{2}" + lin(b) + con(c) + "$"],
      solution: [
        "令 $y=0$：$x^{2}" + lin(b) + con(c) + "=0$",
        "分解得 $(x" + con(-u) + ")(x" + con(-v) + ")=0$，$x=" + u + "$ 或 $x=" + v + "$"
      ],
      steps: [{ text: "解对应的一元二次方程", basis: "抛物线与 $x$ 轴交点的横坐标是方程的根" }],
      checks: [
        { expr: "x^2+b*x+c", at: { x: u, b: b, c: c }, expect: 0 },
        { expr: "x^2+b*x+c", at: { x: v, b: b, c: c }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    let p = ri(r, 1, 7) * (r() < 0.5 ? -1 : 1);
    let q = ri(r, 1, 7) * (r() < 0.5 ? -1 : 1);
    if (q === p) q = -q;
    const b = -(p + q), c = p * q;
    const d = Math.abs(p - q), h = Math.abs(c);
    const area = d * h / 2;
    return {
      params: { mode: 1, p: p, q: q, b: b, c: c, d: d, h: h, area: area },
      stem: "抛物线 $y=x^{2}" + lin(b) + con(c) + "$ 与 $x$ 轴交于 $A$，$B$ 两点，与 $y$ 轴交于点 $C$，则 $\u25b3ABC$ 的面积是（　）。",
      answer: String(area),
      goal: "求抛物线与两坐标轴围成的三角形面积",
      goals: ["求 $\u25b3ABC$ 的面积"],
      givens: ["抛物线 $y=x^{2}" + lin(b) + con(c) + "$", "与 $x$ 轴交点为 $A$，$B$，与 $y$ 轴交点为 $C$"],
      solution: [
        "$A$，$B$ 的横坐标是方程 $x^{2}" + lin(b) + con(c) + "=0$ 的根，$AB=" + d + "$",
        "点 $C(0," + c + ")$，$OC=" + h + "$，面积 $=\\dfrac{1}{2}\\times " + d + "\\times " + h + "=" + area + "$"
      ],
      steps: [{ text: "分别求出底与高再算面积", basis: "二次函数与坐标轴交点、三角形面积公式" }],
      checks: [{ expr: "d*h/2", at: { d: d, h: h }, expect: area }]
    };
  }

  if (mode === 2) {
    const t = ri(r, 0, 2);
    let B, C, disc, cnt;
    if (t === 0) {
      const t2 = ri(r, 1, 6);
      B = 2 * t2;
      C = ri(r, -8, 0);
      disc = B * B - 4 * C;
    } else if (t === 1) {
      const k = ri(r, 1, 8);
      B = -2 * k; C = k * k; disc = 0;
    } else {
      B = ri(r, -6, 6);
      C = Math.floor(B * B / 4) + ri(r, 1, 5);
      disc = B * B - 4 * C;
    }
    cnt = disc > 0 ? 2 : (disc === 0 ? 1 : 0);
    return {
      params: { mode: 2, b: B, c: C, disc: disc, count: cnt },
      stem: "二次函数 $y=x^{2}" + lin(B) + con(C) + "$ 的图象与 $x$ 轴交点的个数是（　）。",
      answer: String(cnt),
      goal: "由判别式的符号判断交点个数",
      goals: ["求图象与 $x$ 轴交点的个数"],
      givens: ["二次函数 $y=x^{2}" + lin(B) + con(C) + "$"],
      solution: [
        "判别式 $\u0394=" + B + "^{2}-4\\times(" + C + ")=" + disc + "$",
        "由 $\u0394$ 的符号得交点个数为 " + cnt
      ],
      steps: [{ text: "算判别式，再看符号决定交点个数", basis: "判别式与交点个数的对应关系" }],
      checks: [{ expr: "b^2-4*c", at: { b: B, c: C }, expect: disc }]
    };
  }

  let p = ri(r, 1, 9) * (r() < 0.5 ? -1 : 1);
  let q = ri(r, 1, 9) * (r() < 0.5 ? -1 : 1);
  if (q === p) q = -q;
  const b = -(p + q), c = p * q;
  const s2 = [p, q].sort(function (a, z) { return a - z; });
  const u = s2[0], v = s2[1], len = v - u;
  return {
    params: { mode: 3, p: p, q: q, b: b, c: c, u: u, v: v, len: len },
    stem: "抛物线 $y=x^{2}" + lin(b) + con(c) + "$ 与 $x$ 轴交于 $A$，$B$ 两点，则线段 $AB$ 的长是（　）。",
    answer: String(len),
    goal: "求抛物线与 $x$ 轴两交点间的距离",
    goals: ["求线段 $AB$ 的长"],
    givens: ["抛物线 $y=x^{2}" + lin(b) + con(c) + "$", "与 $x$ 轴的交点为 $A$，$B$"],
    solution: [
      "方程 $x^{2}" + lin(b) + con(c) + "=0$ 的根为 $" + u + "$\uff0c$" + v + "$",
      "$AB=" + v + "-(" + u + ")=" + len + "$"
    ],
    steps: [{ text: "求两根后用大根减小根", basis: "两点间距离与方程根的关系" }],
    checks: [{ expr: "v-u", at: { u: u, v: v }, expect: len }]
  };
}
