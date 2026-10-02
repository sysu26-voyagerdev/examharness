export const kind = "dynamic/pattern_product_plus_one";
export const covers = ["规律与代数推理"];

const NS = [7, 8, 9, 10, 12];

export function construct(slot, seed) {
  const s = Math.abs(Math.round(seed));
  const n = NS[s % NS.length];
  const right = (n + 1) * (n + 1);
  const prevRight = n * n;
  const left = n * (n + 2) + 1;
  const stem = "观察下列等式：\n第 1 个：1×3＋1＝4＝2²；\n第 2 个：2×4＋1＝9＝3²；\n第 3 个：3×5＋1＝16＝4²；\n……\n按此规律，第 " + n + " 个等式右边是 ______。";
  return {
    params: { n: n, right: right, prevRight: prevRight, left: left },
    stem: stem,
    answer: String(right),
    answerTex: String(right),
    solution: [
      "第 1 个等式左边 1×3＋1＝4，右边 2²；第 2 个左边 2×4＋1＝9，右边 3²；第 3 个左边 3×5＋1＝16，右边 4²。",
      "规律：第 n 个等式为 n(n＋2)＋1＝(n＋1)²，右边是 n＋1 的平方。",
      "抽查第 " + n + " 个：左边 = " + n + "×" + (n + 2) + "＋1 = " + left + "，右边 = (" + n + "＋1)² = " + right + "，左边等于右边，规律成立。",
      "∴ 第 " + n + " 个等式右边是 " + right + "。"
    ],
    steps: [
      { text: "比较前三个等式，归纳出第 n 个等式右边是 (n＋1)²", basis: "从特殊到一般的归纳推理" },
      { text: "用第 n 个等式的左边 n(n＋2)＋1 与右边核对", basis: "代数式求值" },
      { text: "代入 n 求出答案", basis: "代数式求值" }
    ],
    checks: [
      { expr: "n*(n+2) + 1 - right", at: { n: n, right: right }, expect: 0 },
      { expr: "n*n - prevRight", at: { n: n, prevRight: prevRight }, expect: 0 }
    ]
  };
}
