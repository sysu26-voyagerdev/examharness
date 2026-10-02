export const kind = "answer/linear-function";
export const covers = ["一次函数"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x85ebca77, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function exprOf(k, b) {
  const head = k === 1 ? "y=x" : (k === -1 ? "y=-x" : "y=" + k + "x");
  return head + (b < 0 ? "-" + (-b) : "+" + b);
}
function termOf(k, b) {
  const head = k === 1 ? "x" : (k === -1 ? "-x" : k + "x");
  return head + (b < 0 ? "-" + (-b) : "+" + b);
}
function n3(a, b, c) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b + "\uff1b\uff083\uff09" + c; }
function n2(a, b) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b; }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const k = ri(r, 1, 4) * (r() < 0.5 ? -1 : 1);
    const b = ri(r, -4, 4) * k;
    const x1 = -ri(r, 2, 5), x2 = ri(r, 1, 5);
    const y1 = k * x1 + b, y2 = k * x2 + b;
    const x3 = ri(r, -5, 5);
    const inside = r() < 0.5;
    const y3 = k * x3 + b + (inside ? 0 : (r() < 0.5 ? 1 : -1));
    const xin = -b / k;
    return {
      params: { mode: 0, k: k, b: b, x1: x1, y1: y1, x2: x2, y2: y2, x3: x3, y3: y3, xin: xin, on: inside ? 1 : 0 },
      stem: "已知一次函数的图象经过点 $A(" + x1 + "," + y1 + ")$ 和点 $B(" + x2 + "," + y2 + ")$。\n（1）求这个一次函数的解析式；\n（2）求它的图象与 $x$ 轴交点的坐标；\n（3）判断点 $P(" + x3 + "," + y3 + ")$ 是否在这个函数的图象上。",
      answer: n3(exprOf(k, b), "(" + xin + ",0)", inside ? "\u70b9 P \u5728\u56fe\u8c61\u4e0a" : "\u70b9 P \u4e0d\u5728\u56fe\u8c61\u4e0a"),
      goal: "由两点求一次函数解析式，并研究图象与坐标轴的交点及点与图象的位置关系",
      goals: ["求这个一次函数的解析式", "求图象与 $x$ 轴交点的坐标", "判断点 $P$ 是否在图象上"],
      givens: [
        "一次函数的图象经过点 $A(" + x1 + "," + y1 + ")$",
        "图象经过点 $B(" + x2 + "," + y2 + ")$",
        "点 $P$ 的坐标为 $(" + x3 + "," + y3 + ")$"
      ],
      solution: [
        "设 $y=kx+b$，把两点坐标代入得方程组",
        "解得 $k=" + k + "$\uff0c$b=" + b + "$，解析式为 $" + exprOf(k, b) + "$",
        "令 $y=0$：$" + termOf(k, b) + "=0$，得 $x=" + xin + "$，交点为 $(" + xin + ",0)$",
        "把 $x=" + x3 + "$ 代入得 $y=" + (k * x3 + b) + "$，" + (inside ? "与点 $P$ 的纵坐标相同，点 $P$ 在图象上" : "与点 $P$ 的纵坐标不同，点 $P$ 不在图象上")
      ],
      steps: [
        { text: "用待定系数法求 $k$、$b$", basis: "一次函数解析式的确定" },
        { text: "令 $y=0$ 求与 $x$ 轴的交点", basis: "函数图象与坐标轴的交点" },
        { text: "把横坐标代入解析式，与纵坐标比较", basis: "点与函数图象的关系" }
      ],
      checks: [
        { expr: "k*x+b", at: { k: k, x: x1, b: b }, expect: y1 },
        { expr: "k*x+b", at: { k: k, x: x2, b: b }, expect: y2 },
        { expr: "k*x+b", at: { k: k, x: xin, b: b }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    const p = ri(r, 3, 12), c = ri(r, 2, 15) * 10;
    const n = ri(r, 5, 20);
    const y0 = ri(r, 10, 40) * 10;
    const money = p * n + c;
    const need = (y0 - c) / p;
    const n2b = Math.floor(need);
    const yy = p * n2b + c;
    return {
      params: { mode: 1, p: p, c: c, n: n, money: money, y0: y0, n2: n2b, y1: yy, left: y0 - c },
      stem: "某文具店中的笔记本每本 " + p + " 元，每次邮购还要付邮费 " + c + " 元。设一次邮购 $x$ 本笔记本共付 $y$ 元。\n（1）求 $y$ 与 $x$ 之间的函数关系式；\n（2）求一次邮购 " + n + " 本笔记本共付多少元；\n（3）若一次邮购共付了 " + y0 + " 元，求这次邮购笔记本的本数不超过多少本。",
      answer: n3(exprOf(p, c), money + " \u5143", n2b + " \u672c"),
      goal: "由实际情境列出一次函数关系式并解决实际问题",
      goals: ["求 $y$ 与 $x$ 之间的函数关系式", "求邮购 " + n + " 本所需的费用", "求付款 " + y0 + " 元时最多能邮购的本数"],
      givens: [
        "笔记本每本 " + p + " 元",
        "每次邮购要付邮费 " + c + " 元",
        "一次邮购 " + n + " 本笔记本",
        "一次邮购共付了 " + y0 + " 元"
      ],
      solution: [
        "总费用 $=$ 书的价钱 $+$ 邮费，所以 $" + exprOf(p, c) + "$",
        "当 $x=" + n + "$ 时，$y=" + p + "\\times " + n + "+" + c + "=" + money + "$（元）",
        "当 $" + p + "x+" + c + "\\le " + y0 + "$ 时，$x\\le \\dfrac{" + y0 + "-" + c + "}{" + p + "}=" + need + "$，最多邮购 " + n2b + " 本"
      ],
      steps: [
        { text: "按“总费用 = 单价 × 本数 + 邮费”列式", basis: "一次函数的实际应用" },
        { text: "代入求值", basis: "代入求值" },
        { text: "解一元一次不等式并取整数", basis: "一元一次不等式的实际应用" }
      ],
      checks: [
        { expr: "p*n+c", at: { p: p, n: n, c: c }, expect: money },
        { expr: "p*n+c", at: { p: p, n: n2b, c: c }, expect: yy },
        { expr: "(y0-c)/p", at: { y0: y0, c: c, p: p }, expect: need }
      ]
    };
  }

  if (mode === 2) {
    const k = ri(r, 2, 4) * (r() < 0.5 ? -1 : 1);
    const bx = ri(r, 2, 5);
    const b = k * bx;
    const xin = -bx;
    const h = b < 0 ? -b : b;
    const dx = xin < 0 ? -xin : xin;
    const area = dx * h / 2;
    return {
      params: { mode: 2, k: k, b: b, bx: bx, xin: xin, h: h, dx: dx, area: area },
      stem: "已知一次函数 $" + exprOf(k, b) + "$。\n（1）求它的图象与 $x$ 轴、$y$ 轴的交点坐标；\n（2）求它的图象与两坐标轴围成的三角形的面积。",
      answer: n2("(" + xin + ",0)\uff0c(0," + b + ")", "\u9762\u79ef " + area),
      goal: "求一次函数图象与坐标轴的交点及围成的三角形面积",
      goals: ["求图象与 $x$ 轴、$y$ 轴的交点坐标", "求图象与两坐标轴围成的三角形面积"],
      givens: ["一次函数 $" + exprOf(k, b) + "$"],
      solution: [
        "令 $y=0$：$" + termOf(k, b) + "=0$，得 $x=" + xin + "$，与 $x$ 轴交于 $(" + xin + ",0)$",
        "令 $x=0$，得 $y=" + b + "$，与 $y$ 轴交于 $(0," + b + ")$",
        "面积 $=\\dfrac{1}{2}\\times " + dx + "\\times " + h + "=" + area + "$"
      ],
      steps: [
        { text: "分别令 $y=0$、$x=0$ 求交点", basis: "函数图象与坐标轴的交点" },
        { text: "用两条直角边求面积", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "k*x+b", at: { k: k, x: xin, b: b }, expect: 0 },
        { expr: "k*0+b", at: { k: k, b: b }, expect: b },
        { expr: "dx*h/2", at: { dx: dx, h: h }, expect: area }
      ]
    };
  }

  const ka = ri(r, 1, 3), kb = -ri(r, 1, 3);
  const x0 = ri(r, -4, 4);
  const y0 = ri(r, -6, 6);
  const ba = y0 - ka * x0, bb = y0 - kb * x0;
  const dh = ba > bb ? ba - bb : bb - ba;
  const dx = x0 < 0 ? -x0 : x0;
  const area = dh * dx / 2;
  return {
    params: { mode: 3, ka: ka, ba: ba, kb: kb, bb: bb, x0: x0, y0: y0, dh: dh, dx: dx, area: area },
    stem: "已知两条直线 $l_{1}$：$" + exprOf(ka, ba) + "$ 与 $l_{2}$：$" + exprOf(kb, bb) + "$。\n（1）求这两条直线的交点坐标；\n（2）求这两条直线与 $y$ 轴围成的三角形的面积。",
    answer: n2("(" + x0 + "," + y0 + ")", "\u9762\u79ef " + area),
    goal: "求两条直线的交点，并求它们与 y 轴围成的三角形面积",
    goals: ["求两条直线的交点坐标", "求这两条直线与 $y$ 轴围成的三角形面积"],
    givens: [
      "直线 $l_{1}$：$" + exprOf(ka, ba) + "$",
      "直线 $l_{2}$：$" + exprOf(kb, bb) + "$"
    ],
    solution: [
      "联立两个解析式：$" + termOf(ka, ba) + "=" + termOf(kb, bb) + "$，解得 $x=" + x0 + "$",
      "代入得 $y=" + y0 + "$，交点坐标为 $(" + x0 + "," + y0 + ")$",
      "两直线与 $y$ 轴交于 $(0," + ba + ")$ 与 $(0," + bb + ")$，底为 $" + dh + "$，高为 $" + dx + "$，面积 $=\\dfrac{1}{2}\\times " + dh + "\\times " + dx + "=" + area + "$"
    ],
    steps: [
      { text: "联立方程组求交点", basis: "两条直线的交点与方程组的解" },
      { text: "以两个截距间的距离为底、交点横坐标的绝对值为高", basis: "三角形面积公式" }
    ],
    checks: [
      { expr: "ka*x+ba", at: { ka: ka, x: x0, ba: ba }, expect: y0 },
      { expr: "kb*x+bb", at: { kb: kb, x: x0, bb: bb }, expect: y0 },
      { expr: "dh*dx/2", at: { dh: dh, dx: dx }, expect: area }
    ]
  };
}
