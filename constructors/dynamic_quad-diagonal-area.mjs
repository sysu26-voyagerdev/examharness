export const kind = "dynamic/quad-diagonal-area"
export const covers = ["四边形与证明"]

const RHOMB = [[3, 4], [6, 8], [9, 12], [12, 16]]
const RECT = [[6, 8, 10], [9, 12, 15], [5, 12, 13], [8, 15, 17], [15, 20, 25], [10, 24, 26], [7, 24, 25], [20, 21, 29], [12, 16, 20], [18, 24, 30]]
const RH2 = [[5, 3, 4], [10, 6, 8], [13, 5, 12], [25, 7, 24], [17, 8, 15], [15, 9, 12]]
const PARA = [[8, 6, 4], [12, 5, 4], [10, 8, 5], [6, 9, 3], [15, 4, 5], [9, 10, 6], [14, 6, 7], [12, 7, 6]]

function gcd(a, b) {
  let x = a < 0 ? -a : a
  let y = b < 0 ? -b : b
  while (y > 0) { const t = x % y; x = y; y = t }
  return x
}

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) || 0
  const v = s % 4
  const i = (s - v) / 4

  if (v === 1) {
    const t = RECT[i % RECT.length]
    const p = t[0]
    const q = t[1]
    const diag = t[2]
    const area = p * q
    const tri = area / 4
    return {
      params: { p: p, q: q, diag: diag, area: area, tri: tri, variant: 1 },
      stem: "如图，在矩形 $ABCD$ 中，对角线 $AC$ 与 $BD$ 相交于点 $O$，$AB=" + p + "$，$BC=" + q + "$。（1）求对角线 $AC$ 的长；（2）求矩形 $ABCD$ 的面积；（3）求 $\\triangle AOB$ 的面积。",
      answer: "（1）对角线 AC = " + diag + "；（2）矩形 ABCD 的面积 = " + area + "；（3）△AOB 的面积 = " + tri,
      goal: "求矩形对角线 AC 的长 求矩形 ABCD 的面积 求三角形 AOB 的面积",
      goals: ["求对角线 $AC$ 的长", "求矩形 $ABCD$ 的面积", "求 $\\triangle AOB$ 的面积"],
      givens: ["四边形 $ABCD$ 是矩形", "$AB=" + p + "$", "$BC=" + q + "$", "对角线 $AC$ 与 $BD$ 相交于点 $O$"],
      solution: [
        "因为四边形 $ABCD$ 是矩形，所以 $\\angle ABC=90^\\circ$。",
        "在 $\\mathrm{Rt}\\triangle ABC$ 中，$AC=\\sqrt{AB^{2}+BC^{2}}=\\sqrt{" + p + "^{2}+" + q + "^{2}}=" + diag + "$。",
        "矩形 $ABCD$ 的面积 $S=AB\\cdot BC=" + p + "\\times " + q + "=" + area + "$。",
        "矩形的对角线互相平分，$O$ 是 $AC$ 的中点，$S_{\\triangle AOB}=\\dfrac{1}{4}S=" + tri + "$。"
      ],
      steps: [
        { text: "$AC^{2}=AB^{2}+BC^{2}=" + p + "^{2}+" + q + "^{2}$，所以 $AC=" + diag + "$。", basis: "勾股定理" },
        { text: "$S=AB\\cdot BC=" + area + "$。", basis: "矩形面积公式" },
        { text: "$O$ 为 $AC$ 的中点，$S_{\\triangle AOB}=\\dfrac{1}{4}S=" + tri + "$。", basis: "矩形的对角线互相平分" }
      ],
      checks: [
        { expr: "diag*diag-p*p-q*q", at: { diag: diag, p: p, q: q }, expect: 0 },
        { expr: "area-p*q", at: { area: area, p: p, q: q }, expect: 0 },
        { expr: "tri*4-area", at: { tri: tri, area: area }, expect: 0 }
      ]
    }
  }

  if (v === 2) {
    const t = RH2[i % RH2.length]
    const side = t[0]
    const half1 = t[1]
    const half2 = t[2]
    const d1 = 2 * half1
    const d2 = 2 * half2
    const area = d1 * d2 / 2
    const perim = 4 * side
    return {
      params: { side: side, diag1: d1, diag2: d2, area: area, perim: perim, variant: 2 },
      stem: "如图，在菱形 $ABCD$ 中，$AB=" + side + "$，对角线 $AC=" + d1 + "$，$AC$ 与 $BD$ 相交于点 $O$。（1）求对角线 $BD$ 的长；（2）求菱形 $ABCD$ 的面积；（3）求菱形 $ABCD$ 的周长。",
      answer: "（1）对角线 BD = " + d2 + "；（2）菱形 ABCD 的面积 = " + area + "；（3）菱形 ABCD 的周长 = " + perim,
      goal: "求对角线 BD 的长 求菱形的面积 求菱形的周长",
      goals: ["求对角线 $BD$ 的长", "求菱形 $ABCD$ 的面积", "求菱形 $ABCD$ 的周长"],
      givens: ["四边形 $ABCD$ 是菱形", "$AB=" + side + "$", "对角线 $AC=" + d1 + "$", "对角线 $AC$ 与 $BD$ 相交于点 $O$"],
      solution: [
        "菱形的对角线互相垂直平分，所以 $AO=\\dfrac{1}{2}AC=" + half1 + "$，且 $AO\\perp BO$。",
        "在 $\\mathrm{Rt}\\triangle AOB$ 中，$BO=\\sqrt{AB^{2}-AO^{2}}=\\sqrt{" + side + "^{2}-" + half1 + "^{2}}=" + half2 + "$，所以 $BD=2\\times " + half2 + "=" + d2 + "$。",
        "菱形的面积 $S=\\dfrac{1}{2}AC\\cdot BD=\\dfrac{1}{2}\\times " + d1 + "\\times " + d2 + "=" + area + "$。",
        "菱形四边相等，周长 $=4\\times " + side + "=" + perim + "$。"
      ],
      steps: [
        { text: "$BO=\\sqrt{AB^{2}-AO^{2}}=\\sqrt{" + side + "^{2}-" + half1 + "^{2}}=" + half2 + "$，$BD=2\\times " + half2 + "=" + d2 + "$。", basis: "菱形的对角线互相垂直平分；勾股定理" },
        { text: "$S=\\dfrac{1}{2}AC\\cdot BD=" + area + "$。", basis: "菱形面积公式" },
        { text: "周长 $=4AB=" + perim + "$。", basis: "菱形的四条边相等" }
      ],
      checks: [
        { expr: "side*side-half1*half1-half2*half2", at: { side: side, half1: half1, half2: half2 }, expect: 0 },
        { expr: "area*2-diag1*diag2", at: { area: area, diag1: d1, diag2: d2 }, expect: 0 },
        { expr: "perim-4*side", at: { perim: perim, side: side }, expect: 0 }
      ]
    }
  }

  if (v === 3) {
    const t = PARA[i % PARA.length]
    const m = t[0]
    const k = t[1]
    const j = t[2]
    const area = m * k
    const ad = area / j
    const perim = 2 * (m + ad)
    return {
      params: { m: m, k: k, j: j, area: area, ad: ad, perim: perim, variant: 3 },
      stem: "如图，在平行四边形 $ABCD$ 中，$AB=" + m + "$，$AB$ 边上的高为 $" + k + "$，$AD$ 边上的高为 $" + j + "$。（1）求平行四边形 $ABCD$ 的面积；（2）求 $AD$ 的长；（3）求平行四边形 $ABCD$ 的周长。",
      answer: "（1）平行四边形 ABCD 的面积 = " + area + "；（2）AD = " + ad + "；（3）平行四边形 ABCD 的周长 = " + perim,
      goal: "求平行四边形的面积 求 AD 的长 求平行四边形的周长",
      goals: ["求平行四边形 $ABCD$ 的面积", "求 $AD$ 的长", "求平行四边形 $ABCD$ 的周长"],
      givens: ["四边形 $ABCD$ 是平行四边形", "$AB=" + m + "$", "$AB$ 边上的高为 $" + k + "$", "$AD$ 边上的高为 $" + j + "$"],
      solution: [
        "以 $AB$ 为底，$AB$ 边上的高为 $" + k + "$，所以 $S=" + m + "\\times " + k + "=" + area + "$。",
        "以 $AD$ 为底时，$AD$ 边上的高为 $" + j + "$，由 $AD\\cdot " + j + "=S=" + area + "$ 得 $AD=\\dfrac{" + area + "}{" + j + "}=" + ad + "$。",
        "平行四边形的对边相等，周长 $=2(AB+AD)=2\\times(" + m + "+" + ad + ")=" + perim + "$。"
      ],
      steps: [
        { text: "$S=AB\\times " + k + "=" + area + "$。", basis: "平行四边形面积公式" },
        { text: "$AD=S\\div " + j + "=" + ad + "$。", basis: "同一面积两种算法（面积法）" },
        { text: "周长 $=2(AB+AD)=" + perim + "$。", basis: "平行四边形的对边相等" }
      ],
      checks: [
        { expr: "area-m*k", at: { area: area, m: m, k: k }, expect: 0 },
        { expr: "ad*j-area", at: { ad: ad, j: j, area: area }, expect: 0 },
        { expr: "perim-2*(m+ad)", at: { perim: perim, m: m, ad: ad }, expect: 0 }
      ]
    }
  }

  const rh = RHOMB[i % RHOMB.length]
  const h1 = rh[0]
  const h2 = rh[1]
  const d1 = 2 * h1
  const d2 = 2 * h2
  const side = Math.round(Math.sqrt(h1 * h1 + h2 * h2))
  const area = 2 * h1 * h2
  const g = gcd(area, side)
  const hNum = area / g
  const hDen = side / g
  return {
    params: { half1: h1, half2: h2, diag1: d1, diag2: d2, side: side, area: area, heightNum: hNum, heightDen: hDen, variant: 0 },
    stem: "如图，在菱形 $ABCD$ 中，对角线 $AC$ 与 $BD$ 相交于点 $O$，$AC=" + d1 + "$，$BD=" + d2 + "$。（1）求菱形 $ABCD$ 的边长；（2）求菱形 $ABCD$ 的面积；（3）求菱形 $ABCD$ 的边上的高。",
    answer: "（1）菱形 ABCD 的边长 = " + side + "；（2）菱形 ABCD 的面积 = " + area + "；（3）菱形 ABCD 的边上的高 = " + hNum + "/" + hDen,
    goal: "求菱形的边长 求菱形的面积 求菱形边上的高",
    goals: ["求菱形 $ABCD$ 的边长", "求菱形 $ABCD$ 的面积", "求菱形 $ABCD$ 边上的高"],
    givens: ["四边形 $ABCD$ 是菱形", "$AC=" + d1 + "$", "$BD=" + d2 + "$", "对角线 $AC$ 与 $BD$ 相交于点 $O$"],
    solution: [
      "菱形的对角线互相垂直平分，所以 $AC\\perp BD$，$AO=\\dfrac{1}{2}AC=" + h1 + "$，$BO=\\dfrac{1}{2}BD=" + h2 + "$。",
      "在 $\\mathrm{Rt}\\triangle AOB$ 中，$AB=\\sqrt{AO^{2}+BO^{2}}=\\sqrt{" + h1 + "^{2}+" + h2 + "^{2}}=" + side + "$。",
      "菱形的面积等于两条对角线乘积的一半：$S=\\dfrac{1}{2}\\times " + d1 + "\\times " + d2 + "=" + area + "$。",
      "设菱形边上的高为 $h$，由 $AB\\cdot h=S$ 得 $h=\\dfrac{" + area + "}{" + side + "}=\\dfrac{" + hNum + "}{" + hDen + "}$。"
    ],
    steps: [
      { text: "$AO=" + h1 + "$，$BO=" + h2 + "$，$AB=\\sqrt{" + h1 + "^{2}+" + h2 + "^{2}}=" + side + "$。", basis: "菱形的对角线互相垂直平分；勾股定理" },
      { text: "$S=\\dfrac{1}{2}AC\\cdot BD=" + area + "$。", basis: "菱形面积公式" },
      { text: "$AB\\cdot h=S$，所以 $h=\\dfrac{" + area + "}{" + side + "}=\\dfrac{" + hNum + "}{" + hDen + "}$。", basis: "面积法" }
    ],
    checks: [
      { expr: "side*side-half1*half1-half2*half2", at: { side: side, half1: h1, half2: h2 }, expect: 0 },
      { expr: "area-2*half1*half2", at: { area: area, half1: h1, half2: h2 }, expect: 0 },
      { expr: "heightNum*side-area*heightDen", at: { heightNum: hNum, side: side, area: area, heightDen: hDen }, expect: 0 }
    ]
  }
}
