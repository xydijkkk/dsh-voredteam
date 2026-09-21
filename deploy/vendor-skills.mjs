// 把外部技能库**内置进项目**（vendor）：复制真实文件到 vendor/skills/，不再用目录联接指向本机路径。
//
// 为什么要内置：项目要发布，出厂配置里不能出现盘符绝对路径；
// 而且宿主 `dsh-skill-filesystem` 只认一层目录（<root>/<name>/SKILL.md），外部库的两层结构必须摊平。
//
// 源库位置不写死在脚本里：从 `deploy/vendor-sources.local.json`（本地，不随仓库发布）或环境变量读取。
//   {
//     "claudeRed":   "<Claude-Red 库根目录>",
//     "reverseSkill": "<reverse-skill 库根目录>",
//     "anthropic":   "<Anthropic-Cybersecurity-Skills 库根目录>",
//     "clown":       "<clown-src-6k-skill 库根目录>",
//     "anthropicSelection": "vendor/anthropic.selection.txt"
//   }
// 示例文件：deploy/vendor-sources.example.json
//
// 用法：
//   node deploy/vendor-skills.mjs --check     # 只报告差异（默认）
//   node deploy/vendor-skills.mjs --apply     # 复制/刷新（幂等）
//   node deploy/vendor-skills.mjs --apply --prune   # 顺带删除源里已不存在的文件
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "vendor");
const SKILLS_OUT = path.join(OUT, "skills");
const LIC_OUT = path.join(OUT, "licenses");
const LOCAL_CFG = path.join(HERE, "vendor-sources.local.json");
const EXAMPLE_CFG = path.join(HERE, "vendor-sources.example.json");

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const PRUNE = args.has("--prune");

function loadSources() {
  if (fs.existsSync(LOCAL_CFG)) return JSON.parse(fs.readFileSync(LOCAL_CFG, "utf8"));
  const fromEnv = {
    claudeRed: process.env.VORE_SRC_CLAUDE_RED,
    reverseSkill: process.env.VORE_SRC_REVERSE_SKILL,
    anthropic: process.env.VORE_SRC_ANTHROPIC,
    clown: process.env.VORE_SRC_CLOWN,
  };
  if (Object.values(fromEnv).some(Boolean)) return fromEnv;
  console.error(`找不到源库配置。请二选一：\n  1) 复制 ${path.relative(ROOT, EXAMPLE_CFG)} 为 ${path.relative(ROOT, LOCAL_CFG)} 并填好路径\n  2) 设环境变量 VORE_SRC_CLAUDE_RED / VORE_SRC_REVERSE_SKILL / VORE_SRC_ANTHROPIC / VORE_SRC_CLOWN`);
  process.exit(2);
}

const SRC = loadSources();
const selectionFile = path.join(ROOT, SRC.anthropicSelection ?? "vendor/anthropic.selection.txt");

/** 递归列出相对文件。 */
function relFiles(dir, base = dir, skip = new Set([".git", ".DS_Store", "__pycache__", "node_modules", ".gitkeep", ".gitignore", ".gitattributes"])) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...relFiles(p, base, skip));
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

const hasFrontmatter = (file) => {
  try { return /^---\r?\n[\s\S]*?\r?\n---/.test(fs.readFileSync(file, "utf8")); } catch { return false; }
};

/** 一层 bundle：<root>/<name>/SKILL.md */
function oneLevel(srcRoot) {
  if (!fs.existsSync(srcRoot)) return [];
  return fs.readdirSync(srcRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(srcRoot, e.name, "SKILL.md")))
    .map((e) => ({ name: e.name, from: path.join(srcRoot, e.name) }));
}

/** 两层：<src>/<category>/<name>/SKILL.md → 摊平（重名时加类别后缀） */
function twoLevel(srcRoot) {
  const out = [], seen = new Map();
  if (!fs.existsSync(srcRoot)) return out;
  for (const cat of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const s of oneLevel(path.join(srcRoot, cat.name))) {
      let name = s.name;
      if (seen.has(name)) name = `${s.name}-${cat.name}`;
      seen.set(name, true);
      out.push({ name, from: s.from, category: cat.name });
    }
  }
  return out;
}

const plan = [];
const stats = [];

function addLib(lib, items, { licenseFrom, label, note }) {
  plan.push({ lib, items, label, note });
  stats.push({ lib, label, count: items.length, licenseFrom });
}

// ── 各库 ────────────────────────────────────────────────────────────────────
if (SRC.claudeRed) {
  const root = path.join(SRC.claudeRed, "Skills");
  // 只 vendor「带 frontmatter」的技能：宿主对无 frontmatter 的条目会告警跳过，
  // 那批改由 claude-red-legacy 的规范化扁平技能承接（避免同一技能两个来源 + 宿主告警噪音）。
  const all = twoLevel(root);
  const withFm = all.filter((s) => hasFrontmatter(path.join(s.from, "SKILL.md")));
  addLib("claude-red", withFm, { licenseFrom: path.join(SRC.claudeRed, "LICENSE"), label: "Claude-Red-main (SnailSploit / Kai Aizen, MIT)" });
}
if (SRC.reverseSkill) {
  addLib("reverse-skill", oneLevel(path.join(SRC.reverseSkill, "skills")), { licenseFrom: path.join(SRC.reverseSkill, "LICENSE"), label: "reverse-skill-main (zhaoxuya520, MIT)" });
}
if (SRC.anthropic) {
  const all = oneLevel(path.join(SRC.anthropic, "skills"));
  const sel = fs.existsSync(selectionFile)
    ? fs.readFileSync(selectionFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : null;
  const chosen = sel ? all.filter((s) => sel.includes(s.name)) : all;
  addLib("anthropic", chosen, {
    licenseFrom: path.join(SRC.anthropic, "LICENSE"),
    label: `Anthropic-Cybersecurity-Skills-1.3.0 (Apache-2.0)；共 ${all.length} 个技能，选取 ${chosen.length} 个`,
    note: sel ? "选取清单见 vendor/anthropic.selection.txt" : undefined,
  });
}
if (SRC.clown) {
  const bundle = path.join(SRC.clown, "skills", "skill");
  const items = fs.existsSync(path.join(bundle, "SKILL.md")) ? [{ name: "clown-src-skill", from: bundle }] : [];
  addLib("clown", items, { licenseFrom: null, label: "clown-src-6k-skill（**未附许可证文件**）", note: "发布前请确认授权；如不允许再分发，删除本目录并把它从 agent.cordis.yml 的技能根里去掉" });
}

// ── 计划输出 ────────────────────────────────────────────────────────────────
let totalFiles = 0, totalBytes = 0, toCopy = 0, toPrune = 0;
for (const { lib, items } of plan) {
  const destRoot = path.join(SKILLS_OUT, lib);
  const wanted = new Set();
  let files = 0, bytes = 0, missing = 0;
  for (const it of items) {
    for (const rel of relFiles(it.from)) {
      wanted.add(path.join(it.name, rel));
      files++;
      try { bytes += fs.statSync(path.join(it.from, rel)).size; } catch { /* ignore */ }
      const dest = path.join(destRoot, it.name, rel);
      if (!fs.existsSync(dest) || fs.readFileSync(dest).length !== fs.statSync(path.join(it.from, rel)).size) missing++;
    }
  }
  const existing = relFiles(destRoot);
  const extra = existing.filter((r) => !wanted.has(r));
  totalFiles += files; totalBytes += bytes; toCopy += missing; toPrune += extra.length;
  console.log(`[${lib}] ${items.length} 个技能 / ${files} 个文件 / ${(bytes / 1048576).toFixed(1)} MB   待复制 ${missing}   多余 ${extra.length}`);
}

// Claude-Red 老格式（无 frontmatter）→ 生成规范化扁平技能
let legacy = 0;
{
  if (SRC.claudeRed) {
    for (const it of twoLevel(path.join(SRC.claudeRed, "Skills"))) {
      if (!hasFrontmatter(path.join(it.from, "SKILL.md"))) legacy++;
    }
  }
}
if (legacy) console.log(`[claude-red-legacy] 源中无 frontmatter 的技能 ${legacy} 个 → 生成规范化扁平技能（vendor/skills/claude-red-legacy/<name>.md）`);
console.log(`\n合计：${totalFiles} 个文件 / ${(totalBytes / 1048576).toFixed(1)} MB；待复制 ${toCopy}；多余 ${toPrune}`);

if (!APPLY) {
  console.log("\n（--check 模式，未写入。加 --apply 落地）");
  process.exit(0);
}

// ── 落地 ────────────────────────────────────────────────────────────────────
fs.mkdirSync(LIC_OUT, { recursive: true });
let copied = 0;
for (const { lib, items } of plan) {
  const destRoot = path.join(SKILLS_OUT, lib);
  for (const it of items) {
    for (const rel of relFiles(it.from)) {
      const from = path.join(it.from, rel), to = path.join(destRoot, it.name, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied++;
    }
  }
  if (PRUNE) {
    const wanted = new Set(items.flatMap((it) => relFiles(it.from).map((rel) => path.join(it.name, rel))));
    for (const rel of relFiles(destRoot)) {
      if (!wanted.has(rel)) { fs.rmSync(path.join(destRoot, rel), { force: true }); fs.rmdirSync(path.dirname(path.join(destRoot, rel)), { recursive: true }); }
    }
  }
}
// 许可证
for (const { lib } of plan) {
  const entry = stats.find((s) => s.lib === lib);
  if (entry.licenseFrom && fs.existsSync(entry.licenseFrom)) {
    fs.copyFileSync(entry.licenseFrom, path.join(LIC_OUT, `${lib}-LICENSE.txt`));
    console.log(`✓ 许可证：${lib}-LICENSE.txt`);
  }
}
// Claude-Red 老格式规范化
{
  const destRoot = path.join(SKILLS_OUT, "claude-red-legacy");
  if (SRC.claudeRed) {
    fs.mkdirSync(destRoot, { recursive: true });
    const wanted = new Set();
    for (const it of twoLevel(path.join(SRC.claudeRed, "Skills"))) {
      const f = path.join(it.from, "SKILL.md");
      if (hasFrontmatter(f)) continue;
      wanted.add(`${it.name}.md`);
      const body = fs.readFileSync(f, "utf8");
      const descMatch = body.match(/^##+\s*Description\s*\r?\n([\s\S]*?)(?=\r?\n##+\s|\s*$)/m);
      const desc = (descMatch ? descMatch[1] : body.split(/\r?\n\r?\n/).slice(1, 3).join(" "))
        .replace(/\s+/g, " ").trim().slice(0, 600) || `Claude-Red skill ${it.name}`;
      fs.writeFileSync(path.join(destRoot, `${it.name}.md`),
        `---\nname: ${it.name}\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.replace(/^\uFEFF/, "")}`, "utf8");
    }
    if (PRUNE) for (const f of fs.readdirSync(destRoot)) {
      if (!wanted.has(f)) fs.rmSync(path.join(destRoot, f), { force: true });
    }
    console.log(`✓ claude-red-legacy：${fs.readdirSync(destRoot).length} 个规范化扁平技能`);
  }
}
// 版权说明
const third = [
  "# 第三方技能库（vendor/skills/）",
  "",
  "本项目**内置**了以下第三方技能库的内容（复制到 `vendor/skills/`，非目录联接），以便发布后自包含：",
  "",
  "| 目录 | 来源 | 许可 | 技能数 |",
  "|---|---|---|---|",
  ...stats.map((s) => `| \`vendor/skills/${s.lib}\` | ${s.label} | ${s.licenseFrom ? path.basename(s.licenseFrom) + "（见 vendor/licenses/）" : "**未标注**"} | ${s.count} |`),
  "",
  "各库许可证原文见 `vendor/licenses/`。若你重新分发本项目，请保留本文件与许可证副本。",
  "",
  ...stats.filter((s) => !s.licenseFrom).map((s) => `> ⚠ \`${s.lib}\` 未附许可证文件，发布前请确认授权；不确定就删除该目录并从 \`modes/network-security/agent.cordis.yml\` 的技能根里去掉。`),
  "",
].join("\n");
fs.writeFileSync(path.join(OUT, "THIRD-PARTY.md"), third, "utf8");
console.log(`✓ 复制 ${copied} 个文件；已写 vendor/THIRD-PARTY.md`);
