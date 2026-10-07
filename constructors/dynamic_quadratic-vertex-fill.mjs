export const kind = "dynamic/quadratic-vertex-fill";
export const covers = ["顶点式", "最值", "对称轴"];
export const type = "填空";

function aStr(a) {
  if (a === 1) return "";
  if (a === -1) return "-";
  return String(a);
}
function lin(b) {
  if (b === 0) return "";
  var m = Math.abs(b);
  return (b > 0 ? "+" : "-") + (m === 1 ? "x" : m + "x");
}
function con(c) {
  if (c === 0) return "";
  return (c > 0 ? "+" : "-") + Math.abs(c);
}
function quad(a, b, c) {
  return aStr(a) + "x^{2}" + lin(b) + con(c);
}
function vertQuad(a, h, k) {
  var inner = h > 0 ? "-" + h : "+" + Math.abs(h);
  return aStr(a) + "(x" + inner + ")^{2}" + con(k);
}

export function construct(slot, seed) {
  var s = Math.abs(Math.floor(seed)) + 1;
  var r = s % 4;
  var blank = "（  ）";
  var stem = "";
  var answer = "";
  var params = {};
  var givens = [];
  var solution = [];
  var checks = [];
  var goal = "";

  if (r === 0) {
    var a0 = 1 + (s % 2);
    var h0 = (Math.floor(s / 2) % 7) - 3;
    if (h0 === 0) h0 = 2;
    var b0 = -2 * a0 * h0;
    var c0 = (Math.floor(s / 3) % 11) - 5;
    var k0 = c0 - a0 * h0 * h0;
    stem = "抛物线 $y=" + quad(a0, b0, c0) + "$ 的顶点坐标是 " + blank + "。";
    answer = "(" + h0 + "," + k0 + ")";
    params = { a: a0, b: b0, c: c0, h: h0, k: k0 };
    givens = ["抛物线的解析式为 y=" + quad(a0, b0, c0)];
    solution = ["配方得 $y=" + aStr(a0) + "(x" + (h0 > 0 ? "-" + h0 : "+" + Math.abs(h0)) + ")^{2}" + con(k0) + "$，顶点为 $(" + h0 + "," + k0 + ")$"];
    checks = [{ expr: "2*a*x+b", at: { a: a0, x: h0, b: b0 }, expect: 0 }];
    goal = "求这条抛物线的顶点坐标";
  } else if (r === 1) {
    var a1 = [1, 2, -1, -2][s % 4];
    var h1 = (Math.floor(s / 2) % 7) - 3;
    if (h1 === 0) h1 = -1;
    var b1 = -2 * a1 * h1;
    var c1 = (Math.floor(s / 3) % 11) - 5;
    var k1 = c1 - a1 * h1 * h1;
    var word = a1 > 0 ? "最小" : "最大";
    stem = "二次函数 $y=" + quad(a1, b1, c1) + "$ 的" + word + "值是 " + blank + "。";
    answer = String(k1);
    params = { a: a1, b: b1, c: c1, h: h1, k: k1 };
    givens = ["二次函数的解析式为 y=" + quad(a1, b1, c1)];
    solution = ["配方得 $y=" + aStr(a1) + "(x" + (h1 > 0 ? "-" + h1 : "+" + Math.abs(h1)) + ")^{2}" + con(k1) + "$，故当 $x=" + h1 + "$ 时取得" + word + "值 $" + k1 + "$"];
    checks = [{ expr: "2*a*x+b", at: { a: a1, x: h1, b: b1 }, expect: 0 }];
    goal = "求该函数的" + word + "值";
  } else if (r === 2) {
    var a2 = [1, 2, -1][((s % 3) + 3) % 3];
    var h2 = (Math.floor(s / 2) % 7) - 3;
    if (h2 === 0) h2 = 3;
    var k2 = (Math.floor(s / 4) % 9) - 4;
    stem = "二次函数 $y=" + vertQuad(a2, h2, k2) + "$ 的顶点坐标是 " + blank + "。";
    answer = "(" + h2 + "," + k2 + ")";
    params = { a: a2, h: h2, k: k2 };
    givens = ["二次函数的顶点式为 y=" + vertQuad(a2, h2, k2)];
    solution = ["顶点式 $y=a(x-h)^{2}+k$ 的顶点为 $(" + h2 + "," + k2 + ")$"];
    checks = [{ expr: "-B/(2*A)", at: { A: a2, B: -2 * a2 * h2 }, expect: h2 }];
    goal = "求该函数的顶点坐标";
  } else {
    var a3 = 1 + (s % 2);
    var h3 = (Math.floor(s / 2) % 7) - 3;
    if (h3 === 0) h3 = -3;
    var c3 = (Math.floor(s / 3) % 11) - 5;
    var b3 = -2 * a3 * h3;
    stem = "已知二次函数 $y=" + aStr(a3) + "x^{2}+bx" + con(c3) + "$ 的图象与 $y$ 轴交于点 $(0," + c3 + ")$，且它的对称轴是直线 $x=" + h3 + "$，则 $b=$ " + blank + "。";
    answer = String(b3);
    params = { a: a3, b: b3, c: c3, h: h3 };
    givens = ["二次函数为 y=" + aStr(a3) + "x^{2}+bx" + con(c3), "图象与 y 轴交于点 (0," + c3 + ")", "对称轴为直线 x=" + h3];
    solution = ["由对称轴 $x=-\\frac{b}{2a}=" + h3 + "$ 得 $b=-2a\\cdot(" + h3 + ")=" + b3 + "$"];
    checks = [{ expr: "2*a*x+b", at: { a: a3, x: h3, b: b3 }, expect: 0 }];
    goal = "求 b 的值";
  }

  return {
    params: params,
    stem: stem,
    answer: answer,
    goal: goal,
    goals: [goal],
    givens: givens,
    solution: solution,
    steps: solution.map(function (t) { return { text: t, basis: "二次函数的图象与性质" }; }),
    checks: checks
  };
}
