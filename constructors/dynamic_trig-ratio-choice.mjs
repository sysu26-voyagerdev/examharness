export const kind = "dynamic/trig-ratio-choice";
export const covers = ["锐角三角函数"];

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

const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29], [9, 40, 41]];

export function construct(slot, seed) {
  const rnd = mulberry(seed * 22695477 + 91);
  const which = ((seed % 4) + 4) % 4;

  if (which === 3) {
    const t = pick(rnd, TRIPLES);
    const p = t[0], q = t[1], h = t[2];
    const k = pick(rnd, [2, 3, 4]);
    const AB = k * h;
    const BC = k * p;
    return {
      params: { sinNum: p, sinDen: h, AB: AB, BC: BC, scale: k },
      stem: "在Rt△ABC中，∠C=90°，sin A=" + p + "/" + h + "，AB=" + AB + "，则BC的长是（　）",
      answer: "BC=" + BC,
      stemTex: "\\angle C=90^\\circ,\\ \\sin A=\\frac{" + p + "}{" + h + "},\\ AB=" + AB,
      answerTex: "BC=" + BC,
      goal: "求BC的长",
      givens: ["在Rt△ABC中", "∠C=90°", "sin A=" + p + "/" + h, "AB=" + AB],
      solution: [
        "在Rt△ABC中，∠C=90°，sin A=BC/AB。",
        "BC=AB·sin A=" + AB + "×" + p + "/" + h + "=" + BC + "。"
      ],
      steps: [
        { text: "sin A=BC/AB", basis: "正弦的定义" },
        { text: "BC=" + AB + "×" + p + "/" + h + "=" + BC, basis: "代入计算" }
      ],
      checks: [
        { expr: "BC*sinDen - AB*sinNum", at: { BC: BC, sinDen: h, AB: AB, sinNum: p }, expect: 0 }
      ],
      distractors: three(BC, [k * q, AB, AB - BC, BC + k * q, k * h])
    };
  }

  const t = pick(rnd, TRIPLES);
  const p = t[0], q = t[1], h = t[2];

  if (which === 0) {
    return {
      params: { opposite: p, adjacent: q, hypotenuse: h, sinNum: p, sinDen: h },
      stem: "在Rt△ABC中，∠C=90°，BC=" + p + "，AC=" + q + "，则sin A的值是（　）",
      answer: "sin A=" + p + "/" + h,
      stemTex: "\\angle C=90^\\circ,\\ BC=" + p + ",\\ AC=" + q,
      answerTex: "\\sin A=\\frac{" + p + "}{" + h + "}",
      goal: "求sin A的值",
      givens: ["在Rt△ABC中", "∠C=90°", "BC=" + p, "AC=" + q],
      solution: [
        "先由勾股定理求斜边：AB=√(BC²+AC²)=√(" + p + "²+" + q + "²)=" + h + "。",
        "sin A=BC/AB=" + p + "/" + h + "。"
      ],
      steps: [
        { text: "AB=" + h, basis: "勾股定理" },
        { text: "sin A=" + p + "/" + h, basis: "正弦的定义：对边比斜边" }
      ],
      checks: [
        { expr: "opposite*opposite + adjacent*adjacent - hypotenuse*hypotenuse", at: { opposite: p, adjacent: q, hypotenuse: h }, expect: 0 },
        { expr: "sinNum*hypotenuse - opposite*sinDen", at: { sinNum: p, hypotenuse: h, opposite: p, sinDen: h }, expect: 0 }
      ],
      distractors: three(p + "/" + h, [q + "/" + h, p + "/" + q, q + "/" + p, h + "/" + p])
    };
  }

  if (which === 1) {
    return {
      params: { opposite: p, adjacent: q, hypotenuse: h, cosNum: q, cosDen: h },
      stem: "在Rt△ABC中，∠C=90°，BC=" + p + "，AC=" + q + "，则cos A的值是（　）",
      answer: "cos A=" + q + "/" + h,
      stemTex: "\\angle C=90^\\circ,\\ BC=" + p + ",\\ AC=" + q,
      answerTex: "\\cos A=\\frac{" + q + "}{" + h + "}",
      goal: "求cos A的值",
      givens: ["在Rt△ABC中", "∠C=90°", "BC=" + p, "AC=" + q],
      solution: [
        "由勾股定理，AB=√(" + p + "²+" + q + "²)=" + h + "。",
        "cos A=AC/AB=" + q + "/" + h + "。"
      ],
      steps: [
        { text: "AB=" + h, basis: "勾股定理" },
        { text: "cos A=" + q + "/" + h, basis: "余弦的定义：邻边比斜边" }
      ],
      checks: [
        { expr: "opposite*opposite + adjacent*adjacent - hypotenuse*hypotenuse", at: { opposite: p, adjacent: q, hypotenuse: h }, expect: 0 },
        { expr: "cosNum*hypotenuse - adjacent*cosDen", at: { cosNum: q, hypotenuse: h, adjacent: q, cosDen: h }, expect: 0 }
      ],
      distractors: three(q + "/" + h, [p + "/" + h, p + "/" + q, q + "/" + p, h + "/" + q])
    };
  }

  return {
    params: { opposite: p, adjacent: q, hypotenuse: h, tanNum: p, tanDen: q },
    stem: "在Rt△ABC中，∠C=90°，BC=" + p + "，AC=" + q + "，则tan A的值是（　）",
    answer: "tan A=" + p + "/" + q,
    stemTex: "\\angle C=90^\\circ,\\ BC=" + p + ",\\ AC=" + q,
    answerTex: "\\tan A=\\frac{" + p + "}{" + q + "}",
    goal: "求tan A的值",
    givens: ["在Rt△ABC中", "∠C=90°", "BC=" + p, "AC=" + q],
    solution: [
      "在Rt△ABC中，∠C=90°，∠A的对边是BC，邻边是AC。",
      "tan A=BC/AC=" + p + "/" + q + "。"
    ],
    steps: [
      { text: "tan A=BC/AC", basis: "正切的定义：对边比邻边" },
      { text: "tan A=" + p + "/" + q, basis: "代入计算" }
    ],
    checks: [
      { expr: "tanNum*adjacent - opposite*tanDen", at: { tanNum: p, adjacent: q, opposite: p, tanDen: q }, expect: 0 }
    ],
    distractors: three(p + "/" + q, [q + "/" + p, p + "/" + h, q + "/" + h, h + "/" + p])
  };
}
