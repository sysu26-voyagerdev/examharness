export const kind = "dynamic/circle-property-mcq";
export const covers = ["圆的基本性质", "圆周角定理", "垂径定理"];

function makeRng(seed) {
  let s = Math.abs(Math.floor(seed)) % 2147483647;
  if (s < 1) s = 23;
  return function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length) % arr.length];
}

function deg(x) {
  return x + "°";
}

export function construct(slot, seed) {
  const rnd = makeRng(seed);
  const form = pick(rnd, ["diameter-right-angle", "central-inscribed", "cyclic-quad", "chord-distance"]);

  if (form === "diameter-right-angle") {
    const g = pick(rnd, [25, 30, 35, 40, 50, 55, 60, 65]);
    const ans = 90 - g;
    return {
      params: { givenAngle: g, answerAngle: ans },
      stem: "$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上（不与点 $A$、$B$ 重合）。若 $\\angle BAC=" + g + "^{\\circ}$，则 $\\angle ABC$ 的度数为（　　）",
      answer: deg(ans),
      distractors: [deg(g), deg(90 + g), deg(180 - g)],
      goal: "求 $\\angle ABC$ 的度数",
      givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上，且不与点 $A$、$B$ 重合", "$\\angle BAC=" + g + "^{\\circ}$"],
      solution: [
        "因为 $AB$ 是直径，所以 $AB$ 所对的圆周角 $\\angle ACB=90^{\\circ}$。",
        "在 $\\triangle ABC$ 中，$\\angle ABC=180^{\\circ}-90^{\\circ}-" + g + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "由直径所对的圆周角是直角得 $\\angle ACB=90^{\\circ}$", basis: "圆周角定理的推论" },
        { text: "在 $\\triangle ABC$ 中用内角和求 $\\angle ABC=" + ans + "^{\\circ}$", basis: "三角形内角和" }
      ],
      checks: [{ expr: "a+b", at: { a: g, b: ans }, expect: 90 }]
    };
  }

  if (form === "central-inscribed") {
    const a = pick(rnd, [20, 25, 30, 35, 40, 50, 55]);
    const ans = 2 * a;
    return {
      params: { inscribedAngle: a, centralAngle: ans },
      stem: "点 $A$、$B$、$C$ 都在 $\\odot O$ 上，且点 $C$ 在弦 $AB$ 所对的优弧上。若 $\\angle ACB=" + a + "^{\\circ}$，则弦 $AB$ 所对的圆心角 $\\angle AOB$ 的度数为（　　）",
      answer: deg(ans),
      distractors: [deg(a), deg(180 - a), deg(180 - ans)],
      goal: "求圆心角 $\\angle AOB$ 的度数",
      givens: ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "点 $C$ 在弦 $AB$ 所对的优弧上", "$\\angle ACB=" + a + "^{\\circ}$"],
      solution: [
        "同一条弧所对的圆心角是它所对圆周角的 $2$ 倍。",
        "所以 $\\angle AOB=2\\angle ACB=2\\times " + a + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "由圆周角定理得 $\\angle AOB=2\\angle ACB$", basis: "圆周角定理" },
        { text: "代入计算得 $\\angle AOB=" + ans + "^{\\circ}$", basis: "有理数运算" }
      ],
      checks: [{ expr: "b-2*a", at: { a: a, b: ans }, expect: 0 }]
    };
  }

  if (form === "cyclic-quad") {
    const g = pick(rnd, [65, 70, 75, 80, 85]);
    const ans = 180 - g;
    return {
      params: { givenAngle: g, answerAngle: ans },
      stem: "四边形 $ABCD$ 的四个顶点都在 $\\odot O$ 上，若 $\\angle A=" + g + "^{\\circ}$，则 $\\angle C$ 的度数为（　　）",
      answer: deg(ans),
      distractors: [deg(g), deg(180 - 2 * g), deg(90 - g + g)],
      goal: "求 $\\angle C$ 的度数",
      givens: ["四边形 $ABCD$ 内接于 $\\odot O$", "$\\angle A=" + g + "^{\\circ}$"],
      solution: [
        "圆内接四边形的对角互补，所以 $\\angle A+\\angle C=180^{\\circ}$。",
        "因此 $\\angle C=180^{\\circ}-" + g + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "由圆内接四边形对角互补得 $\\angle C=180^{\\circ}-\\angle A$", basis: "圆内接四边形的性质" },
        { text: "计算得 $\\angle C=" + ans + "^{\\circ}$", basis: "有理数运算" }
      ],
      checks: [{ expr: "a+b", at: { a: g, b: ans }, expect: 180 }]
    };
  }

  const triples = [[13, 5, 12], [5, 3, 4], [10, 6, 8], [25, 7, 24]];
  const t = pick(rnd, triples);
  const r = t[0];
  const d = t[1];
  const half = t[2];
  const ans = 2 * half;
  return {
    params: { radius: r, distance: d, halfChord: half, chord: ans },
    stem: "$\\odot O$ 的半径为 " + r + "，圆心 $O$ 到弦 $AB$ 的距离为 " + d + "，则弦 $AB$ 的长为（　　）",
    answer: String(ans),
    distractors: [String(half), String(r - d), String(2 * d)],
    goal: "求弦 $AB$ 的长",
    givens: ["$\\odot O$ 的半径为 " + r, "圆心 $O$ 到弦 $AB$ 的距离为 " + d],
    solution: [
      "过点 $O$ 作 $OC\\perp AB$ 于 $C$，则 $OC=" + d + "$，$OA=" + r + "$，且 $C$ 是 $AB$ 的中点。",
      "在 $\\mathrm{Rt}\\triangle AOC$ 中，$AC^2=OA^2-OC^2=" + r + "^2-" + d + "^2=" + half * half + "$，所以 $AC=" + half + "$，$AB=2AC=" + ans + "$。"
    ],
    steps: [
      { text: "作弦心距 $OC$，由垂径定理得 $AC=\\frac{1}{2}AB$", basis: "垂径定理" },
      { text: "在直角三角形中用勾股定理求 $AC=" + half + "$，得 $AB=" + ans + "$", basis: "勾股定理" }
    ],
    checks: [{ expr: "d^2+h^2-r^2", at: { d: d, h: half, r: r }, expect: 0 }]
  };
}
