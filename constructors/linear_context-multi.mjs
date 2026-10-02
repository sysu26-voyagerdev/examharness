export const kind = "linear/context-multi";
export const covers = ["一次函数"];

function frac(x) {
  if (Number.isInteger(x)) return String(x);
  for (let d = 2; d <= 12; d = d + 1) {
    const n = x * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + '/' + d;
  }
  return String(x);
}

// 三种结构：0 两点求解析式、1 情境数据求关系式再求值、2 由平行直线与一点求解析式
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const km = [[1, 2], [2, 1], [2, 2], [1, 4], [3, 2], [-1, 2], [-2, 3], [2, 3], [1, 6], [3, 4], [2, -3], [1, -4]];
    const kmv = km[idx % km.length];
    const k = kmv[0], m = kmv[1];
    const b = k * m;
    const x0 = -m;
    const area = (Math.abs(k) * m * m) / 2;
    const x2 = [1, 2, -1, 3][idx % 4];
    const y2 = k * x2 + b;
    const sf = (x0 * b > 0) ? 1 : -1;
    const sign = b >= 0 ? '+ ' + b : '− ' + (-b);
    return {
      params: { k, m, b, x0, area, x2, y2, sf, y1: b },
      stem: `已知一次函数 y = kx + b 的图象经过点 A(0, ${b}) 和点 B(${x2}, ${y2})。`,
      goal: `求函数解析式 求图象与 x 轴的交点 求直线与两坐标轴围成的三角形面积`,
      goals: [
        `求这个一次函数的解析式`,
        `求这个函数的图象与 x 轴交点的坐标`,
        `求这个函数的图象与两坐标轴围成的三角形的面积`,
      ],
      answers: [`y = ${k}x ${sign}`, `(${x0}, 0)`, `${frac(area)}`],
      answer: `（1）y = ${k}x ${sign}；（2）(${x0}, 0)；（3）${frac(area)}`,
      givens: [
        `函数图象经过点 A(0, ${b})`,
        `函数图象经过点 B(${x2}, ${y2})`,
      ],
      solution: [
        `把 A(0, ${b})、B(${x2}, ${y2}) 代入 y = kx + b 得 k = ${k}，b = ${b}，所以 y = ${k}x ${sign}`,
        `令 y = 0，得 x = ${x0}，与 x 轴交点为 (${x0}, 0)`,
        `三角形面积为 1/2 × ${Math.abs(x0)} × ${Math.abs(b)} = ${frac(area)}`,
      ],
      steps: [
        { text: `y = ${k}x ${sign}`, basis: "待定系数法" },
        { text: `(${x0}, 0)`, basis: "令 y = 0 求与 x 轴交点" },
        { text: `面积 ${frac(area)}`, basis: "三角形面积公式" },
      ],
      checks: [
        { expr: "k*x2+b - y2", at: { k, x2, b, y2 }, expect: 0 },
        { expr: "k*x0+b", at: { k, x0, b }, expect: 0 },
        { expr: "sf*x0*b/2 - area", at: { sf, x0, b, area }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const ks = [3, 5, 2, 4, -2, 6, 7, 3];
    const bs = [10, 20, 6, 12, 30, 5, 8, 15];
    const k = ks[idx % ks.length];
    const b = bs[idx % bs.length];
    const x1 = 0 + (idx % 3);
    const y1 = k * x1 + b;
    const x2 = x1 + 2 + (idx % 2);
    const y2 = k * x2 + b;
    const x3 = x1 + 4;
    const y3 = k * x3 + b;
    const sign = b >= 0 ? '+ ' + b : '− ' + (-b);
    return {
      params: { k, b, x1, y1, x2, y2, x3, y3 },
      stem: `某市自来水收费实行“基本价 + 超量加价”，某户应交水费 y（元）与用水量 x（吨）满足一次函数关系。已知用水 ${x1} 吨时交 ${y1} 元，用水 ${x2} 吨时交 ${y2} 元。`,
      goal: `求函数关系式 求给定用水量的水费 求给定水费的用水量`,
      goals: [
        `求 y 与 x 之间的函数关系式`,
        `当用水量为 ${x3} 吨时，应交水费多少元`,
        `若某户交水费 ${y3} 元，求该户的用水量（吨）`,
      ],
      answers: [`y = ${k}x ${sign}`, `${y3}`, `${x3}`],
      answer: `（1）y = ${k}x ${sign}；（2）${y3}；（3）${x3}`,
      givens: [
        `水费 y 与用水量 x 满足一次函数关系`,
        `用水 ${x1} 吨时交水费 ${y1} 元`,
        `用水 ${x2} 吨时交水费 ${y2} 元`,
      ],
      solution: [
        `把 (${x1}, ${y1})、(${x2}, ${y2}) 代入 y = kx + b，解得 k = ${k}，b = ${b}`,
        `当 x = ${x3} 时，y = ${k}×${x3} + ${b} = ${y3}`,
        `令 ${k}x + ${b} = ${y3}，解得 x = ${x3}`,
      ],
      steps: [
        { text: `y = ${k}x ${sign}`, basis: "待定系数法" },
        { text: `${y3} 元`, basis: "代入求函数值" },
        { text: `${x3} 吨`, basis: "由函数值求自变量" },
      ],
      checks: [
        { expr: "k*x1+b - y1", at: { k, x1, b, y1 }, expect: 0 },
        { expr: "k*x2+b - y2", at: { k, x2, b, y2 }, expect: 0 },
        { expr: "k*x3+b - y3", at: { k, x3, b, y3 }, expect: 0 },
      ],
    };
  }

  const ks = [2, 3, -1, 4, -2, 5];
  const ms = [1, 2, 3, -1, -2, 2];
  const k = ks[idx % ks.length];
  const m = ms[idx % ms.length];
  const b = k * m;
  const x0 = -m;
  const area = (Math.abs(k) * m * m) / 2;
  const p = [0, 1, -2, 3, -1][idx % 5];
  const q = k * p + b;
  const sf = (x0 * b > 0) ? 1 : -1;
  const sign = b >= 0 ? '+ ' + b : '− ' + (-b);
  return {
    params: { k, m, b, x0, area, p, q, sf },
    stem: `已知一次函数 y = kx + b 的图象与直线 y = ${k}x 平行，且经过点 P(${p}, ${q})。`,
    goal: `求函数解析式 求图象与 x 轴的交点 求直线与两坐标轴围成的三角形面积`,
    goals: [
      `求这个一次函数的解析式`,
      `求这个函数的图象与 x 轴交点的坐标`,
      `求这个函数的图象与两坐标轴围成的三角形的面积`,
    ],
    answers: [`y = ${k}x ${sign}`, `(${x0}, 0)`, `${frac(area)}`],
    answer: `（1）y = ${k}x ${sign}；（2）(${x0}, 0)；（3）${frac(area)}`,
    givens: [
      `函数图象与直线 y = ${k}x 平行`,
      `函数图象经过点 P(${p}, ${q})`,
    ],
    solution: [
      `由平行得 k = ${k}；把 P(${p}, ${q}) 代入得 ${k}×(${p}) + b = ${q}，b = ${b}`,
      `令 y = 0，得 x = ${x0}，与 x 轴交点为 (${x0}, 0)`,
      `三角形面积为 1/2 × ${Math.abs(x0)} × ${Math.abs(b)} = ${frac(area)}`,
    ],
    steps: [
      { text: `y = ${k}x ${sign}`, basis: "两直线平行则 k 相等" },
      { text: `(${x0}, 0)`, basis: "令 y = 0 求与 x 轴交点" },
      { text: `面积 ${frac(area)}`, basis: "三角形面积公式" },
    ],
    checks: [
      { expr: "k*p + b - q", at: { k, p, b, q }, expect: 0 },
      { expr: "k*x0 + b", at: { k, x0, b }, expect: 0 },
      { expr: "sf*x0*b/2 - area", at: { sf, x0, b, area }, expect: 0 },
    ],
  };
}
