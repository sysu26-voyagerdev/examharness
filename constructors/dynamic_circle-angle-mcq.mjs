export const kind = "dynamic/circle-angle-mcq";
export const covers = ["圆周角定理", "圆内接四边形"];

function mkRnd(seed) {
  let s = (seed >>> 0) || 987654321;
  return function () {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}

function ri(r, lo, hi) {
  return lo + Math.floor(r() * (hi - lo + 1));
}

function three(ans, cands) {
  const out = [];
  for (let i = 0; i < cands.length; i = i + 1) {
    if (out.length >= 3) {
      break;
    }
    const c = cands[i];
    if (c !== ans && c > 0 && c < 360 && out.indexOf(c) < 0) {
      out.push(c);
    }
  }
  return out;
}

function deg(v) {
  return v + "°";
}

export function construct(slot, seed) {
  const r = mkRnd(seed);
  const variant = ri(r, 0, 3);

  if (variant === 0) {
    const k = ri(r, 12, 32);
    const theta = 4 * k;
    const ans = 2 * k;
    const ds = three(ans, [theta, k, 180 - theta, theta + 60, ans + 26, 2 * ans + 10]);
    return {
      params: { theta: theta, ans: ans, half: k },
      stem: "在 $\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$，点 $C$ 在优弧 $AB$ 上（不与点 $A$、$B$ 重合），则 $\\angle ACB$ 的度数是（　　）",
      answer: deg(ans),
      distractors: ds.map(deg),
      goal: "求 $\\angle ACB$ 的度数",
      goals: ["求 $\\angle ACB$ 的度数"],
      givens: [
        "$\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$",
        "点 $C$ 在优弧 $AB$ 上，且不与点 $A$、$B$ 重合"
      ],
      solution: [
        "$\\angle ACB$ 与圆心角 $\\angle AOB$ 所对的弧都是劣弧 $AB$，由圆周角定理得 $\\angle ACB=\\frac{1}{2}\\angle AOB=\\frac{1}{2}\\times " + theta + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "$\\angle ACB$ 与 $\\angle AOB$ 所对的是同一段弧（劣弧 $AB$）", basis: "圆周角定理" },
        { text: "$\\angle ACB=\\frac{1}{2}\\times " + theta + "^{\\circ}=" + ans + "^{\\circ}$", basis: "同弧所对的圆周角等于它所对圆心角的一半" }
      ],
      checks: [
        { expr: "2*ans - theta", at: { ans: ans, theta: theta }, expect: 0 },
        { expr: "half*2 - ans", at: { ans: ans, half: k }, expect: 0 }
      ]
    };
  }

  if (variant === 1) {
    let alpha = ri(r, 20, 70);
    if (alpha === 45) {
      alpha = 46;
    }
    const ans = 90 - alpha;
    const ds = three(ans, [alpha, 90 + alpha, 180 - alpha, 2 * alpha, ans + 15, ans + 30]);
    return {
      params: { alpha: alpha, ans: ans },
      stem: "在 $\\odot O$ 中，$AB$ 是直径，点 $C$ 在 $\\odot O$ 上（不与点 $A$、$B$ 重合）。若 $\\angle CAB=" + alpha + "^{\\circ}$，则 $\\angle ABC$ 的度数是（　　）",
      answer: deg(ans),
      distractors: ds.map(deg),
      goal: "求 $\\angle ABC$ 的度数",
      goals: ["求 $\\angle ABC$ 的度数"],
      givens: [
        "$AB$ 是 $\\odot O$ 的直径",
        "点 $C$ 在 $\\odot O$ 上，且不与点 $A$、$B$ 重合",
        "$\\angle CAB=" + alpha + "^{\\circ}$"
      ],
      solution: [
        "因为 $AB$ 是直径，所以直径所对的圆周角 $\\angle ACB=90^{\\circ}$。",
        "在 $\\triangle ABC$ 中，$\\angle ABC=180^{\\circ}-90^{\\circ}-\\angle CAB=90^{\\circ}-" + alpha + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "$\\angle ACB=90^{\\circ}$", basis: "直径所对的圆周角是直角" },
        { text: "$\\angle ABC=90^{\\circ}-\\angle CAB=" + ans + "^{\\circ}$", basis: "直角三角形两锐角互余" }
      ],
      checks: [
        { expr: "ans + alpha", at: { ans: ans, alpha: alpha }, expect: 90 },
        { expr: "2*ans + 2*alpha", at: { ans: ans, alpha: alpha }, expect: 180 }
      ]
    };
  }

  if (variant === 2) {
    const m = ri(r, 10, 35);
    const beta = 2 * m;
    const ans = 2 * beta;
    const ds = three(ans, [beta, 180 - 2 * beta, 90 - beta, beta + 40, ans + 30, 2 * ans + 20]);
    return {
      params: { beta: beta, ans: ans },
      stem: "点 $A$、$B$、$C$ 都在 $\\odot O$ 上，点 $C$ 在优弧 $AB$ 上。若 $\\angle ACB=" + beta + "^{\\circ}$，则劣弧 $AB$ 所对的圆心角 $\\angle AOB$ 的度数是（　　）",
      answer: deg(ans),
      distractors: ds.map(deg),
      goal: "求圆心角 $\\angle AOB$ 的度数",
      goals: ["求劣弧 $AB$ 所对的圆心角 $\\angle AOB$ 的度数"],
      givens: [
        "点 $A$、$B$、$C$ 都在 $\\odot O$ 上",
        "点 $C$ 在优弧 $AB$ 上",
        "$\\angle ACB=" + beta + "^{\\circ}$"
      ],
      solution: [
        "点 $C$ 在优弧 $AB$ 上，所以 $\\angle ACB$ 所对的是劣弧 $AB$，$\\angle AOB$ 所对的也是劣弧 $AB$。",
        "由圆周角定理得 $\\angle AOB=2\\angle ACB=2\\times " + beta + "^{\\circ}=" + ans + "^{\\circ}$。"
      ],
      steps: [
        { text: "$\\angle ACB$ 与 $\\angle AOB$ 所对的弧都是劣弧 $AB$", basis: "圆周角定理" },
        { text: "$\\angle AOB=2\\times " + beta + "^{\\circ}=" + ans + "^{\\circ}$", basis: "同弧所对的圆心角等于圆周角的二倍" }
      ],
      checks: [
        { expr: "ans - 2*beta", at: { ans: ans, beta: beta }, expect: 0 },
        { expr: "ans + 2*beta", at: { ans: ans, beta: beta }, expect: 4 * beta }
      ]
    };
  }

  const alpha = ri(r, 30, 80);
  const ans = 180 - alpha;
  const ds = three(ans, [alpha, 2 * alpha, 90 - alpha, 180 + alpha, ans + 20, 360 - alpha]);
  return {
    params: { alpha: alpha, ans: ans },
    stem: "四边形 $ABCD$ 内接于 $\\odot O$（点 $A$、$B$、$C$、$D$ 在圆上依次排列），若 $\\angle A=" + alpha + "^{\\circ}$，则 $\\angle C$ 的度数是（　　）",
    answer: deg(ans),
    distractors: ds.map(deg),
    goal: "求 $\\angle C$ 的度数",
    goals: ["求 $\\angle C$ 的度数"],
    givens: [
      "四边形 $ABCD$ 内接于 $\\odot O$",
      "点 $A$、$B$、$C$、$D$ 在圆上依次排列",
      "$\\angle A=" + alpha + "^{\\circ}$"
    ],
    solution: [
      "$\\angle A$ 与 $\\angle C$ 是圆内接四边形 $ABCD$ 的一组对角。",
      "由圆内接四边形对角互补得 $\\angle C=180^{\\circ}-\\angle A=180^{\\circ}-" + alpha + "^{\\circ}=" + ans + "^{\\circ}$。"
    ],
    steps: [
      { text: "圆内接四边形 $ABCD$ 中 $\\angle A+\\angle C=180^{\\circ}$", basis: "圆内接四边形对角互补（由圆周角定理推出）" },
      { text: "$\\angle C=180^{\\circ}-" + alpha + "^{\\circ}=" + ans + "^{\\circ}$", basis: "等式性质" }
    ],
    checks: [
      { expr: "ans + alpha", at: { ans: ans, alpha: alpha }, expect: 180 },
      { expr: "2*ans + 2*alpha", at: { ans: ans, alpha: alpha }, expect: 360 }
    ]
  };
}
