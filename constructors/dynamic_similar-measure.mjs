export const kind = "dynamic/similar-measure";
export const covers = ["相似三角形"];

function rng(seed) {
  let s = (Math.floor(Math.abs(seed)) * 2654435761 + 1013904223) % 4294967296;
  if (s === 0) { s = 88675123; }
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
function pick(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export function construct(slot, seed) {
  const rand = rng(seed);
  rand(); rand();
  const shape = Math.floor(rand() * 5);
  const a = pick(rand, 2, 6);
  const m = pick(rand, 1, 3);
  const n = pick(rand, 2, 5);

  if (shape === 0) {
    const AD = a * m;
    const AB = a * (m + n);
    const DE = pick(rand, 3, 9);
    const BCv = (DE * (m + n)) / m;
    if (BCv !== Math.floor(BCv)) { return construct(slot, seed + 7); }
    return {
      params: { AD: AD, AB: AB, DE: DE, BC: BCv, shape: shape },
      stem: "在 $\\triangle ABC$ 中，点 $D$、$E$ 分别在边 $AB$、$AC$ 上，$DE\\parallel BC$。若 $AD=" + AD + "$，$AB=" + AB + "$，$DE=" + DE + "$，则 $BC$ 的长是（　　）",
      answer: "$" + BCv + "$",
      distractors: ["$" + (DE * (m + n)) + "$", "$" + (DE + AB - AD) + "$", "$" + (DE * (m + n) - DE) + "$"],
      goal: "求 $BC$ 的长",
      goals: ["求 $BC$ 的长"],
      givens: ["$D$、$E$ 分别在边 $AB$、$AC$ 上", "$DE\\parallel BC$", "$AD=" + AD + "$", "$AB=" + AB + "$", "$DE=" + DE + "$"],
      solution: ["由 $DE\\parallel BC$ 得 $\\triangle ADE\\sim\\triangle ABC$，相似比 $k=\\dfrac{AD}{AB}=\\dfrac{" + m + "}{" + (m + n) + "}$。", "所以 $\\dfrac{DE}{BC}=k$，$BC=\\dfrac{" + DE + "\\times " + (m + n) + "}{" + m + "}=" + BCv + "$。"],
      steps: [
        { text: "$\\triangle ADE\\sim\\triangle ABC$", basis: "平行三角形一边的直线截其他两边，截得的三角形与原三角形相似" },
        { text: "$\\dfrac{AD}{AB}=\\dfrac{" + m + "}{" + (m + n) + "}$", basis: "对应边成比例" },
        { text: "$BC=" + BCv + "$", basis: "相似三角形对应边成比例" }
      ],
      checks: [
        { expr: "DE*AB-AD*BC", at: { DE: DE, AB: AB, AD: AD, BC: BCv }, expect: 0 },
        { expr: "AD*" + (m + n) + "-AB*" + m, at: { AD: AD, AB: AB }, expect: 0 }
      ]
    };
  }

  if (shape === 1) {
    const q = n + 1;
    const t = pick(rand, 2, 12);
    const BC = q * t;
    const DE = t;
    return {
      params: { q: q, n: n, BC: BC, DE: DE, shape: shape },
      stem: "$D$、$E$ 是 $\\triangle ABC$ 的边 $AB$、$AC$ 上的点，且 $DE\\parallel BC$。若 $AD\\!:\\!DB=1\\!:\\!" + n + "$，$BC=" + BC + "$，则 $DE$ 的长是（　　）",
      answer: "$" + DE + "$",
      distractors: ["$" + (BC * q) + "$", "$" + (BC + DE) + "$", "$" + (BC - DE) + "$"],
      goal: "求 $DE$ 的长",
      goals: ["求 $DE$ 的长"],
      givens: ["$D$、$E$ 在边 $AB$、$AC$ 上", "$DE\\parallel BC$", "$AD:DB=1:" + n + "$", "$BC=" + BC + "$"],
      solution: ["由 $AD:DB=1:" + n + "$ 得 $AD:AB=1:" + q + "$。", "由 $DE\\parallel BC$ 得 $\\triangle ADE\\sim\\triangle ABC$，$\\dfrac{DE}{BC}=\\dfrac{AD}{AB}=\\dfrac{1}{" + q + "}$。", "所以 $DE=\\dfrac{" + BC + "}{" + q + "}=" + DE + "$。"],
      steps: [
        { text: "$AD:AB=1:" + q + "$", basis: "由 $AD:DB=1:" + n + "$ 得 $AB=AD+DB=(1+" + n + ")AD$" },
        { text: "$\\triangle ADE\\sim\\triangle ABC$，$\\dfrac{DE}{BC}=\\dfrac{1}{" + q + "}$", basis: "相似三角形对应边成比例" },
        { text: "$DE=" + DE + "$", basis: "代入计算" }
      ],
      checks: [
        { expr: "DE*q-BC", at: { DE: DE, q: q, BC: BC }, expect: 0 },
        { expr: "BC-(n+1)*DE", at: { BC: BC, n: n, DE: DE }, expect: 0 }
      ]
    };
  }

  if (shape === 2) {
    const AD = a;
    const DB = a * n;
    const k = n + 1;
    const S = pick(rand, 2, 9) * n;
    const Stot = S * k * k;
    const Q = Stot - S;
    return {
      params: { AD: AD, DB: DB, S: S, Stot: Stot, Q: Q, shape: shape },
      stem: "如图，$D$、$E$ 分别是 $\\triangle ABC$ 的边 $AB$、$AC$ 上的点，$DE\\parallel BC$。若 $AD=" + AD + "$，$DB=" + DB + "$，$\\triangle ADE$ 的面积是 $" + S + "$，则四边形 $DBCE$ 的面积是（　　）",
      answer: "$" + Q + "$",
      distractors: ["$" + Stot + "$", "$" + (S * n * n) + "$", "$" + (S + DB) + "$"],
      goal: "求四边形 $DBCE$ 的面积",
      goals: ["求四边形 $DBCE$ 的面积"],
      givens: ["$D$、$E$ 在边 $AB$、$AC$ 上", "$DE\\parallel BC$", "$AD=" + AD + "$", "$DB=" + DB + "$", "$\\triangle ADE$ 的面积是 $" + S + "$"],
      solution: ["$AB=" + AD + "+" + DB + "=" + (AD + DB) + "$，相似比 $k=\\dfrac{AD}{AB}=\\dfrac{1}{" + k + "}$。", "由 $DE\\parallel BC$ 得 $\\dfrac{S_{\\triangle ADE}}{S_{\\triangle ABC}}=k^{2}=\\dfrac{1}{" + (k * k) + "}$，所以 $S_{\\triangle ABC}=" + S + "\\times " + (k * k) + "=" + Stot + "$。", "四边形 $DBCE$ 的面积 $=" + Stot + "-" + S + "=" + Q + "$。"],
      steps: [
        { text: "$k=\\dfrac{AD}{AB}=\\dfrac{1}{" + k + "}$", basis: "线段的和与相似比的定义" },
        { text: "$\\dfrac{S_{\\triangle ADE}}{S_{\\triangle ABC}}=k^{2}$", basis: "相似三角形面积比等于相似比的平方" },
        { text: "$S_{DBCE}=" + Q + "$", basis: "面积的和差" }
      ],
      checks: [
        { expr: "Stot-S-Q", at: { Stot: Stot, S: S, Q: Q }, expect: 0 },
        { expr: "S*" + (k * k) + "-Stot", at: { S: S, Stot: Stot }, expect: 0 }
      ]
    };
  }

  if (shape === 3) {
    const AD = a;
    const AB = a * (n + 1);
    return {
      params: { AD: AD, AB: AB, shape: shape },
      stem: "在 $\\triangle ABC$ 中，点 $D$ 在边 $AB$ 上，过点 $D$ 作 $DE\\parallel BC$ 交 $AC$ 于点 $E$。若 $AD=" + AD + "$，$AB=" + AB + "$，则 $\\triangle ADE$ 与 $\\triangle ABC$ 的周长之比是（　　）",
      answer: "$1\\!:\\!" + (n + 1) + "$",
      distractors: ["$1\\!:\\!" + n + "$", "$1\\!:\\!" + (AB - 1) + "$", "$1\\!:\\!" + (AD * n) + "$"],
      goal: "求 $\\triangle ADE$ 与 $\\triangle ABC$ 的周长之比",
      goals: ["求 $\\triangle ADE$ 与 $\\triangle ABC$ 的周长之比"],
      givens: ["点 $D$ 在边 $AB$ 上", "过 $D$ 作 $DE\\parallel BC$ 交 $AC$ 于 $E$", "$AD=" + AD + "$", "$AB=" + AB + "$"],
      solution: ["由 $DE\\parallel BC$ 得 $\\triangle ADE\\sim\\triangle ABC$，相似比 $k=\\dfrac{AD}{AB}=\\dfrac{" + AD + "}{" + AB + "}=\\dfrac{1}{" + (n + 1) + "}$。", "相似三角形的周长比等于相似比，故周长之比为 $1:" + (n + 1) + "$。"],
      steps: [
        { text: "$\\triangle ADE\\sim\\triangle ABC$", basis: "平行于三角形一边的直线与其他两边相交，截得的三角形与原三角形相似" },
        { text: "$k=\\dfrac{AD}{AB}=\\dfrac{1}{" + (n + 1) + "}$", basis: "相似比的定义" },
        { text: "周长之比 $=k=1:" + (n + 1) + "$", basis: "相似三角形的周长比等于相似比" }
      ],
      checks: [
        { expr: "AD*" + (n + 1) + "-AB", at: { AD: AD, AB: AB }, expect: 0 },
        { expr: "AB-AD*" + (n + 1), at: { AB: AB, AD: AD }, expect: 0 }
      ]
    };
  }

  const rod = pick(rand, 1, 3);
  const sr = pick(rand, 2, 4);
  const sp = sr * pick(rand, 3, 6);
  const h = (rod * sp) / sr;
  return {
    params: { rod: rod, sr: sr, sp: sp, h: h, shape: shape },
    stem: "同一时刻阳光下，一根长 $" + rod + "$ 米的木棒影长为 $" + sr + "$ 米，旁边一棵树的影长为 $" + sp + "$ 米，则这棵树的高是（　　）",
    answer: "$" + h + "$ 米",
    distractors: ["$" + (rod + sp - sr) + "$ 米", "$" + (rod * sp) + "$ 米", "$" + (rod * sr + sp) + "$ 米"],
    goal: "求树的高",
    goals: ["求树的高"],
    givens: ["同一时刻阳光下", "木棒长 $" + rod + "$ 米、影长 $" + sr + "$ 米", "树的影长 $" + sp + "$ 米"],
    solution: ["同一时刻物高与影长成正比，两个直角三角形相似。", "设树高为 $h$ 米，则 $\\dfrac{h}{" + rod + "}=\\dfrac{" + sp + "}{" + sr + "}$。", "所以 $h=\\dfrac{" + rod + "\\times " + sp + "}{" + sr + "}=" + h + "$（米）。"],
    steps: [
      { text: "物高与影长成正比", basis: "同一时刻平行光线与地面形成的两个直角三角形相似" },
      { text: "$\\dfrac{h}{" + rod + "}=\\dfrac{" + sp + "}{" + sr + "}$", basis: "相似三角形对应边成比例" },
      { text: "$h=" + h + "$", basis: "解比例" }
    ],
    checks: [
      { expr: "rod*sp-sr*h", at: { rod: rod, sp: sp, sr: sr, h: h }, expect: 0 },
      { expr: "sr*h-rod*sp", at: { sr: sr, h: h, rod: rod, sp: sp }, expect: 0 }
    ]
  };
}
