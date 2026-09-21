// 把 skills/registry.yaml 的 500 条登记，逐条对照宿主"一层深度"发现规则，算出真正可装载的条数。
// 用法: node tests/skill-registry-vs-loadable.mjs
import { readFileSync, existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REG = path.join(REPO_ROOT, "skills", "registry.yaml");
const text = readFileSync(REG, "utf8").split(/\r?\n/);

// 极简 YAML 行走：只取 - id: 起的块，读 path / kind / name
const rows = [];
let cur = null;
for (const line of text) {
  const idm = line.match(/^\s{2}-\s+id:\s*(.+)$/);
  if (idm) { if (cur) rows.push(cur); cur = { id: idm[1].trim().replace(/^['"]|['"]$/g, "") }; continue; }
  if (!cur) continue;
  const pm = line.match(/^\s+path:\s*(.+)$/);
  if (pm) cur.path = pm[1].trim().replace(/^['"]|['"]$/g, "");
  const km = line.match(/^\s+kind:\s*(.+)$/);
  if (km) cur.kind = km[1].trim().replace(/^['"]|['"]$/g, "");
}
if (cur) rows.push(cur);

const ROOTS = [
  path.join(REPO_ROOT, "skills"),
  "D:\\everything\\clown-src-6k-skill\\skills",
  "D:\\everything\\app\\Anthropic-Cybersecurity-Skills-1.3.0",
  "D:\\everything\\app\\reverse-skill-main",
];
const CORRECTED = [
  "D:\\everything\\app\\Anthropic-Cybersecurity-Skills-1.3.0\\skills",
  "D:\\everything\\app\\reverse-skill-main\\skills",
];

const kind = {};
let withPath = 0, missing = 0, isSkillMd = 0, oneLevelNow = 0, oneLevelFixed = 0;
const examples = { now: [], fixed: [] };

function oneLevelHit(p, roots) {
  const b = basename(p).toLowerCase();
  const d = dirname(p);
  for (const r of roots) {
    if (b === "skill.md" && dirname(d).toLowerCase() === r.toLowerCase()) return "dir-bundle";
    if (b !== "skill.md" && d.toLowerCase() === r.toLowerCase()) return "flat-md";
  }
  return null;
}

for (const r of rows) {
  kind[r.kind ?? "(无)"] = (kind[r.kind ?? "(无)"] ?? 0) + 1;
  if (!r.path) continue;
  withPath++;
  if (!existsSync(r.path)) missing++;
  const b = basename(r.path).toLowerCase();
  if (b === "skill.md") isSkillMd++;
  const a = oneLevelHit(r.path, ROOTS);
  if (a) { oneLevelNow++; examples.now.push(`${r.id} → ${a}`); }
  const c = oneLevelHit(r.path, CORRECTED);
  if (c) { oneLevelFixed++; examples.fixed.push(`${r.id} → ${c}`); }
}

console.log(`registry 条目: ${rows.length}`);
console.log(`kind 分布: ${JSON.stringify(kind)}`);
console.log(`带 path: ${withPath}   路径不存在: ${missing}`);
console.log(`path 以 SKILL.md 结尾: ${isSkillMd}`);
console.log(`\n按当前 customSkillDirs，一层规则能装载: ${oneLevelNow} 条`);
examples.now.slice(0, 10).forEach((e) => console.log("   " + e));
console.log(`\n若把两个根改指 skills\\ 子目录后能装载: ${oneLevelFixed} 条`);
examples.fixed.slice(0, 10).forEach((e) => console.log("   " + e));
