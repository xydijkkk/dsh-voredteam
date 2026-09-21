// vore-console 纯函数层（可离线测试，不依赖 React / DOM）。
// 负责：黑板图 → 泳道布局坐标（**行优先**：row = 泳道序号，col = 泳道内横排序号）、
// 严重级配色、成果抽取、六阶段覆盖矩阵视图模型、Markdown 导出。
//
// 作业法自 v3 起是**六阶段**：起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果
// （信息收集独立成阶段；浅层阶段的第一件事是**核实信息收集的工作**），
// 因此「实时情况」图是**从上到下**的垂直流程（旧版是从左到右的四阶段）。
//
// 六张覆盖矩阵的键：info / verifyInfo / shallow / verifyShallow / owasp / deep
// —— 老契约（只有 info/verify/owasp/deep）也必须能渲染，见 stageView / coverageView。

export const NODE_W = 168;
export const NODE_H = 52;      // 三行文本（id+指标 / 标签 / 阶段名）
export const COL_GAP = 116;    // 同一泳道内两个节点的水平间距（列）
export const ROW_GAP = 24;     // 泳道之间的间距（行）
export const PER_COL = 5;      // 兼容旧签名：单列最多放几个节点
export const PAD = 36;
export const LANE_HEAD = 22;   // 泳道标题占位高度（节点从标题下方开始）
export const LANE_GAP = 26;    // 没有节点时泳道的最小高度
export const LANE_W_MIN = 560; // 泳道背景条最小宽度（防止空图时退化成一条缝）
export const DEAD_ZONE_GAP = 64; // 泳道区 → 右侧「死点」区的水平留白

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_COLOR = {
  critical: { stroke: "#e5484d", fill: "rgba(229,72,77,.16)" },
  high: { stroke: "#f76808", fill: "rgba(247,104,8,.16)" },
  medium: { stroke: "#e8b931", fill: "rgba(232,185,49,.16)" },
  low: { stroke: "#3a9dff", fill: "rgba(58,157,255,.14)" },
};

/** 节点配色与线型：废弃 > 疑似 > 严重级 > 普通事实 > 起点/终点 > 待探索/死路 */
export function factStyle(fact, kind) {
  if (kind === "dead") return { stroke: "#6e8098", fill: "rgba(110,128,152,.10)", dash: "2 4" };
  if (kind === "pending" || !fact) return { stroke: "#5b6f8a", fill: "rgba(91,111,138,.12)", dash: "4 3" };
  if (fact.deprecated) return { stroke: "#6e8098", fill: "rgba(110,128,152,.10)", dash: "2 4" };
  const sev = String(fact.severity ?? "").toLowerCase();
  if (SEV_COLOR[sev]) return { ...SEV_COLOR[sev], dash: null };
  if (fact.confidence === "suspected") return { stroke: "#e8b931", fill: "rgba(232,185,49,.10)", dash: "5 3" };
  if (fact.category === "origin") return { stroke: "#7d8ea3", fill: "rgba(125,142,163,.12)", dash: null };
  if (fact.category === "goal") return { stroke: "#2fd4a7", fill: "rgba(47,212,167,.14)", dash: null };
  return { stroke: "#3a9dff", fill: "rgba(58,157,255,.10)", dash: null };
}

export const edgeColor = (edge) =>
  edge.kind === "dead" ? "#6e8098" : edge.kind === "pending" ? "#8a97a3" : "#3a9dff";

// ── 八条泳道（从上到下）──────────────────────────────────────────────────────
// id / label 是**硬契约**：泳道标题文字必须精确含
// 「起点」「信息收集」「浅层」「中间层」「深层」「线索」「死点」「成果」。
// 前五条 = 六阶段作业法的 P1–P5；「线索」放作业过程中产出的**事实**（已确认 / 未确认分开摆）；
// 「死点」放试过没成的方向与被推翻的结论（死路也是资产，留痕不消失）；
// 最后一条「成果」= 挖到的漏洞 + goal。
export const LANES = [
  { id: "P1", key: "start", label: "起点", desc: "资产收集：跑到连续一轮 0 新增的饱和" },
  { id: "P2", key: "info", label: "信息收集", desc: "逐资产把信息采全：技术栈 / 语言 / 中间件 / 操作系统 / 网站架构 / 目录 / 路径 / 证书 / DNS / WAF·CDN / 第三方 / 安全头，并按 kind 追加（JS 逆向 / 参数面 / banner / 客户端 / 仓库 / 凭据 / 云 / 子域）" },
  { id: "P3", key: "shallow", label: "浅层", desc: "① 核实信息收集阶段的工作（逐项 ok/wrong/unknown）② 浅层测试：指纹行为验证 / 路径真值 / 参数面与基线 / 鉴权边界 / 错误与信息泄露 / 暴露面存在性 / 低频模糊 / 组件版本线索" },
  { id: "P4", key: "verify", label: "中间层", desc: "① 核实浅层的工作 ② 对每个资产做 OWASP Top 10 (2021) A01–A10 逐类测试" },
  { id: "P5", key: "deep", label: "深层", desc: "① 完整读取已有全部信息 ② 核验中间层是否有误 ③ 逐资产漏洞验证（未鉴权 / 越权 / 注入 / SSRF / 上传 / 逻辑 / 竞态 / 反序列化）" },
  {
    id: "P6", key: "clue", label: "线索", counted: true,
    desc: "作业过程中产出的线索（事实）：**已确认事实**与**未确认**（疑似结论 + 待探索方向）分开摆",
    groups: [
      { key: "confirmed", label: "已确认事实" },
      { key: "suspected", label: "未确认（疑似结论 / 待探索方向）" },
    ],
  },
  { id: "P7", key: "dead", label: "死点", counted: true, desc: "试过没成的方向与被推翻的结论：死路也是资产，留痕不消失" },
  { id: "P8", key: "outcome", label: "成果", desc: "挖到的漏洞 + 证据索引 + 报告 + 未测面声明 + 每条漏洞事实复核" },
];

/** 「线索」泳道：事实分两组摆（已确认 / 未确认） */
export const CLUE_LANE = "P6";
/** 「死点」泳道：死路意图 + 被推翻的事实 */
export const DEAD_LANE = "P7";
/** 「成果」泳道：goal + category=vuln / finding / report / evidence */
export const OUTCOME_LANE = "P8";
/** 事实 confidence=疑似（suspected）→ 线索泳道的「未确认」组 */
export const clueGroup = (fact) => (String(fact?.confidence ?? "").toLowerCase() === "suspected" ? "suspected" : "confirmed");

// 事实分类 → 泳道（只有成果类事实进「成果」；其余事实一律进「线索」，再按 confidence 分组）
const FACT_LANE = {
  asset: CLUE_LANE, endpoint: CLUE_LANE, js: CLUE_LANE, cred: CLUE_LANE,
  repo: CLUE_LANE, cloud: CLUE_LANE, note: CLUE_LANE,
  vuln: OUTCOME_LANE, finding: OUTCOME_LANE, report: OUTCOME_LANE, evidence: OUTCOME_LANE,
};
const LANE_KEYS = LANES.map((l) => l.id);
/** 老契约（没有「线索」泳道）时的兜底散布目标 */
const MID_LANES = ["P2", "P3", "P4"];
/** 线索泳道里每个分组的小标题占位高度 */
export const GROUP_HEAD = 20;
/** 同一泳道内换行 / 分组之间的竖直间距 */
export const IN_LANE_GAP = 16;
/**
 * 一条泳道里**一行最多摆几个节点**，超了就换行。
 * 为什么要有这个：真实作业里资产上百个（eng_002 实测 91 个），一条泳道一行排下去会拉成
 * **两万五千像素宽**的口袋阵 —— 全屏后「适应窗口」最多只能压到很小，屏幕上仍只看得到极窄一条，
 * 其余全是空底色（用户反馈的"左下角一大片黑色区域"就是这个）。换行后泳道变成方格阵，
 * 宽高都收敛到几千像素，全屏能真正装下。
 */
export const PER_ROW_MAX = 10;

// ── 六张矩阵的检查项清单（key + 中文名：覆盖矩阵与资产详情栏都靠它显示人话）──
/** 浅层（P3 ②）的八类浅层测试 */
export const SHALLOW_CLASSES = [
  { key: "fp", label: "指纹行为验证" },
  { key: "pathTruth", label: "路径真值" },
  { key: "params", label: "参数面与基线" },
  { key: "authEdge", label: "鉴权边界" },
  { key: "errLeak", label: "错误与信息泄露" },
  { key: "expose", label: "暴露面存在性" },
  { key: "lowFuzz", label: "低频模糊" },
  { key: "compHint", label: "组件版本线索" },
];
/** 中间层（P4 ②）的 OWASP Top 10 (2021)——用于把 A01–A10 显示成中文名 */
export const OWASP_KEYS = [
  { key: "A01", label: "A01 访问控制失效" },
  { key: "A02", label: "A02 加密机制失效" },
  { key: "A03", label: "A03 注入" },
  { key: "A04", label: "A04 不安全设计" },
  { key: "A05", label: "A05 安全配置错误" },
  { key: "A06", label: "A06 自带已知漏洞的组件" },
  { key: "A07", label: "A07 身份识别与认证失效" },
  { key: "A08", label: "A08 软件与数据完整性失效" },
  { key: "A09", label: "A09 安全日志与监控失效" },
  { key: "A10", label: "A10 服务端请求伪造（SSRF）" },
];
/** 深层（P5 ③）的八类漏洞验证 */
export const DEEP_CLASSES = [
  { key: "unauth", label: "未鉴权访问" },
  { key: "idor", label: "越权（IDOR）" },
  { key: "sqli", label: "注入" },
  { key: "ssrf", label: "SSRF" },
  { key: "upload", label: "文件上传" },
  { key: "logic", label: "业务逻辑" },
  { key: "race", label: "竞态条件" },
  { key: "deser", label: "反序列化" },
];
/** 信息收集阶段（P2）的检查项中文名（不认识的 key 原样显示，不编造） */
export const INFO_KEY_LABELS = {
  tech: "技术栈", lang: "后端语言", language: "后端语言", code: "代码", repo: "代码仓库",
  middleware: "中间件", server: "中间件", os: "操作系统", arch: "网站架构",
  dirs: "目录", dir: "目录", paths: "路径", path: "路径", cert: "证书", tls: "证书",
  dns: "DNS", waf: "WAF·CDN", cdn: "WAF·CDN", third: "第三方组件", thirds: "第三方组件",
  deps: "第三方依赖", dep: "第三方依赖", headers: "安全头", header: "安全头",
  params: "参数面", param: "参数面", js: "JS 逆向", jsrev: "JS 逆向", banner: "banner",
  client: "客户端", cred: "凭据", cloud: "云资源", subdomain: "子域", vuln: "组件漏洞线索",
};
/** 检查状态 → 中文（详情栏逐项显示） */
export const STATUS_LABELS = {
  done: "已完成", ok: "一致", wrong: "采错了", unknown: "无法核验", na: "不适用",
  hit: "命中", miss: "未命中", pending: "待做", doing: "进行中",
};
export const statusLabel = (v) => STATUS_LABELS[String(v ?? "").toLowerCase()] || String(v ?? "-");

/** 检查项 key → 中文名（六张矩阵共用；不认识的 key 原样返回） */
export function checkKeyLabel(key) {
  const k = String(key ?? "");
  if (!k) return "";
  // tech_ok / cert_ok … = 对信息收集项的核实
  const base = k.replace(/_(ok|verified|verify)$/i, "");
  if (base !== k && INFO_KEY_LABELS[base]) return INFO_KEY_LABELS[base] + " 核验";
  for (const c of SHALLOW_CLASSES) if (c.key === k) return c.label;
  for (const c of OWASP_KEYS) if (c.key === k) return c.label;
  for (const c of DEEP_CLASSES) if (c.key === k) return c.label;
  return INFO_KEY_LABELS[k] || k;
}

// ── 六张矩阵：顺序、所属泳道、检查项集合 ─────────────────────────────────────
export const MATRIX_ORDER = [
  { key: "info", label: "信息收集", lane: "P2", stageKeys: ["info"] },
  { key: "verifyInfo", label: "核验信息收集", lane: "P3", stageKeys: ["verifyInfo"] },
  { key: "shallow", label: "浅层测试", lane: "P3", stageKeys: ["shallow"], classes: SHALLOW_CLASSES },
  { key: "verifyShallow", label: "核验浅层", lane: "P4", stageKeys: ["verifyShallow"] },
  { key: "owasp", label: "OWASP 逐类测试", lane: "P4", stageKeys: ["owasp"], classes: OWASP_KEYS },
  { key: "deep", label: "深层漏洞验证", lane: "P5", stageKeys: ["deep"], classes: DEEP_CLASSES },
];
/** 泳道 → 它对应的矩阵（起点/线索/死点/成果不算矩阵，各自另有口径） */
export const LANE_STAGE_KEYS = {
  start: [], info: ["info"], shallow: ["verifyInfo", "shallow"],
  verify: ["verifyShallow", "owasp"], deep: ["deep"], clue: [], dead: [], outcome: [],
};
/** 六张矩阵的键（旧契约容错时按这个列表逐项取默认值） */
export const STAGE_KEYS = ["info", "verifyInfo", "shallow", "verifyShallow", "owasp", "deep"];

const int = (n) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const nz = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const LIE = ["done", "na"];   // s2/s3 的「已覆盖」取值（与后端一致）

/** 已覆盖：done 或 na（na = 显式判定不适用，也算覆盖） */
export const stageDone = (v) => LIE.includes(String(v ?? ""));

/** 深测门槛：priority ≥ 3 才要求深测 */
export const deepEligible = (a) => int(a?.priority ?? 3) >= 3;

/** 事实归属泳道（资产类事实优先按资产清单匹配，见 computeLayout） */
export function factLaneIndex(fact, keys) {
  const list = Array.isArray(keys) && keys.length ? keys : LANE_KEYS;
  const cat = String(fact?.category ?? "fact");
  if (cat === "origin") return list.indexOf("P1");
  if (cat === "goal") return list.indexOf(OUTCOME_LANE) >= 0 ? list.indexOf(OUTCOME_LANE) : list.length - 1;
  const lane = FACT_LANE[cat];
  if (lane && list.includes(lane)) return list.indexOf(lane);
  if (list.includes(CLUE_LANE)) return list.indexOf(CLUE_LANE);
  // 老契约（没有「线索」泳道）兜底：按 id 稳定散布在中间三条泳道（不能全挤在起点泳道）
  let h = 0;
  for (const ch of String(fact?.id ?? "")) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return list.indexOf(MID_LANES[h % MID_LANES.length]);
}

/** 弃用事实（推翻的结论）——画进「死点」区 */
export const isDeadFact = (f) => Boolean(f && (f.deprecated === true || f.deprecated === 1 || String(f.deprecated ?? "") === "true"));

/** 资产检查表：checks[阶段][key] = 状态（done/na/ok/wrong/unknown/hit/miss/pending） */
const checksOf = (asset, stage) => {
  const c = asset && asset.checks && typeof asset.checks === "object" ? asset.checks[stage] : null;
  return c && typeof c === "object" ? c : {};
};
const sumOf = (asset, stage) => {
  const s = asset && asset.checkSummary && typeof asset.checkSummary === "object" ? asset.checkSummary[stage] : null;
  return s && typeof s === "object" ? s : null;
};
// 老契约兜底：旧数据只记了 info/verify/owasp/deep，新矩阵里的 verifyInfo（核验信息收集）
// 与 verifyShallow（核验浅层）在**整份资产都还是旧 key** 时退回读同一份 verify，
// 这样老宿主的面板不会退化成一片 0/0。新老混存时不走别名，避免把同一份 verify 算两遍。
const LEGACY_VERIFY_ALIAS = { verifyInfo: true, verifyShallow: true };
const hasNewerKeys = (asset) =>
  ["verifyInfo", "shallow", "verifyShallow"].some((k) => Object.keys(checksOf(asset, k)).length > 0 || Boolean(sumOf(asset, k)));
function stageChecks(asset, stage) {
  const direct = checksOf(asset, stage);
  if (Object.keys(direct).length || !LEGACY_VERIFY_ALIAS[stage] || hasNewerKeys(asset)) return direct;
  return checksOf(asset, "verify");
}
function stageSummary(asset, stage) {
  const direct = sumOf(asset, stage);
  if (direct || !LEGACY_VERIFY_ALIAS[stage] || hasNewerKeys(asset)) return direct;
  return sumOf(asset, "verify");
}
/** 该资产在这个阶段有没有记录（checks 或只有 checkSummary 都算） */
const hasStage = (asset, stage) =>
  Object.keys(stageChecks(asset, stage)).length > 0 || Boolean(stageSummary(asset, stage));

/** 某个阶段的完成度（**只认 checks**，与后端 checks 同口径）：
 *  done = 已给出结论的项（done/ok/hit/na），required = 该资产记录的检查项数；
 *  后端只给了 checkSummary（没有 checks）时按 summary 显示；
 *  两者都没有的资产 required = 0（面板显示 0/0，而不是凭空算满）。 */
function checkStat(asset, stage) {
  const keys = Object.keys(stageChecks(asset, stage));
  if (keys.length) {
    const vals = keys.map((k) => String(stageChecks(asset, stage)[k] ?? "").toLowerCase());
    const done = vals.filter((v) => v === "done" || v === "ok" || v === "hit" || v === "na").length;
    return { done, required: keys.length, pct: Math.round((done / keys.length) * 100), derived: true };
  }
  const sum = stageSummary(asset, stage);
  if (sum) {
    const required = Math.max(0, nz(sum.required));
    const done = Math.max(0, Math.min(required || 1e9, nz(sum.done)));
    return { done, required, pct: required > 0 ? Math.round((done / required) * 100) : 0, derived: false };
  }
  return { done: 0, required: 0, pct: 0, derived: true };
}
/** 两个阶段的指标合并（浅层 = 核验信息收集 + 浅层测试；中间层 = 核验浅层 + OWASP） */
function mergeStat(a, b) {
  const done = nz(a?.done) + nz(b?.done), required = nz(a?.required) + nz(b?.required);
  return { done, required, pct: required > 0 ? Math.round((done / required) * 100) : 0, derived: Boolean(a?.derived || b?.derived) };
}
const countStatus = (asset, stage, name) =>
  Object.keys(stageChecks(asset, stage)).filter((k) => String(stageChecks(asset, stage)[k]) === name).length;

/** 该资产在某个泳道里显示的节点（不在该泳道就返回 null）
 *  - info    ：信息收集（P2）
 *  - shallow ：核实信息收集 + 浅层测试（P3）
 *  - verify  ：核实浅层 + OWASP A01–A10（P4）
 *  - deep    ：深层漏洞验证（P5） */
function laneNodeFor(asset, laneKey) {
  if (!laneKey || laneKey === "start" || laneKey === "outcome") return null;
  if (laneKey === "info") {
    const stat = checkStat(asset, "info");
    return { stat, parts: [stat, null], hasChecks: hasStage(asset, "info"), wrong: 0, unknown: 0, ok: 0, hits: 0, hasOwasp: false };
  }
  if (laneKey === "shallow") {
    const vi = checkStat(asset, "verifyInfo"), sh = checkStat(asset, "shallow");
    return {
      stat: mergeStat(vi, sh), parts: [vi, sh],
      hasChecks: hasStage(asset, "verifyInfo") || hasStage(asset, "shallow"),
      wrong: countStatus(asset, "verifyInfo", "wrong"),
      unknown: countStatus(asset, "verifyInfo", "unknown"),
      ok: countStatus(asset, "verifyInfo", "ok"), hits: 0, hasOwasp: false,
    };
  }
  if (laneKey === "verify") {
    const vs = checkStat(asset, "verifyShallow"), ow = checkStat(asset, "owasp");
    return {
      stat: mergeStat(vs, ow), parts: [vs, ow],
      hasChecks: hasStage(asset, "verifyShallow") || hasStage(asset, "owasp"),
      wrong: countStatus(asset, "verifyShallow", "wrong"),
      unknown: countStatus(asset, "verifyShallow", "unknown"),
      ok: countStatus(asset, "verifyShallow", "ok") + countStatus(asset, "owasp", "hit"),
      hits: countStatus(asset, "owasp", "hit"), hasOwasp: hasStage(asset, "owasp"),
    };
  }
  if (laneKey === "deep") {
    const stat = checkStat(asset, "deep");
    return {
      stat, parts: [stat, null], hasChecks: hasStage(asset, "deep"), wrong: 0,
      unknown: countStatus(asset, "deep", "unknown"), ok: 0,
      hits: countStatus(asset, "deep", "hit"), hasOwasp: false,
    };
  }
  return null;
}

/** 一个泳道节点是否「做完」（有检查项、且全部给出结论） */
const isFull = (node) => Boolean(node && node.stat && node.stat.required > 0 && node.stat.pct >= 100);

/**
 * 资产在信息收集 / 浅层 / 中间层 / 深层四条泳道里的分布（返回泳道 id：P2…P5）：
 * - checks 有数据 → 已完成、有进展、或更后面的阶段已开始（说明前面的阶段早已走过）都画出节点；
 * - 没有 checks → 退化用 s2/s3 判定（旧数据只到这一步）。
 *
 * **资产清单落在「信息收集」泳道**（一行一个资产，显示 info 完成度）；起点泳道只放 origin 锚点，
 * 它的完成度由泳道标题的「N/N · 收集轮次 k」说话。为什么不再把 91 个资产同时画进起点泳道：
 * 同一批资产在两条泳道各画一遍，节点数直接翻倍、图被拉得很高，全屏后字就小到看不清。
 *
 * 推进规则（宁严勿松，但别把深层藏起来）：
 *  ① 信息收集没采全 → 浅层的「核实」无从谈起，后面三层一律不画；
 *  ② 浅层 / 中间层只要**已经开始过**，下一层就画出来 —— OWASP 的 miss（测过未命中）
 *     不计入 done，若用 100% 当门槛，「深层」在真实数据里永远看不见；
 *  ③ 深层还要 priority ≥ 3（deepEligible）才要求，s3=na 且没有 deep 记录的不画。
 */
function assetLaneSet(asset) {
  const deep = deepEligible(asset);
  const out = [];
  const s2on = stageDone(asset?.s2) || String(asset?.s2 ?? "") === "doing";
  const s3on = deep && (stageDone(asset?.s3) || String(asset?.s3 ?? "") === "doing");
  const hasAny = STAGE_KEYS.some((k) => hasStage(asset, k));
  if (!hasAny) {
    // 旧数据只有 s2/s3：没动过的也画在「信息收集」第一格（待采集清单）；浅测覆盖 → 继续；深测覆盖 → 一路画到「深层」
    out.push("P2");
    if (s3on) out.push("P3", "P4", "P5");
    return out;
  }
  const nodes = {
    P2: laneNodeFor(asset, "info"),
    P3: laneNodeFor(asset, "shallow"),
    P4: laneNodeFor(asset, "verify"),
    P5: laneNodeFor(asset, "deep"),
  };
  const done = { P2: isFull(nodes.P2), P3: isFull(nodes.P3), P4: isFull(nodes.P4), P5: isFull(nodes.P5) };
  const started = {
    P2: Boolean(nodes.P2 && nodes.P2.hasChecks) || s2on,
    P3: Boolean(nodes.P3 && nodes.P3.hasChecks),
    P4: Boolean(nodes.P4 && nodes.P4.hasChecks),
    P5: Boolean(nodes.P5 && nodes.P5.hasChecks),
  };
  if (!done.P2) { started.P3 = false; done.P3 = false; }   // 信息收集没采全，浅层的「核实」无从谈起
  if (!started.P3) { started.P4 = false; done.P4 = false; }
  if (!deep || !started.P4 || (String(asset?.s3 ?? "") === "na" && !started.P5)) { started.P5 = false; done.P5 = false; }
  const fur = {
    P2: started.P2 || done.P2, P3: started.P3 || done.P3,
    P4: started.P4 || done.P4, P5: started.P5 || done.P5,
  };
  if (fur.P5) { fur.P4 = true; fur.P3 = true; fur.P2 = true; }
  if (fur.P4) { fur.P3 = true; fur.P2 = true; }
  if (fur.P3) fur.P2 = true;
  for (const k of ["P2", "P3", "P4", "P5"]) if (fur[k]) out.push(k);
  // 兜底：checks 键存在但全是空表 / 只有 s2='pending' —— 也得有个落脚点，别让资产从图上消失
  if (!out.length) out.push("P2");
  return out;
}

/** 资产在泳道里的「指标」文案（节点第三行）
 *  信息收集 `info 6/6 · 100%`；浅层 `verifyInfo 4/4 + shallow 6/8 · 83%`；
 *  中间层 `verifyShallow 2/4 + owasp 1/10 · 21% · 命中 1`；深层 `deep 2/8 · 命中 2`。 */
function laneMetric(node, laneKey) {
  if (!node) return "";
  const d = node.stat.done, r = node.stat.required;
  const parts = node.parts || [];
  const pair = (nameA, nameB) => {
    const a = parts[0] || { done: 0, required: 0 }, b = parts[1] || { done: 0, required: 0 };
    return nameA + " " + a.done + "/" + a.required + " + " + nameB + " " + b.done + "/" + b.required;
  };
  const warn = (node.wrong || 0) + (node.unknown || 0);
  if (laneKey === "info") return "info " + d + "/" + r + " · " + node.stat.pct + "%";
  if (laneKey === "shallow") {
    return pair("verifyInfo", "shallow") + " · " + node.stat.pct + "%" + (warn ? " · ⚠ 待核实 " + warn : "");
  }
  if (laneKey === "verify") {
    return pair("verifyShallow", "owasp") + " · " + node.stat.pct + "%"
      + (node.hits ? " · 命中 " + node.hits : "") + (warn ? " · ⚠ 待核实 " + warn : "");
  }
  if (laneKey === "deep") return "deep " + d + "/" + r + (node.hits ? " · 命中 " + node.hits : "");
  return "";
}

/** 泳道完成度（后端 stages 优先；缺了就地按资产 checks 汇总；面板的泳道标题与覆盖矩阵共用） */
export function laneCompletion(coverage, assets, lane) {
  const list = arr(assets);
  const c = coverage || {};
  const key = typeof lane === "string" ? lane : String(lane?.key ?? lane?.id ?? "");
  const stages = (c && c.stages && typeof c.stages === "object") ? c.stages : {};
  const pick = (...keys) => {
    for (const k of keys) { const v = stages[k]; if (v && typeof v === "object") return v; }
    return null;
  };
  const fmt = (done, required, hint) => {
    const d = Math.max(0, nz(done)), r = Math.max(0, nz(required));
    return { done: d, required: r, pct: r > 0 ? Math.round((d / r) * 100) : 0, derived: false, hint: hint ? String(hint) : null };
  };
  // 后端没给 stages（或这一层没有对应字段）：就地把资产 checks 汇总出来
  const fromAssets = (stageKeys, eligibleOnly) => {
    let d = 0, r = 0;
    for (const a of list) {
      if (eligibleOnly && !deepEligible(a)) continue;
      for (const k of stageKeys) { const s = checkStat(a, k); d += s.done; r += s.required; }
    }
    return { done: d, required: r, pct: r > 0 ? Math.round((d / r) * 100) : 0, derived: true, hint: null };
  };
  // 起点：走的是「资产收集到饱和」这条线，不算 OWASP 式的覆盖面
  if (key === "start") {
    const n = nz(c?.counts?.assets ?? list.length);
    const rounds = nz(c?.recon?.rounds);
    const hint = rounds > 0 ? "收集轮次 " + rounds + (nz(c?.recon?.addedThisRound) === 0 && rounds > 1 ? " · 已饱和" : "") : null;
    return { done: n, required: n, pct: n > 0 ? 100 : 0, derived: true, hint };
  }
  // 线索 / 死点：不是覆盖矩阵，按「图上有多少条」计数（数量由 computeLayout 就地填）
  if (key === "clue" || key === "dead") {
    return { done: 0, required: 0, pct: 0, derived: true, hint: null, counted: true };
  }
  // 成果：证据索引 + 报告 + 未测面声明 + 每条漏洞事实复核
  if (key === "outcome") {
    const rv = c?.reviews && typeof c.reviews === "object" ? c.reviews : {};
    const total = nz(rv.vuln), reviewed = nz(rv.reviewed), pending = nz(rv.pending);
    const un = c?.untested && typeof c.untested === "object" ? c.untested : {};
    const items = arr(un.items);
    const hint = "复核 " + reviewed + "/" + total + (pending ? " · 待复核 " + pending : "")
      + (items.length ? " · 未测面 " + items.length + (un.declared === true ? "（已声明）" : "（未声明）") : "");
    return { done: reviewed, required: total, pct: total > 0 ? Math.round((reviewed / total) * 100) : 0, derived: false, hint };
  }
  // 信息收集：独立阶段，直接读 info 矩阵
  if (key === "info") {
    const s = pick("info");
    if (s) return fmt(s.done, s.required, s.label || null);
    return fromAssets(["info"], false);
  }
  // 浅层 = 核实信息收集 + 浅层测试（两类工作之和）
  if (key === "shallow") {
    const a = pick("verifyInfo"), b = pick("shallow");
    if (!a && !b) return fromAssets(["verifyInfo", "shallow"], false);
    const d = nz(a?.done) + nz(b?.done), r = nz(a?.required) + nz(b?.required);
    return {
      done: d, required: r, pct: r > 0 ? Math.round((d / r) * 100) : 0, derived: false,
      hint: "核实信息收集 " + nz(a?.done) + "/" + nz(a?.required) + " · 浅层测试 " + nz(b?.done) + "/" + nz(b?.required),
    };
  }
  // 中间层 = 核实浅层 + OWASP Top 10（老契约里核验只有一份 verify，落到「核实浅层」）
  if (key === "verify") {
    const v = pick("verifyShallow", "verify"), o = pick("owasp");
    if (!v && !o) return fromAssets(["verifyShallow", "owasp"], false);
    const d = nz(v?.done) + nz(o?.done), r = nz(v?.required) + nz(o?.required);
    return {
      done: d, required: r, pct: r > 0 ? Math.round((d / r) * 100) : 0, derived: false,
      hint: "核实浅层 " + nz(v?.done) + "/" + nz(v?.required) + " · OWASP " + nz(o?.done) + "/" + nz(o?.required),
    };
  }
  // 深层：只有 priority ≥ 3 的资产才算分母
  if (key === "deep") {
    const s = pick("deep");
    if (s) return fmt(s.done, s.required, s.label || null);
    return fromAssets(["deep"], true);
  }
  return fmt(0, 0, null);
}

/**
 * 把 /coverage 归一化成**八条泳道**及其完成度文案。
 * 缺字段 / null 都不抛错：面板必须始终能画出八条泳道。
 * 「线索」「死点」不是覆盖矩阵，只按图上的条数计数（数量由 computeLayout 就地填）。
 */
export function lanesFromCoverage(coverage, assets) {
  const c = coverage || {};
  const declared = c.stages && typeof c.stages === "object" ? Object.keys(c.stages).length : 0;
  return LANES.map((lane) => {
    const stat = laneCompletion(c, assets, lane);
    const counted = lane.counted === true || stat.counted === true;
    const text = counted
      ? lane.label
      : lane.label + " " + stat.done + "/" + stat.required + "（" + stat.pct + "%）" + (stat.hint ? " · " + stat.hint : "");
    return {
      id: lane.id, key: lane.key, label: lane.label, title: lane.label, desc: lane.desc,
      groups: lane.groups ? lane.groups.map((g) => ({ key: g.key, label: g.label })) : null,
      counted,
      done: stat.done, required: stat.required, pct: stat.pct, hint: stat.hint,
      text, derived: stat.derived,
      missing: !declared && lane.key !== "start",
    };
  });
}

/** 空图时也要能画出八条泳道 */
const EMPTY_LANES = () => lanesFromCoverage({}, []);

// 资产 id → 资产（用于把事实类的资产记录对到清单条目上）
const assetByValue = (assets, fact) => {
  const v = String(fact?.value ?? fact?.target ?? "");
  if (!v) return null;
  return arr(assets).find((a) => String(a?.value ?? "") === v) || null;
};

/**
 * 把黑板图折成可绘制的节点/边，**行优先**：row = 泳道序号（从上到下），col = 泳道内横排序号。
 * - 起点（origin）固定第一条泳道，成果（goal）+ category=vuln 的事实固定最后一条泳道。
 * - 资产节点按矩阵完成度放进信息收集 / 浅层 / 中间层 / 深层四条泳道
 *   （用 assets 的 checks / checkSummary，缺了按 s2/s3 兜底）。
 * - **线索**泳道：其余事实按 confidence 分两组摆（已确认事实 / 未确认）+ 未结论意图的「待探索」虚框。
 * - **死点**泳道：死意图与 deprecated 事实（灰色虚框，留痕不消失）。
 * - 边：intent 的 from → to 沿用 edgeColor 三类线型；资产跨泳道之间补一条纵向连线。
 *
 * 导出签名兼容：computeLayout(graph, coverage, assets) —— 后两个参数可缺省，
 * 缺省时退化成「只有 facts + intents」的旧行为。
 */
export function computeLayout(graph, coverage, assets) {
  const facts = arr(graph && graph.facts);
  const intents = arr(graph && graph.intents);
  const cov = coverage && typeof coverage === "object" ? coverage : {};
  const assetList = arr(assets);
  let lanes = arr(coverage && coverage.lanes).length ? coverage.lanes : lanesFromCoverage(cov, assetList);
  if (!Array.isArray(lanes) || !lanes.length) lanes = EMPTY_LANES();
  const empty = { nodes: [], edges: [], deadZone: { nodes: [], x: PAD, y: PAD, w: 0, h: 0 }, lanes, laneWidth: LANE_W_MIN, width: PAD * 2, height: PAD * 2 };

  const origin = facts.find((f) => f.category === "origin") ?? facts.find((f) => f.id === "origin");
  const goal = facts.find((f) => f.category === "goal") ?? facts.find((f) => f.id === "goal");
  const deadFacts = facts.filter(isDeadFact);
  const findings = facts.filter((f) => f !== origin && f !== goal && !isDeadFact(f) && (f.category === "vuln" || f.category === "finding" || f.severity));
  const findingSet = new Set(findings);
  // 其余事实 = 线索（含 asset / endpoint / cred / note / 普通 fact），按 confidence 分「已确认 / 未确认」
  const clues = facts
    .filter((f) => f !== origin && f !== goal && !isDeadFact(f) && !findingSet.has(f))
    .slice()
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
  const pendingIntents = intents.filter((it) => !it.concluded_at && !it.dead);
  const deadIntents = intents.filter((it) => it.dead);
  if (!facts.length && !intents.length && !assetList.length) return empty;

  // ── 行优先排列：先按泳道分组，再在泳道内横向排队（带 groups 的泳道再按组上下分层）────
  const rows = lanes.map((l) => ({ lane: l, items: [] }));
  const idxOf = (id) => { const i = rows.findIndex((r) => r.lane.id === id); return i < 0 ? rows.length - 1 : i; };
  const last = Math.max(0, rows.length - 1);
  const push = (rowIdx, node) => rows[Math.max(0, Math.min(last, rowIdx))].items.push(node);

  const factsById = new Map(facts.map((f) => [f.id, f]));
  const assetFactIds = new Set();
  for (const a of assetList) {
    if (factsById.has(a.id)) assetFactIds.add(a.id);
    const hit = assetByValue(facts, { value: a.value });
    if (hit) assetFactIds.add(hit.id);
  }

  if (origin) push(idxOf("P1"), { id: origin.id, kind: "origin", fact: origin, lane: idxOf("P1") });
  for (const f of clues) {
    let fromAsset = null;
    if (assetFactIds.has(f.id)) {
      const a = assetByValue(assetList, f) || assetList.find((x) => x.id === f.id);
      if (a) fromAsset = { id: a.id, value: a.value, label: a.label, tech: a.tech };
    }
    const row = factLaneIndex(f, lanes.map((l) => l.id));
    push(row, { id: f.id, kind: "fact", fact: f, lane: Math.max(0, row), fromAsset, group: clueGroup(f) });
  }
  // 未结论的意图 = 未确认的线索（待探索虚框）
  for (const it of pendingIntents) {
    push(idxOf(CLUE_LANE), { id: `ph_${it.id}`, kind: "pending", intent: it, lane: idxOf(CLUE_LANE), group: "suspected" });
  }
  // 资产节点：信息收集 / 浅层 / 中间层 / 深层四条泳道各出一个（assetLaneSet 返回泳道 id）
  const assetNodes = new Map();
  for (const a of assetList) {
    for (const laneId of assetLaneSet(a)) {
      const target = lanes.find((l) => l.id === laneId);
      if (!target) continue;
      const rowIdx = rows.findIndex((r) => r.lane.key === target.key);
      if (rowIdx < 0) continue;
      const info = laneNodeFor(a, target.key);
      const node = {
        id: "as_" + String(a?.id ?? a?.value ?? "") + "_" + target.key,
        kind: "lane", asset: a, stage: target.key, lane: rowIdx,
        metric: laneMetric(info, target.key), stat: info ? info.stat : null,
        wrong: info ? info.wrong : 0, hits: info ? info.hits : 0,
      };
      assetNodes.set(String(a?.id ?? "") + "/" + target.key, node);
      push(rowIdx, node);
    }
  }
  // 成果泳道：goal + category=vuln（按严重级排序）
  const ranked = findings.slice().sort((a, b) => {
    const ra = SEV_RANK[String(a.severity ?? "").toLowerCase()] ?? 9;
    const rb = SEV_RANK[String(b.severity ?? "").toLowerCase()] ?? 9;
    return ra - rb || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
  const outcomeIdx = idxOf(OUTCOME_LANE);
  for (const f of ranked) push(outcomeIdx, { id: f.id, kind: "finding", fact: f, lane: outcomeIdx });
  // 死点泳道：死意图 + 被推翻的事实（灰色虚框，集中在这一条泳道里）
  const deadIdx = idxOf(DEAD_LANE);
  for (const it of deadIntents) push(deadIdx, { id: `dh_${it.id}`, kind: "dead", intent: it, deadType: "intent", lane: deadIdx });
  for (const f of deadFacts) push(deadIdx, { id: `df_${f.id}`, kind: "dead", fact: f, deadType: "fact", lane: deadIdx });

  const nodes = [];
  const byId = new Map();
  const add = (n) => { nodes.push(n); byId.set(n.id, n); return n; };

  // 分组泳道（线索）：把 items 按 groups 顺序分桶；未标组的归第一组
  const groupsOf = (lane) => (Array.isArray(lane?.groups) && lane.groups.length ? lane.groups : []);
  const bucketize = (items, groups) => {
    if (!groups.length) return [{ key: null, label: null, items }];
    const buckets = groups.map((g) => ({ key: g.key, label: g.label, items: [] }));
    for (const n of items) {
      const hit = buckets.find((b) => b.key === n.group) || buckets[0];
      hit.items.push(n);
    }
    return buckets;
  };
  // 每条泳道的行数上限：按条数取平方根（方格阵），夹在 1..PER_ROW_MAX 之间
  const maxColsFor = (n) => Math.max(1, Math.min(PER_ROW_MAX, Math.ceil(Math.sqrt(Math.max(1, n)))));
  // 泳道内容 → 若干「子行」：先按分组分桶，再把每桶按 per 列换行；组名只挂在每组第一行上
  const subRowsFor = (lane, items) => {
    const groups = groupsOf(lane);
    const per = maxColsFor(items.length);
    const out = [];
    for (const b of bucketize(items, groups)) {
      if (!b.items.length) continue;
      for (let i = 0; i < b.items.length; i += per) {
        const first = i === 0;
        out.push({
          key: groups.length ? b.key : null,
          label: groups.length && first ? b.label : null,
          headH: groups.length && first ? GROUP_HEAD : 0,
          total: b.items.length,
          items: b.items.slice(i, i + per),
        });
      }
    }
    return out;
  };
  const subRowsByRow = rows.map((row) => subRowsFor(row.lane, row.items));

  let contentW = PAD + NODE_W;
  const laneH = rows.map((row, i) => {
    const subs = subRowsByRow[i];
    if (!row.items.length || !subs.length) return LANE_GAP;
    let h = 0;
    subs.forEach((s, j) => { h += s.headH + NODE_H + (j + 1 < subs.length ? IN_LANE_GAP : 0); });
    return h;
  });
  rows.forEach((row, i) => {
    for (const s of subRowsByRow[i]) {
      // 子行内从第 0 列重新排队（否则第二组 / 换行后的行会接着上一行的列号往右缩进）
      s.items.forEach((n, j) => { n.col = j; n.row = i; });
      const w = PAD + NODE_W + (s.items.length ? (s.items.length - 1) * (NODE_W + COL_GAP) + COL_GAP : 0);
      contentW = Math.max(contentW, w);
    }
  });

  let y = PAD;
  lanes.forEach((lane, i) => {
    const row = rows[i];
    const laneTop = y;
    const h = laneH[i];
    lane.x = PAD; lane.y = laneTop; lane.h = h + LANE_HEAD; lane.w = contentW; lane.row = i;
    lane.subRows = [];
    let gy = laneTop + LANE_HEAD;
    subRowsByRow[i].forEach((s, j) => {
      if (s.label) lane.subRows.push({ key: s.key, label: s.label, y: gy, headH: s.headH, count: s.total });
      const nodeTop = gy + s.headH;
      for (const n of s.items) {
        const x = PAD + n.col * (NODE_W + COL_GAP);
        n.x = x; n.y = nodeTop; n.w = NODE_W; n.h = NODE_H;
        add(n);
      }
      gy = nodeTop + NODE_H + (j + 1 < subRowsByRow[i].length ? IN_LANE_GAP : 0);
    });
    y = laneTop + h + LANE_HEAD + ROW_GAP;
  });
  const lanesBottom = y - ROW_GAP + PAD;

  // 「线索」「死点」两条泳道的计数文案（不是覆盖矩阵，用条数说话）
  const laneRowIdx = (laneId) => rows.findIndex((r) => r.lane.id === laneId);
  const clueRow = laneRowIdx(CLUE_LANE);
  if (clueRow >= 0) {
    const lane = rows[clueRow].lane;
    const items = rows[clueRow].items;
    const conf = items.filter((n) => n.kind !== "pending" && n.group !== "suspected").length;
    const susp = items.filter((n) => n.kind === "pending" || n.group === "suspected").length;
    lane.done = conf; lane.required = items.length; lane.pct = items.length ? Math.round((conf / items.length) * 100) : 0;
    lane.hint = items.length ? "线索 " + items.length + " 条 · 已确认 " + conf + " · 未确认 " + susp : null;
    lane.text = lane.label + (lane.hint ? " · " + lane.hint : "");
  }
  const deadRow = laneRowIdx(DEAD_LANE);
  if (deadRow >= 0) {
    const lane = rows[deadRow].lane;
    const items = rows[deadRow].items;
    const di = items.filter((n) => n.deadType === "intent").length;
    const df = items.filter((n) => n.deadType === "fact").length;
    lane.done = 0; lane.required = items.length; lane.pct = 0;
    lane.hint = items.length ? "死点 " + items.length + " 个 · 死路方向 " + di + " · 被推翻结论 " + df : null;
    lane.text = lane.label + (lane.hint ? " · " + lane.hint : "");
  }

  // 死点区（老契约遗留）：死点现在有自己的泳道，这里恒为空 —— 保留字段让老面板不崩
  const deadZone = { nodes: [], x: PAD, y: PAD, w: 0, h: 0 };

  const goalX = PAD + (rows[last].items.reduce((m, n) => Math.max(m, n.col), 0) + 1) * (NODE_W + COL_GAP);
  if (goal) {
    const node = { id: goal.id, kind: "goal", fact: goal, col: rows[last].items.reduce((m, n) => Math.max(m, n.col), -1) + 1, row: last, x: goalX, y: rows[last] ? rows[last].lane.y + LANE_HEAD : PAD, w: NODE_W, h: NODE_H, lane: last, laneCap: rows[last].lane.text };
    add(node);
  }
  // 统一补上泳道几何（面板要按行画底色条 / 标题）。
  // 第三行的说明文字只给「起点/成果」这种锚点节点 + 分组泳道的组名，其余事实节点留空 ——
  // 否则整条泳道全是重复文案。
  for (const n of nodes) {
    const lane = lanes[n.row];
    if (!lane) continue;
    n.laneY = lane.y; n.laneH = lane.h;
    n.laneCap = n.kind === "origin" || n.kind === "goal" ? lane.label : "";
    if (n.kind === "origin" && lane.hint) n.laneCap = lane.label + " · " + lane.hint;
    if (n.kind === "goal" && lane.hint) n.laneCap = lane.label + " · " + lane.hint;
    const sub = (lane.subRows || []).find((s) => s.key === n.group);
    if (sub && sub.label) n.laneCap = sub.label;
  }

  // ── 边 ────────────────────────────────────────────────────────────────────
  const edges = [];
  for (const it of intents) {
    const targetId = it.to_fact ? it.to_fact : (it.dead ? `dh_${it.id}` : `ph_${it.id}`);
    if (!targetId || !byId.has(targetId)) continue;
    const kind = it.dead ? "dead" : it.concluded_at ? "concluded" : "pending";
    const froms = (it.from ?? []).filter((f) => byId.has(f));
    const list = froms.length ? froms : (byId.has("origin") ? ["origin"] : []);
    for (const f of list) edges.push({ id: `${it.id}:${f}->${targetId}`, from: f, to: targetId, intent: it, kind, vertical: true });
  }
  // 资产跨泳道的纵向连线：信息收集 → 浅层 → 中间层 → 深层（同一资产，垂直对齐）
  for (const a of assetList) {
    const chain = ["info", "shallow", "verify", "deep"].map((k) => assetNodes.get(String(a?.id ?? "") + "/" + k)).filter(Boolean);
    for (let i = 0; i + 1 < chain.length; i++) {
      edges.push({
        id: "lane:" + chain[i].id + "->" + chain[i + 1].id, from: chain[i].id, to: chain[i + 1].id,
        kind: "pending", asset: a, laneEdge: true, vertical: true,
      });
    }
  }

  const width = Math.max(
    ...[PAD * 2, ...nodes.map((n) => n.x + n.w + PAD), deadZone.nodes.length ? deadZone.x + deadZone.w + PAD : 0, contentW + PAD],
  );
  const height = Math.max(
    ...[PAD * 2, ...nodes.map((n) => n.y + n.h + PAD), deadZone.nodes.length ? deadZone.y + deadZone.h + PAD : 0, lanesBottom],
  );
  return { nodes, edges, byId, lanes, deadZone, laneWidth: Math.max(contentW, LANE_W_MIN), width, height };
}

/** 待探索/已结论意图的短标签 */
export const intentLabel = (it) => `${it.id}${it.dead ? "·死路" : it.concluded_at ? "·已结论" : it.worker ? `·${String(it.worker).slice(0, 10)}` : ""}`;

/** 会话 id 缩短显示（面板上写全 id 太长，前 8 位足够人眼区分） */
export const shortSession = (id) => {
  const s = String(id ?? "");
  if (!s) return "";
  const m = s.match(/^session-([0-9a-f-]+)$/i);
  return (m ? m[1] : s).slice(0, 8);
};

/**
 * 面板顶栏「按会话分类」的视图模型：把 /projects 的行按**绑定的会话**分组。
 * - 「本会话」组永远排第一（没有就是空组，面板会提示"本会话还没有黑板"）；
 * - 其余会话按最近更新时间倒序；没绑会话的项目归到「未绑定会话」；
 * - `labelOf(sessionId)` 由面板注入（宿主 sessions 服务里有会话标题），缺省退回短 id。
 */
export function projectsView(json, opts = {}) {
  const sessionId = String(opts.sessionId ?? "");
  const labelOf = typeof opts.labelOf === "function" ? opts.labelOf : null;
  const rows = arr(json?.projects).map((p) => ({
    id: String(p?.id ?? ""),
    title: String(p?.title ?? p?.id ?? ""),
    sessionId: p?.sessionId ? String(p.sessionId) : null,
    cwd: p?.cwd ? String(p.cwd) : null,
    phase: p?.phase ? String(p.phase) : null,
    status: String(p?.status ?? ""),
    updatedAt: String(p?.updatedAt ?? ""),
    counts: {
      facts: nz(p?.counts?.facts), intents: nz(p?.counts?.intents),
      open: nz(p?.counts?.open), hints: nz(p?.counts?.hints), assets: nz(p?.counts?.assets),
    },
    empty: p?.empty === true || Boolean(p?.empty),
    mine: p?.mine === true || Boolean(p?.mine) || (sessionId !== "" && String(p?.sessionId ?? "") === sessionId),
  }));
  const groups = new Map();
  for (const row of rows) {
    const key = row.sessionId ?? "(未绑定会话)";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sessionId: row.sessionId,
        mine: sessionId !== "" && row.sessionId === sessionId,
        short: shortSession(row.sessionId),
        label: row.sessionId ? (labelOf ? labelOf(row.sessionId) : null) : "未绑定会话",
        rows: [],
        latest: "",
      });
    }
    const g = groups.get(key);
    g.rows.push(row);
    if (row.updatedAt > g.latest) g.latest = row.updatedAt;
  }
  const list = [...groups.values()];
  for (const g of list) {
    if (!g.label) g.label = g.short ? `会话 ${g.short}` : "未知会话";
    g.rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    g.summary = g.rows.length === 1 ? g.rows[0] : null;
  }
  list.sort((a, b) => (Number(b.mine) - Number(a.mine)) || String(b.latest).localeCompare(String(a.latest)));
  const mineGroup = list.find((g) => g.mine) ?? null;
  return {
    sessionId: sessionId || null,
    mineId: json?.mineId ? String(json.mineId) : (mineGroup?.rows?.[0]?.id ?? null),
    mine: mineGroup?.rows?.[0] ?? null,
    groups: list,
    total: rows.length,
    others: list.filter((g) => !g.mine),
  };
}

/**
 * 「适应窗口」的缩放 = 容器与图两个方向比例的较小值（两边都装得下）。
 * 下限 0.12：真实作业里资产上百个、列很宽，0.3 的下限会让"整张图"根本装不下。
 * 拿不到容器尺寸（0/NaN）时退回 1（100%），绝不返回 0/NaN 把图缩没了。
 */
export function fitZoom(layoutW, layoutH, boxW, boxH, pad = 48, min = 0.05, max = 1.6) {
  const w = Math.max(1, nz(layoutW)) + pad, h = Math.max(1, nz(layoutH)) + pad;
  const bw = Number(boxW) || 0, bh = Number(boxH) || 0;
  if (!(bw > 0) || !(bh > 0)) return 1;
  return Math.max(min, Math.min(max, Math.min(bw / w, bh / h)));
}

/** 成果：category=vuln 或带 severity 的事实（不含废弃）。**形状漂移不抛错**：facts 不是数组时按空处理 */
export function extractFindings(graph) {
  const facts = arr(graph?.facts).filter((f) => f && !isDeadFact(f) && (f.category === "vuln" || f.category === "finding" || f.severity));
  return facts.sort((a, b) => {
    const ra = SEV_RANK[String(a.severity ?? "").toLowerCase()] ?? 9;
    const rb = SEV_RANK[String(b.severity ?? "").toLowerCase()] ?? 9;
    return ra - rb || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

/** 资产 / 接口 / 凭据类事实（形状漂移不抛错） */
export function extractAssets(graph) {
  return arr(graph?.facts).filter((f) => f && !isDeadFact(f) && ["asset", "endpoint", "cred", "note"].includes(f.category));
}

/** 死路清单（意图，形状漂移不抛错）*/
export function extractDeadEnds(graph) {
  return arr(graph?.intents).filter((it) => it && (it.dead || it.status === "dead"));
}

/** 死点清单：死意图 + 被推翻的事实（图上「死点」区的内容） */
export function extractDeadPoints(graph) {
  const out = [];
  for (const it of extractDeadEnds(graph)) out.push({ id: it.id, type: "intent", what: it.description, note: it.note, dead: true });
  for (const f of arr(graph?.facts).filter(isDeadFact)) out.push({ id: f.id, type: "fact", what: f.description, note: f.evidence, dead: true });
  return out;
}

/** 按严重级计数 */
export function severityCounts(findings) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, other: 0 };
  for (const f of arr(findings)) {
    const s = String(f.severity ?? "").toLowerCase();
    if (s in out) out[s] += 1; else out.other += 1;
  }
  return out;
}

/** 成果表 → Markdown（面板的「复制 Markdown」用） */
export function findingsMarkdown(graph) {
  const findings = extractFindings(graph);
  const title = graph?.project?.title ?? "未命名任务";
  const lines = [`# ${title} — 成果汇总`, "", `- 目标（goal）：${graph?.project?.goal ?? ""}`, `- 起点（origin）：${graph?.project?.origin ?? ""}`, `- 成果数：${findings.length}`, "", "| ID | 严重级 | 标题 | 目标 | 状态 | 证据 |", "|---|---|---|---|---|---|"];
  for (const f of findings) {
    const t = String(f.description ?? "").replace(/\|/g, "/").split("\n")[0].slice(0, 90);
    lines.push(`| ${f.id} | ${f.severity ?? "-"} | ${t} | ${f.target ?? "-"} | ${f.status ?? f.confidence ?? "-"} | ${f.evidence ?? "-"} |`);
  }
  const dead = extractDeadEnds(graph);
  if (dead.length) {
    lines.push("", "## 死路与未排除面", "");
    for (const d of dead) lines.push(`- ${d.id} ${String(d.description ?? "").slice(0, 100)}${d.note ? ` —— ${String(d.note).slice(0, 120)}` : ""}`);
  }
  return lines.join("\n");
}

// ── 覆盖矩阵（「这次作业测得全不全」）────────────────────────────────────────
export const COVERAGE_GAP_LIMIT = 20;
// 六阶段：起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果
export const PHASE_ORDER = ["P1", "P2", "P3", "P4", "P5", "P6"];
export const PHASE_LABEL_FALLBACK = {
  P1: "起点：资产收集（直到连续一轮 0 新增的饱和）",
  P2: "信息收集：逐资产把信息采全（技术栈 / 语言 / 中间件 / 操作系统 / 网站架构 / 目录 / 路径 / 证书 / DNS / WAF·CDN / 第三方 / 安全头，并按 kind 追加）",
  P3: "浅层：核实信息收集阶段的工作（逐项 ok/wrong/unknown）+ 浅层测试（指纹行为验证 / 路径真值 / 参数面与基线 / 鉴权边界 / 错误与信息泄露 / 暴露面存在性 / 低频模糊 / 组件版本线索）",
  P4: "中间层：核实浅层的工作 + OWASP Top 10 (2021) A01–A10 逐类测试",
  P5: "深层：完整读取已有全部信息 + 核验中间层是否有误 + 逐资产漏洞验证（未鉴权/越权/注入/SSRF/上传/逻辑/竞态/反序列化）",
  P6: "成果：证据索引 + 报告 + 未测面声明 + 每条漏洞事实复核",
};

/** 资产按 value 定位（缺口清单点一条 → 右侧详情用） */
export function findAssetByValue(assets, value, kind) {
  const list = arr(assets);
  const v = String(value ?? "");
  const k = kind ? String(kind) : "";
  return list.find((a) => String(a?.value ?? "") === v && (!k || String(a?.kind ?? "") === k))
    ?? list.find((a) => String(a?.value ?? "") === v)
    ?? null;
}

/** 阶段标签：后端给了 phaseLabel 就用后端的，缺了用本地兜底表 */
export const phaseText = (phase, phaseLabel) =>
  `${String(phase ?? "P1")}（${phaseLabel || PHASE_LABEL_FALLBACK[String(phase ?? "P1")] || "未知阶段"}）`;

/** 下一个阶段（P6 之后没有） */
export const nextPhase = (phase) => PHASE_ORDER[PHASE_ORDER.indexOf(String(phase ?? "P1")) + 1] ?? null;

/** 阶段是否可推进（缺数据时按「否」处理，宁严勿松） */
export const canAdvance = (coverage, to) => Boolean(coverage?.canAdvanceTo?.[String(to ?? "")]);

// 就地求「浅测 / 深测」两个分母：counts 优先，缺了按 assets 现算（后端字段改名也不会白屏）
function statsFromAssets(rawAssets) {
  const assets = arr(rawAssets);
  const shallowDone = assets.filter((a) => stageDone(a?.s2)).length;
  const deepTargets = assets.filter(deepEligible).length;
  const deepDone = assets.filter((a) => deepEligible(a) && stageDone(a?.s3)).length;
  const naShallow = assets.filter((a) => String(a?.s2 ?? "") === "na").length;
  const naDeep = assets.filter((a) => deepEligible(a) && String(a?.s3 ?? "") === "na").length;
  return { assets: assets.length, shallowDone, deepTargets, deepDone, naShallow, naDeep, gaps: (assets.length - shallowDone) + (deepTargets - deepDone) };
}

/** 缺口：s2 未覆盖，或（priority ≥ 3 且 s3 未覆盖）——与后端 onlyGaps 口径一致 */
export function coverageGaps(assets, limit = COVERAGE_GAP_LIMIT) {
  const out = [];
  for (const a of arr(assets)) {
    if (!stageDone(a?.s2)) out.push({ id: String(a?.id ?? ""), kind: String(a?.kind ?? ""), value: String(a?.value ?? ""), stage: "浅测", priority: int(a?.priority ?? 3) });
    if (deepEligible(a) && !stageDone(a?.s3)) out.push({ id: String(a?.id ?? ""), kind: String(a?.kind ?? ""), value: String(a?.value ?? ""), stage: "深测", priority: int(a?.priority ?? 3) });
  }
  return out.slice(0, Math.max(0, Math.trunc(Number(limit) || 0)));
}

// 单个矩阵的归一化：{ required, done, pct, gaps[], gapShown, gapsByAsset{} }
// 缺字段（老契约只有 info/verify/owasp/deep）时一律给 0 / 空数组，绝不抛错。
function stageView(raw, fallbackRequired) {
  const gaps = arr(raw?.gaps).map((g) => ({
    assetId: String(g?.assetId ?? g?.id ?? ""),
    asset: String(g?.asset ?? g?.value ?? ""),
    key: String(g?.key ?? ""),
  }));
  const required = Number.isFinite(Number(raw?.required)) ? Math.max(0, int(raw.required)) : Math.max(0, int(fallbackRequired));
  const done = Number.isFinite(Number(raw?.done)) ? Math.max(0, int(raw.done)) : 0;
  const pct = Number.isFinite(Number(raw?.pct)) ? Math.max(0, Math.min(100, int(raw.pct))) : (required > 0 ? Math.round((done / required) * 100) : 0);
  return { required, done, pct, gaps, gapShown: gaps.length, gapsByAsset: gaps.map((g) => g.asset || g.assetId) };
}

// 六阶段在覆盖矩阵里的一行：完成度 + 缺口数（中间层/浅层横跨两个矩阵，缺口合计）
// stageNo 由调用方按「非计数泳道」的顺序给（P1…P6）—— 线索/死点不是阶段，不占号。
function phaseRow(lane, stage, assets, stageNo) {
  const keys = LANE_STAGE_KEYS[lane.key] || [];
  const gaps = keys.reduce((n, k) => n + nz(stage?.[k]?.gapShown), 0);
  return {
    key: lane.key, id: stageNo || lane.id, label: lane.label,
    stage: keys.length ? keys.join("+") : lane.key, stageKeys: keys,
    text: lane.text, pct: lane.pct, done: lane.done, required: lane.required, hint: lane.hint,
    gaps, assets: nz(assets),
  };
}

/**
 * coverage 响应 → 覆盖矩阵视图模型。**空/缺字段/空数组都不抛错**（面板要能一直渲染）。
 * 口径：浅测 = 覆盖资产数 / 全部资产；深测 = 覆盖数 / priority ≥ 3 的资产；
 * stages = **六张矩阵**（info / verifyInfo / shallow / verifyShallow / owasp / deep），
 * 每个都是 { required, done, pct, gaps, gapShown, gapsByAsset }；
 * 老契约（只有 info/verify/owasp/deep）也能渲染：缺失的键按 0 / 空数组补齐。
 */
export function coverageView(json) {
  const c = (json && json.coverage) || {};
  const assets = arr(json && json.assets);
  const derived = statsFromAssets(assets);
  const s = (v, fallback) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
  const counts = {
    assets: s(c?.counts?.assets, derived.assets),
    shallowDone: s(c?.counts?.shallowDone, derived.shallowDone),
    deepTargets: s(c?.counts?.deepTargets, derived.deepTargets),
    deepDone: s(c?.counts?.deepDone, derived.deepDone),
    gaps: s(c?.counts?.gaps, null),
    // na（判定不适用）与 done 一样算覆盖，但证据强度不同：单列出来，防止用 na 把覆盖率刷满
    naShallow: s(c?.counts?.naShallow, derived.naShallow),
    naDeep: s(c?.counts?.naDeep, derived.naDeep),
    naNoReason: s(c?.counts?.naNoReason, 0),
  };
  const ratio = (n, d) => (d <= 0 ? 100 : Math.round((n / d) * 100));
  const pctShallow = s(c?.pct?.shallow, ratio(counts.shallowDone, counts.assets));
  const pctDeep = s(c?.pct?.deep, ratio(counts.deepDone, counts.deepTargets));
  const pctShallowTested = s(c?.pct?.shallowTested, ratio(counts.shallowDone - counts.naShallow, counts.assets));
  const pctDeepTested = s(c?.pct?.deepTested, ratio(counts.deepDone - counts.naDeep, counts.deepTargets));

  const byKindMap = {};
  for (const [k, v] of Object.entries(c?.byKind ?? {})) {
    byKindMap[k] = { total: s(v?.total, 0), shallowDone: s(v?.shallowDone, 0), deepDone: s(v?.deepDone, 0) };
  }
  if (!Object.keys(byKindMap).length) {
    for (const a of assets) {
      const k = String(a?.kind ?? "unknown");
      byKindMap[k] = byKindMap[k] ?? { total: 0, shallowDone: 0, deepDone: 0 };
      byKindMap[k].total += 1;
      if (stageDone(a?.s2)) byKindMap[k].shallowDone += 1;
      if (stageDone(a?.s3)) byKindMap[k].deepDone += 1;
    }
  }
  const byKind = Object.keys(byKindMap).sort().map((k) => ({ kind: k, ...byKindMap[k] }));

  const gaps = arr(c?.gaps).slice(0, COVERAGE_GAP_LIMIT).map((g) => ({
    id: String(g?.id ?? g?.assetId ?? ""), kind: String(g?.kind ?? ""), value: String(g?.value ?? g?.asset ?? ""),
    stage: String(g?.stage ?? "浅测"), priority: int(g?.priority ?? 3),
  }));
  const gapCount = counts.gaps === null ? gaps.length : counts.gaps;

  const blockers = c?.blockers && typeof c.blockers === "object" ? c.blockers : {};
  const phase = String(c?.phase ?? "P1");
  const to = nextPhase(phase);
  const blockList = to ? arr(blockers[phase]).map((x) => String(x)) : [];
  const warnings = [];
  if (Math.abs(counts.deepTargets - derived.deepTargets) > 0 && assets.length) warnings.push("深测分母与资产清单不一致：口径按 priority ≥ 3 重算为 " + derived.deepTargets);
  if (Math.abs(counts.assets - derived.assets) > 0 && assets.length) warnings.push("资产总数与清单不一致：清单实到 " + derived.assets);
  if (!c || !c.counts) warnings.push("coverage 缺 counts 字段：已按资产清单就地重算");

  const recon = c?.recon ?? {};
  // 回灌状态：新资产出现 → 阶段退回 P1 且 pending=true（面板要显眼提示"面还没穷尽"）
  const reflow = {
    pending: Boolean(c?.reflow?.pending),
    count: int(c?.reflow?.count),
    source: c?.reflow?.source ? String(c.reflow.source) : null,
    note: c?.reflow?.note ? String(c.reflow.note) : null,
  };
  const rawStages = c?.stages && typeof c.stages === "object" ? c.stages : {};
  // 六张矩阵。老契约只有 verify：它本来就等于「核对浅层信息」，落到 verifyShallow；
  // verifyInfo / shallow 缺就留空（面板显示 0/0，绝不编数字）。
  const legacyVerify = rawStages.verifyShallow == null && rawStages.verify != null ? rawStages.verify : null;
  const stages = {
    info: stageView(rawStages.info, counts.assets),
    verifyInfo: stageView(rawStages.verifyInfo, counts.assets),
    shallow: stageView(rawStages.shallow, counts.assets),
    verifyShallow: stageView(rawStages.verifyShallow ?? legacyVerify, counts.assets),
    owasp: stageView(rawStages.owasp, counts.assets),
    deep: stageView(rawStages.deep, counts.deepTargets),
  };
  if (!c?.stages) warnings.push("coverage 缺 stages（信息收集/核验信息收集/浅层/核验浅层/OWASP/深层）：已按进度字段兜底");

  // 每个矩阵里有多少项是 na（判定不适用）——na 也算覆盖，但没有「真测过」的证据强度，
  // 面板必须把两者分开显示（否则用 na 就能把矩阵刷满）。
  const naCount = (stageKeys) => {
    let n = 0;
    for (const a of assets) {
      for (const k of stageKeys) {
        const ck = a && a.checks && typeof a.checks === "object" && a.checks[k] && typeof a.checks[k] === "object" ? a.checks[k] : null;
        if (!ck) continue;
        for (const kk of Object.keys(ck)) if (String(ck[kk]).toLowerCase() === "na") n += 1;
      }
    }
    return n;
  };
  const matrices = MATRIX_ORDER.map((m) => {
    const st = stages[m.key];
    const na = naCount(m.stageKeys);
    return {
      key: m.key, label: m.label, lane: m.lane, classes: m.classes || null, stageKeys: m.stageKeys.slice(),
      done: st.done, required: st.required, pct: st.pct,
      gaps: st.gaps, gapShown: st.gapShown, gapsByAsset: st.gapsByAsset,
      gapCount: Math.max(0, st.required - st.done),   // 真实缺口数（后端只列前若干条）
      na, tested: Math.max(0, st.done - na),
    };
  });

  const un = c?.untested && typeof c.untested === "object" ? c.untested : {};
  const untested = {
    declared: un.declared === true,
    items: arr(un.items).map((x) => ({
      id: String(x?.id ?? ""), surface: String(x?.surface ?? x?.what ?? ""),
      why: String(x?.why ?? ""), stage: String(x?.stage ?? "-"),
    })),
  };
  const rv = c?.reviews && typeof c.reviews === "object" ? c.reviews : {};
  const reviews = { vuln: int(rv.vuln), reviewed: int(rv.reviewed), pending: int(rv.pending) };
  if (reviews.vuln > 0 && reviews.pending !== (reviews.vuln - reviews.reviewed)) reviews.pending = Math.max(0, reviews.vuln - reviews.reviewed);

  const laneList = lanesFromCoverage(c, assets);
  const laneMissing = !Object.keys(rawStages).length;

  return {
    phase,
    phaseLabel: c?.phaseLabel || PHASE_LABEL_FALLBACK[phase] || "未知阶段",
    label: phaseText(phase, c?.phaseLabel),
    next: to,
    canAdvance: canAdvance(c, to),
    canAdvanceTo: {
      P2: Boolean(c?.canAdvanceTo?.P2), P3: Boolean(c?.canAdvanceTo?.P3), P4: Boolean(c?.canAdvanceTo?.P4),
      P5: Boolean(c?.canAdvanceTo?.P5), P6: Boolean(c?.canAdvanceTo?.P6),
    },
    blockedBy: to ? phase : null,
    blockers: blockList,
    pct: { shallow: pctShallow, deep: pctDeep, shallowTested: pctShallowTested, deepTested: pctDeepTested },
    counts: { ...counts, assets: counts.assets, gaps: gapCount, gapShown: gaps.length },
    stages,
    matrices,
    stageMissing: laneMissing,
    stageRows: laneList,
    // 「线索」「死点」不是阶段、也不是矩阵：完成度表里不列它们（图上有，覆盖矩阵里不混），
    // 剩下的六条按 P1…P6 重新编号，与作业法的阶段号一致。
    phaseRows: laneList.filter((l) => !l.counted).map((l, i) => phaseRow(l, stages, counts.assets, "P" + (i + 1))),
    lanes: laneList,
    untested,
    reviews,
    byKind,
    gaps,
    sourcesMissing: arr(c?.sourcesMissing).map((x) => String(x)),
    reflow,
    recon: {
      rounds: int(recon?.rounds),
      lastAdded: Number.isFinite(Number(recon?.lastAdded)) ? Math.trunc(Number(recon.lastAdded)) : -1,
      addedThisRound: int(recon?.addedThisRound),
      assetEpoch: int(recon?.assetEpoch),
      markEpoch: int(recon?.markEpoch),
    },
    goals: {
      deepMinPriority: 3,
      info: "信息收集 = 逐资产把信息采全（技术栈 / 语言 / 中间件 / 操作系统 / 网站架构 / 目录 / 路径 / 证书 / DNS / WAF·CDN / 第三方 / 安全头，并按 kind 追加 JS 逆向 / 参数面 / banner / 客户端 / 仓库 / 凭据 / 云 / 子域）",
      shallow: "浅层 = 核实信息收集阶段的工作（逐项 ok/wrong/unknown）+ 浅层测试（指纹行为验证 / 路径真值 / 参数面与基线 / 鉴权边界 / 错误与信息泄露 / 暴露面存在性 / 低频模糊 / 组件版本线索）",
      mid: "中间层 = 核实浅层的工作 + OWASP Top 10 (2021) A01–A10 逐类测试",
      deep: "深层 = 完整读取已有全部信息 + 核验中间层是否有误 + 逐资产漏洞验证（未鉴权 / 越权 / 注入 / SSRF / 上传 / 逻辑 / 竞态 / 反序列化）",
      outcome: "成果 = 证据索引 + 报告 + 未测面声明 + 每条漏洞事实复核",
    },
    warnings,
  };
}

// ── 黑板 HTTP 客户端（同源 + CSRF）；fetch 可注入，便于离线测试 ──────────────
export const ROUTE = "/vore-blackboard";

// 面板请求必须带上"我所在的会话 id"：宿主在没有 projectId 时会退化成"最近更新的项目"，
// 别的会话新建空项目后，本会话的面板就会去读那个空项目，表现为"面板什么都没有"。
function withScope(payload, sessionId) {
  const sid = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
  return sid ? { ...payload, sessionId: sid } : payload;
}

export function createApi(fetchImpl, base = ROUTE) {
  let token = null;
  const getToken = async () => {
    if (token) return token;
    const res = await fetchImpl(`${base}/csrf`, { method: "GET" });
    const body = await res.json();
    token = body?.token ?? null;
    return token;
  };
  const post = async (endpoint, payload = {}) => {
    const call = async () => {
      const t = await getToken();
      const res = await fetchImpl(`${base}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(t ? { "x-dsh-csrf": t } : {}) },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) { token = null; return null; }   // token 过期 → 重取一次
      return res.json();
    };
    let out = await call();
    if (out === null) out = await call();
    if (!out || out.ok === false) throw new Error(out?.error ?? `${endpoint} 调用失败`);
    return out;
  };
  return {
    reset: () => { token = null; },
    list: () => post("list"),
    // 顶栏「按会话分类」清单：带上本会话 id，后端会标出"本会话绑定的项目"（mineId/mine）
    projects: (sessionId) => post("projects", sessionId ? { sessionId } : {}),
    createProject: ({ sessionId, cwd, title, origin, goal }) => post("project.create", { sessionId, cwd, title, origin, goal }),
    // 删除整块作战面板（项目 + 它名下一切）；服务端删前会自动落库备份
    deleteProject: (projectId) => post("project.delete", { projectId }),
    graph: (projectId, sessionId) => post("graph", withScope(projectId ? { projectId } : {}, sessionId)),
    status: (projectId, sessionId) => post("status", withScope(projectId ? { projectId } : {}, sessionId)),
    coverage: (projectId, sessionId) => post("coverage", withScope(projectId ? { projectId } : {}, sessionId)),
    assets: (projectId, sessionId) => post("assets", withScope(projectId ? { projectId } : {}, sessionId)),
    addHint: (projectId, content, creator = "Human") => post("hint.add", { projectId, content, creator }),
    dropIntent: (projectId, intentId, note) => post("intent.drop", { projectId, intentId, note }),
  };
}
