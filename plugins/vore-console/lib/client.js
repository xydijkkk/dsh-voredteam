/*!
 * vore-console / lib/client.js —— 由 scripts/build-client.mjs 生成，请勿手改。
 * 源：lib/pure.mjs（纯函数）+ lib/panel.js（面板实现）。
 * 契约：classic script，执行时只做 window.__ModuleLoader__.load({id, factory}) 注册；
 *      模块体（require("react") / 注入样式 / apply）在首次 materialize 时运行。
 */
window.__ModuleLoader__.load({ id: "@dsh-external/vore-console", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var React = require("react");
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

const NODE_W = 168;
const NODE_H = 52;      // 三行文本（id+指标 / 标签 / 阶段名）
const COL_GAP = 116;    // 同一泳道内两个节点的水平间距（列）
const ROW_GAP = 24;     // 泳道之间的间距（行）
const PER_COL = 5;      // 兼容旧签名：单列最多放几个节点
const PAD = 36;
const LANE_HEAD = 22;   // 泳道标题占位高度（节点从标题下方开始）
const LANE_GAP = 26;    // 没有节点时泳道的最小高度
const LANE_W_MIN = 560; // 泳道背景条最小宽度（防止空图时退化成一条缝）
const DEAD_ZONE_GAP = 64; // 泳道区 → 右侧「死点」区的水平留白

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const SEV_COLOR = {
  critical: { stroke: "#e5484d", fill: "rgba(229,72,77,.16)" },
  high: { stroke: "#f76808", fill: "rgba(247,104,8,.16)" },
  medium: { stroke: "#e8b931", fill: "rgba(232,185,49,.16)" },
  low: { stroke: "#3a9dff", fill: "rgba(58,157,255,.14)" },
};

/** 节点配色与线型：废弃 > 疑似 > 严重级 > 普通事实 > 起点/终点 > 待探索/死路 */
function factStyle(fact, kind) {
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

const edgeColor = (edge) =>
  edge.kind === "dead" ? "#6e8098" : edge.kind === "pending" ? "#8a97a3" : "#3a9dff";

// ── 八条泳道（从上到下）──────────────────────────────────────────────────────
// id / label 是**硬契约**：泳道标题文字必须精确含
// 「起点」「信息收集」「浅层」「中间层」「深层」「线索」「死点」「成果」。
// 前五条 = 六阶段作业法的 P1–P5；「线索」放作业过程中产出的**事实**（已确认 / 未确认分开摆）；
// 「死点」放试过没成的方向与被推翻的结论（死路也是资产，留痕不消失）；
// 最后一条「成果」= 挖到的漏洞 + goal。
const LANES = [
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
const CLUE_LANE = "P6";
/** 「死点」泳道：死路意图 + 被推翻的事实 */
const DEAD_LANE = "P7";
/** 「成果」泳道：goal + category=vuln / finding / report / evidence */
const OUTCOME_LANE = "P8";
/** 事实 confidence=疑似（suspected）→ 线索泳道的「未确认」组 */
const clueGroup = (fact) => (String(fact?.confidence ?? "").toLowerCase() === "suspected" ? "suspected" : "confirmed");

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
const GROUP_HEAD = 20;
/** 同一泳道内换行 / 分组之间的竖直间距 */
const IN_LANE_GAP = 16;
/**
 * 一条泳道里**一行最多摆几个节点**，超了就换行。
 * 为什么要有这个：真实作业里资产上百个（eng_002 实测 91 个），一条泳道一行排下去会拉成
 * **两万五千像素宽**的口袋阵 —— 全屏后「适应窗口」最多只能压到很小，屏幕上仍只看得到极窄一条，
 * 其余全是空底色（用户反馈的"左下角一大片黑色区域"就是这个）。换行后泳道变成方格阵，
 * 宽高都收敛到几千像素，全屏能真正装下。
 */
const PER_ROW_MAX = 10;

// ── 六张矩阵的检查项清单（key + 中文名：覆盖矩阵与资产详情栏都靠它显示人话）──
/** 浅层（P3 ②）的八类浅层测试 */
const SHALLOW_CLASSES = [
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
const OWASP_KEYS = [
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
const DEEP_CLASSES = [
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
const INFO_KEY_LABELS = {
  tech: "技术栈", lang: "后端语言", language: "后端语言", code: "代码", repo: "代码仓库",
  middleware: "中间件", server: "中间件", os: "操作系统", arch: "网站架构",
  dirs: "目录", dir: "目录", paths: "路径", path: "路径", cert: "证书", tls: "证书",
  dns: "DNS", waf: "WAF·CDN", cdn: "WAF·CDN", third: "第三方组件", thirds: "第三方组件",
  deps: "第三方依赖", dep: "第三方依赖", headers: "安全头", header: "安全头",
  params: "参数面", param: "参数面", js: "JS 逆向", jsrev: "JS 逆向", banner: "banner",
  client: "客户端", cred: "凭据", cloud: "云资源", subdomain: "子域", vuln: "组件漏洞线索",
};
/** 检查状态 → 中文（详情栏逐项显示） */
const STATUS_LABELS = {
  done: "已完成", ok: "一致", wrong: "采错了", unknown: "无法核验", na: "不适用",
  hit: "命中", miss: "未命中", pending: "待做", doing: "进行中",
};
const statusLabel = (v) => STATUS_LABELS[String(v ?? "").toLowerCase()] || String(v ?? "-");

/** 检查项 key → 中文名（六张矩阵共用；不认识的 key 原样返回） */
function checkKeyLabel(key) {
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
const MATRIX_ORDER = [
  { key: "info", label: "信息收集", lane: "P2", stageKeys: ["info"] },
  { key: "verifyInfo", label: "核验信息收集", lane: "P3", stageKeys: ["verifyInfo"] },
  { key: "shallow", label: "浅层测试", lane: "P3", stageKeys: ["shallow"], classes: SHALLOW_CLASSES },
  { key: "verifyShallow", label: "核验浅层", lane: "P4", stageKeys: ["verifyShallow"] },
  { key: "owasp", label: "OWASP 逐类测试", lane: "P4", stageKeys: ["owasp"], classes: OWASP_KEYS },
  { key: "deep", label: "深层漏洞验证", lane: "P5", stageKeys: ["deep"], classes: DEEP_CLASSES },
];
/** 泳道 → 它对应的矩阵（起点/线索/死点/成果不算矩阵，各自另有口径） */
const LANE_STAGE_KEYS = {
  start: [], info: ["info"], shallow: ["verifyInfo", "shallow"],
  verify: ["verifyShallow", "owasp"], deep: ["deep"], clue: [], dead: [], outcome: [],
};
/** 六张矩阵的键（旧契约容错时按这个列表逐项取默认值） */
const STAGE_KEYS = ["info", "verifyInfo", "shallow", "verifyShallow", "owasp", "deep"];

const int = (n) => (Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const nz = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
const LIE = ["done", "na"];   // s2/s3 的「已覆盖」取值（与后端一致）

/** 已覆盖：done 或 na（na = 显式判定不适用，也算覆盖） */
const stageDone = (v) => LIE.includes(String(v ?? ""));

/** 深测门槛：priority ≥ 3 才要求深测 */
const deepEligible = (a) => int(a?.priority ?? 3) >= 3;

/** 事实归属泳道（资产类事实优先按资产清单匹配，见 computeLayout） */
function factLaneIndex(fact, keys) {
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
const isDeadFact = (f) => Boolean(f && (f.deprecated === true || f.deprecated === 1 || String(f.deprecated ?? "") === "true"));

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
function laneCompletion(coverage, assets, lane) {
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
function lanesFromCoverage(coverage, assets) {
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
function computeLayout(graph, coverage, assets) {
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
const intentLabel = (it) => `${it.id}${it.dead ? "·死路" : it.concluded_at ? "·已结论" : it.worker ? `·${String(it.worker).slice(0, 10)}` : ""}`;

/** 会话 id 缩短显示（面板上写全 id 太长，前 8 位足够人眼区分） */
const shortSession = (id) => {
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
function projectsView(json, opts = {}) {
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
function fitZoom(layoutW, layoutH, boxW, boxH, pad = 48, min = 0.05, max = 1.6) {
  const w = Math.max(1, nz(layoutW)) + pad, h = Math.max(1, nz(layoutH)) + pad;
  const bw = Number(boxW) || 0, bh = Number(boxH) || 0;
  if (!(bw > 0) || !(bh > 0)) return 1;
  return Math.max(min, Math.min(max, Math.min(bw / w, bh / h)));
}

/** 成果：category=vuln 或带 severity 的事实（不含废弃）。**形状漂移不抛错**：facts 不是数组时按空处理 */
function extractFindings(graph) {
  const facts = arr(graph?.facts).filter((f) => f && !isDeadFact(f) && (f.category === "vuln" || f.category === "finding" || f.severity));
  return facts.sort((a, b) => {
    const ra = SEV_RANK[String(a.severity ?? "").toLowerCase()] ?? 9;
    const rb = SEV_RANK[String(b.severity ?? "").toLowerCase()] ?? 9;
    return ra - rb || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

/** 资产 / 接口 / 凭据类事实（形状漂移不抛错） */
function extractAssets(graph) {
  return arr(graph?.facts).filter((f) => f && !isDeadFact(f) && ["asset", "endpoint", "cred", "note"].includes(f.category));
}

/** 死路清单（意图，形状漂移不抛错）*/
function extractDeadEnds(graph) {
  return arr(graph?.intents).filter((it) => it && (it.dead || it.status === "dead"));
}

/** 死点清单：死意图 + 被推翻的事实（图上「死点」区的内容） */
function extractDeadPoints(graph) {
  const out = [];
  for (const it of extractDeadEnds(graph)) out.push({ id: it.id, type: "intent", what: it.description, note: it.note, dead: true });
  for (const f of arr(graph?.facts).filter(isDeadFact)) out.push({ id: f.id, type: "fact", what: f.description, note: f.evidence, dead: true });
  return out;
}

/** 按严重级计数 */
function severityCounts(findings) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, other: 0 };
  for (const f of arr(findings)) {
    const s = String(f.severity ?? "").toLowerCase();
    if (s in out) out[s] += 1; else out.other += 1;
  }
  return out;
}

/** 成果表 → Markdown（面板的「复制 Markdown」用） */
function findingsMarkdown(graph) {
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
const COVERAGE_GAP_LIMIT = 20;
// 六阶段：起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果
const PHASE_ORDER = ["P1", "P2", "P3", "P4", "P5", "P6"];
const PHASE_LABEL_FALLBACK = {
  P1: "起点：资产收集（直到连续一轮 0 新增的饱和）",
  P2: "信息收集：逐资产把信息采全（技术栈 / 语言 / 中间件 / 操作系统 / 网站架构 / 目录 / 路径 / 证书 / DNS / WAF·CDN / 第三方 / 安全头，并按 kind 追加）",
  P3: "浅层：核实信息收集阶段的工作（逐项 ok/wrong/unknown）+ 浅层测试（指纹行为验证 / 路径真值 / 参数面与基线 / 鉴权边界 / 错误与信息泄露 / 暴露面存在性 / 低频模糊 / 组件版本线索）",
  P4: "中间层：核实浅层的工作 + OWASP Top 10 (2021) A01–A10 逐类测试",
  P5: "深层：完整读取已有全部信息 + 核验中间层是否有误 + 逐资产漏洞验证（未鉴权/越权/注入/SSRF/上传/逻辑/竞态/反序列化）",
  P6: "成果：证据索引 + 报告 + 未测面声明 + 每条漏洞事实复核",
};

/** 资产按 value 定位（缺口清单点一条 → 右侧详情用） */
function findAssetByValue(assets, value, kind) {
  const list = arr(assets);
  const v = String(value ?? "");
  const k = kind ? String(kind) : "";
  return list.find((a) => String(a?.value ?? "") === v && (!k || String(a?.kind ?? "") === k))
    ?? list.find((a) => String(a?.value ?? "") === v)
    ?? null;
}

/** 阶段标签：后端给了 phaseLabel 就用后端的，缺了用本地兜底表 */
const phaseText = (phase, phaseLabel) =>
  `${String(phase ?? "P1")}（${phaseLabel || PHASE_LABEL_FALLBACK[String(phase ?? "P1")] || "未知阶段"}）`;

/** 下一个阶段（P6 之后没有） */
const nextPhase = (phase) => PHASE_ORDER[PHASE_ORDER.indexOf(String(phase ?? "P1")) + 1] ?? null;

/** 阶段是否可推进（缺数据时按「否」处理，宁严勿松） */
const canAdvance = (coverage, to) => Boolean(coverage?.canAdvanceTo?.[String(to ?? "")]);

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
function coverageGaps(assets, limit = COVERAGE_GAP_LIMIT) {
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
function coverageView(json) {
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
const ROUTE = "/vore-blackboard";

// 面板请求必须带上"我所在的会话 id"：宿主在没有 projectId 时会退化成"最近更新的项目"，
// 别的会话新建空项目后，本会话的面板就会去读那个空项目，表现为"面板什么都没有"。
function withScope(payload, sessionId) {
  const sid = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null;
  return sid ? { ...payload, sessionId: sid } : payload;
}

function createApi(fetchImpl, base = ROUTE) {
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

// vore-console 面板实现（构建期被 scripts/build-client.mjs 拼接进 lib/client.js）。
// 本文件不是独立模块：它假设作用域里已有 React（由工厂的 require("react") 提供）
// 与 pure.mjs 里的纯函数（computeLayout / factStyle / edgeColor / extractFindings …）。

var h = function () { return React.createElement.apply(React, arguments); };

// 缩放下限：真实作业里资产上百个（列很宽），下限太高会让"整张图"根本装不下（与 pure.fitZoom 的 min 一致）
var MIN_ZOOM = 0.05;

var CSS = [
  // 字体与配色**自己说了算**：面板不赌宿主主题（赌错了就是"黑字压深底，什么都看不见"）。
  // 背景一律给不透明底色（--vore-canvas-bg），字色一律给不透明墨色（--vore-ink），
  // 两套主题各写一份，字形用带中文的字体栈（Windows / macOS / Linux 各一条）。
  ".dsh-vc-root{display:flex;flex-direction:column;height:100%;min-height:420px;font-size:13.5px;"
    + "font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC',system-ui,-apple-system,'Segoe UI',sans-serif;"
    + "color:var(--vore-ink,#0f1c2e);"
    + "--vore-panel-bg:#fbfcfe;--vore-ink:#0f1c2e;--vore-muted:#45586e;--vore-canvas-bg:#f4f7fc;"
    + "--vore-line:rgba(58,157,255,.28);--vore-lane-a:rgba(58,157,255,.07);--vore-lane-b:rgba(125,142,163,.11);"
    + "--vore-grid:rgba(125,142,163,.20);}",
  // 深色主题（宿主切暗色 / 面板自己探测到暗底时）：字色提到 #eaf3ff，底提到 #0b111b，保证强对比
  "body[data-ds-dark-theme] .dsh-vc-root,.dsh-vc-root.is-dark{--vore-panel-bg:#0f1420;--vore-ink:#eaf3ff;--vore-muted:#a9bdd2;"
    + "--vore-canvas-bg:#0b111b;--vore-line:rgba(58,157,255,.42);--vore-lane-a:rgba(58,157,255,.12);--vore-lane-b:rgba(125,142,163,.16);"
    + "--vore-grid:rgba(125,142,163,.26);}",
  ".dsh-vc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--vore-line,rgba(58,157,255,.28));}",
  ".dsh-vc-title{font-weight:600;}",
  ".dsh-vc-badge{padding:1px 7px;border-radius:9px;background:rgba(58,157,255,.14);border:1px solid rgba(58,157,255,.35);font-size:12px;}",
  ".dsh-vc-badge.is-ok{background:rgba(47,212,167,.14);border-color:rgba(47,212,167,.4);}",
  ".dsh-vc-goal{opacity:.8;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dsh-vc-tabs{display:flex;gap:4px;margin-left:auto;align-items:center;}",
  ".dsh-vc-tab{padding:3px 10px;border-radius:7px;border:1px solid transparent;cursor:pointer;background:transparent;color:inherit;font:inherit;}",
  ".dsh-vc-tab.is-on{background:rgba(58,157,255,.14);border-color:rgba(58,157,255,.4);}",
  ".dsh-vc-btn{padding:3px 9px;border-radius:7px;border:1px solid rgba(58,157,255,.45);background:var(--vore-panel-bg,#fff);color:inherit;cursor:pointer;font:inherit;white-space:nowrap;}",
  ".dsh-vc-btn:hover{background:rgba(58,157,255,.16);}",
  // 危险动作（删除整块面板）：红色描边，别和普通按钮混
  ".dsh-vc-btn-danger{border-color:rgba(229,72,77,.55);color:#e5484d;}",
  ".dsh-vc-btn-danger:hover{background:rgba(229,72,77,.18);}",
  ".dsh-vc-err{padding:5px 10px;background:rgba(229,72,77,.14);border-bottom:1px solid rgba(229,72,77,.4);font-size:12px;}",
  // 操作回执（清缓存/强刷）：蓝绿色调，别和红色错误条混
  ".dsh-vc-note{padding:5px 10px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;background:rgba(47,212,167,.14);border-bottom:1px solid rgba(47,212,167,.42);font-size:12.5px;}",
  ".dsh-vc-body{display:flex;flex:1;min-height:0;}",
  // 画布：外层只做定位（工具条钉在这里，不随图滚动），内层才是滚动容器
  ".dsh-vc-canvaswrap{position:relative;flex:1;min-width:0;min-height:0;display:flex;}",
  ".dsh-vc-canvas{flex:1;min-width:0;display:flex;overflow:auto;"
    + "background-color:var(--vore-canvas-bg,#f4f7fc);"
    + "background-image:linear-gradient(var(--vore-grid,rgba(125,142,163,.2)) 1px,transparent 1px),linear-gradient(90deg,var(--vore-grid,rgba(125,142,163,.2)) 1px,transparent 1px);"
    + "background-size:26px 26px;}",
  // 图比画布小时居中（margin:auto 是 flex + overflow 下唯一不会裁掉左上角的居中写法）
  ".dsh-vc-canvas>svg{margin:auto;flex:none;}",
  ".dsh-vc-canvasctl{position:absolute;right:10px;top:10px;display:flex;gap:4px;align-items:center;z-index:3;padding:3px 4px;"
    + "border-radius:9px;background:var(--vore-panel-bg,#fff);border:1px solid var(--vore-line,rgba(58,157,255,.28));"
    + "box-shadow:0 2px 10px rgba(8,16,28,.22);}",
  ".dsh-vc-node{cursor:pointer;}",
  ".dsh-vc-node text{font-size:12.5px;fill:var(--vore-ink,#0f1c2e);pointer-events:none;}",
  ".dsh-vc-node .dsh-vc-nid{font-size:11px;opacity:.85;}",
  // SVG 里的文字必须写死 fill：SVG 文本的默认 fill 是**黑色**，深色底上等于隐身
  ".dsh-vc-lanetitle{fill:var(--vore-ink,#0f1c2e);font-size:14px;font-weight:700;}",
  ".dsh-vc-lanesub{fill:var(--vore-muted,#45586e);font-size:12px;}",
  ".dsh-vc-grouptitle{fill:var(--vore-muted,#45586e);font-size:12px;font-weight:600;}",
  ".dsh-vc-aside{flex:none;border-left:1px solid var(--vore-line,rgba(58,157,255,.28));padding:8px 10px;overflow:auto;}",
  // 右栏收起态：宽度由内联样式给 0，这里把内边距/边框一并收掉，别留一条白缝
  ".dsh-vc-aside.is-collapsed{padding:0;border-left:none;overflow:hidden;}",
  // 可拖动的分隔条（含收起/展开箭头）：拖动改右栏宽度，双击复位
  ".dsh-vc-split{flex:none;width:8px;cursor:col-resize;position:relative;display:flex;align-items:center;justify-content:center;"
    + "background:linear-gradient(90deg,transparent,rgba(125,142,163,.22),transparent);}",
  ".dsh-vc-split:hover{background:linear-gradient(90deg,transparent,rgba(58,157,255,.45),transparent);}",
  ".dsh-vc-splitbtn{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:16px;height:22px;padding:0;line-height:1;"
    + "border-radius:6px;border:1px solid var(--vore-line,rgba(58,157,255,.28));background:var(--vore-panel-bg,#fff);color:inherit;"
    + "cursor:pointer;font-size:11px;opacity:.85;}",
  ".dsh-vc-splitbtn:hover{opacity:1;background:rgba(58,157,255,.16);}",
  ".dsh-vc-aside h4{margin:6px 0 4px;font-size:12.5px;opacity:.9;}",
  ".dsh-vc-row{padding:4px 6px;border-radius:6px;cursor:pointer;}",
  ".dsh-vc-row:hover{background:rgba(58,157,255,.1);}",
  ".dsh-vc-row.is-on{background:rgba(58,157,255,.16);}",
  ".dsh-vc-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;opacity:.92;word-break:break-all;}",
  ".dsh-vc-in{width:100%;box-sizing:border-box;padding:5px 7px;border-radius:7px;border:1px solid rgba(125,142,163,.5);background:var(--vore-panel-bg,#fff);color:inherit;font:inherit;font-size:12.5px;}",
  ".dsh-vc-table{width:100%;border-collapse:collapse;font-size:12.5px;}",
  ".dsh-vc-table th,.dsh-vc-table td{padding:4px 6px;border-bottom:1px solid rgba(125,142,163,.22);text-align:left;vertical-align:top;}",
  ".dsh-vc-table tr.is-clik{cursor:pointer;}",
  ".dsh-vc-table tr.is-on{background:rgba(58,157,255,.12);}",
  ".dsh-vc-sev{display:inline-block;min-width:58px;padding:1px 6px;border-radius:8px;font-size:11.5px;text-align:center;border:1px solid;}",
  ".dsh-vc-sev.critical{color:#e5484d;border-color:rgba(229,72,77,.5);background:rgba(229,72,77,.12);}",
  ".dsh-vc-sev.high{color:#f76808;border-color:rgba(247,104,8,.5);background:rgba(247,104,8,.12);}",
  ".dsh-vc-sev.medium{color:#b98900;border-color:rgba(232,185,49,.55);background:rgba(232,185,49,.14);}",
  ".dsh-vc-sev.low{color:#2b7fd4;border-color:rgba(58,157,255,.5);background:rgba(58,157,255,.12);}",
  ".dsh-vc-empty{padding:26px;text-align:center;opacity:.8;}",
  ".dsh-vc-hint{font-size:12px;opacity:.8;margin-top:4px;}",
  ".dsh-vc-phase{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;background:rgba(58,157,255,.08);border-bottom:1px solid var(--vore-line,rgba(58,157,255,.28));}",
  ".dsh-vc-phase .dsh-vc-title{font-size:13.5px;}",
  ".dsh-vc-block{color:#e5484d;font-size:12.5px;}",
  ".dsh-vc-pct{display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(125,142,163,.2);}",
  ".dsh-vc-pctrow{display:flex;align-items:center;gap:8px;min-width:300px;flex:1;}",
  ".dsh-vc-pctrow>span:first-child{width:96px;flex:none;opacity:.9;}",
  ".dsh-vc-track{flex:1;height:8px;border-radius:5px;background:rgba(125,142,163,.22);overflow:hidden;}",
  ".dsh-vc-fill{height:100%;border-radius:5px;}",
  ".dsh-vc-num{font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.92;white-space:nowrap;}",
  ".dsh-vc-gap{display:flex;gap:8px;align-items:baseline;padding:4px 6px;border-radius:6px;cursor:pointer;}",
  ".dsh-vc-gap:hover{background:rgba(58,157,255,.1);}",
  ".dsh-vc-gap.is-on{background:rgba(58,157,255,.16);}",
  ".dsh-vc-kind{opacity:.85;font-size:12px;white-space:nowrap;}",
  ".dsh-vc-st{opacity:.85;font-size:12px;white-space:nowrap;}",
  ".dsh-vc-grid{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;}",
  ".dsh-vc-col{flex:1;min-width:320px;}",
  ".dsh-vc-scroll{overflow:auto;flex:1;min-height:0;padding:10px 12px;}",
  // 八泳道（从上到下）：泳道标题、完成度行、na 与真测过、线索/死点分组
  ".dsh-vc-stagewrap{padding:2px 0 6px;}",
  ".dsh-vc-stagerow{display:flex;align-items:center;gap:8px;min-width:340px;flex:1;}",
  ".dsh-vc-stagerow>span:first-child{width:74px;flex:none;opacity:.9;}",
  ".dsh-vc-na{display:flex;gap:8px;align-items:baseline;padding:3px 0;flex-wrap:wrap;}",
  ".dsh-vc-deadtitle{fill:var(--vore-muted,#45586e);font-size:12px;}",
  // 全屏态（CSS 兜底）：铺满视口、抬高层级、给不透明底 —— 浏览器 Fullscreen API 被策略拒时也能看全图
  ".dsh-vc-root.is-fs{position:fixed;inset:0;z-index:2147483000;width:auto;height:auto;min-height:0;background:var(--vore-panel-bg,#fbfcfe);padding:6px;box-sizing:border-box;}",
  ".dsh-vc-root.is-fs .dsh-vc-canvas,.dsh-vc-root.is-fs .dsh-vc-scroll{min-height:0;}",
  ".dsh-vc-root.is-fs .dsh-vc-canvasctl{top:12px;right:12px;}",
  ".dsh-vc-hint-fs{padding:2px 10px;font-size:12.5px;opacity:.85;}",
  // 顶栏「按会话分类」：下拉框 + 打开历史项目时的提示行
  ".dsh-vc-picker{display:inline-flex;align-items:center;gap:6px;}",
  ".dsh-vc-select{max-width:340px;padding:3px 6px;border-radius:7px;border:1px solid rgba(58,157,255,.45);"
    + "background:var(--vore-panel-bg,#fff);color:inherit;font:inherit;font-size:12.5px;}",
  ".dsh-vc-banner{padding:5px 10px;background:rgba(232,185,49,.16);border-bottom:1px solid rgba(232,185,49,.45);font-size:12.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
  ".dsh-vc-projrow{display:flex;gap:10px;align-items:baseline;padding:5px 8px;border-radius:7px;cursor:pointer;border:1px solid rgba(125,142,163,.28);margin-top:4px;}",
  ".dsh-vc-projrow:hover{background:rgba(58,157,255,.12);}",
  ".dsh-vc-projrow.is-on{background:rgba(47,212,167,.14);border-color:rgba(47,212,167,.45);}",
  ".dsh-vc-projnew{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px;}"
].join("");

function installStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("dsh-vc-style")) return;
  var el = document.createElement("style");
  el.id = "dsh-vc-style";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// 探测宿主是不是深色主题：宿主 ui-theme 会往 body 上打 `data-ds-dark-theme`；
// 另外兼容常见的 html[data-theme=dark] / .dark / data-color-scheme。探测不到就按浅色 ——
// 浅色下墨色 #0f1c2e 压在 #f4f7fc 画布上，对比度足够；两边都不会出现"黑字压深底"。
function detectDarkTheme() {
  if (typeof document === "undefined") return false;
  try {
    var b = document.body, el = document.documentElement;
    if (b && typeof b.hasAttribute === "function" && b.hasAttribute("data-ds-dark-theme")) return true;
    if (!el || typeof el.getAttribute !== "function") return false;
    var t = String(el.getAttribute("data-theme") || el.getAttribute("data-color-scheme") || "").toLowerCase();
    if (t === "dark") return true;
    if (el.classList && typeof el.classList.contains === "function" && el.classList.contains("dark")) return true;
  } catch (e) { /* 探测失败按浅色处理 */ }
  return false;
}

// 读"当前会话 id"。宿主会话服务是 { ids, byId, current: SessionId|undefined, phase }，
// 也兼容 { current: {id} } / 旧版 list() 形态 —— 面板必须带上它，
// 否则宿主只能退化成"最近更新的项目"，本会话的面板会显示成别人刚建的空项目（看起来什么都没有）。
function readSessionId(store) {
  if (!store) return null;
  var snap = null;
  try {
    var list = store.list;
    if (list && typeof list.getSnapshot === "function") snap = list.getSnapshot();
    else if (list && typeof list.get === "function") snap = list.get();
    else if (list && typeof list === "object" && !Array.isArray(list)) snap = list;
    else if (typeof store.getSnapshot === "function") snap = store.getSnapshot();
  } catch (e) { return null; }
  if (!snap) return null;
  var cur = snap.current;
  if (cur && typeof cur === "object") cur = cur.id || cur.sessionId || null;
  if (typeof cur === "string" && cur) return cur;
  return null;
}

/** 会话显示名：宿主 sessions 服务的 byId 里有 displayTitle/title，都没有就用短 id */
function sessionLabel(props, sessionId) {
  if (!sessionId) return "";
  try {
    var store = props && props.sessionsStore;
    var list = store && store.list;
    var snap = list && typeof list.getSnapshot === "function" ? list.getSnapshot() : null;
    var row = snap && snap.byId ? snap.byId[sessionId] : null;
    if (row) {
      var t = row.displayTitle || row.title;
      if (t) return String(t);
      if (row.cwd) return String(row.cwd).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(row.cwd);
    }
  } catch (e) { /* 拿不到标题就退回短 id */ }
  return "会话 " + shortSession(sessionId);
}

// 人类在顶栏点开的历史项目：记在 localStorage 里，刷新页面后还停在那张图上（可选）。
var PIN_KEY = "vore.panel.pinnedProject";
function readPin() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    var v = localStorage.getItem(PIN_KEY);
    return v && String(v).trim() ? String(v).trim() : null;
  } catch (e) { return null; }
}
function writePin(id) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    if (id) localStorage.setItem(PIN_KEY, String(id));
    else localStorage.removeItem(PIN_KEY);
  } catch (e) { /* 隐私模式等：忽略 */ }
}

// 右侧详情栏的宽度：可以拖着改（记在 localStorage，刷新后保持），双击复位，箭头收起/展开。
var ASIDE_KEY = "vore.panel.asideWidth";
var ASIDE_MIN = 220;
var ASIDE_DEFAULT = 330;
function readAsideWidth() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return ASIDE_DEFAULT;
    var v = Number(localStorage.getItem(ASIDE_KEY));
    return Number.isFinite(v) && v >= ASIDE_MIN ? Math.round(v) : ASIDE_DEFAULT;
  } catch (e) { return ASIDE_DEFAULT; }
}
function writeAsideWidth(w) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    localStorage.setItem(ASIDE_KEY, String(Math.round(Number(w) || ASIDE_DEFAULT)));
  } catch (e) { /* 忽略 */ }
}

function ConsolePanel(props) {
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;
  var useRef = React.useRef, useCallback = React.useCallback;

  var apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = createApi(function () { return fetch.apply(null, arguments); }, ROUTE);
  var api = apiRef.current;
  // props 每轮渲染刷新一次快照：refresh 是稳定回调（deps=[api]），不能吃第一轮的陈旧 props。
  var propsRef = useRef(null);
  propsRef.current = props;

  var s0 = useState(null), graph = s0[0], setGraph = s0[1];
  var s1 = useState(null), summary = s1[0], setSummary = s1[1];
  var s2 = useState(""), err = s2[0], setErr = s2[1];
  var s3 = useState("live"), tab = s3[0], setTab = s3[1];
  var s4 = useState(true), auto = s4[0], setAuto = s4[1];
  var s5 = useState(null), sel = s5[0], setSel = s5[1];
  var s6 = useState(1), zoom = s6[0], setZoom = s6[1];
  var s7 = useState({ x: 0, y: 0 }), pan = s7[0], setPan = s7[1];
  var s8 = useState(""), hint = s8[0], setHint = s8[1];
  var s9 = useState(null), openRow = s9[0], setOpenRow = s9[1];
  var s10 = useState(null), cov = s10[0], setCov = s10[1];   // 覆盖矩阵（/coverage 响应）
  var s11 = useState(false), isFs = s11[0], setIsFs = s11[1];   // 全屏态（true = 面板铺满视口）
  var s12 = useState(function () { return detectDarkTheme(); }), isDark = s12[0], setIsDark = s12[1];
  // 按会话分类：projects = /projects 的清单（每个项目绑定的会话）；pin = 人类显式点开的历史项目
  var s13 = useState(null), projects = s13[0], setProjects = s13[1];
  var s14 = useState(function () { return readPin(); }), pin = s14[0], setPin = s14[1];
  var s15 = useState(""), newOrigin = s15[0], setNewOrigin = s15[1];
  var s16 = useState(""), newGoal = s16[0], setNewGoal = s16[1];
  var s17 = useState(""), notice = s17[0], setNotice = s17[1];   // 「清缓存/强刷」这类操作的回执
  // 右侧详情栏：宽度可拖（ASIDE_MIN..面板宽度-320），可收起；宽度记 localStorage
  var s18 = useState(function () { return readAsideWidth(); }), asideWidth = s18[0], setAsideWidth = s18[1];
  var s19 = useState(false), asideCollapsed = s19[0], setAsideCollapsed = s19[1];
  var pinRef = useRef(null);
  pinRef.current = pin;
  var scopeRef = useRef(null);      // /graph 回来的 scope：source=session 说明这张图是本会话的
  var asideRef = useRef(null);      // 拖动时的实时宽度（mouseup 时写 localStorage 用）
  asideRef.current = asideWidth;
  var busyRef = useRef(false);
  var rootRef = useRef(null);       // 面板根元素（Fullscreen API 的目标）
  var canvasRef = useRef(null);     // 画布（「适应窗口」/进全屏时按容器算缩放）
  var dragRef = useRef(null);

  var refresh = useCallback(function () {
    // 单个在飞的刷新周期：一次拉 graph + status + coverage，避免 3 秒轮询叠请求。
    // 三个端点**相互独立**：任一失败（例如宿主版本较旧、缺 /coverage 路由）只影响它对应的分栏，
    // 不能把其它分栏一起变成空白 —— 这是"面板看起来什么都没有"最常见的原因。
    if (busyRef.current) return Promise.resolve();
    busyRef.current = true;
    var failures = [];
    var step = function (label, p) {
      return Promise.resolve(p).then(function (v) { return v; }, function (e) {
        failures.push(label + "：" + String((e && e.message) || e));
        return null;
      });
    };
    var sid0 = readSessionId(propsRef.current && propsRef.current.sessionsStore);
    // 顶栏的「按会话分类」清单也一起拉：它决定面板显示的是本会话的黑板还是人类点开的历史项目
    var projectsP = step("项目清单", typeof api.projects === "function" ? api.projects(sid0) : Promise.resolve(null));
    return step("图", api.graph(pinRef.current, sid0))
      .then(function (g) {
        if (g) {
          scopeRef.current = g.scope || null;
          setGraph(g.graph || null);
          var pid = g.graph && g.graph.project ? g.graph.project.id : null;
          return Promise.all([
            step("状态", api.status(pid, sid0)),
            step("覆盖矩阵", typeof api.coverage === "function" ? api.coverage(pid, sid0) : Promise.reject(new Error("该客户端 bundle 未实现 coverage"))),
            // 资产清单也单独拉一次（拿 checks/checkSummary 画泳道里的资产节点）；
            // 老宿主没有 /assets 路由时静默失败，退回用 /coverage 里的 assets。
            step("资产", typeof api.assets === "function" ? api.assets(pid, sid0) : Promise.reject(new Error("该客户端 bundle 未实现 assets"))),
          ]);
        }
        return [null, null, null];
      })
      .then(function (r) {
        projectsP.then(function (pj) { if (pj) setProjects(pj); }, function () { /* 已记进 failures */ });
        if (r && r[0]) setSummary(r[0].summary || null);
        if (r && r[1]) {
          var fromCoverage = (r[1] && r[1].assets) || [];
          var fromAssets = (r[2] && r[2].assets) || [];
          setCov({ coverage: (r[1] && r[1].coverage) || null, assets: fromCoverage.length ? fromCoverage : fromAssets });
        } else if (r && r[2] && r[2].assets) {
          setCov({ coverage: null, assets: r[2].assets });
        }
        setErr(failures.join("；"));
      })
      .catch(function (e) { setErr(String((e && e.message) || e)); })
      .then(function () { busyRef.current = false; });
  }, [api]);

  useEffect(function () { refresh(); }, [refresh]);
  useEffect(function () {
    if (!auto) return undefined;
    var t = setInterval(function () {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, 3000);
    return function () { clearInterval(t); };
  }, [auto, refresh]);

  // 会话哨兵：切会话 / 首次挂载时 sessions 尚未就绪（current 从 undefined 变为真实 id）都要重新取数。
  // 轮询只在开启自动刷新时跑，这条 1s 的轻量哨兵负责"当前会话 id 变了"这一事件（顺带盯主题切换）。
  var sidRef = useRef(null);
  var darkRef = useRef(false);
  darkRef.current = isDark;
  useEffect(function () {
    var t = setInterval(function () {
      var dark = detectDarkTheme();
      if (dark !== darkRef.current) { darkRef.current = dark; setIsDark(dark); }
      var sid = readSessionId(propsRef.current && propsRef.current.sessionsStore);
      if (sid === sidRef.current) return;
      sidRef.current = sid;
      if (sid) refresh();
    }, 1000);
    return function () { clearInterval(t); };
  }, [refresh]);

  var findings = useMemo(function () { return extractFindings(graph || {}); }, [graph]);
  var assets = useMemo(function () { return extractAssets(graph || {}); }, [graph]);
  var dead = useMemo(function () { return extractDeadEnds(graph || {}); }, [graph]);
  var sev = useMemo(function () { return severityCounts(findings); }, [findings]);
  var covView = useMemo(function () { return coverageView(cov || {}); }, [cov]);
  // ⚠️ **所有 hook 必须在任何 return 之前调用**：computeLayout 是 hook，
  // 早先它被放在 `if (!graph) return …` 之后 —— 首帧（graph=null）不调用它、有数据后再调用，
  // 两次渲染的 hook 数量不一致 → React 报 **error #310（Rendered more hooks than during the previous render）**，
  // 浏览器里就是整块面板空白。这里把它提到最前面，和其余 hook 排在一起。
  var covAssetsForLayout = (cov && cov.assets) || [];
  var layout = useMemo(
    function () { return computeLayout(graph || { facts: [], intents: [] }, (cov && cov.coverage) || null, covAssetsForLayout); },
    [graph, cov]
  );
  // ── 全屏：优先浏览器 Fullscreen API；不可用或被策略拒绝时退化为 CSS 全屏 ──
  // DSH Web 可能受 iframe/CSP 限制导致 requestFullscreen reject，所以必须有 CSS 兜底，
  // 否则「全屏」按钮点了没反应。
  var canUseFsApi = function () {
    return typeof document !== "undefined" && document.documentElement &&
      typeof document.documentElement.requestFullscreen === "function";
  };
  // 适应窗口：按**当前容器**算缩放（比例算法在 pure.fitZoom 里，可离线断言），
  // 并让图在容器里居中（.dsh-vc-canvas > svg{margin:auto} 兜）。
  // 下限放到 0.12：真实作业里资产上百个（列很多），0.3 的下限会让"整张图"根本装不下。
  var fitView = function () {
    var el = canvasRef.current;
    var l = layout || {};
    var box = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    if (!box || !box.width || !box.height) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    setZoom(fitZoom(l.width || 800, l.height || 600, box.width, box.height));
    setPan({ x: 0, y: 0 });
  };
  // 进全屏那一刻量到的还是**旧容器**的尺寸（React 还没重渲染、浏览器也还没完成全屏切换），
  // 于是缩放会按小窗口算 → 全屏后图缩在左上角、其余是一大片空底色。
  // 这里把 fitView 存进 ref，进全屏后再补几次（rAF + 定时 + resize），每次都用最新容器尺寸。
  var fitRef = useRef(null);
  fitRef.current = fitView;
  var enterFs = function () { setIsFs(true); fitView(); };
  var exitFs = function () {
    setIsFs(false);
    if (canUseFsApi() && document.fullscreenElement && typeof document.exitFullscreen === "function") {
      try { document.exitFullscreen(); } catch (e) { /* 忽略 */ }
    }
  };
  var toggleFs = function () {
    if (isFs) { exitFs(); return; }
    var el = rootRef.current;
    if (canUseFsApi() && el && typeof el.requestFullscreen === "function") {
      try {
        var p = el.requestFullscreen();
        if (p && typeof p.then === "function") p.then(enterFs, enterFs);   // 被拒也照样进 CSS 全屏
        else enterFs();
      } catch (e) { enterFs(); }
    } else {
      enterFs();
    }
  };
  // 系统侧退出（Esc / 切窗口）后同步状态；CSS 兜底态下 Esc 也能退
  useEffect(function () {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
    var onFsChange = function () { if (canUseFsApi() && !document.fullscreenElement && isFs) setIsFs(false); };
    var onKey = function (e) { if (e && e.key === "Escape" && isFs && !(canUseFsApi() && document.fullscreenElement)) exitFs(); };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return function () {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [isFs]);
  // 全屏期间按**新容器**补算缩放（rAF + 120ms + 420ms 三次，覆盖浏览器全屏过渡；再挂 resize）
  useEffect(function () {
    if (!isFs) return undefined;
    var timers = [], raf = null;
    var refit = function () { if (fitRef.current) fitRef.current(); };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      raf = window.requestAnimationFrame(refit);
    }
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      timers.push(window.setTimeout(refit, 120));
      timers.push(window.setTimeout(refit, 420));
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("resize", refit);
    return function () {
      if (raf !== null && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(raf);
      if (typeof window !== "undefined" && typeof window.clearTimeout === "function") timers.forEach(function (t) { window.clearTimeout(t); });
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("resize", refit);
    };
  }, [isFs]);

  var counts = (summary && summary.counts) || {};

  // 渲染期自保：面板的取值全部基于宿主下发的字段，字段形状一变就可能在构建元素时抛错
  // （React 里表现为**整块面板空白**，用户看不出原因）。这里兜住并给出可操作的提示。
  try {

  var onAddHint = function () {
    var text = String(hint || "").trim();
    if (!text || !graph || !graph.project) return;
    api.addHint(graph.project.id, text, "Human")
      .then(function () { setHint(""); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  var onDropIntent = function (intentId) {
    if (!graph || !graph.project) return;
    if (typeof window !== "undefined" && !window.confirm("取消方向 " + intentId + "？（会在图上记为死路）")) return;
    api.dropIntent(graph.project.id, intentId, "面板取消")
      .then(function () { setSel(null); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  var onCopy = function () {
    var md = findingsMarkdown(graph || {});
    try { navigator.clipboard.writeText(md).then(function () { setErr(""); }, function () { setErr("复制失败：浏览器拒绝剪贴板访问"); }); }
    catch (e) { setErr("复制失败：" + ((e && e.message) || e)); }
  };

  // ── 删除该面板 ────────────────────────────────────────────────────────────
  // 删的是**当前显示的那一块作战面板**（本会话的，或从「会话」下拉里点开的历史项目）：
  // 项目 + 它名下的事实/意图/提示/资产/检查矩阵/未测面。不可逆 → 双击确认 + 服务端先落库备份。
  var onDeletePanel = function () {
    var id = (graph && graph.project && graph.project.id) || pinned || ownId || null;
    if (!id) {
      setNotice("当前没有面板可删：本会话还没有黑板，先让总控 bb_project_init 建立。");
      return;
    }
    var c = counts || {};
    var title = (graph && graph.project && graph.project.title) || id;
    var assets = (covView && covView.counts && covView.counts.assets) || 0;
    var msg = "删除作战面板 " + id + "（" + title + "）？\n\n"
      + "会一并删掉它的：事实 " + (c.facts || 0) + " · 意图 " + (c.open || 0) + " open / " + (c.claimed || 0) + " claimed / " + (c.dead || 0) + " dead"
      + " · 提示 " + (c.hints || 0) + " · 资产 " + assets + " · 六张检查矩阵 · 未测面\n\n"
      + "不可逆（服务端会先自动落一份 blackboard.backup-<时间>.db 备份）。\n确定删除吗？";
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(msg)) return;
    setNotice("正在删除面板 " + id + " ……");
    api.deleteProject(id)
      .then(function (r) {
        if (pinned === id) { writePin(null); setPin(null); pinRef.current = null; }
        setSel(null);
        setGraph(null);
        setSummary(null);
        setCov(null);
        setErr("");
        setNotice("已删除作战面板 " + id + "（" + (r && r.title ? r.title : "") + "）：事实 " + ((r && r.deleted && r.deleted.facts) || 0)
          + " · 意图 " + ((r && r.deleted && r.deleted.intents) || 0)
          + " · 提示 " + ((r && r.deleted && r.deleted.hints) || 0)
          + " · 资产 " + ((r && r.deleted && r.deleted.assets) || 0)
          + " · 检查行 " + ((r && r.deleted && r.deleted.assetChecks) || 0)
          + " · 未测面 " + ((r && r.deleted && r.deleted.untested) || 0)
          + "。备份：" + ((r && r.backupPath) || "（未落备份）"));
        return refresh();
      })
      .catch(function (e) { setErr("删除失败：" + ((e && e.message) || e)); setNotice(""); });
  };
  var onHardReload = function () {    setNotice("正在强刷页面……");
    try {
      if (typeof location !== "undefined" && typeof location.replace === "function") {
        var u = String(location.href || "").split("#")[0].split("?")[0];
        location.replace(u + "?vore_reload=" + Date.now());   // 换 URL → 浏览器必须重新取 index.html 与 bundle
        return;
      }
    } catch (e) { /* 落到下面的提示 */ }
    setNotice("这个环境不允许脚本改地址栏：请按 Ctrl+F5 强制刷新（会重新下载 client.js）。");
  };

  // ── 按会话分类：本会话的黑板 / 人类点开的历史项目 ──────────────────────────
  var sid = readSessionId(props && props.sessionsStore) || readSessionId(propsRef.current && propsRef.current.sessionsStore) || "";
  var pview = projectsView(projects || {}, { sessionId: sid, labelOf: function (id) { return sessionLabel(propsRef.current, id); } });
  var currentProjectId = (graph && graph.project && graph.project.id) || null;
  // 本会话的项目 id：优先用清单里的 mineId；清单拿不到（老宿主没有 /projects）时，
  // 用 /graph 回来的 scope（source=session 就说明这张图正是本会话的）。
  var scopeNow = scopeRef.current || null;
  var ownId = pview.mineId || (scopeNow && scopeNow.source === "session" ? currentProjectId : null);
  var pinned = pin && pin !== ownId ? pin : null;   // 钉的正好是本会话项目 = 没钉
  var ownTitle = pview.mine ? pview.mine.title : ((graph && graph.project && graph.project.title) || ownId || "");
  var switchTo = function (id) {
    var next = id && id !== ownId ? String(id) : null;
    writePin(next);
    setPin(next);
    setSel(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTimeout(function () { refresh(); }, 0);
  };
  var onCreateProject = function () {
    var origin = String(newOrigin || "").trim();
    var goal = String(newGoal || "").trim();
    if (!origin && !goal) return;
    var cwdSnap = null;
    try {
      var store = propsRef.current && propsRef.current.sessionsStore;
      var snap = store && store.list && typeof store.list.getSnapshot === "function" ? store.list.getSnapshot() : null;
      cwdSnap = snap && snap.byId && snap.byId[sid] ? snap.byId[sid].cwd ?? null : null;
    } catch (e) { cwdSnap = null; }
    writePin(null); setPin(null);
    api.createProject({ sessionId: sid || null, cwd: cwdSnap, title: origin.slice(0, 60), origin: origin, goal: goal })
      .then(function () { setNewOrigin(""); setNewGoal(""); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  // 一个会话一个项目：本会话没黑板时不能借别人的图，只能显式点开历史项目（钉住）
  var projectPicker = h("span", { className: "dsh-vc-picker" },
    h("span", { className: "dsh-vc-hint", style: { margin: 0 } }, "会话"),
    h("select", {
      className: "dsh-vc-select", value: pinned || (ownId || ""), title: "按会话分：选一个会话/项目看它的作战面板",
      onChange: function (ev) { switchTo(ev && ev.target ? ev.target.value : ""); },
    },
      h("option", { value: ownId || "" },
        ownId ? "本会话：" + (ownTitle || ownId) : "本会话（还没有黑板）"),
      pview.others.map(function (g) {
        var rows = g.rows.filter(function (r) { return r.id !== ownId; });
        if (!rows.length) return null;
        var label = (g.label || "会话") + " · " + rows.length + " 个项目";
        return h("optgroup", { key: g.key, label: label },
          rows.map(function (r) {
            return h("option", { key: r.id, value: r.id },
              r.title + "（" + (r.phase || "-") + " · 资产 " + r.counts.assets + " · 事实 " + r.counts.facts + "）");
          }));
      })),
    pinned
      ? h("button", { className: "dsh-vc-btn", onClick: function () { switchTo(""); }, title: "回到本会话的黑板" }, "回到本会话")
      : null);

  var phaseBadge = cov && cov.coverage
    ? h("span", { className: "dsh-vc-badge" + (covView.canAdvance ? " is-ok" : "") },
      "阶段 " + covView.phase + " · 浅 " + covView.pct.shallow + "% · 深 " + covView.pct.deep + "%")
    : null;

  var bar = h("div", { className: "dsh-vc-bar" },
    h("span", { className: "dsh-vc-title" }, (graph && graph.project && graph.project.title) || "作战面板"),
    h("span", { className: "dsh-vc-badge" + (graph && graph.project && graph.project.status === "active" ? " is-ok" : "") },
      (graph && graph.project && graph.project.status) || "未建项目"),
    projectPicker,
    h("span", { className: "dsh-vc-goal", title: (graph && graph.project && graph.project.goal) || "" },
      graph && graph.project && graph.project.goal ? "goal：" + graph.project.goal : "（尚未建立黑板）"),
    h("span", { className: "dsh-vc-badge" }, "facts " + (counts.facts || 0)),
    h("span", { className: "dsh-vc-badge" }, "intents open " + (counts.open || 0) + "/claimed " + (counts.claimed || 0) + "/dead " + (counts.dead || 0)),
    h("span", { className: "dsh-vc-badge" }, "hints " + (counts.hints || 0)),
    phaseBadge,
    h("div", { className: "dsh-vc-tabs" },
      h("button", { className: "dsh-vc-tab" + (tab === "live" ? " is-on" : ""), onClick: function () { setTab("live"); } }, "实时情况"),
      h("button", { className: "dsh-vc-tab" + (tab === "summary" ? " is-on" : ""), onClick: function () { setTab("summary"); } }, "任务汇总"),
      h("button", { className: "dsh-vc-tab" + (tab === "coverage" ? " is-on" : ""), onClick: function () { setTab("coverage"); } }, "覆盖矩阵"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setAuto(!auto); } }, auto ? "自动刷新：开" : "自动刷新：关"),
      h("button", { className: "dsh-vc-btn", onClick: refresh }, "立即刷新"),
      h("button", {
        className: "dsh-vc-btn dsh-vc-btn-danger", onClick: onDeletePanel,
        title: (currentProjectId ? "删除当前显示的作战面板（" + currentProjectId + "）与其全部数据" : "当前没有面板可删"),
      }, "删除该面板"),
      h("button", { className: "dsh-vc-btn", onClick: onHardReload, title: "带时间戳重载页面 → 强制重新下载 client.js（等于 Ctrl+F5）" }, "强刷页面"),
      h("button", { className: "dsh-vc-btn", onClick: toggleFs, title: "全屏看整张图（Esc 退出）" }, isFs ? "退出全屏" : "全屏"))
  );

  var rootProps = { className: "dsh-vc-root" + (isFs ? " is-fs" : "") + (isDark ? " is-dark" : ""), ref: rootRef };

  if (!graph) {
    // 本会话还没有黑板（或钉的项目已被删）：**不借别人的图**，把「按会话分类」的清单摆出来让人点。
    var pickerRow = function (r) {
      return h("div", {
        key: "proj-" + r.id, className: "dsh-vc-projrow" + (r.id === currentProjectId ? " is-on" : ""),
        onClick: function () { switchTo(r.id); },
      },
        h("span", { className: "dsh-vc-mono" }, r.id),
        h("span", { style: { flex: 1, fontWeight: 600 } }, r.title),
        h("span", { className: "dsh-vc-kind" }, (r.phase || "-") + " · 资产 " + r.counts.assets + " · 事实 " + r.counts.facts + " · 意图 " + r.counts.intents),
        h("span", { className: "dsh-vc-kind" }, r.updatedAt ? String(r.updatedAt).slice(0, 16).replace("T", " ") : ""));
    };
    return h("div", rootProps, bar,
      err ? h("div", { className: "dsh-vc-err" }, err) : null,
      h("div", { className: "dsh-vc-scroll" },
        h("div", { className: "dsh-vc-empty" },
          h("div", { style: { fontWeight: 600 } }, "本会话还没有黑板（一个会话一个项目）"),
          h("div", { className: "dsh-vc-hint" },
            "本会话 id：" + (sid ? shortSession(sid) : "（宿主尚未给出会话 id）")
            + "。让总控调 bb_project_init 写清 origin 与 goal，这张图就会长出来；"
            + "想先看别的会话测过的项目，用上面的下拉框或下面清单点进去（点开的是历史项目，本会话的新测试仍从自己的空黑板开始）。")),
        h("div", { className: "dsh-vc-projnew" },
          h("span", { className: "dsh-vc-hint", style: { margin: 0 } }, "或直接给本会话建黑板："),
          h("input", {
            className: "dsh-vc-in", style: { maxWidth: "320px" }, value: newOrigin, placeholder: "origin：授权目标与范围（域名/IP/路径）",
            onChange: function (ev) { setNewOrigin(ev && ev.target ? ev.target.value : ""); },
          }),
          h("input", {
            className: "dsh-vc-in", style: { maxWidth: "380px" }, value: newGoal, placeholder: "goal：要交付的成果",
            onChange: function (ev) { setNewGoal(ev && ev.target ? ev.target.value : ""); },
          }),
          h("button", { className: "dsh-vc-btn", onClick: onCreateProject }, "建立本会话黑板")),
        h("h4", null, "历史项目（按会话归类：" + pview.groups.length + " 个会话 / " + pview.total + " 个项目）"),
        pview.groups.map(function (g) {
          var gl = String(g.label || g.key);
          var tail = g.short && !g.mine && gl.indexOf(g.short) < 0 ? "（会话 " + g.short + "）" : "";
          return h("div", { key: "grp-" + g.key, style: { marginTop: 6 } },
            h("div", { className: "dsh-vc-hint", style: { margin: 0 } },
              (g.mine ? "本会话 · " : "") + gl + tail + " · " + g.rows.length + " 个项目"),
            g.rows.map(pickerRow));
        }),
        h("div", { className: "dsh-vc-hint" },
          "打开历史项目 = 只读地看它那张图（顶栏会出现「回到本会话」）。新会话要测新目标，就让总控在本会话里 bb_project_init 建新项目 —— 不会覆盖、也不会串到上一个会话的图上。")));
  }

  // ── SVG 图（八条泳道，从上到下：
  //   ① 起点 → ② 信息收集 → ③ 浅层 → ④ 中间层 → ⑤ 深层 → ⑥ 线索 → ⑦ 死点 → ⑧ 成果）─
  // 资产节点来自 /coverage（或 /assets）的资产清单；缺字段时退回 s2/s3 兜底（旧数据不白屏）。
  // 注意：layout 是 **hook**，必须在上方（任何 return 之前）计算，这里只取别名。
  var covAssetsAll = covAssetsForLayout;
  void layout;

  // 阶段序号徽标：① ② ③ …（**不用 P1–P6**，免得和作业法的六阶段号混）
  var ORD = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  var stageNo = function (lane) {
    var i = (covView.lanes || []).findIndex(function (l) { return l.key === (lane && lane.key); });
    return ORD[i < 0 ? 0 : i] || "·";
  };
  var laneTitleText = function (lane) {
    // 「线索」「死点」不是覆盖矩阵：只显示条数，不显示 n/m（0/0 是误导）
    if (lane.counted) return stageNo(lane) + " " + (lane.label || "");
    var hasNum = (lane.done || 0) + (lane.required || 0) > 0;
    return stageNo(lane) + " " + (lane.label || "") + (hasNum ? "　" + lane.done + "/" + lane.required + "（" + lane.pct + "%）" : "");
  };
  var laneSubText = function (lane) {
    var parts = [];
    if (lane.hint) parts.push(lane.hint);
    // 「线索」「死点」是按条数计的，不是覆盖矩阵 → 不挂"指标按资产清单就地汇总"这句
    if (lane.derived && !lane.counted) parts.push("指标按资产清单就地汇总");
    return parts.join(" · ");
  };

  var svgChildren = [];

  // ① 泳道背景条 + 泳道标题（背景条在最底层，节点与边画在它上面）
  (layout.lanes || []).forEach(function (lane, i) {
    var laneTop = lane.y != null ? lane.y : PAD + i * 100;
    var laneH = lane.h != null ? lane.h : 60;
    var bandW = Math.max(layout.laneWidth || layout.width - PAD * 2, 320);
    var parts = [
      h("rect", {
        x: PAD - 14, y: laneTop, width: bandW + 28, height: laneH, rx: 10,
        fill: i % 2 ? "var(--vore-lane-b,rgba(125,142,163,.11))" : "var(--vore-lane-a,rgba(58,157,255,.07))",
        stroke: lane.key === "dead" ? "#6e8098" : "rgba(125,142,163,.45)",
        strokeWidth: 1, strokeDasharray: lane.key === "dead" ? "4 4" : null,
      }),
      h("line", {
        x1: PAD - 6, y1: laneTop + 18, x2: PAD - 6 + bandW, y2: laneTop + 18,
        stroke: "rgba(125,142,163,.38)", strokeWidth: 1,
      }),
      // 泳道标题：fill 写死（SVG 文本默认黑色，深色底上会看不见）
      h("text", {
        x: PAD - 8, y: laneTop + 14, className: "dsh-vc-lanetitle",
        fill: "var(--vore-ink,#0f1c2e)", style: { fontSize: "14px", fontWeight: 700 },
      }, laneTitleText(lane)),
      laneSubText(lane)
        ? h("text", {
          x: PAD + 230, y: laneTop + 14, className: "dsh-vc-lanesub",
          fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px" },
        }, laneSubText(lane))
        : null,
    ];
    // 分组泳道（线索）：组名 + 一条分隔线，已确认 / 未确认 一眼分得开
    (lane.subRows || []).forEach(function (sub, si) {
      var sep = PAD - 6 + bandW;
      parts.push(h("text", {
        key: "grp:" + lane.key + ":" + sub.key, x: PAD - 4, y: sub.y + 13, className: "dsh-vc-grouptitle",
        fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px", fontWeight: 600 },
      }, (sub.label || "") + "（" + sub.count + "）"));
      parts.push(h("line", {
        key: "grpl:" + lane.key + ":" + sub.key, x1: PAD + 190, y1: sub.y + 9, x2: sep, y2: sub.y + 9,
        stroke: "rgba(125,142,163,.3)", strokeWidth: 1, strokeDasharray: "3 3",
      }));
      void si;
    });
    svgChildren.push(h("g", { key: "lane:" + (lane.id || i), "data-lane": lane.key + "|" + lane.label }, parts));
  });

  // ② 边：intent 的 from→to（concluded 实线 / dead 灰虚线 / pending 虚线）+ 资产跨泳道的纵向连线
  layout.edges.forEach(function (e) {
    var a = layout.byId.get(e.from), b = layout.byId.get(e.to);
    if (!a || !b) return;
    var stroke = edgeColor(e);
    var dash = e.kind === "concluded" ? null : e.kind === "dead" ? "2 4" : "5 4";
    var sameCol = a.x === b.x;
    var d, lx, ly;
    if (sameCol) {
      // 同一列（同一资产的上下游泳道 / 起点→浅层）：画一条纯纵向连线
      var x0 = a.x + a.w / 2, yTop = a.y + a.h, yBot = b.y;
      var down = yBot >= yTop;
      d = "M " + x0 + " " + (down ? yTop : a.y) + " L " + x0 + " " + (down ? yBot : b.y + b.h);
      lx = x0 + 8; ly = ((down ? yTop + yBot : a.y + b.y + b.h) / 2);
    } else {
      // 不同列：纵向线段 + 横向连接（自上而下）
      var x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
      if (y2 < y1) { y1 = a.y; y2 = b.y + b.h; }
      var midY = (y1 + y2) / 2;
      d = "M " + x1 + " " + y1 + " L " + x1 + " " + midY + " L " + x2 + " " + midY + " L " + x2 + " " + y2;
      lx = (x1 + x2) / 2; ly = midY - 3;
    }
    svgChildren.push(h("path", {
      key: e.id, d: d, fill: "none", stroke: stroke, strokeWidth: e.laneEdge ? 1.1 : 1.4,
      strokeDasharray: dash, opacity: e.laneEdge ? 0.55 : 0.85,
    }));
    if (e.intent) {
      svgChildren.push(h("text", {
        key: e.id + ":lbl", x: lx, y: ly, textAnchor: "middle",
        style: { fontSize: "10px" }, fill: stroke, opacity: 0.95,
      }, intentLabel(e.intent)));
    }
  });

  // ③ 节点
  layout.nodes.forEach(function (n) {
    var st = factStyle(n.fact, n.kind);
    var isPlaceholder = n.kind === "pending" || n.kind === "dead";
    var isAsset = n.kind === "lane";
    var isSel = sel && sel.id === n.id;
    var asset = n.asset || {};
    var desc, idText, subText;
    if (isAsset) {
      desc = String(asset.label || asset.value || "").slice(0, 20);
      idText = String(asset.id || "") + " · " + String(asset.value || "").slice(0, 18);
      subText = n.metric || "";
    } else if (isPlaceholder) {
      desc = String((n.intent && n.intent.description) || (n.fact && n.fact.description) || "").slice(0, 20);
    } else {
      desc = String((n.fact && n.fact.description) || "").replace(/^任务起点：|^任务目标：/, "").slice(0, 20);
    }
    if (!isAsset) {
      idText = n.kind === "pending" ? "待探索 " + ((n.intent && n.intent.id) || "")
        : n.kind === "dead" ? "死点 " + ((n.intent && n.intent.id) || (n.fact && n.fact.id) || "")
          : ((n.fact && n.fact.id) || n.id) + (n.fact && n.fact.severity ? " · " + n.fact.severity : "");
      subText = n.laneCap || "";
    }
    var subColor = n.wrong ? "#e5484d" : n.hits ? "#f76808" : null;
    var strokeColor = isSel ? "#2fd4a7" : (isAsset && n.wrong ? "#e5484d" : st.stroke);
    // 节点文字写死 fill（SVG 文本默认黑色 → 深色底上等于隐身）；第三行用指标色时覆盖
    svgChildren.push(h("g", { key: n.id, className: "dsh-vc-node", onClick: function () { setSel({ id: n.id, node: n }); } },
      h("rect", {
        x: n.x, y: n.y, width: n.w, height: n.h, rx: 8, fill: st.fill,
        stroke: strokeColor, strokeWidth: isSel ? 2.2 : (isAsset && n.wrong ? 1.8 : 1.2), strokeDasharray: st.dash,
      }),
      h("text", { x: n.x + 8, y: n.y + 16, className: "dsh-vc-nid", fill: "var(--vore-ink,#0f1c2e)" }, idText),
      h("text", { x: n.x + 8, y: n.y + 32, fill: "var(--vore-ink,#0f1c2e)" }, desc),
      h("text", {
        x: n.x + 8, y: n.y + 47, className: "dsh-vc-nid",
        fill: subColor || "var(--vore-muted,#45586e)", style: subColor ? { opacity: 1 } : null,
      }, subText)));
  });

  // ④ 死点区：死点现在有自己的**泳道**（老契约的右侧灰框只在老 payload 里才有内容）
  var dz = layout.deadZone || { nodes: [] };
  if (dz.nodes.length) {
    svgChildren.push(h("g", { key: "deadzone" },
      h("rect", {
        x: dz.x, y: dz.y, width: dz.w, height: dz.h, rx: 10,
        fill: "rgba(110,128,152,.06)", stroke: "#6e8098", strokeWidth: 1.2, strokeDasharray: "4 4",
      }),
      h("text", { x: dz.x + 12, y: dz.y + 18, className: "dsh-vc-deadtitle", fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px" } },
        "死点 " + dz.nodes.length + "（死路意图 / 被推翻的结论）")));
  }

  var svg = h("svg", {
    viewBox: pan.x + " " + pan.y + " " + layout.width + " " + layout.height,
    style: { width: (layout.width * zoom) + "px", height: (layout.height * zoom) + "px", display: "block", color: "inherit" },
    onMouseDown: function (ev) { dragRef.current = { x: ev.clientX, y: ev.clientY, pan: { x: pan.x, y: pan.y } }; },
    onMouseMove: function (ev) {
      if (!dragRef.current) return;
      setPan({
        x: dragRef.current.pan.x - (ev.clientX - dragRef.current.x) / zoom,
        y: dragRef.current.pan.y - (ev.clientY - dragRef.current.y) / zoom,
      });
    },
    onMouseUp: function () { dragRef.current = null; },
    onMouseLeave: function () { dragRef.current = null; },
    onWheel: function (ev) { ev.preventDefault(); setZoom(Math.min(3, Math.max(MIN_ZOOM, zoom + (ev.deltaY > 0 ? -0.1 : 0.1)))); },
  }, svgChildren);

  // 画布 = 外层（定位工具条）+ 内层滚动容器。工具条钉在外层，所以**滚图 / 缩放都不会把它带走**。
  var canvas = h("div", { className: "dsh-vc-canvaswrap" },
    h("div", { className: "dsh-vc-canvas", ref: canvasRef }, svg),
    h("div", { className: "dsh-vc-canvasctl" },
      h("button", { className: "dsh-vc-btn", onClick: fitView, title: "按当前窗口重算缩放，整张图装进来" }, "适应窗口"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setZoom(Math.min(3, zoom + 0.15)); }, title: "放大" }, "＋"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setZoom(Math.max(MIN_ZOOM, zoom - 0.15)); }, title: "缩小" }, "－"),
      h("span", { className: "dsh-vc-num" }, Math.round(zoom * 100) + "%")));

  // ── 右侧详情 ──────────────────────────────────────────────────────────────
  var openIntents = (summary && summary.openIntents) ||
    (graph.intents || []).filter(function (i) { return !i.concluded_at && !i.dead; });
  var selIsPlaceholder = sel && sel.node && (sel.node.kind === "pending" || sel.node.kind === "dead");
  // 选中资产：覆盖矩阵里点进来的（from=coverage），或图上点中的资产节点（node.asset）
  var selAssetObj = sel ? ((sel.from === "coverage" ? sel.node : null) || (sel.node && sel.node.asset) || null) : null;
  var selAssetId = selAssetObj ? selAssetObj.id : null;

  // 该资产六张矩阵的逐项状态（key 用中文名，状态也翻成中文）
  var selAssetMatrices = function (a) {
    var checks = (a && a.checks) || {};
    var sums = (a && a.checkSummary) || {};
    return (covView.matrices || []).map(function (m) {
      var stage = checks[m.key] && typeof checks[m.key] === "object" ? checks[m.key] : {};
      var keys = Object.keys(stage);
      var s = sums[m.key] && typeof sums[m.key] === "object" ? sums[m.key] : null;
      return h("div", { key: "selmx-" + m.key, style: { marginTop: 6 } },
        h("h4", null, "矩阵 " + m.label + "（" + m.lane + "）" + (s ? "　" + (s.done || 0) + "/" + (s.required || 0) : "")),
        keys.length
          ? keys.map(function (k) {
            return h("div", { key: k, className: "dsh-vc-mono" }, checkKeyLabel(k) + "：" + statusLabel(stage[k]));
          })
          : h("div", { className: "dsh-vc-hint" }, "未记录检查项（后端没给 checks）"));
    });
  };

  // 右侧栏宽度：拖动条分隔条改宽度（往左拖变宽），夹在 [ASIDE_MIN, 面板宽度-320] 之间；
  // 双击复位成默认 330；点箭头收起/展开（收起时只留一条窄条，图占满）。
  var clampAside = function (w) {
    var max = 900;
    try {
      var rw = rootRef.current && rootRef.current.clientWidth;
      if (rw) max = Math.max(ASIDE_MIN + 40, rw - 320);   // 左边给画布留至少 320
    } catch (e) { /* 量不到就用默认上限 */ }
    return Math.max(ASIDE_MIN, Math.min(max, Math.round(Number(w) || ASIDE_DEFAULT)));
  };
  var onSplitDown = function (ev) {
    if (!ev || typeof ev.preventDefault === "function") ev && ev.preventDefault();
    var startX = Number(ev && ev.clientX) || 0;
    var startW = asideRef.current || ASIDE_DEFAULT;
    var move = function (e) {
      var x = Number(e && e.clientX);
      if (!Number.isFinite(x)) return;
      setAsideWidth(clampAside(startW - (x - startX)));      // 分隔条往左 → 右栏变宽
    };
    var up = function () {
      try {
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
        }
      } catch (e) { /* 忽略 */ }
      writeAsideWidth(asideRef.current);                       // 拖完才落盘，避免每帧写 localStorage
    };
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      }
    } catch (e) { /* 无 document（离线测试）时只改这一次 */ }
    setAsideWidth(clampAside(startW));
  };
  var resetAside = function () { setAsideWidth(clampAside(ASIDE_DEFAULT)); writeAsideWidth(ASIDE_DEFAULT); };
  var asideSplit = h("div", {
    className: "dsh-vc-split" + (asideCollapsed ? " is-collapsed" : ""),
    title: "拖动调整右栏宽度（往左拖变宽；双击复位 " + ASIDE_DEFAULT + "px；点箭头收起/展开）",
    onMouseDown: onSplitDown,
    onDoubleClick: resetAside,
  },
    h("button", {
      className: "dsh-vc-splitbtn",
      title: asideCollapsed ? "展开右侧详情栏" : "收起右侧详情栏",
      onMouseDown: function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); },
      onClick: function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); setAsideCollapsed(!asideCollapsed); },
    }, asideCollapsed ? "⟨" : "⟩"));

  var aside = h("aside", {
    className: "dsh-vc-aside" + (asideCollapsed ? " is-collapsed" : ""),
    style: { width: (asideCollapsed ? 0 : asideWidth) + "px" },
  },
    selAssetObj ? h("div", null,
      h("h4", null, "选中资产"),
      h("div", { className: "dsh-vc-mono" }, String(selAssetObj.id || "")),
      h("div", { style: { marginTop: 4, whiteSpace: "pre-wrap" } }, selAssetObj.label || selAssetObj.value || "-"),
      h("div", { className: "dsh-vc-hint" }, sel.from === "coverage" ? "来源：覆盖矩阵" : "来源：图上资产节点"),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "类别"), h("div", { className: "dsh-vc-mono" }, (selAssetObj.kind || "-") + " · priority " + (selAssetObj.priority == null ? 3 : selAssetObj.priority))),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "价值 / 标识"), h("div", { className: "dsh-vc-mono" }, selAssetObj.value || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "技术栈"), h("div", null, selAssetObj.tech || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "浅测 / 深测"),
        h("div", null, "浅测 s2：" + (selAssetObj.s2 || "pending") + "（" + (stageDone(selAssetObj.s2) ? "已覆盖" : "未覆盖") + "）"),
        h("div", null, "深测 s3：" + (selAssetObj.s3 || "pending") + "（" + (deepEligible(selAssetObj) ? "priority ≥ 3，需深测" : "priority < 3，不要求深测") + "）")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "证据"), h("div", { className: "dsh-vc-mono" }, selAssetObj.evidence || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "备注"), h("div", null, selAssetObj.notes || "-")),
      h("div", { style: { marginTop: 8 } }, h("h4", null, "六张矩阵逐项状态（" + (covView.matrices || []).length + "）"), selAssetMatrices(selAssetObj)),
      h("button", { className: "dsh-vc-btn", style: { marginTop: 8 }, onClick: function () { setSel(null); } }, "取消选中"))
      : sel ? h("div", null,
      h("h4", null, "选中对象"),
      h("div", { className: "dsh-vc-mono" }, sel.id),
      h("div", { style: { marginTop: 4, whiteSpace: "pre-wrap" } },
        selIsPlaceholder ? (sel.node.intent && sel.node.intent.description) : (sel.node.fact && sel.node.fact.description)),
      sel.node && sel.node.intent && sel.node.intent.note
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "备注"), h("div", null, sel.node.intent.note)) : null,
      sel.node && sel.node.fact && sel.node.fact.evidence
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "证据"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.evidence)) : null,
      sel.node && sel.node.fact && sel.node.fact.target
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "目标"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.target)) : null,
      sel.node && sel.node.fact && sel.node.fact.poc
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "POC"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.poc)) : null,
      sel.node && sel.node.fact && sel.node.fact.fix
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "修复建议"), h("div", null, sel.node.fact.fix)) : null,
      sel.node && sel.node.intent
        ? h("div", { style: { marginTop: 8 } }, h("h4", null, "操作"),
          sel.node.kind === "pending"
            ? h("button", { className: "dsh-vc-btn", onClick: function () { onDropIntent(sel.node.intent.id); } }, "取消该方向（记死路）") : null,
          h("div", { className: "dsh-vc-hint" }, "来源事实：" + (((sel.node.intent.from || []).join(", ")) || "-"))) : null,
      h("button", { className: "dsh-vc-btn", style: { marginTop: 8 }, onClick: function () { setSel(null); } }, "取消选中"))
      : h("div", { className: "dsh-vc-hint" }, "点击图上节点查看详情"),
    h("h4", null, "待认领意图（" + openIntents.length + "）"),
    openIntents.length
      ? openIntents.map(function (i) {
        return h("div", {
          key: i.id, className: "dsh-vc-row",
          onClick: function () { setSel({ id: "ph_" + i.id, node: { id: "ph_" + i.id, kind: "pending", intent: i } }); },
        },
          h("div", { className: "dsh-vc-mono" }, i.id + (i.domain ? " · " + i.domain : "") + (i.worker ? " · " + i.worker + " 认领中" : "")),
          h("div", null, String(i.description || "").slice(0, 60)));
      })
      : h("div", { className: "dsh-vc-hint" }, "无待认领方向"),
    h("h4", null, "人类提示（" + ((graph.hints || []).length) + "）"),
    (graph.hints || []).slice(-6).map(function (x) {
      return h("div", { key: x.id, className: "dsh-vc-row" },
        h("div", { className: "dsh-vc-mono" }, x.id + " · " + (x.creator || "Human")),
        h("div", null, String(x.content || "").slice(0, 90)));
    }),
    h("h4", null, "写一条提示"),
    h("input", {
      className: "dsh-vc-in", value: hint, placeholder: "范围 / 凭据 / 禁测项…",
      onChange: function (e) { setHint(e.target.value); },
      onKeyDown: function (e) { if (e.key === "Enter") onAddHint(); },
    }),
    h("button", { className: "dsh-vc-btn", style: { marginTop: 6 }, onClick: onAddHint }, "提交提示"));

  // ── 任务汇总 ──────────────────────────────────────────────────────────────
  var sevBadge = function (s) { return h("span", { className: "dsh-vc-sev " + String(s || "").toLowerCase() }, s || "未定级"); };
  var summaryView = h("div", { style: { padding: "10px 12px", overflow: "auto", flex: 1 } },
    h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
      h("span", { className: "dsh-vc-badge" }, "成果 " + findings.length),
      h("span", { className: "dsh-vc-badge" }, "critical " + sev.critical),
      h("span", { className: "dsh-vc-badge" }, "high " + sev.high),
      h("span", { className: "dsh-vc-badge" }, "medium " + sev.medium),
      h("span", { className: "dsh-vc-badge" }, "low " + sev.low),
      h("button", { className: "dsh-vc-btn", style: { marginLeft: "auto" }, onClick: onCopy }, "复制 Markdown")),
    findings.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null,
          h("th", null, "ID"), h("th", null, "严重级"), h("th", null, "标题"), h("th", null, "目标"), h("th", null, "状态"), h("th", null, "证据"))),
        h("tbody", null, findings.map(function (f) {
          var row = h("tr", {
            key: f.id, className: "is-clik" + (openRow === f.id ? " is-on" : ""),
            onClick: function () { setOpenRow(openRow === f.id ? null : f.id); },
          },
            h("td", { className: "dsh-vc-mono" }, f.id),
            h("td", null, sevBadge(f.severity)),
            h("td", null, String(f.description || "").split("\n")[0].slice(0, 70)),
            h("td", { className: "dsh-vc-mono" }, f.target || "-"),
            h("td", null, f.status || f.confidence || "-"),
            h("td", { className: "dsh-vc-mono" }, f.evidence || "-"));
          if (openRow !== f.id) return row;
          return [row, h("tr", { key: f.id + ":d" }, h("td", { colSpan: 6, style: { whiteSpace: "pre-wrap", background: "rgba(58,157,255,.06)" } },
            String(f.description || "") + "\n\nPOC：" + (f.poc || "-") + "\n\n修复建议：" + (f.fix || "-") + "\n\n证据路径：" + (f.evidence || "-")))];
        })))
      : h("div", { className: "dsh-vc-empty" }, "尚无成果。子 agent 写 category=vuln 的事实（带 severity/target/poc/fix）后会出现在这里。"),
    h("h4", null, "资产与接口（" + assets.length + "）"),
    assets.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null, h("th", null, "ID"), h("th", null, "类别"), h("th", null, "描述"), h("th", null, "证据"))),
        h("tbody", null, assets.map(function (f) {
          return h("tr", { key: f.id },
            h("td", { className: "dsh-vc-mono" }, f.id), h("td", null, f.category),
            h("td", null, String(f.description || "").slice(0, 80)), h("td", { className: "dsh-vc-mono" }, f.evidence || "-"));
        })))
      : h("div", { className: "dsh-vc-hint" }, "无（子 agent 用 category=asset/endpoint/cred 登记）"),
    h("h4", null, "死路与未排除面（" + dead.length + "）"),
    dead.length
      ? dead.map(function (d) {
        return h("div", { key: d.id, className: "dsh-vc-row" },
          h("div", { className: "dsh-vc-mono" }, d.id),
          h("div", null, String(d.description || "").slice(0, 90)),
          d.note ? h("div", { className: "dsh-vc-hint" }, "← " + String(d.note).slice(0, 120)) : null);
      })
      : h("div", { className: "dsh-vc-hint" }, "无"));

  // ── 覆盖矩阵（这次作业测得全不全）──────────────────────────────────────────
  var covAssets = (cov && cov.assets) || [];

  // 缺口/类别表点一条 → 选中该资产：右侧详情栏显示它的完整字段
  var pickAsset = function (a) {
    if (a) setSel({ id: a.id, node: a, from: "coverage" });
  };

  var bar2 = function (pct, color) {
    return h("div", { className: "dsh-vc-track" },
      h("div", { className: "dsh-vc-fill", style: { width: Math.max(0, Math.min(100, Number(pct) || 0)) + "%", background: color } }));
  };

  var kindRow = function (k) {
    var hit = findAssetByValue(covAssets, k.kind, null) || covAssets.filter(function (a) { return String(a.kind) === k.kind; })[0] || null;
    return h("tr", {
      key: k.kind,
      className: hit ? "is-clik" + (selAssetId === hit.id ? " is-on" : "") : null,
      onClick: function () { pickAsset(hit); },
    },
      h("td", { className: "dsh-vc-mono" }, k.kind),
      h("td", null, String(k.total)),
      h("td", null, String(k.shallowDone) + "/" + String(k.total)),
      h("td", null, String(k.deepDone) + "/" + String(k.total)));
  };

  var gapRow = function (g) {
    var hit = findAssetByValue(covAssets, g.value, g.kind);
    return h("div", {
      key: g.id + ":" + g.stage, className: "dsh-vc-gap" + (selAssetId === (hit && hit.id) ? " is-on" : ""),
      onClick: function () { pickAsset(hit); },
    },
      h("span", { className: "dsh-vc-mono" }, g.id),
      h("span", { className: "dsh-vc-kind" }, "[" + g.kind + "]"),
      h("span", { style: { flex: 1, wordBreak: "break-all" } }, g.value),
      h("span", { className: "dsh-vc-st" }, "（" + g.stage + "）"),
      h("span", { className: "dsh-vc-st" }, "P" + (g.priority == null ? 3 : g.priority)));
  };

  // 六阶段各自的完成度 + 缺口（数据来自 /coverage 的 stages）
  var stageColor = function (pct) { return pct >= 100 ? "#2fd4a7" : pct >= 60 ? "#3a9dff" : pct >= 30 ? "#e8b931" : "#f76808"; };
  // 缺口点名用 `asset:key`（一眼看出是哪个资产的哪一项没做）
  var gapKeys = function (stage, limit) {
    var gaps = (stage && stage.gaps) || [];
    return gaps.slice(0, limit).map(function (g) { return (g.asset || g.assetId) + (g.key ? ":" + g.key : ""); }).join("、");
  };
  var stageRow = function (row) {
    var gapText = row.key === "start"
      ? (covView.sourcesMissing.length ? "来源未齐 " + covView.sourcesMissing.length + " 类" : "来源已齐")
      : row.gaps + " 个缺口";
    // 浅层 / 中间层各横跨两张矩阵，缺口两边的都要列
    var missing = (row.stageKeys || []).map(function (k) { return gapKeys(covView.stages[k], 2); }).filter(Boolean).join("、");
    return h("div", { className: "dsh-vc-stagerow", key: "stage-" + row.key },
      h("span", null, row.id + " " + row.label),
      bar2(row.pct, stageColor(row.pct)),
      h("span", { className: "dsh-vc-num" }, row.pct + "% · " + row.done + "/" + row.required),
      h("span", { className: "dsh-vc-st" }, "（" + gapText + "）"),
      missing ? h("span", { className: "dsh-vc-hint" }, "缺：" + missing) : null);
  };
  var reflowBanner = covView.reflow && covView.reflow.pending
    ? h("div", { className: "dsh-vc-block" },
      "⚠ 回灌未收轮：新增 " + covView.reflow.count + " 个资产（来源 " + (covView.reflow.source || "未知") + "）→ 已退回起点阶段：" +
      "先 bb_coverage {endRound:true} 再收一轮确认「连续 0 新增」，然后给这批新资产补六张矩阵（P2 信息收集 → P3 核实 + 浅层测试 → P4 核实 + OWASP → P5 深层）")
    : null;
  var stagesView = h("div", { className: "dsh-vc-stagewrap" },
    reflowBanner,
    (covView.counts.assets > 0 && !Object.keys(covView.stages).some(function (k) { return (covView.stages[k] && covView.stages[k].done) > 0; }))
      ? h("div", { className: "dsh-vc-block" },
        "六张矩阵全为 0：这个项目只登记了资产，还没开始逐资产检查。让总控用 bb_asset_checks {onlyGaps:true} 取缺口派单，" +
        "由各专业子 agent 落 bb_asset_check 行（信息收集 → 核实 → 浅层测试 → 核实 → OWASP → 深层）。")
      : null,
    h("h4", null, "六阶段完成度（起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果）"
      + "（「线索」「死点」不是阶段，只在图上成条，不进这张表）"
      + (covView.stageMissing ? "（后端未给 stages，已按进度字段兜底）" : "")),
    covView.phaseRows.map(stageRow));

  // 六张矩阵：各自完成度 + 缺口（缺 `asset:key` 点名）+ na 与「真测过」分开显示
  var matrixRow = function (m) {
    var named = gapKeys({ gaps: m.gaps }, 3);
    return h("div", { className: "dsh-vc-stagerow", key: "mx-" + m.key },
      h("span", null, "矩阵 " + m.label),
      bar2(m.pct, stageColor(m.pct)),
      h("span", { className: "dsh-vc-num" }, m.pct + "% · " + m.done + "/" + m.required),
      h("span", { className: "dsh-vc-st" }, "（缺口 " + m.gapCount + (m.gapShown ? "，点名前 " + Math.min(m.gapShown, 3) + " 条" : "") + "）"),
      h("span", { className: "dsh-vc-num" }, "na " + m.na + " · 真测过 " + m.tested),
      named ? h("span", { className: "dsh-vc-hint" }, "缺：" + named) : null);
  };
  var matricesView = h("div", { className: "dsh-vc-stagewrap" },
    h("h4", null, "六张覆盖矩阵（信息收集 / 核验信息收集 / 浅层测试 / 核验浅层 / OWASP 逐类测试 / 深层漏洞验证）"),
    (covView.matrices || []).map(matrixRow));

  // 未测面声明：明确「哪些面没测 + 为什么」，未声明的要显眼
  var untestedView = h("div", { className: "dsh-vc-na" },
    h("h4", null, "未测面（" + covView.untested.items.length + (covView.untested.declared ? "，已声明" : "，⚠ 未声明") + "）"),
    covView.untested.items.length
      ? covView.untested.items.map(function (u) {
        return h("div", { key: u.id || u.surface, className: "dsh-vc-row" },
          h("div", { className: "dsh-vc-mono" }, "[未测面] " + u.id + " · " + u.stage + " · " + u.surface),
          h("div", { className: "dsh-vc-hint" }, "未测原因：" + (u.why || "未写原因")));
      })
      : h("div", { className: "dsh-vc-hint" }, covView.untested.declared ? "已声明：无未测面" : "尚未声明未测面（P6 成果阶段必须写）"));

  // 复核进度：成果里的漏洞有多少被独立复核过
  var reviewsView = h("div", { className: "dsh-vc-na" },
    h("h4", null, "复核（" + covView.reviews.reviewed + "/" + covView.reviews.vuln + "）"),
    h("span", { className: "dsh-vc-num" }, "已复核 " + covView.reviews.reviewed + " · 待复核 " + covView.reviews.pending
      + (covView.counts.naNoReason ? " · na 无理由 " + covView.counts.naNoReason : "")),
    covView.reviews.pending
      ? h("span", { className: "dsh-vc-hint" }, "⚠ 还有 " + covView.reviews.pending + " 条成果没复核，P6 不能收口")
      : h("span", { className: "dsh-vc-hint" }, "全部成果已复核"));

  var coverageListView = h("div", { className: "dsh-vc-scroll" },
    // 阶段横幅
    h("div", { className: "dsh-vc-phase" },
      h("span", { className: "dsh-vc-title" }, "阶段 " + covView.label),
      h("span", { className: "dsh-vc-badge" + (covView.canAdvance ? " is-ok" : "") },
        covView.next ? "可推进到 " + covView.next + "：" + (covView.canAdvance ? "是" : "否") : "已是最后阶段"),
      covView.sourcesMissing.length
        ? h("span", { className: "dsh-vc-hint" }, "来源未齐：" + covView.sourcesMissing.join(" / ")) : null,
      covView.recon.rounds
        ? h("span", { className: "dsh-vc-num" }, "收集轮次 " + covView.recon.rounds + " · 本轮新增 " + covView.recon.addedThisRound) : null,
      covView.blockers.length
        ? h("div", { className: "dsh-vc-block" }, "阻塞项（" + covView.blockedBy + "）：" + covView.blockers.map(String).join("；"))
        : h("span", { className: "dsh-vc-hint" }, covView.next ? "无阻塞项" : "无下一阶段"),
      (covView.warnings || []).map(function (w, i) { return h("div", { key: "w" + i, className: "dsh-vc-hint" }, "提示：" + w); })),

    // 两条覆盖率
    h("div", { className: "dsh-vc-pct" },
      h("div", { className: "dsh-vc-pctrow" },
        h("span", null, "浅测覆盖"),
        bar2(covView.pct.shallow, "#3a9dff"),
        h("span", { className: "dsh-vc-num" }, covView.pct.shallow + "% · " + covView.counts.shallowDone + "/" + covView.counts.assets)),
      h("div", { className: "dsh-vc-pctrow" },
        h("span", null, "深测覆盖"),
        bar2(covView.pct.deep, "#2fd4a7"),
        h("span", { className: "dsh-vc-num" }, covView.pct.deep + "% · " + covView.counts.deepDone + "/" + covView.counts.deepTargets + "（priority ≥ 3）")),
      // na 也算覆盖（判定不适用），但它没有"真跑过"的证据强度：并列显示，别让 na 把数字刷满
      (covView.counts.naShallow || covView.counts.naDeep)
        ? h("div", { className: "dsh-vc-pctrow" },
          h("span", null, "其中 na"),
          h("span", { className: "dsh-vc-num" }, "浅测 " + covView.counts.naShallow + " · 深测 " + covView.counts.naDeep),
          h("span", { className: "dsh-vc-hint" }, "真测过：浅测 " + covView.pct.shallowTested + "% / 深测 " + covView.pct.deepTested + "%"
            + (covView.counts.naNoReason ? "；⚠️ " + covView.counts.naNoReason + " 个 na 没写理由" : "")))
        : null),

    // 六阶段完成度 / 六张矩阵 / 未测面 / 复核进度（P6 收口的判据）
    stagesView,
    matricesView,
    untestedView,
    reviewsView,

    h("div", { className: "dsh-vc-grid" },
      h("div", { className: "dsh-vc-col" },
        h("h4", null, "按类别（" + covView.byKind.length + " 类）"),
        covView.byKind.length
          ? h("table", { className: "dsh-vc-table" },
            h("thead", null, h("tr", null,
              h("th", null, "类别"), h("th", null, "总数"), h("th", null, "浅测完成"), h("th", null, "深测完成"))),
            h("tbody", null, covView.byKind.map(kindRow)))
          : h("div", { className: "dsh-vc-hint" }, "无资产（先跑资产收集）"),
        h("div", { className: "dsh-vc-hint" }, "口径：" + covView.goals.info + "；" + covView.goals.shallow + "；" + covView.goals.mid + "；" + covView.goals.deep)),
      h("div", { className: "dsh-vc-col" },
        h("h4", null, "缺口清单（" + covView.counts.gaps + "，显示前 " + covView.gaps.length + "）"),
        covView.gaps.length
          ? covView.gaps.map(gapRow)
          : h("div", { className: "dsh-vc-hint" }, "当前无缺口：浅测与 priority ≥ 3 的深测均已覆盖"),
        h("div", { className: "dsh-vc-hint" }, "点一条缺口 → 右侧详情栏显示该资产的 tech / priority / s2 / s3 / evidence / notes，以及六张矩阵的逐项状态"))),

    h("h4", null, "资产明细（" + covAssets.length + "）"),
    covAssets.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null,
          h("th", null, "ID"), h("th", null, "类别"), h("th", null, "值"), h("th", null, "技术栈"),
          h("th", null, "P"), h("th", null, "浅测"), h("th", null, "深测"), h("th", null, "六张矩阵进度"))),
        h("tbody", null, covAssets.map(function (a) {
          var matched = findAssetByValue(covAssets, a.value, a.kind);
          var sums = a.checkSummary || null;
          var fmtStage = function (stage) {
            var s = sums && sums[stage];
            return s ? s.done + "/" + s.required : "-";
          };
          return h("tr", {
            key: a.id, className: "is-clik" + (selAssetId === a.id ? " is-on" : ""),
            onClick: function () { pickAsset(matched || a); },
          },
            h("td", { className: "dsh-vc-mono" }, a.id),
            h("td", null, a.kind),
            h("td", { className: "dsh-vc-mono" }, a.value),
            h("td", null, a.tech || "-"),
            h("td", null, String(a.priority == null ? 3 : a.priority)),
            h("td", null, a.s2 || "pending"),
            h("td", null, a.s3 || "pending"),
            h("td", { className: "dsh-vc-mono" }, "info " + fmtStage("info") + " · 核验收集 " + fmtStage("verifyInfo")
              + " · 浅层 " + fmtStage("shallow") + " · 核验浅层 " + fmtStage("verifyShallow")
              + " · OWASP " + fmtStage("owasp") + " · 深层 " + fmtStage("deep")));
        })))
      : h("div", { className: "dsh-vc-hint" }, "无资产记录"));

  if (tab === "coverage" && !(cov && cov.coverage)) {
    return h("div", rootProps, bar,
      err ? h("div", { className: "dsh-vc-err" }, err) : null,
      h("div", { className: "dsh-vc-empty" }, err ? "覆盖矩阵取数失败：" + err : "加载中…"));
  }

  return h("div", rootProps,
    bar,
    err ? h("div", { className: "dsh-vc-err" }, err) : null,
    notice
      ? h("div", { className: "dsh-vc-note" }, notice,
        h("button", { className: "dsh-vc-btn", style: { marginLeft: 8 }, onClick: function () { setNotice(""); } }, "知道了"))
      : null,
    pinned
      ? h("div", { className: "dsh-vc-banner" },
        "正在看历史项目：" + ((graph && graph.project && graph.project.title) || pinned) + "（" + pinned + "）"
        + " —— 它不是本会话的黑板；本会话的新测试请让总控 bb_project_init 建新项目。",
        h("button", { className: "dsh-vc-btn", onClick: function () { switchTo(""); } }, "回到本会话"))
      : null,
    isFs ? h("div", { className: "dsh-vc-hint-fs" }, "全屏中：滚轮缩放 · 拖拽平移 · 右上角「适应窗口」回全局 · Esc 退出") : null,
    h("div", { className: "dsh-vc-body" },
      tab === "summary" ? summaryView : [tab === "live" ? canvas : coverageListView, asideSplit, aside]));
  } catch (e) {
    // 不白屏：把错误原文摆出来 + 提示先刷新（多半是浏览器还挂着旧 bundle，或宿主 payload 形状变了）
    return h("div", rootProps,
      h("div", { className: "dsh-vc-bar" }, h("span", { className: "dsh-vc-title" }, "作战面板")),
      h("div", { className: "dsh-vc-err" }, "面板渲染出错：" + String((e && e.message) || e)),
      h("div", { className: "dsh-vc-empty" },
        h("div", null, "先刷新页面（Ctrl+F5）—— 面板 bundle 与宿主插件版本不一致时会出现这种情况。"),
        h("div", { className: "dsh-vc-hint", style: { marginTop: 6 } }, "若刷新后仍报同一错误，把这段错误原文发给总控，附上会话 id。")));
  }
}

function apply(ctx) {
  ctx.effect(function () { installStyles(); }, "vore-console: styles");
  ctx.inject(["sessions"], function (scope) {
    // 必须走 slots.inject：'conversation.view' 的声明由 @deepseek-ai/dsh-client-ui-conversation
    // 在它自己的 apply 里提交（children 表），宿主 core 对**未声明**槽位的 register 会抛错。
    // slots.inject 会等到声明落地再注册（与宿主 ui-trajectory 的写法一致）。
    ctx.slots.inject("conversation.view", function () {
      return ctx.slots.register({
        name: "conversation.view",
        id: "vore-console",
        order: 50,
        label: function () { return "作战面板"; },
      }, function VoreConsole(props) {
        return h(ConsolePanel, Object.assign({}, props, { sessionsStore: scope.sessions }));
      });
    });
    return function () {};
  });
}


module.exports = { name: "vore-console-client", inject: ["slots"], apply: apply };
return module.exports; } });
