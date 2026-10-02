export const kind = "quadratic/comprehensive-multi";
export const covers = ["二次函数综合"];

function frac(x) {
  if (Number.isInteger(x)) return String(x);
  for (let d = 2; d <= 12; d = d + 1) {
    const n = x * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n) + '/' + d;
  }
  return String(x);
}

// 三种结构：0 抛物线与两坐标轴的三交点求解析式/顶点/面积、1 喷泉（顶点式）求系数与落点、
// 2 抛物线形拱桥（顶点在拱顶）求系数与指定位置高度
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const as = [1, -1, 2, -2, 1, -1, 2, -2];
    const r1 = -1, r2 = 3;
    const a = as[idx % as.length];
    const b = -a * (r1 + r2);
    const c = a * r1 * r2;
    const h = (r1 + r2) / 2;
    const kv = a * h * h + b * h + c;
    const area = (Math.abs(r2 - r1) * Math.abs(c)) / 2;
    const abLen = r2 - r1;
    const sf = c > 0 ? 1 : -1;
    return {
      params: { a, b, c, r1, r2, h, kv, area, abLen, sf },
      stem: `已知抛物线 y = ax² + bx + c 与 x 轴交于点 A(${r1}, 0)、B(${r2}, 0)，与 y 轴交于点 C(0, ${c})。`,
      goal: `求解析式 求顶点坐标 求三角形面积`,
      goals: [
        `求 a、b 的值`,
        `求这条抛物线的顶点坐标`,
        `求 △ABC 的面积`,
      ],
      answers: [`a = ${a}，b = ${b}`, `(${h}, ${kv})`, `${frac(area)}`],
      answer: `（1）a = ${a}，b = ${b}；（2）(${h}, ${kv})；（3）${frac(area)}`,
      givens: [
        `抛物线与 x 轴交于点 A(${r1}, 0)`,
        `抛物线与 x 轴交于点 B(${r2}, 0)`,
        `抛物线与 y 轴交于点 C(0, ${c})`,
      ],
      solution: [
        `设 y = a(x − ${r1})(x − ${r2})，把 C(0, ${c}) 代入得 a = ${a}，展开得 b = ${b}`,
        `对称轴为直线 x = ${h}，代入得顶点纵坐标为 ${kv}，顶点是 (${h}, ${kv})`,
        `AB = ${abLen}，△ABC 的面积为 1/2 × ${abLen} × ${Math.abs(c)} = ${frac(area)}`,
      ],
      steps: [
        { text: `a = ${a}，b = ${b}`, basis: "交点式（两根式）与待定系数法" },
        { text: `(${h}, ${kv})`, basis: "顶点坐标公式" },
        { text: `S△ABC = ${frac(area)}`, basis: "三角形面积公式" },
      ],
      checks: [
        { expr: "a*r2*r2 + b*r2 + c", at: { a, b, r2, c }, expect: 0 },
        { expr: "a*r1*r1 + b*r1 + c", at: { a, b, r1, c }, expect: 0 },
        { expr: "sf*abLen*c/2 - area", at: { sf, abLen, c, area }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const hs = [2, 3, 4, 5, 6];
    const h = hs[idx % hs.length];
    const kvs = [4, 3, 5, 2, 6];
    const kv = kvs[idx % kvs.length];
    const coef = Number((-kv / (h * h)).toFixed(9));
    const land = 2 * h;
    const x0 = h + 1;
    const y0 = Number((coef * (x0 - h) * (x0 - h) + kv).toFixed(9));
    return {
      params: { h, kv, coef, land, x0, y0 },
      stem: `某公园的喷水池中，水柱从池边点 O(0, 0) 处喷出，水柱上各点的高度 y（米）与水平距离 x（米）满足二次函数关系；水柱最高点的高度为 ${kv} 米，此时水平距离为 ${h} 米。`,
      goal: `求二次项系数 求落水处与喷射点的距离 求指定处水柱高度`,
      goals: [
        `求水柱所在抛物线的二次项系数 a`,
        `求水柱落回水面处与喷射点之间的距离（米）`,
        `求与喷射点水平距离为 ${x0} 米处水柱的高度（米）`,
      ],
      answers: [`a = ${frac(coef)}`, `${land} 米`, `${frac(y0)} 米`],
      answer: `（1）a = ${frac(coef)}；（2）${land} 米；（3）${frac(y0)} 米`,
      givens: [
        `水柱从 O(0, 0) 喷出`,
        `水柱最高点的高度为 ${kv} 米`,
        `最高点处的水平距离为 ${h} 米`,
      ],
      solution: [
        `设 y = a(x − ${h})² + ${kv}，把 O(0, 0) 代入得 a = ${frac(coef)}`,
        `令 y = 0 得 x = 0 或 x = ${land}，落水处与喷射点相距 ${land} 米`,
        `当 x = ${x0} 时，y = ${frac(coef)}×(${x0} − ${h})² + ${kv} = ${frac(y0)}`,
      ],
      steps: [
        { text: `a = ${frac(coef)}`, basis: "顶点式与待定系数法" },
        { text: `${land} 米`, basis: "令 y = 0 解一元二次方程" },
        { text: `${frac(y0)} 米`, basis: "代入求函数值" },
      ],
      checks: [
        { expr: "coef*(0-h)*(0-h) + kv", at: { coef, h, kv }, expect: 0 },
        { expr: "y0 - (coef*(x0-h)*(x0-h) + kv)", at: { y0, coef, x0, h, kv }, expect: 0 },
        { expr: "coef*(land-h)*(land-h) + kv", at: { coef, land, h, kv }, expect: 0 },
      ],
    };
  }

  const Ls = [2, 4, 6, 8, 12];
  const Hs = [4, 8];
  const L = Ls[idx % Ls.length];
  const H = Hs[idx % Hs.length];
  const coef = Number((-H / (L * L)).toFixed(9));
  const halfL = L / 2;
  const yh = (3 * H) / 4;
  const span = 2 * L;
  const waterY = -H;
  return {
    params: { L, H, coef, halfL, yh, span, waterY },
    stem: `一座抛物线形拱桥，桥拱的跨度 AB = ${span} 米，拱顶离水面的高度为 ${H} 米。以拱顶为原点、抛物线的对称轴为 y 轴建立平面直角坐标系，桥拱可看作抛物线 y = ax² 的一部分。`,
    goal: `求系数 求顶点坐标 求指定处离水面的高度`,
    goals: [
      `求 a 的值`,
      `求桥拱对应抛物线的顶点坐标`,
      `求与拱顶水平距离为 ${halfL} 米处桥拱离水面的高度（米）`,
    ],
    answers: [`a = ${frac(coef)}`, `(0, 0)`, `${frac(yh)} 米`],
    answer: `（1）a = ${frac(coef)}；（2）(0, 0)；（3）${frac(yh)} 米`,
    givens: [
      `桥拱跨度 AB = ${span} 米`,
      `拱顶离水面 ${H} 米`,
      `以拱顶为原点、对称轴为 y 轴建立平面直角坐标系`,
    ],
    solution: [
      `水面与桥拱交于 A(−${L}, ${waterY})、B(${L}, ${waterY})，代入 y = ax² 得 a = ${frac(coef)}`,
      `抛物线 y = ax² 的顶点为原点，即 (0, 0)`,
      `当 x = ${halfL} 时，y = ${coef}×${halfL * halfL}，故离水面高度为 ${frac(yh)} 米`,
    ],
    steps: [
      { text: `a = ${frac(coef)}`, basis: "把交点坐标代入 y = ax²" },
      { text: `(0, 0)`, basis: "抛物线 y = ax² 的顶点" },
      { text: `${frac(yh)} 米`, basis: "代入求函数值" },
    ],
    checks: [
      { expr: "coef*L*L + H", at: { coef, L, H }, expect: 0 },
      { expr: "coef*halfL*halfL + H - yh", at: { coef, halfL, H, yh }, expect: 0 },
      { expr: "span - 2*L", at: { span, L }, expect: 0 },
    ],
  };
}
