// 内置技能**完整性核对**：把 vendor/skills/ 与源库逐文件比对（文件集合 + 内容哈希）。
// 结论只有三种：缺失 / 多余 / 内容不一致 —— 任何一条都说明"内置"不完整。
//
// 用法（需要源库仍在原处）：
//   node --no-warnings tests/vendor-integrity.mjs
// 源库位置读 deploy/vendor-sources.local.json（不随仓库发布）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([".git", ".DS_Store", "__pycache__", "node_modules", ".gitkeep", ".gitignore", ".gitattributes"]);
const LOCAL = path.join(ROOT, "deploy", "vendor-sources.local.json");

if (!fs.existsSync(LOCAL)) {
  console.log("（找不到 deploy/vendor-sources.local.json —— 跳过与源库比对；仓库内自洽性检查仍会执行）");
}
const SRC = fs.existsSync(LOCAL) ? JSON.parse(fs.readFileSync(LOCAL, "utf8")) : {};

function relFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) relFiles(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out.sort();
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const hasFrontmatter = (f) => { try { return /^---\r?\n[\s\S]*?\r?\n---/.test(fs.readFileSync(f, "utf8")); } catch { return false; } };
const oneLevel = (root) => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, "SKILL.md"))).map((e) => e.name)
  : [];
const twoLevel = (root) => {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const cat of fs.readdirSync(root, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const n of oneLevel(path.join(root, cat.name))) out.push({ name: n, dir: path.join(root, cat.name, n) });
  }
  return out;
};

let problems = 0;
function report(label, missing, extra, changed, total) {
  const ok = missing.length === 0 && extra.length === 0 && changed.length === 0;
  console.log(`  ${ok ? "✓" : "✗"} ${label}：比对 ${total} 个文件` +
    (ok ? "，与源库逐字节一致" : `\n      缺 ${missing.length}｜多 ${extra.length}｜内容不一致 ${changed.length}`));
  for (const m of missing.slice(0, 5)) console.log(`        缺：${m}`);
  for (const m of extra.slice(0, 5)) console.log(`        多：${m}`);
  for (const m of changed.slice(0, 5)) console.log(`        变：${m}`);
  if (!ok) problems++;
}

console.log("内置技能完整性（vendor/skills ↔ 源库）");

// 1) claude-red（只内置带 frontmatter 的，其余由 claude-red-legacy 承接）
if (SRC.claudeRed) {
  const src = twoLevel(path.join(SRC.claudeRed, "Skills"));
  const withFm = src.filter((s) => hasFrontmatter(path.join(s.dir, "SKILL.md")));
  const dest = path.join(ROOT, "vendor", "skills", "claude-red");
  const want = new Map();
  for (const s of withFm) for (const rel of relFiles(s.dir)) want.set(path.join(s.name, rel), path.join(s.dir, rel));
  compare("claude-red（50 个带 frontmatter 的技能）", want, dest);

  // legacy：生成物必须等于"合成 frontmatter + 原文正文"
  const destLegacy = path.join(ROOT, "vendor", "skills", "claude-red-legacy");
  const legacySrc = src.filter((s) => !hasFrontmatter(path.join(s.dir, "SKILL.md")));
  const badLegacy = [];
  for (const s of legacySrc) {
    const f = path.join(destLegacy, `${s.name}.md`);
    if (!fs.existsSync(f)) { badLegacy.push(`${s.name}.md 缺失`); continue; }
    const body = fs.readFileSync(path.join(s.dir, "SKILL.md"), "utf8");
    const gen = fs.readFileSync(f, "utf8");
    if (!gen.includes(body.replace(/^\uFEFF/, ""))) badLegacy.push(`${s.name}.md 正文与源不一致`);
    if (!/^---\r?\n name: |^---\nname: /.test(gen)) badLegacy.push(`${s.name}.md 缺 frontmatter`);
  }
  console.log(`  ${badLegacy.length === 0 ? "✓" : "✗"} claude-red-legacy：${legacySrc.length} 个规范化副本（正文须与源 SKILL.md 逐字一致）`);
  badLegacy.slice(0, 5).forEach((b) => console.log(`        ${b}`));
  if (badLegacy.length) problems++;
} else console.log("  · 跳过 claude-red（无源库配置）");

// 2) reverse-skill
if (SRC.reverseSkill) {
  const root = path.join(SRC.reverseSkill, "skills");
  const want = new Map();
  for (const n of oneLevel(root)) for (const rel of relFiles(path.join(root, n))) want.set(path.join(n, rel), path.join(root, n, rel));
  compare("reverse-skill（43 个技能）", want, path.join(ROOT, "vendor", "skills", "reverse-skill"));
} else console.log("  · 跳过 reverse-skill（无源库配置）");

// 3) anthropic（按选取清单）
if (SRC.anthropic) {
  const root = path.join(SRC.anthropic, "skills");
  const selFile = path.join(ROOT, "vendor", "anthropic.selection.txt");
  const sel = fs.readFileSync(selFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const want = new Map();
  let present = 0;
  for (const n of sel) {
    const dir = path.join(root, n);
    if (!fs.existsSync(path.join(dir, "SKILL.md"))) continue;
    present++;
    for (const rel of relFiles(dir)) want.set(path.join(n, rel), path.join(dir, rel));
  }
  console.log(`  · 选取清单 ${sel.length} 条，源库命中 ${present} 个技能`);
  compare("anthropic（受控选取）", want, path.join(ROOT, "vendor", "skills", "anthropic"));
} else console.log("  · 跳过 anthropic（无源库配置）");

// 4) clown bundle
if (SRC.clown) {
  const src = path.join(SRC.clown, "skills", "skill");
  if (fs.existsSync(path.join(src, "SKILL.md"))) {
    const want = new Map();
    for (const rel of relFiles(src)) want.set(path.join("clown-src-skill", rel), path.join(src, rel));
    compare("clown（1 个技能包）", want, path.join(ROOT, "vendor", "skills", "clown"));
  } else console.log("  · clown 源目录结构变化，跳过");
} else console.log("  · 跳过 clown（无源库配置）");

// 5) 仓库内自洽：注册表 246 条 path 全部存在 + 每个技能根的一层结构可装载
{
  const reg = fs.readFileSync(path.join(ROOT, "skills", "registry.yaml"), "utf8");
  const paths = [...reg.matchAll(/^\s+path:\s*'([^']+)'/gm)].map((m) => m[1]);
  const bad = paths.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  console.log(`  ${bad.length === 0 ? "✓" : "✗"} 注册表 ${paths.length} 条 path 全部存在（仓库相对）`);
  if (bad.length) { problems++; bad.slice(0, 5).forEach((b) => console.log(`        缺：${b}`)); }

  const roots = ["skills", "vendor/skills/claude-red", "vendor/skills/claude-red-legacy", "vendor/skills/reverse-skill", "vendor/skills/anthropic", "vendor/skills/clown"];
  let loadable = 0;
  for (const r of roots) {
    const dir = path.join(ROOT, r);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md"))) loadable++;
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        const t = fs.readFileSync(path.join(dir, e.name), "utf8");
        if (/^---\r?\n[\s\S]*?\r?\n---/.test(t) && /^name:/m.test(t) && /^description:/m.test(t)) loadable++;
      }
    }
  }
  console.log(`  ✓ 装载面 ${loadable} 个（一层 bundle + 带 frontmatter 的扁平 md）`);
}

console.log(`\n结果：${problems === 0 ? "完整（与源库逐字节一致）" : `${problems} 项不一致`}`);
process.exit(problems ? 1 : 0);

function compare(label, want, destRoot) {
  const have = new Map();
  for (const rel of relFiles(destRoot)) have.set(rel, path.join(destRoot, rel));
  const missing = [], changed = [];
  for (const [rel, srcFile] of want) {
    const destFile = have.get(rel);
    if (!destFile) { missing.push(rel); continue; }
    if (sha(srcFile) !== sha(destFile)) changed.push(rel);
  }
  const extra = [...have.keys()].filter((rel) => !want.has(rel));
  report(label, missing, extra, changed, want.size);
}
