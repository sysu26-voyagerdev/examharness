export const kind = "answer/quadratic-comprehensive";
export const covers = ["二次函数综合", "对称轴", "顶点式", "与坐标轴交点"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779d1, 2246822519) >>> 0) || 2463534242;
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
    const x1 = rd(r, 1, 5), x2 = x1 + 1 + ri(r, 1, 4);
    const b = rd(r, 2, 8), c = rd(r, 1, 9);
    const y1 = x1 * x1 + b * x1 + c, y2 = x2 * x2 + b * x2 + c;
    const vy = c - b * b / 4;
    return {
      params: { mode: 0, x1: x1, y1: y1, x2: x2, y2: y2, b: b, c: c, vy: vy },
      stem: "已知抛物线 " + eqOf(b, c) + " 经过点 $A(" + x1 + "," + y1 + ")$ 和点 $B(" + x2 + "," + y2 + ")$。\n（1）求 $b$，$c$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）求这条抛物线与 $y$ 轴交点的坐标。",
      answer: n3("b=" + b + "\uff0cc=" + c, "\u9876\u70b9 (" + (-b / 2) + "," + vy + ")", "(0," + c + ")"),
      goal: "由两点确定二次函数，并求顶点与与 y 轴的交点",
      goals: ["求 $b$，$c$ 的值", "求抛物线的顶点坐标", "求抛物线与 $y$ 轴交点的坐标"],
      givens: [
        "抛物线 " + eqOf(b, c) + " 经过点 $A(" + x1 + "," + y1 + ")$",
        "抛物线经过点 $B(" + x2 + "," + y2 + ")$"
      ],
      solution: [
        "把 $A$，$B$ 两点的坐标代入得方程组，解得 $b=" + b + "$\uff0c$c=" + c + "$",
        "顶点横坐标为 $x=-\\dfrac{" + b + "}{2}=" + (-b / 2) + "$，纵坐标为 $" + vy + "$",
        "令 $x=0$，得 $y=" + c + "$，与 $y$ 轴交于 $(0," + c + ")$"
      ],
      steps: [
        { text: "用待定系数法求 $b$、$c$", basis: "二次函数解析式的确定" },
        { text: "用公式求顶点", basis: "二次函数的顶点坐标" },
        { text: "令 $x=0$ 求与 $y$ 轴的交点", basis: "函数图象与坐标轴的交点" }
      ],
      checks: [
        { expr: "x^2+b*x+c", at: { x: x1, b: b, c: c }, expect: y1 },
        { expr: "x^2+b*x+c", at: { x: x2, b: b, c: c }, expect: y2 },
        { expr: "c-b*b/4", at: { b: b, c: c }, expect: vy }
      ]
    };
  }

  if (mode === 1) {
    const u = rd(r, 1, 6), v = u + 1 + ri(r, 1, 5);
    const b = -(u + v), c = u * v;
    const vy = c - b * b / 4;
    const dh = v - u;
    const h = c < 0 ? -c : c;
    const area = dh * h / 2;
    return {
      params: { mode: 1, u: u, v: v, b: b, c: c, vy: vy, dh: dh, h: h, area: area },
      stem: "已知抛物线 " + eqOf(b, c) + " 与 $x$ 轴交于点 $A(" + u + ",0)$ 和点 $B(" + v + ",0)$，与 $y$ 轴交于点 $C$。\n（1）求 $b$，$c$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）求 $\u25b3ABC$ 的面积。",
      answer: n3("b=" + b + "\uff0cc=" + c, "\u9876\u70b9 (" + (-b / 2) + "," + vy + ")", "\u9762\u79ef " + area),
      goal: "由抛物线与 x 轴交点求解析式、顶点，并求三角形的面积",
      goals: ["求 $b$，$c$ 的值", "求抛物线的顶点坐标", "求 $\u25b3ABC$ 的面积"],
      givens: [
        "抛物线 " + eqOf(b, c) + " 与 $x$ 轴交于点 $A(" + u + ",0)$",
        "抛物线与 $x$ 轴交于点 $B(" + v + ",0)$",
        "抛物线与 $y$ 轴交于点 $C$"
      ],
      solution: [
        "$x=" + u + "$ 与 $x=" + v + "$ 是方程 $x^{2}" + lin(b) + con(c) + "=0$ 的两根，得 $b=" + b + "$\uff0c$c=" + c + "$",
        "顶点横坐标为 $" + (-b / 2) + "$，纵坐标为 $" + vy + "$",
        "$AB=" + dh + "$\uff0c$点 $C(0," + c + ")$，$OC=" + h + "$，面积 $=\\dfrac{1}{2}\\times " + dh + "\\times " + h + "=" + area + "$"
      ],
      steps: [
        { text: "用两根之和与两根之积求 $b$、$c$", basis: "根与系数的关系" },
        { text: "用公式求顶点", basis: "二次函数的顶点坐标" },
        { text: "以 $AB$ 为底、$OC$ 为高求面积", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "x^2+b*x+c", at: { x: u, b: b, c: c }, expect: 0 },
        { expr: "x^2+b*x+c", at: { x: v, b: b, c: c }, expect: 0 },
        { expr: "dh*h/2", at: { dh: dh, h: h }, expect: area }
      ]
    };
  }

  const a = ri(r, 10, 30), m = ri(r, 50, 200), x0 = a + ri(r, 2, 6);
  const b = 2 * a, c = m - a * a;
  const w0 = m - (x0 - a) * (x0 - a);
  return {
    params: { mode: 2, a: a, m: m, b: b, c: c, x0: x0, w0: w0 },
    stem: "某商店销售一种商品，若售价为 $x$ 元，则每天获得的利润 $w$（单位：元）满足 $w=-(x-" + a + ")^{2}+" + m + "$。\n（1）把 $w$ 与 $x$ 的关系式写成 $w=ax^{2}+bx+c$ 的形式，求 $a$，$b$，$c$ 的值；\n（2）求每天获得的最大利润；\n（3）求每天获得最大利润时的售价。",
    answer: n3("a=-1\uff0cb=" + b + "\uff0cc=" + c, "\u6700\u5927\u5229\u6da6 " + m + " \u5143", "\u552e\u4ef7 " + a + " \u5143"),
    goal: "从实际情境写出二次函数关系式，并求最大值及其对应取值",
    goals: ["求 $a$，$b$，$c$ 的值", "求每天的最大利润", "求每天获得最大利润时的售价"],
    givens: ["每天利润 $w$ 与售价 $x$ 满足 $w=-(x-" + a + ")^{2}+" + m + "$"],
    solution: [
      "$w=-(x-" + a + ")^{2}+" + m + "=-x^{2}" + lin(b) + con(c) + "$，所以 $a=-1$\uff0c$b=" + b + "$\uff0c$c=" + c + "$",
      "因为二次项系数为 $-1<0$，所以当 $x=" + a + "$ 时 $w$ 最大",
      "最大利润为 $" + m + "$ 元，此时售价为 $" + a + "$ 元"
    ],
    steps: [
      { text: "展开配方形式得一般式", basis: "整式乘法" },
      { text: "开口向下时顶点处取最大值", basis: "二次函数的最值" },
      { text: "顶点横坐标即取得最值时的取值", basis: "二次函数的顶点" }
    ],
    checks: [
      { expr: "m-(x-a)*(x-a)", at: { x: x0, a: a, m: m }, expect: w0 },
      { expr: "b*b/4+c", at: { b: b, c: c }, expect: m },
      { expr: "b/2", at: { b: b }, expect: a }
    ]
  };
}
