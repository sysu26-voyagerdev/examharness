export const kind = "answer/quadrilateral";
export const covers = ["四边形与特殊平行四边形", "四边形与证明"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779e1, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
function n3(a, b, c) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b + "\uff1b\uff083\uff09" + c; }
const TRI = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [7, 24, 25], [10, 24, 26]];

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const t = pick(r, TRI);
    const a = t[0], b = t[1], hyp = t[2];
    const area = a * b;
    return {
      params: { mode: 0, a: a, b: b, hyp: hyp, area: area, triArea: area / 2 },
      stem: "在矩形 $ABCD$ 中，$AB=" + a + "$\uff0c$BC=" + b + "$。\n（1）求对角线 $AC$ 的长；\n（2）求矩形 $ABCD$ 的面积；\n（3）求 $\u25b3ABC$ 的面积。",
      answer: n3("AC=" + hyp, "\u9762\u79ef " + area, "\u9762\u79ef " + (area / 2)),
      goal: "用矩形的性质与勾股定理求对角线和面积",
      goals: ["求对角线 $AC$ 的长", "求矩形 $ABCD$ 的面积", "求 $\u25b3ABC$ 的面积"],
      givens: ["在矩形 $ABCD$ 中", "$AB=" + a + "$", "$BC=" + b + "$"],
      solution: [
        "因为 $ABCD$ 是矩形，所以 $\u2220B=90^{\u00b0}$，$AC=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + hyp + "$",
        "矩形面积 $=AB\\times BC=" + a + "\\times " + b + "=" + area + "$",
        "$\u25b3ABC$ 的面积 $=\\dfrac{1}{2}\\times " + a + "\\times " + b + "=" + (area / 2) + "$"
      ],
      steps: [
        { text: "矩形的四个角都是直角，用勾股定理求对角线", basis: "矩形的性质与勾股定理" },
        { text: "矩形面积等于邻边之积", basis: "矩形的面积公式" },
        { text: "直角三角形面积等于两直角边积的一半", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "a^2+b^2", at: { a: a, b: b }, expect: hyp * hyp },
        { expr: "a*b", at: { a: a, b: b }, expect: area },
        { expr: "a*b/2", at: { a: a, b: b }, expect: area / 2 }
      ]
    };
  }

  if (mode === 1) {
    const t = pick(r, TRI);
    const e = 2 * t[0], f = 2 * t[1], side = t[2];
    const area = e * f / 2;
    const small = e * f / 8;
    return {
      params: { mode: 1, e: e, f: f, side: side, area: area, small: small, half: e / 2, half2: f / 2 },
      stem: "在菱形 $ABCD$ 中，对角线 $AC=" + e + "$\uff0c$对角线 $BD=" + f + "$，两条对角线交于点 $O$。\n（1）求菱形 $ABCD$ 的边长；\n（2）求菱形 $ABCD$ 的面积；\n（3）求 $\u25b3AOB$ 的面积。",
      answer: n3("\u8fb9\u957f " + side, "\u9762\u79ef " + area, "\u9762\u79ef " + small),
      goal: "用菱形的对角线互相垂直平分求边长与面积",
      goals: ["求菱形的边长", "求菱形的面积", "求 $\u25b3AOB$ 的面积"],
      givens: [
        "在菱形 $ABCD$ 中",
        "对角线 $AC=" + e + "$",
        "对角线 $BD=" + f + "$",
        "两条对角线交于点 $O$"
      ],
      solution: [
        "菱形的对角线互相垂直平分，$AO=" + (e / 2) + "$\uff0c$BO=" + (f / 2) + "$\uff0c$\u2220AOB=90^{\u00b0}$",
        "边长 $AB=\\sqrt{" + (e / 2) + "^{2}+" + (f / 2) + "^{2}}=" + side + "$",
        "菱形面积 $=\\dfrac{1}{2}\\times " + e + "\\times " + f + "=" + area + "$",
        "$\u25b3AOB$ 的面积 $=\\dfrac{1}{2}\\times " + (e / 2) + "\\times " + (f / 2) + "=" + small + "$"
      ],
      steps: [
        { text: "菱形的对角线互相垂直平分，用勾股定理求边长", basis: "菱形的性质与勾股定理" },
        { text: "菱形面积等于两条对角线积的一半", basis: "菱形的面积公式" },
        { text: "用两条对角线的一半作直角边求面积", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "half*half+half2*half2", at: { half: e / 2, half2: f / 2 }, expect: side * side },
        { expr: "e*f/2", at: { e: e, f: f }, expect: area },
        { expr: "e*f/8", at: { e: e, f: f }, expect: small }
      ]
    };
  }

  if (mode === 2) {
    const a = ri(r, 3, 12), h = ri(r, 2, 8);
    const area = a * h;
    const cands = [2, 3, 4, 5, 6, 8].filter(function (v) { return area % v === 0; });
    const b = pick(r, cands);
    const h2 = area / b;
    return {
      params: { mode: 2, a: a, h: h, b: b, h2: h2, area: area, per: 2 * (a + b) },
      stem: "在平行四边形 $ABCD$ 中，边 $AB=" + a + "$\uff0c$边 $BC=" + b + "$\uff0c$AB$ 边上的高为 " + h + "$。\n（1）求平行四边形 $ABCD$ 的面积；\n（2）求 $BC$ 边上的高；\n（3）求平行四边形 $ABCD$ 的周长。",
      answer: n3("\u9762\u79ef " + area, "\u9ad8 " + h2, "\u5468\u957f " + (2 * (a + b))),
      goal: "用平行四边形的面积公式求高与周长",
      goals: ["求平行四边形的面积", "求 $BC$ 边上的高", "求平行四边形的周长"],
      givens: [
        "在平行四边形 $ABCD$ 中",
        "边 $AB=" + a + "$",
        "边 $BC=" + b + "$",
        "$AB$ 边上的高为 " + h
      ],
      solution: [
        "面积 $=AB\\times h=" + a + "\\times " + h + "=" + area + "$",
        "又面积 $=BC\\times BC$ 边上的高，所以 $BC$ 边上的高 $=" + area + "\\div " + b + "=" + h2 + "$",
        "周长 $=2\\times(" + a + "+" + b + ")=" + (2 * (a + b)) + "$"
      ],
      steps: [
        { text: "用底乘高求面积", basis: "平行四边形的面积公式" },
        { text: "用同一个面积除以另一条底", basis: "平行四边形的面积公式" },
        { text: "平行四边形对边相等", basis: "平行四边形的性质" }
      ],
      checks: [
        { expr: "a*h", at: { a: a, h: h }, expect: area },
        { expr: "area/b", at: { area: area, b: b }, expect: h2 },
        { expr: "2*(a+b)", at: { a: a, b: b }, expect: 2 * (a + b) }
      ]
    };
  }

  const a = ri(r, 4, 12), al = ri(r, 4, 15) * 10;
  return {
    params: { mode: 3, a: a, alpha: al, other: 180 - al, per: 4 * a },
    stem: "在四边形 $ABCD$ 中，$AB=BC=CD=DA=" + a + "$\uff0c$\u2220A=" + al + "^{\u00b0}$。\n（1）判断四边形 $ABCD$ 的形状；\n（2）求四边形 $ABCD$ 的周长；\n（3）求 $\u2220C$ 的度数。",
    answer: n3("\u56db\u8fb9\u5f62 $ABCD$ \u662f\u83f1\u5f62", "\u5468\u957f " + (4 * a), "\u2220C \u7684\u5ea6\u6570\u4e3a " + al),
    goal: "由四边相等判断菱形，并用菱形的性质求周长与角",
    goals: ["判断四边形 $ABCD$ 的形状", "求四边形 $ABCD$ 的周长", "求 $\u2220C$ 的度数"],
    givens: ["在四边形 $ABCD$ 中", "$AB=BC=CD=DA=" + a + "$", "$\u2220A=" + al + "^{\u00b0}$"],
    solution: [
      "四边都相等的四边形是菱形，所以四边形 $ABCD$ 是菱形",
      "周长 $=4\\times " + a + "=" + (4 * a) + "$",
      "菱形的对角相等，所以 $\u2220C=\u2220A=" + al + "^{\u00b0}$"
    ],
    steps: [
      { text: "四边相等的四边形是菱形", basis: "菱形的判定" },
      { text: "菱形四边相等", basis: "菱形的性质" },
      { text: "菱形的对角相等", basis: "菱形的性质" }
    ],
    checks: [
      { expr: "4*a", at: { a: a }, expect: 4 * a },
      { expr: "180-alpha", at: { alpha: al }, expect: 180 - al }
    ]
  };
}
