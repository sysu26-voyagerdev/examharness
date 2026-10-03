export const kind = "dynamic/circle-angle-choice-sc";
export const covers = ["圆周角定理", "圆的性质", "圆内接四边形"];

const DEG = "°";
const LETTERS = ["A", "B", "C", "D"];

function frac(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function mkDistractors(ans, raw, salt) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const v = Math.round(raw[i]);
    if (v === ans) continue;
    if (v <= 0 || v > 180) continue;
    if (out.indexOf(v) >= 0) continue;
    out.push(v);
  }
  let step = 11 + salt;
  let guard = 0;
  while (out.length < 3 && guard < 40) {
    const up = ans + step * (out.length + 1);
    const v = up <= 175 ? up : ans - step * (out.length + 1);
    if (v > 0 && v <= 180 && v !== ans && out.indexOf(v) < 0) out.push(v);
    step = step + 7;
    guard = guard + 1;
  }
  return out.slice(0, 3);
}

export function construct(slot, seed) {
  const S = Math.abs(Math.floor(Number(seed) || 0)) + 1;
  const r = (i) => frac(S * 1.7 + i * 13.31);
  const variant = Math.floor(r(1) * 4) % 4;

  let params = {};
  let stemBase = "";
  let ansVal = 0;
  let raw = [];
  let goal = "";
  let givens = [];
  let solution = [];
  let steps = [];
  let checks = [];

  if (variant === 0) {
    const k = 40 + Math.floor(r(2) * 31);
    const n = 2 * k;
    ansVal = k;
    raw = [n, 180 - n, n + 10, 90];
    params = { n: n, ans: k };
    stemBase = "在 $\\odot O$ 中，点 $A$、$B$、$C$ 都在圆上，且点 $C$ 在优弧 $AB$ 上。已知圆心角 $\\angle AOB=" + n + "^{\\circ}$，则圆周角 $\\angle ACB$ 等于";
    goal = "求圆周角 $\\angle ACB$ 的度数";
    givens = ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "点 $C$ 在优弧 $AB$ 上", "圆心角 $\\angle AOB=" + n + "^{\\circ}$"];
    solution = ["同一条弧所对的圆心角等于它所对圆周角的 2 倍，故 $\\angle AOB=2\\angle ACB$", "所以 $\\angle ACB=" + n + "^{\\circ}\\div 2=" + k + "^{\\circ}$"];
    steps = [
      { text: "同弧 $AB$ 所对的圆心角是圆周角的 2 倍", basis: "圆周角定理" },
      { text: "$\\angle ACB=" + n + "^{\\circ}\\div 2=" + k + "^{\\circ}$", basis: "等式性质" }
    ];
    checks = [{ expr: "n-2*ans", at: { n: n, ans: k }, expect: 0 }];
  } else if (variant === 1) {
    const m = 25 + Math.floor(r(2) * 61);
    ansVal = m;
    raw = [180 - m, 2 * m, m + 15, 30];
    params = { m: m, ans: m };
    stemBase = "在 $\\odot O$ 中，点 $A$、$B$、$C$、$D$ 都在圆上，且点 $C$、$D$ 在弦 $AB$ 的同侧。若 $\\angle ACB=" + m + "^{\\circ}$，则 $\\angle ADB$ 等于";
    goal = "求 $\\angle ADB$ 的度数";
    givens = ["点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上", "点 $C$、$D$ 在弦 $AB$ 的同侧", "$\\angle ACB=" + m + "^{\\circ}$"];
    solution = ["$\\angle ACB$ 与 $\\angle ADB$ 所对的弧都是弧 $AB$，同弧所对的圆周角相等", "所以 $\\angle ADB=\\angle ACB=" + m + "^{\\circ}$"];
    steps = [
      { text: "$\\angle ACB$ 与 $\\angle ADB$ 都对弧 $AB$", basis: "圆周角的定义" },
      { text: "同弧所对的圆周角相等，$\\angle ADB=" + m + "^{\\circ}$", basis: "圆周角定理" }
    ];
    checks = [{ expr: "m-ans", at: { m: m, ans: m }, expect: 0 }];
  } else if (variant === 2) {
    const a = 30 + Math.floor(r(2) * 41);
    ansVal = 90 - a;
    raw = [a, 180 - a, 2 * a, 45];
    params = { a: a, ans: 90 - a };
    stemBase = "$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上（不与 $A$、$B$ 重合）。若 $\\angle ABC=" + a + "^{\\circ}$，则 $\\angle BAC$ 等于";
    goal = "求 $\\angle BAC$ 的度数";
    givens = ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上且不与 $A$、$B$ 重合", "$\\angle ABC=" + a + "^{\\circ}$"];
    solution = ["$AB$ 是直径，所以直径 $AB$ 所对的圆周角 $\\angle ACB=90^{\\circ}$", "$\\angle BAC=180^{\\circ}-90^{\\circ}-" + a + "^{\\circ}=" + (90 - a) + "^{\\circ}$"];
    steps = [
      { text: "直径所对的圆周角是直角，$\\angle ACB=90^{\\circ}$", basis: "圆周角定理的推论" },
      { text: "在 $\\triangle ABC$ 中，$\\angle BAC=90^{\\circ}-" + a + "^{\\circ}=" + (90 - a) + "^{\\circ}$", basis: "三角形内角和" }
    ];
    checks = [{ expr: "a+ans-90", at: { a: a, ans: 90 - a }, expect: 0 }];
  } else {
    const b = 35 + Math.floor(r(2) * 21);
    const a = 2 * b;
    ansVal = 180 - a;
    raw = [a, b, 180 - b, 90];
    params = { a: a, ans: 180 - a };
    stemBase = "四边形 $ABCD$ 内接于 $\\odot O$，若 $\\angle A=" + a + "^{\\circ}$，则 $\\angle C$ 等于";
    goal = "求 $\\angle C$ 的度数";
    givens = ["四边形 $ABCD$ 内接于 $\\odot O$", "$\\angle A=" + a + "^{\\circ}$", "$\\angle A$ 与 $\\angle C$ 是内接四边形的一对对角"];
    solution = ["圆内接四边形的对角互补，$\\angle A+\\angle C=180^{\\circ}$", "所以 $\\angle C=180^{\\circ}-" + a + "^{\\circ}=" + (180 - a) + "^{\\circ}$"];
    steps = [
      { text: "$\\angle A$ 与 $\\angle C$ 所对的弧合起来是整个圆，故 $\\angle A+\\angle C=180^{\\circ}$", basis: "圆内接四边形的性质" },
      { text: "$\\angle C=180^{\\circ}-" + a + "^{\\circ}=" + (180 - a) + "^{\\circ}$", basis: "等式性质" }
    ];
    checks = [{ expr: "a+ans-180", at: { a: a, ans: 180 - a }, expect: 0 }];
  }

  const ds = mkDistractors(ansVal, raw, variant);
  const all = [ansVal].concat(ds);
  const k = Math.floor(r(9) * 4) % 4;
  const ordered = all.slice(k).concat(all.slice(0, k));
  const options = ordered.map((v, i) => ({ key: LETTERS[i], text: "" + v + DEG }));
  const stem = stemBase + "（　　）";
  const answer = ansVal + DEG;

  params.d1 = ds[0];
  params.d2 = ds[1];
  params.d3 = ds[2];

  return {
    params: params,
    stem: stem,
    options: options,
    answer: answer,
    goal: goal,
    goals: [goal],
    givens: givens,
    solution: solution,
    steps: steps,
    checks: checks
  };
}
