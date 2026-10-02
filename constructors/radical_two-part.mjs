export const kind = "radical/two-part";
export const covers = ["实数与二次根式"];

// 三种结构：0 长方形边长含根式、1 共轭根式对、2 根式完全平方
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);
  const pick = (arr, i) => arr[i % arr.length];
  const ms = [2, 3, 5, 6, 7, 10, 11];
  const ks = [2, 3, 4, 5, 6];

  if (form === 0) {
    const m = pick(ms, idx % ms.length);
    const k = pick(ks, (idx + 1) % ks.length);
    const l = pick(ks, (idx + 3) % ks.length);
    const a = k * Math.sqrt(m), b = l * Math.sqrt(m);
    const area = k * l * m;
    const peri = 2 * (k + l) * Math.sqrt(m);
    const sq = (2 * (k + l)) * (2 * (k + l)) * m;
    return {
      params: { m, k, l, area, periCoef: 2 * (k + l), periSq: sq },
      stem: `一块长方形试验田，长为 ${k}√${m} 米，宽为 ${l}√${m} 米。`,
      goal: `求试验田的面积 求试验田的周长 求周长数值的平方`,
      goals: [
        `求试验田的面积（单位：平方米）`,
        `求试验田的周长（单位：米），结果化成最简二次根式`,
        `求（2）中周长数值的平方`,
      ],
      answers: [`${area}`, `${2 * (k + l)}√${m}`, `${sq}`],
      answer: `（1）${area} 平方米；（2）${2 * (k + l)}√${m} 米；（3）${sq}`,
      givens: [
        `试验田是长方形，长为 ${k}√${m} 米`,
        `宽为 ${l}√${m} 米`,
      ],
      solution: [
        `面积 = ${k}√${m} × ${l}√${m} = ${k}×${l}×${m} = ${area}`,
        `周长 = 2(${k}√${m} + ${l}√${m}) = ${2 * (k + l)}√${m}`,
        `(${2 * (k + l)}√${m})² = ${sq}`,
      ],
      steps: [
        { text: `面积 ${area}`, basis: "二次根式乘法法则" },
        { text: `周长 ${2 * (k + l)}√${m}`, basis: "合并同类二次根式" },
        { text: `平方 ${sq}`, basis: "二次根式的平方" },
      ],
      checks: [
        { expr: "x*y - S", at: { x: a, y: b, S: area }, expect: 0 },
        { expr: "2*(x+y) - p", at: { x: a, y: b, p: peri }, expect: 0 },
        { expr: "p*p - q", at: { p: peri, q: sq }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const p = pick([2, 3, 5, 6, 7], idx % 5);
    const q = pick([2, 3, 5, 7, 11], (idx + 2) % 5);
    const x = Math.sqrt(p) + Math.sqrt(q), y = Math.sqrt(p) - Math.sqrt(q);
    const sum = 2 * Math.sqrt(p);
    const prod = p - q;
    const sqsum = 2 * (p + q);
    return {
      params: { p, q, prod, sqsum },
      stem: `已知 x = √${p} + √${q}，y = √${p} − √${q}。`,
      goal: `求 x+y 求 xy 求 x²+y²`,
      goals: [
        `求 x + y`,
        `求 xy`,
        `求 x² + y²`,
      ],
      answers: [`2√${p}`, `${prod}`, `${sqsum}`],
      answer: `（1）2√${p}；（2）${prod}；（3）${sqsum}`,
      givens: [`x = √${p} + √${q}`, `y = √${p} − √${q}`],
      solution: [
        `x+y = 2√${p}`,
        `xy = (√${p})² − (√${q})² = ${p} − ${q} = ${prod}`,
        `x²+y² = (x+y)² − 2xy = 4×${p} − ${2 * prod} = ${sqsum}`,
      ],
      steps: [
        { text: `x+y = 2√${p}`, basis: "合并同类二次根式" },
        { text: `xy = ${prod}`, basis: "平方差公式与二次根式乘法" },
        { text: `x²+y² = ${sqsum}`, basis: "完全平方公式变形" },
      ],
      checks: [
        { expr: "X+Y - t", at: { X: x, Y: y, t: sum }, expect: 0 },
        { expr: "X*Y - r", at: { X: x, Y: y, r: prod }, expect: 0 },
        { expr: "X*X+Y*Y - v", at: { X: x, Y: y, v: sqsum }, expect: 0 },
      ],
    };
  }

  const a = pick([3, 5, 7, 8, 11], idx % 5);
  const b = pick([1, 2, 3, 4, 5], (idx + 4) % 5);
  const d = a * b;
  const dif = a + b - 2 * Math.sqrt(d);
  const sum2 = a + b + 2 * Math.sqrt(d);
  const gap = 4 * Math.sqrt(d);
  return {
    params: { a, b, d },
    stem: `计算 (√${a} − √${b})² 与 (√${a} + √${b})²。`,
    goal: `展开 (√a−√b)² 展开 (√a+√b)² 求两式之差`,
    goals: [
      `展开 (√${a} − √${b})²`,
      `展开 (√${a} + √${b})²`,
      `求上面两个结果之差的绝对值`,
    ],
    answers: [`${a + b} − 2√${d}`, `${a + b} + 2√${d}`, `4√${d}`],
    answer: `（1）${a + b} − 2√${d}；（2）${a + b} + 2√${d}；（3）4√${d}`,
    givens: [`式中的两个数分别是 ${a} 和 ${b}`],
    solution: [
      `(√${a} − √${b})² = ${a} + ${b} − 2√${d}`,
      `(√${a} + √${b})² = ${a} + ${b} + 2√${d}`,
      `差的绝对值 4√${d}`,
    ],
    steps: [
      { text: `${a + b} − 2√${d}`, basis: "完全平方公式" },
      { text: `${a + b} + 2√${d}`, basis: "完全平方公式" },
      { text: `4√${d}`, basis: "二次根式加减" },
    ],
    checks: [
      { expr: "X*X - v", at: { X: Math.sqrt(a) - Math.sqrt(b), v: dif }, expect: 0 },
      { expr: "Y*Y - w", at: { Y: Math.sqrt(a) + Math.sqrt(b), w: sum2 }, expect: 0 },
      { expr: "Y*Y - X*X - e", at: { X: Math.sqrt(a) - Math.sqrt(b), Y: Math.sqrt(a) + Math.sqrt(b), e: gap }, expect: 0 },
    ],
  };
}
