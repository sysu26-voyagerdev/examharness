export const kind = "dynamic/quad-calc-s21";
export const covers = ["四边形与证明", "四边形与特殊平行四边形"];

function pick(arr, k) {
  const i = ((k % arr.length) + arr.length) % arr.length;
  return arr[i];
}

function step(text, basis) { return { text, basis }; }

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) || 1;
  const mode = s % 3;
  const k = Math.floor(s / 3);

  if (mode === 0) {
    const pair = pick([[3, 4], [6, 8], [5, 12], [9, 12], [8, 15]], k);
    const m = pair[0], n = pair[1];
    const ac = 2 * m, bd = 2 * n;
    const side = Math.sqrt(m * m + n * n);
    const area = 2 * m * n;
    return {
      params: { 对角线AC: ac, 对角线BD: bd, 边长: side, 面积: area, m: m, n: n },
      stem: "已知四边形 $ABCD$ 是菱形，它的两条对角线 $AC$ 与 $BD$ 相交于点 $O$，且 $AC=" + ac + "$，$BD=" + bd + "$。\n（1）求菱形 $ABCD$ 的边长；\n（2）求菱形 $ABCD$ 的面积。",
      answer: "（1）菱形 ABCD 的边长=" + side + "；（2）菱形 ABCD 的面积=" + area,
      goal: "求菱形 ABCD 的边长 求菱形 ABCD 的面积",
      goals: ["求菱形 ABCD 的边长", "求菱形 ABCD 的面积"],
      givens: ["四边形 ABCD 是菱形", "对角线 AC 与 BD 相交于点 O", "AC=" + ac, "BD=" + bd],
      solution: [
        "菱形的对角线互相垂直平分，所以 $AO=\\frac{1}{2}AC=" + m + "$，$BO=\\frac{1}{2}BD=" + n + "$，且 $\\angle AOB=90^\\circ$。",
        "在 $\\mathrm{Rt}\\triangle AOB$ 中，$AB=\\sqrt{AO^{2}+BO^{2}}=\\sqrt{" + m + "^{2}+" + n + "^{2}}=" + side + "$。",
        "菱形面积等于两条对角线乘积的一半，$S=\\frac{1}{2}\\times " + ac + "\\times " + bd + "=" + area + "$。"
      ],
      steps: [
        step("由对角线互相垂直平分得 $AO=" + m + "$，$BO=" + n + "$", "菱形的对角线互相垂直平分"),
        step("$AB=\\sqrt{AO^{2}+BO^{2}}=" + side + "$", "勾股定理"),
        step("$S=\\frac{1}{2}AC\\cdot BD=" + area + "$", "菱形面积公式")
      ],
      checks: [
        { expr: "side*side - (m*m + n*n)", at: { side: side, m: m, n: n }, expect: 0 },
        { expr: "area - 2*m*n", at: { area: area, m: m, n: n }, expect: 0 }
      ]
    };
  }

  if (mode === 1) {
    const pair = pick([[3, 8], [5, 8], [8, 15], [15, 24]], k);
    const a = pair[0], b = pair[1];
    const angA = 60;
    const bd2 = a * a + b * b - a * b;
    const bd = Math.sqrt(bd2);
    const coef = a * b / 2;
    const area2 = 3 * a * a * b * b / 4;
    return {
      params: { AB: a, AD: b, 角A: angA, 对角线BD: bd, 面积系数: coef, 面积平方: area2 },
      stem: "在平行四边形 $ABCD$ 中，$AB=" + a + "$，$AD=" + b + "$，$\\angle A=" + angA + "^\\circ$。\n（1）求对角线 $BD$ 的长；\n（2）求平行四边形 $ABCD$ 的面积。",
      answer: "（1）BD=" + bd + "；（2）平行四边形 ABCD 的面积=" + coef + "\\sqrt{3}",
      goal: "求对角线 BD 的长 求平行四边形 ABCD 的面积",
      goals: ["求对角线 BD 的长", "求平行四边形 ABCD 的面积"],
      givens: ["四边形 ABCD 是平行四边形", "AB=" + a, "AD=" + b, "∠A=" + angA + "°"],
      solution: [
        "在 $\\triangle ABD$ 中，由余弦定理 $BD^{2}=AB^{2}+AD^{2}-2\\cdot AB\\cdot AD\\cos " + angA + "^\\circ=" + a + "^{2}+" + b + "^{2}-" + a + "\\times " + b + "=" + bd2 + "$，所以 $BD=" + bd + "$。",
        "过 $D$ 作 $AB$ 边上的高，这条高等于 $AD\\sin " + angA + "^\\circ=" + b + "\\times\\frac{\\sqrt{3}}{2}$，所以 $S=" + a + "\\times " + b + "\\times\\frac{\\sqrt{3}}{2}=" + coef + "\\sqrt{3}$。"
      ],
      steps: [
        step("$BD^{2}=AB^{2}+AD^{2}-2AB\\cdot AD\\cos " + angA + "^\\circ=" + bd2 + "$", "余弦定理"),
        step("$BD=" + bd + "$", "开平方"),
        step("$S=AB\\cdot AD\\sin " + angA + "^\\circ=" + coef + "\\sqrt{3}$", "平行四边形面积公式")
      ],
      checks: [
        { expr: "bd*bd - (a*a + b*b - a*b)", at: { bd: bd, a: a, b: b }, expect: 0 },
        { expr: "area2 - 3*a*a*b*b/4", at: { area2: area2, a: a, b: b }, expect: 0 }
      ]
    };
  }

  const pair = pick([[6, 8], [9, 12], [5, 12], [8, 15], [12, 16]], k);
  const a = pair[0], b = pair[1];
  const diag = Math.sqrt(a * a + b * b);
  const tri = a * b / 4;
  return {
    params: { AB: a, BC: b, 对角线AC: diag, 三角形面积: tri },
    stem: "在矩形 $ABCD$ 中，$AB=" + a + "$，$BC=" + b + "$，对角线 $AC$ 与 $BD$ 相交于点 $O$。\n（1）求对角线 $AC$ 的长；\n（2）求 $\\triangle OBC$ 的面积。",
    answer: "（1）AC=" + diag + "；（2）△OBC 的面积=" + tri,
    goal: "求对角线 AC 的长 求三角形 OBC 的面积",
    goals: ["求对角线 AC 的长", "求△OBC 的面积"],
    givens: ["四边形 ABCD 是矩形", "AB=" + a, "BC=" + b, "对角线 AC 与 BD 相交于点 O"],
    solution: [
      "矩形四个角都是直角，在 $\\mathrm{Rt}\\triangle ABC$ 中，$AC=\\sqrt{AB^{2}+BC^{2}}=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + diag + "$。",
      "矩形的两条对角线把矩形分成四个面积相等的三角形，$S_{\\triangle OBC}=\\frac{1}{4}S_{ABCD}=\\frac{1}{4}\\times " + a + "\\times " + b + "=" + tri + "$。"
    ],
    steps: [
      step("$AC=\\sqrt{AB^{2}+BC^{2}}=" + diag + "$", "勾股定理"),
      step("$S_{\\triangle OBC}=\\frac{1}{4}AB\\cdot BC=" + tri + "$", "矩形对角线把矩形分成四个等面积三角形")
    ],
    checks: [
      { expr: "diag*diag - (a*a + b*b)", at: { diag: diag, a: a, b: b }, expect: 0 },
      { expr: "4*tri - a*b", at: { tri: tri, a: a, b: b }, expect: 0 }
    ]
  };
}
