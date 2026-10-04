export const kind = "dynamic/circum-angle-choice-p15";
export const covers = ["圆周角定理", "圆的基本性质", "勾股定理"];

function mixSeed(seed) {
  let x = Math.floor(seed);
  if (!(x > 0)) { x = 12345; }
  x = x % 2147483647;
  x = (Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
  x = ((x ^ (x >>> 13)) >>> 0);
  x = (Math.imul(x, 0xc2b2ae35) >>> 0);
  x = ((x ^ (x >>> 16)) >>> 0);
  return x === 0 ? 0x1234567 : x;
}

function rngFrom(seed) {
  let s = mixSeed(seed);
  return function () {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
}

function uniqNums(ans, cands) {
  const out = [];
  for (let i = 0; i < cands.length; i = i + 1) {
    const v = cands[i];
    if (!Number.isInteger(v)) { continue; }
    if (v === ans) { continue; }
    if (out.indexOf(v) >= 0) { continue; }
    out.push(v);
  }
  return out.slice(0, 3);
}

export function construct(slot, seed) {
  const rnd = rngFrom(seed);
  const MAJOR = [60, 80, 100, 140, 160];
  const MINOR = [60, 80, 100, 140];
  const TRIPLES = [[6, 8, 10], [12, 16, 20], [10, 24, 26], [16, 30, 34], [18, 24, 30], [24, 32, 40], [20, 48, 52]];
  const SAMEARC = [30, 40, 50, 70, 80];
  const DIAM = [20, 25, 30, 35, 40, 50, 55, 60, 65, 70];
  const mode = mixSeed(seed) % 5;

  if (mode === 0) {
    const central = MAJOR[Math.floor(rnd() * MAJOR.length) % MAJOR.length];
    const ans = central / 2;
    return {
      params: { mode: 0, central: central, ans: ans },
      stem: "点 $A$、$B$、$C$ 都在 $\\odot O$ 上，点 $C$ 在优弧 $AB$ 上。若圆心角 $\\angle AOB=" + central + "^{\\circ}$，则圆周角 $\\angle ACB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求圆周角 $\\angle ACB$ 的度数",
      goals: ["求圆周角 $\\angle ACB$ 的度数"],
      givens: ["$A$、$B$、$C$ 三点都在 $\\odot O$ 上", "点 $C$ 在优弧 $AB$ 上", "圆心角 $\\angle AOB=" + central + "^{\\circ}$"],
      solution: ["$\\angle ACB$ 与圆心角 $\\angle AOB$ 所对的是同一条弧 $AB$，由圆周角定理得 $\\angle ACB=\\frac{1}{2}\\angle AOB=" + central + "^{\\circ}\\div 2=" + ans + "^{\\circ}$。"],
      steps: [{ text: "同弧所对的圆周角等于圆心角的一半，故 $\\angle ACB=" + ans + "^{\\circ}$。", basis: "圆周角定理" }],
      checks: [{ expr: "2*ans - central", at: { ans: ans, central: central }, expect: 0 }],
      distractors: uniqNums(ans, [central, 2 * central, 180 - central, 180 - central / 2, central + 90]).map(function (v) { return v + "°"; })
    };
  }

  if (mode === 1) {
    const t = TRIPLES[Math.floor(rnd() * TRIPLES.length) % TRIPLES.length];
    const a = t[0];
    const b = t[1];
    const ans = t[2];
    return {
      params: { mode: 1, a: a, b: b, ans: ans },
      stem: "已知 $AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上，且 $AC=" + a + "$，$BC=" + b + "$，则 $AB$ 的长为（　　）",
      answer: String(ans),
      goal: "求直径 $AB$ 的长",
      goals: ["求直径 $AB$ 的长"],
      givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上", "$AC=" + a + "$", "$BC=" + b + "$"],
      solution: ["$AB$ 是直径，点 $C$ 在圆上，所以 $\\angle ACB=90^{\\circ}$。在 $\\mathrm{Rt}\\triangle ACB$ 中，$AB=\\sqrt{AC^{2}+BC^{2}}=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + ans + "$。"],
      steps: [{ text: "直径所对的圆周角是直角，得 $\\angle ACB=90^{\\circ}$。", basis: "直径所对的圆周角是直角" }, { text: "由勾股定理得 $AB=" + ans + "$。", basis: "勾股定理" }],
      checks: [{ expr: "ans*ans - a*a - b*b", at: { ans: ans, a: a, b: b }, expect: 0 }],
      distractors: uniqNums(ans, [a + b, ans / 2, a * b, a + b + 2]).map(function (v) { return String(v); })
    };
  }

  if (mode === 2) {
    const central = MINOR[Math.floor(rnd() * MINOR.length) % MINOR.length];
    const ans = 180 - central / 2;
    return {
      params: { mode: 2, central: central, ans: ans },
      stem: "点 $A$、$B$、$C$ 都在 $\\odot O$ 上，点 $C$ 在劣弧 $AB$ 上。若圆心角 $\\angle AOB=" + central + "^{\\circ}$，则圆周角 $\\angle ACB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求圆周角 $\\angle ACB$ 的度数",
      goals: ["求圆周角 $\\angle ACB$ 的度数"],
      givens: ["$A$、$B$、$C$ 三点都在 $\\odot O$ 上", "点 $C$ 在劣弧 $AB$ 上", "圆心角 $\\angle AOB=" + central + "^{\\circ}$"],
      solution: ["圆心角 $\\angle AOB=" + central + "^{\\circ}$ 对着劣弧 $AB$，而 $\\angle ACB$ 对着含有 $C$ 的优弧 $AB$，其度数为 $360^{\\circ}-" + central + "^{\\circ}$，所以 $\\angle ACB=\\frac{1}{2}(360^{\\circ}-" + central + "^{\\circ})=" + ans + "^{\\circ}$。"],
      steps: [{ text: "$\\angle ACB$ 所对弧的度数为 $360^{\\circ}-" + central + "^{\\circ}$，故 $\\angle ACB=" + ans + "^{\\circ}$。", basis: "圆周角定理" }],
      checks: [{ expr: "2*ans + central - 360", at: { ans: ans, central: central }, expect: 0 }],
      distractors: uniqNums(ans, [central / 2, central, 180 - central, 2 * central]).map(function (v) { return v + "°"; })
    };
  }

  if (mode === 3) {
    const n = SAMEARC[Math.floor(rnd() * SAMEARC.length) % SAMEARC.length];
    const ans = n;
    return {
      params: { mode: 3, n: n, ans: ans },
      stem: "点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上，且点 $C$、$D$ 在弦 $AB$ 的同侧。若 $\\angle ACB=" + n + "^{\\circ}$，则 $\\angle ADB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求圆周角 $\\angle ADB$ 的度数",
      goals: ["求圆周角 $\\angle ADB$ 的度数"],
      givens: ["$A$、$B$、$C$、$D$ 四点都在 $\\odot O$ 上", "点 $C$、$D$ 在弦 $AB$ 的同侧", "$\\angle ACB=" + n + "^{\\circ}$"],
      solution: ["$\\angle ACB$ 与 $\\angle ADB$ 对着同一条弧 $AB$，由圆周角定理的推论得 $\\angle ADB=\\angle ACB=" + ans + "^{\\circ}$。"],
      steps: [{ text: "同弧所对的圆周角相等，故 $\\angle ADB=" + ans + "^{\\circ}$。", basis: "圆周角定理的推论" }],
      checks: [{ expr: "ans - n", at: { ans: ans, n: n }, expect: 0 }],
      distractors: uniqNums(ans, [180 - n, n / 2, 2 * n, 90 - n / 2]).map(function (v) { return v + "°"; })
    };
  }

  const b = DIAM[Math.floor(rnd() * DIAM.length) % DIAM.length];
  const ans = 90 - b;
  return {
    params: { mode: 4, b: b, ans: ans },
    stem: "已知 $AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上，若 $\\angle ABC=" + b + "^{\\circ}$，则 $\\angle BAC$ 的度数为（　　）",
    answer: ans + "°",
    goal: "求 $\\angle BAC$ 的度数",
    goals: ["求 $\\angle BAC$ 的度数"],
    givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上", "$\\angle ABC=" + b + "^{\\circ}$"],
    solution: ["$AB$ 是直径，所以 $\\angle ACB=90^{\\circ}$。在 $\\triangle ABC$ 中，$\\angle BAC=180^{\\circ}-90^{\\circ}-" + b + "^{\\circ}=" + ans + "^{\\circ}$。"],
    steps: [{ text: "直径所对的圆周角是直角，得 $\\angle ACB=90^{\\circ}$。", basis: "直径所对的圆周角是直角" }, { text: "由三角形内角和得 $\\angle BAC=" + ans + "^{\\circ}$。", basis: "三角形的内角和" }],
    checks: [{ expr: "ans + b - 90", at: { ans: ans, b: b }, expect: 0 }],
    distractors: uniqNums(ans, [b, 180 - b, 90 + b, 2 * b]).map(function (v) { return v + "°"; })
  };
}
