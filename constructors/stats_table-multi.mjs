export const kind = "stats/table-multi";
export const covers = ["统计与概率"];

// 三种结构：0 频数分布表求平均数与样本估计、1 原始数据求平均数/中位数/众数、2 概率与放球
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 3;
  const idx = Math.floor(s / 3);

  if (form === 0) {
    const tables = [
      { mid: [10, 30, 50, 70], f: [5, 10, 15, 20], n: 600, g: 1 },
      { mid: [20, 40, 60, 80], f: [10, 15, 10, 15], n: 800, g: 1 },
      { mid: [10, 20, 30, 40], f: [10, 15, 10, 15], n: 400, g: 2 },
      { mid: [5, 15, 25, 35], f: [8, 12, 12, 18], n: 500, g: 2 },
      { mid: [30, 50, 70, 90], f: [10, 10, 20, 10], n: 700, g: 2 },
      { mid: [12, 24, 36, 48], f: [5, 5, 5, 5], n: 900, g: 2 },
    ];
    const t = tables[idx % tables.length];
    const total = t.f.reduce((a, v) => a + v, 0);
    const sum = t.mid.reduce((a, m, i) => a + m * t.f[i], 0);
    const mean = sum / total;
    const above = t.f.reduce((a, v, i) => (i >= t.g ? a + v : a), 0);
    const est = (t.n * above) / total;
    const thresh = t.mid[t.g];
    const [m1, m2, m3, m4] = t.mid;
    const [f1, f2, f3, f4] = t.f;
    const answers = [`样本容量 = ${total} 人`, `平均数 = ${mean}`, `估计人数 = ${est} 人`];
    return {
      params: { m1, m2, m3, m4, f1, f2, f3, f4, total, sum, mean, thresh, above, n: t.n, est },
      stem: `某校随机抽取若干名学生测量一分钟跳绳次数，按次数分成四组，各组次数取组中值 ${m1}、${m2}、${m3}、${m4}，对应人数依次为 ${f1}、${f2}、${f3}、${f4}。`,
      goal: `求样本容量 求样本平均数 用样本估计总体`,
      goals: [
        `求本次抽取的学生人数`,
        `求这组数据的平均数（用组中值计算）`,
        `若全校共有 ${t.n} 名学生，估计跳绳次数不低于 ${thresh} 次的人数`,
      ],
      answers,
      answer: answers.join('；'),
      givens: [
        `四组数据的组中值依次为 ${m1}、${m2}、${m3}、${m4}`,
        `四组对应的人数依次为 ${f1}、${f2}、${f3}、${f4}`,
        `全校共有 ${t.n} 名学生`,
      ],
      solution: [
        `样本容量 = ${f1}+${f2}+${f3}+${f4} = ${total}`,
        `平均数 = (${m1}×${f1}+${m2}×${f2}+${m3}×${f3}+${m4}×${f4}) ÷ ${total} = ${mean}`,
        `不低于 ${thresh} 次的有 ${above} 人，估计全校 ${t.n}×${above}/${total} = ${est} 人`,
      ],
      steps: [
        { text: `样本容量 ${total}`, basis: "频数之和等于样本容量" },
        { text: `平均数 ${mean}`, basis: "加权平均数（组中值×频数）" },
        { text: `估计 ${est} 人`, basis: "用样本估计总体" },
      ],
      checks: [
        { expr: "f1+f2+f3+f4 - total", at: { f1, f2, f3, f4, total }, expect: 0 },
        { expr: "(m1*f1+m2*f2+m3*f3+m4*f4)/total - mean", at: { m1, m2, m3, m4, f1, f2, f3, f4, total, mean }, expect: 0 },
        { expr: "n*above/total - est", at: { n: t.n, above, total, est }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const sets = [
      [4, 5, 6, 6, 7, 7, 7, 8, 9, 11],
      [3, 5, 5, 6, 7, 8, 8, 8, 10, 10],
      [2, 3, 4, 4, 5, 6, 6, 6, 9, 15],
      [6, 7, 8, 8, 8, 9, 10, 11, 11, 12],
      [5, 6, 6, 6, 7, 8, 9, 10, 11, 12],
      [1, 4, 4, 5, 6, 7, 7, 7, 8, 8],
    ];
    const d = sets[idx % sets.length];
    const n = d.length;
    const sum = d.reduce((a, v) => a + v, 0);
    const mean = sum / n;
    const sorted = d.slice().sort((a, b) => a - b);
    const lo = sorted[n / 2 - 1], hi = sorted[n / 2];
    const median = (lo + hi) / 2;
    const count = {};
    d.forEach((v) => { count[v] = (count[v] || 0) + 1; });
    let mode = d[0], best = 0;
    d.forEach((v) => { if (count[v] > best) { best = count[v]; mode = v; } });
    const varSum = d.reduce((a, v) => a + (v - mean) * (v - mean), 0);
    const variance = varSum / n;
    const params = { n, sum, mean, lo, hi, median, mode, modeCount: best, varSum, variance };
    d.forEach((v, i) => { params['d' + (i + 1)] = v; });
    const answers = [`平均数 = ${mean}`, `中位数 = ${median}`, `众数 = ${mode}`];
    return {
      params,
      stem: `一组数据为 ${d.join('、')}（共 ${n} 个）。`,
      goal: `求平均数 求中位数 求众数`,
      goals: [
        `求这组数据的平均数`,
        `求这组数据的中位数`,
        `求这组数据的众数`,
      ],
      answers,
      answer: answers.join('；'),
      givens: [`这组数据的 ${n} 个值依次是 ${d.join('、')}`],
      solution: [
        `平均数 = ${sum} ÷ ${n} = ${mean}`,
        `从小到大排列后中间两个数据分别是 ${lo} 和 ${hi}，中位数 = ${median}`,
        `${mode} 出现了 ${best} 次，出现次数最多，众数 = ${mode}`,
      ],
      steps: [
        { text: `平均数 ${mean}`, basis: "算术平均数定义" },
        { text: `中位数 ${median}`, basis: "中位数定义" },
        { text: `众数 ${mode}`, basis: "众数定义" },
      ],
      checks: [
        { expr: "sum/n - mean", at: { sum, n, mean }, expect: 0 },
        { expr: "(lo+hi)/2 - median", at: { lo, hi, median }, expect: 0 },
        { expr: "varSum/n - variance", at: { varSum, n, variance }, expect: 0 },
      ],
    };
  }

  const pairs = [[3, 5], [2, 6], [4, 8], [5, 9], [1, 5], [6, 10], [7, 11], [2, 8], [5, 11], [3, 9]];
  const pr = pairs[idx % pairs.length];
  const a = pr[0], b = pr[1];
  const n = a + b;
  const p1 = a / n;
  const p2 = (a * (a - 1)) / (n * (n - 1));
  const x = b - a;
  const half = 0.5;
  const answers = [`概率 = ${a}/${n}`, `概率 = ${a * (a - 1)}/${n * (n - 1)}`, `放入红球 = ${x} 个`];
  return {
    params: { a, b, n, x, half, p1: Number(p1.toFixed(9)), p2: Number(p2.toFixed(9)) },
    stem: `一个不透明袋子里装有 ${a} 个红球和 ${b} 个白球，它们除颜色外都相同。`,
    goal: `求摸到红球的概率 求摸到两个红球的概率 求放入红球的个数`,
    goals: [
      `从袋中随机摸出一个球，求摸到红球的概率`,
      `从袋中随机一次摸出两个球，求两个球都是红球的概率`,
      `若再往袋中放入若干个红球（白球个数不变），使摸到红球的概率变为 ${half}，求应放入红球的个数`,
    ],
    answers,
    answer: answers.join('；'),
    givens: [`袋中装有 ${a} 个红球`, `袋中装有 ${b} 个白球`, `球除颜色外都相同`],
    solution: [
      `球共 ${n} 个，摸到红球的概率 = ${a}/${n}`,
      `从 ${n} 个球中一次取 2 个共有 ${n}×${n - 1} 种等可能结果，两个都是红球有 ${a}×${a - 1} 种，概率 = ${a * (a - 1)}/${n * (n - 1)}`,
      `设放入 ${x} 个红球，则 (${a}+${x})/(${n}+${x}) = ${half}，解得 ${x} = ${b} − ${a} = ${x}`,
    ],
    steps: [
      { text: `概率 ${a}/${n}`, basis: "等可能事件概率公式" },
      { text: `概率 ${a * (a - 1)}/${n * (n - 1)}`, basis: "两步不放回事件概率" },
      { text: `${x} 个`, basis: "由概率列方程求解" },
    ],
    checks: [
      { expr: "a/(a+b) - p1", at: { a, b, p1 }, expect: 0 },
      { expr: "a*(a-1)/((a+b)*(a+b-1)) - p2", at: { a, b, p2 }, expect: 0 },
      { expr: "(a+x)/(a+b+x) - half", at: { a, b, x, half }, expect: 0 },
    ],
  };
}
