// 线上验证（重启后）：一个会话一个项目 —— 本会话有黑板 / 没有黑板 / 显式点开历史项目 三种情形。
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:3080/vore-blackboard";
const get = async (ep) => (await fetch(`${BASE}${ep}`)).json();
const post = async (ep, body) => {
  const { token } = await get("/csrf");
  const r = await fetch(`${BASE}/${ep}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dsh-csrf": token },
    body: JSON.stringify(body ?? {}),
  });
  return r.json();
};

const pj = await post("projects", {});
console.log("=== /projects（不带会话 id）===");
for (const p of pj.projects) {
  console.log(`  ${p.id}  ${String(p.title).slice(0, 28).padEnd(30)} session=${p.sessionId}  ${p.phase}  资产 ${p.counts.assets} · 事实 ${p.counts.facts} · mine=${p.mine}`);
}
console.log("mineId（未带会话）:", pj.mineId);

const owner = pj.projects.find((p) => (p.counts.assets ?? 0) > 0) ?? pj.projects[0];
if (owner) {
  console.log(`\n=== 该项目的会话（${owner.sessionId}）打开面板 ===`);
  const pjMine = await post("projects", { sessionId: owner.sessionId });
  console.log("  mineId:", pjMine.mineId, "| 与项目一致:", pjMine.mineId === owner.id);
  const g = await post("graph", { sessionId: owner.sessionId });
  console.log("  graph:", g.graph ? g.graph.project.id + " / " + String(g.graph.project.title).slice(0, 20) : "null", "| scope:", JSON.stringify(g.scope));
}

console.log("\n=== 全新会话（从没建过黑板）===");
const fresh = "session-" + crypto.randomUUID();
const gNew = await post("graph", { sessionId: fresh });
console.log("  graph:", gNew.graph, "| scope:", JSON.stringify(gNew.scope));
const covNew = await post("coverage", { sessionId: fresh });
console.log("  coverage:", covNew.coverage, "| assets:", covNew.assets.length);
const pjNew = await post("projects", { sessionId: fresh });
console.log("  mineId:", pjNew.mineId, "（应为 null）| 历史项目仍可见:", pjNew.projects.length);

console.log("\n=== 全新会话显式点开历史项目（面板下拉的动作）===");
if (owner) {
  const gOpen = await post("graph", { projectId: owner.id, sessionId: fresh });
  console.log("  显式 projectId →", gOpen.graph ? gOpen.graph.project.id : "null", "| scope:", JSON.stringify(gOpen.scope));
}

console.log("\n=== 同 cwd 的另一个新会话（顶层不按工作目录借图）===");
const sameCwd = "session-" + crypto.randomUUID();
console.log("  只给 sessionId（cwd 由宿主侧决定，这里以 sessionId 为准）→",
  (await post("graph", { sessionId: sameCwd })).graph, "（应为 null）");
