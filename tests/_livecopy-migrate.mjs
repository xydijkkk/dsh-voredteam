// 拿**线上库的副本**试迁移：不能拿真库冒风险。
// 拷一份 → openStore（触发迁移）→ 核对行数/内容/幽灵补行/能否建第三个项目。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../plugins/vore-blackboard/lib/store.js";

const live = path.join(os.homedir(), ".dsh", "voredteam", "blackboard.db");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-livecopy-"));
const copy = path.join(dir, "copy.db");
fs.copyFileSync(live, copy);
for (const ext of ["-wal", "-shm"]) {
  if (fs.existsSync(live + ext)) fs.copyFileSync(live + ext, copy + ext);
}

const before = new DatabaseSync(copy, { readOnly: false });
const b = {
  projects: before.prepare("SELECT COUNT(*) c FROM projects").get().c,
  facts: before.prepare("SELECT COUNT(*) c FROM facts").get().c,
  intents: before.prepare("SELECT COUNT(*) c FROM intents").get().c,
  hints: before.prepare("SELECT COUNT(*) c FROM hints").get().c,
  assets: before.prepare("SELECT COUNT(*) c FROM assets").get().c,
  perProject: before.prepare("SELECT project_id, COUNT(*) c FROM facts GROUP BY project_id").all().map((r) => `${r.project_id}:${r.c}`).join(" "),
};
before.close();

const store = openStore(copy);
const after = {
  projects: store.listProjects().length,
  facts: store.db.prepare("SELECT COUNT(*) c FROM facts").get().c,
  intents: store.db.prepare("SELECT COUNT(*) c FROM intents").get().c,
  hints: store.db.prepare("SELECT COUNT(*) c FROM hints").get().c,
  assets: store.db.prepare("SELECT COUNT(*) c FROM assets").get().c,
  perProject: store.db.prepare("SELECT project_id, COUNT(*) c FROM facts GROUP BY project_id").all().map((r) => `${r.project_id}:${r.c}`).join(" "),
};
console.log("迁移前:", JSON.stringify(b));
console.log("迁移后:", JSON.stringify(after));
const pk = store.db.prepare("SELECT sql FROM sqlite_master WHERE name='facts'").get().sql.match(/PRIMARY KEY[^,)]*/)?.[0];
console.log("facts 主键:", pk);
const g1 = store.graph("eng_001");
console.log("eng_001 图:", g1.facts.length, "facts /", g1.intents.length, "intents；第一条:", g1.facts[2]?.id, g1.facts[2]?.description?.slice(0, 40));
const g2 = store.graph("eng_002");
console.log("eng_002 图:", g2.facts.map((f) => f.id).join(","), "|", g2.facts.map((f) => f.description.slice(0, 24)).join(" / "));
const p3 = store.createProject({ sessionId: "sess-check", cwd: "C:/check", origin: "https://check.example", goal: "核对迁移" });
console.log("新建第三项目:", p3.id, "→ facts", store.graph(p3.id).facts.map((f) => f.id).join(","));
console.log("老项目总数核对:", store.listProjects().map((p) => `${p.id}(facts=${p.fact_count})`).join(" "));
const f = store.addFact(p3.id, { description: "迁移后新增事实" });
console.log("第三项目写事实:", f.id);
store.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
