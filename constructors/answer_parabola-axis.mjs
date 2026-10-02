export const kind = "answer/parabola-axis";
export const covers = ["对称轴", "顶点式"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779c1, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function rd(r, a, b) { return ri(r, a, b) * (r() < 0.5 ? -1 : 1); }
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
function eqOf(b, c) { return "$y=x^{2}" + lin(b) + con(c) + "$"; }
function n3(a, b, c) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b + "\uff1b\uff083\uff09" + c; }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 2);

  if (mode === 0) {
    const k = rd(r, 1, 6);
    const b = -2 * k;
    const x0 = rd(r, 1, 6);
    const y0 = ri(r, -10, 14);
    const c = y0 - x0 * x0 - b * x0;
    const vy = c - k * k;
    return {
      params: { mode: 0, k: k, b: b, c: c, x0: x0, y0: y0, vy: vy },
      stem: "已知抛物线 " + eqOf(b, c) + " 的对称轴是直线 $x=" + k + "$，且经过点 $A(" + x0 + "," + y0 + ")$。\n（1）求 $b$，$c$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）求这条抛物线与 $y$ 轴交点的坐标。",
      answer: n3("b=" + b + "\uff0cc=" + c, "\u9876\u70b9 (" + k + "," + vy + ")", "(0," + c + ")"),
      goal: "由对称轴和一点确定二次函数，并求顶点与与 y 轴的交点",
      goals: ["求 $b$，$c$ 的值", "求抛物线的顶点坐标", "求抛物线与 $y$ 轴交点的坐标"],
      givens: [
        "抛物线 " + eqOf(b, c) + " 的对称轴是直线 $x=" + k + "$",
        "抛物线经过点 $A(" + x0 + "," + y0 + ")$"
      ],
      solution: [
        "对称轴为 $x=-\\dfrac{b}{2}=" + k + "$，所以 $b=" + b + "$",
        "把 $A(" + x0 + "," + y0 + ")$ 代入得 $" + y0 + "=" + (x0 * x0) + "+(" + b + ")\\times(" + x0 + ")+c$，解得 $c=" + c + "$",
        "顶点横坐标为 $" + k + "$，纵坐标为 $" + vy + "$，顶点是 $(" + k + "," + vy + ")$",
        "令 $x=0$，得 $y=" + c + "$，与 $y$ 轴交于 $(0," + c + ")$"
      ],
      steps: [
        { text: "由对称轴公式求 $b$", basis: "二次函数图象的对称轴" },
        { text: "代入已知点求 $c$", basis: "待定系数法" },
        { text: "用公式求顶点", basis: "二次函数的顶点坐标" }
      ],
      checks: [
        { expr: "0-b/2", at: { b: b }, expect: k },
        { expr: "x^2+b*x+c", at: { x: x0, b: b, c: c }, expect: y0 },
        { expr: "c-b*b/4", at: { b: b, c: c }, expect: vy }
      ]
    };
  }

  if (mode === 1) {
    const t = ri(r, 2, 8);
    const d = ri(r, 1, 4);
    const u = t - d, v = t + d;
    const b = -(u + v), c = u * v;
    const vy = c - b * b / 4;
    return {
      params: { mode: 1, u: u, v: v, b: b, c: c, axis: t, vy: vy },
      stem: "已知抛物线 " + eqOf(b, c) + " 与 $x$ 轴交于点 $A(" + u + ",0)$ 和点 $B(" + v + ",0)$。\n（1）求 $b$，$c$ 的值；\n（2）求这条抛物线的对称轴；\n（3）求这条抛物线的顶点坐标。",
      answer: n3("b=" + b + "\uff0cc=" + c, "\u76f4\u7ebf x=" + t, "\u9876\u70b9 (" + t + "," + vy + ")"),
      goal: "由抛物线与 x 轴交点求解析式、对称轴和顶点",
      goals: ["求 $b$，$c$ 的值", "求抛物线的对称轴", "求抛物线的顶点坐标"],
      givens: [
        "抛物线 " + eqOf(b, c) + " 与 $x$ 轴交于点 $A(" + u + ",0)$",
        "抛物线经过点 $B(" + v + ",0)$"
      ],
      solution: [
        "$x=" + u + "$ 与 $x=" + v + "$ 是方程 $x^{2}" + lin(b) + con(c) + "=0$ 的两根，所以 $b=-(" + u + "+" + v + ")=" + b + "$\uff0c$c=" + u + "\\times " + v + "=" + c + "$",
        "对称轴为直线 $x=\\dfrac{" + u + "+" + v + "}{2}=" + t + "$",
        "把 $x=" + t + "$ 代入得 $y=" + vy + "$，顶点是 $(" + t + "," + vy + ")$"
      ],
      steps: [
        { text: "用两根之和与两根之积求 $b$、$c$", basis: "根与系数的关系" },
        { text: "对称轴在两交点正中间", basis: "二次函数图象的对称轴" },
        { text: "代入求顶点纵坐标", basis: "二次函数的顶点坐标" }
      ],
      checks: [
        { expr: "x^2+b*x+c", at: { x: u, b: b, c: c }, expect: 0 },
        { expr: "x^2+b*x+c", at: { x: v, b: b, c: c }, expect: 0 },
        { expr: "0-b/2", at: { b: b }, expect: t }
      ]
    };
  }

  const h = rd(r, 1, 6);
  const b = -2 * h;
  const c = ri(r, -8, 10);
  const vy = c - h * h;
  return {
    params: { mode: 2, h: h, b: b, c: c, vy: vy },
    stem: "已知抛物线 " + eqOf(b, c) + " 的顶点在直线 $x=" + h + "$ 上，且与 $y$ 轴交于点 $(0," + c + ")$。\n（1）求 $b$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）当 $x$ 取何值时，$y$ 的值最小？最小值是多少？",
    answer: n3("b=" + b, "\u9876\u70b9 (" + h + "," + vy + ")", "x=" + h + "\uff0c\u6700\u5c0f\u503c " + vy),
    goal: "由顶点所在直线确定二次函数，并求顶点与最值",
    goals: ["求 $b$ 的值", "求抛物线的顶点坐标", "求 $y$ 取最小值时的 $x$ 值与最小值"],
    givens: [
      "抛物线 " + eqOf(b, c) + " 的顶点在直线 $x=" + h + "$ 上",
      "抛物线与 $y$ 轴交于点 $(0," + c + ")$"
    ],
    solution: [
      "顶点横坐标为 $" + h + "$，由 $x=-\\dfrac{b}{2}=" + h + "$ 得 $b=" + b + "$",
      "把 $x=" + h + "$ 代入得 $y=" + vy + "$，顶点是 $(" + h + "," + vy + ")$",
      "因为 $x^{2}$ 的系数为 $1>0$，所以当 $x=" + h + "$ 时 $y$ 最小，最小值为 $" + vy + "$"
    ],
    steps: [
      { text: "由顶点横坐标求 $b$", basis: "二次函数图象的对称轴" },
      { text: "代入求顶点纵坐标", basis: "二次函数的顶点坐标" },
      { text: "开口向上时顶点处取最小值", basis: "二次函数的最值" }
    ],
    checks: [
      { expr: "0-b/2", at: { b: b }, expect: h },
      { expr: "h*h+b*h+c", at: { h: h, b: b, c: c }, expect: vy },
      { expr: "c-b*b/4", at: { b: b, c: c }, expect: vy }
    ]
  };
}
