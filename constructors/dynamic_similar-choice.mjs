export const kind = "dynamic/similar-choice";
export const covers = ["相似三角形"];

function mulberry(seed) {
  let a = (seed >>> 0) + 0x6D2B79F5;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function three(ans, cands) {
  const out = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (Number.isInteger(c) && c > 0 && c !== ans && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error("干扰项不足: ans=" + ans + " cands=" + cands.join(","));
  return out.map(String);
}

export function construct(slot, seed) {
  const rnd = mulberry(seed * 1664525 + 1013904223);
  const which = ((seed % 4) + 4) % 4;

  if (which === 0) {
    const m = pick(rnd, [3, 4, 5, 6, 7, 8, 9]);
    let n = pick(rnd, [2, 3, 4, 5, 6, 7]);
    while (n === m) { n = pick(rnd, [2, 3, 4, 5, 6, 7]); }
    const k = pick(rnd, [2, 3]);
    const DE = k * m, EF = k * n;
    return {
      params: { AB: m, BC: n, DE: DE, EF: EF, ratio: k },
      stem: "△ABC∽△DEF，AB=" + m + "，BC=" + n + "，DE=" + DE + "，则EF的长是（　）",
      answer: "EF=" + EF,
      stemTex: "\\triangle ABC\\sim\\triangle DEF,\\ AB=" + m + ",\\ BC=" + n + ",\\ DE=" + DE,
      answerTex: "EF=" + EF,
      goal: "求EF的长",
      givens: ["△ABC∽△DEF", "AB=" + m, "BC=" + n, "DE=" + DE],
      solution: [
        "相似三角形对应边成比例，AB/DE=BC/EF。",
        "AB/DE=" + m + "/" + DE + "=1/" + k + "，所以BC/EF=1/" + k + "。",
        "EF=" + k + "×" + n + "=" + EF + "。"
      ],
      steps: [
        { text: "相似比=" + m + "/" + DE + "=1/" + k, basis: "相似三角形对应边成比例" },
        { text: "EF=" + EF, basis: "对应边的比相等" }
      ],
      checks: [
        { expr: "AB*EF - DE*BC", at: { AB: m, EF: EF, DE: DE, BC: n }, expect: 0 },
        { expr: "DE - ratio*AB", at: { DE: DE, ratio: k, AB: m }, expect: 0 }
      ],
      distractors: three(EF, [n, DE, m, k * n + n, n + m, k * m + m, EF + 1, EF - 1, k * n + m])
    };
  }

  if (which === 1) {
    const pair = pick(rnd, [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5]]);
    const m = pair[0], n = pair[1];
    const t = pick(rnd, [2, 3, 4, 5]);
    const S = m * m * t;
    const S2 = n * n * t;
    return {
      params: { ratioNum: m, ratioDen: n, areaSmall: S, areaBig: S2 },
      stem: "△ABC∽△A′B′C′，相似比为" + m + "∶" + n + "。若△ABC的面积是" + S + "，则△A′B′C′的面积是（　）",
      answer: "面积=" + S2,
      stemTex: "\\frac{AB}{A'B'}=\\frac{" + m + "}{" + n + "},\\ S_{ABC}=" + S,
      answerTex: "S_{A'B'C'}=" + S2,
      goal: "求△A′B′C′的面积",
      givens: ["△ABC∽△A′B′C′", "相似比为" + m + "∶" + n, "△ABC的面积是" + S],
      solution: [
        "相似三角形面积的比等于相似比的平方。",
        "S△ABC∶S△A′B′C′=" + m + "²∶" + n + "²=" + (m * m) + "∶" + (n * n) + "。",
        "S△A′B′C′=" + S + "×" + (n * n) + "/" + (m * m) + "=" + S2 + "。"
      ],
      steps: [
        { text: "面积比=" + (m * m) + "∶" + (n * n), basis: "相似三角形面积比等于相似比的平方" },
        { text: "S△A′B′C′=" + S2, basis: "代入计算" }
      ],
      checks: [
        { expr: "areaBig*ratioNum*ratioNum - areaSmall*ratioDen*ratioDen", at: { areaBig: S2, ratioNum: m, areaSmall: S, ratioDen: n }, expect: 0 }
      ],
      distractors: three(S2, [S * n / m, S * m / n, S * n * n / m, S2 + m, S2 - m, S * n, S2 * m, S + n * n, S2 + 1, S2 - 1])
    };
  }

  if (which === 2) {
    const pair = pick(rnd, [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5]]);
    const m = pair[0], n = pair[1];
    const t = pick(rnd, [2, 3, 4, 5, 6]);
    const C = m * t;
    const C2 = n * t;
    return {
      params: { ratioNum: m, ratioDen: n, perSmall: C, perBig: C2 },
      stem: "△ABC∽△A′B′C′，相似比为" + m + "∶" + n + "。若△ABC的周长是" + C + "，则△A′B′C′的周长是（　）",
      answer: "周长=" + C2,
      stemTex: "\\frac{AB}{A'B'}=\\frac{" + m + "}{" + n + "},\\ C_{ABC}=" + C,
      answerTex: "C_{A'B'C'}=" + C2,
      goal: "求△A′B′C′的周长",
      givens: ["△ABC∽△A′B′C′", "相似比为" + m + "∶" + n, "△ABC的周长是" + C],
      solution: [
        "相似三角形周长的比等于相似比。",
        "C△A′B′C′=" + C + "×" + n + "/" + m + "=" + C2 + "。"
      ],
      steps: [
        { text: "周长比=相似比=" + m + "∶" + n, basis: "相似三角形周长的比等于相似比" },
        { text: "C△A′B′C′=" + C2, basis: "代入计算" }
      ],
      checks: [
        { expr: "perBig*ratioNum - perSmall*ratioDen", at: { perBig: C2, ratioNum: m, perSmall: C, ratioDen: n }, expect: 0 }
      ],
      distractors: three(C2, [C + n, C * m / n, C, C * n * n / m, C + m, C * n, C2 - m, C2 + 1, C2 - 1])
    };
  }

  const a = pick(rnd, [2, 3, 4, 5]);
  const b = pick(rnd, [3, 4, 5, 6, 7]);
  const t = pick(rnd, [2, 3, 4, 5]);
  const AD = a, DB = b, AE = a * t, EC = b * t;
  const AB = AD + DB, AC = AE + EC;
  return {
    params: { AD: AD, DB: DB, AE: AE, EC: EC, AB: AB, AC: AC },
    stem: "在△ABC中，点D在AB上，点E在AC上，DE∥BC。若AD=" + AD + "，DB=" + DB + "，AE=" + AE + "，则EC的长是（　）",
    answer: "EC=" + EC,
    stemTex: "DE\\parallel BC,\\ AD=" + AD + ",\\ DB=" + DB + ",\\ AE=" + AE,
    answerTex: "EC=" + EC,
    goal: "求EC的长",
    givens: ["在△ABC中，点D在AB上，点E在AC上", "DE∥BC", "AD=" + AD, "DB=" + DB, "AE=" + AE],
    solution: [
      "DE∥BC，所以△ADE∽△ABC，AD/AB=AE/AC。",
      "AB=AD+DB=" + AB + "，所以" + AD + "/" + AB + "=" + AE + "/AC，解得AC=" + AC + "。",
      "EC=AC-AE=" + AC + "-" + AE + "=" + EC + "。"
    ],
    steps: [
      { text: "△ADE∽△ABC", basis: "平行于三角形一边的直线和其他两边相交，所构成的三角形与原三角形相似" },
      { text: "AD/AB=AE/AC，得AC=" + AC, basis: "相似三角形对应边成比例" },
      { text: "EC=" + EC, basis: "EC=AC-AE" }
    ],
    checks: [
      { expr: "AD*AC - AE*AB", at: { AD: AD, AC: AC, AE: AE, AB: AB }, expect: 0 },
      { expr: "AB - AD - DB", at: { AB: AB, AD: AD, DB: DB }, expect: 0 }
    ],
    distractors: three(EC, [DB, b, AE, AD, DB + t, AE + DB, a * t, EC + 1, EC - 1])
  };
}
