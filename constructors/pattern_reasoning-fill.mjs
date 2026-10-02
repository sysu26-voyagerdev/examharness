export const kind = "pattern/reasoning-fill";
export const covers = ["规律与代数推理"];

// 四种结构：0 等差型规律、1 三角形点阵型规律、2 等式型规律、3 递推（前两项之和）
export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) % 30;
  const form = s % 4;
  const idx = Math.floor(s / 4);

  if (form === 0) {
    const ps = [3, 5, 2, -1, 4, 7, 6, 1];
    const ds = [2, 3, 4, 5, -2, 6, 3, 7];
    const ks = [10, 20, 15, 30, 25, 40, 12, 50];
    const p = ps[idx % ps.length];
    const d = ds[idx % ds.length];
    const k = ks[idx % ks.length];
    const v = p + d * (k - 1);
    const q2 = p + d;
    const q3 = p + 2 * d;
    return {
      params: { p, d, k, v, q2, q3 },
      stem: `一列数按如下规律排列：第 1 个数是 ${p}，从第 2 个数起，每个数都比前一个数大 ${d}。`,
      goal: `求第 k 个数`,
      goals: [`求这列数中的第 ${k} 个数`],
      answers: [`${v}`],
      answer: `${v}`,
      givens: [
        `第 1 个数是 ${p}`,
        `从第 2 个数起，每个数都比前一个数大 ${d}`,
      ],
      solution: [
        `第 n 个数可表示为 ${p} + ${d}(n − 1)`,
        `当 n = ${k} 时，${p} + ${d}×${k - 1} = ${v}`,
      ],
      steps: [{ text: `第 ${k} 个数是 ${v}`, basis: "由变化规律写出通项再代入" }],
      checks: [
        { expr: "p + d*(k-1) - v", at: { p, d, k, v }, expect: 0 },
        { expr: "p + d - q2", at: { p, d, q2 }, expect: 0 },
        { expr: "q3 - q2 - d", at: { q3, q2, d }, expect: 0 },
      ],
    };
  }

  if (form === 1) {
    const ks = [6, 8, 10, 12, 15, 20, 9, 14];
    const k = ks[idx % ks.length];
    const v = (k * (k + 1)) / 2;
    const prev = ((k - 1) * k) / 2;
    return {
      params: { k, v, prev },
      stem: `用棋子按下列方式摆图形：第 1 个图形用 1 枚，第 2 个图形用 3 枚，第 3 个图形用 6 枚，第 4 个图形用 10 枚，依此类推（第 n 个图形比第 n − 1 个图形多 n 枚）。`,
      goal: `求第 k 个图形所用棋子数`,
      goals: [`求第 ${k} 个图形所用的棋子数`],
      answers: [`${v}`],
      answer: `${v}`,
      givens: [
        `第 1 个图形用 1 枚棋子`,
        `第 2 个图形用 3 枚棋子`,
        `第 n 个图形比第 n − 1 个图形多 n 枚棋子`,
      ],
      solution: [
        `第 n 个图形用 1+2+…+n = n(n+1)/2 枚`,
        `当 n = ${k} 时，${k}×${k + 1}/2 = ${v}`,
      ],
      steps: [{ text: `${v} 枚`, basis: "由递推规律求和" }],
      checks: [
        { expr: "k*(k+1)/2 - v", at: { k, v }, expect: 0 },
        { expr: "v - prev - k", at: { v, prev, k }, expect: 0 },
        { expr: "prev - (k-1)*k/2", at: { prev, k }, expect: 0 },
      ],
    };
  }

  if (form === 2) {
    const ks = [3, 4, 5, 6, 7, 8, 9, 10];
    const k = ks[idx % ks.length];
    const v = (k + 1) * (k + 1);
    const left = k * (k + 2) + 1;
    const nextV = (k + 2) * (k + 2);
    return {
      params: { k, v, left, nextV },
      stem: `观察下列等式：1×3 + 1 = 4 = 2²；2×4 + 1 = 9 = 3²；3×5 + 1 = 16 = 4²；……按此规律，第 n 个等式是 n(n + 2) + 1 = (n + 1)²。`,
      goal: `求第 k 个等式右边的值`,
      goals: [`求第 ${k} 个等式右边所表示的平方数（即 (${k} + 1)² 的值）`],
      answers: [`${v}`],
      answer: `${v}`,
      givens: [
        `第 1 个等式为 1×3 + 1 = 2²`,
        `第 2 个等式为 2×4 + 1 = 3²`,
        `第 n 个等式为 n(n + 2) + 1 = (n + 1)²`,
      ],
      solution: [
        `第 n 个等式右边为 (n + 1)²`,
        `当 n = ${k} 时，(${k} + 1)² = ${v}`,
      ],
      steps: [{ text: `${v}`, basis: "由等式规律写出通项" }],
      checks: [
        { expr: "(k+1)*(k+1) - v", at: { k, v }, expect: 0 },
        { expr: "left - k*(k+2) - 1", at: { left, k }, expect: 0 },
        { expr: "nextV - v", at: { nextV, v, k }, expect: 2 * k + 3 },
      ],
    };
  }

  const ks3 = [6, 7, 8, 9, 10, 5, 6, 8];
  const fibs = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  const k = ks3[idx % ks3.length];
  const v = fibs[k - 1];
  const a1 = fibs[k - 3], a2 = fibs[k - 2];
  return {
    params: {
      k, v, a1, a2,
      t1: fibs[0], t2: fibs[1], t3: fibs[2], t4: fibs[3], t5: fibs[4], t6: fibs[5],
    },
    stem: `一列数按如下规律排列：1，1，2，3，5，8，…，从第 3 个数起，每个数都等于它前面两个数的和。`,
    goal: `求第 k 个数`,
    goals: [`求这列数中的第 ${k} 个数`],
    answers: [`${v}`],
    answer: `${v}`,
    givens: [
      `第 1 个数和第 2 个数都是 1`,
      `从第 3 个数起，每个数都等于它前面两个数的和`,
    ],
    solution: [
      `依次算出前面各项后，第 ${k - 2} 个数是 ${a1}，第 ${k - 1} 个数是 ${a2}`,
      `第 ${k} 个数 = ${a1} + ${a2} = ${v}`,
    ],
    steps: [{ text: `第 ${k} 个数是 ${v}`, basis: "利用递推关系逐项计算" }],
    checks: [
      { expr: "a1 + a2 - v", at: { a1, a2, v }, expect: 0 },
      { expr: "t3 - t2 - t1", at: { t3: fibs[2], t2: fibs[1], t1: fibs[0] }, expect: 0 },
      { expr: "t5 - t4 - t3", at: { t5: fibs[4], t4: fibs[3], t3: fibs[2] }, expect: 0 },
    ],
  };
}
