export const kind = "circle/tangent-multi";
export const covers = ["圆与切线"];

function frac(x) {
  if (Number.isInteger(x)) return String(x);
  for (let d = 2; d <= 12; d = d + 1) {
    const n = x * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + '/' + d;
  }
  return String(x);
}

// 三种结构：0 直径+切线求弦与线段、1 两条切线（切线长定理）、2 过圆上一点的切线（切割线定理）
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const tri = [[3, 4, 5], [5, 12, 13], [6, 8, 10], [9, 12, 15], [12, 16, 20], [15, 20, 25]];
    const tv = tri[idx % tri.length];
    const t = tv[0], diam = tv[1], PB = tv[2];
    const r = diam / 2;
    const PC = (t * t) / PB;
    const BC = PB - PC;
    const area = (t * diam) / 2;
    return {
      params: { t, diam, PB, r, PC: Number(PC.toFixed(9)), BC: Number(BC.toFixed(9)), area },
      stem: `如图，AB 是 ⊙O 的直径，AB = ${diam}，PA 与 ⊙O 相切于点 A，PA = ${t}，连接 PB 交 ⊙O 于点 C。`,
      goal: `求线段 PB 求线段 BC 求三角形面积`,
      goals: [
        `求线段 PB 的长`,
        `求线段 BC 的长`,
        `求 △PAB 的面积`,
      ],
      answers: [`PB = ${PB}`, `BC = ${frac(BC)}`, `S△PAB = ${area}`],
      answer: `（1）PB = ${PB}；（2）BC = ${frac(BC)}；（3）S△PAB = ${area}`,
      givens: [
        `AB 是 ⊙O 的直径，AB = ${diam}`,
        `PA 与 ⊙O 相切于点 A，PA = ${t}`,
        `连接 PB 交 ⊙O 于点 C`,
      ],
      solution: [
        `切线垂直于过切点的半径，所以 ∠PAB = 90°，PB = √(${t}² + ${diam}²) = ${PB}`,
        `由切割线定理 PA² = PC×PB，得 PC = ${t}²/${PB} = ${frac(PC)}，所以 BC = ${PB} − ${frac(PC)} = ${frac(BC)}`,
        `△PAB 的面积 = 1/2 × PA × AB = 1/2 × ${t} × ${diam} = ${area}`,
      ],
      steps: [
        { text: `PB = ${PB}`, basis: "切线的性质与勾股定理" },
        { text: `BC = ${frac(BC)}`, basis: "切割线定理" },
        { text: `S△PAB = ${area}`, basis: "三角形面积公式" },
      ],
      checks: [
        { expr: "t*t + diam*diam - PB*PB", at: { t, diam, PB }, expect: 0 },
        { expr: "PC*PB - t*t", at: { PC: Number(PC.toFixed(9)), PB, t }, expect: 0 },
        { expr: "t*diam/2 - area", at: { t, diam, area }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const ts = [3, 5, 6, 8, 9, 12];
    const t = ts[idx % ts.length];
    const r = t;
    const quadArea = t * t;
    const opSq = 2 * t * t;
    const rightAngle = 90;
    return {
      params: { t, r, opSq, quadArea, rightAngle },
      stem: `如图，PA、PB 分别与 ⊙O 相切于点 A、B，∠APB = ${rightAngle}°，PA = ${t}。`,
      goal: `求半径 求 OP 的平方 求四边形面积`,
      goals: [
        `求 ⊙O 的半径`,
        `求线段 OP 的长的平方`,
        `求四边形 PAOB 的面积`,
      ],
      answers: [`半径 = ${r}`, `OP² = ${opSq}`, `面积 = ${quadArea}`],
      answer: `（1）半径 = ${r}；（2）OP² = ${opSq}；（3）面积 = ${quadArea}`,
      givens: [
        `PA、PB 分别与 ⊙O 相切于点 A、B`,
        `∠APB = ${rightAngle}°`,
        `PA = ${t}`,
      ],
      solution: [
        `连接 OA，则 OA ⊥ PA；由切线长定理 PA = PB，OP 平分 ∠APB，所以 ∠APO = 45°，OA = PA = ${r}`,
        `Rt△OAP 中 OP² = OA² + PA² = ${r}² + ${t}² = ${opSq}`,
        `四边形 PAOB 由两个全等的直角三角形拼成，面积 = 2 × 1/2 × ${t} × ${r} = ${quadArea}`,
      ],
      steps: [
        { text: `半径 = ${r}`, basis: "切线长定理与等腰直角三角形" },
        { text: `OP² = ${opSq}`, basis: "勾股定理" },
        { text: `面积 = ${quadArea}`, basis: "三角形面积公式" },
      ],
      checks: [
        { expr: "opSq - r*r - t*t", at: { opSq, r, t }, expect: 0 },
        { expr: "quadArea - t*r", at: { quadArea, t, r }, expect: 0 },
        { expr: "r - t", at: { r, t }, expect: 0 },
      ],
    };
  }

  const pairs = [[2, 6, 8], [4, 8, 6], [3, 9, 12], [6, 12, 9], [2, 4, 3], [5, 15, 20], [3, 6, 4.5], [4, 12, 16]];
  const pv = pairs[idx % pairs.length];
  const b = pv[0], c = pv[1], r = pv[2];
  const OP = b + r;
  const triArea = (r * c) / 2;
  return {
    params: { b, c, r, OP, triArea },
    stem: `如图，AB 是 ⊙O 的直径，点 C 在 ⊙O 上，过点 C 的切线交 AB 的延长线于点 P，PB = ${b}，PC = ${c}。`,
    goal: `求半径 求 OP 的长 求三角形面积`,
    goals: [
      `求 ⊙O 的半径`,
      `求线段 OP 的长`,
      `求 △POC 的面积`,
    ],
    answers: [`半径 = ${frac(r)}`, `OP = ${frac(OP)}`, `S△POC = ${frac(triArea)}`],
    answer: `（1）半径 = ${frac(r)}；（2）OP = ${frac(OP)}；（3）S△POC = ${frac(triArea)}`,
    givens: [
      `AB 是 ⊙O 的直径`,
      `过点 C 的切线交 AB 的延长线于点 P`,
      `PB = ${b}，PC = ${c}`,
    ],
    solution: [
      `由切割线定理 PC² = PB×PA，即 ${c}² = ${b}×(${b} + 2r)，解得 r = ${frac(r)}`,
      `OP = OB + BP = ${frac(r)} + ${b} = ${frac(OP)}`,
      `OC ⊥ PC，△POC 的面积 = 1/2 × OC × PC = 1/2 × ${frac(r)} × ${c} = ${frac(triArea)}`,
    ],
    steps: [
      { text: `半径 = ${frac(r)}`, basis: "切割线定理" },
      { text: `OP = ${frac(OP)}`, basis: "线段的和差" },
      { text: `S△POC = ${frac(triArea)}`, basis: "切线的性质与三角形面积公式" },
    ],
    checks: [
      { expr: "c*c - b*(b+2*r)", at: { c, b, r }, expect: 0 },
      { expr: "b + r - OP", at: { b, r, OP }, expect: 0 },
      { expr: "r*c/2 - triArea", at: { r, c, triArea }, expect: 0 },
    ],
  };
}
