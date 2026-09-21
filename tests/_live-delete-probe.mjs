import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const BASE = "http://127.0.0.1:3080/vore-blackboard";
const get = async (ep) => (await fetch(`${BASE}${ep}`)).json();
const post = async (ep, body) => {
  const { token } = await get("/csrf");
  const r = await fetch(`${BASE}/${ep}`, { method: "POST", headers: { "content-type": "application/json", "x-dsh-csrf": token }, body: JSON.stringify(body ?? {}) });
  return r.json();
};
const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE, ".dsh");
const dir = path.join(home, "voredteam");
const before = (await post("list", {})).projects;
console.log("删除前的项目：");
for (const p of before) console.log(`  ${p.id}  ${String(p.title).slice(0, 28)}  资产 ${p.counts.assets} · 事实 ${p.counts.facts}`);
const sess = "session-" + crypto.randomUUID();
const tmp = (await post("project.create", { sessionId: sess, cwd: "C:/tmp/del-probe", title: "临时：删除探针", origin: "https://del-probe.example", goal: "验证删除" })).project;
console.log("\n临时项目:", tmp.id);
await post("hint.add", { projectId: tmp.id, content: "探针提示" });
const del = await post("project.delete", { projectId: tmp.id });
console.log("删除回执 ok:", del.ok, "| 逐表条数:", JSON.stringify(del.deleted));
console.log("备份:", del.backupPath, "| 存在:", del.backupPath ? fs.existsSync(del.backupPath) : false);
const after = (await post("list", {})).projects;
console.log("\n删除后的项目：");
for (const p of after) console.log(`  ${p.id}  ${String(p.title).slice(0, 28)}  资产 ${p.counts.assets} · 事实 ${p.counts.facts}`);
console.log("临时项目还在吗：", after.some((p) => p.id === tmp.id));
const kept = before.filter((p) => p.id !== tmp.id).map((p) => p.id).sort().join(",");
const keptNow = after.map((p) => p.id).sort().join(",");
console.log("真实项目原封不动：", kept === keptNow, `（${kept} vs ${keptNow}）`);
console.log("再删一次：", JSON.stringify(await post("project.delete", { projectId: tmp.id })));
console.log("不给 projectId：", JSON.stringify(await post("project.delete", {})));
console.log("\n备份目录（最近三个）：");
for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("blackboard.backup-")).sort().slice(-3)) {
  console.log("  ", f, fs.statSync(path.join(dir, f)).size, "bytes");
}
