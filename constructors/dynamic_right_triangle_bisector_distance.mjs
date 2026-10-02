export const kind = "dynamic/right_triangle_bisector_distance";
export const covers = ["三角形与全等"];

const CASES = [
  { BC: 8, BD: 5 },
  { BC: 10, BD: 6 },
  { BC: 12, BD: 7 },
  { BC: 15, BD: 8 },
  { BC: 9, BD: 4 }
];

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed));
  const t = CASES[s % CASES.length];
  const BC = t.BC, BD = t.BD, DC = BC - BD, DE = DC;
  const stem = "在△ABC 中，∠C = 90°，AD 平分 ∠BAC，交 BC 于点 D，DE⊥AB，垂足为 E。若 BC = " + BC + "，BD = " + BD + "，则 DE 的长为 ______。";
  return {
    params: { BC: BC, BD: BD, DC: DC, DE: DE },
    stem: stem,
    answer: String(DE),
    answerTex: String(DE),
    solution: [
      "∵ AD 平分 ∠BAC，∴ ∠EAD = ∠CAD。",
      "∵ ∠AED = ∠C = 90°，AD = AD，∴ △ADE ≌ △ADC（AAS），∴ DE = DC。",
      "DC = BC − BD = " + BC + " − " + BD + " = " + DC + "。",
      "∴ DE = " + DE + "。"
    ],
    steps: [
      { text: "角平分线给出 ∠EAD = ∠CAD，配合两个直角与公共边 AD", basis: "角平分线的意义" },
      { text: "△ADE ≌ △ADC，从而 DE = DC", basis: "AAS 判定与全等三角形对应边相等" },
      { text: "DC = BC − BD，代入得 DE", basis: "线段的和差关系" }
    ],
    checks: [
      { expr: "DE + BD - BC", at: { DE: DE, BD: BD, BC: BC }, expect: 0 },
      { expr: "DE - DC", at: { DE: DE, DC: DC }, expect: 0 }
    ]
  };
}
