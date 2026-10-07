export const kind = "dynamic/quadratic-extremum-three";
export const covers = ["最值", "顶点式", "对称轴"];

function makeRng(seed) {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s < 1) s = 17;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

function polyBody(a, b, c) {
  let s = a === 1 ? "x^{2}" : (a === -1 ? "-x^{2}" : String(a) + "x^{2}");
  if (b !== 0) {
    s += b > 0 ? "+" : "-";
    const ab = Math.abs(b);
    if (ab !== 1) s += String(ab);
    s += "x";
  }
  if (c !== 0) s += (c > 0 ? "+" : "-") + String(Math.abs(c));
  return s;
}

function polyExpr(a, b, c) {
  let s = "((" + a + ")*(x^2))";
  if (b !== 0) s += "+(" + b + "*x)";
  if (c !== 0) s += "+(" + c + ")";
  return s;
}

function vertexBody(a, h, k) {
  let s = a === 1 ? "" : (a === -1 ? "-" : String(a));
  if (h === 0) s += "x^{2}";
  else s += "(x" + (h > 0 ? "-" + String(h) : "+" + String(-h)) + ")^{2}";
  if (k !== 0) s += (k > 0 ? "+" : "-") + String(Math.abs(k));
  return s;
}

function vertexPlain(a, h, k) {
  let s = a === 1 ? "" : (a === -1 ? "-" : String(a));
  if (h === 0) s += "x²";
  else s += "(x" + (h > 0 ? "-" + String(h) : "+" + String(-h) + ")") + "²";
  if (k !== 0) s += (k > 0 ? "+" : "-") + String(Math.abs(k));
  return s;
}

function vertexExpr(a, h, k) {
  let s = "((" + a + ")*((x-(" + h + "))^2))";
  if (k !== 0) s += "+(" + k + ")";
  return s;
}

export function construct(slot, seed) {
  const rnd = makeRng(seed);
  const a = pick(rnd, [1, 2, -1, -2]);
  let h = Math.floor(rnd() * 7) - 3;
  let k = Math.floor(rnd() * 9) - 4;
  if (h === 0 && k === 0) k = 2;
  const b = -2 * a * h;
  const c = a * h * h + k;
  const mode = pick(rnd, ["closed", "right", "left"]);
  const inside = rnd() < 0.5;
  const d1 = 1 + Math.floor(rnd() * 3);
  const d2 = 1 + Math.floor(rnd() * 3);
  let p = null;
  let q = null;
  if (mode === "closed") {
    if (inside) {
      p = h - d1;
      q = h + d2;
    } else if (rnd() < 0.5) {
      q = h - d1;
      p = q - (d1 + d2);
    } else {
      p = h + d1;
      q = p + (d1 + d2);
    }
  } else if (mode === "right") {
    p = inside ? h - d1 : h + d1;
    q = p + d2;
  } else {
    q = inside ? h + d2 : h - d2;
    p = q - d1 - d2;
  }
  const f = function (x) { return a * x * x + b * x + c; };
  const cands = [];
  if (mode === "closed") {
    cands.push(p);
    cands.push(q);
    if (p <= h && h <= q) cands.push(h);
  } else if (mode === "right") {
    cands.push(p);
    if (h >= p) cands.push(h);
  } else {
    cands.push(q);
    if (h <= q) cands.push(h);
  }
  let loX = cands[0];
  let hiX = cands[0];
  for (let i = 0; i < cands.length; i++) {
    const x = cands[i];
    if (f(x) < f(loX)) loX = x;
    if (f(x) > f(hiX)) hiX = x;
  }

  const general = "y=" + polyBody(a, b, c);
  const vform = "y=" + vertexBody(a, h, k);
  const vplain = "y=" + vertexPlain(a, h, k);
  const up = a > 0;
  const extremeName = up ? "最小值" : "最大值";

  let part3;
  let intervalText;
  let goal3;
  let rangeText;
  let ans3;
  if (mode === "closed") {
    intervalText = "$" + p + "\\leq x\\leq " + q + "$";
    rangeText = p + " <= x <= " + q;
    part3 = "（3）当 $" + p + "\\leq x\\leq " + q + "$ 时，求 $y$ 的最大值与最小值，并指出取得最大值、最小值时 $x$ 的值。";
    ans3 = "(3) 在给定范围内，最小值 " + f(loX) + "（此时 x=" + loX + "），最大值 " + f(hiX) + "（此时 x=" + hiX + "）";
    goal3 = "在闭区间上求二次函数的最大值与最小值，并指出取得最值时的自变量取值";
  } else if (mode === "right") {
    intervalText = "$x\\geq " + p + "$";
    rangeText = "x >= " + p;
    part3 = "（3）当 $x\\geq " + p + "$ 时，求 $y$ 的" + extremeName + "，并指出取得" + extremeName + "时 $x$ 的值。";
    ans3 = "(3) 在给定范围内，" + extremeName + " " + (up ? f(loX) : f(hiX)) + "（此时 x=" + (up ? loX : hiX) + "）";
    goal3 = "在自变量的半无限范围内求二次函数的最值，并指出取得最值时的自变量取值";
  } else {
    intervalText = "$x\\leq " + q + "$";
    rangeText = "x <= " + q;
    part3 = "（3）当 $x\\leq " + q + "$ 时，求 $y$ 的" + extremeName + "，并指出取得" + extremeName + "时 $x$ 的值。";
    ans3 = "(3) 在给定范围内，" + extremeName + " " + (up ? f(loX) : f(hiX)) + "（此时 x=" + (up ? loX : hiX) + "）";
    goal3 = "在自变量的半无限范围内求二次函数的最值，并指出取得最值时的自变量取值";
  }

  const stem = "已知二次函数 $" + general + "$。\n（1）把这个二次函数配方成 $y=a(x-h)^{2}+k$ 的形式，写出配方后的结果；\n（2）写出这条抛物线的顶点坐标，并求出这个二次函数的" + (up ? "最小值" : "最大值") + "；\n" + part3;

  const answer = "(1) 配方后 " + vplain + "；(2) 顶点 (" + h + "," + k + ")，" + extremeName + " " + k + "；" + ans3;

  return {
    params: {
      a: a, b: b, c: c, h: h, k: k, p: p, q: q,
      minValue: f(loX), maxValue: f(hiX), minX: loX, maxX: hiX
    },
    stem: stem,
    answer: answer,
    goal: "把二次函数配方成顶点式；写出顶点坐标并求最值；在给定自变量范围内求最值",
    goals: [
      "把二次函数配方成 $y=a(x-h)^{2}+k$ 的形式",
      "写出抛物线的顶点坐标，并求出二次函数的最大值或最小值",
      goal3
    ],
    givens: [
      "二次函数的解析式为 $" + general + "$",
      "自变量 $x$ 的取值范围为 " + intervalText
    ],
    solution: [
      "（1）配方：$" + general + "=" + vertexBody(a, h, k) + "$，顶点式为 $" + vform + "$。",
      "（2）由顶点式得顶点坐标 $(" + h + "," + k + ")$；因为 $a=" + a + (up ? ">0" : "<0") + "$，图象开口向" + (up ? "上" : "下") + "，所以当 $x=" + h + "$ 时函数取" + extremeName + " $" + k + "$。",
      "（3）在给定范围内比较端点与顶点的函数值：$f(" + p + ")=" + f(p) + "$，$f(" + q + ")=" + f(q) + "$" + (cands.length === 3 ? "，$f(" + h + ")=" + k + "$" : "") + "，由此得到最值。"
    ],
    steps: [
      { text: "把 $" + general + "$ 配方为 $" + vform + "$", basis: "配方法" },
      { text: "由顶点式写出顶点坐标 $(" + h + "," + k + ")$ 与最值 $" + k + "$", basis: "二次函数顶点式的意义" },
      { text: "在 " + rangeText + " 上比较端点值与顶点值，得最值", basis: "二次函数在给定区间上的单调性与最值" }
    ],
    checks: [
      { expr: polyExpr(a, b, c), at: { x: h }, expect: k },
      { expr: polyExpr(a, b, c), at: { x: h + 1 }, expect: f(h + 1) },
      { expr: polyExpr(a, b, c), at: { x: p }, expect: f(p) },
      { expr: polyExpr(a, b, c), at: { x: q }, expect: f(q) },
      { expr: vertexExpr(a, h, k), at: { x: h }, expect: k }
    ]
  };
}
