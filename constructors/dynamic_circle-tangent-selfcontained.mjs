export const kind = "dynamic/circle-tangent-selfcontained";
export const covers = ["圆与切线", "切线的判定与性质", "切线长定理"];

const RADII = [3, 4, 6, 9];

function fmtRoot(n) {
  let a = 1;
  let b = Math.round(n);
  for (let i = 2; i * i <= b; i = i + 1) {
    while (b % (i * i) === 0) {
      b = b / (i * i);
      a = a * i;
    }
  }
  if (b === 1) return String(a);
  if (a === 1) return "√" + b;
  return a + "√" + b;
}

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed));
  const mode = s % 5;
  const r = RADII[(s + 1) % RADII.length];

  if (mode === 0) {
    const alpha = [60, 90][Math.floor(s / 5) % 2];
    const AOB = 180 - alpha;
    const PA2 = alpha === 60 ? 3 * r * r : r * r;
    const PO2 = alpha === 60 ? 4 * r * r : 2 * r * r;
    const k = alpha === 60 ? 3 : 1;
    const PA = fmtRoot(PA2);
    return {
      params: { 半径: r, 两切线夹角: alpha, AOB: AOB, PA2: PA2, PO2: PO2, k: k },
      stem: `⊙O 的半径为 ${r}，点 P 在 ⊙O 外，PA、PB 分别与 ⊙O 相切于点 A、B，且 ∠APB=${alpha}°。\n（1）求 ∠AOB 的度数；\n（2）求切线长 PA 与线段 PO 的长。`,
      answer: `∠AOB=${AOB}°；PA=${PA}，PO=${fmtRoot(PO2)}`,
      goal: "求圆心角 AOB 的度数，并求切线长 PA 与线段 PO 的长",
      goals: ["求 ∠AOB 的度数", "求切线长 PA 与线段 PO 的长"],
      givens: [`⊙O 的半径为 ${r}`, "PA、PB 分别与 ⊙O 相切于点 A、B", `∠APB=${alpha}°`],
      solution: [
        "由切线性质得 OA⊥PA，OB⊥PB，所以 ∠OAP=∠OBP=90°。",
        `四边形 AOBP 的内角和为 360°，所以 ∠AOB=360°−90°−90°−${alpha}°=${AOB}°。`,
        `由 OP 平分 ∠APB 得 ∠OPA=${alpha / 2}°，在 Rt△OAP 中 tan∠OPA=OA÷PA，所以 PA=${PA}。`,
        `由勾股定理 PO²=OA²+PA²=${r * r}+${PA2}=${PO2}，所以 PO=${fmtRoot(PO2)}。`
      ],
      steps: [
        { text: "切线垂直于过切点的半径，得 OA⊥PA，OB⊥PB", basis: "切线的性质" },
        { text: `四边形内角和 360°，得 ∠AOB=${AOB}°`, basis: "四边形内角和" },
        { text: "在直角三角形 OAP 中用锐角三角函数与勾股定理求 PA、PO", basis: "锐角三角函数、勾股定理" }
      ],
      checks: [
        { expr: "AOB + APB - 180", at: { AOB: AOB, APB: alpha }, expect: 0 },
        { expr: "PO2 - PA2 - r*r", at: { PO2: PO2, PA2: PA2, r: r }, expect: 0 },
        { expr: "PA2 - k*r*r", at: { PA2: PA2, k: k, r: r }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    const theta = [30, 45][Math.floor(s / 5) % 2];
    const AOP = 90 - theta;
    const PA2 = theta === 30 ? 3 * r * r : r * r;
    const PO2 = theta === 30 ? 4 * r * r : 2 * r * r;
    const k = theta === 30 ? 3 : 1;
    return {
      params: { 半径: r, 角OPA: theta, AOP: AOP, PA2: PA2, PO2: PO2, k: k },
      stem: `⊙O 的半径为 ${r}，点 P 在 ⊙O 外，PA 与 ⊙O 相切于点 A，且 ∠OPA=${theta}°。\n（1）求 ∠AOP 的度数；\n（2）求线段 PA 与 PO 的长。`,
      answer: `∠AOP=${AOP}°；PA=${fmtRoot(PA2)}，PO=${fmtRoot(PO2)}`,
      goal: "求圆心角 AOP 的度数，并求线段 PA 与 PO 的长",
      goals: ["求 ∠AOP 的度数", "求线段 PA 与 PO 的长"],
      givens: [`⊙O 的半径为 ${r}`, "点 P 在 ⊙O 外", "PA 与 ⊙O 相切于点 A", `∠OPA=${theta}°`],
      solution: [
        "由切线性质得 OA⊥PA，所以 ∠OAP=90°。",
        `在 Rt△OAP 中，∠AOP=90°−${theta}°=${AOP}°。`,
        `由 tan∠OPA=OA÷PA 得 PA=${fmtRoot(PA2)}。`,
        `由勾股定理 PO²=OA²+PA²=${r * r}+${PA2}=${PO2}，所以 PO=${fmtRoot(PO2)}。`
      ],
      steps: [
        { text: "切线垂直于过切点的半径，得 OA⊥PA", basis: "切线的性质" },
        { text: `直角三角形两锐角互余，得 ∠AOP=${AOP}°`, basis: "直角三角形两锐角互余" },
        { text: "用 tan∠OPA 与勾股定理求 PA、PO", basis: "锐角三角函数、勾股定理" }
      ],
      checks: [
        { expr: "AOP + OPA - 90", at: { AOP: AOP, OPA: theta }, expect: 0 },
        { expr: "PO2 - PA2 - r*r", at: { PO2: PO2, PA2: PA2, r: r }, expect: 0 },
        { expr: "PA2 - k*r*r", at: { PA2: PA2, k: k, r: r }, expect: 0 }
      ]
    };
  }

  if (mode === 2) {
    const theta = [45, 60][Math.floor(s / 5) % 2];
    const APB = 90 - theta;
    const PA2 = theta === 45 ? 4 * r * r : 12 * r * r;
    const PB2 = theta === 45 ? 8 * r * r : 16 * r * r;
    const m = theta === 45 ? 4 : 12;
    const n = theta === 45 ? 8 : 16;
    return {
      params: { 半径: r, 角PBA: theta, APB: APB, PA2: PA2, PB2: PB2, m: m, n: n },
      stem: `AB 是 ⊙O 的直径（⊙O 的半径为 ${r}），点 P 是直线 AB 外一点，PA 与 ⊙O 相切于点 A，且 ∠PBA=${theta}°。\n（1）求 ∠APB 的度数；\n（2）求线段 PA 与 PB 的长。`,
      answer: `∠APB=${APB}°；PA=${fmtRoot(PA2)}，PB=${fmtRoot(PB2)}`,
      goal: "求圆周角 APB 的度数，并求线段 PA 与 PB 的长",
      goals: ["求 ∠APB 的度数", "求线段 PA 与 PB 的长"],
      givens: ["AB 是 ⊙O 的直径", `⊙O 的半径为 ${r}`, "PA 与 ⊙O 相切于点 A", `∠PBA=${theta}°`],
      solution: [
        "由切线性质得 PA⊥AB，所以 △PAB 是直角三角形。",
        `所以 ∠APB=90°−${theta}°=${APB}°。`,
        `由 AB=2×${r}=${2 * r}，tan∠PBA=PA÷AB 得 PA=${fmtRoot(PA2)}。`,
        `由勾股定理 PB²=PA²+AB²=${PA2}+${4 * r * r}=${PB2}，所以 PB=${fmtRoot(PB2)}。`
      ],
      steps: [
        { text: "切线垂直于过切点的半径，得 PA⊥AB", basis: "切线的性质" },
        { text: `直角三角形两锐角互余，得 ∠APB=${APB}°`, basis: "直角三角形两锐角互余" },
        { text: "用 tan∠PBA 与勾股定理求 PA、PB", basis: "锐角三角函数、勾股定理" }
      ],
      checks: [
        { expr: "APB + PBA - 90", at: { APB: APB, PBA: theta }, expect: 0 },
        { expr: "PB2 - PA2 - 4*r*r", at: { PB2: PB2, PA2: PA2, r: r }, expect: 0 },
        { expr: "PA2 - m*r*r", at: { PA2: PA2, m: m, r: r }, expect: 0 },
        { expr: "PB2 - n*r*r", at: { PB2: PB2, n: n, r: r }, expect: 0 }
      ]
    };
  }

  if (mode === 3) {
    const m0 = 4 + (s % 6);
    const alpha = [60, 90][Math.floor(s / 5) % 2];
    const AOB = 180 - alpha;
    return {
      params: { 切线长PA: m0, 两切线夹角: alpha, 周长: 2 * m0, AOB: AOB },
      stem: `PA、PB 分别与 ⊙O 相切于点 A、B（点 P 在 ⊙O 外），另一条直线与 ⊙O 相切于点 E，且分别与 PA、PB 相交于点 C、D。已知 PA=${m0}，∠APB=${alpha}°。\n（1）求 △PCD 的周长；\n（2）求 ∠AOB 的度数。`,
      answer: `△PCD 的周长为 ${2 * m0}；∠AOB=${AOB}°`,
      goal: "用切线长定理求三角形 PCD 的周长，并求圆心角 AOB 的度数",
      goals: ["求 △PCD 的周长", "求 ∠AOB 的度数"],
      givens: ["PA、PB 分别与 ⊙O 相切于点 A、B", "过点 E 的切线与 PA、PB 分别交于点 C、D", `PA=${m0}`, `∠APB=${alpha}°`],
      solution: [
        `由切线长定理得 PA=PB=${m0}，CA=CE，DE=DB。`,
        `所以 △PCD 的周长=PC+CD+DP=PC+CE+ED+DP=(PC+CA)+(DB+DP)=PA+PB=${2 * m0}。`,
        `由切线性质得 ∠OAP=∠OBP=90°，四边形 AOBP 内角和为 360°，所以 ∠AOB=360°−90°−90°−${alpha}°=${AOB}°。`
      ],
      steps: [
        { text: "由切线长定理，PA=PB，CA=CE，DE=DB", basis: "切线长定理" },
        { text: `把周长折成 PA+PB，得周长 ${2 * m0}`, basis: "线段的和差" },
        { text: `由四边形 AOBP 内角和求 ∠AOB=${AOB}°`, basis: "切线的性质、四边形内角和" }
      ],
      checks: [
        { expr: "per - 2*m", at: { per: 2 * m0, m: m0 }, expect: 0 },
        { expr: "AOB + APB - 180", at: { AOB: AOB, APB: alpha }, expect: 0 },
        { expr: "m - 4 - o", at: { m: m0, o: s % 6 }, expect: 0 }
      ]
    };
  }

  const two = Math.floor(s / 5) % 2 === 0;
  const PO2 = two ? 4 * r * r : 2 * r * r;
  const PA2 = two ? 3 * r * r : r * r;
  const theta = two ? 30 : 45;
  const k = two ? 3 : 1;
  return {
    params: { 半径: r, PO2: PO2, PA2: PA2, 角OPA: theta, k: k },
    stem: `⊙O 的半径为 ${r}，点 P 在 ⊙O 外，PA 与 ⊙O 相切于点 A，且 PO=${fmtRoot(PO2)}。\n（1）求线段 PA 的长；\n（2）求 ∠OPA 的度数。`,
    answer: `PA=${fmtRoot(PA2)}；∠OPA=${theta}°`,
    goal: "由 PO 与半径求切线长 PA，并求角 OPA 的度数",
    goals: ["求线段 PA 的长", "求 ∠OPA 的度数"],
    givens: [`⊙O 的半径为 ${r}`, "点 P 在 ⊙O 外", "PA 与 ⊙O 相切于点 A", `PO=${fmtRoot(PO2)}`],
    solution: [
      "由切线性质得 OA⊥PA，所以 △OAP 是直角三角形。",
      `由勾股定理 PA²=PO²−OA²=${PO2}−${r * r}=${PA2}，所以 PA=${fmtRoot(PA2)}。`,
      `由 sin∠OPA=OA÷PO 得 ∠OPA=${theta}°。`
    ],
    steps: [
      { text: "切线垂直于过切点的半径，得 OA⊥PA", basis: "切线的性质" },
      { text: "在 Rt△OAP 中用勾股定理求 PA", basis: "勾股定理" },
      { text: "用 sin∠OPA 求角的度数", basis: "锐角三角函数" }
    ],
    checks: [
      { expr: "PA2 + r*r - PO2", at: { PA2: PA2, r: r, PO2: PO2 }, expect: 0 },
      { expr: "PA2 - k*r*r", at: { PA2: PA2, k: k, r: r }, expect: 0 },
      { expr: "PO2*sin2 - r*r", at: { PO2: PO2, sin2: two ? 0.25 : 0.5, r: r }, expect: 0 }
    ]
  };
}
