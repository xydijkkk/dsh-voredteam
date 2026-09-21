// 从**仓库内置**的技能目录生成 skills/registry.yaml（全部用相对路径）。
//
// 为什么要重新生成：旧注册表是"本机外部库盘点"（500 条，path 全指向本机外部库目录），
// 项目要发布，出厂文件里不能有本机路径；而技能现在已内置到 vendor/skills/，注册表应当描述仓库自身的内容。
// 本机独有的外部资产（不想随仓库发布的那部分）请写在 skills/registry.local.yaml —— 本脚本不碰它。
//
// 用法：node deploy/gen-skill-registry.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "skills", "registry.yaml");
const CHECK = process.argv.includes("--check");

/** 内置技能根（相对仓库根） → 来源标签 */
const ROOTS = [
  ["skills", "dsh-voredteam"],
  ["vendor/skills/claude-red", "Claude-Red-main"],
  ["vendor/skills/claude-red-legacy", "Claude-Red-main(legacy)"],
  ["vendor/skills/reverse-skill", "reverse-skill-main"],
  ["vendor/skills/anthropic", "Anthropic-Cybersecurity-Skills"],
  ["vendor/skills/clown", "clown-src-6k-skill"],
];

/** 阶段关键词（用于 stage 字段的粗分类）。 */
const STAGES = [
  ["recon", /recon|osint|enum|subdomain|scan|fingerprint|asset|测绘|信息收集/i],
  ["web", /web|xss|sqli|ssti|ssrf|xxe|injection|upload|deserial|smuggl|cache|graphql|注入|上传/i],
  ["auth", /auth|jwt|oauth|saml|session|access|idor|越权|认证/i],
  ["api", /api|rest|soap|grpc|接口/i],
  ["cloud", /cloud|aws|azure|gcp|k8s|kubernetes|container|docker|云/i],
  ["internal", /active-directory|kerberos|ldap|smb|lateral|pivot|内网|域/i],
  ["reverse", /reverse|ghidra|ida|frida|malware|firmware|apk|binary|pwn|逆向/i],
  ["exploit", /exploit|payload|shellcode|c2|persist|privesc|bypass|提权|利用/i],
  ["report", /report|writing|writeup|报告/i],
  ["detect", /detect|hunt|forensic|incident|siem|log|检测|取证/i],
];

function frontmatter(file) {
  let t;
  try { t = fs.readFileSync(file, "utf8"); } catch { return null; }
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: null, description: null, body: t };
  const name = (m[1].match(/^name:\s*(.+)$/m) || [])[1];
  const desc = (m[1].match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z-]+:|\s*$)/m) || [])[1];
  return {
    name: name ? name.trim().replace(/^['"]|['"]$/g, "") : null,
    description: desc ? desc.trim().replace(/\s+/g, " ") : null,
    body: t,
  };
}

function stagesOf(text) {
  const hits = STAGES.filter(([, re]) => re.test(text)).map(([s]) => s);
  return hits.length ? hits.slice(0, 3) : ["other"];
}

const entries = [];
for (const [rel, source] of ROOTS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      const skillMd = path.join(abs, e.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      const fm = frontmatter(skillMd) ?? {};
      entries.push({
        // 自研技能的 id 前缀固定为 `vore-`（**稳定标识符**，不随项目改名的牌子走：
        // 已有引用/报告/文档都按 `vore-*` 记，改前缀会让 247 条注册表整体漂移）
        id: `${source === "dsh-voredteam" || source === "voredteam" ? "vore" : source.split(/[-.]/)[0].toLowerCase()}-${e.name}`,
        name: fm.name ?? e.name,
        path: `${rel}/${e.name}/SKILL.md`,
        kind: "skill",
        source,
        desc: (fm.description ?? "").slice(0, 240),
        stage: stagesOf(`${e.name} ${fm.description ?? ""}`),
      });
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      const fm = frontmatter(path.join(abs, e.name)) ?? {};
      const hasFm = Boolean(fm.name && fm.description);
      entries.push({
        // 扁平 .md（如 skills/registry-notes.md）同样按"自研 → vore-"的稳定前缀，
        // 不跟牌子走（改项目名不该让 247 条注册表的 id 漂移）
        id: `${source === "dsh-voredteam" || source === "voredteam" ? "vore" : source.split(/[-.]/)[0].toLowerCase()}-${e.name.replace(/\.md$/i, "")}`,
        name: fm.name ?? e.name.replace(/\.md$/i, ""),
        path: `${rel}/${e.name}`,
        kind: hasFm ? "skill" : "knowledge",
        source,
        desc: (fm.description ?? "").slice(0, 240),
        stage: stagesOf(`${e.name} ${fm.description ?? ""}`),
      });
    }
  }
}

// id 去重（不同来源可能撞名）
const seen = new Map();
for (const it of entries) {
  let id = it.id.replace(/[^a-zA-Z0-9_.-]/g, "-");
  if (seen.has(id)) { let i = 2; while (seen.has(`${id}-${i}`)) i++; id = `${id}-${i}`; }
  seen.set(id, true);
  it.id = id;
}
entries.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));

const bySource = entries.reduce((m, e) => ((m[e.source] = (m[e.source] ?? 0) + 1), m), {});
const lines = [
  "# dsh-voredteam 技能注册表（由 deploy/gen-skill-registry.mjs 从仓库内置技能目录生成）",
  "#",
  "# 全部 path 为**仓库相对路径**（相对项目根），不指向任何本机外部位置 —— 便于发布。",
  "# 技能实体在 vendor/skills/（第三方库，许可证见 vendor/licenses/ 与 vendor/THIRD-PARTY.md）",
  "# 与本仓库 skills/（自研作战手册）。想登记本机独有的外部资产，请写在 skills/registry.local.yaml。",
  "#",
  `# 条目 ${entries.length}：${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  "# kind: skill（可被宿主装载的技能）| knowledge（只能 read 的参考件）",
  "# stage: 粗分类标签（便于检索，非权威）",
  "skills:",
  "",
];

let lastSource = null;
for (const e of entries) {
  if (e.source !== lastSource) {
    lines.push(`  # ===== ${e.source} =====`);
    lastSource = e.source;
  }
  lines.push(`  - id: ${e.id}`);
  lines.push(`    name: ${JSON.stringify(e.name)}`);
  lines.push(`    path: '${e.path}'`);
  lines.push(`    kind: ${e.kind}`);
  lines.push(`    stage: [${e.stage.map((s) => `'${s}'`).join(", ")}]`);
  if (e.desc) lines.push(`    desc: ${JSON.stringify(e.desc)}`);
  lines.push(`    source: ${e.source}`);
}
const out = lines.join("\n") + "\n";

console.log(`生成 ${entries.length} 条：${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(" ")}`);
if (CHECK) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur === out) { console.log("✓ skills/registry.yaml 与内置技能一致"); process.exit(0); }
  console.log("✗ skills/registry.yaml 与内置技能不一致，请跑 node deploy/gen-skill-registry.mjs");
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, "utf8");
console.log(`✓ 已写 ${path.relative(ROOT, OUT)}`);
