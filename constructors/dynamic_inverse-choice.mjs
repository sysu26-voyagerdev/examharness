export const kind = "dynamic/inverse-choice";
export const covers = ["反比例函数"];

function mulberry(seed) {
  let a = (seed >>> 0) + 0x6D2B79F5;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function threeG(ans, cands) {
  const out = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c !== ans && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error("干扰项不足: ans=" + ans + " cands=" + cands.join(","));
  return out.map(String);
}
function threeNum(ans, cands) {
  const out = [];
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (Number.isInteger(c) && c !== ans && !out.includes(c)) out.push(c);
    if (out.length === 3) break;
  }
  if (out.length < 3) throw new Error("干扰项不足: ans=" + ans + " cands=" + cands.join(","));
  return out.map(String);
}

export function construct(slot, seed) {
  const rnd = mulberry(seed * 134775813 + 3);
  const which = ((seed % 4) + 4) % 4;

  if (which === 0) {
    const x = pick(rnd, [2, 3, 4, 5, 6, 8, 10]);
    const r = pick(rnd, [3, 4, 6, 8, 12, 15]);
    const k = x * r;
    return {
      params: { x0: x, y0: r, k: k },
      stem: "已知反比例函数y=k/x的图象经过点(" + x + "，" + r + ")，则k的值是（　）",
      answer: "k=" + k,
      stemTex: "y=\\frac{k}{x},\\ (" + x + "," + r + ")",
      answerTex: "k=" + k,
      goal: "求反比例函数的比例系数k",
      givens: ["反比例函数的表达式是y=k/x", "它的图象经过点(" + x + "，" + r + ")"],
      solution: [
        "点(" + x + "，" + r + ")在y=k/x的图象上，所以k=xy。",
        "k=" + x + "×" + r + "=" + k + "。"
      ],
      steps: [
        { text: "k=xy", basis: "反比例函数y=k/x中k=xy" },
        { text: "k=" + x + "×" + r + "=" + k, basis: "代入点的坐标" }
      ],
      checks: [
        { expr: "k - x0*y0", at: { k: k, x0: x, y0: r }, expect: 0 }
      ],
      distractors: threeNum(k, [x + r, r, x, k + x, r * r, k - r])
    };
  }

  if (which === 1) {
    const x0 = pick(rnd, [2, 3, 4, 5, 6]);
    const y0 = pick(rnd, [2, 3, 4, 5, 6]);
    const k = x0 * y0;
    const x1 = pick(rnd, [3, 4, 5, 6, 8, 10, 12, 15]);
    const y1 = k / x1;
    if (!Number.isInteger(y1)) {
      return construct(slot, seed + 1);
    }
    return {
      params: { x0: x0, y0: y0, k: k, x1: x1, y1: y1 },
      stem: "反比例函数y=k/x的图象经过点(" + x0 + "，" + y0 + ")。当x=" + x1 + "时，y的值是（　）",
      answer: "y=" + y1,
      stemTex: "y=\\frac{k}{x},\\ (" + x0 + "," + y0 + "),\\ x=" + x1,
      answerTex: "y=" + y1,
      goal: "求当x取给定值时函数y的值",
      givens: ["反比例函数的表达式是y=k/x", "它的图象经过点(" + x0 + "，" + y0 + ")", "求x=" + x1 + "时的函数值"],
      solution: [
        "把点(" + x0 + "，" + y0 + ")代入得k=" + x0 + "×" + y0 + "=" + k + "。",
        "当x=" + x1 + "时，y=" + k + "/" + x1 + "=" + y1 + "。"
      ],
      steps: [
        { text: "k=" + k, basis: "把已知点的坐标代入y=k/x" },
        { text: "y=" + y1, basis: "代入x的值计算" }
      ],
      checks: [
        { expr: "k - x0*y0", at: { k: k, x0: x0, y0: y0 }, expect: 0 },
        { expr: "y1*x1 - k", at: { y1: y1, x1: x1, k: k }, expect: 0 }
      ],
      distractors: threeNum(y1, [k, x1, y0, y1 + x1, k - x1])
    };
  }

  if (which === 2) {
    const m = pick(rnd, [2, 3, 4, 5]);
    const n = pick(rnd, [6, 7, 8, 9, 10]);
    const k = pick(rnd, [6, 8, 12, 18, 24]);
    const y1 = k / m, y2 = k / n;
    if (!Number.isInteger(y1) || !Number.isInteger(y2)) {
      return construct(slot, seed + 1);
    }
    return {
      params: { m: m, n: n, k: k, y1: y1, y2: y2 },
      stem: "反比例函数y=k/x的图象经过第一、三象限，且k=" + k + "。点A(" + m + "，y₁)、B(" + n + "，y₂)都在它的图象上，则y₁与y₂的大小关系是（　）",
      answer: "y₁>y₂",
      stemTex: "y=\\frac{" + k + "}{x},\\ A(" + m + ",y_1),B(" + n + ",y_2)",
      answerTex: "y_1>y_2",
      goal: "比较y₁与y₂的大小",
      givens: ["反比例函数的表达式是y=k/x", "它的图象经过第一、三象限", "k=" + k, "点A(" + m + "，y₁)、B(" + n + "，y₂)在图象上"],
      solution: [
        "k=" + k + ">0，图象在第一、三象限，在每一支上y随x的增大而减小。",
        "因为0<" + m + "<" + n + "，所以y₁>y₂。",
        "也可直接算：y₁=" + k + "/" + m + "=" + y1 + "，y₂=" + k + "/" + n + "=" + y2 + "。"
      ],
      steps: [
        { text: "y₁=" + y1 + "，y₂=" + y2, basis: "把横坐标代入y=k/x" },
        { text: "y₁>y₂", basis: "同一支上y随x增大而减小（k>0）" }
      ],
      checks: [
        { expr: "m*y1 - k", at: { m: m, y1: y1, k: k }, expect: 0 },
        { expr: "n*y2 - k", at: { n: n, y2: y2, k: k }, expect: 0 },
        { expr: "y1*m - y2*n", at: { y1: y1, m: m, y2: y2, n: n }, expect: 0 }
      ],
      distractors: threeG("y₁>y₂", ["y₁<y₂", "y₁=y₂", "y₁≥y₂"])
    };
  }

  const w = pick(rnd, [2, 3, 4, 5, 6]);
  const h = pick(rnd, [2, 3, 4, 5, 6]);
  const k = w * h;
  return {
    params: { px: w, py: h, k: k, area: k },
    stem: "点P在反比例函数y=k/x（k>0）的图象上，过点P向x轴、y轴分别作垂线，与坐标轴围成的矩形面积为" + k + "，则k的值是（　）",
    answer: "k=" + k,
    stemTex: "y=\\frac{k}{x}(k>0),\\ S=" + k,
    answerTex: "k=" + k,
    goal: "求k的值",
    givens: ["点P在反比例函数y=k/x（k>0）的图象上", "过点P向x轴、y轴作垂线，与坐标轴围成矩形", "矩形的面积为" + k],
    solution: [
      "设点P的坐标为(" + w + "，" + h + ")，矩形的两边长分别为|x|与|y|，面积=|xy|=|k|。",
      "因为k>0，所以k=面积=" + k + "。"
    ],
    steps: [
      { text: "矩形面积=|k|", basis: "反比例函数中k的几何意义" },
      { text: "k=" + k, basis: "k>0时|k|=k" }
    ],
    checks: [
      { expr: "k - px*py", at: { k: k, px: w, py: h }, expect: 0 },
      { expr: "area - k", at: { area: k, k: k }, expect: 0 }
    ],
    distractors: threeNum(k, [2 * k, k / 2, w + h, k + w, k - h])
  };
}
