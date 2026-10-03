export const kind = "dynamic/number-pattern-fill";
export const covers = ["规律与代数推理"];

function hash(n) {
  let x = (Math.floor(Math.abs(n)) + 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function construct(slot, seed) {
  const h = hash(seed);
  const mode = h % 4;
  const pickAt = (arr, k) => arr[((h >>> (k * 4)) >>> 0) % arr.length];

  if (mode === 0) {
    const a1 = pickAt([3, 4, 5, 6, 7, 8, 9], 1);
    const d = pickAt([2, 3, 4, 5, 6], 2);
    const n = pickAt([12, 15, 18, 20, 25, 30], 3);
    const t1 = a1, t2 = a1 + d, t3 = a1 + 2 * d, t4 = a1 + 3 * d;
    const ans = a1 + (n - 1) * d;
    return {
      params: { mode: 0, a1: a1, d: d, n: n, t1: t1, t2: t2, t3: t3, t4: t4 },
      stem: "一列数按如下规律排列：$" + t1 + "$，$" + t2 + "$，$" + t3 + "$，$" + t4 + "$，…每个数都比前一个数大 $" + d + "$。按此规律，第 $" + n + "$ 个数是（　　）。",
      answer: String(ans),
      goal: "求等差数列的第 n 项",
      goals: ["写出第 $" + n + "$ 个数"],
      givens: ["前四个数依次是 $" + t1 + "$，$" + t2 + "$，$" + t3 + "$，$" + t4 + "$", "每个数比前一个数大 $" + d + "$"],
      solution: ["由规律，第 $" + n + "$ 个数为 $" + a1 + "+(" + n + "-1)\\times" + d + "=" + ans + "$。"],
      steps: [{ text: "第 $" + n + "$ 个数 $=" + a1 + "+(" + n + "-1)\\times" + d + "=" + ans + "$", basis: "等差数列的通项" }],
      checks: [{ expr: "ans - (a1 + (n-1)*d)", at: { ans: ans, a1: a1, n: n, d: d }, expect: 0 }]
    };
  }

  if (mode === 1) {
    const n = pickAt([9, 10, 12, 13, 15, 16, 18, 20], 1);
    const ans = n * n;
    return {
      params: { mode: 1, n: n, s: 1, t1: 1, t2: 4, t3: 9, t4: 16 },
      stem: "一列数按如下规律排列：$1$，$4$，$9$，$16$，…每个数都等于它序号的平方（序号从 $" + 1 + "$ 开始）。按此规律，第 $" + n + "$ 个数是（　　）。",
      answer: String(ans),
      goal: "求平方数序列的第 n 项",
      goals: ["写出第 $" + n + "$ 个数"],
      givens: ["前四个数依次是 $1$，$4$，$9$，$16$", "序号从 $" + 1 + "$ 开始"],
      solution: ["第 $" + n + "$ 个数为 $" + n + "^{2}=" + ans + "$。"],
      steps: [{ text: "第 $" + n + "$ 个数 $=" + n + "^{2}=" + ans + "$", basis: "由规律归纳出通项" }],
      checks: [{ expr: "ans - n*n", at: { ans: ans, n: n }, expect: 0 }]
    };
  }

  if (mode === 2) {
    const n = pickAt([10, 12, 14, 15, 16, 18, 20], 1);
    const ans = (n * (n + 1)) / 2;
    return {
      params: { mode: 2, n: n, t1: 1, t2: 3, t3: 6, t4: 10, d2: 2, d3: 3, d4: 4 },
      stem: "一列数按如下规律排列：$1$，$3$，$6$，$10$，…第 $1$ 个数是 $1$，以后相邻两数之差依次是 $" + 2 + "$、$" + 3 + "$、$" + 4 + "$……按此规律，第 $" + n + "$ 个数是（　　）。",
      answer: String(ans),
      goal: "求三角形数序列的第 n 项",
      goals: ["写出第 $" + n + "$ 个数"],
      givens: ["前四个数依次是 $1$，$3$，$6$，$10$", "相邻两数之差依次是 $2$，$3$，$4$，…"],
      solution: ["第 $" + n + "$ 个数为 $\\frac{" + n + "\\times(" + n + "+1)}{2}=" + ans + "$。"],
      steps: [{ text: "第 $" + n + "$ 个数 $=\\frac{" + n + "(" + n + "+1)}{2}=" + ans + "$", basis: "由相邻差归纳出通项" }],
      checks: [{ expr: "ans - n*(n+1)/2", at: { ans: ans, n: n }, expect: 0 }]
    };
  }

  const n = pickAt([7, 8, 9, 10, 11, 12], 1);
  const ans = Math.pow(2, n) - 1;
  return {
    params: { mode: 3, n: n, ratio: 2, add: 1, first: 1, t1: 1, t2: 3, t3: 7, t4: 15 },
    stem: "一列数按如下规律排列：$1$，$3$，$7$，$15$，…第一个数是 $" + 1 + "$，每个数都等于前一个数的 $" + 2 + "$ 倍再加 $" + 1 + "$。按此规律，第 $" + n + "$ 个数是（　　）。",
    answer: String(ans),
    goal: "求递推数列的第 n 项",
    goals: ["写出第 $" + n + "$ 个数"],
    givens: ["第一个数是 $" + 1 + "$", "每个数等于前一个数的 $2$ 倍再加 $1$", "前四个数依次是 $1$，$3$，$7$，$15$"],
    solution: ["由递推规律可得第 $n$ 个数为 $2^{n}-1$，故第 $" + n + "$ 个数为 $2^{" + n + "}-1=" + ans + "$。"],
    steps: [{ text: "第 $" + n + "$ 个数 $=2^{" + n + "}-1=" + ans + "$", basis: "由递推规律归纳通项" }],
    checks: [{ expr: "ans - (2^n - 1)", at: { ans: ans, n: n }, expect: 0 }]
  };
}
