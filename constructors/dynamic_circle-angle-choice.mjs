export const kind = "dynamic/circle-angle-choice";
export const covers = ["圆周角定理", "圆的性质"];

function hash(n) {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function construct(slot, seed) {
  const h = hash(seed);
  const mode = h % 5;
  const pickAt = (arr, k) => arr[((h >>> (k * 5)) >>> 0) % arr.length];

  if (mode === 0) {
    const a = pickAt([20, 25, 35, 40, 50, 55, 65, 70], 1);
    return {
      params: { mode: 0, alpha: a },
      stem: "如图，点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上，且点 $A$、$D$ 在弦 $BC$ 的同侧。若 $\\angle BAC=" + a + "^\\circ$，则 $\\angle BDC$ 的度数是（  ）",
      answer: String(a) + "°",
      distractors: [String(2 * a) + "°", String(180 - a) + "°", String(90 - a) + "°"],
      goal: "求圆周角 ∠BDC 的度数",
      goals: ["求 $\\angle BDC$ 的度数"],
      givens: ["点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上", "点 $A$、$D$ 在弦 $BC$ 的同侧", "$\\angle BAC=" + a + "^\\circ$"],
      solution: ["同弧 $BC$ 所对的圆周角相等，$\\angle BDC=\\angle BAC=" + a + "^\\circ$。"],
      steps: [{ text: "$\\angle BDC=\\angle BAC=" + a + "^\\circ$", basis: "同弧所对的圆周角相等" }],
      checks: [{ expr: "ans - alpha", at: { ans: a, alpha: a }, expect: 0 }]
    };
  }

  if (mode === 1) {
    const a = pickAt([20, 25, 35, 40, 50, 55, 65, 70], 1);
    return {
      params: { mode: 1, alpha: a },
      stem: "如图，点 $A$、$B$、$C$ 都在 $\\odot O$ 上，$O$ 为圆心。若 $\\angle BAC=" + a + "^\\circ$，则圆心角 $\\angle BOC$ 的度数是（  ）",
      answer: String(2 * a) + "°",
      distractors: [String(a) + "°", String(180 - a) + "°", String(90 + a) + "°"],
      goal: "求圆心角 ∠BOC 的度数",
      goals: ["求圆心角 $\\angle BOC$ 的度数"],
      givens: ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "$O$ 为圆心", "$\\angle BAC=" + a + "^\\circ$"],
      solution: ["同弧 $BC$ 所对的圆心角等于圆周角的 2 倍，$\\angle BOC=2\\angle BAC=" + 2 * a + "^\\circ$。"],
      steps: [{ text: "$\\angle BOC=2\\angle BAC=" + 2 * a + "^\\circ$", basis: "一条弧所对的圆心角等于它所对圆周角的 2 倍" }],
      checks: [{ expr: "ans - 2*alpha", at: { ans: 2 * a, alpha: a }, expect: 0 }]
    };
  }

  if (mode === 2) {
    const a = pickAt([20, 25, 35, 40, 50, 55, 65, 70], 1);
    return {
      params: { mode: 2, alpha: a },
      stem: "如图，$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上，连接 $AC$、$BC$。若 $\\angle ABC=" + a + "^\\circ$，则 $\\angle BAC$ 的度数是（  ）",
      answer: String(90 - a) + "°",
      distractors: [String(a) + "°", String(2 * a) + "°", String(90 + a) + "°"],
      goal: "求直角三角形中的锐角 ∠BAC",
      goals: ["求 $\\angle BAC$ 的度数"],
      givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上", "$\\angle ABC=" + a + "^\\circ$"],
      solution: ["直径所对的圆周角是直角，$\\angle ACB=90^\\circ$，在 $Rt\\triangle ABC$ 中 $\\angle BAC=90^\\circ-" + a + "^\\circ=" + (90 - a) + "^\\circ$。"],
      steps: [{ text: "$\\angle ACB=90^\\circ$", basis: "直径所对的圆周角是直角" }, { text: "$\\angle BAC=90^\\circ-\\angle ABC=" + (90 - a) + "^\\circ$", basis: "直角三角形两锐角互余" }],
      checks: [{ expr: "ans + alpha - 90", at: { ans: 90 - a, alpha: a }, expect: 0 }]
    };
  }

  if (mode === 3) {
    const a = pickAt([55, 60, 65, 70, 75, 80], 1);
    const b = pickAt([70, 75, 85, 95, 100, 110], 2);
    return {
      params: { mode: 3, alpha: a, beta: b },
      stem: "如图，四边形 $ABCD$ 内接于 $\\odot O$。若 $\\angle A=" + a + "^\\circ$，$\\angle B=" + b + "^\\circ$，则 $\\angle D$ 的度数是（  ）",
      answer: String(180 - b) + "°",
      distractors: [String(180 - a) + "°", String(a) + "°", String(b) + "°"],
      goal: "求圆内接四边形中 ∠D 的度数",
      goals: ["求 $\\angle D$ 的度数"],
      givens: ["四边形 $ABCD$ 内接于 $\\odot O$", "$\\angle A=" + a + "^\\circ$", "$\\angle B=" + b + "^\\circ$"],
      solution: ["圆内接四边形对角互补，$\\angle B+\\angle D=180^\\circ$，所以 $\\angle D=180^\\circ-" + b + "^\\circ=" + (180 - b) + "^\\circ$。"],
      steps: [{ text: "$\\angle D=180^\\circ-\\angle B=" + (180 - b) + "^\\circ$", basis: "圆内接四边形对角互补" }],
      checks: [{ expr: "ans + beta - 180", at: { ans: 180 - b, beta: b }, expect: 0 }]
    };
  }

  const tri = pickAt([[13, 5, 12], [25, 7, 24], [17, 8, 15], [10, 6, 8], [13, 12, 5]], 3);
  const r = tri[0], d = tri[1], half = tri[2];
  return {
    params: { mode: 4, r: r, d: d, half: half },
    stem: "如图，$AB$ 是 $\\odot O$ 的弦，$OH\\perp AB$ 于点 $H$。若 $\\odot O$ 的半径 $OA=" + r + "$，$OH=" + d + "$，则弦 $AB$ 的长是（  ）",
    answer: String(2 * half),
    distractors: [String(half), String(r - d), String(r + d)],
    goal: "用垂径定理与勾股定理求弦 AB 的长",
    goals: ["求弦 $AB$ 的长"],
    givens: ["$AB$ 是 $\\odot O$ 的弦", "$OH\\perp AB$ 于点 $H$", "$OA=" + r + "$", "$OH=" + d + "$"],
    solution: ["由垂径定理 $AH=\\frac{1}{2}AB$。在 $Rt\\triangle OAH$ 中，$AH=\\sqrt{OA^{2}-OH^{2}}=\\sqrt{" + r + "^{2}-" + d + "^{2}}=" + half + "$，所以 $AB=2AH=" + 2 * half + "$。"],
    steps: [{ text: "$AH=\\sqrt{OA^{2}-OH^{2}}=" + half + "$", basis: "勾股定理" }, { text: "$AB=2AH=" + 2 * half + "$", basis: "垂径定理" }],
    checks: [{ expr: "(ans/2)^2 + d*d - r*r", at: { ans: 2 * half, d: d, r: r }, expect: 0 }]
  };
}
