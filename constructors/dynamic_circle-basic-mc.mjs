export const kind = "dynamic/circle-basic-mc";
export const covers = ["圆的基本性质"];

export function construct(slot, seed) {
  const T = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20], [20, 21, 29]];
  const BS = String.fromCharCode(92);
  const R3 = BS + "sqrt{3}";
  const T3 = BS + "triangle";
  const CIR = "\\odot O".split("").join("").replace("\\", String.fromCharCode(92));
  let st = (Math.abs(Math.floor(seed)) % 2000000000) + 7;
  const rnd = function (n) {
    st = (st * 1103515245 + 12345) % 2147483648;
    return Math.floor(st / 65536) % n;
  };
  const variant = rnd(4);
  const trip = T[rnd(T.length)];
  const hc = trip[0];
  const dd = trip[1];
  const rr = trip[2];

  if (variant === 0) {
    return {
      params: { r: rr, halfChord: hc, chord: 2 * hc, distance: dd },
      stem: "在 $" + CIR + "$ 中，弦 $AB$ 的长为 " + (2 * hc) + "，$" + CIR + "$ 的半径为 " + rr + "，则圆心 $O$ 到弦 $AB$ 的距离为（　）",
      answer: "" + dd,
      distractors: ["" + hc, "" + (rr - hc), "" + rr],
      goal: "求圆心 O 到弦 AB 的距离",
      goals: ["求圆心 $O$ 到弦 $AB$ 的距离"],
      givens: ["弦 $AB$ 的长为 " + (2 * hc), "$" + CIR + "$ 的半径为 " + rr],
      solution: [
        "作 $OC$ ⊥ $AB$ 于 $C$，由垂径定理得 $AC=BC=" + hc + "$。",
        "在 Rt$" + T3 + "$ $AOC$ 中，$OC=" + BS + "sqrt{" + rr + "^{2}-" + hc + "^{2}}=" + dd + "$。"
      ],
      steps: [
        { text: "$OC$ ⊥ $AB$ 得 $AC=BC=" + hc + "$。", basis: "垂径定理" },
        { text: "由勾股定理得 $OC=" + dd + "$。", basis: "勾股定理" }
      ],
      checks: [
        { expr: "distance*distance + halfChord*halfChord - r*r", at: { distance: dd, halfChord: hc, r: rr }, expect: 0 },
        { expr: "chord*chord/4 + distance*distance - r*r", at: { chord: 2 * hc, distance: dd, r: rr }, expect: 0 }
      ]
    };
  }

  if (variant === 1) {
    return {
      params: { r: rr, distance: dd, halfChord: hc, chord: 2 * hc },
      stem: "$" + CIR + "$ 的半径为 " + rr + "，圆心 $O$ 到弦 $AB$ 的距离为 " + dd + "，则弦 $AB$ 的长为（　）",
      answer: "" + (2 * hc),
      distractors: ["" + hc, "" + (2 * dd), "" + (rr - dd)],
      goal: "求弦 AB 的长",
      goals: ["求弦 $AB$ 的长"],
      givens: ["$" + CIR + "$ 的半径为 " + rr, "圆心 $O$ 到弦 $AB$ 的距离为 " + dd],
      solution: [
        "作 $OC$ ⊥ $AB$ 于 $C$，在 Rt$" + T3 + "$ $AOC$ 中，$AC=" + BS + "sqrt{" + rr + "^{2}-" + dd + "^{2}}=" + hc + "$。",
        "由垂径定理得 $AB=2AC=" + (2 * hc) + "$。"
      ],
      steps: [
        { text: "由勾股定理得 $AC=" + hc + "$。", basis: "勾股定理" },
        { text: "$OC$ ⊥ $AB$ 得 $AB=2AC=" + (2 * hc) + "$。", basis: "垂径定理" }
      ],
      checks: [
        { expr: "halfChord*halfChord + distance*distance - r*r", at: { halfChord: hc, distance: dd, r: rr }, expect: 0 },
        { expr: "ans*ans/4 + distance*distance - r*r", at: { ans: 2 * hc, distance: dd, r: rr }, expect: 0 }
      ]
    };
  }

  if (variant === 2) {
    return {
      params: { distance: dd, halfChord: hc, chord: 2 * hc, r: rr },
      stem: "在 $" + CIR + "$ 中，圆心 $O$ 到弦 $AB$ 的距离为 " + dd + "，弦 $AB$ 的长为 " + (2 * hc) + "，则 $" + CIR + "$ 的半径为（　）",
      answer: "" + rr,
      distractors: ["" + (dd + hc), "" + hc, "" + dd],
      goal: "求 ⊙O 的半径",
      goals: ["求 $" + CIR + "$ 的半径"],
      givens: ["圆心 $O$ 到弦 $AB$ 的距离为 " + dd, "弦 $AB$ 的长为 " + (2 * hc)],
      solution: [
        "作 $OC$ ⊥ $AB$ 于 $C$，由垂径定理得 $AC=" + hc + "$。",
        "在 Rt$" + T3 + "$ $AOC$ 中，$OA=" + BS + "sqrt{" + dd + "^{2}+" + hc + "^{2}}=" + rr + "$。"
      ],
      steps: [
        { text: "$OC$ ⊥ $AB$ 得 $AC=" + hc + "$。", basis: "垂径定理" },
        { text: "由勾股定理得半径 $OA=" + rr + "$。", basis: "勾股定理" }
      ],
      checks: [
        { expr: "r*r - distance*distance - halfChord*halfChord", at: { r: rr, distance: dd, halfChord: hc }, expect: 0 },
        { expr: "ans*ans - distance*distance - chord*chord/4", at: { ans: rr, distance: dd, chord: 2 * hc }, expect: 0 }
      ]
    };
  }

  const rad = [4, 6, 8][rnd(3)];
  const ang = [60, 120][rnd(2)];
  if (ang === 60) {
    return {
      params: { r: rad, angle: 60, abSq: rad * rad },
      stem: "点 $A$、$B$ 都在 $" + CIR + "$ 上，$" + CIR + "$ 的半径为 " + rad + "，∠$AOB$ = 60° ，则弦 $AB$ 的长为（　）",
      answer: "" + rad,
      distractors: ["" + (rad / 2), "" + (2 * rad), "" + rad + R3],
      goal: "求弦 AB 的长",
      goals: ["求弦 $AB$ 的长"],
      givens: ["点 $A$、$B$ 都在 $" + CIR + "$ 上", "$" + CIR + "$ 的半径为 " + rad, "∠$AOB$ = 60°"],
      solution: ["$OA=OB=" + rad + "$，∠$AOB$ = 60°，故 $" + T3 + "$ $AOB$ 是等边三角形，$AB=" + rad + "$。"],
      steps: [
        { text: "$OA=OB$，∠$AOB$ = 60°，得 $" + T3 + "$ $AOB$ 为等边三角形，$AB=" + rad + "$。", basis: "等边三角形的判定" }
      ],
      checks: [{ expr: "abSq - r*r", at: { abSq: rad * rad, r: rad }, expect: 0 }]
    };
  }
  return {
    params: { r: rad, angle: 120, abSq: 3 * rad * rad },
    stem: "点 $A$、$B$ 都在 $" + CIR + "$ 上，$" + CIR + "$ 的半径为 " + rad + "，∠$AOB$ = 120° ，则弦 $AB$ 的长为（　）",
    answer: "" + rad + R3,
    distractors: ["" + rad, "" + (rad / 2), "" + (2 * rad)],
    goal: "求弦 AB 的长",
    goals: ["求弦 $AB$ 的长"],
    givens: ["点 $A$、$B$ 都在 $" + CIR + "$ 上", "$" + CIR + "$ 的半径为 " + rad, "∠$AOB$ = 120°"],
    solution: [
      "作 $OC$ ⊥ $AB$ 于 $C$，则 ∠$AOC$ = 60°，$AC=" + rad + R3 + "/2$。",
      "由垂径定理得 $AB=2AC=" + rad + R3 + "$。"
    ],
    steps: [
      { text: "$OC$ ⊥ $AB$ 得 $AC=BC$，∠$AOC$ = 60°。", basis: "垂径定理" },
      { text: "含 60° 角的直角三角形三边比为 $1:" + R3 + ":2$，得 $AC=" + rad + R3 + "/2$，$AB=" + rad + R3 + "$。", basis: "含 60° 角的直角三角形的三边关系" }
    ],
    checks: [{ expr: "abSq - 3*r*r", at: { abSq: 3 * rad * rad, r: rad }, expect: 0 }]
  };
}
