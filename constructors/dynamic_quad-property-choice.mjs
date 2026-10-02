export const kind = "dynamic/quad-property-choice";
export const covers = ["四边形与特殊平行四边形"];

function mulberry(seed) {
  let a = (seed >>> 0) + 0x6D2B79F5;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ri(rnd, lo, hi) { return lo + Math.floor(rnd() * (hi - lo + 1)); }
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20]];

export function construct(slot, seed) {
  const rnd = mulberry(seed * 1013904223 + 7);
  const which = ((seed % 4) + 4) % 4;

  if (which === 0) {
    const a = pick(rnd, [4, 6, 8, 10, 12, 14, 16, 18]);
    const ans = 2 * a;
    return {
      params: { AB: a, angleAOB: 60, AC: ans },
      stem: "四边形ABCD是矩形，对角线AC与BD相交于点O，∠AOB=60°，AB=" + a + "，则对角线AC的长是（　）",
      answer: "AC=" + ans,
      stemTex: "AB=" + a + ",\\ \\angle AOB=60^\\circ",
      answerTex: "AC=" + ans,
      goal: "求矩形对角线AC的长",
      givens: ["四边形ABCD是矩形", "对角线AC与BD相交于点O", "∠AOB=60°", "AB=" + a],
      solution: [
        "矩形的对角线相等且互相平分，所以OA=OB=OC=OD。",
        "在△AOB中，OA=OB，∠AOB=60°，所以△AOB是等边三角形，OA=AB=" + a + "。",
        "AC=2OA=" + ans + "。"
      ],
      steps: [
        { text: "OA=OB，∠AOB=60°，故△AOB为等边三角形", basis: "矩形对角线互相平分且相等" },
        { text: "OA=AB=" + a, basis: "等边三角形三边相等" },
        { text: "AC=2OA=" + ans, basis: "O是AC的中点" }
      ],
      checks: [
        { expr: "AC - 2*AB", at: { AC: ans, AB: a }, expect: 0 },
        { expr: "AB - AC/2", at: { AC: ans, AB: a }, expect: 0 }
      ],
      distractors: [String(a), String(3 * a), String(4 * a)]
    };
  }

  if (which === 1) {
    const t = pick(rnd, TRIPLES);
    const p = t[0], q = t[1], h = t[2];
    const d1 = 2 * p, d2 = 2 * q, per = 4 * h;
    return {
      params: { perimeter: per, diagonalAC: d1, diagonalBD: d2 },
      stem: "四边形ABCD是菱形，它的周长为" + per + "，对角线AC=" + d1 + "，则对角线BD的长是（　）",
      answer: "BD=" + d2,
      stemTex: "C_{ABCD}=" + per + ",\\ AC=" + d1,
      answerTex: "BD=" + d2,
      goal: "求菱形的另一条对角线BD的长",
      givens: ["四边形ABCD是菱形", "菱形的周长为" + per, "对角线AC=" + d1],
      solution: [
        "菱形四条边相等，边长AB=" + per + "÷4=" + h + "。",
        "菱形的对角线互相垂直平分，设AC与BD交于点O，则AO=AC÷2=" + p + "。",
        "在直角三角形AOB中，BO=√(AB²-AO²)=√(" + h + "²-" + p + "²)=" + q + "。",
        "所以BD=2BO=" + d2 + "。"
      ],
      steps: [
        { text: "边长=" + per + "/4=" + h, basis: "菱形四边相等" },
        { text: "AO=" + p + "，对角线互相垂直", basis: "菱形对角线互相垂直平分" },
        { text: "BO=" + q + "，BD=" + d2, basis: "勾股定理" }
      ],
      checks: [
        { expr: "diagonalAC*diagonalAC + diagonalBD*diagonalBD - perimeter*perimeter/4", at: { diagonalAC: d1, diagonalBD: d2, perimeter: per }, expect: 0 },
        { expr: "diagonalBD - 2*BO", at: { diagonalBD: d2, BO: q }, expect: 0 }
      ],
      distractors: [String(d1), String(per / 2), String(q)]
    };
  }

  if (which === 2) {
    const a = ri(rnd, 5, 15);
    let b = ri(rnd, 3, 12);
    while (b === a || b === 2 * a || a === 2 * b) { b = ri(rnd, 3, 12); }
    const per = 2 * (a + b);
    return {
      params: { perimeter: per, AB: a, BC: b },
      stem: "平行四边形ABCD的周长为" + per + "，AB=" + a + "，则BC的长是（　）",
      answer: "BC=" + b,
      stemTex: "C_{ABCD}=" + per + ",\\ AB=" + a,
      answerTex: "BC=" + b,
      goal: "求平行四边形的邻边BC的长",
      givens: ["四边形ABCD是平行四边形", "平行四边形的周长为" + per, "AB=" + a],
      solution: [
        "平行四边形对边相等，所以AB=CD，BC=AD。",
        "周长=2(AB+BC)=" + per + "，所以AB+BC=" + (per / 2) + "。",
        "BC=" + (per / 2) + "-" + a + "=" + b + "。"
      ],
      steps: [
        { text: "AB+BC=" + per + "/2=" + (per / 2), basis: "平行四边形周长=2(AB+BC)" },
        { text: "BC=" + (per / 2) + "-" + a + "=" + b, basis: "平行四边形对边相等" }
      ],
      checks: [
        { expr: "2*AB + 2*BC - perimeter", at: { AB: a, BC: b, perimeter: per }, expect: 0 }
      ],
      distractors: [String(a), String(per / 2), String(2 * a)]
    };
  }

  const t = pick(rnd, TRIPLES);
  const a = t[0], b = t[1], h = t[2];
  return {
    params: { AB: a, BC: b, AC: h },
    stem: "四边形ABCD是矩形，AB=" + a + "，BC=" + b + "，则对角线AC的长是（　）",
    answer: "AC=" + h,
    stemTex: "AB=" + a + ",\\ BC=" + b,
    answerTex: "AC=" + h,
    goal: "求矩形的对角线AC的长",
    givens: ["四边形ABCD是矩形", "AB=" + a, "BC=" + b],
    solution: [
      "矩形的四个角都是直角，所以△ABC是直角三角形，∠B=90°。",
      "由勾股定理，AC²=AB²+BC²=" + a + "²+" + b + "²=" + (a * a + b * b) + "。",
      "所以AC=" + h + "。"
    ],
    steps: [
      { text: "∠ABC=90°", basis: "矩形的四个角都是直角" },
      { text: "AC²=" + (a * a + b * b), basis: "勾股定理" },
      { text: "AC=" + h, basis: "算术平方根" }
    ],
    checks: [
      { expr: "AB*AB + BC*BC - AC*AC", at: { AB: a, BC: b, AC: h }, expect: 0 }
    ],
    distractors: [String(a + b), String(Math.abs(b - a)), String(2 * b)]
  };
}
