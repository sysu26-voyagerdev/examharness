export const kind = "dynamic/quadratic_comprehensive";
export const covers = ["二次函数综合"];

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) + 1;
  const r1 = -(2 * (s % 2) + 2);
  const r2 = 2 * (s % 3) + 2;
  const a = 1 + (s % 2);
  const b = -a * (r1 + r2);
  const c = a * r1 * r2;
  const vx = (r1 + r2) / 2;
  const vy = c - (b * b) / (4 * a);
  const area = 0.5 * (r2 - r1) * (0 - c);

  const coefA = a === 1 ? "x^2" : a + "x^2";
  const exprPlain = "y = " + coefA + " " + (b >= 0 ? "+ " + b : "- " + (0 - b)) + "x " +
    (c >= 0 ? "+ " + c : "- " + (0 - c));

  const given = "已知抛物线 y = ax^2 + bx + c 与 x 轴交于点 A(" + r1 + ", 0)、B(" + r2 +
    ", 0)，与 y 轴交于点 C(0, " + c + ")。";
  const asks = [
    "（1）求这条抛物线的解析式；",
    "（2）求这条抛物线的顶点坐标和对称轴；",
    "（3）求△ABC 的面积。"
  ];
  const stem = given + "\n" + asks.join("\n");

  const answers = [
    "（1）" + exprPlain,
    "（2）顶点坐标为 (" + vx + ", " + vy + ")，对称轴为 x = " + vx,
    "（3）S△ABC = " + area
  ];
  const answer = answers.join("；");

  const solution = [
    "（1）A(" + r1 + ", 0)、B(" + r2 + ", 0) 是抛物线与 x 轴交点，方程 ax^2 + bx + c = 0 的两根为 " +
      r1 + " 与 " + r2 + "，设 y = k(x - " + r1 + ")(x - " + r2 + ")，代入 C(0, " + c + ") 得 k = " + a +
      "，故 " + exprPlain + "。",
    "（2）对称轴 x = -b/(2a) = (" + r1 + " + " + r2 + ")/2 = " + vx + "，代回解析式得顶点 (" + vx + ", " + vy + ")。",
    "（3）|AB| = " + (r2 - r1) + "，|OC| = " + (0 - c) + "，S△ABC = " + area + "。"
  ];

  const steps = [
    { text: "由 A、B 在 x 轴上写出交点式，再用点 C 定系数。", basis: "待定系数法。" },
    { text: "对称轴 x = -b/(2a)，代值求顶点。", basis: "二次函数顶点公式。" },
    { text: "底乘高除以二求三角形面积。", basis: "三角形面积公式。" }
  ];

  const checks = [
    { expr: "a*x*x + b*x + c", at: { a: a, b: b, c: c, x: r1 }, expect: 0 },
    { expr: "a*x*x + b*x + c", at: { a: a, b: b, c: c, x: r2 }, expect: 0 },
    { expr: "c - a*x1*x2", at: { a: a, c: c, x1: r1, x2: r2 }, expect: 0 },
    { expr: "vy - (c - b*b/(4*a))", at: { a: a, b: b, c: c, vy: vy }, expect: 0 },
    { expr: "vx - (0 - b/(2*a))", at: { a: a, b: b, vx: vx }, expect: 0 },
    { expr: "area - 0.5*(x2-x1)*(0-c)", at: { area: area, c: c, x1: r1, x2: r2 }, expect: 0 }
  ];

  return {
    params: { a: a, b: b, c: c, r1: r1, r2: r2, vx: vx, vy: vy, area: area },
    given: given, asks: asks,
    stem: stem, answer: answer, answerTex: exprPlain,
    solution: solution, steps: steps, checks: checks
  };
}
