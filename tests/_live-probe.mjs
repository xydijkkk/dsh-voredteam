// 在线探针（手动跑，不进 npm test）：直接问运行中的 dsh web，核对面板取数路径。
// 用法：node --no-warnings tests/_live-probe.mjs [sessionId]
// 不带参数时自动从列表里挑"事实最多的项目"作为对照。
const BASE = process.env.VORE_PROBE_BASE ?? "http://127.0.0.1:3080/vore-blackboard";
const wantSession = process.argv[2] ?? null;

const csrf = await (await fetch(`${BASE}/csrf`)).json().then((j) => j.token);
const post = async (endpoint, payload = {}) => {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dsh-csrf": csrf },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json() };
};

const list = await post("list");
console.log(`[list] ${list.status} 项目 ${list.json.projects?.length ?? 0} 个`);
for (const p of list.json.projects ?? []) {
  console.log(`   ${p.id}  facts=${p.fact_count}  intents=${p.intent_count}  hints=${p.hint_count}  phase=${p.phase}  empty=${p.empty}  session=${p.session_id ?? "-"}`);
}

const bare = await post("graph", {});
const bareId = bare.json.graph?.project?.id ?? null;
console.log(`[graph 不带会话] ${bare.status} → ${bareId}  facts=${bare.json.graph?.facts?.length ?? 0}  intents=${bare.json.graph?.intents?.length ?? 0}`);

const session = wantSession ?? (list.json.projects ?? []).find((p) => (p.fact_count ?? 0) > 0)?.session_id ?? null;
if (session) {
  const scoped = await post("graph", { sessionId: session });
  const sid = scoped.json.graph?.project?.id ?? null;
  console.log(`[graph sessionId=${session.slice(0, 24)}…] ${scoped.status} → ${sid}  facts=${scoped.json.graph?.facts?.length ?? 0}`);
  const cov = await post("coverage", { sessionId: session });
  const c = cov.json.coverage;
  console.log(`[coverage 同会话] ${cov.status} → phase=${c?.phase ?? "-"}  assets=${cov.json.assets?.length ?? 0}`);
  if (c?.stages) {
    const s = c.stages;
    console.log(`   信息收集 ${s.info.pct}%（${s.info.done}/${s.info.required}）｜核实采集 ${s.verifyInfo.pct}%｜浅层测试 ${s.shallow.pct}%｜核实浅层 ${s.verifyShallow.pct}%｜OWASP ${s.owasp.pct}%｜深层 ${s.deep.pct}%`);
    console.log(`   未测面 declared=${c.untested?.declared} count=${c.untested?.count ?? 0}｜复核 ${c.reviews?.reviewed ?? 0}/${c.reviews?.vuln ?? 0}｜可推进 ${JSON.stringify(c.canAdvanceTo)}`);
    const gap = s.info.gaps?.[0];
    if (gap) console.log(`   信息收集缺口示例：${gap.assetId} ${gap.asset} 缺 ${gap.key}`);
  } else {
    console.log(`   （宿主仍是旧代码：没有 stages 字段 —— 需要重启 dsh web）counts=${JSON.stringify(c?.counts ?? null)}`);
  }
  const st = await post("status", { sessionId: session });
  console.log(`[status 同会话] ${st.status} → 项目 ${st.json.summary?.project?.id ?? "-"}  facts=${st.json.summary?.counts?.facts ?? "-"}  phase=${st.json.summary?.phase ?? "-"}`);
} else {
  console.log("[graph 带会话] 跳过：列表里没有带 session_id 的项目");
}

const ghosts = (list.json.projects ?? []).filter((p) => (p.fact_count ?? 0) === 0);
console.log(ghosts.length ? `注意：仍有 ${ghosts.length} 个空项目：${ghosts.map((p) => p.id).join(", ")}（面板不会再落到它们）` : "无空项目");
