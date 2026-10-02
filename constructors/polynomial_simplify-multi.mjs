export const kind = "polynomial/simplify-multi";
export const covers = ["整式与因式分解"];

// 三种结构：0 先化简再求值、1 因式分解并求值解方程、2 由和与积求对称式
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const triples = [
      [2, 3, 4], [3, 4, 5], [2, 5, 6], [4, 6, 9], [5, 6, 9],
      [6, 7, 11], [3, 7, 9], [6, 9, 14], [7, 9, 15], [5, 8, 12],
    ];
    const tr = triples[idx % triples.length];
    const a = tr[0], b = tr[1], c = tr[2];
    const k = a + b - c;
    const m = a * b;
    const t = 2 - (s % 4);
    const val = k * t + m;
    const zero = -(m / k);
    return {
      params: { a, b, c, k, m, t, val, zero },
      stem: `先化简，再求值：(x + ${a})(x + ${b}) − x(x + ${c})。`,
      goal: `化简整式 求代数式的值 求使式子为 0 的 x`,
      goals: [
        `把 (x + ${a})(x + ${b}) − x(x + ${c}) 化简`,
        `当 x = ${t} 时，求这个代数式的值`,
        `求使这个代数式的值为 0 时 x 的值`,
      ],
      answers: [`${k}x + ${m}`, `${val}`, `${zero}`],
      answer: `（1）${k}x + ${m}；（2）${val}；（3）x = ${zero}`,
      givens: [`代数式为 (x + ${a})(x + ${b}) − x(x + ${c})`, `x 取任意实数`],
      solution: [
        `展开得 x² + ${a + b}x + ${m} − x² − ${c}x = ${k}x + ${m}`,
        `当 x = ${t} 时，${k}×(${t}) + ${m} = ${val}`,
        `令 ${k}x + ${m} = 0，得 x = ${zero}`,
      ],
      steps: [
        { text: `${k}x + ${m}`, basis: "多项式乘法与合并同类项" },
        { text: `${val}`, basis: "代入求值" },
        { text: `x = ${zero}`, basis: "解一元一次方程" },
      ],
      checks: [
        { expr: "(t+a)*(t+b) - t*(t+c) - val", at: { t, a, b, c, val }, expect: 0 },
        { expr: "(0+a)*(0+b) - 0*(0+c) - m", at: { a, b, c, m }, expect: 0 },
        { expr: "(z+a)*(z+b) - z*(z+c)", at: { z: zero, a, b, c }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const rs = [[2, 3], [1, 4], [3, 5], [2, 6], [4, 5], [1, 6], [3, 7], [5, 6], [2, 7], [4, 7]];
    const p2 = rs[idx % rs.length];
    const r = p2[0], q = p2[1];
    const P = r + q, Q = r * q;
    const t = q - r;
    const val = (t + r) * (t + q);
    return {
      params: { r, q, P, Q, t, val },
      stem: `已知代数式 x² + ${P}x + ${Q}。`,
      goal: `分解因式 求代数式的值 求方程的两根`,
      goals: [
        `把 x² + ${P}x + ${Q} 分解因式`,
        `求当 x = ${t} 时这个代数式的值`,
        `求方程 x² + ${P}x + ${Q} = 0 的两个根`,
      ],
      answers: [`(x + ${r})(x + ${q})`, `${val}`, `x₁ = ${-r}，x₂ = ${-q}`],
      answer: `（1）(x + ${r})(x + ${q})；（2）${val}；（3）x₁ = ${-r}，x₂ = ${-q}`,
      givens: [`代数式为 x² + ${P}x + ${Q}`],
      solution: [
        `${r}×${q} = ${Q}，${r}+${q} = ${P}，所以 x² + ${P}x + ${Q} = (x + ${r})(x + ${q})`,
        `当 x = ${t} 时，值为 (${t}+${r})(${t}+${q}) = ${val}`,
        `由 (x + ${r})(x + ${q}) = 0 得 x₁ = ${-r}，x₂ = ${-q}`,
      ],
      steps: [
        { text: `(x + ${r})(x + ${q})`, basis: "十字相乘分解因式" },
        { text: `${val}`, basis: "代入求值" },
        { text: `x₁ = ${-r}，x₂ = ${-q}`, basis: "因式分解法解一元二次方程" },
      ],
      checks: [
        { expr: "(t+r)*(t+q) - val", at: { t, r, q, val }, expect: 0 },
        { expr: "(-r)*(-r) + P*(-r) + Q", at: { r, P, Q }, expect: 0 },
        { expr: "(-q)*(-q) + P*(-q) + Q", at: { q, P, Q }, expect: 0 },
      ],
    };
  }

  const sp = [[7, 12], [6, 8], [9, 20], [5, 6], [8, 15], [10, 21], [11, 30], [4, 3], [12, 32], [7, 10]];
  const pair = sp[idx % sp.length];
  const S = pair[0], P = pair[1];
  const a2b2 = S * S - 2 * P;
  const dif2 = S * S - 4 * P;
  const ab3 = S * S - P;
  return {
    params: { S, P, a2b2, dif2, ab3 },
    stem: `已知 a + b = ${S}，ab = ${P}。`,
    goal: `求 a²+b² 求 (a−b)² 求 a²+ab+b²`,
    goals: [
      `求 a² + b² 的值`,
      `求 (a − b)² 的值`,
      `求 a² + ab + b² 的值`,
    ],
    answers: [`${a2b2}`, `${dif2}`, `${ab3}`],
    answer: `（1）${a2b2}；（2）${dif2}；（3）${ab3}`,
    givens: [`a + b = ${S}`, `ab = ${P}`],
    solution: [
      `a² + b² = (a+b)² − 2ab = ${S * S} − ${2 * P} = ${a2b2}`,
      `(a − b)² = (a+b)² − 4ab = ${S * S} − ${4 * P} = ${dif2}`,
      `a² + ab + b² = (a+b)² − ab = ${S * S} − ${P} = ${ab3}`,
    ],
    steps: [
      { text: `a²+b² = ${a2b2}`, basis: "完全平方公式的变形" },
      { text: `(a−b)² = ${dif2}`, basis: "完全平方公式的变形" },
      { text: `a²+ab+b² = ${ab3}`, basis: "完全平方公式的变形" },
    ],
    checks: [
      { expr: "S*S - 2*P - a2b2", at: { S, P, a2b2 }, expect: 0 },
      { expr: "S*S - 4*P - dif2", at: { S, P, dif2 }, expect: 0 },
      { expr: "a2b2 + P - ab3", at: { a2b2, P, ab3 }, expect: 0 },
    ],
  };
}
