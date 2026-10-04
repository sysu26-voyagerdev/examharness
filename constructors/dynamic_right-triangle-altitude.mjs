export const kind = "dynamic/right-triangle-altitude";
export const covers = ["勾股定理", "直角三角形"];

// 勾股数（直角三角形两直角边 a、b 与斜边 c）
const TRIPLES = [
  [3, 4, 5],
  [6, 8, 10],
  [8, 15, 17],
  [9, 12, 15],
  [7, 24, 25],
  [12, 16, 20]
];

function gcdInt(x, y) {
  let a = Math.abs(x);
  let b = Math.abs(y);
  while (b > 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

function fracTex(num, den) {
  const g = gcdInt(num, den);
  const n = Math.round(num / g);
  const d = Math.round(den / g);
  return d === 1 ? String(n) : "\\frac{" + n + "}{" + d + "}";
}

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

export function construct(slot, seed) {
  const s = ((seed % 18) + 18) % 18;
  const variant = Math.floor(s / 6); // 0：已知两直角边求高；1：已知斜边与一直角边求另一直角边与高；2：求面积与高
  const tri = TRIPLES[s % 6];
  const a = tri[0]; // 直角边 AC
  const b = tri[1]; // 直角边 BC
  const c = tri[2]; // 斜边 AB
  const h = (a * b) / c; // 斜边上的高 CD
  const area = (a * b) / 2;

  // 直角在 C：C=(0,0)、A=(a,0)、B=(0,b)，D 是 C 到 AB 的垂足（图与条件一致）
  const dx = round6((a * b * b) / (a * a + b * b));
  const dy = round6((a * a * b) / (a * a + b * b));

  const figureBase = {
    kind: "plane-geometry",
    points: [
      { label: "C", x: 0, y: 0 },
      { label: "A", x: a, y: 0 },
      { label: "B", x: 0, y: b },
      { label: "D", x: dx, y: dy }
    ],
    segments: [
      { from: "C", to: "A" },
      { from: "A", to: "B" },
      { from: "B", to: "C" },
      { from: "C", to: "D" }
    ],
    rightAngles: [
      { vertex: "C", armA: "A", armB: "B" },
      { vertex: "D", armA: "A", armB: "C" }
    ]
  };

  const params = { angleACB: 90, AC: a, BC: b, AB: c, CD: h, S: area };
  const checks = [
    { expr: "AC*AC+BC*BC-AB*AB", at: { AC: a, BC: b, AB: c }, expect: 0 },
    { expr: "AC*BC-CD*AB", at: { AC: a, BC: b, CD: h, AB: c }, expect: 0 }
  ];
  const perpPhrase = "$CD\\perp AB$，垂足为 $D$";

  if (variant === 0) {
    const figure = Object.assign({}, figureBase, {
      labels: [
        { of: "A-C", text: String(a) },
        { of: "B-C", text: String(b) }
      ]
    });
    return {
      params: params,
      figure: figure,
      stem:
        "如图，在 $\\mathrm{Rt}\\triangle ABC$ 中，$\\angle ACB=90^{\\circ}$，$AC=" + a + "$，$BC=" + b + "$，" +
        perpPhrase + "。求 $CD$ 的长。",
      answer: "$CD=" + fracTex(a * b, c) + "$",
      goal: "求斜边AB上的高CD的长",
      goals: ["求斜边 $AB$ 上的高 $CD$ 的长"],
      givens: ["$\\angle ACB=90^{\\circ}$", "$AC=" + a + "$", "$BC=" + b + "$", "$CD\\perp AB$，垂足为 $D$"],
      solution: [
        "在 $\\mathrm{Rt}\\triangle ABC$ 中，$AB=\\sqrt{AC^{2}+BC^{2}}=\\sqrt{" + a * a + "+" + b * b + "}=" + c + "$。",
        "用面积法：$\\frac{1}{2}AC\\cdot BC=\\frac{1}{2}AB\\cdot CD$，即 $AC\\cdot BC=AB\\cdot CD$。",
        "所以 $CD=\\frac{AC\\cdot BC}{AB}=\\frac{" + a + "\\times" + b + "}{" + c + "}=" + fracTex(a * b, c) + "$。"
      ],
      steps: [
        { text: "由勾股定理求斜边 $AB=" + c + "$", basis: "勾股定理" },
        { text: "用同一个三角形的两种面积表达式建立等式", basis: "面积法" },
        { text: "解出 $CD=" + fracTex(a * b, c) + "$", basis: "等式的基本性质" }
      ],
      checks: checks
    };
  }

  if (variant === 1) {
    const figure = Object.assign({}, figureBase, {
      labels: [
        { of: "A-C", text: String(a) },
        { of: "A-B", text: String(c) }
      ]
    });
    return {
      params: params,
      figure: figure,
      stem:
        "如图，在 $\\mathrm{Rt}\\triangle ABC$ 中，$\\angle ACB=90^{\\circ}$，$AC=" + a + "$，$AB=" + c + "$，" +
        perpPhrase + "。（1）求 $BC$ 的长；（2）求 $CD$ 的长。",
      answer: "$BC=" + b + "$，$CD=" + fracTex(a * b, c) + "$",
      goal: "求BC的长 求斜边AB上的高CD的长",
      goals: ["求 $BC$ 的长", "求斜边 $AB$ 上的高 $CD$ 的长"],
      givens: ["$\\angle ACB=90^{\\circ}$", "$AC=" + a + "$", "$AB=" + c + "$", "$CD\\perp AB$，垂足为 $D$"],
      solution: [
        "在 $\\mathrm{Rt}\\triangle ABC$ 中，$BC=\\sqrt{AB^{2}-AC^{2}}=\\sqrt{" + c * c + "-" + a * a + "}=" + b + "$。",
        "用面积法：$AC\\cdot BC=AB\\cdot CD$。",
        "所以 $CD=\\frac{AC\\cdot BC}{AB}=\\frac{" + a + "\\times" + b + "}{" + c + "}=" + fracTex(a * b, c) + "$。"
      ],
      steps: [
        { text: "由勾股定理求 $BC=" + b + "$", basis: "勾股定理" },
        { text: "用面积法列出 $AC\\cdot BC=AB\\cdot CD$", basis: "面积法" },
        { text: "解得 $CD=" + fracTex(a * b, c) + "$", basis: "等式的基本性质" }
      ],
      checks: checks
    };
  }

  const figure = Object.assign({}, figureBase, {
    labels: [
      { of: "A-C", text: String(a) },
      { of: "B-C", text: String(b) }
    ]
  });
  return {
    params: params,
    figure: figure,
    stem:
      "如图，在 $\\mathrm{Rt}\\triangle ABC$ 中，$\\angle ACB=90^{\\circ}$，$AC=" + a + "$，$BC=" + b + "$，" +
      perpPhrase + "。（1）求 $\\triangle ABC$ 的面积；（2）求 $CD$ 的长。",
    answer: "$S_{\\triangle ABC}=" + fracTex(a * b, 2) + "$，$CD=" + fracTex(a * b, c) + "$",
    goal: "求三角形ABC的面积 求斜边AB上的高CD的长",
    goals: ["求 $\\triangle ABC$ 的面积", "求斜边 $AB$ 上的高 $CD$ 的长"],
    givens: ["$\\angle ACB=90^{\\circ}$", "$AC=" + a + "$", "$BC=" + b + "$", "$CD\\perp AB$，垂足为 $D$"],
    solution: [
      "两直角边为 $AC=" + a + "$、$BC=" + b + "$，所以 $S_{\\triangle ABC}=\\frac{1}{2}\\times " + a + "\\times " + b + "=" + fracTex(a * b, 2) + "$。",
      "在 $\\mathrm{Rt}\\triangle ABC$ 中，$AB=\\sqrt{" + a * a + "+" + b * b + "}=" + c + "$。",
      "用面积法：$AC\\cdot BC=AB\\cdot CD$，所以 $CD=\\frac{" + a + "\\times" + b + "}{" + c + "}=" + fracTex(a * b, c) + "$。"
    ],
    steps: [
      { text: "由两直角边求面积 $S=" + fracTex(a * b, 2) + "$", basis: "三角形面积公式" },
      { text: "由勾股定理求斜边 $AB=" + c + "$", basis: "勾股定理" },
      { text: "由面积法得 $CD=" + fracTex(a * b, c) + "$", basis: "面积法" }
    ],
    checks: checks.concat([
      { expr: "2*S-AC*BC", at: { S: area, AC: a, BC: b }, expect: 0 }
    ])
  };
}
