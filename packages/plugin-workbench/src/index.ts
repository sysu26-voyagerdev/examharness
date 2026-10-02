import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Service, type Context } from "@deepseek-ai/cordis";
import { parseJsonObject } from "@examharness/core";
import type {
  Blueprint,
  Cognitive,
  QuestionType,
  BlueprintRow,
  Item,
  LlmMessage,
  LlmToolSpec,
  WorkbenchApi,
  WorkbenchEvent,
  WorkbenchRequest,
  WorkbenchRun,
  WorkspaceFile,
  WorkspaceRun,
} from "@examharness/core";
import z from "schemastery";

/**
 * agent 工作台。
 *
 * 形状（docs/agent/01 §6）：
 *   - **内环**：模型自己决定查图谱、构造、提交，想迭代几轮迭代几轮；
 *   - **外环**：`submit_item` 是唯一的收尾动作，它内部必然跑闸门链——
 *     模型既不能跳过、也不能改写判定（验证不能被被验证者调度）；
 *   - 判定结果**结构化地**回给模型（哪道闸门、为什么、可不可修），而不是一句"重做"。
 *
 * 顺带一条工程约束：候选题存在工作台里，模型只传 candidateId——
 * 不让它复述题干，避免"模型抄错自己的题"这种低级失败。
 */

export const name = "workbench";
export const inject = ["llm", "graph", "bank", "construct"];

/**
 * 工作区（ADR-0020）：agent 的**手脚**——不只知识库那支 agent，主 agent 一样有。
 *
 * `in/` 原件副本 · `tmp/` 自己写的脚本 · `out/` 产物。
 * 要跑的东西**先落成文件**（不许 `-c` 内联代码），跑出来的东西留在目录里可复查；
 * 产物是**草稿不是真值**：数学结论仍然只能由构造与符号计算给出，闸门才是裁判（R1/R2）。
 */

export const Config = z.object({
  /** 会话约定之外，额外给模型的硬规矩 */
  extraRules: z.string().default(""),
  /**
   * 单条工具结果进上下文的上限（字符）。
   * 资料动辄几十万字，全塞进去必然爆；超了就截断，并**如实告诉模型**完整内容在哪个文件里。
   */
  toolResultLimit: z.number().default(6000),
});

export interface WorkbenchConfig {
  extraRules: string;
  toolResultLimit: number;
}

/**
 * **没有步数上限**（ADR-0006：不为成本做架构）。
 * 停下这一轮的方式只有两个：模型自己不再调工具，或者老师说停。
 * 加一个人为的步数帽子，等于让"跑到一半被砍断"变成正常现象——那是把成本问题伪装成产品行为。
 */

interface Candidate {
  id: string;
  slot: BlueprintRow;
  item: Item;
}

/** 一轮 agent 循环的状态：过程要走事件流出去，中途还要能被插话/叫停 */
interface RunState {
  id: string;
  request: WorkbenchRequest;
  workspace?: WorkspaceHandle;
  transcript: WorkbenchEvent[];
  stored: string[];
  /** 老师插的话：下一步开始时读进上下文 */
  inbox: string[];
  stopRequested: boolean;
  steps: number;
  done: Promise<WorkbenchRun>;
}

/** 本轮工作区的句柄：模型只给相对路径，绝对路径由服务持有（它就不必知道仓库在哪） */
interface WorkspaceHandle {
  name: string;
  path: string;
  files: readonly WorkspaceFile[];
  list: () => readonly WorkspaceFile[];
  read: (
    relPath: string,
    offset?: number,
    limit?: number,
  ) => { text: string; total: number; next?: number } | undefined;
  write: (relPath: string, text: string) => { path: string; bytes: number } | undefined;
  run: (argv: readonly string[], timeoutMs?: number) => WorkspaceRun;
}

const TOOLS: readonly LlmToolSpec[] = [
  {
    name: "graph_query",
    description: "查一组知识点的前置闭包，以及是否超出已学范围（超纲）。设计题目前先用它。",
    parameters: {
      type: "object",
      properties: { knowledge: { type: "array", items: { type: "string" } } },
      required: ["knowledge"],
    },
  },
  {
    name: "construct_item",
    description:
      "按题位构造一道候选题（按构造为真）。返回 candidateId，此时还没入库。" +
      "同一个题位可能有好几个题型（入门小题、多问综合题…）：默认用第一个，也可以用 kind 指定；" +
      "gap_report 会告诉你这个题位有哪些题型、各自为什么没出成题。",
    parameters: {
      type: "object",
      properties: {
        slotKey: { type: "string" },
        seed: { type: "number" },
        kind: { type: "string", description: "指定用哪个题型（不填就用这个题位的第一个）" },
      },
      required: ["slotKey", "seed"],
    },
  },
  {
    name: "serialize_item",
    description:
      "让执笔者把候选题的结构写成给学生看的题面（提交时框架会自动写一次；" +
      "想先看一眼、或对写出来的题面不满意时，用它重写）。题面随后会过回译校验：" +
      "分问数、条件条数、答案、题面里出现的每个数字都要与构造对得上。",
    parameters: {
      type: "object",
      properties: { candidateId: { type: "string" } },
      required: ["candidateId"],
    },
  },
  {
    name: "submit_item",
    description:
      "提交候选题：先让执笔者写题面，再跑完整闸门链，通过才入库。" +
      "不通过会返回哪道闸门、为什么、能不能靠重做修好。",
    parameters: {
      type: "object",
      properties: { candidateId: { type: "string" } },
      required: ["candidateId"],
    },
  },
  {
    name: "bank_stats",
    description: "看题库现状：已入库多少题、每个题位各有多少。",
    parameters: { type: "object", properties: {} },
  },
];

const CORPUS_TOOLS: readonly LlmToolSpec[] = [
  {
    name: "corpus_search",
    description:
      "在真实题库/教材素材里检索（按知识点或关键词），返回摘要。用来参考真实题的表述与难度。" +
      "检索到的是**素材，不是真值**。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "关键词；可留空，只按知识点找" },
        knowledge: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "corpus_read",
    description:
      "读某条素材的全文（题干+答案）。**只能参考表述与结构，不得把原文抄进题面**——查重闸门会拦。",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "corpus_compare",
    description:
      "把你打算用的题面与素材库对比，返回两个指标：数字重合度（数学上是不是同一道题）与措辞相似度。" +
      "数字重合度达到阈值就说明是原题换皮，必须改。",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
];

const WEB_SEARCH_TOOL: LlmToolSpec = {
  name: "web_search",
  description:
    "联网搜索。查情境/数据是否真实、课标原文、某道题是否已公开存在。" +
    "返回结果**只是素材，不是真值**；不得把网上的题抄进题面。",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, limit: { type: "number" } },
    required: ["query"],
  },
};

const WORKSPACE_TOOLS: readonly LlmToolSpec[] = [
  {
    name: "ws_ls",
    description: "列工作区里的文件（in/ 原件、tmp/ 你的脚本、out/ 产物）。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ws_read",
    description:
      "分片读工作区里的文本文件：给 offset/limit 翻页，别一次读整份（和 kb_read 一样的规矩）。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "ws_write",
    description: "在工作区写一个文件（一般写 tmp/ 下的脚本）。要跑的东西先写下来，再 ws_run 跑它。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, text: { type: "string" } },
      required: ["path", "text"],
    },
  },
  {
    name: "ws_grep",
    description:
      "在工作区的文本文件里找一段（正则或普通词），返回命中的行号与上下文——" +
      "用来在几十万字的资料里定位「例 93」「【说明】」这类目标，别整篇读。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        max: { type: "number" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ws_run",
    description:
      "在工作区里跑一条命令（cwd = 工作区，逐个参数传，不过 shell）：" +
      'argv 是数组，例如 ["python3","tmp/extract.py"]、["pdftotext","in/a.pdf","out/a.txt"]。' +
      "python3/pip 优先用仓库的虚拟环境 .venv。不许 -c 内联代码，不许工作区之外的路径。",
    parameters: {
      type: "object",
      properties: {
        argv: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "number" },
      },
      required: ["argv"],
    },
  },
];

/**
 * 把题型模块落盘。
 * - 正常交的题型进仓库的 `constructors/`：题型是**能力产出**，该被版本化、被团队共享；
 * - `temporary` 的进 `data/constructors/`（本机实验目录，不进 git）：
 *   agent 做试验时写的探针模块**不许留在共享目录里**——它们也声明 covers，
 *   会被组卷选中（真实踩过：一个探针题型把 S23 的 9 分综合题位顶成了"写出顶点坐标"）。
 */
function writeConstructor(kindName: string, code: string, temporary = false): string {
  const root = process.cwd();
  const dir = join(root, temporary ? "data/constructors" : "constructors");
  mkdirSync(dir, { recursive: true });
  const safe = kindName.replace(/[^\w.-]/g, "_").slice(0, 60) || `dynamic-${String(Date.now())}`;
  const file = join(dir, `${safe}.mjs`);
  writeFileSync(file, code, "utf8");
  return file;
}

/** 题位里允许的水平与题型（写错就退回默认，别让坏值进蓝图） */
const COGNITIVE = new Set(["了解", "理解", "掌握", "灵活运用"]);
const QUESTION_TYPE = new Set(["选择", "填空", "解答"]);

const GAP_TOOL: LlmToolSpec = {
  name: "gap_report",
  description:
    "列出**当前组卷的缺口**：每个缺口题位的知识点、题型、分值、以及它在真题里最常考的领域与支持卷数。" +
    '要"自己把缺口补上"就先调它——它会告诉你缺什么、该往哪个方向写题型。',
  parameters: { type: "object", properties: {}, required: [] },
};

const CONSTRUCTOR_TOOL: LlmToolSpec = {
  name: "constructor_write",
  description:
    "**制作一个新题型**（运行时生效，不用人改代码）：写一个模块到 constructors/，框架立刻验收——" +
    "静态安全检查、契约完整、同种子可复现、不同种子有差异、**检验点能区分对错**（把参数改坏它必须失败）。" +
    "通过就注册生效，下一步就能按蓝图出这种题；不通过会把问题原样告诉你，改完再交。\n" +
    "**试验用 temporary: true**（写到 data/constructors/，不留在共享题型目录里）。\n" +
    "两条铁律：**顶层代码要轻**（它在 import 那一刻就会执行：别在上面造大数组、别放循环）；" +
    "**循环一定要有终止条件**（`for (let i = -4; i <= -1; i = i - 1)` 会一直转下去，验收进程会被内存上限杀掉）。\n" +
    "模块格式（ESM，只许做计算，不许文件/网络/子进程）：\n" +
    '  export const kind = "dynamic/xxx"        // 题型名\n' +
    '  export const covers = ["知识点"]         // 覆盖哪些知识点（最多 6 个）\n' +
    "  export function construct(slot, seed) {\n" +
    '    return { params: {...数字}, stem: "题面（数学写在正文里：$y=x^{2}+6x+8$）",\n' +
    '             answer: "答案（同样用 $…$ 写数学）",\n' +
    '             goal: "题目要求什么（几个短句，空格分开）",\n' +
    '             goals: ["每一问一句（8 分以上的解答题至少两条）"],\n' +
    '             givens: ["题面显式给出的条件，一条一个"],\n' +
    '             solution: ["解题步骤（数学也用 $…$）"], steps: [{text, basis}],\n' +
    '             checks: [{ expr: "把 at 代进去该等于什么", at: {...}, expect: 0 }] }\n' +
    "  }\n" +
    '**goal 与 givens 要写**：题面被模型重写后，回译闸门就是拿它们核对"有没有写漏、写歪"的；\n' +
    '不写这两项，那份题面就只能落到"待复核"。\n' +
    'checks 是**框架用来独立核对的事实**（求值器是框架的）：比如"根代回多项式为 0"、' +
    '"两点都满足解析式"。写得越具体越好；只写恒等式（如 a-a=0）会被判无效。',
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string" },
      covers: { type: "array", items: { type: "string" } },
      code: { type: "string" },
      temporary: {
        type: "boolean",
        description: "只是做试验：写到 data/constructors/（不进仓库，不会被当成正式题型留着）",
      },
    },
    required: ["kind", "covers", "code"],
  },
};

const BLUEPRINT_TOOLS: readonly LlmToolSpec[] = [
  {
    name: "blueprint_list",
    description:
      "看蓝图库里有哪些模板（课后作业、单元测验……）。" +
      "**老师要的卷子规格和现在这份不一样时，先看库，别硬改共享模板。**",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "blueprint_read",
    description: "读一份蓝图的卷头与题位表（题位 key、知识点、水平、题型、道数、分值、难度）。",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "blueprint_create",
    description:
      "新建一份蓝图（会存成**你的草稿**，老师改完才算数）。题位只能写构造器覆盖得了的知识点：" +
      "与坐标轴交点 / 对称轴 / 顶点式；写别的会变成组卷时补不上的缺口。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        minutes: { type: "number" },
        slots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              knowledge: { type: "array", items: { type: "string" } },
              cognitive: { type: "string" },
              type: { type: "string" },
              count: { type: "number" },
              score: { type: "number" },
              difficulty: { type: "array", items: { type: "number" } },
            },
            required: ["knowledge"],
          },
        },
      },
      required: ["name", "slots"],
    },
  },
  {
    name: "blueprint_update",
    description: "改库里某一份蓝图（共享文件：会检查修订号，别人刚改过就报冲突）。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        patch: { type: "object" },
        expectedRevision: { type: "string" },
      },
      required: ["name", "patch"],
    },
  },
  {
    name: "blueprint_use",
    description:
      "把这个会话改用库里的某一份蓝图（已出的题留在题库里，不会丢）：然后按新题位继续出题。",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
];

const PAPER_TOOL: LlmToolSpec = {
  name: "assemble_paper",
  description:
    "把已入库的题按蓝图排成一份卷子（产生新版本）。**题位齐了就用它收尾**——不然老师看不到卷子。" +
    "有题位没凑齐时它会如实告诉你缺哪个，不会拿不合格的题凑数。",
  parameters: { type: "object", properties: {}, required: [] },
};

const DOC_TOOLS: readonly LlmToolSpec[] = [
  {
    name: "doc_probe",
    description: "看一份文件是什么、多少页、要不要 OCR。拿到陌生资料先问它。",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "doc_extract",
    description:
      "把工作区里的文件读成文字（按后缀自动选读法：文本 / PDF / Word / Excel）。" +
      "PDF 若是扫描件会自动转 OCR。读不了会如实说为什么。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, ocr: { type: "boolean" } },
      required: ["path"],
    },
  },
  {
    name: "material_search",
    description:
      "在资料（真题 / 课标 / 教材）里**按大意模糊检索**，容错错字与 OCR 噪声：" +
      "比如用「二次函数 最值」「动点 相似」去找相关题目与段落，每条命中带文件、题号、片段与分数。" +
      "想参考真实题怎么写就先用它，不要拿 ws_grep 去撞原文。",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" }, dir: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "doc_build",
    description:
      "把工作区里的资料**整份**读成结构化数据（扫描件会整份 OCR）：产出 out/curriculum/ 下的" +
      "全书文本与 JSONL（示例题、内容要求），并报告每本抽到多少条。" +
      "整理成套资料（课标、教材、教参、整本真题）优先用它，别自己一页页翻。",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" } } },
      required: ["paths"],
    },
  },
  {
    name: "doc_ocr",
    description: "对图片或扫描版 PDF 做 OCR（识别文字，可能有错字——不确定就按不确定处理）。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, lang: { type: "string" } },
      required: ["path"],
    },
  },
];

const KB_TOOLS: readonly LlmToolSpec[] = [
  {
    name: "kb_list",
    description: "列出知识库批次与整理状态（raw = 还没整理）。",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "kb_read",
    description: "分片读知识库里的一个文件：给 offset/limit 翻页，别一次读整份。",
    parameters: {
      type: "object",
      properties: {
        batchId: { type: "string" },
        file: { type: "string" },
        offset: { type: "number" },
        limit: { type: "number" },
      },
      required: ["batchId", "file"],
    },
  },
  {
    name: "kb_write",
    description:
      "把抽出来的题目记录写入语料库（写完全局索引会自动重扫）。每条：" +
      "{stem, answer?, knowledge: [], type?, difficulty?}。只写真实存在于原文的题目，不要自己造。",
    parameters: {
      type: "object",
      properties: {
        batchId: { type: "string" },
        records: { type: "array", items: { type: "object" } },
      },
      required: ["batchId", "records"],
    },
  },
  {
    name: "kb_mark",
    description: "标记知识库整理状态：indexed（整理完）或 failed，并写一句说明。",
    parameters: {
      type: "object",
      properties: {
        batchId: { type: "string" },
        status: { type: "string" },
        note: { type: "string" },
      },
      required: ["batchId", "status"],
    },
  },
];

export class WorkbenchService extends Service implements WorkbenchApi {
  static Config = Config;

  private readonly config: WorkbenchConfig;
  private readonly candidates = new Map<string, Candidate>();
  /** 正在跑的轮次（同一时刻最多一轮，见 start()） */
  private readonly runs = new Map<string, RunState>();
  private counter = 0;

  constructor(ctx: Context, config: WorkbenchConfig) {
    super(ctx, "workbench");
    this.config = config;
  }

  /**
   * 工具表按**配置**生成：没接语料库、没开联网搜索，agent 连对应工具都看不到。
   * 这是"可配置"的落点——不是把工具塞给它再让它别用。
   */
  private tools(): readonly LlmToolSpec[] {
    const tools: LlmToolSpec[] = [...TOOLS];
    if (this.ctx.get("corpus") !== undefined) tools.push(...CORPUS_TOOLS);
    if (this.ctx.get("websearch")?.enabled === true) tools.push(WEB_SEARCH_TOOL);
    if (this.ctx.get("kb") !== undefined) tools.push(...KB_TOOLS);
    // 工作区对**所有** agent 开放：主 agent 也要能处理原件、写脚本、跑东西
    if (this.ctx.get("workspace") !== undefined) tools.push(...WORKSPACE_TOOLS);
    // 内置读文档/OCR：常见格式不必现写脚本（读不了的还是可以用 ws_run 自己来）
    if (this.ctx.get("doc")?.available() === true) tools.push(...DOC_TOOLS);
    // 组卷是收尾动作；蓝图库让 agent 能"换一份合适的模板再出"
    if (this.ctx.get("session") !== undefined) tools.push(PAPER_TOOL, ...BLUEPRINT_TOOLS);
    // 运行时制作新题型：写模块 → 框架验收 → 通过即生效
    if (this.ctx.get("constructDynamic") !== undefined) tools.push(CONSTRUCTOR_TOOL, GAP_TOOL);
    return tools;
  }

  /**
   * 跑到底（脚本与测试用）。产品路径走 start()：界面要看过程、要能插话。
   */
  async run(request: WorkbenchRequest): Promise<WorkbenchRun> {
    const started = this.start(request);
    return await started.done;
  }

  /**
   * 起一轮 agent 循环，**立刻返回 runId**：过程通过 run:started / run:step / run:done 事件流出去。
   *
   * 同一时刻只允许一轮：工作台的候选题表是共享状态，两轮并行会互相踩。
   * 与其假装能并行，不如明确拒绝（界面会说"已经有 agent 在跑"）。
   */
  start(request: WorkbenchRequest): {
    runId: string;
    workspace: string;
    done: Promise<WorkbenchRun>;
  } {
    if (this.runs.size > 0) {
      const running = [...this.runs.values()][0];
      throw new Error(`已经有 agent 在跑（${running?.id ?? "?"}）：等它结束，或者让它停下来`);
    }
    const id = `r${String(Date.now())}-${String((this.counter += 1))}`;
    const workspace = this.openWorkspace(request.workspace);
    const state: RunState = {
      id,
      request,
      // done 在下面 loop 起好之后填（RunState 需要它，但 loop 又需要 state）
      done: Promise.resolve({
        goal: request.goal,
        steps: 0,
        transcript: [],
        stored: [],
        stopped: "stopped",
      }),
      ...(workspace === undefined ? {} : { workspace }),
      transcript: [],
      stored: [],
      inbox: [],
      stopRequested: false,
      steps: 0,
    };
    this.runs.set(id, state);
    // 候选题表是**本轮**的：上一轮的候选不该在这一轮还能被提交
    this.candidates.clear();
    this.ctx.emit("run:started", {
      runId: id,
      goal: request.goal,
      workspace: workspace?.name ?? "",
      ...(request.label === undefined ? {} : { label: request.label }),
    });
    state.done = this.loop(state);
    return { runId: id, workspace: workspace?.name ?? "", done: state.done };
  }

  /**
   * 让**执笔者**（模型）把构造好的结构写成给学生看的题面。
   *
   * 分工是这套设计的关键：**结构由题型给**（条件、问法、答案、检验点——数学是真的），
   * **文字由模型写**（可以有情境、可以有多种讲法——但只能使用构造给的数字）。
   * 写歪了由回译闸门拦下：目标、条件条数、答案、题面里的每个数字都要对得上。
   *
   * 返回写好的 Item；失败时返回一句给模型看的错误说明。
   */
  private async serialize(item: Item): Promise<Item | string> {
    const params = Object.values(item.instance.params);
    const brief = {
      题型: item.slot.type,
      知识点: item.slot.knowledge,
      条件: item.instance.givens,
      问几问: (item.instance.goals ?? [item.instance.goal]).filter((goal) => goal !== ""),
      答案: item.witness.answer,
      解题步骤: item.prose.solution,
      // 题面里**只允许出现这些数字**（含情境里的数）——它们来自构造
      可以使用的数字: [...new Set(params)].map(String).join("、"),
    };
    const reply = await this.ctx.llm.chat([
      { role: "system", content: SERIALIZER_PROMPT },
      { role: "user", content: JSON.stringify(brief) },
    ]);
    const parsed = parseJsonObject(reply.content);
    const stem = typeof parsed?.stem === "string" ? parsed.stem : undefined;
    const answerText = typeof parsed?.answerText === "string" ? parsed.answerText : undefined;
    if (stem === undefined || answerText === undefined || stem === "") {
      return "执笔者没有按要求返回 stem/answerText";
    }
    const solution = Array.isArray(parsed?.solution) ? parsed.solution.map(String) : item.prose.solution;
    return {
      ...item,
      prose: {
        stem,
        // 选项与 LaTeX 都是**构造给出的**：不许这次调用随手改（错因库/公式的活）
        ...(item.prose.options === undefined ? {} : { options: item.prose.options }),
        ...(item.prose.tex === undefined ? {} : { tex: item.prose.tex }),
        answerText,
        solution,
        serializer: { model: this.ctx.llm.model, version: 1 },
      },
    };
  }

  /**
   * 工具结果进模型上下文前的处理：**超长就截断**，并把"剩下的在哪"写进去。
   * 不这么做，一本教材的一次抽取就能把上下文撑爆——而且模型还不知道自己看得不全。
   */
  private forModel(payload: unknown): string {
    const text = JSON.stringify(payload);
    if (text.length <= this.config.toolResultLimit) return text;
    return `${text.slice(0, this.config.toolResultLimit)}…（已截断：完整内容在工作区文件里，用 ws_read / ws_grep 去取，别重复整篇读）`;
  }

  /** 老师说一句：下一步就会读到（不是重开一轮，是插进这一轮） */
  interject(runId: string, text: string): boolean {
    const state = this.runs.get(runId);
    if (state === undefined || text.trim() === "") return false;
    state.inbox.push(text.trim());
    return true;
  }

  /** 让它在下一步之前停下来（正在飞的那次模型调用结束后） */
  stop(runId: string): boolean {
    const state = this.runs.get(runId);
    if (state === undefined) return false;
    state.stopRequested = true;
    return true;
  }

  active(): readonly { id: string; goal: string; steps: number; workspace: string }[] {
    return [...this.runs.values()].map((state) => ({
      id: state.id,
      goal: state.request.goal,
      steps: state.steps,
      workspace: state.workspace?.name ?? "",
    }));
  }

  private async loop(state: RunState): Promise<WorkbenchRun> {
    const { request, workspace } = state;
    const workspaceOf = (): WorkbenchRun["workspace"] =>
      workspace === undefined ? undefined : { name: workspace.name, files: workspace.list() };
    const say = (step: number, kind: WorkbenchEvent["kind"], text: string): void => {
      state.transcript.push({ step, kind, text });
      // 实时推给界面：工作记录是"看得见的 agent"，不是跑完才出现的一坨
      this.ctx.emit("run:step", {
        runId: state.id,
        step,
        kind,
        text,
        workspace: workspace?.name ?? "",
      });
    };

    const finish = (stopped: WorkbenchRun["stopped"]): WorkbenchRun => {
      // 老师插的话没被读到（这一轮正好结束了）：说出来，别让它悄悄消失
      for (const missed of state.inbox.splice(0)) {
        say(state.steps, "gate", `没赶上：这一轮已经结束，老师这句话没有读进去——「${missed}」`);
      }
      const left = workspaceOf();
      const result: WorkbenchRun = {
        goal: request.goal,
        steps: state.steps,
        transcript: state.transcript,
        stored: state.stored,
        stopped,
        ...(left === undefined ? {} : { workspace: left }),
      };
      this.ctx.emit("run:done", {
        runId: state.id,
        stopped,
        steps: state.steps,
        stored: state.stored,
        workspace: workspace?.name ?? "",
      });
      this.runs.delete(state.id);
      return result;
    };

    if (!this.ctx.llm.configured) {
      const missing = (this.ctx.llm.missing ?? ["模型配置"]).join("、");
      say(
        0,
        "gate",
        `模型配置不完整（还缺 ${missing}），工作台拒绝运行（不假装在干活）：在「设置」页补齐`,
      );
      return finish("no-llm");
    }

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: systemPrompt(request.blueprint, this.config.extraRules, workspace !== undefined),
      },
      ...(request.brief === undefined || request.brief === ""
        ? []
        : [
            {
              role: "user" as const,
              content: `【现状简报】（框架给的，不用再自己查一遍）\n${request.brief}`,
            },
          ]),
      { role: "user", content: request.goal },
    ];
    // 没文件的空工作区不值得占一行；有资料时才说一句（并且说人话，不报内部 id）
    if (workspace !== undefined && workspace.files.length > 0) {
      say(0, "tool", `工作区里已经有 ${String(workspace.files.length)} 份文件`);
    }

    let stopped: WorkbenchRun["stopped"] = "done";

    try {
      for (;;) {
        // 老师插的话在**下一步**生效：这是"可插话"的落点，不是另起一轮
        while (state.inbox.length > 0) {
          const said = state.inbox.shift();
          if (said === undefined) break;
          messages.push({ role: "user", content: said });
          say(state.steps, "user", said);
        }
        if (state.stopRequested) {
          say(state.steps, "gate", "老师叫停：这一步之后不再继续（已完成的部分保留）");
          stopped = "stopped";
          break;
        }

        state.steps += 1;
        // agent 循环天然串行：下一步做什么取决于上一步的回复
        // oxlint-disable-next-line no-await-in-loop
        const reply = await this.ctx.llm.chat(messages, this.tools());
        if (reply.content !== null && reply.content !== "")
          say(state.steps, "assistant", reply.content);

        if (reply.toolCalls.length === 0) {
          stopped = "done";
          break;
        }

        messages.push({ role: "assistant", content: reply.content, toolCalls: reply.toolCalls });
        for (const call of reply.toolCalls) {
          // 同一轮里的多个工具调用也必须串行：它们会改共享状态（题库、候选题表）
          // oxlint-disable-next-line no-await-in-loop
          const outcome = await this.execute(
            call.name,
            call.arguments,
            request.blueprint,
            workspace?.name ?? "",
          );
          say(state.steps, outcome.kind, outcome.text);
          if (outcome.storedId !== undefined) state.stored.push(outcome.storedId);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: this.forModel(outcome.payload),
          });
        }
      }
    } catch (error) {
      // **出错也要收尾**：以前这里没有 catch，一次模型/工具报错就把这一轮永远留在"运行中"——
      // 界面再也起不了新一轮，只能重启服务（真实踩过：一个不合契约的题型模块把整条链带崩）。
      say(
        state.steps,
        "gate",
        `这一轮出错停下了（不是"做完了"）：${error instanceof Error ? error.message : String(error)}`,
      );
      return finish("error");
    }

    return finish(stopped);
  }

  /** 打开本轮的工作区：给了名字就用它，否则用当前会话 id（都没有就不开——工作区是可配置能力） */
  private openWorkspace(wsName: string | undefined): WorkspaceHandle | undefined {
    const workspace = this.ctx.get("workspace");
    if (workspace === undefined) return undefined;
    const fallback = this.ctx.get("session")?.current().id ?? `run-${String(Date.now())}`;
    const opened = workspace.open(wsName === undefined || wsName === "" ? fallback : wsName);
    return {
      name: opened.name,
      path: opened.path,
      files: opened.files,
      list: () => workspace.list(opened.name),
      read: (relPath, offset, limit) => workspace.read(opened.name, relPath, offset, limit),
      write: (relPath, text) => workspace.write(opened.name, relPath, text),
      run: (argv, timeoutMs) => workspace.run(opened.name, argv, timeoutMs),
    };
  }

  private async execute(
    tool: string,
    rawArguments: string,
    blueprint: Blueprint,
    workspaceName = "",
  ): Promise<{ kind: WorkbenchEvent["kind"]; text: string; payload: unknown; storedId?: string }> {
    let args: Record<string, unknown> = {};
    try {
      args = rawArguments === "" ? {} : (JSON.parse(rawArguments) as Record<string, unknown>);
    } catch {
      return {
        kind: "tool",
        text: `${tool}：参数不是合法 JSON`,
        payload: { error: "参数不是合法 JSON" },
      };
    }

    if (tool === "graph_query") {
      const knowledge = Array.isArray(args.knowledge) ? args.knowledge.map(String) : [];
      const closure = this.ctx.graph.closure(knowledge);
      const missing = this.ctx.graph.missing(knowledge);
      return {
        kind: "tool",
        text: `graph_query：闭包 ${closure.length} 项，越界 ${missing.length} 项`,
        payload: { closure, missing },
      };
    }

    if (tool === "construct_item") {
      const slotKey = String(args.slotKey ?? "");
      const seed = typeof args.seed === "number" ? args.seed : 1;
      const row = blueprint.blueprint.find((entry) => entry.key === slotKey);
      if (row === undefined) {
        return {
          kind: "tool",
          text: `construct_item：蓝图里没有题位 ${slotKey}`,
          payload: { error: "未知题位" },
        };
      }
      const slotSpec = { ...row, key: `${slotKey}-1`, count: 1 };
      const kinds = this.ctx.construct.candidates?.(slotSpec) ?? [];
      const wanted = typeof args.kind === "string" && args.kind !== "" ? args.kind : undefined;
      if (wanted !== undefined && kinds.length > 0 && !kinds.includes(wanted)) {
        return {
          kind: "tool",
          text:
            `construct_item：题位 ${slotKey}（${row.knowledge.join("、")}）用不了题型 ${wanted}；` +
            `能用的题型：${kinds.join("、")}`,
          payload: { error: "题型与题位不匹配", kinds },
        };
      }
      try {
        const byKind = this.ctx.construct.generateWith?.bind(this.ctx.construct);
        const item =
          wanted === undefined || byKind === undefined
            ? this.ctx.construct.generate(slotSpec, seed)
            : byKind(slotSpec, seed, wanted);
        this.counter += 1;
        const candidateId = `cand-${this.counter}`;
        this.candidates.set(candidateId, { id: candidateId, slot: row, item });
        return {
          kind: "tool",
          text: `construct_item：${candidateId}（${item.prose.stem}）`,
          payload: {
            candidateId,
            stem: item.prose.stem,
            answer: item.prose.answerText,
            knowledge: item.slot.knowledge,
          },
        };
      } catch (error) {
        return {
          kind: "tool",
          text: `construct_item：${error instanceof Error ? error.message : String(error)}`,
          payload: { error: "构造失败" },
        };
      }
    }

    if (tool === "serialize_item") {
      const candidateId = String(args.candidateId ?? "");
      const candidate = this.candidates.get(candidateId);
      if (candidate === undefined) {
        return {
          kind: "tool",
          text: `serialize_item：没有候选题 ${candidateId}`,
          payload: { error: "未知候选" },
        };
      }
      const written = await this.serialize(candidate.item);
      if (typeof written === "string") {
        return { kind: "tool", text: `serialize_item：${written}`, payload: { error: written } };
      }
      this.candidates.set(candidateId, { ...candidate, item: written });
      return {
        kind: "tool",
        text: `serialize_item：题面已写（${String(written.prose.stem.length)} 字，执笔者 ${this.ctx.llm.model}）\n${written.prose.stem}`,
        payload: { ok: true, candidateId, stem: written.prose.stem },
      };
    }

    if (tool === "submit_item") {
      const candidateId = String(args.candidateId ?? "");
      const candidate = this.candidates.get(candidateId);
      if (candidate === undefined) {
        return {
          kind: "tool",
          text: `submit_item：没有候选题 ${candidateId}`,
          payload: { error: "未知候选" },
        };
      }
      // **题面由执笔者写，不靠题型的模板**：模板题面只有一个句式，卷子会千篇一律
      // （真实对比：真题的解答题带情境、问法多样，我们的 24 道题里同一句式反复出现）。
      // 所以提交时若还是模板序列化，先写一遍题面；写完过回译（目标/条件/答案/数字都要对得上）。
      let item = candidate.item;
      // 没有模型时照旧用题型的模板题面（诚实：这是兜底，不是"写好了"）
      if (item.prose.serializer.model === "template" && this.ctx.llm.configured) {
        const written = await this.serialize(item);
        if (typeof written === "string") {
          return { kind: "tool", text: `submit_item：题面没写成（${written}）`, payload: { error: written } };
        }
        item = written;
        this.candidates.set(candidateId, { ...candidate, item });
      }
      const result = await this.ctx.bank.submit(item);
      if (result.ok) {
        return {
          kind: "gate",
          text: `submit_item：${candidateId} 通过全部闸门并入库（${result.id}）\n题面：${item.prose.stem}`,
          // 通过时把证据一并回给模型：它能看到"凭什么通过"，而不是只看到 ok
          payload: {
            ok: true,
            id: result.id,
            evidence: result.verdict.pass ? (result.verdict.evidence ?? {}) : {},
          },
          storedId: result.id,
        };
      }
      return {
        kind: "gate",
        text: `submit_item：被 ${result.verdict.gate} 拦下 —— ${result.verdict.reason}`,
        payload: {
          ok: false,
          gate: result.verdict.gate,
          reason: result.verdict.reason,
          fixable: result.verdict.fixable,
          hint: result.verdict.hint ?? null,
        },
      };
    }

    if (tool === "corpus_search") {
      const corpus = this.ctx.get("corpus");
      if (corpus === undefined) {
        return {
          kind: "tool",
          text: "corpus_search：没有接入语料库",
          payload: { error: "没有接入语料库" },
        };
      }
      const hits = corpus.search({
        ...(typeof args.text === "string" ? { text: args.text } : {}),
        ...(Array.isArray(args.knowledge) ? { knowledge: args.knowledge.map(String) } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
      const first = hits[0];
      return {
        kind: "tool",
        text: `corpus_search：命中 ${String(hits.length)} 条${first === undefined ? "" : `（例 ${first.id}：${first.snippet.slice(0, 24)}…）`}`,
        payload: { hits },
      };
    }

    if (tool === "corpus_read") {
      const corpus = this.ctx.get("corpus");
      if (corpus === undefined) {
        return {
          kind: "tool",
          text: "corpus_read：没有接入语料库",
          payload: { error: "没有接入语料库" },
        };
      }
      const record = corpus.read(String(args.id ?? ""));
      if (record === undefined) {
        return {
          kind: "tool",
          text: `corpus_read：没有这条素材`,
          payload: { error: "未知素材 id" },
        };
      }
      // 全文进模型上下文（内部参考），但**事件文本里不出现原文**——界面是给人看的
      return {
        kind: "tool",
        text: `corpus_read：${record.id}（题干 ${String(record.stem.length)} 字，来源 ${record.source}）`,
        payload: {
          id: record.id,
          stem: record.stem,
          answer: record.answer ?? null,
          knowledge: record.knowledge,
        },
      };
    }

    if (tool === "corpus_compare") {
      const corpus = this.ctx.get("corpus");
      if (corpus === undefined) {
        return {
          kind: "tool",
          text: "corpus_compare：没有接入语料库",
          payload: { error: "没有接入语料库" },
        };
      }
      const result = corpus.compare(String(args.text ?? ""));
      const tooClose = result.numbers >= 0.8 && result.wording >= 0.55;
      return {
        kind: "tool",
        text: `corpus_compare：数字 ${result.numbers.toFixed(2)}、措辞 ${result.wording.toFixed(2)}${tooClose ? "（判定：像原题，必须改）" : ""}`,
        payload: { ...result, tooClose },
      };
    }

    if (tool === "web_search") {
      const web = this.ctx.get("websearch");
      if (web === undefined || !web.enabled) {
        return {
          kind: "tool",
          text: "web_search：未启用联网搜索",
          payload: { error: "未启用联网搜索" },
        };
      }
      try {
        const results = await web.search(
          String(args.query ?? ""),
          typeof args.limit === "number" ? args.limit : undefined,
        );
        return {
          kind: "tool",
          text: `web_search：命中 ${String(results.length)} 条`,
          payload: { results },
        };
      } catch (error) {
        return {
          kind: "tool",
          text: `web_search：${error instanceof Error ? error.message : String(error)}`,
          payload: { error: "联网搜索失败" },
        };
      }
    }

    if (tool === "kb_list") {
      const kb = this.ctx.get("kb");
      if (kb === undefined)
        return {
          kind: "tool",
          text: "kb_list：没有知识库服务",
          payload: { error: "未接入知识库" },
        };
      const batches = kb.list();
      return {
        kind: "tool",
        text: `kb_list：${String(batches.length)} 批（待整理 ${String(batches.filter((b) => b.status === "raw").length)}）`,
        payload: {
          batches: batches.map((batch) => ({
            id: batch.id,
            name: batch.name,
            status: batch.status,
            files: batch.files.map((file) => file.name),
            records: batch.records,
          })),
        },
      };
    }

    if (tool === "kb_read") {
      const kb = this.ctx.get("kb");
      if (kb === undefined)
        return {
          kind: "tool",
          text: "kb_read：没有知识库服务",
          payload: { error: "未接入知识库" },
        };
      const batchId = String(args.batchId ?? "");
      const file = String(args.file ?? "");

      // PDF / Word / 图片当文本读只会拿到几千万字节的垃圾——过去真发生过。
      // 这里顺手把那一批**铺进工作区**，并指路去用读文档工具（模型的下一步就能干活）。
      if (/\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|bmp|tiff?|zip|rar)$/i.test(file)) {
        const linked = this.ctx.workspace.seedLinks(workspaceName, kb.sourcePaths(batchId));
        return {
          kind: "tool",
          text:
            `kb_read：${file} 是二进制文件，不能当文本读。` +
            (linked > 0
              ? `这一批的 ${String(linked)} 份已经铺到工作区的 in/ 了：用 doc_probe 看它是什么，再用 doc_extract（扫描件会自动 OCR）读文字。`
              : "（没能铺进工作区，先看 ws_ls）"),
          payload: {
            error: "二进制文件不能当文本读",
            hint: "doc_probe → doc_extract / doc_ocr",
            linked,
          },
        };
      }

      const chunk = kb.read(
        batchId,
        file,
        typeof args.offset === "number" ? args.offset : 0,
        typeof args.limit === "number" ? args.limit : 4000,
      );
      if (chunk === undefined)
        return { kind: "tool", text: "kb_read：没有这个文件", payload: { error: "未知文件" } };
      return {
        kind: "tool",
        text: `kb_read：读到 ${String(chunk.text.length)} 字（共 ${String(chunk.total)}${chunk.next === undefined ? "，已到结尾" : `，下一个 offset=${String(chunk.next)}`}）`,
        payload: chunk,
      };
    }

    if (tool === "gap_report") {
      const session = this.ctx.get("session");
      const paper = this.ctx.get("paper");
      if (session === undefined)
        return { kind: "tool", text: "gap_report：没有会话服务", payload: { error: "未接入会话" } };
      const liveBlueprint = session.blueprint();
      const assembled = await paper?.assemble(liveBlueprint);
      const gaps = assembled?.gaps ?? [];
      // 每个缺口带上"真题里这个题位常考什么"（蓝图里存着统计依据）
      const rows = gaps.map((gap) => {
        const row = liveBlueprint.blueprint.find(
          (entry) => entry.key === gap.slot.replace(/-\d+$/, ""),
        );
        const statKey = "_evidence";
        const evidence =
          row === undefined
            ? undefined
            : (
                row as unknown as Record<
                  string,
                  | { positionDomainCounts?: Record<string, number>; supportPapers?: number }
                  | undefined
                >
              )[statKey];
        // 这个题位能用哪些题型：缺口的原因常常是"题型本身不合格"，
        // agent 要改的是题型——把清单给它，它才知道该重交哪一个
        const kinds =
          row === undefined
            ? []
            : (this.ctx.construct.candidates?.({ ...row, key: gap.slot, count: 1 }) ?? []);
        return {
          slot: gap.slot,
          knowledge: row?.knowledge ?? [],
          type: row?.type ?? "",
          score: row?.score ?? 0,
          reason: gap.reason,
          kinds,
          domains: evidence?.positionDomainCounts ?? {},
          supportPapers: evidence?.supportPapers ?? 0,
        };
      });
      if (rows.length === 0) {
        return { kind: "tool", text: "gap_report：没有缺口，题位都齐了。", payload: { gaps: [] } };
      }
      return {
        kind: "tool",
        text:
          `gap_report：${String(rows.length)} 个题位还出不了\n` +
          rows
            .map(
              (row) =>
                `  · ${row.slot}｜${row.knowledge.join("、")}｜${row.type}｜${String(row.score)} 分｜原因：${row.reason}\n` +
                (row.kinds.length === 0
                  ? "     这个题位还没有任何题型能出（先用 constructor_write 写一个）\n"
                  : `     这个题位能用的题型：${row.kinds.join("、")}\n`) +
                `     真题里这个题位常考：${Object.entries(row.domains)
                  .slice(0, 3)
                  .map(([domain, count]) => `${domain}${String(count)}`)
                  .join("、")}（支持 ${String(row.supportPapers)} 份卷）`,
            )
            .join("\n"),
        payload: { gaps: rows },
      };
    }

    if (tool === "constructor_write") {
      const dynamic = this.ctx.get("constructDynamic");
      if (dynamic === undefined)
        return {
          kind: "tool",
          text: "constructor_write：没有接动态题型服务",
          payload: { error: "未接入" },
        };
      const kindName = String(args.kind ?? "");
      const code = String(args.code ?? "");
      if (kindName === "" || code.trim() === "") {
        return {
          kind: "tool",
          text: "constructor_write：kind 与 code 都不能为空",
          payload: { error: "参数不全" },
        };
      }
      try {
        const written = writeConstructor(kindName, code, args.temporary === true);
        const report = await dynamic.loadOne(written);
        if (!report.ok) {
          return {
            kind: "tool",
            text: `constructor_write：${kindName} **没通过验收**，改完再交：\n${report.problems.map((problem: string) => `  · ${problem}`).join("\n")}`,
            payload: { ok: false, problems: report.problems, file: written },
          };
        }
        return {
          kind: "tool",
          text:
            `constructor_write：${kindName} 通过验收并生效（覆盖 ${report.covers.join("、")}）` +
            (args.temporary === true
              ? "——写在**试验目录**（data/constructors/，不进仓库）：正式题型请不带 temporary 再交一次。"
              : "——已写进仓库的 constructors/（团队共享、随版本走）。") +
            "下一步可以按蓝图出这种题了。",
          payload: {
            ok: true,
            kind: kindName,
            covers: report.covers,
            samples: report.samples,
            checks: report.checks,
          },
        };
      } catch (error) {
        return {
          kind: "tool",
          text: `constructor_write：写文件失败（${error instanceof Error ? error.message : String(error)}）`,
          payload: { error: String(error) },
        };
      }
    }

    if (tool.startsWith("blueprint_")) {
      const session = this.ctx.get("session");
      if (session === undefined)
        return { kind: "tool", text: `${tool}：没有会话服务`, payload: { error: "未接入会话" } };

      if (tool === "blueprint_list") {
        const library = session.blueprintList();
        const current = session.blueprintSource().path;
        return {
          kind: "tool",
          text: `blueprint_list：库里有 ${String(library.length)} 份\n${library
            .map(
              (info) =>
                `  · ${info.name}｜${info.title}｜${String(info.slots)} 个题位｜${String(info.totalScore)} 分${info.path === current ? "（当前会话在用）" : ""}${info.createdBy === "agent" ? "（agent 建的草稿）" : ""}`,
            )
            .join("\n")}`,
          payload: { blueprints: library, current },
        };
      }

      if (tool === "blueprint_read") {
        const bluepName = String(args.name ?? "");
        try {
          const readBack = session.blueprintRead(bluepName);
          return {
            kind: "tool",
            text: `blueprint_read：${bluepName}（${String(readBack.blueprint.length)} 个题位，${String(readBack.paper.totalScore)} 分）`,
            payload: { name: bluepName, blueprint: readBack },
          };
        } catch (error) {
          return {
            kind: "tool",
            text: `blueprint_read：读不到「${bluepName}」`,
            payload: { error: String(error) },
          };
        }
      }

      if (tool === "blueprint_update") {
        try {
          const next = session.blueprintUpdate(
            String(args.name ?? ""),
            (args.patch ?? {}) as never,
            typeof args.expectedRevision === "string" ? args.expectedRevision : undefined,
          );
          return {
            kind: "tool",
            text: `blueprint_update：${String(args.name ?? "")} 已更新（${String(next.blueprint.length)} 个题位，${String(next.paper.totalScore)} 分）`,
            payload: { blueprint: next },
          };
        } catch (error) {
          return {
            kind: "tool",
            text: `blueprint_update：没改成（${error instanceof Error ? error.message : String(error)}）`,
            payload: { error: String(error) },
          };
        }
      }

      if (tool === "blueprint_use") {
        try {
          const meta = session.blueprintUse(String(args.name ?? ""));
          return {
            kind: "tool",
            text: `blueprint_use：这个会话改用「${String(args.name ?? "")}」（蓝图为 ${meta.blueprintPath}）。下一步按新题位看缺口。`,
            payload: { blueprintPath: meta.blueprintPath },
          };
        } catch (error) {
          return {
            kind: "tool",
            text: `blueprint_use：换不了（${error instanceof Error ? error.message : String(error)}）`,
            payload: { error: String(error) },
          };
        }
      }

      // blueprint_create
      try {
        const slots = Array.isArray(args.slots) ? args.slots : [];
        const rows = slots.map((entry, index) => {
          const slot = entry as Record<string, unknown>;
          const raw = Array.isArray(slot.difficulty) ? slot.difficulty.map(Number) : [0.6, 0.85];
          const difficulty: [number, number] = [raw[0] ?? 0.6, raw[1] ?? 0.85];
          return {
            key:
              typeof slot.key === "string" && slot.key !== "" ? slot.key : `S${String(index + 1)}`,
            knowledge: Array.isArray(slot.knowledge) ? slot.knowledge.map(String) : [],
            cognitive: COGNITIVE.has(String(slot.cognitive))
              ? (String(slot.cognitive) as Cognitive)
              : ("掌握" as Cognitive),
            type: QUESTION_TYPE.has(String(slot.type))
              ? (String(slot.type) as QuestionType)
              : ("解答" as QuestionType),
            count: typeof slot.count === "number" ? slot.count : 1,
            difficulty,
            score: typeof slot.score === "number" ? slot.score : 10,
          };
        });
        const created = session.blueprintCreate(
          String(args.name ?? ""),
          {
            paper: {
              title: typeof args.title === "string" ? args.title : String(args.name ?? "新蓝图"),
              totalScore: rows.reduce((sum, row) => sum + row.score * row.count, 0),
              minutes: typeof args.minutes === "number" ? args.minutes : 40,
              className: "初三(2)班",
            },
            blueprint: rows,
            constraints: { forbidKnowledge: ["实际问题建模", "动点问题"] },
          },
          "agent",
        );
        return {
          kind: "tool",
          text: `blueprint_create：建好了「${created.name}」（${String(created.slots)} 个题位，${String(created.totalScore)} 分）。告诉老师这是你起的草稿，让他过一眼；要现在就用来出题，再调 blueprint_use。`,
          payload: { blueprint: created },
        };
      } catch (error) {
        return {
          kind: "tool",
          text: `blueprint_create：没建成（${error instanceof Error ? error.message : String(error)}）`,
          payload: { error: String(error) },
        };
      }
    }

    if (tool === "assemble_paper") {
      const session = this.ctx.get("session");
      if (session === undefined)
        return {
          kind: "tool",
          text: "assemble_paper：没有会话服务",
          payload: { error: "未接入会话" },
        };
      try {
        const version = await session.assemble("agent 收尾组卷");
        const gaps = version.gaps.map(
          (gap) => `${gap.slot}（缺 ${String(gap.missing)}：${gap.reason}）`,
        );
        return {
          kind: "tool",
          text:
            `assemble_paper：第 ${String(version.version)} 版，${String(version.bindings.length)} 道题，满分 ${String(version.totalScore)}` +
            (gaps.length === 0 ? "，题位齐了" : `；还有缺口：${gaps.join("；")}`),
          payload: {
            version: version.version,
            totalScore: version.totalScore,
            scoreGap: version.scoreGap,
            slots: version.bindings.map((binding) => binding.slot),
            gaps: version.gaps,
          },
        };
      } catch (error) {
        return {
          kind: "tool",
          text: `assemble_paper：没组起来（${error instanceof Error ? error.message : String(error)}）`,
          payload: { error: error instanceof Error ? error.message : String(error) },
        };
      }
    }

    if (tool === "material_search") {
      const doc = this.ctx.get("doc");
      if (doc === undefined || !doc.available())
        return {
          kind: "tool",
          text: "material_search：没有接文档工具",
          payload: { error: "未接入文档工具" },
        };
      const query = String(args.query ?? "");
      const found = doc.search(workspaceName, query, {
        limit: numberOr(args.limit, 8) ?? 8,
        ...(typeof args.dir === "string" ? { dir: args.dir } : {}),
      });
      if (!found.ok)
        return {
          kind: "tool",
          text: `material_search：没搜成（${found.error ?? "未知"}）`,
          payload: { error: found.error },
        };
      return {
        kind: "tool",
        text:
          `material_search：「${query}」在 ${String(found.scanned)} 份资料里命中 ${String(found.hits.length)} 条\n` +
          found.hits
            .map(
              (hit) =>
                `  · ${hit.score.toFixed(2)}｜${hit.path.split("/").at(-1) ?? hit.path}${hit.head === undefined || hit.head === "" ? "" : `｜${hit.head}`}\n     ${hit.snippet.slice(0, 120)}`,
            )
            .join("\n"),
        payload: { query, hits: found.hits },
      };
    }

    if (tool === "doc_build") {
      const doc = this.ctx.get("doc");
      if (doc === undefined || !doc.available())
        return {
          kind: "tool",
          text: "doc_build：没有接文档工具",
          payload: { error: "未接入文档工具" },
        };
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      const built = doc.build(workspaceName, paths);
      if (!built.ok) {
        return {
          kind: "tool",
          text: `doc_build：没跑成（${built.error ?? "未知原因"}）`,
          payload: { error: built.error ?? "未知原因", outputs: built.outputs },
        };
      }
      const summary = built.books.map(
        (book) =>
          `${book.source}：${String(book.pages)} 页 → 示例题 ${String(book.examples)} 条、内容要求 ${String(book.requirements)} 条`,
      );
      return {
        kind: "tool",
        text: [
          `doc_build：读完了 ${String(built.books.length)} 本`,
          ...summary,
          `产出（工作区里）：${built.outputs.join("、")}`,
          "接下来：ws_grep 找你要的段落，或 ws_read 分片读 JSONL；抽出来要入库的用 kb_write 批量写。",
        ].join("\n"),
        payload: { books: built.books, outputs: built.outputs },
      };
    }

    if (tool === "doc_probe" || tool === "doc_extract" || tool === "doc_ocr") {
      const doc = this.ctx.get("doc");
      if (doc === undefined || !doc.available()) {
        return {
          kind: "tool",
          text: `${tool}：没有接文档工具`,
          payload: { error: "未接入文档工具" },
        };
      }
      const path = String(args.path ?? "");
      const result =
        tool === "doc_probe"
          ? doc.probe(workspaceName, path)
          : tool === "doc_ocr"
            ? doc.ocr(workspaceName, path, typeof args.lang === "string" ? args.lang : undefined)
            : doc.extract(workspaceName, path, { ocr: args.ocr === true });
      const label = tool === "doc_probe" ? "看了" : tool === "doc_ocr" ? "识别" : "读了";
      if (!result.ok) {
        // 失败也要把 note 带上：缺语言包 / 没装库 / 扫描太糊，模型才知道下一步怎么办
        const why = [result.error ?? "读取失败", ...result.notes]
          .filter((part) => part !== "")
          .join("；");
        return {
          kind: "tool",
          text: `${tool}：${path} 读不了（${why}）`,
          payload: { error: why, path },
        };
      }
      const shape =
        result.kind === "pdf" && result.pages !== undefined
          ? `${String(result.pages)} 页`
          : result.kind === "image"
            ? "图片"
            : result.kind;
      const tail = result.truncated === true ? `，先给你前 ${String(result.text.length)} 字` : "";
      const notes = result.notes.length === 0 ? "" : `（${result.notes.join("；")}）`;
      return {
        kind: "tool",
        text: `${tool}：${label} ${path}，${shape}，共 ${String(result.chars)} 字${tail}${notes}`,
        payload: {
          path,
          kind: result.kind,
          chars: result.chars,
          truncated: result.truncated ?? false,
          notes: result.notes,
          text: result.text,
        },
      };
    }

    if (tool === "ws_grep") {
      const workspace = this.ctx.get("workspace");
      if (workspace === undefined)
        return {
          kind: "tool",
          text: "ws_grep：没有工作区服务",
          payload: { error: "未接入工作区" },
        };
      const pattern = String(args.pattern ?? "");
      const files = workspace.list(workspaceName);
      const targets = (
        String(args.path ?? "") === ""
          ? files
          : files.filter((file) => file.path.includes(String(args.path)))
      ).filter((file) => !/\.(pdf|png|jpe?g|docx|xlsx|zip)$/i.test(file.path));
      const max = Math.min(Math.max(numberOr(args.max, 20) ?? 20, 1), 60);
      let expression: RegExp;
      try {
        expression = new RegExp(pattern, "i");
      } catch {
        expression = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      }
      const hits: { path: string; line: number; text: string }[] = [];
      for (const file of targets) {
        if (hits.length >= max) break;
        const chunk = workspace.read(workspaceName, file.path, 0, 400_000);
        if (chunk === undefined) continue;
        chunk.text.split("\n").forEach((line, index) => {
          if (hits.length < max && expression.test(line))
            hits.push({ path: file.path, line: index + 1, text: line.trim().slice(0, 160) });
        });
      }
      return {
        kind: "tool",
        text: `ws_grep：${pattern} → ${String(hits.length)} 处命中${hits.length === 0 ? "（换个说法或换个文件）" : ""}`,
        payload: { pattern, hits },
      };
    }

    if (tool === "ws_ls") {
      const workspace = this.ctx.get("workspace");
      if (workspace === undefined)
        return { kind: "tool", text: "ws_ls：没有工作区服务", payload: { error: "未接入工作区" } };
      const files = workspace.list(workspaceName);
      return {
        kind: "tool",
        text: `ws_ls：${String(files.length)} 个文件${files.length === 0 ? "（空的：原件要先放进 in/）" : ""}`,
        payload: { workspace: workspaceName, files },
      };
    }

    if (tool === "ws_read") {
      const workspace = this.ctx.get("workspace");
      if (workspace === undefined)
        return {
          kind: "tool",
          text: "ws_read：没有工作区服务",
          payload: { error: "未接入工作区" },
        };
      const relPath = String(args.path ?? "");
      const chunk = workspace.read(
        workspaceName,
        relPath,
        numberOr(args.offset, 0),
        numberOr(args.limit, 4000),
      );
      if (chunk === undefined) {
        return {
          kind: "tool",
          text: `ws_read：读不到 ${relPath}（可能是二进制，或路径不对）`,
          payload: { error: "读不到文件" },
        };
      }
      return {
        kind: "tool",
        text: `ws_read：${relPath} 读到 ${String(chunk.text.length)} 字（共 ${String(chunk.total)}${chunk.next === undefined ? "，已到结尾" : `，下一个 offset=${String(chunk.next)}`}）`,
        payload: {
          path: relPath,
          offset: numberOr(args.offset, 0),
          total: chunk.total,
          text: chunk.text,
        },
      };
    }

    if (tool === "ws_write") {
      const workspace = this.ctx.get("workspace");
      if (workspace === undefined)
        return {
          kind: "tool",
          text: "ws_write：没有工作区服务",
          payload: { error: "未接入工作区" },
        };
      const written = workspace.write(
        workspaceName,
        String(args.path ?? ""),
        String(args.text ?? ""),
      );
      if (written === undefined) {
        return {
          kind: "tool",
          text: "ws_write：路径不合法（不许绝对路径或 ..）",
          payload: { error: "路径不合法" },
        };
      }
      return {
        kind: "tool",
        text: `ws_write：${written.path}（${String(written.bytes)} 字节）`,
        payload: { path: written.path },
      };
    }

    if (tool === "ws_run") {
      const workspace = this.ctx.get("workspace");
      if (workspace === undefined)
        return { kind: "tool", text: "ws_run：没有工作区服务", payload: { error: "未接入工作区" } };
      const argv = Array.isArray(args.argv) ? args.argv.map(String) : [];
      const result = workspace.run(workspaceName, argv, numberOr(args.timeoutMs, undefined));
      return {
        kind: "tool",
        text: `ws_run：${argv.join(" ")}（${result.timedOut ? "超时终止" : `退出码 ${String(result.code ?? "?")}`}，${String(result.ms)} ms）`,
        payload: {
          argv: result.argv,
          code: result.code,
          timedOut: result.timedOut,
          out: result.out,
          err: result.err,
        },
      };
    }

    if (tool === "kb_write") {
      const kb = this.ctx.get("kb");
      if (kb === undefined)
        return {
          kind: "tool",
          text: "kb_write：没有知识库服务",
          payload: { error: "未接入知识库" },
        };
      const raw = Array.isArray(args.records) ? args.records : [];
      const records = raw.flatMap((entry, index) => {
        const item = entry as Record<string, unknown>;
        const stem = typeof item.stem === "string" ? item.stem.trim() : "";
        if (stem === "") return [];
        return [
          {
            id: `${String(args.batchId ?? "kb")}-${String(index + 1)}-${String(stem.length)}`,
            source: `kb:${String(args.batchId ?? "")}`,
            stem,
            ...(typeof item.answer === "string" ? { answer: item.answer } : {}),
            knowledge: Array.isArray(item.knowledge) ? item.knowledge.map(String) : [],
            ...(typeof item.type === "string" ? { type: item.type } : {}),
            ...(typeof item.difficulty === "number" ? { difficulty: item.difficulty } : {}),
            distributable: false,
          },
        ];
      });
      const written = kb.write(String(args.batchId ?? ""), records);
      return {
        kind: "tool",
        text: `kb_write：写入 ${String(written)} 条（已自动重扫语料索引）`,
        payload: { written },
      };
    }

    if (tool === "kb_mark") {
      const kb = this.ctx.get("kb");
      if (kb === undefined)
        return {
          kind: "tool",
          text: "kb_mark：没有知识库服务",
          payload: { error: "未接入知识库" },
        };
      const status = String(args.status ?? "indexed");
      const batch = kb.mark(
        String(args.batchId ?? ""),
        status === "failed" ? "failed" : "indexed",
        typeof args.note === "string" ? args.note : undefined,
      );
      return {
        kind: "tool",
        text: `kb_mark：${batch?.id ?? ""} → ${batch?.status ?? status}`,
        payload: { batch },
      };
    }

    if (tool === "bank_stats") {
      const items = this.ctx.bank.all();
      return {
        kind: "tool",
        text: `bank_stats：已入库 ${items.length} 题`,
        payload: {
          total: items.length,
          slots: blueprint.blueprint.map((row) => ({
            slot: row.key,
            want: row.count,
            have: items.filter((item) => item.slot.key.startsWith(row.key)).length,
          })),
        },
      };
    }

    return { kind: "tool", text: `未知工具 ${tool}`, payload: { error: "未知工具" } };
  }
}

/** 执笔者提示词：只把结构写成通顺题面，**不许改数学** */
const SERIALIZER_PROMPT = [
  "你是命题组的执笔者。给你一道**已经构造好**的题的结构（条件、问几问、答案、解题步骤、可以使用的数字），",
  "把它写成给学生看的题面——像一份真的卷子，可以写得有情境、有交代，不必照着字段直译。",
  '只输出 JSON：{"stem":"题干","answerText":"答案","solution":["步骤1","步骤2"]}',
  "硬规矩：",
  "1. **不得新增、删改、四舍五入任何条件或数值**；题面里出现的数字**只能来自「可以使用的数字」**，",
  "   包括情境里的数据（写「进了 200 件」就得有 200 这个数）；否则等于替这道题另编了一道；",
  "2. 可以写情境（一次测量、一次统计、一次采购、一块场地…），但要**与条件相容、合乎常识**：",
  "   长度不能是负数、件数不能是小数、情境里用到的量必须是条件或问法真的涉及的；",
  "3. 该分问就分问：给的「问几问」有几条，题面就分成几问（（1）（2）（3））；",
  "4. 你不负责算答案：answerText 直接用给你的答案；solution 的数值必须与给你的数据一致；",
  "5. 数学式子写成 LaTeX，用 $…$ 包起来（例如 $y=-2(x-1)^{2}+8$）；",
  "6. 不要输出 JSON 以外的任何内容。",
].join("\n");

/** 取数字参数（模型有时给字符串），缺省时用 fallback */
function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value)))
    return Number(value);
  return fallback;
}

function systemPrompt(blueprint: Blueprint, extraRules: string, hasWorkspace = false): string {
  const rows = blueprint.blueprint
    .map(
      (row) =>
        `- ${row.key}：${row.knowledge.join("、")}｜${row.cognitive}｜${row.type}｜${row.score} 分 ×${row.count}`,
    )
    .join("\n");
  return [
    "你是 AI 命题组的组长。你的产出必须是**能过闸门**的原创题。",
    "**用中文说话**：老师看的是中文界面，你的每一句说明都用中文（工具参数里的中文也一样）。",
    "说话要短：一句话说清你做了什么、发现了什么。**不要写报告**——不写 Markdown 标题、不加粗、",
    "不列表格、不复述工具原始输出，也不要重复题目全文（卷子页上就有）。",
    "拿不准老师要什么时，问**一个**具体问题就停（别自己替他决定）。",
    "**别反复清点**：现状已经在上面那份简报里（题位、缺口、资料）。只有简报里没有的事实，才去用工具查。",
    "**别再翻上一轮的产物**：工作区里的 out/、tmp/ 是以前的草稿，除非这次任务需要，不要一上来就重读。",
    "**默认动作**：把蓝图里缺的题位补齐，然后 assemble_paper 组卷。除非简报显示题位已齐、卷子已组好，",
    '   否则不要问"你要哪一种"——直接干。',
    '**老师要的规格库里没有时**：不要反问他"要哪一种"。直接 blueprint_list 看库里有什么 →',
    "   照他的要求 blueprint_create 一份**草稿**（题位尽量贴近他的说法）→ blueprint_use 换上 → 按新题位出题。",
    '   构造器覆盖不到的题位照实写在草稿里并说明"这些题位我出不了"，让老师在界面上改——**草稿是他的起点，不是问他问题**。',
    "**题型要像真题，不要像模板**（这是这套系统的命门）：",
    "   真题里的解答题是**多问、带情境**的（统计图、测量、方案、销售…），不是一句话换数字。所以：",
    "   0) 写题型**之前**先看真题：material_search / corpus_search 找这个知识点在真卷里怎么问、",
    '      带什么情境、分几问（例如搜「二次函数 面积」「相似 测量」「统计 平均数 方差」）；',
    "      抽出来的问法与情境是**素材**——照它们的路子设计，但数字与答案必须来自你自己的构造。",
    "   1) gap_report 看还缺哪些题位、每个题位缺什么（知识点/题型/分值/真题里怎么考、有哪些题型可用）；",
    "   2) constructor_write 写题型模块。**一个题型要覆盖多种结构**：按种子换给定的条件组合、",
    "      换问法（求解析式／求顶点／求面积／判断结论…），不要「一个句式换数字」——",
    "      验收会数：30 个种子只造出 1 种结构（抹掉数字后一样）的模块会被判「这不是题型」；",
    "   3) **分量要对**：8 分以上的解答题至少 2 问、12 分以上至少 3 问（用 goals 声明每一问）；",
    "      选择题必须给四个选项（给 3 个 distractors 典型错解，正确项由框架用构造答案生成）；",
    "   4) 验收不通过就按它给的问题改，直到通过（检验点必须能区分对错，恒等式会被判无效）；",
    "   5) 再 assemble_paper 组卷，看缺口是否减少；还有缺口就回到第 1 步。",
    '   **做不到的如实说**：证明题（全等、切线）这类没有"可代入核对的答案"，不要硬凑一个假题型。',
    "**写脚本是本事，不是偷懒**：资料版式怪、要批处理、要核对数值，就 ws_write 写个 python 脚本再 ws_run 跑；",
    "   跑完**自己检查**（抽查几处、对一下总数、和原文核对），别把没验过的结果交上来。",
    "同一个问题（比如卷头分数与题位合计对不上）**只说一次**；说过就别再反复问。",
    "",
    `本次卷子：${blueprint.paper.title}（${blueprint.paper.className}，${blueprint.paper.totalScore} 分，${blueprint.paper.minutes} 分钟）`,
    "题位：",
    rows,
    `本卷禁用知识点：${blueprint.constraints.forbidKnowledge.join("、")}`,
    "",
    "硬规矩：",
    "1. 数学真值由构造与符号计算保证，你不要自己算答案，也不要改题面里的数值。",
    "2. 出题分两层：**结构由题型给**（givens、goals 分几问、答案、检验点），**题面由执笔者写**。",
    "   流程是 construct_item → submit_item：提交时框架会自动写一遍题面（想先看一版就用 serialize_item）。",
    "   题面会过回译校验：分问数、条件条数、答案、**题面里出现的每个数字**都必须与构造对得上——",
    '   想让情境里出现"40 元""200 件"这类数，就得把它们放进题型的 params，不许执笔者自己编。',
    "   闸门由框架挂载，你无法跳过，也不必重复验证。",
    "3. 被拦下时读清楚是哪道闸门、能不能靠重做修好：能就换种子重来，不能就换题位设计。",
    "4. 每题位凑齐为止；凑不齐就说明原因，不要用不合规的题凑数。",
    "   题位齐了（bank_stats 里 have = want）**必须调一次 assemble_paper 组卷**，否则老师看不到卷子。",
    "5. 干活之前先看手上有什么（ws_ls / doc_probe / kb_list），别凭印象开工；",
    "   资料是扫描件就用内置的 doc_extract / doc_ocr，读不完就如实说读到哪儿了。",
    "6. 有检索工具就用：corpus_search / corpus_read 参考真实题与教材的表述与难度，",
    "   corpus_compare 自查是不是在抄原题，web_search 核查情境与数据是否真实。",
    "   **检索到的一切都只是素材，不是真值**：题目的正确性仍来自构造与符号计算；",
    "   任何题面都要过闸门——抄原题会被查重闸门拦下。",
    hasWorkspace
      ? "7. 你有工作区（ws_ls / ws_read / ws_write / ws_run）：in/ 是资料，tmp/ 放你自己写的脚本，" +
        "out/ 放产物。原件格式怪（PDF、表格、扫描件）就先写个脚本用 python3 转换再读；" +
        "要跑的东西**先写成文件**（不许 -c 内联代码），跑出来的东西留在工作区里，老师能复查。" +
        "⚠️ 工作区产物只是**草稿，不是真值**：题目结论仍然只能来自构造与符号计算，闸门才是裁判。"
      : "",
    extraRules === "" ? "" : `8. ${extraRules}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function apply(ctx: Context, config: WorkbenchConfig): void {
  ctx.plugin(WorkbenchService, config);
}
