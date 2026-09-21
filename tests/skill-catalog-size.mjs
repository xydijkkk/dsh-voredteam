// 度量「技能目录」体积：宿主把每个可装载技能的 name + 截断后的 description 渲染进每轮 system prompt。
// 默认按 preset 里 dsh-tool-skill 的 catalogDescriptionMaxLength=200 计算（改 preset 记得同步这里）。
// 用法: node tests/skill-catalog-size.mjs [--cap 200] [--list]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const capIdx = argv.indexOf("--cap");
const CAP = capIdx >= 0 ? Number(argv[capIdx + 1]) : 200;
const LIST = argv.includes("--list");

const ROOTS = [
  ["voredteam 自研", path.join(REPO_ROOT, "skills")],
  ["vendor: claude-red", path.join(REPO_ROOT, "vendor", "skills", "claude-red")],
  ["vendor: claude-red-legacy", path.join(REPO_ROOT, "vendor", "skills", "claude-red-legacy")],
  ["vendor: reverse-skill", path.join(REPO_ROOT, "vendor", "skills", "reverse-skill")],
  ["vendor: anthropic(受控)", path.join(REPO_ROOT, "vendor", "skills", "anthropic")],
  ["vendor: clown-src-skill", path.join(REPO_ROOT, "vendor", "skills", "clown")],
];

function fm(file) {
  let t; try { t = readFileSync(file, "utf8"); } catch { return null; }
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (m[1].match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z-]+:|\s*$)/m) || [])[1];
  if (!name || !desc) return null;
  return { name: name.trim().replace(/^['"]|['"]$/g, ""), desc: desc.trim().replace(/\s+/g, " ") };
}

let total = 0, count = 0;
for (const [label, root] of ROOTS) {
  if (!existsSync(root)) { console.log(`[缺失] ${label}  ${root}`); continue; }
  let bytes = 0, n = 0;
  for (const e of readdirSync(root)) {
    const sm = join(root, e, "SKILL.md");
    const flat = e.toLowerCase().endsWith(".md") ? join(root, e) : null;
    let r = null, label = e;
    if (existsSync(sm)) r = fm(sm);
    else if (flat && existsSync(flat)) { r = fm(flat); label = e.replace(/\.md$/i, ""); }
    else continue;
    if (!r) { console.log(`  ⚠ ${label}: frontmatter 缺 name/description（宿主会跳过）`); continue; }
    bytes += Buffer.byteLength(`- ${r.name}: ${r.desc.slice(0, CAP)}`, "utf8") + 1;
    n++;
    if (LIST) console.log(`  ${label}/${r.name} | ${r.desc.slice(0, 80)}`);
  }
  total += bytes; count += n;
  console.log(`${label.padEnd(22)} ${String(n).padStart(4)} 个   目录体积 ≈ ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`\n装载面合计：${count} 个技能，系统提示技能目录 ≈ ${(total / 1024).toFixed(1)} KB ≈ ${(total / 3.5 / 1000).toFixed(1)}k tokens（按 3.5 字节/token 粗估，description 截断 ${CAP} 字）`);
console.log(`提示：调小 preset 里 dsh-tool-skill 的 catalogDescriptionMaxLength 可线性压缩这个数字。`);
