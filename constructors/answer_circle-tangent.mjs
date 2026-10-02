export const kind = "answer/circle-tangent";
export const covers = ["圆与切线", "圆的性质"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x9e3779f1, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
function n2(a, b) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b; }
function n3(a, b, c) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b + "\uff1b\uff083\uff09" + c; }
const TRI = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25], [12, 16, 20]];

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const t = pick(r, TRI);
    const d = t[0], half = t[1], rad = t[2];
    const chord = 2 * half;
    const area = chord * d / 2;
    return {
      params: { mode: 0, r: rad, d: d, half: half, chord: chord, area: area },
      stem: "$\u2299O$ 的半径为 " + rad + "，弦 $AB$ 的长为 " + chord + "。\n（1）求圆心 $O$ 到弦 $AB$ 的距离；\n（2）求 $\u25b3OAB$ 的面积。",
      answer: n2("\u8ddd\u79bb " + d, "\u9762\u79ef " + area),
      goal: "用垂径定理和勾股定理求弦心距与三角形面积",
      goals: ["求圆心 $O$ 到弦 $AB$ 的距离", "求 $\u25b3OAB$ 的面积"],
      givens: ["$\u2299O$ 的半径为 " + rad + "，弦 $AB$ 的长为 " + chord],
      solution: [
        "作 $OC\u22a5AB$ 于 $C$，则 $AC=\\dfrac{1}{2}AB=" + half + "$",
        "在 $\u25b3OAC$ 中，$OC=\\sqrt{" + rad + "^{2}-" + half + "^{2}}=" + d + "$",
        "$\u25b3OAB$ 的面积 $=\\dfrac{1}{2}\\times " + chord + "\\times " + d + "=" + area + "$"
      ],
      steps: [
        { text: "垂直于弦的直径平分弦，得半弦长", basis: "垂径定理" },
        { text: "用勾股定理求弦心距", basis: "勾股定理" },
        { text: "以弦为底、弦心距为高求面积", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "half*half+d*d", at: { half: half, d: d }, expect: rad * rad },
        { expr: "chord*d/2", at: { chord: chord, d: d }, expect: area }
      ]
    };
  }

  if (mode === 1) {
    const t = pick(r, TRI);
    const rad = t[0], pa = t[1], op = t[2];
    const area = rad * pa / 2;
    const quad = rad * pa;
    return {
      params: { mode: 1, r: rad, pa: pa, op: op, area: area, quad: quad },
      stem: "点 $P$ 是 $\u2299O$ 外一点，$PA$ 切 $\u2299O$ 于点 $A$，$OP=" + op + "$\uff0c$\u2299O$ 的半径为 " + rad + "$。\n（1）求切线 $PA$ 的长；\n（2）求 $\u25b3OAP$ 的面积；\n（3）过点 $P$ 再作 $\u2299O$ 的切线 $PB$（$B$ 为切点），求四边形 $OAPB$ 的面积。",
      answer: n3("PA=" + pa, "\u9762\u79ef " + area, "\u9762\u79ef " + quad),
      goal: "用切线的性质与勾股定理求切线长和面积",
      goals: ["求切线 $PA$ 的长", "求 $\u25b3OAP$ 的面积", "求四边形 $OAPB$ 的面积"],
      givens: [
        "点 $P$ 是 $\u2299O$ 外一点",
        "$PA$ 切 $\u2299O$ 于点 $A$，$OP=" + op + "$",
        "$\u2299O$ 的半径为 " + rad,
        "$PB$ 切 $\u2299O$ 于点 $B$"
      ],
      solution: [
        "切线垂直于过切点的半径，所以 $\u2220OAP=90^{\u00b0}$",
        "$PA=\\sqrt{" + op + "^{2}-" + rad + "^{2}}=" + pa + "$",
        "$\u25b3OAP$ 的面积 $=\\dfrac{1}{2}\\times " + rad + "\\times " + pa + "=" + area + "$",
        "由切线长定理 $PB=PA$，四边形 $OAPB$ 的面积 $=2\\times " + area + "=" + quad + "$"
      ],
      steps: [
        { text: "切线垂直于过切点的半径", basis: "切线的性质" },
        { text: "在直角三角形中用勾股定理", basis: "勾股定理" },
        { text: "过圆外一点的两条切线长相等", basis: "切线长定理" }
      ],
      checks: [
        { expr: "rad*rad+pa*pa", at: { rad: rad, pa: pa }, expect: op * op },
        { expr: "rad*pa/2", at: { rad: rad, pa: pa }, expect: area },
        { expr: "rad*pa", at: { rad: rad, pa: pa }, expect: quad }
      ]
    };
  }

  if (mode === 2) {
    const al = ri(r, 8, 15) * 10;
    const half = al / 2;
    const other = 180 - half;
    return {
      params: { mode: 2, alpha: al, c1: half, c2: other },
      stem: "在 $\u2299O$ 中，$\u2220AOB=" + al + "^{\u00b0}$，点 $C$ 在优弧 $AB$ 上，点 $D$ 在劣弧 $AB$ 上。\n（1）求 $\u2220ACB$ 的度数；\n（2）求 $\u2220ADB$ 的度数。",
      answer: n2("\u2220ACB \u7684\u5ea6\u6570\u4e3a " + half, "\u2220ADB \u7684\u5ea6\u6570\u4e3a " + other),
      goal: "用同弧所对圆周角与圆心角的关系求角",
      goals: ["求 $\u2220ACB$ 的度数", "求 $\u2220ADB$ 的度数"],
      givens: [
        "在 $\u2299O$ 中，$\u2220AOB=" + al + "^{\u00b0}$",
        "点 $C$ 在优弧 $AB$ 上，点 $D$ 在劣弧 $AB$ 上"
      ],
      solution: [
        "同弧所对的圆周角等于圆心角的一半，$\u2220ACB=\\dfrac{1}{2}\\times " + al + "^{\u00b0}=" + half + "^{\u00b0}$",
        "因为 $A$，$C$，$B$，$D$ 四点共圆，圆内接四边形对角互补，$\u2220ADB=180^{\u00b0}-" + half + "^{\u00b0}=" + other + "^{\u00b0}$"
      ],
      steps: [
        { text: "同弧所对的圆周角等于圆心角的一半", basis: "圆周角定理" },
        { text: "圆内接四边形对角互补", basis: "圆内接四边形的性质" }
      ],
      checks: [
        { expr: "alpha/2", at: { alpha: al }, expect: half },
        { expr: "180-alpha/2", at: { alpha: al }, expect: other }
      ]
    };
  }

  const t = pick(r, TRI);
  const a = t[0], b = t[1], c = t[2];
  const rin = (a + b - c) / 2;
  const rout = c / 2;
  return {
    params: { mode: 3, a: a, b: b, c: c, rin: rin, rout: rout },
    stem: "在 $\u25b3ABC$ 中，$\u2220C=90^{\u00b0}$，$AC=" + a + "$\uff0c$BC=" + b + "$。\n（1）求 $AB$ 的长；\n（2）求 $\u25b3ABC$ 的内切圆的半径；\n（3）求 $\u25b3ABC$ 的外接圆的半径。",
    answer: n3("AB=" + c, "\u5185\u5207\u5706\u534a\u5f84 " + rin, "\u5916\u63a5\u5706\u534a\u5f84 " + rout),
    goal: "用勾股定理求斜边，并求直角三角形的内切圆与外接圆半径",
    goals: ["求 $AB$ 的长", "求 $\u25b3ABC$ 的内切圆的半径", "求 $\u25b3ABC$ 的外接圆的半径"],
    givens: [
      "在 $\u25b3ABC$ 中，$\u2220C=90^{\u00b0}$",
      "$AC=" + a + "$",
      "$BC=" + b + "$"
    ],
    solution: [
      "$AB=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + c + "$",
      "设内切圆半径为 $r$，则 $r=\\dfrac{AC+BC-AB}{2}=\\dfrac{" + a + "+" + b + "-" + c + "}{2}=" + rin + "$",
      "直角三角形的外接圆直径是斜边，所以半径 $=\\dfrac{" + c + "}{2}=" + rout + "$"
    ],
    steps: [
      { text: "用勾股定理求斜边", basis: "勾股定理" },
      { text: "直角三角形内切圆半径等于两直角边之和与斜边之差的一半", basis: "直角三角形的内切圆" },
      { text: "直角三角形外接圆的直径是斜边", basis: "圆周角定理的推论" }
    ],
    checks: [
      { expr: "a*a+b*b", at: { a: a, b: b }, expect: c * c },
      { expr: "(a+b-c)/2", at: { a: a, b: b, c: c }, expect: rin },
      { expr: "c/2", at: { c: c }, expect: rout }
    ]
  };
}
