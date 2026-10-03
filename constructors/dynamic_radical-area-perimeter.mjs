export const kind = "dynamic/radical-area-perimeter";
export const covers = ["实数与二次根式"];

const SQ_SIDE = [2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 15, 18];
const SQ_DIFF = [[8, 2], [18, 2], [18, 8], [12, 3], [20, 5], [27, 12], [32, 18], [50, 8], [28, 7], [45, 20]];
const RC_PROD = [[2, 8], [3, 12], [2, 18], [8, 18], [5, 20], [3, 27], [2, 32], [12, 27], [8, 50], [6, 24]];
const RC_SUM = [[5, 3], [7, 2], [8, 2], [11, 2], [12, 3], [18, 2], [10, 2], [20, 5], [24, 6], [13, 4]];

function simp(c, r) {
  let k = c;
  let m = r;
  let d = 2;
  while (d * d <= m) {
    while (m % (d * d) === 0) {
      m = m / (d * d);
      k = k * d;
    }
    d = d + 1;
  }
  return [k, m];
}

function rad(k, m) {
  if (m === 1) {
    return String(k);
  }
  if (k === 1) {
    return "\\sqrt{" + m + "}";
  }
  return k + "\\sqrt{" + m + "}";
}

export function construct(slot, seed) {
  const s0 = Math.abs(Math.floor(Number(seed) || 1));
  const mode = s0 % 4;
  const idx = Math.floor(s0 / 4);
  if (mode === 0) {
    const n = SQ_SIDE[idx % SQ_SIDE.length];
    const one = simp(1, n);
    const four = simp(4, n);
    const k = four[0];
    const m = four[1];
    return {
      params: { mode: 0, n: n, area: n, k: k, m: m },
      difficulty: 0.45,
      score: 9,
      stem: "一块正方形试验田的边长为 $\\sqrt{" + n + "}$ 米。\n（1）求这块试验田的面积；\n（2）求这块试验田的周长。",
      answer: n + "；" + rad(k, m),
      goal: "求正方形试验田的面积 求它的周长",
      goals: ["求这块正方形试验田的面积（平方米）", "求这块正方形试验田的周长（米）"],
      givens: ["正方形试验田的边长为 $\\sqrt{" + n + "}$ 米"],
      solution: [
        "设边长为 $a$，则 $a=\\sqrt{" + n + "}$。（1）面积 $S=a^{2}=(\\sqrt{" + n + "})^{2}=" + n + "$（平方米）。",
        "（2）$\\sqrt{" + n + "}=" + rad(one[0], one[1]) + "$，周长 $C=4a=4\\sqrt{" + n + "}=" + rad(k, m) + "$（米）。"
      ],
      steps: [
        { text: "边长平方得面积 $S=(\\sqrt{" + n + "})^{2}=" + n + "$", basis: "二次根式的性质 $(\\sqrt{a})^{2}=a$" },
        { text: "把 $\\sqrt{" + n + "}$ 化成最简二次根式 " + rad(one[0], one[1]) + "，再乘 4 得周长 " + rad(k, m), basis: "最简二次根式与二次根式的乘法" }
      ],
      checks: [
        { expr: "k*k*m - 16*area", at: { k: k, m: m, area: n }, expect: 0 }
      ]
    };
  }
  if (mode === 1) {
    const p = SQ_DIFF[idx % SQ_DIFF.length][0];
    const q = SQ_DIFF[idx % SQ_DIFF.length][1];
    const sp = simp(1, p);
    const sq = simp(1, q);
    const c = sp[0] - sq[0];
    const m = sp[1];
    const A = c * c * m;
    const four = simp(4 * c, m);
    const k = four[0];
    const mm = four[1];
    return {
      params: { mode: 1, p: p, q: q, sideK: c, sideM: m, area: A, k: k, m: mm },
      difficulty: 0.4,
      score: 9,
      stem: "一块正方形试验田的边长为 $\\sqrt{" + p + "}-\\sqrt{" + q + "}$ 米。\n（1）求这块试验田的面积；\n（2）求这块试验田的周长。",
      answer: A + "；" + rad(k, mm),
      goal: "求正方形试验田的面积 求它的周长",
      goals: ["求这块正方形试验田的面积（平方米）", "求这块正方形试验田的周长（米）"],
      givens: ["正方形试验田的边长为 $\\sqrt{" + p + "}-\\sqrt{" + q + "}$ 米"],
      solution: [
        "先化简：$\\sqrt{" + p + "}=" + rad(sp[0], sp[1]) + "$，$\\sqrt{" + q + "}=" + rad(sq[0], sq[1]) + "$，所以边长 $a=" + rad(c, m) + "$。",
        "（1）面积 $S=a^{2}=(" + rad(c, m) + ")^{2}=" + A + "$（平方米）。",
        "（2）周长 $C=4a=4\\times" + rad(c, m) + "=" + rad(k, mm) + "$（米）。"
      ],
      steps: [
        { text: "合并同类二次根式得边长 $a=" + rad(c, m) + "$", basis: "二次根式的加减（化成最简二次根式后合并）" },
        { text: "面积 $S=a^{2}=" + A + "$，周长 $C=4a=" + rad(k, mm) + "$", basis: "二次根式的乘法与正方形的面积、周长公式" }
      ],
      checks: [
        { expr: "k*k*m - 16*area", at: { k: k, m: mm, area: A }, expect: 0 },
        { expr: "area - sideK*sideK*sideM", at: { area: A, sideK: c, sideM: m }, expect: 0 }
      ]
    };
  }
  if (mode === 2) {
    const pr = RC_PROD[idx % RC_PROD.length];
    const a = Math.max(pr[0], pr[1]);
    const b = Math.min(pr[0], pr[1]);
    const A = Math.round(Math.sqrt(a * b));
    const sa = simp(1, a);
    const sb = simp(1, b);
    const m = sa[1];
    const k = 2 * (sa[0] + sb[0]);
    return {
      params: { mode: 2, a: a, b: b, area: A, k: k, m: m },
      difficulty: 0.4,
      score: 9,
      stem: "一块长方形草坪的长为 $\\sqrt{" + a + "}$ 米，宽为 $\\sqrt{" + b + "}$ 米。\n（1）求这块草坪的面积；\n（2）求这块草坪的周长。",
      answer: A + "；" + rad(k, m),
      goal: "求长方形草坪的面积 求它的周长",
      goals: ["求这块长方形草坪的面积（平方米）", "求这块长方形草坪的周长（米）"],
      givens: ["长方形草坪的长为 $\\sqrt{" + a + "}$ 米", "它的宽为 $\\sqrt{" + b + "}$ 米"],
      solution: [
        "（1）面积 $S=\\sqrt{" + a + "}\\times\\sqrt{" + b + "}=\\sqrt{" + a * b + "}=" + A + "$（平方米）。",
        "（2）$\\sqrt{" + a + "}=" + rad(sa[0], sa[1]) + "$，$\\sqrt{" + b + "}=" + rad(sb[0], sb[1]) + "$，周长 $C=2\\left(" + rad(sa[0], sa[1]) + "+" + rad(sb[0], sb[1]) + "\\right)=" + rad(k, m) + "$（米）。"
      ],
      steps: [
        { text: "长乘宽得面积 $\\sqrt{" + a + "}\\times\\sqrt{" + b + "}=\\sqrt{" + a * b + "}=" + A + "$", basis: "二次根式的乘法 $\\sqrt{a}\\cdot\\sqrt{b}=\\sqrt{ab}$" },
        { text: "两邻边化成最简二次根式后相加再乘 2，得周长 " + rad(k, m), basis: "同类二次根式的合并" }
      ],
      checks: [
        { expr: "area*area - a*b", at: { area: A, a: a, b: b }, expect: 0 },
        { expr: "k*k*m - (4*a + 4*b + 8*area)", at: { k: k, m: m, a: a, b: b, area: A }, expect: 0 }
      ]
    };
  }
  const pr4 = RC_SUM[idx % RC_SUM.length];
  const p = Math.max(pr4[0], pr4[1]);
  const q = Math.min(pr4[0], pr4[1]);
  const A = p - q;
  const four = simp(4, p);
  const k = four[0];
  const m = four[1];
  return {
    params: { mode: 3, p: p, q: q, area: A, k: k, m: m },
    difficulty: 0.35,
    score: 9,
    stem: "一块长方形草坪的长为 $\\sqrt{" + p + "}+\\sqrt{" + q + "}$ 米，宽为 $\\sqrt{" + p + "}-\\sqrt{" + q + "}$ 米。\n（1）求这块草坪的面积；\n（2）求这块草坪的周长。",
    answer: A + "；" + rad(k, m),
    goal: "求长方形草坪的面积 求它的周长",
    goals: ["求这块长方形草坪的面积（平方米）", "求这块长方形草坪的周长（米）"],
    givens: ["长方形草坪的长为 $\\sqrt{" + p + "}+\\sqrt{" + q + "}$ 米", "它的宽为 $\\sqrt{" + p + "}-\\sqrt{" + q + "}$ 米"],
    solution: [
      "（1）面积 $S=\\left(\\sqrt{" + p + "}+\\sqrt{" + q + "}\\right)\\left(\\sqrt{" + p + "}-\\sqrt{" + q + "}\\right)=" + p + "-" + q + "=" + A + "$（平方米）。",
      "（2）周长 $C=2\\left[\\left(\\sqrt{" + p + "}+\\sqrt{" + q + "}\\right)+\\left(\\sqrt{" + p + "}-\\sqrt{" + q + "}\\right)\\right]=4\\sqrt{" + p + "}=" + rad(k, m) + "$（米）。"
    ],
    steps: [
      { text: "用平方差公式算面积：$\\left(\\sqrt{" + p + "}+\\sqrt{" + q + "}\\right)\\left(\\sqrt{" + p + "}-\\sqrt{" + q + "}\\right)=" + p + "-" + q + "=" + A + "$", basis: "平方差公式与 $(\\sqrt{a})^{2}=a$" },
      { text: "两邻边相加后 $\\sqrt{" + q + "}$ 抵消，周长 $=4\\sqrt{" + p + "}=" + rad(k, m) + "$", basis: "二次根式的加减与乘法" }
    ],
    checks: [
      { expr: "area - (p - q)", at: { area: A, p: p, q: q }, expect: 0 },
      { expr: "k*k*m - 16*p", at: { k: k, m: m, p: p }, expect: 0 }
    ]
  };
}
