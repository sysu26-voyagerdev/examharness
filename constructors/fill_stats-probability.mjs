export const kind = "fill/stats-probability";
export const covers = ["统计与概率"];

function mk(seed) {
  let s = (Math.imul((seed >>> 0) + 0x165667b1, 2246822519) >>> 0) || 2463534242;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 8) / 16777216;
  };
}
function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
const BLANK = "\uff08  \uff09";
function list(arr) { return "$" + arr.join("$\uff0c$") + "$"; }

export function construct(slot, seed) {
  const r = mk(seed);
  const mode = ri(r, 0, 3);

  if (mode === 0 || mode === 2) {
    const m = ri(r, 8, 30), d = ri(r, 1, 6);
    const data = [m - 2 * d, m - d, m, m + d, m + 2 * d];
    if (mode === 0) {
      return {
        params: { mode: 0, m: m, d: d, a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], mean: m },
        stem: "一组数据 " + list(data) + " 的平均数是" + BLANK + "。",
        answer: String(m),
        goal: "求一组数据的平均数",
        goals: ["求这组数据的平均数"],
        givens: ["一组数据 " + list(data)],
        solution: [
          "总和 $=" + data.join("+") + "=" + (5 * m) + "$",
          "平均数 $=\\dfrac{" + (5 * m) + "}{5}=" + m + "$"
        ],
        steps: [{ text: "先求和再除以数据个数", basis: "平均数的定义" }],
        checks: [{ expr: "(a+b+c+e+f)/5", at: { a: data[0], b: data[1], c: data[2], e: data[3], f: data[4] }, expect: m }]
      };
    }
    const v = 2 * d * d;
    return {
      params: { mode: 2, m: m, d: d, a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], variance: v },
      stem: "一组数据 " + list(data) + " 的方差是" + BLANK + "。",
      answer: String(v),
      goal: "求一组数据的方差",
      goals: ["求这组数据的方差"],
      givens: ["一组数据 " + list(data) + "，其平均数为 " + m],
      solution: [
        "各数据与平均数的差为 $-" + (2 * d) + "$\uff0c$-" + d + "$\uff0c$0$\uff0c$" + d + "$\uff0c$" + (2 * d) + "$",
        "方差 $=\\dfrac{" + (2 * d) * (2 * d) + "+" + d * d + "+0+" + d * d + "+" + (2 * d) * (2 * d) + "}{5}=" + v + "$"
      ],
      steps: [{ text: "算离差平方的平均数", basis: "方差的定义" }],
      checks: [{
        expr: "((a-m)^2+(b-m)^2+(c-m)^2+(e-m)^2+(f-m)^2)/5",
        at: { a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], m: m },
        expect: v
      }]
    };
  }

  if (mode === 1) {
    const data = [];
    for (let i = 0; i < 5; i++) data.push(ri(r, 5, 40));
    const mx = Math.max.apply(null, data), mn = Math.min.apply(null, data);
    return {
      params: { mode: 1, a: data[0], b: data[1], c: data[2], e: data[3], f: data[4], mx: mx, mn: mn, range: mx - mn },
      stem: "一组数据 " + list(data) + " 的极差是" + BLANK + "。",
      answer: String(mx - mn),
      goal: "求一组数据的极差",
      goals: ["求这组数据的极差"],
      givens: ["一组数据 " + list(data)],
      solution: [
        "最大值是 " + mx + "，最小值是 " + mn,
        "极差 $=" + mx + "-" + mn + "=" + (mx - mn) + "$"
      ],
      steps: [{ text: "最大值减最小值", basis: "极差的定义" }],
      checks: [{ expr: "mx-mn", at: { mx: mx, mn: mn }, expect: mx - mn }]
    };
  }

  const rd = ri(r, 2, 8), wt = ri(r, 2, 8);
  const tot = rd + wt;
  return {
    params: { mode: 3, red: rd, white: wt, total: tot, p: rd / tot },
    stem: "一个不透明的袋子里装有 " + rd + " 个红球和 " + wt + " 个白球，每个球除颜色外都相同，从袋中任意摸出一个球，摸到红球的概率是" + BLANK + "。",
    answer: "$\\dfrac{" + rd + "}{" + tot + "}$",
    goal: "用等可能事件的概率公式求概率",
    goals: ["求摸到红球的概率"],
    givens: ["袋中装有 " + rd + " 个红球和 " + wt + " 个白球，每个球除颜色外都相同"],
    solution: [
      "一共有 " + tot + " 个球，摸到每个球的可能性相同",
      "摸到红球的概率 $=\\dfrac{" + rd + "}{" + tot + "}$"
    ],
    steps: [{ text: "用红球个数比球的总数", basis: "等可能事件概率公式" }],
    checks: [{ expr: "red/(red+white)", at: { red: rd, white: wt }, expect: rd / tot }]
  };
}
