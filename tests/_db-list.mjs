// 手动探针：列黑板上所有项目及其内容量（判断哪些是空壳/幽灵项目）。
import path from "node:path";
import { openStore } from "../plugins/vore-blackboard/lib/store.js";

const db = process.env.DSH_HOME
  ? path.join(process.env.DSH_HOME, "voredteam", "blackboard.db")
  : path.join(process.env.USERPROFILE, ".dsh", "voredteam", "blackboard.db");
const store = openStore(db);
const rows = store.listProjects();
console.log("db:", db);
console.log("项目数:", rows.length);
for (const p of rows) {
  const assets = store.listAssets(p.id, { limit: 5000 }).length;
  const empty = (p.fact_count ?? 0) === 0 && (p.intent_count ?? 0) === 0 && (p.hint_count ?? 0) === 0 && assets === 0;
  console.log(
    `  ${p.id}  session=${p.session_id ?? "-"}  facts=${p.fact_count} intents=${p.intent_count} hints=${p.hint_count} assets=${assets}` +
    `  ${empty ? "【空壳】" : ""}  title=${String(p.title).slice(0, 34)}`,
  );
}
