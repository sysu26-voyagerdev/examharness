export const kind = "dynamic/circle-property-choice";
export const covers = ["圆的性质"];

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
    if (c !== ans && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error("干扰项不足: ans=" + ans + " cands=" + cands.join(","));
  return out.map(String);
}

const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25]];

export function construct(slot, seed) {
  const rnd = mulberry(seed * 1103515245 + 17);
  const which = ((seed % 4) + 4) % 4;

  if (which === 0) {
    const half = pick(rnd, [20, 25, 35, 40, 50, 55, 65, 70]);
    const full = 2 * half;
    return {
      params: { angleAOB: full, angleACB: half },
      stem: "点A、B、C都在⊙O上，点C在优弧AB上，∠AOB=" + full + "°，则∠ACB的度数是（　）",
      answer: "∠ACB=" + half + "°",
      stemTex: "A,B,C\\in\\odot O,\\ \\angle AOB=" + full + "^\\circ",
      answerTex: "\\angle ACB=" + half + "^\\circ",
      goal: "求∠ACB的度数",
      givens: ["点A、B、C都在⊙O上", "点C在优弧AB上", "∠AOB=" + full + "°"],
      solution: [
        "∠ACB与∠AOB对着同一段弧AB。",
        "同弧所对的圆周角等于圆心角的一半，∠ACB=∠AOB÷2=" + half + "°。"
      ],
      steps: [
        { text: "∠ACB=∠AOB÷2", basis: "圆周角定理" },
        { text: "∠ACB=" + half + "°", basis: "代入计算" }
      ],
      checks: [
        { expr: "angleAOB - 2*angleACB", at: { angleAOB: full, angleACB: half }, expect: 0 }
      ],
      distractors: three(half + "°", [full + "°", (180 - half) + "°", (90 - half) + "°", (180 - full) + "°"])
    };
  }

  if (which === 1) {
    const t = pick(rnd, TRIPLES);
    const p = t[0], q = t[1], h = t[2];
    const R = h, chord = 2 * p;
    return {
      params: { radius: R, chord: chord, distance: q },
      stem: "⊙O的半径为" + R + "，弦AB的长为" + chord + "，作OC⊥AB于点C，则OC的长是（　）",
      answer: "OC=" + q,
      stemTex: "R=" + R + ",\\ AB=" + chord + ",\\ OC\\perp AB",
      answerTex: "OC=" + q,
      goal: "求OC的长",
      givens: ["⊙O的半径为" + R, "弦AB的长为" + chord, "OC⊥AB于点C"],
      solution: [
        "OC⊥AB，由垂径定理，AC=AB÷2=" + p + "。",
        "在Rt△AOC中，OC=√(OA²-AC²)=√(" + R + "²-" + p + "²)=" + q + "。"
      ],
      steps: [
        { text: "AC=" + p, basis: "垂径定理：垂直于弦的直径平分弦" },
        { text: "OC=" + q, basis: "勾股定理" }
      ],
      checks: [
        { expr: "radius*radius - (chord/2)*(chord/2) - distance*distance", at: { radius: R, chord: chord, distance: q }, expect: 0 }
      ],
      distractors: three(q, [p, R, 2 * q, R - p, chord])
    };
  }

  if (which === 2) {
    const a = pick(rnd, [70, 80, 100, 110, 60, 120]);
    const c = 180 - a;
    return {
      params: { angleA: a, angleC: c },
      stem: "四边形ABCD内接于⊙O，∠A=" + a + "°，则∠C的度数是（　）",
      answer: "∠C=" + c + "°",
      stemTex: "ABCD\\ \\text{内接于}\\odot O,\\ \\angle A=" + a + "^\\circ",
      answerTex: "\\angle C=" + c + "^\\circ",
      goal: "求∠C的度数",
      givens: ["四边形ABCD内接于⊙O", "∠A=" + a + "°"],
      solution: [
        "圆内接四边形的对角互补，∠A+∠C=180°。",
        "∠C=180°-" + a + "°=" + c + "°。"
      ],
      steps: [
        { text: "∠A+∠C=180°", basis: "圆内接四边形对角互补" },
        { text: "∠C=" + c + "°", basis: "代入计算" }
      ],
      checks: [
        { expr: "angleA + angleC - 180", at: { angleA: a, angleC: c }, expect: 0 }
      ],
      distractors: three(c + "°", [a + "°", (2 * a) + "°", (360 - a) + "°", (90 - a) + "°", (180 - 2 * a) + "°"])
    };
  }

  const t1 = pick(rnd, [30, 35, 40, 45, 50, 55]);
  const t2 = pick(rnd, [50, 55, 60, 65, 70, 75]);
  const t3 = 180 - t1 - t2;
  return {
    params: { angleBAC: t1, angleABC: t2, angleACB: t3 },
    stem: "点A、B、C都在⊙O上，∠BAC=" + t1 + "°，∠ABC=" + t2 + "°，则∠ACB的度数是（　）",
    answer: "∠ACB=" + t3 + "°",
    stemTex: "\\angle BAC=" + t1 + "^\\circ,\\ \\angle ABC=" + t2 + "^\\circ",
    answerTex: "\\angle ACB=" + t3 + "^\\circ",
    goal: "求∠ACB的度数",
    givens: ["点A、B、C都在⊙O上", "∠BAC=" + t1 + "°", "∠ABC=" + t2 + "°"],
    solution: [
      "在△ABC中，三个内角的和是180°。",
      "∠ACB=180°-" + t1 + "°-" + t2 + "°=" + t3 + "°。"
    ],
    steps: [
      { text: "∠ACB=180°-∠BAC-∠ABC", basis: "三角形内角和定理" },
      { text: "∠ACB=" + t3 + "°", basis: "代入计算" }
    ],
    checks: [
      { expr: "angleBAC + angleABC + angleACB - 180", at: { angleBAC: t1, angleABC: t2, angleACB: t3 }, expect: 0 }
    ],
    distractors: three(t3 + "°", [(t1 + t2) + "°", (180 - t1) + "°", (180 - t2) + "°", (t1 + t2 + 90) + "°"])
  };
}
