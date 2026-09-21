// 统计：内置技能正文里的命令行有多少条会被本项目唯一门禁拦截。
// 手法：只取 markdown 代码围栏里的行，逐行过 scanCommand（宁可多算，也要给出量级）。
import fs from "node:fs";
import path from "node:path";
import { scanCommand } from "../plugins/vore-guard/lib/index.js";

const ROOTS = ["claude-red", "claude-red-legacy", "reverse-skill", "anthropic", "clown"].map((r) => path.join("vendor", "skills", r));
const files = [];
for (const root of ROOTS) {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) files.push(p);
    }
  };
  if (fs.existsSync(root)) walk(root);
}

const hits = [];
let fences = 0, lines = 0;
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { inside = !inside; continue; }
    if (!inside) continue;
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    fences++; lines++;
    const hit = scanCommand(line);
    if (hit) hits.push({ file: f, line, kind: hit.reason.replace(/^唯一门禁·/, "").split("：")[0] });
  }
}

const byKind = {};
for (const h of hits) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
console.log(`扫描 ${files.length} 个技能文件，代码围栏内 ${lines} 行命令；判定会被拦 ${hits.length} 行`);
console.log("按门禁类别：", JSON.stringify(byKind, null, 0));
const byFile = {};
for (const h of hits) byFile[h.file] = (byFile[h.file] ?? 0) + 1;
console.log("\n命中最多的 10 个文件：");
for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}  ${f}`);
console.log("\n样例（每类各 3 条）：");
const seen = {};
for (const h of hits) {
  seen[h.kind] = seen[h.kind] ?? 0;
  if (seen[h.kind] <= 3) { console.log(`  [${h.kind}] ${h.line.slice(0, 110)}`); seen[h.kind]++; }
}
