export const kind = "dynamic/similar-parallel-ratio";
export const covers = ["相似三角形"];

function rng(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647;
  if (s === 0) { s = 20240517; }
  return function () {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}
function pick(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export function construct(slot, seed) {
  const rand = rng(seed);
  const shape = Math.floor(rand() * 3);
  const base = pick(rand, 2, 6);

  if (shape === 0) {
    const k = pick(rand, 2, 5);
    const AD = base;
    const DB = base * (k - 1);
    const AB = AD + DB;
    const DE = pick(rand, 3, 9);
    const BC = DE * k;
    return {
      params: { AD: AD, DB: DB, AB: AB, DE: DE, BC: BC, k: k, shape: shape },
      stem: "如图，在 $\\triangle ABC$ 中，点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上，且 $DE\\parallel BC$。若 $AD=" + AD + "$，$DB=" + DB + "$，$DE=" + DE + "$，则 $BC$ 的长为（　　）",
      answer: "$" + BC + "$",
      distractors: ["$" + (DE * (k - 1)) + "$", "$" + (DE * (k + 1)) + "$", "$" + (DE + AB) + "$"],
      goal: "求线段 $BC$ 的长",
      goals: ["求线段 $BC$ 的长"],
      givens: ["点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上", "$DE\\parallel BC$", "$AD=" + AD + "$", "$DB=" + DB + "$", "$DE=" + DE + "$"],
      solution: ["由 $D$ 在 $AB$ 上得 $AB=AD+DB=" + AD + "+" + DB + "=" + AB + "$。", "因为 $DE\\parallel BC$，所以 $\\triangle ADE\\sim\\triangle ABC$，于是 $\\dfrac{DE}{BC}=\\dfrac{AD}{AB}$。", "所以 $BC=\\dfrac{DE\\cdot AB}{AD}=" + DE + "\\times " + k + "=" + BC + "$。"],
      steps: [
        { text: "$AB=AD+DB=" + AB + "$", basis: "线段的和" },
        { text: "$\\triangle ADE\\sim\\triangle ABC$", basis: "平行于三角形一边的直线截其他两边，所截得的三角形与原三角形相似" },
        { text: "$\\dfrac{DE}{BC}=\\dfrac{AD}{AB}$", basis: "相似三角形对应边成比例" },
        { text: "$BC=" + BC + "$", basis: "代入计算" }
      ],
      checks: [
        { expr: "DE*AB-AD*BC", at: { DE: DE, AB: AB, AD: AD, BC: BC }, expect: 0 },
        { expr: "DE*k-BC", at: { DE: DE, k: k, BC: BC }, expect: 0 }
      ]
    };
  }

  if (shape === 1) {
    const k = pick(rand, 2, 5);
    const AD = base;
    const DB = base * (k - 1);
    const AB = AD + DB;
    const AE = pick(rand, 3, 9);
    const AC = AE * k;
    return {
      params: { AD: AD, DB: DB, AB: AB, AE: AE, AC: AC, k: k, shape: shape },
      stem: "如图，在 $\\triangle ABC$ 中，点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上，且 $DE\\parallel BC$。若 $AD=" + AD + "$，$DB=" + DB + "$，$AE=" + AE + "$，则 $AC$ 的长为（　　）",
      answer: "$" + AC + "$",
      distractors: ["$" + (AE + AD) + "$", "$" + (AE * (k - 1)) + "$", "$" + (AC + AD) + "$"],
      goal: "求线段 $AC$ 的长",
      goals: ["求线段 $AC$ 的长"],
      givens: ["点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上", "$DE\\parallel BC$", "$AD=" + AD + "$", "$DB=" + DB + "$", "$AE=" + AE + "$"],
      solution: ["$AB=AD+DB=" + AD + "+" + DB + "=" + AB + "$。", "由 $DE\\parallel BC$ 得 $\\triangle ADE\\sim\\triangle ABC$，故 $\\dfrac{AE}{AC}=\\dfrac{AD}{AB}$。", "所以 $AC=\\dfrac{AE\\cdot AB}{AD}=" + AE + "\\times " + k + "=" + AC + "$。"],
      steps: [
        { text: "$AB=AD+DB=" + AB + "$", basis: "线段的和" },
        { text: "$\\triangle ADE\\sim\\triangle ABC$", basis: "平行于三角形一边的直线截其他两边，所截得的三角形与原三角形相似" },
        { text: "$\\dfrac{AE}{AC}=\\dfrac{AD}{AB}$", basis: "相似三角形对应边成比例" },
        { text: "$AC=" + AC + "$", basis: "代入计算" }
      ],
      checks: [
        { expr: "AE*AB-AD*AC", at: { AE: AE, AB: AB, AD: AD, AC: AC }, expect: 0 },
        { expr: "AC-AE*k", at: { AC: AC, AE: AE, k: k }, expect: 0 }
      ]
    };
  }

  const k = 2 + Math.floor(rand() * 2);
  const AD = base;
  const DB = base * (k - 1);
  const AB = AD + DB;
  const S = pick(rand, 2, 9);
  const Q = S * (k * k - 1);
  return {
    params: { AD: AD, DB: DB, AB: AB, S: S, Q: Q, k: k, shape: shape },
    stem: "如图，在 $\\triangle ABC$ 中，点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上，且 $DE\\parallel BC$。若 $AD\\!:\\!DB=1\\!:\\!" + (k - 1) + "$，$\\triangle ADE$ 的面积为 $" + S + "$，则四边形 $DBCE$ 的面积为（　　）",
    answer: "$" + Q + "$",
    distractors: ["$" + (S * k * k) + "$", "$" + (S * (k * k + 1)) + "$", "$" + (S * k) + "$"],
    goal: "求四边形 $DBCE$ 的面积",
    goals: ["求四边形 $DBCE$ 的面积"],
    givens: ["点 $D$ 在边 $AB$ 上，点 $E$ 在边 $AC$ 上", "$DE\\parallel BC$", "$AD:DB=1:" + (k - 1) + "$", "$\\triangle ADE$ 的面积为 $" + S + "$"],
    solution: ["由 $DE\\parallel BC$ 得 $\\triangle ADE\\sim\\triangle ABC$，相似比为 $\\dfrac{AD}{AB}=\\dfrac{1}{" + k + "}$。", "所以 $\\dfrac{S_{\\triangle ADE}}{S_{\\triangle ABC}}=\\left(\\dfrac{1}{" + k + "}\\right)^{2}=\\dfrac{1}{" + (k * k) + "}$，得 $S_{\\triangle ABC}=" + S + "\\times " + (k * k) + "=" + (S * k * k) + "$。", "故四边形 $DBCE$ 的面积为 $" + (S * k * k) + "-" + S + "=" + Q + "$。"],
    steps: [
      { text: "相似比为 $\\dfrac{AD}{AB}=\\dfrac{1}{" + k + "}$", basis: "由 $AD:DB=1:" + (k - 1) + "$ 得 $AB=" + k + "AD$" },
      { text: "$\\dfrac{S_{\\triangle ADE}}{S_{\\triangle ABC}}=\\dfrac{1}{" + (k * k) + "}$", basis: "相似三角形面积比等于相似比的平方" },
      { text: "$S_{\\triangle ABC}=" + (S * k * k) + "$", basis: "代入计算" },
      { text: "$S_{DBCE}=" + Q + "$", basis: "面积的和差" }
    ],
    checks: [
      { expr: "S*k*k-S-Q", at: { S: S, k: k, Q: Q }, expect: 0 },
      { expr: "AD*k-DB-AD", at: { AD: AD, k: k, DB: DB }, expect: 0 }
    ]
  };
}
