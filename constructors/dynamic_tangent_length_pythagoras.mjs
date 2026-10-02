export const kind = "dynamic/tangent_length_pythagoras";
export const covers = ["圆与切线"];

const CASES = [
  { r: 3, PA: 4, OP: 5 },
  { r: 6, PA: 8, OP: 10 },
  { r: 5, PA: 12, OP: 13 },
  { r: 8, PA: 15, OP: 17 },
  { r: 9, PA: 12, OP: 15 }
];

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed));
  const t = CASES[s % CASES.length];
  const r = t.r, PA = t.PA, OP = t.OP;
  const PB = PA, area = r * PA;
  const stem = "PA、PB 分别与 ⊙O 相切于点 A、B，连接 OA、OB、OP。若 ⊙O 的半径 OA = " + r + "，PA = " + PA + "。\n(1) 求 OP 的长；\n(2) 求 PB 的长；\n(3) 求四边形 OAPB 的面积。";
  return {
    params: { r: r, PA: PA, OP: OP, PB: PB, area: area },
    stem: stem,
    answer: "(1) OP = " + OP + "；(2) PB = " + PB + "；(3) 面积 = " + area,
    answerTex: "OP = " + OP + ",\\ PB = " + PB + ",\\ S = " + area,
    solution: [
      "(1) ∵ PA 是 ⊙O 的切线，A 为切点，∴ OA⊥PA，即 ∠OAP = 90°。",
      "在 Rt△OAP 中，OP² = OA² + PA² = " + r + "² + " + PA + "² = " + (r * r + PA * PA) + "，",
      "∴ OP = " + OP + "。",
      "(2) ∵ PA、PB 是 ⊙O 的两条切线，∴ PB = PA = " + PB + "（切线长相等）。",
      "(3) 由 ∠OAP = ∠OBP = 90°，OA = OB，OP = OP 得 Rt△OAP ≌ Rt△OBP，",
      "∴ S四边形OAPB = 2S△OAP = 2 × ½ × OA × PA = " + r + " × " + PA + " = " + area + "。"
    ],
    steps: [
      { text: "切线垂直于过切点的半径，得 ∠OAP = 90°", basis: "圆的切线的性质定理" },
      { text: "在 Rt△OAP 中用勾股定理求 OP", basis: "勾股定理" },
      { text: "由切线长定理得 PB = PA", basis: "切线长定理（过圆外一点的两条切线长相等）" },
      { text: "Rt△OAP ≌ Rt△OBP，把四边形面积化为两个直角三角形面积之和", basis: "HL 判定与全等三角形的性质；三角形面积公式" }
    ],
    checks: [
      { expr: "OP*OP - r*r - PA*PA", at: { OP: OP, r: r, PA: PA }, expect: 0 },
      { expr: "PB - PA", at: { PB: PB, PA: PA }, expect: 0 },
      { expr: "area - r*PA", at: { area: area, r: r, PA: PA }, expect: 0 }
    ]
  };
}
