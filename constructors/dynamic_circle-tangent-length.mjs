export const kind = "dynamic/circle-tangent-length"
export const covers = ["圆与切线"]

const TAN = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20], [7, 24, 25], [20, 21, 29]]
const INC = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [20, 21, 29], [10, 24, 26]]
const DIAM = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20], [7, 24, 25], [20, 21, 29]]
const SQ = [3, 4, 5, 6, 8, 10, 12]

export function construct(slot, seed) {
  const s = Math.abs(Math.floor(seed)) || 0
  const v = s % 4
  const i = (s - v) / 4

  if (v === 1) {
    const t = INC[i % INC.length]
    const a = t[0]
    const b = t[1]
    const c = t[2]
    const r = (a + b - c) / 2
    const AD = a - r
    const BD = b - r
    return {
      params: { a: a, b: b, c: c, r: r, AD: AD, BD: BD, variant: 1 },
      stem: "如图，在 $\\mathrm{Rt}\\triangle ABC$ 中，$\\angle C=90^\\circ$，$AC=" + a + "$，$BC=" + b + "$，$\\odot I$ 是 $\\triangle ABC$ 的内切圆，与 $AC$、$BC$、$AB$ 分别相切于点 $E$、$F$、$D$。（1）求 $\\odot I$ 的半径；（2）求 $AD$ 的长；（3）求 $BD$ 的长。",
      answer: "（1）⊙I 的半径 = " + r + "；（2）AD = " + AD + "；（3）BD = " + BD,
      goal: "求三角形内切圆的半径 求线段 AD 的长 求线段 BD 的长",
      goals: ["求 $\\odot I$ 的半径", "求 $AD$ 的长", "求 $BD$ 的长"],
      givens: ["$\\angle C=90^\\circ$", "$AC=" + a + "$", "$BC=" + b + "$", "$\\odot I$ 是 $\\triangle ABC$ 的内切圆", "$\\odot I$ 与 $AC$、$BC$、$AB$ 分别相切于点 $E$、$F$、$D$"],
      solution: [
        "由勾股定理，$AB=\\sqrt{AC^{2}+BC^{2}}=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + c + "$。",
        "设内切圆半径为 $r$，同一点引圆的两条切线长相等，故 $AB=(AC-r)+(BC-r)$，即 $" + c + "=" + a + "+" + b + "-2r$，解得 $r=" + r + "$。",
        "由切线长相等，$AD=AE=AC-CE=" + a + "-" + r + "=" + AD + "$。",
        "同样 $BD=BF=BC-CF=" + b + "-" + r + "=" + BD + "$，且 $AD+BD=" + AD + "+" + BD + "=" + c + "=AB$。"
      ],
      steps: [
        { text: "$AB=\\sqrt{" + a + "^{2}+" + b + "^{2}}=" + c + "$。", basis: "勾股定理" },
        { text: "由 $" + a + "-r+" + b + "-r=" + c + "$ 得 $r=" + r + "$。", basis: "切线长定理" },
        { text: "$AD=AC-r=" + AD + "$，$BD=BC-r=" + BD + "$。", basis: "切线长定理" }
      ],
      checks: [
        { expr: "r*2-(a+b-c)", at: { r: r, a: a, b: b, c: c }, expect: 0 },
        { expr: "AD-(a-r)", at: { AD: AD, a: a, r: r }, expect: 0 },
        { expr: "AD+BD-c", at: { AD: AD, BD: BD, c: c }, expect: 0 }
      ]
    }
  }

  if (v === 2) {
    const t = DIAM[i % DIAM.length]
    const r = t[0]
    const ac = t[1]
    const d = t[2]
    const cd = d - r
    const area = r * ac / 2
    return {
      params: { r: r, ac: ac, d: d, cd: cd, area: area, variant: 2 },
      stem: "如图，$AB$ 是 $\\odot O$ 的直径，$AC$ 是 $\\odot O$ 的切线，$A$ 为切点，$\\odot O$ 的半径为 $" + r + "$，$AC=" + ac + "$，连接 $OC$ 交 $\\odot O$ 于点 $D$。（1）求 $OC$ 的长；（2）求 $CD$ 的长；（3）求 $\\triangle OAC$ 的面积。",
      answer: "（1）OC = " + d + "；（2）CD = " + cd + "；（3）△OAC 的面积 = " + area,
      goal: "求 OC 的长 求 CD 的长 求三角形 OAC 的面积",
      goals: ["求 $OC$ 的长", "求 $CD$ 的长", "求 $\\triangle OAC$ 的面积"],
      givens: ["$AB$ 是 $\\odot O$ 的直径", "$AC$ 切 $\\odot O$ 于点 $A$", "$\\odot O$ 的半径为 $" + r + "$", "$AC=" + ac + "$", "$OC$ 交 $\\odot O$ 于点 $D$"],
      solution: [
        "因为 $AC$ 切 $\\odot O$ 于点 $A$，所以 $OA\\perp AC$，$\\angle OAC=90^\\circ$。",
        "在 $\\mathrm{Rt}\\triangle OAC$ 中，$OC=\\sqrt{OA^{2}+AC^{2}}=\\sqrt{" + r + "^{2}+" + ac + "^{2}}=" + d + "$。",
        "点 $D$ 既在 $OC$ 上又在 $\\odot O$ 上，$OD=OA=" + r + "$，所以 $CD=OC-OD=" + d + "-" + r + "=" + cd + "$。",
        "$S_{\\triangle OAC}=\\dfrac{1}{2}OA\\cdot AC=\\dfrac{1}{2}\\times " + r + "\\times " + ac + "=" + area + "$。"
      ],
      steps: [
        { text: "$OA\\perp AC$，$OC=\\sqrt{" + r + "^{2}+" + ac + "^{2}}=" + d + "$。", basis: "切线的性质；勾股定理" },
        { text: "$CD=OC-OD=" + d + "-" + r + "=" + cd + "$。", basis: "同圆的半径相等" },
        { text: "$S_{\\triangle OAC}=\\dfrac{1}{2}OA\\cdot AC=" + area + "$。", basis: "三角形面积公式" }
      ],
      checks: [
        { expr: "d*d-r*r-ac*ac", at: { d: d, r: r, ac: ac }, expect: 0 },
        { expr: "cd-(d-r)", at: { cd: cd, d: d, r: r }, expect: 0 },
        { expr: "area*2-r*ac", at: { area: area, r: r, ac: ac }, expect: 0 }
      ]
    }
  }

  if (v === 3) {
    const r = SQ[i % SQ.length]
    const area = r * r
    const perim = 4 * r
    return {
      params: { r: r, PA: r, area: area, perim: perim, variant: 3 },
      stem: "如图，$PA$、$PB$ 是 $\\odot O$ 的两条切线，$A$、$B$ 为切点，$\\angle APB=90^\\circ$，$\\odot O$ 的半径为 $" + r + "$。（1）求切线长 $PA$；（2）求四边形 $OAPB$ 的面积；（3）求四边形 $OAPB$ 的周长。",
      answer: "（1）PA = " + r + "；（2）四边形 OAPB 的面积 = " + area + "；（3）四边形 OAPB 的周长 = " + perim,
      goal: "求切线长 PA 求四边形 OAPB 的面积 求四边形 OAPB 的周长",
      goals: ["求切线长 $PA$", "求四边形 $OAPB$ 的面积", "求四边形 $OAPB$ 的周长"],
      givens: ["$PA$、$PB$ 是 $\\odot O$ 的两条切线", "$A$、$B$ 为切点", "$\\angle APB=90^\\circ$", "$\\odot O$ 的半径为 $" + r + "$"],
      solution: [
        "$PA$ 切 $\\odot O$ 于 $A$，$PB$ 切 $\\odot O$ 于 $B$，所以 $OA\\perp PA$，$OB\\perp PB$，$\\angle OAP=\\angle OBP=90^\\circ$。",
        "由切线长定理 $PA=PB$，又 $\\angle APB=90^\\circ$，所以四边形 $OAPB$ 是正方形，$PA=OA=" + r + "$。",
        "四边形 $OAPB$ 的面积 $=" + r + "\\times " + r + "=" + area + "$。",
        "四边形 $OAPB$ 的周长 $=4\\times " + r + "=" + perim + "$。"
      ],
      steps: [
        { text: "$\\angle OAP=\\angle OBP=90^\\circ$，$PA=PB$，$\\angle APB=90^\\circ$，故 $OAPB$ 是正方形，$PA=OA=" + r + "$。", basis: "切线的性质；切线长定理；正方形的判定" },
        { text: "$S=" + r + "^{2}=" + area + "$。", basis: "正方形面积公式" },
        { text: "周长 $=4\\times " + r + "=" + perim + "$。", basis: "正方形的四条边相等" }
      ],
      checks: [
        { expr: "PA-r", at: { PA: r, r: r }, expect: 0 },
        { expr: "area-r*r", at: { area: area, r: r }, expect: 0 },
        { expr: "perim-4*r", at: { perim: perim, r: r }, expect: 0 }
      ]
    }
  }

  const t = TAN[i % TAN.length]
  const r = t[0]
  const tan = t[1]
  const d = t[2]
  const area = r * tan / 2
  const perim = 2 * (tan + r)
  return {
    params: { r: r, tanLen: tan, d: d, area: area, perim: perim, variant: 0 },
    stem: "如图，$PA$ 是 $\\odot O$ 的切线，$A$ 为切点，点 $P$ 在 $\\odot O$ 外，$\\odot O$ 的半径为 $" + r + "$，$OP=" + d + "$，过点 $P$ 作 $\\odot O$ 的另一条切线 $PB$，$B$ 为切点。（1）求切线长 $PA$；（2）求 $\\triangle OAP$ 的面积；（3）求四边形 $OAPB$ 的周长。",
    answer: "（1）PA = " + tan + "；（2）△OAP 的面积 = " + area + "；（3）四边形 OAPB 的周长 = " + perim,
    goal: "求切线长 PA 求三角形 OAP 的面积 求四边形 OAPB 的周长",
    goals: ["求切线长 $PA$", "求 $\\triangle OAP$ 的面积", "求四边形 $OAPB$ 的周长"],
    givens: ["$PA$ 切 $\\odot O$ 于点 $A$", "$\\odot O$ 的半径为 $" + r + "$", "$OP=" + d + "$", "$PB$ 切 $\\odot O$ 于点 $B$"],
    solution: [
      "因为 $PA$ 切 $\\odot O$ 于点 $A$，所以 $OA\\perp PA$，$\\angle OAP=90^\\circ$，$OA=" + r + "$。",
      "在 $\\mathrm{Rt}\\triangle OAP$ 中，$PA=\\sqrt{OP^{2}-OA^{2}}=\\sqrt{" + d + "^{2}-" + r + "^{2}}=" + tan + "$。",
      "$S_{\\triangle OAP}=\\dfrac{1}{2}OA\\cdot PA=\\dfrac{1}{2}\\times " + r + "\\times " + tan + "=" + area + "$。",
      "由切线长定理 $PB=PA=" + tan + "$，又 $OB=OA=" + r + "$，所以四边形 $OAPB$ 的周长为 $" + tan + "+" + r + "+" + tan + "+" + r + "=" + perim + "$。"
    ],
    steps: [
      { text: "$OA\\perp PA$，$PA=\\sqrt{" + d + "^{2}-" + r + "^{2}}=" + tan + "$。", basis: "切线的性质；勾股定理" },
      { text: "$S_{\\triangle OAP}=\\dfrac{1}{2}OA\\cdot PA=" + area + "$。", basis: "三角形面积公式" },
      { text: "$PB=PA$，周长 $=2(PA+OA)=" + perim + "$。", basis: "切线长定理" }
    ],
    checks: [
      { expr: "tanLen*tanLen+r*r-d*d", at: { tanLen: tan, r: r, d: d }, expect: 0 },
      { expr: "area*2-r*tanLen", at: { area: area, r: r, tanLen: tan }, expect: 0 },
      { expr: "perim-2*(tanLen+r)", at: { perim: perim, tanLen: tan, r: r }, expect: 0 }
    ]
  }
}
