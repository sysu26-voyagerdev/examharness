export const kind = "dynamic/quadratic-3part";
export const covers = ["与坐标轴交点", "顶点式", "对称轴", "二次函数图象", "最值"];

function rngOf(seed) {
  let s = Math.abs(Math.floor(Number(seed) || 1)) % 2147483647;
  if (s === 0) s = 1;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s;
  };
}

export function construct(slot, seed) {
  const rnd = rngOf(seed);
  const pick = function (arr) { return arr[rnd() % arr.length]; };
  const mode = Math.abs(Math.floor(Number(seed) || 1)) % 3;
  if (mode === 0) return modeIntercept(pick);
  if (mode === 1) return modeVertex(pick);
  return modeAxis(pick);
}

// 结构一：与 x 轴两个交点 + 与 y 轴交点
function modeIntercept(pick) {
  const pairs = [[5, 1], [5, 3], [6, 2], [6, 4], [7, 1], [7, 3], [7, 5], [8, 2], [8, 4], [8, 6], [9, 3], [9, 5], [9, 7]];
  const p = pick(pairs);
  const u = p[0];
  const v = p[1];
  const b = u + v;
  const c = u * v;
  const a1 = -u;
  const a2 = -v;
  const vx = -(u + v) / 2;
  const vy = -Math.pow((u - v) / 2, 2);
  const area = ((u - v) * c) / 2;
  return {
    params: { mode: 0, u: u, v: v, b: b, c: c, a1: a1, a2: a2, vx: vx, vy: vy, area: area },
    stem: "已知抛物线 $y=x^{2}+bx+c$ 与 $x$ 轴交于点 $A(" + a1 + ",0)$ 和点 $B(" + a2 + ",0)$，与 $y$ 轴交于点 $C$。\n（1）求 $b$、$c$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）求 $△ABC$ 的面积。",
    answer: "b=" + b + ",\\ c=" + c + ";\\quad (" + vx + "," + vy + ");\\quad S= " + area,
    goal: "求b、c的值 求顶点坐标 求三角形面积",
    goals: ["求 $b$、$c$ 的值", "求这条抛物线的顶点坐标", "求 $△ABC$ 的面积"],
    givens: [
      "抛物线 $y=x^{2}+bx+c$ 与 $x$ 轴交于点 $A(" + a1 + ",0)$",
      "这条抛物线与 $x$ 轴交于点 $B(" + a2 + ",0)$",
      "这条抛物线与 $y$ 轴交于点 $C$"
    ],
    solution: [
      "把 $A(" + a1 + ",0)$、$B(" + a2 + ",0)$ 代入 $y=x^{2}+bx+c$，得 $b=" + b + "$，$c=" + c + "$。",
      "配方得 $y=(x+" + vx + ")^{2}+(" + vy + ")$，顶点为 $(" + vx + "," + vy + ")$。",
      "点 $C(0," + c + ")$，$AB=" + (u - v) + "$，$OC=" + c + "$，$S_{\\triangle ABC}=\\frac{1}{2}\\times" + (u - v) + "\\times" + c + "=" + area + "$。"
    ],
    steps: [
      { text: "设 $y=(x-" + a1 + ")(x-" + a2 + ")$，展开得 $b=" + b + "$，$c=" + c + "$。", basis: "待定系数法" },
      { text: "$y=x^{2}+" + b + "x+" + c + "=(x+" + vx + ")^{2}+(" + vy + ")$，顶点为 $(" + vx + "," + vy + ")$。", basis: "配方法求顶点" },
      { text: "$C(0," + c + ")$，$AB=" + (u - v) + "$，$S_{\\triangle ABC}=\\frac{1}{2}AB\\cdot OC=" + area + "$。", basis: "三角形面积公式" }
    ],
    checks: [
      { expr: "x^2+b*x+c", at: { x: a1, b: b, c: c }, expect: 0 },
      { expr: "x^2+b*x+c", at: { x: a2, b: b, c: c }, expect: 0 },
      { expr: "c-b*b/4", at: { b: b, c: c }, expect: vy },
      { expr: "(u-v)*u*v/2", at: { u: u, v: v }, expect: area }
    ]
  };
}

// 结构二：顶点 + 一点（二次项系数未知）
function modeVertex(pick) {
  const a = pick([1, 2]);
  const h = pick([-3, -2, -1, 1, 2, 3]);
  const m = pick([1, 2, 3]);
  const k = -m * m;
  const d = pick([1, 2, 3]);
  const x0 = h + d;
  const y0 = k + a * d * d;
  const b = -2 * a * h;
  const c = k + a * h * h;
  return {
    params: { mode: 1, a: a, h: h, k: k, d: d, x0: x0, y0: y0, b: b, c: c },
    stem: "已知抛物线 $y=ax^{2}+bx+c$ 的顶点为 $P(" + h + "," + k + ")$，且经过点 $A(" + x0 + "," + y0 + ")$。\n（1）求 $a$、$b$、$c$ 的值；\n（2）求这条抛物线与 $y$ 轴交点的坐标；\n（3）当 $x$ 取何值时，$y$ 取得最小值？最小值是多少？",
    answer: "a=" + a + ",\\ b=" + b + ",\\ c=" + c + ";\\quad (0," + c + ");\\quad x=" + h + ",\\ y=" + k,
    goal: "求a、b、c的值 求与y轴交点的坐标 求最小值及对应的x值",
    goals: ["求 $a$、$b$、$c$ 的值", "求这条抛物线与 $y$ 轴交点的坐标", "当 $x$ 取何值时 $y$ 取得最小值？最小值是多少？"],
    givens: [
      "抛物线 $y=ax^{2}+bx+c$ 的顶点为 $P(" + h + "," + k + ")$",
      "这条抛物线经过点 $A(" + x0 + "," + y0 + ")$"
    ],
    solution: [
      "设 $y=a(x-" + h + ")^{2}+(" + k + ")$，把 $A(" + x0 + "," + y0 + ")$ 代入得 $" + y0 + "=a\\times" + d * d + "+(" + k + ")$，解得 $a=" + a + "$。",
      "展开得 $y=" + a + "x^{2}+" + b + "x" + (c < 0 ? "-" + Math.abs(c) : "+" + c) + "$，即 $b=" + b + "$，$c=" + c + "$。",
      "令 $x=0$，得与 $y$ 轴的交点为 $(0," + c + ")$。",
      "因为 $a=" + a + ">0$，当 $x=" + h + "$ 时 $y$ 取得最小值 $" + k + "$。"
    ],
    steps: [
      { text: "设顶点式 $y=a(x-" + h + ")^{2}+(" + k + ")$，代入 $A(" + x0 + "," + y0 + ")$ 解得 $a=" + a + "$。", basis: "顶点式" },
      { text: "展开得 $b=" + b + "$，$c=" + c + "$。", basis: "整式乘法" },
      { text: "与 $y$ 轴交点横坐标为 $0$，纵坐标为 $" + c + "$。", basis: "与坐标轴交点" },
      { text: "顶点处函数值最小，为 $" + k + "$。", basis: "二次函数的最值" }
    ],
    checks: [
      { expr: "0-b/(2*a)", at: { a: a, b: b }, expect: h },
      { expr: "c-b*b/(4*a)", at: { a: a, b: b, c: c }, expect: k },
      { expr: "a*x^2+b*x+c", at: { a: a, b: b, c: c, x: x0 }, expect: y0 }
    ]
  };
}

// 结构三：对称轴 + 一点
function modeAxis(pick) {
  const k = pick([-4, -3, -2, -1, 1, 2, 3, 4]);
  const b = -2 * k;
  const c = pick([-8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8]);
  const d = pick([2, 3]);
  const x0 = k + d;
  const y0 = x0 * x0 + b * x0 + c;
  const vy = c - (b * b) / 4;
  const e1 = pick([1, 2, 3]);
  const e2 = e1 + pick([1, 2]);
  let x1 = k + e1;
  let x2 = k + e2;
  if (pick([0, 1]) === 1) {
    const t = x1;
    x1 = x2;
    x2 = t;
  }
  const y1 = x1 * x1 + b * x1 + c;
  const y2 = x2 * x2 + b * x2 + c;
  const firstSmaller = Math.abs(x1 - k) < Math.abs(x2 - k);
  const cmpInline = firstSmaller ? "y1<y2" : "y1>y2";
  const cmpMath = firstSmaller ? "$y_{1}<y_{2}$" : "$y_{1}>y_{2}$";
  return {
    params: { mode: 2, k: k, b: b, c: c, d: d, x0: x0, y0: y0, vy: vy, x1: x1, x2: x2, y1: y1, y2: y2 },
    stem: "已知抛物线 $y=x^{2}+bx+c$ 的对称轴是直线 $x=" + k + "$，且经过点 $A(" + x0 + "," + y0 + ")$。\n（1）求 $b$、$c$ 的值；\n（2）求这条抛物线的顶点坐标；\n（3）设点 $M(" + x1 + ",y_{1})$、$N(" + x2 + ",y_{2})$ 都在该抛物线上，比较 $y_{1}$ 与 $y_{2}$ 的大小。",
    answer: "b=" + b + ",\\ c=" + c + ";\\quad (" + k + "," + vy + ");\\quad " + cmpInline,
    goal: "求b、c的值 求顶点坐标 比较两点函数值的大小",
    goals: ["求 $b$、$c$ 的值", "求这条抛物线的顶点坐标", "比较 $y_{1}$ 与 $y_{2}$ 的大小"],
    givens: [
      "抛物线 $y=x^{2}+bx+c$ 的对称轴是直线 $x=" + k + "$",
      "这条抛物线经过点 $A(" + x0 + "," + y0 + ")$"
    ],
    solution: [
      "由对称轴 $x=-\\frac{b}{2}=" + k + "$ 得 $b=" + b + "$。",
      "把 $A(" + x0 + "," + y0 + ")$ 代入 $y=x^{2}+" + b + "x+c$，得 $c=" + c + "$。",
      "顶点为 $(" + k + "," + vy + ")$。",
      "抛物线开口向上，离对称轴越远的点函数值越大。$M$ 到对称轴的距离为 $" + Math.abs(x1 - k) + "$，$N$ 到对称轴的距离为 $" + Math.abs(x2 - k) + "$，所以 " + cmpMath + "。"
    ],
    steps: [
      { text: "由 $-\\frac{b}{2}=" + k + "$ 得 $b=" + b + "$。", basis: "对称轴公式" },
      { text: "把 $A(" + x0 + "," + y0 + ")$ 代入解析式得 $c=" + c + "$。", basis: "待定系数法" },
      { text: "顶点为 $(" + k + "," + vy + ")$。", basis: "顶点在对称轴上" },
      { text: "开口向上，比较两点到对称轴的距离即可。", basis: "二次函数图象的对称性" }
    ],
    checks: [
      { expr: "0-b/2", at: { b: b }, expect: k },
      { expr: "x^2+b*x+c", at: { x: x0, b: b, c: c }, expect: y0 },
      { expr: "c-b*b/4", at: { b: b, c: c }, expect: vy },
      { expr: "(x1-k)*(x1-k)-(x2-k)*(x2-k)", at: { x1: x1, x2: x2, k: k }, expect: (x1 - k) * (x1 - k) - (x2 - k) * (x2 - k) }
    ]
  };
}
