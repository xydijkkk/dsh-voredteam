// vore-console 测试：泳道布局（行优先，六阶段）/配色/成果抽取/Markdown/HTTP 客户端（纯函数）
// + 客户端 bundle 契约（vm 装载）。
// 运行：node --no-warnings plugins/vore-console/tests/console.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadPanelBundle } from "../scripts/vm-check.mjs";
import {
  computeLayout, factStyle, extractFindings, extractAssets, extractDeadEnds, extractDeadPoints,
  severityCounts, findingsMarkdown, createApi, NODE_W, PAD,
  coverageView, coverageGaps, findAssetByValue, COVERAGE_GAP_LIMIT,
  lanesFromCoverage, laneCompletion, PHASE_ORDER, nextPhase,
  LANES, SHALLOW_CLASSES, OWASP_KEYS, DEEP_CLASSES, MATRIX_ORDER, STAGE_KEYS, fitZoom,
  checkKeyLabel, statusLabel,
} from "../lib/pure.mjs";

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

const graph = {
  project: { id: "eng_001", title: "授权测试", origin: "https://t.example", goal: "拿到可复现高危证据链", status: "active" },
  facts: [
    { id: "origin", category: "origin", description: "任务起点：https://t.example", created_at: "2026-09-19T00:00:00Z" },
    { id: "f001", category: "asset", description: "子域 a.t.example 存活，nginx 1.24", evidence: "evidence/httpx.txt", created_at: "2026-09-19T00:01:00Z" },
    { id: "f002", category: "endpoint", description: "GET /api/v2/order/{id} 无属主校验", evidence: "evidence/req-002.txt", confidence: "confirmed", created_at: "2026-09-19T00:02:00Z" },
    { id: "f003", category: "vuln", description: "订单接口越权：换 id 返回他人手机号", evidence: "evidence/req-003.txt", severity: "high", target: "https://t.example/api/v2/order/10086", poc: "exp/f003.py", fix: "加属主校验", status: "pending", created_at: "2026-09-19T00:03:00Z" },
    { id: "f004", category: "vuln", description: "疑似 SSTI（未验证）", confidence: "suspected", severity: "medium", created_at: "2026-09-19T00:04:00Z" },
    { id: "f005", category: "fact", description: "被推翻的结论", deprecated: 1, created_at: "2026-09-19T00:05:00Z" },
    { id: "goal", category: "goal", description: "任务目标：拿到可复现高危证据链", created_at: "2026-09-19T00:00:00Z" },
  ],
  intents: [
    { id: "i001", description: "测绘资产", domain: "recon", from: ["origin"], to_fact: "f001", concluded_at: "2026-09-19T00:01:30Z", created_at: "2026-09-19T00:00:30Z" },
    { id: "i002", description: "接口越权验证", domain: "api-security", from: ["f001"], to_fact: "f002", concluded_at: "2026-09-19T00:02:30Z", created_at: "2026-09-19T00:01:40Z" },
    { id: "i003", description: "横向到内网（待授权）", domain: "internal-network", from: ["f002"], worker: "internal-network", created_at: "2026-09-19T00:03:30Z" },
    { id: "i004", description: "试 WAF 绕过", domain: "web-injection", from: ["f003"], dead: 1, status: "dead", note: "12 种编码全 403", concluded_at: "2026-09-19T00:04:30Z", created_at: "2026-09-19T00:03:40Z" },
  ],
  hints: [{ id: "h001", content: "禁测 data02 资产", creator: "Human", created_at: "2026-09-19T00:00:10Z" }],
};

console.log("泳道布局（computeLayout，行优先：起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果）");

// 六阶段检查项样板（新契约：info / verifyInfo / shallow / verifyShallow / owasp / deep）
const INFO_OK = { tech: "done", cert: "done", dns: "done", waf: "done", headers: "done", deps: "done" };
const VERIFY_INFO_OK = { tech_ok: "ok", cert_ok: "ok", dns_ok: "ok", waf_ok: "ok" };
const SHALLOW_OK = { fp: "done", pathTruth: "done", params: "done", authEdge: "done", errLeak: "done", expose: "done", lowFuzz: "done", compHint: "done" };
const VERIFY_SHALLOW_OK = { fp_ok: "ok", path_ok: "ok", params_ok: "ok", authEdge_ok: "ok" };
const OWASP_MISS = { A01: "miss", A02: "miss", A03: "miss", A04: "miss", A05: "miss", A06: "miss", A07: "miss", A08: "miss", A09: "miss", A10: "miss" };
const DEEP_MISS = { unauth: "miss", idor: "miss", sqli: "miss", ssrf: "miss", upload: "miss", logic: "miss", race: "miss", deser: "miss" };

// 六阶段资产清单（与面板实际拿到的 /coverage.assets 同形状）
const laneAssets = [
  {
    id: "a001", kind: "domain", value: "TARGET.example", label: "主域", tech: "nginx 1.24", priority: 4, s2: "done", s3: "done",
    checks: {
      info: Object.assign({}, INFO_OK),
      verifyInfo: Object.assign({}, VERIFY_INFO_OK),
      shallow: Object.assign({}, SHALLOW_OK),
      verifyShallow: Object.assign({}, VERIFY_SHALLOW_OK),
      owasp: Object.assign({}, OWASP_MISS, { A01: "hit" }),
      deep: Object.assign({}, DEEP_MISS, { unauth: "hit", idor: "hit" }),
    },
  },
  {
    id: "a101", kind: "url", value: "https://TARGET.example/login", label: "登录页", tech: "vue 3", priority: 4, s2: "done", s3: "pending",
    checks: {
      info: Object.assign({}, INFO_OK),
      verifyInfo: { tech_ok: "wrong", cert_ok: "unknown", dns_ok: "ok", waf_ok: "ok" },
      shallow: { fp: "pending", pathTruth: "pending", params: "pending", authEdge: "pending", errLeak: "pending", expose: "pending", lowFuzz: "pending", compHint: "pending" },
      verifyShallow: { fp_ok: "ok", path_ok: "pending", params_ok: "pending", authEdge_ok: "pending" },
      owasp: { A01: "miss" },
      deep: { unauth: "pending" },
    },
  },
  {
    id: "a002", kind: "subdomain", value: "api.TARGET.example", label: "API 子域", tech: "Spring Boot 2.7", priority: 5, s2: "done", s3: "pending",
    checks: {
      info: { tech: "done", cert: "done", dns: "done", waf: "pending", headers: "pending", deps: "done" },
      verifyInfo: Object.assign({}, VERIFY_INFO_OK),
      shallow: Object.assign({}, SHALLOW_OK),
      verifyShallow: Object.assign({}, VERIFY_SHALLOW_OK),
      owasp: Object.assign({}, OWASP_MISS, { A01: "hit" }),
      deep: { unauth: "pending", idor: "pending", sqli: "pending", ssrf: "pending", upload: "pending", logic: "pending", race: "pending", deser: "pending" },
    },
  },
  { id: "a003", kind: "port", value: "10.0.0.11:8443", label: "8443", tech: "未知", priority: 2, s2: "pending", s3: "na" },
];
for (const a of laneAssets) {
  if (!a.checks) continue;
  a.checkSummary = {};
  for (const stage of STAGE_KEYS) {
    const check = a.checks[stage] || {};
    const vals = Object.keys(check).map((k) => check[k]);
    a.checkSummary[stage] = { done: vals.filter((v) => ["done", "ok", "hit", "na"].includes(v)).length, required: vals.length };
  }
}
// 资产清单驱动的泳道覆盖度（后端 stages 一律给齐六张矩阵）
const laneCov = {
  counts: { assets: 3 },
  recon: { rounds: 2, addedThisRound: 0 },
  stages: {
    info: { required: 18, done: 15, pct: 83 },
    verifyInfo: { required: 12, done: 11, pct: 92 },
    shallow: { required: 16, done: 8, pct: 50 },
    verifyShallow: { required: 12, done: 9, pct: 75 },
    owasp: { required: 30, done: 3, pct: 10 },
    deep: { required: 16, done: 2, pct: 13 },
  },
  untested: { declared: true, items: [{ id: "u001", surface: "小程序包", why: "无模拟器", stage: "P2" }] },
  reviews: { vuln: 2, reviewed: 1, pending: 1 },
};

await ok("八条泳道从上到下：起点 / 信息收集 / 浅层 / 中间层 / 深层 / 线索 / 死点 / 成果", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  assert.deepEqual(l.lanes.map((x) => x.label), ["起点", "信息收集", "浅层", "中间层", "深层", "线索", "死点", "成果"]);
  assert.deepEqual(l.lanes.map((x) => x.id), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"]);
  for (let i = 1; i < l.lanes.length; i++) {
    assert.ok(l.lanes[i].y > l.lanes[i - 1].y, `泳道 ${l.lanes[i].label} 应在 ${l.lanes[i - 1].label} 下方`);
  }
  // 线索 / 死点不是覆盖矩阵：按条数计，不显示 n/m
  const clue = l.lanes.find((x) => x.key === "clue");
  const dead = l.lanes.find((x) => x.key === "dead");
  assert.equal(clue.counted, true);
  assert.equal(dead.counted, true);
  assert.match(clue.hint, /线索 \d+ 条 · 已确认 \d+ · 未确认 \d+/);
  assert.match(dead.hint, /死点 \d+ 个 · 死路方向 \d+ · 被推翻结论 \d+/);
  assert.ok(!/（\d+%）/.test(clue.text), "线索泳道不该显示百分比：" + clue.text);
});

await ok("线索泳道分两组摆：已确认事实 / 未确认（疑似 + 待探索），组内重新从第 0 列排队", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const clue = l.lanes.find((x) => x.key === "clue");
  assert.deepEqual(clue.subRows.map((s) => s.key), ["confirmed", "suspected"], "两组都要在（有内容时）");
  for (const s of clue.subRows) assert.ok(s.count > 0 && s.headH > 0, "每组要有计数与小标题高度");
  const conf = l.nodes.filter((n) => n.row === clue.row && n.group === "confirmed");
  const susp = l.nodes.filter((n) => n.row === clue.row && n.group === "suspected");
  assert.ok(conf.length && susp.length, "两组都要有节点");
  assert.ok(conf[0].y < susp[0].y, "已确认事实在上、未确认在下");
  assert.ok(susp.some((n) => n.kind === "pending"), "未结论的意图算「未确认」，画成待探索虚框");
  assert.equal(l.byId.get("ph_i003").row, clue.row, "待探索虚框放在线索泳道（不再塞进成果泳道）");
});

await ok("origin 固定第一条泳道，goal 与 category=vuln 固定最后一条泳道", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const origin = l.byId.get("origin");
  const goal = l.byId.get("goal");
  assert.equal(origin.row, 0, "origin 应在泳道 0（起点）");
  assert.equal(origin.y, l.lanes[0].y + 22);
  assert.equal(goal.row, 7, "goal 应在最后一泳道（成果）");
  assert.ok(goal.y > l.byId.get("f003").y - 1, "goal 应在图上");
  assert.equal(l.byId.get("f003").kind, "finding", "category=vuln 归入成果泳道");
  assert.equal(l.byId.get("f003").row, 7);
  assert.equal(NODE_W, 168);
  assert.equal(l.byId.get("origin").x, PAD, "横向从 PAD 起排");
});

await ok("行优先：row 是泳道序号、col 是泳道内横排序号；分组泳道内同一组 y 相同", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const byRow = new Map();
  for (const n of l.nodes) {
    assert.ok(Number.isInteger(n.row), `${n.id} 缺 row（行优先布局必须给每个节点标泳道号）`);
    if (n.row < 0) continue;   // 老契约的死点区不在泳道里
    if (!byRow.has(n.row)) byRow.set(n.row, []);
    byRow.get(n.row).push(n);
  }
  // 带分组的泳道（线索）分成上下两组：先按 y 再按 col 排队；其余泳道 y 必须一致
  for (const [row, list] of byRow) {
    const sorted = list.slice().sort((a, b) => (a.y - b.y) || (a.col - b.col));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      if (cur.y === prev.y) assert.ok(cur.x > prev.x, `同行第 ${i} 个节点 x 应更大（row=${row}）`);
      else assert.ok(cur.y > prev.y, `同一泳道内的组只能自上而下（row=${row}）`);
    }
    for (const n of list) assert.equal(n.laneY, l.lanes[row].y);
  }
  const ys = l.lanes.map((x) => x.y);
  assert.deepEqual(ys, ys.slice().sort((a, b) => a - b), "泳道 y 必须随行号递增");
});

await ok("资产节点按六张矩阵落泳道：信息收集 info、浅层 verifyInfo+shallow、中间层 verifyShallow+owasp、深层 deep", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const a1info = l.byId.get("as_a001_info");
  const a1shallow = l.byId.get("as_a001_shallow");
  const a1mid = l.byId.get("as_a001_verify");
  const a1deep = l.byId.get("as_a001_deep");
  assert.ok(a1info && a1shallow && a1mid && a1deep, "a001 应出现在信息收集/浅层/中间层/深层四条泳道");
  assert.equal(a1info.row, 1, "资产清单落在「信息收集」泳道（起点泳道只放 origin 锚点）");
  assert.equal(a1shallow.row, 2);
  assert.equal(a1mid.row, 3);
  assert.equal(a1deep.row, 4);
  assert.equal(a1info.metric, "info 6/6 · 100%");
  assert.equal(a1shallow.metric, "verifyInfo 4/4 + shallow 8/8 · 100%");
  assert.equal(a1mid.metric, "verifyShallow 4/4 + owasp 1/10 · 36% · 命中 1");
  assert.equal(a1deep.metric, "deep 2/8 · 命中 2");
  // 核验出 wrong/unknown 的资产节点要能高亮（浅层 = 核实信息收集的结果）
  assert.equal(l.byId.get("as_a101_shallow").wrong, 1, "核实有 wrong 的资产节点要能高亮");
  assert.match(l.byId.get("as_a101_shallow").metric, /⚠ 待核实 2/, "wrong + unknown 都要提示待核实");
  // priority < 3 的资产不该出现在深层（不要求深测）
  assert.ok(!l.byId.has("as_a003_deep"), "priority 2 的资产不应进深层泳道");
  // 一点都没开始采信息的资产停在「信息收集」泳道的第一格（待采集清单，指标是 0/6）
  // —— 起点泳道只放 origin 锚点，完成度由泳道标题的「N/N · 收集轮次 k」说话
  assert.ok(l.byId.has("as_a003_info"), "没开始的资产也要落在信息收集泳道（待采集）");
  assert.equal(l.byId.get("as_a003_info").row, 1);
  assert.equal(l.byId.get("as_a003_info").metric, "info 0/0 · 0%", "没记录的检查项不编分母，如实 0/0");
  assert.ok(!l.byId.has("as_a003_start"), "起点泳道不再重复画资产节点（同一批资产画两遍会翻倍并撑高整张图）");
  assert.match(l.lanes[0].hint || "", /收集轮次/, "起点泳道的完成度靠标题里的收集轮次说话");
  // 推进规则：信息收集没采全，就不画后面三层（a002 的 info 是 4/6）
  assert.ok(!l.byId.has("as_a002_shallow"), "信息收集 4/6 没采全 → 不该出现浅层节点");
  assert.ok(!l.byId.has("as_a002_verify"), "信息收集没采全 → 不该出现中间层节点");
  assert.ok(!l.byId.has("as_a002_deep"), "信息收集没采全 → 不该出现深层节点");
  assert.equal(l.byId.get("as_a002_info").metric, "info 4/6 · 67%");
});

await ok("死点：dead 意图与 deprecated 事实都进「死点」泳道（灰色虚框，不再是右侧灰框）", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const deadLane = l.lanes.find((x) => x.key === "dead");
  const ids = l.nodes.filter((n) => n.row === deadLane.row).map((n) => n.id);
  assert.ok(ids.includes("dh_i004"), "死意图应进死点泳道：" + ids.join(","));
  assert.ok(ids.includes("df_f005"), "被推翻的事实（deprecated）应进死点泳道：" + ids.join(","));
  for (const n of l.nodes.filter((x) => x.row === deadLane.row)) {
    assert.equal(n.kind, "dead");
    assert.ok(factStyle(n.fact, n.kind).dash, "死点节点必须是虚框");
    assert.ok(n.x >= PAD, "死点泳道里的节点从最左列起排");
  }
  assert.equal(ids.length, 2);
  assert.equal(l.deadZone.nodes.length, 0, "死点已进泳道：老契约的右侧死点区应为空");
  assert.deepEqual(extractDeadPoints(graph).map((d) => d.id), ["i004", "f005"]);
});

await ok("待探索意图仍画虚框（ph_<id> 机制保留），且不在死点泳道", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  assert.ok(l.byId.has("ph_i003"), "缺少待探索节点");
  assert.equal(l.byId.get("ph_i003").kind, "pending");
  assert.ok(!l.byId.has("ph_i001") && !l.byId.has("dh_i002"));
  const deadLane = l.lanes.find((x) => x.key === "dead");
  assert.notEqual(l.byId.get("ph_i003").row, deadLane.row);
});

await ok("边：intent 三类线型齐备；资产跨泳道的纵向连线存在", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const kinds = new Set(l.edges.map((e) => e.kind));
  assert.ok(kinds.has("concluded") && kinds.has("pending") && kinds.has("dead"), `边类型缺失：${[...kinds]}`);
  for (const e of l.edges) {
    assert.ok(l.byId.has(e.from), `边起点不存在：${e.from}`);
    assert.ok(l.byId.has(e.to), `边终点不存在：${e.to}`);
  }
  const laneEdges = l.edges.filter((e) => e.laneEdge);
  assert.ok(laneEdges.length >= 3, "a001 应有 信息收集→浅层→中间层→深层 三条纵向连线");
  for (const e of laneEdges) {
    const a = l.byId.get(e.from), b = l.byId.get(e.to);
    assert.ok(b.y > a.y, "资产跨泳道的连线必须是自上而下");
  }
});

await ok("画布尺寸覆盖全部节点（死点区字段保留但恒为空）", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  for (const n of l.nodes) {
    assert.ok(n.x + n.w <= l.width, `${n.id} 超出宽度`);
    assert.ok(n.y + n.h <= l.height, `${n.id} 超出高度`);
  }
  assert.equal(l.deadZone.nodes.length, 0);
  assert.equal(l.deadZone.w, 0);
});

await ok("computeLayout 后两个参数可缺省：退化成「只有 facts」的旧行为且仍是八条泳道", () => {
  const l = computeLayout(graph);
  assert.deepEqual(
    l.nodes.map((n) => n.id).sort(),
    ["df_f005", "dh_i004", "f001", "f002", "f003", "f004", "goal", "origin", "ph_i003"].sort(),
    "缺 assets 时不该凭空造资产节点；被推翻的 f005 只以 df_f005（死点）出现"
  );
  assert.equal(l.lanes.length, 8);
  const deadLane = l.lanes.find((x) => x.key === "dead");
  assert.equal(l.nodes.filter((n) => n.row === deadLane.row).length, 2, "缺 assets 时死点泳道仍要有死意图 + 被推翻的事实");
  assert.ok(l.width > 0 && l.height > 0);
  const empty = computeLayout(null);
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.lanes.length, 8, "空图也要能画出八条泳道");
});

console.log("配色（factStyle）");

await ok("严重级 / 疑似 / 废弃三种线型区分", () => {
  assert.match(factStyle({ severity: "critical" }).stroke, /e5484d/i);
  assert.equal(factStyle({ severity: "high" }).dash, null);
  assert.ok(factStyle({ confidence: "suspected" }).dash, "疑似应有虚线");
  assert.ok(factStyle({ deprecated: 1 }).dash, "废弃应有虚线");
  assert.notEqual(factStyle({ category: "goal" }).stroke, factStyle({ category: "fact" }).stroke);
  assert.ok(factStyle(null).dash, "待探索节点应为虚框");
});

console.log("成果抽取");

await ok("findings 只取 category=vuln 或带 severity，且按严重级排序、排除废弃", () => {
  const f = extractFindings(graph);
  assert.deepEqual(f.map((x) => x.id), ["f003", "f004"]);
  assert.equal(severityCounts(f).high, 1);
  assert.equal(severityCounts(f).medium, 1);
});

await ok("资产/接口抽取与死路抽取", () => {
  assert.deepEqual(extractAssets(graph).map((x) => x.id), ["f001", "f002"]);
  assert.deepEqual(extractDeadEnds(graph).map((x) => x.id), ["i004"]);
});

await ok("Markdown 导出含成果表与死路段", () => {
  const md = findingsMarkdown(graph);
  assert.match(md, /# 授权测试 — 成果汇总/);
  assert.match(md, /\| f003 \| high \|/);
  assert.match(md, /## 死路与未排除面/);
  assert.match(md, /i004/);
});

console.log("HTTP 客户端（createApi，注入假 fetch）");

await ok("先取 CSRF 再带 x-dsh-csrf 发 POST", () => {
  const seen = [];
  const fakeFetch = async (url, init = {}) => {
    seen.push({ url, init });
    if (url.endsWith("/csrf")) return { status: 200, json: async () => ({ token: "tok-1" }) };
    return { status: 200, json: async () => ({ ok: true, graph }) };
  };
  const api = createApi(fakeFetch, "/vore-blackboard");
  return api.graph().then((res) => {
    assert.equal(seen[0].url, "/vore-blackboard/csrf");
    assert.equal(seen[1].init.headers["x-dsh-csrf"], "tok-1");
    assert.equal(JSON.parse(seen[1].init.body).projectId, undefined);
    assert.ok(res.graph.facts.length === 7);
  });
});

await ok("403 时丢弃 token 重取一次并重试", async () => {
  let csrfCalls = 0, postCalls = 0;
  const fakeFetch = async (url) => {
    if (url.endsWith("/csrf")) { csrfCalls++; return { status: 200, json: async () => ({ token: `tok-${csrfCalls}` }) }; }
    postCalls++;
    if (postCalls === 1) return { status: 403, json: async () => ({}) };
    return { status: 200, json: async () => ({ ok: true, projects: [] }) };
  };
  const api = createApi(fakeFetch, "/vore-blackboard");
  const res = await api.list();
  assert.deepEqual(res.projects, []);
  assert.equal(csrfCalls, 2);
  assert.equal(postCalls, 2);
});

await ok("ok:false 抛错（UI 能显示）", async () => {
  const fakeFetch = async (url) => url.endsWith("/csrf")
    ? { status: 200, json: async () => ({ token: "t" }) }
    : { status: 200, json: async () => ({ ok: false, error: "项目不存在" }) };
  const api = createApi(fakeFetch, "/vore-blackboard");
  await assert.rejects(() => api.addHint("x", "y"), /项目不存在/);
});

console.log("覆盖矩阵（第三个分栏的视图模型）");

// 12 个资产：浅层 done 5 + na 3 = 8 → 67%；深层目标 10 个（priority ≥ 3）、done 4 + na 1 = 5 → 50%
const covGapAssets = Array.from({ length: 4 }, (_, i) => ({ id: `a10${i}`, kind: "endpoint", value: `/api/gap/${i}`, label: `缺口接口 ${i}`, tech: "spring", priority: 4, s2: "pending", s3: "pending", evidence: `evidence/gap-${i}.txt`, notes: `待验证 ${i}` }));
const covAssets = [
  { id: "a001", kind: "domain", value: "a.t.example", label: "主域", tech: "nginx 1.24", priority: 5, s2: "done", s3: "done", evidence: "evidence/httpx.txt", notes: "入口" },
  { id: "a002", kind: "domain", value: "b.t.example", label: "旁域", tech: "nginx", priority: 4, s2: "done", s3: "na", evidence: "evidence/httpx.txt", notes: "" },
  { id: "a003", kind: "port", value: "t.example:8443", label: "备用端口", tech: "tomcat 9", priority: 4, s2: "done", s3: "doing", evidence: "evidence/nmap.txt", notes: "待深测" },
  { id: "a004", kind: "port", value: "t.example:8080", label: "管理口", tech: "jetty", priority: 5, s2: "na", s3: "pending", evidence: "evidence/nmap.txt", notes: "禁测" },
  { id: "a005", kind: "url", value: "https://t.example/login", label: "登录页", tech: "vue 3", priority: 3, s2: "done", s3: "done", evidence: "evidence/login.png", notes: "" },
  { id: "a006", kind: "url", value: "https://t.example/api/v2/order", label: "订单接口", tech: "spring boot", priority: 4, s2: "done", s3: "done", evidence: "evidence/req-006.txt", notes: "只读" },
  { id: "a007", kind: "subdomain", value: "cdn.t.example", label: "CDN", tech: "cloudflare", priority: 2, s2: "done", s3: "pending", evidence: "evidence/dns.txt", notes: "" },
  { id: "a008", kind: "subdomain", value: "mail.t.example", label: "邮件", tech: "postfix", priority: 2, s2: "na", s3: "na", evidence: "evidence/dns.txt", notes: "不适用" },
  ...covGapAssets,
];
const covPayload = {
  ok: true,
  coverage: {
    phase: "P2", phaseLabel: "信息收集（逐资产信息全采）",
    recon: { rounds: 2, lastAdded: 0, addedThisRound: 0, markEpoch: 5, assetEpoch: 5 },
    sourcesMissing: ["ip", "port"],
    counts: { assets: 12, shallowDone: 8, deepTargets: 10, deepDone: 5, gaps: 10 },
    pct: { shallow: 67, deep: 50 },
    byKind: {
      domain: { total: 2, shallowDone: 2, deepDone: 2 },
      port: { total: 2, shallowDone: 2, deepDone: 0 },
      url: { total: 2, shallowDone: 2, deepDone: 2 },
      subdomain: { total: 2, shallowDone: 2, deepDone: 1 },
      endpoint: { total: 4, shallowDone: 0, deepDone: 0 },
    },
    blockers: { P1: [], P2: ["信息收集未完成 4/12 项"], P3: ["浅层测试未完成 5/10 项（priority ≥ 3）"] },
    canAdvanceTo: { P2: true, P3: false, P4: false },
    gaps: [
      ...covAssets.filter((a) => !["done", "na"].includes(a.s2)).slice(0, 20).map((a) => ({ id: a.id, kind: a.kind, value: a.value, stage: "浅测", priority: a.priority })),
      ...covAssets.filter((a) => a.priority >= 3 && !["done", "na"].includes(a.s3)).slice(0, 20).map((a) => ({ id: a.id, kind: a.kind, value: a.value, stage: "深测", priority: a.priority })),
    ],
  },
  assets: covAssets,
};

await ok("视图模型算出正确的百分比 / 缺口数 / 分类表（后端 payload → UI 数字）", () => {
  const v = coverageView(covPayload);
  assert.equal(v.phase, "P2");
  assert.equal(v.pct.shallow, 67, "浅测应为 8/12 = 67%");
  assert.equal(v.pct.deep, 50, "深测应为 5/10 = 50%（priority ≥ 3）");
  assert.equal(v.counts.gaps, 10);
  assert.equal(v.counts.assets, 12);
  assert.equal(v.counts.shallowDone, 8);
  assert.equal(v.counts.deepTargets, 10);
  assert.equal(v.counts.deepDone, 5);
  assert.equal(v.byKind.find((k) => k.kind === "endpoint").total, 4);
  assert.equal(v.gaps.length, 10, "缺口清单应原样透出 10 条（后端已截到 20）");
  assert.equal(v.gaps[0].value, "/api/gap/0");
  assert.equal(v.next, "P3");
  assert.equal(v.canAdvance, false, "P3 有阻塞项 → 不可推进");
  assert.deepEqual(v.canAdvanceTo, { P2: true, P3: false, P4: false, P5: false, P6: false });
  assert.equal(v.blockers.length, 1);
  assert.match(v.blockers[0], /信息收集未完成 4\/12/);
  assert.match(v.label, /^P2（信息收集/, "P2 的标签应变成「信息收集」（六阶段口径）");
  assert.equal(covAssets.length, 12, "夹具应是 12 条（实际 id：" + covAssets.map((a) => a.id).join(",") + "）");
  assert.deepEqual(v.warnings.filter((w) => !/缺 stages/.test(w)), [], "除「后端没给 stages」外不应有口径提示");
  assert.equal(v.stageMissing, true, "这份 payload 没给 stages，面板要标出来（并兜底渲染）");
  // 缺口清单最多 20 条（后端只给 20，前端再兜一层）
  assert.equal(coverageGaps(covGapAssets, COVERAGE_GAP_LIMIT).length, 8, "4 个资产（各浅测+深测缺口）= 8 条");
  assert.equal(coverageGaps(covAssets, 3).length, 3, "limit 必须生效");
  assert.equal(findAssetByValue(covAssets, "/api/gap/0", "endpoint").id, "a100", "缺口能定位到资产");
});

await ok("缺 coverage / 空 assets / 字段残缺时都不抛错（面板仍能渲染）", () => {
  const empties = [
    coverageView({ coverage: null, assets: [] }),
    coverageView({ coverage: {}, assets: [] }),
    coverageView({}),
    coverageView(null),
    coverageView(undefined),
    coverageView({ coverage: { counts: null, pct: null, byKind: null, blockers: null, canAdvanceTo: null, gaps: null }, assets: null }),
  ];
  for (const v of empties) {
    assert.equal(v.counts.assets, 0);
    assert.equal(v.counts.gaps, 0);
    assert.equal(v.gaps.length, 0);
    assert.equal(v.canAdvance, false, "缺数据时「可推进」必须判否，宁严勿松");
    assert.equal(v.pct.shallow, 100, "无资产 = 没什么可测，覆盖率按 100%（与后端 pct 口径一致）");
    assert.deepEqual(v.byKind, []);
  }
  // 后端 counts 缺字段 → 按资产清单就地重算，并给出提示
  const v = coverageView({ coverage: { phase: "P1", blockers: {}, canAdvanceTo: {} }, assets: covAssets });
  assert.equal(v.counts.assets, 12);
  assert.equal(v.counts.shallowDone, 8, "清单里 done/na 共 8 个");
  assert.equal(v.counts.deepTargets, 10, "priority ≥ 3 共 10 个");
  assert.equal(v.counts.deepDone, 4, "其中 s3 done/na 共 4 个");
  assert.equal(v.pct.deep, 40);
  assert.ok(v.warnings.length >= 1, "口径不一致应有提示");
  assert.equal(coverageGaps(null, 20).length, 0);
});

// 六阶段契约的 payload：六张矩阵 + untested / reviews 齐备（后端真实形状）
const stagePayload = {
  ok: true,
  coverage: Object.assign({}, covPayload.coverage, {
    phase: "P3",
    phaseLabel: "浅层（核实信息收集 + 浅层测试）",
    counts: Object.assign({}, covPayload.coverage.counts, { gaps: 8 }),
    stages: {
      info: { required: 12, done: 9, pct: 75, gaps: [{ assetId: "a002", asset: "api.example", key: "cert" }] },
      verifyInfo: { required: 12, done: 3, pct: 25, gaps: [{ assetId: "a002", asset: "api.example", key: "dns" }] },
      shallow: { required: 8, done: 2, pct: 25, gaps: [{ assetId: "a002", asset: "api.example", key: "lowFuzz" }] },
      verifyShallow: { required: 8, done: 0, pct: 0, gaps: [{ assetId: "a002", asset: "api.example", key: "fp" }] },
      owasp: { required: 10, done: 0, pct: 0, gaps: [{ assetId: "a002", asset: "api.example", key: "A01" }] },
      deep: { required: 8, done: 0, pct: 0, gaps: [{ assetId: "a005", asset: "10.0.0.11:8443", key: "inj" }] },
    },
    untested: { declared: true, items: [{ id: "u001", surface: "小程序 wxapkg", why: "模拟器未装微信", stage: "P3" }] },
    reviews: { vuln: 3, reviewed: 1, pending: 2 },
    canAdvanceTo: { P2: true, P3: false, P4: false, P5: false, P6: false },
  }),
  assets: covAssets,
};

await ok("八条泳道：起点 → 信息收集 → 浅层 → 中间层 → 深层 →（线索 / 死点）→ 成果；六阶段完成度仍按 P1–P6", () => {
  const v = coverageView(stagePayload);
  assert.deepEqual(v.lanes.map((l) => l.label), ["起点", "信息收集", "浅层", "中间层", "深层", "线索", "死点", "成果"]);
  // 线索 / 死点不是阶段：完成度表里不列，六条阶段行仍按 P1–P6 编号（与作业法一致）
  assert.deepEqual(v.phaseRows.map((r) => r.label), ["起点", "信息收集", "浅层", "中间层", "深层", "成果"]);
  assert.deepEqual(v.phaseRows.map((r) => r.id), ["P1", "P2", "P3", "P4", "P5", "P6"]);
  const [p1, p2, p3, p4, p5, p6] = v.phaseRows;
  assert.equal(p1.done, 12, "起点 = 资产收集（计数来自 counts.assets）");
  assert.equal(p2.pct, 75, "信息收集 = info 9/12");
  assert.match(p2.text, /9\/12/);
  assert.equal(p3.done, 5, "浅层 = 核实信息收集 3 + 浅层测试 2");
  assert.equal(p3.required, 20, "浅层分母 = 核实 12 + 浅层测试 8");
  assert.equal(p4.done, 0, "中间层 = 核实浅层 0 + OWASP 0");
  assert.equal(p4.required, 18, "中间层分母 = 8 + 10");
  assert.equal(p5.pct, 0, "深层 = 0");
  assert.equal(v.stages.verifyInfo.gaps[0].key, "dns", "缺口要能点到具体检查项");
  assert.equal(v.stages.shallow.gaps[0].key, "lowFuzz");
  assert.equal(v.stages.owasp.gaps[0].key, "A01");
  assert.equal(v.untested.declared, true);
  assert.equal(v.untested.items.length, 1);
});

await ok("适应窗口：全屏后按新容器重算缩放，图要铺满（不会停在旧小窗口的比例上留一大片空底色）", () => {
  const l = computeLayout(graph, laneCov, laneAssets);
  const small = fitZoom(l.width, l.height, 1100, 420);   // 普通分栏里的画布
  const full = fitZoom(l.width, l.height, 1900, 940);    // 全屏后的画布
  assert.ok(full >= small, `全屏容器更大，缩放不该更小（小窗 ${small} → 全屏 ${full}）`);
  // 铺满判据：缩放后至少有一个方向顶到容器（≥95%），否则就是"图缩在角落 + 一大片空底色"
  const cover = Math.max((l.width * full) / 1900, (l.height * full) / 940);
  assert.ok(cover > 0.95, `全屏后图只铺了 ${(cover * 100).toFixed(0)}%，会留大片空底色`);
  assert.equal(fitZoom(l.width, l.height, 0, 0), 1, "拿不到容器尺寸时退回 100%（不能返回 0/NaN）");
  assert.equal(fitZoom(0, 0, 900, 600), 1.6, "空图给上限 1.6（不要放大到离谱）");
  // 下限 0.05：资产上百个的图（两万像素宽）也要真能压到装下，否则永远留一片空底色
  assert.ok(fitZoom(20000, 20000, 1900, 940) >= 0.05, "超大图也必须能压缩到装下（下限 0.05）");
  assert.ok(fitZoom(26000, 700, 1590, 900) < 0.12, "两万五千像素宽的口袋阵必须能压到 0.12 以下");
});

// 全屏的"量错容器"是真事故：进全屏那一刻 React 还没重渲染，量到的是旧小窗口 → 缩放按小窗算
// → 全屏后图缩在左上角、其余是一大片空底色。修复靠"进全屏后补算几次"，这里把机制钉住。
await ok("全屏补算缩放：bundle 里必须有 fitRef 延迟重算 + resize 监听（防量到旧容器）", () => {
  const code = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.match(code, /fitRef\.current = fitView/, "fitView 必须存进 ref（延迟调用时用最新 layout）");
  assert.match(code, /fitRef\.current\)\s*fitRef\.current\(\)/, "进全屏后必须补算缩放");
  assert.match(code, /addEventListener\("resize", refit\)/, "全屏期间要跟 resize 重算");
});

await ok("缺 stages / untested / reviews（或为 null）时仍给全八条泳道且不抛错", () => {
  const cases = [
    coverageView({ coverage: { phase: "P2", counts: covPayload.coverage.counts }, assets: covAssets }),
    coverageView({ coverage: { phase: "P2", stages: null, untested: null, reviews: null }, assets: covAssets }),
    coverageView({ coverage: { phase: "P2", stages: { info: null, verifyInfo: null, shallow: null, verifyShallow: null, owasp: null, deep: null } }, assets: null }),
    coverageView(null),
  ];
  for (const v of cases) {
    assert.equal(v.lanes.length, 8, "八条泳道必须始终存在");
    assert.equal(v.phaseRows.length, 6, "六阶段完成度只列阶段（线索/死点不算）");
    assert.equal(v.untested.items.length, 0);
    assert.equal(v.untested.declared, false, "没声明就是没声明");
    assert.equal(v.reviews.vuln, 0);
    assert.equal(v.reviews.pending, 0);
    assert.equal(v.phaseRows[0].label, "起点", "起点泳道永远在第一行");
    assert.ok(v.stages.info && typeof v.stages.info === "object", "stages.info 必须是对象");
    for (const k of ["info", "verifyInfo", "shallow", "verifyShallow", "owasp", "deep"]) {
      assert.ok(v.stages[k] && Array.isArray(v.stages[k].gaps), `stages.${k}.gaps 必须是数组`);
      assert.equal(typeof v.stages[k].pct, "number");
    }
  }
  // 资产的 checks/checkSummary 缺失时，泳道完成度退回资产清单口径
  const bare = coverageView({ coverage: { phase: "P1" }, assets: covAssets });
  assert.equal(bare.stageMissing, true);
  assert.match(bare.warnings.join("|"), /缺 stages/, "应提示后端没给 stages");
  assert.equal(bare.phaseRows[1].done, 0, "没有 checks 时信息收集完成度按 0（不能凭空算满）");
  const l = computeLayout(graph, { counts: { assets: 2 } }, covAssets);
  assert.equal(l.lanes.length, 8);
  const deadLane = l.lanes.find((x) => x.key === "dead");
  assert.ok(l.nodes.filter((n) => n.row === deadLane.row).length >= 1, "死点进泳道");
});

console.log("客户端 bundle 契约（vm 装载，与 DSH Web 同款 loader）");

const pkgJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const bundleCode = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

await ok("三个分栏标签都在：实时情况 / 任务汇总 / 覆盖矩阵（组件内第三个 tab，不是新槽位）", () => {
  const info = loadPanelBundle({ code: bundleCode, pkgName: pkgJson.name });
  const comp = (info.slots.find((s) => s.name === "conversation.view") || {}).component;
  assert.equal(typeof comp, "function");
  // 浅渲染首帧（graph 还没到）也必须渲染出三个 tab —— 覆盖矩阵是组件内部的分栏
  const texts = new Set();
  // 假 React 的元素形状与真 React 不同（children 可能挂在 props.children 或 props.props.children），
  // 这里只做「把整棵树里所有字符串/数字都收上来」的脏活，不依赖元素形状
  const seen = new Set();
  const walk = (n) => {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") { texts.add(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === "object") {
      if (seen.has(n)) return;
      seen.add(n);
      for (const v of Object.values(n)) {
        if (v && (typeof v === "object" || typeof v === "string")) walk(v);
      }
    }
  };
  const el = comp({});
  assert.ok(el && el.type, "首帧应返回 React 元素");
  // 槽位组件是薄包装（h(ConsolePanel, props)），再往下走一层拿到真正渲染出的树
  const inner = el.type && typeof el.type === "function" ? el.type(el.props && el.props.props ? el.props.props : (el.props || {})) : el;
  walk(inner);
  const all = [...texts];
  assert.ok(all.length > 0, "浅渲染应产出文本节点");
  for (const label of ["实时情况", "任务汇总", "覆盖矩阵"]) {
    assert.ok(all.includes(label), `缺少分栏标签「${label}」（实际：${all.join(" | ").slice(0, 200)}）`);
  }
  assert.equal(info.slots.length, 1, "新分栏不得新增槽位");
  assert.equal(info.slots[0].id, "vore-console");
});

await ok("lib/client.js 是 classic bundle：load({id, factory}) + 注册 conversation.view / 作战面板", () => {
  assert.match(bundleCode, /window\.__ModuleLoader__\.load\(\{ id: "@dsh-external\/vore-console"/);
  const info = loadPanelBundle({ code: bundleCode, pkgName: pkgJson.name, expectSlot: "conversation.view", expectLabel: "作战面板" });
  assert.equal(info.bundleId, pkgJson.name);
  assert.equal(info.moduleName, "vore-console-client");
  assert.equal(info.slots[0].id, "vore-console");
  assert.ok(info.effects >= 1, "应注册样式 effect");
});

await ok("bundle 只 require 平台 seed 词（react），不 import 项目内文件", () => {
  const info = loadPanelBundle({ code: bundleCode, pkgName: pkgJson.name });
  assert.deepEqual(info.seedRequires, ["react"]);
  assert.ok(!/^\s*import\s/m.test(bundleCode), "bundle 不应含 ESM import");
  assert.ok(bundleCode.includes("computeLayout"), "纯函数应已内联进 bundle");
});

await ok("package.json 的 ./client 指向 lib/client.js，且构建物与源一致（可 --check）", () => {
  assert.equal(pkgJson.exports["./client"], "./lib/client.js");
  assert.ok(fs.existsSync(new URL("../lib/client.js", import.meta.url)));
  assert.ok(fs.existsSync(new URL("../lib/panel.js", import.meta.url)), "panel.js 源文件应在");
  assert.ok(!fs.existsSync(new URL("../lib/client.mjs", import.meta.url)), "被取代的 client.mjs 应已删除");
});

console.log(`\n全部通过：${passed} 项`);
