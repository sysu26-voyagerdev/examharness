export const kind = "dynamic/circle-angle-figure";
export const covers = ["圆周角定理", "圆的基本性质"];

const D2R = Math.PI / 180;

function makeFigure(pts, segs) {
  return {
    canvas: { width: 220, height: 220 },
    circle: { center: [0, 0], r: 1 },
    points: pts,
    segments: segs,
    labels: true
  };
}

export function construct(slot, seed) {
  const m = ((seed % 4) + 4) % 4;
  let params, stem, answerValue, goalText, givens, figureSpec, checkExpr, checkAt;

  if (m === 0) {
    const n = 100 + 2 * (seed % 18);
    const val = n / 2;
    params = { n: n, ans: val, d1: n, d2: 90, d3: 2 * n };
    stem = "如图，在 $\\odot O$ 中，$A$、$B$、$C$ 三点都在圆上，点 $C$ 在优弧 $AB$ 上，圆心角 $\\angle AOB=" + n + "^{\\circ}$，则圆周角 $\\angle ACB=$（　　）";
    answerValue = "$" + val + "^{\\circ}$";
    goalText = "求圆周角 $\\angle ACB$ 的度数";
    givens = ["如图，$A$、$B$、$C$ 三点都在 $\\odot O$ 上", "点 $C$ 在优弧 $AB$ 上", "圆心角 $\\angle AOB=" + n + "^{\\circ}$"];
    figureSpec = makeFigure(
      { O: [0, 0], A: [1, 0], B: [Math.cos(n * D2R), Math.sin(n * D2R)], C: [-1, 0] },
      [["O", "A"], ["O", "B"], ["A", "C"], ["B", "C"]]
    );
    checkExpr = "n-2*ans";
    checkAt = { n: n, ans: val };
  } else if (m === 1) {
    const a = 32 + (seed % 22);
    const val = 2 * a;
    params = { a: a, ans: val, d1: a, d2: a + 90, d3: 180 - 2 * a };
    stem = "如图，$A$、$B$、$C$ 三点都在 $\\odot O$ 上，点 $C$ 在优弧 $AB$ 上，圆周角 $\\angle ACB=" + a + "^{\\circ}$，则圆心角 $\\angle AOB=$（　　）";
    answerValue = "$" + val + "^{\\circ}$";
    goalText = "求圆心角 $\\angle AOB$ 的度数";
    givens = ["如图，$A$、$B$、$C$ 三点都在 $\\odot O$ 上", "点 $C$ 在优弧 $AB$ 上", "圆周角 $\\angle ACB=" + a + "^{\\circ}$"];
    figureSpec = makeFigure(
      { O: [0, 0], A: [1, 0], B: [Math.cos(2 * a * D2R), Math.sin(2 * a * D2R)], C: [-1, 0] },
      [["O", "A"], ["O", "B"], ["A", "C"], ["B", "C"]]
    );
    checkExpr = "2*a-ans";
    checkAt = { a: a, ans: val };
  } else if (m === 2) {
    const t = 62 + (seed % 56);
    const val = 180 - t;
    params = { t: t, ans: val, d1: t, d2: 90, d3: 2 * t };
    stem = "如图，四边形 $ABCD$ 内接于 $\\odot O$，$\\angle A=" + t + "^{\\circ}$，则它的对角 $\\angle C=$（　　）";
    answerValue = "$" + val + "^{\\circ}$";
    goalText = "求圆内接四边形中 $\\angle A$ 的对角 $\\angle C$ 的度数";
    givens = ["如图，四边形 $ABCD$ 内接于 $\\odot O$", "$\\angle A=" + t + "^{\\circ}$", "$\\angle A$ 与 $\\angle C$ 是一对对角"];
    figureSpec = makeFigure(
      { O: [0, 0], A: [1, 0], B: [0, 1], C: [-1, 0], D: [0, -1] },
      [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]
    );
    checkExpr = "t+ans-180";
    checkAt = { t: t, ans: val };
  } else {
    const b = 40 + (seed % 40);
    const val = b;
    params = { b: b, ans: val, d1: 2 * b, d2: 180 - b, d3: 90 };
    stem = "如图，$A$、$B$、$C$、$D$ 四点都在 $\\odot O$ 上，$C$、$D$ 在弦 $AB$ 的同侧，$\\angle ACB=" + b + "^{\\circ}$，则 $\\angle ADB=$（　　）";
    answerValue = "$" + val + "^{\\circ}$";
    goalText = "求与 $\\angle ACB$ 同弧的圆周角 $\\angle ADB$ 的度数";
    givens = ["如图，$A$、$B$、$C$、$D$ 四点都在 $\\odot O$ 上", "$C$、$D$ 在弦 $AB$ 的同侧", "$\\angle ACB=" + b + "^{\\circ}$"];
    figureSpec = makeFigure(
      { O: [0, 0], A: [1, 0], B: [Math.cos(140 * D2R), Math.sin(140 * D2R)], C: [-1, 0], D: [Math.cos(220 * D2R), Math.sin(220 * D2R)] },
      [["A", "B"], ["A", "C"], ["B", "C"], ["A", "D"], ["B", "D"]]
    );
    checkExpr = "ans-b";
    checkAt = { b: b, ans: val };
  }

  return {
    params: params,
    stem: stem,
    figureSpec: figureSpec,
    answer: answerValue,
    goal: goalText,
    goals: [goalText],
    givens: givens,
    solution: ["同弧所对的圆周角等于它所对圆心角的一半；圆内接四边形对角互补。把已知角代入即得所求角。"],
    steps: [{ text: "把已知角与所求角放到同一段弧（或同一个圆内接四边形的对角）上，用相应定理代入", basis: "圆周角定理 / 圆内接四边形对角互补" }],
    checks: [{ expr: checkExpr, at: checkAt, expect: 0 }]
  };
}
