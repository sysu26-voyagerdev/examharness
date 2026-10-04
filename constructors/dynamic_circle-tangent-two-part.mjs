// 圆的两问解答题：切线与直径（圆的性质）综合。答案由半径与特殊角推出，检验点用整数平方关系。
export const kind = "dynamic/circle-tangent-two-part";
export const covers = ["圆与切线", "圆的基本性质", "切线的判定与性质"];

const R_SINGLE = [4, 6, 8, 9, 10, 12, 15, 16];
const R_MULT3 = [3, 6, 9, 12, 15, 18];

function sqrt3u(k) {
  if (k === 1) return "√3";
  return k + "√3";
}

function sqrt3c(k) {
  if (k === 1) return "\\sqrt{3}";
  return k + "\\sqrt{3}";
}

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 1000003;
  const v = s % 3;
  const idx = Math.floor(s / 3);

  // 结构一：两切线相交（已知圆心角 AOC），求夹角与切线长
  if (v === 1) {
    const r = R_SINGLE[idx % R_SINGLE.length];
    const AOC = 120;
    const ADC = 60;
    const AD2 = 3 * r * r;
    const t = sqrt3c(r);
    return {
      params: { 半径: r, AOC: AOC, ADC: ADC, AD2: AD2 },
      stem: "如图，$A$、$C$ 是 $\\odot O$ 上的两点，$\\angle AOC=120^{\\circ}$。过点 $A$、$C$ 分别作 $\\odot O$ 的切线，两条切线相交于点 $D$。请解答：（1）求 $\\angle ADC$ 的度数；（2）若 $\\odot O$ 的半径为 $" + r + "$，求线段 $DA$、$DC$ 的长。",
      answer: "∠ADC=60°；DA=DC=" + sqrt3u(r),
      goal: "求 $\\angle ADC$ 的度数，并在给定半径下求两条切线长 $DA$、$DC$",
      goals: [
        "求 $\\angle ADC$ 的度数",
        "在半径为 " + r + " 时求切线长 $DA$ 与 $DC$"
      ],
      givens: [
        "点 $A$、$C$ 都在 $\\odot O$ 上",
        "$\\angle AOC=120^{\\circ}$",
        "过点 $A$、$C$ 的切线相交于点 $D$",
        "$\\odot O$ 的半径为 " + r
      ],
      solution: [
        "由切线性质得 $OA\\perp DA$，$OC\\perp DC$，即 $\\angle OAD=\\angle OCD=90^{\\circ}$。",
        "在四边形 $OADC$ 中，$\\angle ADC=360^{\\circ}-90^{\\circ}-90^{\\circ}-\\angle AOC=180^{\\circ}-120^{\\circ}=60^{\\circ}$。",
        "$OD$ 平分 $\\angle ADC$，得 $\\angle ADO=30^{\\circ}$，在 Rt$\\triangle OAD$ 中 $DA=OA\\cdot\\tan 60^{\\circ}=" + t + "$。",
        "由切线长定理 $DC=DA=" + t + "$。"
      ],
      steps: [
        { text: "切线垂直于过切点的半径，$OA\\perp DA$，$OC\\perp DC$", basis: "切线的性质" },
        { text: "$\\angle ADC=180^{\\circ}-\\angle AOC=60^{\\circ}$", basis: "四边形内角和" },
        { text: "$DA=OA\\cdot\\tan\\angle AOD=" + t + "$", basis: "锐角三角函数" },
        { text: "$DC=DA$", basis: "切线长定理" }
      ],
      checks: [
        { expr: "ADC + AOC - 180", at: { ADC: ADC, AOC: AOC }, expect: 0 },
        { expr: "AD2 - 3*r*r", at: { AD2: AD2, r: r }, expect: 0 }
      ]
    };
  }

  // 结构二：过 B、C 的切线相交，圆周角推出圆心角，求夹角与切线长
  if (v === 2) {
    const r = R_MULT3[idx % R_MULT3.length];
    const A = 30;
    const BOC = 60;
    const BDC = 120;
    const BD2 = (r * r) / 3;
    const OD2 = (4 * r * r) / 3;
    const bd = (r / 3 === 1) ? "\\sqrt{3}" : (r / 3) + "\\sqrt{3}";
    return {
      params: { 半径: r, BAC: A, BOC: BOC, BDC: BDC, BD2: BD2, OD2: OD2 },
      stem: "如图，$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上，$\\angle BAC=30^{\\circ}$。过点 $B$、$C$ 分别作 $\\odot O$ 的切线，两条切线相交于点 $D$。请解答：（1）求 $\\angle BDC$ 的度数；（2）若 $\\odot O$ 的半径为 $" + r + "$，求线段 $BD$ 的长。",
      answer: "∠BDC=120°；BD=" + sqrt3u(r / 3),
      goal: "求 $\\angle BDC$ 的度数，并在给定半径下求切线长 $BD$",
      goals: [
        "求 $\\angle BDC$ 的度数",
        "在半径为 " + r + " 时求切线长 $BD$"
      ],
      givens: [
        "$AB$ 是 $\\odot O$ 的直径",
        "点 $C$ 在 $\\odot O$ 上",
        "$\\angle BAC=30^{\\circ}$",
        "过点 $B$、$C$ 的切线相交于点 $D$",
        "$\\odot O$ 的半径为 " + r
      ],
      solution: [
        "在 $\\odot O$ 中，$\\angle BAC$ 是 $\\widehat{BC}$ 所对的圆周角，$\\angle BOC$ 是同弧所对的圆心角，故 $\\angle BOC=2\\angle BAC=60^{\\circ}$。",
        "由切线性质 $OB\\perp DB$，$OC\\perp DC$，在四边形 $OBDC$ 中 $\\angle BDC=360^{\\circ}-90^{\\circ}-90^{\\circ}-60^{\\circ}=120^{\\circ}$。",
        "$OD$ 平分 $\\angle BDC$，$\\angle BDO=60^{\\circ}$，在 Rt$\\triangle OBD$ 中 $\\angle BOD=30^{\\circ}$，$BD=OB\\cdot\\tan 30^{\\circ}=" + bd + "$。"
      ],
      steps: [
        { text: "$\\angle BOC=2\\angle BAC=60^{\\circ}$", basis: "圆周角定理" },
        { text: "$\\angle BDC=180^{\\circ}-\\angle BOC=120^{\\circ}$", basis: "四边形内角和与切线性质" },
        { text: "$BD=OB\\cdot\\tan 30^{\\circ}=" + bd + "$", basis: "锐角三角函数" }
      ],
      checks: [
        { expr: "BDC + 2*BAC - 180", at: { BDC: BDC, BAC: A }, expect: 0 },
        { expr: "3*BD2 - r*r", at: { BD2: BD2, r: r }, expect: 0 },
        { expr: "3*OD2 - 4*r*r", at: { OD2: OD2, r: r }, expect: 0 }
      ]
    };
  }

  // 结构三：切线与直径的延长线相交，圆周角与切线性质求出角与线段长
  const r = R_SINGLE[idx % R_SINGLE.length];
  const A = 30;
  const DANG = 30;
  const CD2 = 3 * r * r;
  const DB = r;
  const DA = 3 * r;
  const OD = 2 * r;
  const cd = sqrt3c(r);
  return {
    params: { 半径: r, BAC: A, D: DANG, CD2: CD2, DB: DB, DA: DA, OD: OD },
    stem: "如图，$AB$ 是 $\\odot O$ 的直径，点 $C$ 在 $\\odot O$ 上（不与点 $A$、$B$ 重合），$\\angle BAC=30^{\\circ}$。过点 $C$ 作 $\\odot O$ 的切线，与 $AB$ 的延长线相交于点 $D$。请解答：（1）求 $\\angle D$ 的度数；（2）若 $\\odot O$ 的半径为 $" + r + "$，求切线长 $CD$ 与线段 $DB$ 的长。",
    answer: "∠D=30°；CD=" + sqrt3u(r) + "；DB=" + DB,
    goal: "求 $\\angle D$ 的度数，并在给定半径下求切线长 $CD$ 与线段 $DB$",
    goals: [
      "求 $\\angle D$ 的度数",
      "在半径为 " + r + " 时求切线长 $CD$ 与线段 $DB$"
    ],
    givens: [
      "$AB$ 是 $\\odot O$ 的直径",
      "点 $C$ 在 $\\odot O$ 上",
      "$\\angle BAC=30^{\\circ}$",
      "过点 $C$ 的切线与 $AB$ 的延长线相交于点 $D$",
      "$\\odot O$ 的半径为 " + r
    ],
    solution: [
      "$AB$ 是直径，故 $\\angle ACB=90^{\\circ}$，由 $\\angle BAC=30^{\\circ}$ 得 $\\angle ABC=60^{\\circ}$。",
      "$OA=OC$，得 $\\angle OCA=\\angle BAC=30^{\\circ}$，$\\angle COD=\\angle OCA+\\angle BAC=60^{\\circ}$。",
      "$CD$ 是切线，$OC\\perp CD$，在 Rt$\\triangle OCD$ 中 $\\angle D=90^{\\circ}-60^{\\circ}=30^{\\circ}$。",
      "在 Rt$\\triangle OCD$ 中 $CD=OC\\cdot\\tan 60^{\\circ}=" + cd + "$，$OD=2OC=" + OD + "$，故 $DB=OD-OB=" + DB + "$。"
    ],
    steps: [
      { text: "$\\angle ACB=90^{\\circ}$，$\\angle ABC=60^{\\circ}$", basis: "直径所对的圆周角是直角" },
      { text: "$\\angle COD=2\\angle BAC=60^{\\circ}$", basis: "三角形外角与等腰三角形" },
      { text: "$\\angle D=90^{\\circ}-\\angle COD=30^{\\circ}$", basis: "切线的性质" },
      { text: "$CD=OC\\cdot\\tan 60^{\\circ}=" + cd + "$，$OD=2OC$，$DB=OD-OB=" + DB + "$", basis: "锐角三角函数" }
    ],
    checks: [
      { expr: "D + 2*BAC - 90", at: { D: DANG, BAC: A }, expect: 0 },
      { expr: "CD2 - 3*r*r", at: { CD2: CD2, r: r }, expect: 0 },
      { expr: "DB*DA - CD2", at: { DB: DB, DA: DA, CD2: CD2 }, expect: 0 },
      { expr: "OD - DB - r", at: { OD: OD, DB: DB, r: r }, expect: 0 }
    ]
  };
}
