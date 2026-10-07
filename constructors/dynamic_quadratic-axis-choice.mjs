export const kind = "dynamic/quadratic-axis-choice";
export const covers = ["对称轴"];

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
function distinct(vals, ans, n) {
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v === ans) continue;
    if (out.indexOf(v) >= 0) continue;
    out.push(v);
    if (out.length === n) break;
  }
  return out;
}

export function construct(slot, seed) {
  var s = Math.abs(Math.floor(seed)) + 1;
  var r = s % 4;
  var stem = "";
  var ans = 0;
  var bad = [];
  var params = {};
  var givens = [];
  var solution = [];
  var checks = [];
  var goals = ["求这条抛物线的对称轴"];

  if (r === 0) {
    var a0 = 1 + (s % 2);
    var h0 = (Math.floor(s / 2) % 7) - 3;
    if (h0 === 0) h0 = 2;
    var b0 = -2 * a0 * h0;
    var c0 = (Math.floor(s / 3) % 11) - 5;
    stem = "抛物线 $y=" + quad(a0, b0, c0) + "$ 的对称轴是（　）";
    ans = h0;
    bad = distinct([-h0, c0, b0, h0 + 1], h0, 3);
    params = { a: a0, b: b0, c: c0, h: h0 };
    givens = ["抛物线的解析式为 y=" + quad(a0, b0, c0)];
    solution = ["由 $y=ax^{2}+bx+c$ 得对称轴 $x=-\\frac{b}{2a}=" + h0 + "$"];
    checks = [{ expr: "2*a*x+b", at: { a: a0, x: h0, b: b0 }, expect: 0 }];
  } else if (r === 1) {
    var a1 = 1 + (s % 2);
    var h1 = (Math.floor(s / 2) % 7) - 3;
    if (h1 === 0) h1 = -2;
    var k1 = (Math.floor(s / 4) % 9) - 4;
    stem = "抛物线 $y=" + vertQuad(a1, h1, k1) + "$ 的对称轴是（　）";
    ans = h1;
    bad = distinct([-h1, k1, h1 + 2, 1 - h1], h1, 3);
    params = { a: a1, h: h1, k: k1 };
    givens = ["抛物线解析式为顶点式 y=" + vertQuad(a1, h1, k1)];
    solution = ["顶点式 $y=a(x-h)^{2}+k$ 中对称轴为 $x=" + h1 + "$"];
    checks = [{ expr: "-B/(2*A)", at: { A: a1, B: -2 * a1 * h1 }, expect: h1 }];
  } else if (r === 2) {
    var p2 = (Math.floor(s / 2) % 9) - 4;
    if (p2 === 0) p2 = 3;
    var d2 = 1 + (s % 3);
    var m2 = p2 - d2;
    var n2 = p2 + d2;
    stem = "已知抛物线 $y=x^{2}" + lin(-2 * p2) + con(p2 * p2 - d2 * d2) + "$ 与 $x$ 轴交于点 $A(" + m2 + ",0)$、$B(" + n2 + ",0)$，则它的对称轴是（　）";
    ans = p2;
    bad = distinct([m2 + n2, n2, -p2], p2, 3);
    params = { p: p2, d: d2, m: m2, n: n2 };
    givens = ["抛物线与 x 轴交于点 A(" + m2 + ",0)、B(" + n2 + ",0)"];
    solution = ["对称轴为 $x=\\frac{" + m2 + "+" + n2 + "}{2}=" + p2 + "$"];
    checks = [{ expr: "2*x+b", at: { x: p2, b: -2 * p2 }, expect: 0 }];
  } else {
    var p3 = (Math.floor(s / 2) % 9) - 4;
    if (p3 === 0) p3 = 1;
    var d3 = 1 + (s % 4);
    var y3 = (Math.floor(s / 5) % 7) - 3;
    var c3 = p3 * p3 + y3 - d3 * d3;
    var m3 = p3 - d3;
    var n3 = p3 + d3;
    stem = "已知点 $P(" + m3 + "," + y3 + ")$、$Q(" + n3 + "," + y3 + ")$ 都在抛物线 $y=x^{2}" + lin(-2 * p3) + con(c3) + "$ 上，则这条抛物线的对称轴是（　）";
    ans = p3;
    bad = distinct([m3 + n3, y3, -p3, n3], p3, 3);
    params = { p: p3, d: d3, y: y3, c: c3, m: m3, n: n3 };
    givens = ["P(" + m3 + "," + y3 + ") 与 Q(" + n3 + "," + y3 + ") 在抛物线上且纵坐标相同"];
    solution = ["纵坐标相同的两点关于对称轴对称，故对称轴 $x=\\frac{" + m3 + "+" + n3 + "}{2}=" + p3 + "$"];
    checks = [{ expr: "2*x+b", at: { x: p3, b: -2 * p3 }, expect: 0 }];
  }

  return {
    params: params,
    stem: stem,
    answer: "x=" + ans,
    distractors: bad.map(function (v) { return "x=" + v; }),
    goal: "求这条抛物线的对称轴",
    goals: goals,
    givens: givens,
    solution: solution,
    steps: solution.map(function (t) { return { text: t, basis: "二次函数的图象与性质" }; }),
    checks: checks
  };
}
