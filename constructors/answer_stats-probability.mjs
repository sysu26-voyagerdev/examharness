export const kind = "answer/stats-probability";
export const covers = ["统计与概率"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0xc2b2ae35, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function frac(a, b) { const g = gcd(a, b); return "\\dfrac{" + (a / g) + "}{" + (b / g) + "}"; }
function n3(a, b, c) { return "\uff081\uff09" + a + "\uff1b\uff082\uff09" + b + "\uff1b\uff083\uff09" + c; }
function list(arr) { return "$" + arr.join("$\uff0c$") + "$"; }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0) {
    const m = ri(r, 20, 40), d = ri(r, 1, 5);
    const data = [m - 2 * d, m - d, m, m + d, m + 2 * d];
    const v = 2 * d * d;
    return {
      params: { mode: 0, m: m, d: d, a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], variance: v },
      stem: "某校从九年级随机抽取 5 名同学参加环保知识竞赛，他们的成绩（单位：分）分别是 " + list(data) + "。\n（1）求这 5 名同学成绩的平均数；\n（2）求这 5 名同学成绩的中位数；\n（3）求这 5 名同学成绩的方差。",
      answer: n3(m, m, v),
      goal: "求一组数据的平均数、中位数和方差",
      goals: ["求这组数据的平均数", "求这组数据的中位数", "求这组数据的方差"],
      givens: ["这 5 名同学的成绩分别是 " + list(data)],
      solution: [
        "平均数 $\\bar{x}=\\dfrac{" + data.join("+") + "}{5}=" + m + "$（分）",
        "把数据从小到大排列，中间的数是 $" + m + "$，所以中位数是 $" + m + "$",
        "方差 $s^{2}=\\dfrac{" + (4 * d * d) + "+" + (d * d) + "+0+" + (d * d) + "+" + (4 * d * d) + "}{5}=" + v + "$"
      ],
      steps: [
        { text: "求和后除以数据个数", basis: "平均数的定义" },
        { text: "按大小排列取中间一个", basis: "中位数的定义" },
        { text: "求各数据与平均数差的平方的平均数", basis: "方差的定义" }
      ],
      checks: [
        { expr: "(a+b+c+e+f)/5", at: { a: data[0], b: data[1], c: data[2], e: data[3], f: data[4] }, expect: m },
        { expr: "((a-m)^2+(b-m)^2+(c-m)^2+(e-m)^2+(f-m)^2)/5", at: { a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], m: m }, expect: v }
      ]
    };
  }

  if (mode === 1) {
    const rd = ri(r, 3, 7), wt = ri(r, 5, 9);
    const tot = rd + wt;
    const k = ri(r, 1, 5);
    const p2 = (rd + k) / (tot + k);
    const need = wt - rd;
    return {
      params: { mode: 1, red: rd, white: wt, total: tot, k: k, p1: rd / tot, p2: p2, need: need },
      stem: "一个不透明的盒子里装有 " + rd + " 个红球和 " + wt + " 个白球，每个球除颜色外都相同。\n（1）从盒中任意摸出一个球，求摸到红球的概率；\n（2）若往盒中再放入 " + k + " 个红球，求此时摸到红球的概率；\n（3）要使摸到红球的概率是 $\\dfrac{1}{2}$，应往盒中再放入多少个红球？",
      answer: n3(frac(rd, tot), frac(rd + k, tot + k), need),
      goal: "用等可能事件概率公式求概率，并由概率条件反求个数",
      goals: ["求摸到红球的概率", "求再放入红球后摸到红球的概率", "求需要再放入的红球个数"],
      givens: [
        "盒子里装有 " + rd + " 个红球和 " + wt + " 个白球，每个球除颜色外都相同",
        "往盒中再放入 " + k + " 个红球",
        "要使摸到红球的概率为 $\\dfrac{1}{2}$"
      ],
      solution: [
        "共有 " + tot + " 个球，摸到红球的概率为 $" + frac(rd, tot) + "$",
        "放入 " + k + " 个红球后共有 " + (tot + k) + " 个球，概率为 $" + frac(rd + k, tot + k) + "$",
        "设再放入 $x$ 个红球，则 $\\dfrac{" + rd + "+x}{" + tot + "+x}=\\dfrac{1}{2}$，解得 $x=" + need + "$"
      ],
      steps: [
        { text: "用红球个数除以球的总数", basis: "等可能事件概率公式" },
        { text: "总数与红球数同时增加后再求概率", basis: "等可能事件概率公式" },
        { text: "列方程解出个数", basis: "一元一次方程的应用" }
      ],
      checks: [
        { expr: "red/(red+white)", at: { red: rd, white: wt }, expect: rd / tot },
        { expr: "(red+k)/(red+white+k)", at: { red: rd, white: wt, k: k }, expect: p2 },
        { expr: "(red+need)/(red+white+need)*2", at: { red: rd, white: wt, need: need }, expect: 1 }
      ]
    };
  }

  if (mode === 2) {
    const m = ri(r, 20, 40), d = ri(r, 2, 5);
    const A = [m - 2 * d, m - d, m, m + d, m + 2 * d];
    const B = [m - 4 * d, m - 2 * d, m, m + 2 * d, m + 4 * d];
    const vA = 2 * d * d, vB = 8 * d * d;
    return {
      params: {
        mode: 2, m: m, d: d, a1: A[0], a2: A[1], a3: A[2], a4: A[3], a5: A[4],
        b1: B[0], b2: B[1], b3: B[2], b4: B[3], b5: B[4], vA: vA, vB: vB
      },
      stem: "某工厂用甲、乙两台机器加工同一种零件，各随机抽取 5 个零件测量尺寸（单位：mm）。\n甲机器：" + list(A) + "；乙机器：" + list(B) + "。\n（1）分别求甲、乙两台机器所抽零件尺寸的平均数；\n（2）求甲机器所抽零件尺寸的方差；\n（3）求乙机器所抽零件尺寸的方差，并判断哪台机器加工的零件尺寸更稳定。",
      answer: n3(m, vA, vB + "\uff0c\u7532\u673a\u5668\u52a0\u5de5\u7684\u96f6\u4ef6\u5c3a\u5bf8\u66f4\u7a33\u5b9a"),
      goal: "求两组数据的平均数和方差，用方差判断稳定性",
      goals: ["求两组数据的平均数", "求甲组数据的方差", "求乙组数据的方差并判断哪台机器更稳定"],
      givens: ["甲机器抽样的 5 个尺寸为 " + list(A), "乙机器抽样的 5 个尺寸为 " + list(B)],
      solution: [
        "两组数据的平均数都等于 $" + m + "$（mm）",
        "甲组方差 $s_{甲}^{2}=\\dfrac{" + (4 * d * d) + "+" + (d * d) + "+0+" + (d * d) + "+" + (4 * d * d) + "}{5}=" + vA + "$",
        "乙组方差 $s_{乙}^{2}=\\dfrac{" + (16 * d * d) + "+" + (4 * d * d) + "+0+" + (4 * d * d) + "+" + (16 * d * d) + "}{5}=" + vB + "$",
        "平均数相同，甲组方差较小，所以甲机器加工的零件尺寸更稳定"
      ],
      steps: [
        { text: "分别求平均数", basis: "平均数的定义" },
        { text: "分别求方差", basis: "方差的定义" },
        { text: "平均数相同时比较方差", basis: "方差越大波动越大" }
      ],
      checks: [
        { expr: "(a1+a2+a3+a4+a5)/5", at: { a1: A[0], a2: A[1], a3: A[2], a4: A[3], a5: A[4] }, expect: m },
        { expr: "((a1-m)^2+(a2-m)^2+(a3-m)^2+(a4-m)^2+(a5-m)^2)/5", at: { a1: A[0], a2: A[1], a3: A[2], a4: A[3], a5: A[4], m: m }, expect: vA },
        { expr: "((b1-m)^2+(b2-m)^2+(b3-m)^2+(b4-m)^2+(b5-m)^2)/5", at: { b1: B[0], b2: B[1], b3: B[2], b4: B[3], b5: B[4], m: m }, expect: vB }
      ]
    };
  }

  const n = ri(r, 5, 9), mb = ri(r, 2, 4), mv = ri(r, 2, 4);
  const okn = n - mb - mv;
  return {
    params: { mode: 3, n: n, mb: mb, mv: mv, sum: mb + mv, okn: okn, p1: (mb + mv) / n, p2: okn / n, p3: mb / (mb + mv) },
    stem: "某班有 " + n + " 名学生参加体育测试，成绩只分为“合格”和“待提高”两类，其中有 " + mb + " 名男同学和 " + mv + " 名女同学待提高，其余同学都合格。\n（1）求从该班随机抽取 1 名学生，抽到“待提高”的学生的概率；\n（2）求从该班随机抽取 1 名学生，抽到“合格”的学生的概率；\n（3）若从待提高的学生中随机抽取 1 名，求抽到男同学的概率。",
    answer: n3(frac(mb + mv, n), frac(okn, n), frac(mb, mb + mv)),
    goal: "用等可能事件概率公式求简单事件的概率",
    goals: ["求抽到“待提高”学生的概率", "求抽到“合格”学生的概率", "求从待提高学生中抽到男同学的概率"],
    givens: [
      "该班共 " + n + " 名学生",
      "其中有 " + mb + " 名男同学和 " + mv + " 名女同学待提高，其余同学都合格"
    ],
    solution: [
      "待提高的学生共 $" + (mb + mv) + "$ 名，概率为 $" + frac(mb + mv, n) + "$",
      "合格的学生共 $" + okn + "$ 名，概率为 $" + frac(okn, n) + "$",
      "在待提高的学生中，男同学有 $" + mb + "$ 名，概率为 $" + frac(mb, mb + mv) + "$"
    ],
    steps: [
      { text: "用待提高人数除以总人数", basis: "等可能事件概率公式" },
      { text: "先算合格人数再求概率", basis: "等可能事件概率公式" },
      { text: "在指定范围内求概率", basis: "等可能事件概率公式" }
    ],
    checks: [
      { expr: "(mb+mv)/n", at: { mb: mb, mv: mv, n: n }, expect: (mb + mv) / n },
      { expr: "(n-mb-mv)/n", at: { mb: mb, mv: mv, n: n }, expect: okn / n },
      { expr: "mb/(mb+mv)", at: { mb: mb, mv: mv }, expect: mb / (mb + mv) }
    ]
  };
}
