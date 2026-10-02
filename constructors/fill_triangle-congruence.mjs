export const kind = "fill/triangle-congruence";
export const covers = ["三角形与全等"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x27d4eb2f, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
const BLANK = "\uff08  \uff09";

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const a = ri(r, 3, 12), b = ri(r, 3, 12), c = ri(r, 3, 12);
    if (a + b <= c || a + c <= b || b + c <= a) {
      return construct(slot, seed + 7919);
    }
    const per = a + b + c;
    return {
      params: { mode: 0, a: a, b: b, c: c, perimeter: per },
      stem: "已知 $\u25b3ABC \u224c \u25b3DEF$，$AB=" + a + "$\uff0c$BC=" + b + "$\uff0c$AC=" + c + "$，则 $\u25b3DEF$ 的周长是" + BLANK + "。",
      answer: String(per),
      goal: "用全等三角形对应边相等求周长",
      goals: ["求 $\u25b3DEF$ 的周长"],
      givens: ["$\u25b3ABC \u224c \u25b3DEF$，且 $AB=" + a + "$\uff0c$BC=" + b + "$\uff0c$AC=" + c + "$"],
      solution: [
        "全等三角形对应边相等：$DE=AB=" + a + "$\uff0c$EF=BC=" + b + "$\uff0c$DF=AC=" + c + "$",
        "周长 $=" + a + "+" + b + "+" + c + "=" + per + "$"
      ],
      steps: [{ text: "由全等得三组对应边相等", basis: "全等三角形的性质" }],
      checks: [{ expr: "a+b+c", at: { a: a, b: b, c: c }, expect: per }]
    };
  }

  if (mode === 1) {
    const a = ri(r, 4, 15), b = ri(r, 3, 12);
    if (a + a <= b) return construct(slot, seed + 7907);
    const per = 2 * a + b;
    return {
      params: { mode: 1, a: a, b: b, perimeter: per, base: b },
      stem: "在 $\u25b3ABC$ 中，$AB=AC=" + a + "$\uff0c$BC=" + b + "$，则 $\u25b3ABC$ 的周长是" + BLANK + "。",
      answer: String(per),
      goal: "用等腰三角形两腰相等求周长",
      goals: ["求 $\u25b3ABC$ 的周长"],
      givens: ["在 $\u25b3ABC$ 中，$AB=AC=" + a + "$\uff0c$BC=" + b + "$"],
      solution: [
        "$AB=AC=" + a + "$，所以周长 $=" + a + "+" + a + "+" + b + "=" + per + "$"
      ],
      steps: [{ text: "等腰三角形两腰相等，再把三边相加", basis: "等腰三角形的性质" }],
      checks: [{ expr: "2*a+b", at: { a: a, b: b }, expect: per }]
    };
  }

  if (mode === 2) {
    const a = ri(r, 3, 10), b = ri(r, 3, 10);
    const lo = Math.abs(a - b), hi = a + b;
    const mx = hi - 1;
    return {
      params: { mode: 2, a: a, b: b, lower: lo, upper: hi, maxInt: mx },
      stem: "一个三角形的两边长分别是 " + a + " 和 " + b + "，若第三边的长是整数，则第三边的长的最大值是" + BLANK + "。",
      answer: String(mx),
      goal: "用三角形三边关系求第三边的范围",
      goals: ["求第三边长的最大值"],
      givens: ["三角形的两边长分别是 " + a + " 和 " + b + "，第三边的长是整数"],
      solution: [
        "设第三边为 $x$，由三边关系 $" + lo + "<x<" + hi + "$",
        "整数 $x$ 的最大值是 " + mx
      ],
      steps: [{ text: "两边之差小于第三边，两边之和大于第三边", basis: "三角形三边关系" }],
      checks: [
        { expr: "a+b", at: { a: a, b: b }, expect: hi },
        { expr: "a+b-1", at: { a: a, b: b }, expect: mx }
      ]
    };
  }

  const al = ri(r, 3, 12) * 10, be = ri(r, 2, 11) * 10;
  const ga = 180 - al - be;
  return {
    params: { mode: 3, alpha: al, beta: be, gamma: ga },
    stem: "在 $\u25b3ABC$ 中，$\u2220A=" + al + "^{\u00b0}$\uff0c$\u2220B=" + be + "^{\u00b0}$，则 $\u2220C$ 的度数是" + BLANK + "。",
    answer: String(ga),
    goal: "用三角形内角和求第三个角",
    goals: ["求 $\u2220C$ 的度数"],
    givens: ["在 $\u25b3ABC$ 中，$\u2220A=" + al + "^{\u00b0}$，$\u2220B=" + be + "^{\u00b0}$"],
    solution: [
      "三角形内角和为 $180^{\u00b0}$",
      "$\u2220C=180^{\u00b0}-" + al + "^{\u00b0}-" + be + "^{\u00b0}=" + ga + "^{\u00b0}$"
    ],
    steps: [{ text: "用内角和减去两个已知角", basis: "三角形内角和定理" }],
    checks: [{ expr: "180-alpha-beta", at: { alpha: al, beta: be }, expect: ga }]
  };
}
