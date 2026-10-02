export const kind = "dynamic/quadratic-comprehensive";
export const covers = ["二次函数综合"];

function makeRng(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647;
  if (s <= 0) s += 2147483646;
  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function fmtRoot(r) {
  if (r === 0) return "x";
  if (r < 0) return "(x+" + (-r) + ")";
  return "(x-" + r + ")";
}

function fmtRootTex(r) {
  if (r === 0) return "x";
  if (r < 0) return "\\left(x+" + (-r) + "\\right)";
  return "\\left(x-" + r + "\\right)";
}

function termTex(coef, sym) {
  if (coef === 0) return "";
  const sign = coef > 0 ? "+" : "-";
  const v = Math.abs(coef);
  const num = v === 1 && sym ? "" : String(v);
  return sign + num + (sym || "");
}

export function construct(slot, seed) {
  const rng = makeRng(seed);
  const a = -1 - Math.floor(rng() * 3);   // -1, -2, -3
  const x1 = -3 + Math.floor(rng() * 3);  // -3, -2, -1
  const d = 2 + Math.floor(rng() * 2);    // 2, 3
  const x2 = x1 + 2 * d;
  const b = -a * (x1 + x2);
  const c0 = a * x1 * x2;
  const h = (x1 + x2) / 2;
  const k = -a * d * d;
  const S = 0.5 * (x2 - x1) * k;

  const aStr = a === -1 ? "-" : String(a);
  const polyTex = "y=" + aStr + "x^{2}" + termTex(b, "x") + termTex(c0, "");
  const polyPlain = "y=" + aStr + "x²" + termTex(b, "x") + termTex(c0, "");

  const stem = "已知抛物线 y=ax²+bx+c 与 x 轴交于点 A(" + x1 + ", 0)、B(" + x2 + ", 0)，" +
    "与 y 轴交于点 C(0, " + c0 + ")，其中点 A 在点 B 的左侧。\n" +
    "（1）求该抛物线的解析式；\n（2）求该抛物线的顶点 P 的坐标；\n（3）求 △PAB 的面积。";

  const solution = [
    "由 A(" + x1 + ", 0)、B(" + x2 + ", 0) 是抛物线与 x 轴的交点，可设解析式为 y=a(x-" + x1 + ")(x-" + x2 + ")（a≠0）。",
    "把点 C(0, " + c0 + ") 的坐标代入，得 a=" + c0 + "/[" + x1 + "×" + x2 + "]=" + a + "，故解析式为 " + polyPlain + "。",
    "顶点横坐标取 A、B 横坐标的中点，x_P=(" + x1 + "+" + x2 + ")/2=" + h + "，代入解析式得 y_P=" + k + "，即 P(" + h + ", " + k + ")。",
    "以 AB 为底，|AB|=" + (x2 - x1) + "，顶点纵坐标就是 AB 边上的高 " + k + "，所以 △PAB 的面积 S=1/2×" + (x2 - x1) + "×" + k + "=" + S + "。"
  ];

  const solutionTex = [
    "y=a" + fmtRootTex(x1) + fmtRootTex(x2),
    "a=\\dfrac{" + c0 + "}{(" + x1 + ")\\times " + x2 + "}=" + a + ",\\quad " + polyTex,
    "x_{P}=\\dfrac{" + x1 + "+(" + x2 + ")}{2}=" + h + ",\\quad y_{P}=" + k,
    "S_{\\triangle PAB}=\\dfrac{1}{2}\\times " + (x2 - x1) + "\\times " + k + "=" + S
  ];

  return {
    params: { a: a, b: b, c0: c0, x1: x1, x2: x2, d: d, h: h, k: k, S: S },
    stem: stem,
    answer: "（1）" + polyPlain + "；（2）P(" + h + ", " + k + ")；（3）S=" + S,
    stemTex: polyTex,
    answerTex: polyTex + ",\\ P(" + h + "," + k + "),\\ S=" + S,
    goal: "求抛物线的解析式 求抛物线的顶点 P 的坐标 求三角形 PAB 的面积",
    givens: [
      "抛物线经过点 A(" + x1 + ", 0)",
      "抛物线经过点 B(" + x2 + ", 0)",
      "抛物线与 y 轴交于点 C(0, " + c0 + ")",
      "点 A 在点 B 的左侧"
    ],
    solution: solution,
    solutionTex: solutionTex,
    steps: [
      { text: "由与 x 轴的两个交点设交点式 y=a(x-x1)(x-x2)", basis: "二次函数交点式" },
      { text: "代入 y 轴交点坐标求 a，得到解析式", basis: "待定系数法" },
      { text: "顶点横坐标取两交点横坐标的中点，代入求纵坐标", basis: "抛物线对称性" },
      { text: "用底乘高的一半求三角形面积", basis: "三角形面积公式" }
    ],
    checks: [
      { expr: "a*x1*x1+b*x1+c0", at: { a: a, b: b, c0: c0, x1: x1 }, expect: 0 },
      { expr: "a*x2*x2+b*x2+c0", at: { a: a, b: b, c0: c0, x2: x2 }, expect: 0 },
      { expr: "a*h*h+b*h+c0", at: { a: a, b: b, c0: c0, h: h }, expect: k },
      { expr: "0.5*(x2-x1)*k", at: { x1: x1, x2: x2, k: k }, expect: S },
      { expr: "c0-a*x1*x2", at: { a: a, c0: c0, x1: x1, x2: x2 }, expect: 0 }
    ]
  };
}
