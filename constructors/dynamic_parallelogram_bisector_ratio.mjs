export const kind = "dynamic/parallelogram_bisector_ratio";
export const covers = ["四边形与证明"];

const CASES = [
  { AB: 5, BC: 8 },
  { AB: 4, BC: 9 },
  { AB: 6, BC: 10 },
  { AB: 7, BC: 11 },
  { AB: 3, BC: 7 }
];

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed));
  const t = CASES[s % CASES.length];
  const AB = t.AB, BC = t.BC;
  const BE = AB, CE = BC - BE, CF = (CE * AB) / BE, DC = AB, DF = DC + CF;
  const stem = "在▱ABCD 中，AB = " + AB + "，BC = " + BC + "，∠BAD 的平分线 AE 交 BC 于点 E，交 DC 的延长线于点 F。\n(1) 求 BE 的长；\n(2) 求 CE 的长；\n(3) 求 DF 的长。";
  return {
    params: { AB: AB, BC: BC, BE: BE, CE: CE, CF: CF, DC: DC, DF: DF },
    stem: stem,
    answer: "(1) BE = " + BE + "；(2) CE = " + CE + "；(3) DF = " + DF,
    answerTex: "BE = " + BE + ",\\ CE = " + CE + ",\\ DF = " + DF,
    solution: [
      "(1) ∵ 四边形 ABCD 是平行四边形，∴ AD∥BC，DC∥AB。",
      "∴ ∠DAE = ∠BEA（两直线平行，内错角相等）。",
      "又 AE 平分 ∠BAD，∴ ∠BAE = ∠DAE，∴ ∠BAE = ∠BEA，∴ BE = AB = " + AB + "。",
      "(2) CE = BC − BE = " + BC + " − " + BE + " = " + CE + "。",
      "(3) ∵ CF∥AB（F 在 DC 的延长线上），∴ ∠FCE = ∠ABE，又 ∠CEF = ∠BEA（对顶角），",
      "∴ △FCE ∽ △ABE，∴ CF/AB = CE/BE = " + CE + "/" + BE + "，∴ CF = " + CF + "。",
      "∴ DF = DC + CF = " + DC + " + " + CF + " = " + DF + "。"
    ],
    steps: [
      { text: "平行四边形中 AD∥BC，得 ∠DAE = ∠BEA；结合角平分线得 ∠BAE = ∠BEA", basis: "两直线平行内错角相等；等角对等边" },
      { text: "BE = AB，再由 BC 减去 BE 得 CE", basis: "等腰三角形的判定；线段的和差" },
      { text: "CF∥AB 且 ∠CEF = ∠BEA，得 △FCE ∽ △ABE，由比例求 CF", basis: "两角分别相等的两个三角形相似；相似三角形对应边成比例" },
      { text: "DF = DC + CF", basis: "线段的和差关系" }
    ],
    checks: [
      { expr: "BE - AB", at: { BE: BE, AB: AB }, expect: 0 },
      { expr: "BE + CE - BC", at: { BE: BE, CE: CE, BC: BC }, expect: 0 },
      { expr: "CF*BE - CE*AB", at: { CF: CF, BE: BE, CE: CE, AB: AB }, expect: 0 },
      { expr: "DF - DC - CF", at: { DF: DF, DC: DC, CF: CF }, expect: 0 },
      { expr: "DC - AB", at: { DC: DC, AB: AB }, expect: 0 }
    ]
  };
}
