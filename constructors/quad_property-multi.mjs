export const kind = "quad/property-multi";
export const covers = ["四边形与证明"];

function frac(x) {
  if (Number.isInteger(x)) return String(x);
  for (let d = 2; d <= 12; d = d + 1) {
    const n = x * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + '/' + d;
  }
  return String(x);
}

// 三种结构：0 矩形对角线相关计算、1 菱形对角线相关计算、2 正方形边长与对角线相关计算
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const tri = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20]];
    const tv = tri[idx % tri.length];
    const a = tv[0], b = tv[1], D = tv[2];
    const area = a * b;
    const triArea = (a * b) / 4;
    const answers = [`AC = ${D}`, `矩形 ABCD 的面积 = ${area}`, `△AOB 的面积 = ${frac(triArea)}`];
    return {
      params: { a, b, D, area, triArea },
      stem: `如图，四边形 ABCD 是矩形，AB = ${a}，BC = ${b}，对角线 AC、BD 相交于点 O。`,
      goal: `求对角线长 求矩形面积 求三角形面积`,
      goals: [
        `求对角线 AC 的长`,
        `求矩形 ABCD 的面积`,
        `求 △AOB 的面积`,
      ],
      answers,
      answer: answers.join('；'),
      givens: [
        `四边形 ABCD 是矩形`,
        `AB = ${a}`,
        `BC = ${b}`,
      ],
      solution: [
        `矩形四个角都是直角，在 Rt△ABC 中，AC = √(${a}² + ${b}²) = ${D}`,
        `矩形面积 = AB×BC = ${a}×${b} = ${area}`,
        `O 是 AC 的中点，△AOB 的底 AB = ${a}，高为 ${b}/2，面积 = ${frac(triArea)}`,
      ],
      steps: [
        { text: `AC = ${D}`, basis: "矩形的四个角是直角，用勾股定理" },
        { text: `面积 = ${area}`, basis: "矩形面积公式" },
        { text: `S△AOB = ${frac(triArea)}`, basis: "三角形面积公式" },
      ],
      checks: [
        { expr: "a*a + b*b - D*D", at: { a, b, D }, expect: 0 },
        { expr: "a*b - area", at: { a, b, area }, expect: 0 },
        { expr: "a*(b/2)/2 - triArea", at: { a, b, triArea }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const tri = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20]];
    const tv = tri[idx % tri.length];
    const e = tv[0], f = tv[1], side = tv[2];
    const d1 = 2 * e, d2 = 2 * f;
    const area = 2 * e * f;
    const height = area / side;
    const answers = [`BD = ${d2}`, `菱形 ABCD 的面积 = ${area}`, `AB 边上的高 = ${frac(height)}`];
    return {
      params: { e, f, side, d1, d2, area, height: Number(height.toFixed(9)) },
      stem: `如图，四边形 ABCD 是菱形，边长 AB = ${side}，对角线 AC = ${d1}，对角线 AC、BD 相交于点 O。`,
      goal: `求另一条对角线 求菱形面积 求一边上的高`,
      goals: [
        `求对角线 BD 的长`,
        `求菱形 ABCD 的面积`,
        `求 AB 边上的高`,
      ],
      answers,
      answer: answers.join('；'),
      givens: [
        `四边形 ABCD 是菱形`,
        `AB = ${side}`,
        `对角线 AC = ${d1}`,
      ],
      solution: [
        `菱形对角线互相垂直平分，OA = ${e}，在 Rt△AOB 中 OB = √(${side}² − ${e}²) = ${f}，所以 BD = ${d2}`,
        `菱形面积 = 1/2 × AC × BD = 1/2 × ${d1} × ${d2} = ${area}`,
        `设 AB 边上的高为 h，则 ${side}×h = ${area}，h = ${frac(height)}`,
      ],
      steps: [
        { text: `BD = ${d2}`, basis: "菱形对角线互相垂直平分、勾股定理" },
        { text: `面积 = ${area}`, basis: "菱形面积等于对角线乘积的一半" },
        { text: `高 = ${frac(height)}`, basis: "面积公式的另一种表示" },
      ],
      checks: [
        { expr: "e*e + f*f - side*side", at: { e, f, side }, expect: 0 },
        { expr: "d1*d2/2 - area", at: { d1, d2, area }, expect: 0 },
        { expr: "side*height - area", at: { side, height, area }, expect: 0 },
      ],
    };
  }

  const as = [2, 3, 4, 5, 6, 8, 10, 12];
  const a = as[idx % as.length];
  const area = a * a;
  const OAdist = a / 2;
  const half2 = 2 * a * a;
  const answers = [`AC² = ${half2}`, `正方形 ABCD 的面积 = ${area}`, `点 O 到边 AB 的距离 = ${frac(OAdist)}`];
  return {
    params: { a, area, OAdist, half2 },
    stem: `如图，四边形 ABCD 是正方形，边长 AB = ${a}，对角线 AC、BD 相交于点 O。`,
    goal: `求对角线长的平方 求正方形面积 求点 O 到一边的距离`,
    goals: [
      `求对角线 AC 的长的平方`,
      `求正方形 ABCD 的面积`,
      `求点 O 到边 AB 的距离`,
    ],
    answers,
    answer: answers.join('；'),
    givens: [
      `四边形 ABCD 是正方形`,
      `AB = ${a}`,
    ],
    solution: [
      `由勾股定理 AC² = ${a}² + ${a}² = ${half2}`,
      `正方形面积 = ${a}² = ${area}`,
      `O 到 AB 的距离等于边长的一半，为 ${frac(OAdist)}`,
    ],
    steps: [
      { text: `AC² = ${half2}`, basis: "正方形四边相等且四角为直角" },
      { text: `面积 = ${area}`, basis: "正方形面积公式" },
      { text: `距离 = ${frac(OAdist)}`, basis: "正方形的对称性" },
    ],
    checks: [
      { expr: "a*a + a*a - half2", at: { a, half2 }, expect: 0 },
      { expr: "a*a - area", at: { a, area }, expect: 0 },
      { expr: "2*OAdist - a", at: { OAdist, a }, expect: 0 },
    ],
  };
}
