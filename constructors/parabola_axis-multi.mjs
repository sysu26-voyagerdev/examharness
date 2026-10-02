export const kind = "parabola/axis-multi";
export const covers = ["对称轴", "与坐标轴交点"];

// 三种结构：0 由对称轴与一点求解析式、1 由两零点求解析式与对称轴、2 由顶点与一点求解析式
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const hs = [1, 2, -1, 3, -2, 4];
    const h = hs[idx % hs.length];
    const p = h + [-2, 3, 1, -3, 2][idx % 5];
    const b = -2 * h;
    const ps = [1, 2, -2, 3, -1];
    const q = ps[idx % ps.length];
    const c = q - p * p - b * p;
    const kv = c - h * h;
    const x0 = h + 1;
    const y0 = x0 * x0 + b * x0 + c;
    return {
      params: { h, p, q, b, c, kv, x0, y0 },
      stem: `已知抛物线 y = x² + bx + c 的对称轴是直线 x = ${h}，且经过点 P(${p}, ${q})。`,
      goal: `求解析式 求顶点坐标 求给定点的函数值`,
      goals: [
        `求 b、c 的值`,
        `求这条抛物线的顶点坐标`,
        `求当 x = ${x0} 时 y 的值`,
      ],
      answers: [`b = ${b}，c = ${c}`, `顶点坐标 (${h}, ${kv})`, `y = ${y0}`],
      answer: `（1）b = ${b}，c = ${c}；（2）顶点坐标 (${h}, ${kv})；（3）y = ${y0}`,
      givens: [
        `抛物线为 y = x² + bx + c`,
        `对称轴是直线 x = ${h}`,
        `抛物线经过点 P(${p}, ${q})`,
      ],
      solution: [
        `由对称轴 x = −b/2 = ${h} 得 b = ${b}`,
        `把 P(${p}, ${q}) 代入 ${p}² + ${b}×(${p}) + c = ${q}，得 c = ${c}`,
        `顶点横坐标为 ${h}，纵坐标为 ${h}² + ${b}×(${h}) + ${c} = ${kv}`,
      ],
      steps: [
        { text: `b = ${b}，c = ${c}`, basis: "对称轴公式与代入点" },
        { text: `(${h}, ${kv})`, basis: "顶点坐标公式" },
        { text: `${y0}`, basis: "代入求函数值" },
      ],
      checks: [
        { expr: "b + 2*h", at: { b, h }, expect: 0 },
        { expr: "p*p + b*p + c - q", at: { p, b, c, q }, expect: 0 },
        { expr: "(h*h + b*h + c) - kv", at: { h, b, c, kv }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const rs1 = [-1, -2, -3, -1, -4, -2];
    const rs2 = [3, 4, 5, 5, 6, 8];
    const r1 = rs1[idx % rs1.length];
    const r2 = rs2[idx % rs2.length];
    const b = -(r1 + r2);
    const c = r1 * r2;
    const h = -b / 2;
    const kv = c - h * h;
    const x0 = 0 - [1, 2, 3][idx % 3];
    const y0 = x0 * x0 + b * x0 + c;
    return {
      params: { r1, r2, b, c, h, kv, x0, y0 },
      stem: `已知抛物线 y = x² + bx + c 与 x 轴交于点 A(${r1}, 0) 和 B(${r2}, 0)。`,
      goal: `求解析式 求对称轴 求顶点坐标`,
      goals: [
        `求 b、c 的值`,
        `求这条抛物线的对称轴`,
        `求这条抛物线的顶点坐标`,
      ],
      answers: [`b = ${b}，c = ${c}`, `对称轴 x = ${h}`, `顶点坐标 (${h}, ${kv})`],
      answer: `（1）b = ${b}，c = ${c}；（2）对称轴 x = ${h}；（3）顶点坐标 (${h}, ${kv})`,
      givens: [
        `抛物线为 y = x² + bx + c`,
        `抛物线与 x 轴交于点 A(${r1}, 0)`,
        `抛物线与 x 轴交于点 B(${r2}, 0)`,
      ],
      solution: [
        `把两点代入得 ${r1}² + ${b}×(${r1}) + c = 0，${r2}² + ${b}×${r2} + c = 0，解得 b = ${b}，c = ${c}`,
        `对称轴为直线 x = −b/2 = ${h}`,
        `顶点纵坐标为 ${h}² + ${b}×(${h}) + ${c} = ${kv}`,
      ],
      steps: [
        { text: `b = ${b}，c = ${c}`, basis: "待定系数法（交点代入）" },
        { text: `对称轴 x = ${h}`, basis: "对称轴公式" },
        { text: `(${h}, ${kv})`, basis: "顶点坐标公式" },
      ],
      checks: [
        { expr: "r1*r1 + b*r1 + c", at: { r1, b, c }, expect: 0 },
        { expr: "r2*r2 + b*r2 + c", at: { r2, b, c }, expect: 0 },
        { expr: "(-b/2) - h", at: { b, h }, expect: 0 },
      ],
    };
  }

  const hs2 = [1, 2, -1, 3, 0];
  const h = hs2[idx % hs2.length];
  const ksv = [1, -2, 3, 4, -1];
  const kv = ksv[idx % ksv.length];
  const dx = [1, 2, -1, 2][idx % 4];
  const p = h + dx;
  const a = [1, 2, -1, 3][idx % 4];
  const q = a * dx * dx + kv;
  const b = -2 * a * h;
  const c = a * h * h + kv;
  const x0 = h + 3;
  const y0 = a * x0 * x0 + b * x0 + c;
  return {
    params: { h, kv, p, q, a, b, c, dx, x0, y0 },
    stem: `已知抛物线 y = ax² + bx + c 的顶点为 M(${h}, ${kv})，且经过点 P(${p}, ${q})。`,
    goal: `求 a 的值 求解析式 求给定点的函数值`,
    goals: [
      `求 a 的值`,
      `求 b、c 的值`,
      `求当 x = ${x0} 时 y 的值`,
    ],
    answers: [`a = ${a}`, `b = ${b}，c = ${c}`, `y = ${y0}`],
    answer: `（1）a = ${a}；（2）b = ${b}，c = ${c}；（3）y = ${y0}`,
    givens: [
      `抛物线的顶点为 M(${h}, ${kv})`,
      `抛物线经过点 P(${p}, ${q})`,
      `抛物线解析式为 y = ax² + bx + c`,
    ],
    solution: [
      `把 P(${p}, ${q}) 代入顶点式 y = a(x − ${h})² + ${kv}，得 a×${dx * dx} = ${q - kv}，a = ${a}`,
      `展开得 b = −2a×(${h}) = ${b}，c = ${a}×(${h}²) + ${kv} = ${c}`,
      `当 x = ${x0} 时，y = ${a}×${x0 * x0} + ${b}×(${x0}) + ${c} = ${y0}`,
    ],
    steps: [
      { text: `a = ${a}`, basis: "顶点式代入求解" },
      { text: `b = ${b}，c = ${c}`, basis: "顶点式展开为一般式" },
      { text: `${y0}`, basis: "代入求函数值" },
    ],
    checks: [
      { expr: "a*dx*dx + kv - q", at: { a, dx, kv, q }, expect: 0 },
      { expr: "a*h*h + kv - c", at: { a, h, kv, c }, expect: 0 },
      { expr: "(-b/(2*a)) - h", at: { b, a, h }, expect: 0 },
    ],
  };
}
