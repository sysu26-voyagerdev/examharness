export const kind = "dynamic/vieta-quadratic-solve";
export const covers = ["一元二次方程根与系数的关系", "一元二次方程"];

function pickRoots(seed) {
  const s = Math.abs(Math.floor(seed)) % 1000;
  let r1 = (s % 11) - 5;
  let r2 = (Math.floor(s / 11) % 11) - 5;
  if (r1 === r2 || r1 === 0 || r2 === 0) return pickRoots(seed + 7);
  return [r1, r2];
}

export function construct(slot, seed) {
  const [r1, r2] = pickRoots(seed);
  const b = -(r1 + r2);
  const c = r1 * r2;
  const sum = r1 + r2;
  const prod = r1 * r2;
  const sq = sum * sum - 2 * prod;
  const recip = sum / prod;

  const bStr = b === 0 ? "" : (b > 0 ? `+${b}x` : `${b}x`);
  const cStr = c === 0 ? "" : (c > 0 ? `+${c}` : `${c}`);
  const eq = `x^{2}${bStr}${cStr}=0`;

  const goals = [
    "不解方程，求两根之和与两根之积",
    "求两根的平方和",
    "求两根的倒数和"
  ];
  const givens = [
    `一元二次方程 $${eq}$ 有两个实数根 $x_{1}$、$x_{2}$`,
    "两根不相等且都不为零"
  ];

  const solution = [
    `由根与系数的关系，$x_{1}+x_{2}=${sum}$，$x_{1}x_{2}=${prod}$。`,
    `$x_{1}^{2}+x_{2}^{2}=(x_{1}+x_{2})^{2}-2x_{1}x_{2}=${sum}^{2}-2\\times(${prod})=${sq}$。`,
    `$\\dfrac{1}{x_{1}}+\\dfrac{1}{x_{2}}=\\dfrac{x_{1}+x_{2}}{x_{1}x_{2}}=\\dfrac{${sum}}{${prod}}=${recip}$。`
  ];

  const checks = [
    { expr: "x^2 + b*x + c", at: { x: r1, b: b, c: c }, expect: 0 },
    { expr: "x^2 + b*x + c", at: { x: r2, b: b, c: c }, expect: 0 },
    { expr: "x1+x2", at: { x1: r1, x2: r2 }, expect: sum },
    { expr: "x1*x2", at: { x1: r1, x2: r2 }, expect: prod },
    { expr: "x1^2+x2^2", at: { x1: r1, x2: r2 }, expect: sq },
    { expr: "1/x1+1/x2", at: { x1: r1, x2: r2 }, expect: recip }
  ];

  return {
    params: { r1, r2, b, c, sum, prod, sq, recip },
    stem: `已知一元二次方程 $${eq}$ 有两个实数根 $x_{1}$、$x_{2}$。\n（1）不解方程，求 $x_{1}+x_{2}$ 与 $x_{1}x_{2}$ 的值；\n（2）求 $x_{1}^{2}+x_{2}^{2}$ 的值；\n（3）求 $\\dfrac{1}{x_{1}}+\\dfrac{1}{x_{2}}$ 的值。`,
    answer: `（1）$x_{1}+x_{2}=${sum}$，$x_{1}x_{2}=${prod}$；（2）$x_{1}^{2}+x_{2}^{2}=${sq}$；（3）$\\dfrac{1}{x_{1}}+\\dfrac{1}{x_{2}}=${recip}$。`,
    goal: "不解方程求两根之和与两根之积 求两根的平方和 求两根的倒数和",
    goals,
    givens,
    solution,
    steps: [
      { text: `由根与系数的关系得 $x_{1}+x_{2}=${sum}$，$x_{1}x_{2}=${prod}$。`, basis: "一元二次方程根与系数的关系" },
      { text: `$x_{1}^{2}+x_{2}^{2}=(x_{1}+x_{2})^{2}-2x_{1}x_{2}=${sq}$。`, basis: "整式的乘法与乘法公式" },
      { text: `$\\dfrac{1}{x_{1}}+\\dfrac{1}{x_{2}}=\\dfrac{x_{1}+x_{2}}{x_{1}x_{2}}=${recip}$。`, basis: "分式的运算" }
    ],
    checks
  };
}
