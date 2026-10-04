export const kind = "dynamic/circle-angle-mcq";
export const covers = ["圆周角定理", "圆的基本性质"];

const THETAS = [30, 40, 50, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const TS = [20, 30, 40, 50, 60, 70];

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed));
  const r = s % 30;
  const mode = r < 18 ? 0 : 1 + ((r - 18) % 9);
  const theta = mode === 0 ? 60 : THETAS[Math.floor(s / 30) % THETAS.length];
  const t = TS[Math.floor(s / 30) % TS.length];

  if (mode === 0) {
    const ans = theta / 2;
    return {
      params: { mode: 0, theta: theta, ans: ans },
      distractors: [ans - 10, ans + 10, ans + 20],
      stem: "在 $\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$，点 $C$ 在优弧 $AB$ 上（不与点 $A$、$B$ 重合），则 $\\angle ACB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求 $\\angle ACB$ 的度数",
      goals: ["求 $\\angle ACB$ 的度数"],
      givens: ["$\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$", "点 $C$ 在优弧 $AB$ 上，且不与点 $A$、$B$ 重合"],
      solution: ["$\\angle ACB$ 与 $\\angle AOB$ 对着同一段弧 $AB$，由圆周角定理 $\\angle ACB=\\frac{1}{2}\\angle AOB=" + ans + "^{\\circ}$．"],
      steps: [
        { text: "$\\angle AOB$ 是弧 $AB$ 所对的圆心角，$\\angle ACB$ 是弧 $AB$ 所对的圆周角", basis: "圆周角与圆心角的定义" },
        { text: "$\\angle ACB=\\frac{1}{2}\\angle AOB=" + ans + "^{\\circ}$", basis: "圆周角定理" }
      ],
      checks: [{ expr: "2*ans - theta", at: { ans: ans, theta: theta }, expect: 0 }]
    };
  }

  if (mode === 1) {
    const g = theta / 2;
    return {
      params: { mode: 1, inscribed: g, ans: theta },
      distractors: [theta - 10, theta + 10, theta + 20],
      stem: "在 $\\odot O$ 中，点 $A$、$B$、$C$ 都在圆上，圆周角 $\\angle ACB=" + g + "^{\\circ}$，则圆心角 $\\angle AOB$ 的度数为（　　）",
      answer: theta + "°",
      goal: "求圆心角 $\\angle AOB$ 的度数",
      goals: ["求圆心角 $\\angle AOB$ 的度数"],
      givens: ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "圆周角 $\\angle ACB=" + g + "^{\\circ}$"],
      solution: ["$\\angle AOB$ 与 $\\angle ACB$ 对着同一段弧 $AB$，由圆周角定理 $\\angle ACB=\\frac{1}{2}\\angle AOB$，所以 $\\angle AOB=2\\times " + g + "^{\\circ}=" + theta + "^{\\circ}$．"],
      steps: [
        { text: "两个角对着同一段弧 $AB$", basis: "圆周角与圆心角的定义" },
        { text: "$\\angle AOB=2\\angle ACB=" + theta + "^{\\circ}$", basis: "圆周角定理" }
      ],
      checks: [{ expr: "ans - 2*inscribed", at: { ans: theta, inscribed: g }, expect: 0 }]
    };
  }

  if (mode === 2) {
    const ans = 180 - theta / 2;
    return {
      params: { mode: 2, theta: theta, ans: ans },
      distractors: [ans - 10, ans + 10, ans + 20],
      stem: "在 $\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$，点 $C$ 在劣弧 $AB$ 上（不与点 $A$、$B$ 重合），则 $\\angle ACB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求 $\\angle ACB$ 的度数",
      goals: ["求 $\\angle ACB$ 的度数"],
      givens: ["$\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$", "点 $C$ 在劣弧 $AB$ 上，且不与点 $A$、$B$ 重合"],
      solution: ["$C$ 在劣弧 $AB$ 上，$\\angle ACB$ 对着的是优弧 $AB$，它对圆心角 $360^{\\circ}-" + theta + "^{\\circ}=" + (360 - theta) + "^{\\circ}$，所以 $\\angle ACB=" + ans + "^{\\circ}$．"],
      steps: [
        { text: "$C$ 在劣弧上，$\\angle ACB$ 所对的弧是优弧 $AB$", basis: "圆周角与圆心角的定义" },
        { text: "$\\angle ACB=\\frac{1}{2}(360^{\\circ}-\\angle AOB)=" + ans + "^{\\circ}$", basis: "圆周角定理" }
      ],
      checks: [{ expr: "2*ans + theta - 360", at: { ans: ans, theta: theta }, expect: 0 }]
    };
  }

  if (mode === 3) {
    return {
      params: { mode: 3, ans: 90 },
      distractors: [80, 100, 110],
      stem: "$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上（不与点 $A$、$B$ 重合），则 $\\angle ACB$ 的度数为（　　）",
      answer: "90°",
      goal: "求 $\\angle ACB$ 的度数",
      goals: ["求 $\\angle ACB$ 的度数"],
      givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上，且不与点 $A$、$B$ 重合"],
      solution: ["直径 $AB$ 所对的圆心角是 $180^{\\circ}$，由圆周角定理 $\\angle ACB=\\frac{1}{2}\\times 180^{\\circ}=90^{\\circ}$．"],
      steps: [
        { text: "$\\angle ACB$ 对着半圆", basis: "圆周角与圆心角的定义" },
        { text: "$\\angle ACB=90^{\\circ}$", basis: "直径所对的圆周角是直角" }
      ],
      checks: [{ expr: "ans - 90", at: { ans: 90 }, expect: 0 }]
    };
  }

  if (mode === 4) {
    const g = theta / 2;
    return {
      params: { mode: 4, inscribed: g, ans: theta },
      distractors: [theta - 10, theta + 10, theta + 20],
      stem: "在 $\\odot O$ 中，点 $A$、$B$、$C$ 都在圆上，圆周角 $\\angle ACB=" + g + "^{\\circ}$，则弧 $AB$ 的度数为（　　）",
      answer: theta + "°",
      goal: "求弧 $AB$ 的度数",
      goals: ["求弧 $AB$ 的度数"],
      givens: ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "圆周角 $\\angle ACB=" + g + "^{\\circ}$"],
      solution: ["圆周角 $\\angle ACB=\\frac{1}{2}\\times$ 弧 $AB$ 的度数，所以弧 $AB$ 的度数为 $2\\times " + g + "^{\\circ}=" + theta + "^{\\circ}$．"],
      steps: [
        { text: "$\\angle ACB$ 对着弧 $AB$", basis: "圆周角与圆心角的定义" },
        { text: "弧 $AB$ 的度数 $=2\\angle ACB=" + theta + "^{\\circ}$", basis: "圆周角定理" }
      ],
      checks: [{ expr: "ans - 2*inscribed", at: { ans: theta, inscribed: g }, expect: 0 }]
    };
  }

  if (mode === 5) {
    return {
      params: { mode: 5, theta: theta, ans: theta },
      distractors: [theta - 10, theta + 10, theta + 20],
      stem: "在 $\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$，则弧 $AB$ 的度数为（　　）",
      answer: theta + "°",
      goal: "求弧 $AB$ 的度数",
      goals: ["求弧 $AB$ 的度数"],
      givens: ["$\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$", "弧 $AB$ 是圆心角 $\\angle AOB$ 所对的弧"],
      solution: ["圆心角的度数等于它所对弧的度数，所以弧 $AB$ 的度数为 $" + theta + "^{\\circ}$．"],
      steps: [
        { text: "弧 $AB$ 是圆心角 $\\angle AOB$ 所对的弧", basis: "圆心角的定义" },
        { text: "弧 $AB$ 的度数 $=\\angle AOB=" + theta + "^{\\circ}$", basis: "圆心角的度数等于所对弧的度数" }
      ],
      checks: [{ expr: "ans - theta", at: { ans: theta, theta: theta }, expect: 0 }]
    };
  }

  if (mode === 6) {
    const ans = 90 - t;
    return {
      params: { mode: 6, abc: t, ans: ans },
      distractors: [ans - 10, ans + 10, ans + 20],
      stem: "$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上，且 $\\angle ABC=" + t + "^{\\circ}$，则 $\\angle BAC$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求 $\\angle BAC$ 的度数",
      goals: ["求 $\\angle BAC$ 的度数"],
      givens: ["$AB$ 是 $\\odot O$ 的直径", "点 $C$ 在 $\\odot O$ 上", "$\\angle ABC=" + t + "^{\\circ}$"],
      solution: ["$AB$ 是直径，所以 $\\angle ACB=90^{\\circ}$；在 $\\triangle ABC$ 中 $\\angle BAC=90^{\\circ}-\\angle ABC=" + ans + "^{\\circ}$．"],
      steps: [
        { text: "$\\angle ACB=90^{\\circ}$", basis: "直径所对的圆周角是直角" },
        { text: "$\\angle BAC=90^{\\circ}-\\angle ABC=" + ans + "^{\\circ}$", basis: "三角形内角和" }
      ],
      checks: [{ expr: "ans + abc - 90", at: { ans: ans, abc: t }, expect: 0 }]
    };
  }

  if (mode === 7) {
    const ans = 360 - theta;
    return {
      params: { mode: 7, theta: theta, ans: ans },
      distractors: [ans - 10, ans + 10, ans + 20],
      stem: "在 $\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$，点 $C$ 在劣弧 $AB$ 上（不与点 $A$、$B$ 重合），则优弧 $AB$ 的度数为（　　）",
      answer: ans + "°",
      goal: "求优弧 $AB$ 的度数",
      goals: ["求优弧 $AB$ 的度数"],
      givens: ["$\\odot O$ 中，圆心角 $\\angle AOB=" + theta + "^{\\circ}$", "点 $C$ 在劣弧 $AB$ 上，且不与点 $A$、$B$ 重合"],
      solution: ["劣弧 $AB$ 的度数等于 $\\angle AOB=" + theta + "^{\\circ}$，所以优弧 $AB$ 的度数为 $360^{\\circ}-" + theta + "^{\\circ}=" + ans + "^{\\circ}$．"],
      steps: [
        { text: "劣弧 $AB$ 的度数 $=\\angle AOB=" + theta + "^{\\circ}$", basis: "圆心角的度数等于所对弧的度数" },
        { text: "优弧 $AB$ 的度数 $=360^{\\circ}-" + theta + "^{\\circ}=" + ans + "^{\\circ}$", basis: "圆的总度数为 $360^{\\circ}$" }
      ],
      checks: [{ expr: "ans + theta - 360", at: { ans: ans, theta: theta }, expect: 0 }]
    };
  }

  if (mode === 8) {
    const g = theta / 2;
    return {
      params: { mode: 8, inscribed: g, ans: g },
      distractors: [g - 10, g + 10, g + 20],
      stem: "点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上，$C$、$D$ 在优弧 $AB$ 上，且 $\\angle ACB=" + g + "^{\\circ}$，则 $\\angle ADB$ 的度数为（　　）",
      answer: g + "°",
      goal: "求 $\\angle ADB$ 的度数",
      goals: ["求 $\\angle ADB$ 的度数"],
      givens: ["点 $A$、$B$、$C$、$D$ 都在 $\\odot O$ 上", "$C$、$D$ 在优弧 $AB$ 上", "$\\angle ACB=" + g + "^{\\circ}$"],
      solution: ["$\\angle ACB$ 与 $\\angle ADB$ 都是弧 $AB$ 所对的圆周角，同弧所对的圆周角相等，所以 $\\angle ADB=\\angle ACB=" + g + "^{\\circ}$．"],
      steps: [
        { text: "两个角都是弧 $AB$ 所对的圆周角", basis: "圆周角与圆心角的定义" },
        { text: "同弧所对的圆周角相等，$\\angle ADB=" + g + "^{\\circ}$", basis: "圆周角定理" }
      ],
      checks: [{ expr: "ans - inscribed", at: { ans: g, inscribed: g }, expect: 0 }]
    };
  }

  const g9 = theta / 2;
  const ans9 = 360 - theta;
  return {
    params: { mode: 9, inscribed: g9, ans: ans9 },
    distractors: [ans9 - 10, ans9 + 10, ans9 + 20],
    stem: "点 $A$、$B$、$C$ 都在 $\\odot O$ 上，$C$ 在优弧 $AB$ 上，且 $\\angle ACB=" + g9 + "^{\\circ}$，则劣弧 $AB$ 所对圆心角的度数为（　　）",
    answer: ans9 + "°",
    goal: "求劣弧 $AB$ 所对圆心角的度数",
    goals: ["求劣弧 $AB$ 所对圆心角的度数"],
    givens: ["点 $A$、$B$、$C$ 都在 $\\odot O$ 上", "$C$ 在优弧 $AB$ 上", "$\\angle ACB=" + g9 + "^{\\circ}$"],
    solution: ["$\\angle ACB$ 对着优弧 $AB$，优弧 $AB$ 的度数为 $2\\times " + g9 + "^{\\circ}=" + (2 * g9) + "^{\\circ}$，所以劣弧 $AB$ 所对圆心角为 $360^{\\circ}-" + (2 * g9) + "^{\\circ}=" + ans9 + "^{\\circ}$．"],
    steps: [
      { text: "优弧 $AB$ 的度数 $=2\\angle ACB=" + (2 * g9) + "^{\\circ}$", basis: "圆周角定理" },
      { text: "劣弧 $AB$ 所对圆心角 $=360^{\\circ}-" + (2 * g9) + "^{\\circ}=" + ans9 + "^{\\circ}$", basis: "圆心角的度数等于所对弧的度数" }
    ],
    checks: [{ expr: "ans + 2*inscribed - 360", at: { ans: ans9, inscribed: g9 }, expect: 0 }]
  };
}
