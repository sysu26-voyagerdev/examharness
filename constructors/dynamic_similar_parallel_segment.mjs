export const kind = "dynamic/similar_parallel_segment";
export const covers = ["相似三角形"];

const CASES = [
  { AD: 3, DB: 2, DE: 6 },
  { AD: 2, DB: 3, DE: 4 },
  { AD: 4, DB: 2, DE: 6 },
  { AD: 3, DB: 6, DE: 3 },
  { AD: 5, DB: 3, DE: 10 }
];

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed));
  const t = CASES[s % CASES.length];
  const AD = t.AD, DB = t.DB, DE = t.DE, AB = AD + DB;
  const BC = (DE * AB) / AD;
  const base = [BC, BC - AD, BC - DB, BC + AD];
  const uniq = [];
  for (let i = 0; i < base.length; i++) {
    if (uniq.indexOf(base[i]) < 0) uniq.push(base[i]);
  }
  let extra = 1;
  while (uniq.length < 4) {
    const cand = BC + extra * AB;
    if (uniq.indexOf(cand) < 0) uniq.push(cand);
    extra = extra + 1;
  }
  const idx = s % 4;
  const letter = ["A", "B", "C", "D"][idx];
  const opts = [0, 1, 2, 3].map(function (i) { return uniq[(i - idx + 4) % 4]; });
  const stem = "在△ABC 中，点 D、E 分别在边 AB、AC 上，DE∥BC。若 AD = " + AD + "，DB = " + DB + "，DE = " + DE + "，则 BC 的长为（　　）\nA．" + opts[0] + "　B．" + opts[1] + "　C．" + opts[2] + "　D．" + opts[3];
  return {
    params: { AD: AD, DB: DB, DE: DE, AB: AB, BC: BC },
    stem: stem,
    answer: letter + "（BC = " + BC + "）",
    answerTex: String(BC),
    solution: [
      "∵ DE∥BC，∴ △ADE ∽ △ABC。",
      "∴ AD/AB = DE/BC，即 BC = DE·AB/AD。",
      "AB = AD + DB = " + AD + " + " + DB + " = " + AB + "。",
      "∴ BC = " + DE + "×" + AB + "/" + AD + " = " + BC + "，故选 " + letter + "。"
    ],
    steps: [
      { text: "DE∥BC 推出 △ADE ∽ △ABC", basis: "平行于三角形一边的直线和其他两边相交，所截得的三角形与原三角形相似" },
      { text: "相似三角形对应边成比例：AD/AB = DE/BC", basis: "相似三角形的对应线段成比例" },
      { text: "由 AD、DB 求 AB，代入比例式求 BC", basis: "比例式求解" }
    ],
    checks: [
      { expr: "DE*(AD+DB) - AD*BC", at: { DE: DE, AD: AD, DB: DB, BC: BC }, expect: 0 },
      { expr: "(BC-DE)*AD - DB*DE", at: { BC: BC, DE: DE, AD: AD, DB: DB }, expect: 0 }
    ]
  };
}
