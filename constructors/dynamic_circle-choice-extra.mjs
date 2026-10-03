export const kind = "dynamic/circle-choice-extra";
export const covers = ["圆的性质"];

const TRIPLES = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25], [12, 16, 20], [10, 24, 26], [20, 21, 29], [15, 20, 25]];
const ANG_A = [65, 70, 75, 80, 85, 95, 100, 105, 110, 115, 120, 125];
const RADII = [4, 5, 6, 7, 8, 9, 10, 12, 14, 15];

function rnd(seed, k, n) {
  let x = (Math.abs(Math.trunc(seed)) % 2147483647 + k * 7919 + 1) % 2147483647;
  x = (x * 48271) % 2147483647;
  return x % n;
}

function pick3(cands, ansStr) {
  const out = [];
  for (let i = 0; i < cands.length; i = i + 1) {
    const s = String(cands[i]);
    if (s !== ansStr && Number(s) > 0 && out.indexOf(s) === -1) out.push(s);
  }
  let k = 1;
  while (out.length < 3 && k < 60) {
    const s = String(Number(ansStr) + k);
    if (s !== ansStr && out.indexOf(s) === -1) out.push(s);
    k = k + 1;
  }
  return out.slice(0, 3);
}

export function construct(slot, seed) {
  const sub = rnd(seed, 1, 3);

  if (sub === 0) {
    const t = TRIPLES[rnd(seed, 2, TRIPLES.length)];
    const hc = t[0];
    const d = t[1];
    const R = t[2];
    const ask = rnd(seed, 3, 2);
    if (ask === 0) {
      const chord = 2 * hc;
      return {
        params: { R: R, chord: chord, d: d },
        stem: "⊙O 的半径为 " + R + "，弦 AB 的长为 " + chord + "，则圆心 O 到弦 AB 的距离是（　）",
        answer: String(d),
        goal: "求圆心 O 到弦 AB 的距离",
        goals: ["求圆心 O 到弦 AB 的距离"],
        givens: ["⊙O 的半径为 " + R, "弦 AB 的长为 " + chord],
        distractors: pick3([hc, d + 1, d - 1, hc + 1], String(d)),
        solution: ["半径、半弦、弦心距构成直角三角形，半弦长为 " + hc + "，弦心距为 √(" + R + "²-" + hc + "²)=" + d + "。"],
        steps: [
          { text: "过点 O 作 OC⊥AB，垂足为 C，则 AC=" + chord + "÷2=" + hc + "。", basis: "垂径定理" },
          { text: "在 Rt△OAC 中，OC=√(OA²-AC²)=√(" + R + "²-" + hc + "²)=" + d + "。", basis: "勾股定理" }
        ],
        checks: [{ expr: "d*d+ac*ac-R*R", at: { d: d, ac: hc, R: R }, expect: 0 }]
      };
    }
    const chord = 2 * hc;
    return {
      params: { R: R, d: d, chord: chord },
      stem: "⊙O 的半径为 " + R + "，圆心 O 到弦 AB 的距离为 " + d + "，则弦 AB 的长是（　）",
      answer: String(chord),
      goal: "求弦 AB 的长",
      goals: ["求弦 AB 的长"],
      givens: ["⊙O 的半径为 " + R, "圆心 O 到弦 AB 的距离为 " + d],
      distractors: pick3([hc, 2 * d, 2 * R, d], String(chord)),
      solution: ["由勾股定理得半弦长为 √(" + R + "²-" + d + "²)=" + hc + "，所以弦 AB=2×" + hc + "=" + chord + "。"],
      steps: [
        { text: "过点 O 作 OC⊥AB，垂足为 C，则 AC=CB。", basis: "垂径定理" },
        { text: "在 Rt△OAC 中，AC=√(OA²-OC²)=√(" + R + "²-" + d + "²)=" + hc + "，所以 AB=2AC=" + chord + "。", basis: "勾股定理" }
      ],
      checks: [{ expr: "ac*ac+d*d-R*R", at: { ac: hc, d: d, R: R }, expect: 0 }]
    };
  }

  if (sub === 1) {
    const a = ANG_A[rnd(seed, 4, ANG_A.length)];
    const c = 180 - a;
    const wrong = a < 90 ? 2 * a : 360 - 2 * a;
    return {
      params: { angA: a, angC: c },
      stem: "四边形 ABCD 内接于 ⊙O，若 ∠A=" + a + "°，则 ∠C 的度数是（　）",
      answer: c + "°",
      goal: "求 ∠C 的度数",
      goals: ["求 ∠C 的度数"],
      givens: ["四边形 ABCD 内接于 ⊙O", "∠A=" + a + "°"],
      distractors: pick3([a + "°", "90°", wrong + "°"], c + "°"),
      solution: ["圆内接四边形的对角互补，所以 ∠C=180°-" + a + "°=" + c + "°。"],
      steps: [
        { text: "因为四边形 ABCD 内接于 ⊙O，所以 ∠A+∠C=180°。", basis: "圆内接四边形对角互补" },
        { text: "所以 ∠C=180°-" + a + "°=" + c + "°。", basis: "等式性质" }
      ],
      checks: [{ expr: "angA+angC-180", at: { angA: a, angC: c }, expect: 0 }]
    };
  }

  const R = RADII[rnd(seed, 5, RADII.length)];
  const extra = rnd(seed, 6, 7) + 2;
  const PO = R + extra;
  const askLong = rnd(seed, 7, 2) === 1;
  if (!askLong) {
    return {
      params: { R: R, PO: PO, dMin: extra },
      stem: "⊙O 的半径为 " + R + "，点 P 在 ⊙O 外，且 OP=" + PO + "，则点 P 到 ⊙O 上点的最短距离是（　）",
      answer: String(extra),
      goal: "求点 P 到 ⊙O 上点的最短距离",
      goals: ["求点 P 到 ⊙O 上点的最短距离"],
      givens: ["⊙O 的半径为 " + R, "点 P 在 ⊙O 外", "OP=" + PO],
      distractors: pick3([R, PO, extra + 1, R + 1], String(extra)),
      solution: ["点 P 与圆心 O 的连线与圆的交点中，靠近 P 的点到 P 的距离最短，为 OP-r=" + PO + "-" + R + "=" + extra + "。"],
      steps: [
        { text: "连接 PO，交 ⊙O 于点 A，则 PA=OP-OA=" + PO + "-" + R + "=" + extra + "。", basis: "两点之间线段最短" },
        { text: "所以点 P 到 ⊙O 上点的最短距离为 " + extra + "。", basis: "点到圆上点的最短距离" }
      ],
      checks: [{ expr: "PO-R-dMin", at: { PO: PO, R: R, dMin: extra }, expect: 0 }]
    };
  }
  const dMax = 2 * R + extra;
  return {
    params: { R: R, PO: PO, dMax: dMax },
    stem: "⊙O 的半径为 " + R + "，点 P 在 ⊙O 外，且 OP=" + PO + "，则点 P 到 ⊙O 上点的最长距离是（　）",
    answer: String(dMax),
    goal: "求点 P 到 ⊙O 上点的最长距离",
    goals: ["求点 P 到 ⊙O 上点的最长距离"],
    givens: ["⊙O 的半径为 " + R, "点 P 在 ⊙O 外", "OP=" + PO],
    distractors: pick3([PO, 2 * R, PO + 1, R + extra], String(dMax)),
    solution: ["直线 PO 与圆的两个交点中，与 P 在圆心两侧的那个点到 P 的距离最长，为 OP+r=" + PO + "+" + R + "=" + dMax + "。"],
    steps: [
      { text: "连接 PO 并延长交 ⊙O 于点 B，则 PB=PO+OB=" + PO + "+" + R + "=" + dMax + "。", basis: "点与圆的位置关系" },
      { text: "所以点 P 到 ⊙O 上点的最长距离为 " + dMax + "。", basis: "点到圆上点的最长距离" }
    ],
    checks: [{ expr: "PO+R-dMax", at: { PO: PO, R: R, dMax: dMax }, expect: 0 }]
  };
}
