// 校验 skill 是否符合宿主 dsh-skill-filesystem 的**一层**发现规则：
//   <root>/<name>/SKILL.md，frontmatter 必须有 kebab-case 的 name + description（否则不装载）
// 与仓库里 tests/skill-discovery.mjs 用的是同一套判定，这里只针对新建的 voskill 根。
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? path.join(process.env.USERPROFILE, "Desktop", "sentou", "voskill");
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function frontmatter(file) {
  const t = fs.readFileSync(file, "utf8");
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { ok: false, why: "缺 frontmatter（--- 包起来的头部）" };
  const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
  const nameV = name ? name.trim().replace(/^['"]|['"]$/g, "") : null;
  const descV = desc ? desc.trim().replace(/^['"]|['"]$/g, "") : null;
  if (!nameV) return { ok: false, why: "frontmatter 缺 name" };
  if (!KEBAB.test(nameV)) return { ok: false, why: `name 不是 kebab-case：${nameV}` };
  if (!descV) return { ok: false, why: "frontmatter 缺 description" };
  return { ok: true, name: nameV, desc: descV, bodyLines: t.split("\n").length };
}

console.log(`技能根：${root}`);
if (!fs.existsSync(root)) { console.error("根不存在"); process.exit(2); }
const entries = fs.readdirSync(root, { withFileTypes: true });
let loaded = 0;
for (const e of entries) {
  if (!e.isDirectory()) { console.log(`  · ${e.name}（不是目录，宿主跳过）`); continue; }
  const skillMd = path.join(root, e.name, "SKILL.md");
  if (!fs.existsSync(skillMd)) { console.log(`  ✗ ${e.name}：没有 SKILL.md（宿主一层规则要求 <root>/<name>/SKILL.md）`); process.exitCode = 1; continue; }
  const r = frontmatter(skillMd);
  if (!r.ok) { console.log(`  ✗ ${e.name}：${r.why}`); process.exitCode = 1; continue; }
  loaded++;
  console.log(`  ✓ ${e.name}  name=${r.name}  ${r.bodyLines} 行  description=${r.desc.length} 字（宿主目录里截断到 200 字）`);
  // 附带文件
  const sub = fs.readdirSync(path.join(root, e.name), { withFileTypes: true }).filter((x) => x.name !== "SKILL.md");
  for (const s of sub) {
    const p = path.join(root, e.name, s.name);
    const n = s.isDirectory() ? fs.readdirSync(p).length : 1;
    console.log(`      + ${s.name}${s.isDirectory() ? `（${n} 个文件：${fs.readdirSync(p).join(", ")}）` : ""}`);
  }
}
console.log(`\n一层规则下可装载：${loaded} 个技能`);
