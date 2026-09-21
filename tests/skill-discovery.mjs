// 按宿主 dsh-skill-filesystem 的真实发现规则（**一层深度**）盘点每个技能根实际可加载的技能数。
// 规则：<root>/<name>/SKILL.md  或  <root>/<name>.md（frontmatter 必须有 name + description，kebab-case）
// 用法: node tests/skill-discovery.mjs
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROOTS = [
  ["project-dsh(项目根)", path.join(REPO_ROOT, ".dsh", "skills")],
  ["project-agents", path.join(REPO_ROOT, ".agents", "skills")],
  ["custom[0] dsh-voredteam 自研", path.join(REPO_ROOT, "skills")],
  ["custom[1] vendor: claude-red", path.join(REPO_ROOT, "vendor", "skills", "claude-red")],
  ["custom[2] vendor: claude-red-legacy(规范化扁平)", path.join(REPO_ROOT, "vendor", "skills", "claude-red-legacy")],
  ["custom[3] vendor: reverse-skill", path.join(REPO_ROOT, "vendor", "skills", "reverse-skill")],
  ["custom[4] vendor: anthropic(受控选取)", path.join(REPO_ROOT, "vendor", "skills", "anthropic")],
  ["custom[5] vendor: clown-src-skill", path.join(REPO_ROOT, "vendor", "skills", "clown")],
  ["user-dsh", path.join(homedir(), ".dsh", "skills")],
  ["user-agents", path.join(homedir(), ".agents", "skills")],
];

function frontmatter(file) {
  let t; try { t = readFileSync(file, "utf8"); } catch { return null; }
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: null, desc: null };
  const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
  return { name: name ? name.trim().replace(/^['"]|['"]$/g, "") : null, desc: desc ? desc.trim().slice(0, 40) : null };
}

for (const [label, root] of ROOTS) {
  if (!existsSync(root)) { console.log(`\n[缺失] ${label}  ${root}`); continue; }
  const entries = readdirSync(root, { withFileTypes: true });
  const dirs = [], flats = [];
  for (const e of entries) {
    // 用 stat（跟随联接）判断：目录联接在 Dirent 里是 symlink，不看 isDirectory 会漏掉整个农场
    let isDir = e.isDirectory(), isFile = e.isFile();
    try { const st = statSync(join(root, e.name)); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
    if (isDir && existsSync(join(root, e.name, "SKILL.md"))) dirs.push(e.name);
    else if (isFile && e.name.toLowerCase().endsWith(".md")) flats.push(e.name);
  }
  const validFlat = [], invalidFlat = [];
  for (const f of flats) {
    const fm = frontmatter(join(root, f));
    if (fm && fm.name && fm.desc) validFlat.push(`${f.replace(/\.md$/, "")} [name=${fm.name}]`);
    else invalidFlat.push(f);
  }
  const total = dirs.length + validFlat.length;
  console.log(`\n${label}`);
  console.log(`  root: ${root}`);
  console.log(`  可加载: ${total} 个  =  目录 bundle ${dirs.length} + 扁平 .md(带 frontmatter) ${validFlat.length}`);
  if (dirs.length) console.log(`    目录: ${dirs.slice(0, 12).join(", ")}${dirs.length > 12 ? ` …共${dirs.length}` : ""}`);
  if (validFlat.length) console.log(`    扁平: ${validFlat.slice(0, 12).join(", ")}${validFlat.length > 12 ? ` …共${validFlat.length}` : ""}`);
  if (invalidFlat.length) console.log(`    跳过(无 frontmatter name/description): ${invalidFlat.slice(0, 8).join(", ")}${invalidFlat.length > 8 ? ` …共${invalidFlat.length}` : ""}`);
  // 递归总数对照
  let deep = 0;
  (function walk(d, depth) {
    if (depth > 3) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), depth + 1);
      else if (e.name.toLowerCase() === "skill.md") deep++;
    }
  })(root, 1);
  console.log(`    对照：根下递归(≤3 层)的 SKILL.md 共 ${deep} 个（一层规则下多数扫不到）`);
}
