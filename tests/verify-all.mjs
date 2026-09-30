// dsh-voredteam 全量验证：对交付物做机器可查的逐项体检（离线）。
// 覆盖：文件清单 / 语法 / JSON / YAML / 角色卡 / 技能与 MCP 注册表全量校验 /
//      禁用引用扫描 / 预设一致性 / 插件元数据 / 数据契约。
// 运行：node --no-warnings tests/verify-all.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
const profileDir = path.join(home, "profiles", "web");

const results = [];
const add = (section, item, ok, detail = "") => results.push({ section, item, ok, detail });
const walk = (dir, opts = {}) => {
  const out = [];
  const skip = new Set(opts.skip ?? ["node_modules", ".git"]);
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      // skill-roots/ 是生成的目录联接农场：Dirent 把它报成 symlink，不能当"文件"（否则 size=0 会误报 0 字节文件），
      // 也不递归进去（内容属于外部库，不在本项目的文件清单口径里）。农场完整性由专门断言校验。
      if (e.isSymbolicLink() || (e.isDirectory() && d.endsWith(`${path.sep}skill-roots`))) continue;
      if (e.isDirectory()) rec(p); else out.push(p);
    }
  };
  rec(dir);
  return out;
};

// YAML：用宿主 profile 里已有的 yaml 包（避免给项目加依赖）
let YAML = null;
try {
  const yamlPkg = path.join(home, "profiles", "node_modules", "yaml", "package.json");
  if (fs.existsSync(yamlPkg)) {
    const meta = JSON.parse(fs.readFileSync(yamlPkg, "utf8"));
    const entry = path.join(path.dirname(yamlPkg), meta.module ?? meta.main ?? "index.js");
    YAML = await import(pathToFileURL(entry).href);
  }
} catch { YAML = null; }

const files = walk(root);
const byExt = {};
for (const f of files) {
  const ext = path.extname(f).toLowerCase() || "(noext)";
  byExt[ext] = (byExt[ext] ?? 0) + 1;
}

// ── 1) 文件清单 ─────────────────────────────────────────────────────────────
{
  const total = files.reduce((s, f) => s + fs.statSync(f).size, 0);
  const need = ["README.md", "LICENSE", "AUTHORIZED-USE.md", "SECURITY.md", "NOTICE.md", "package.json", "cordis.patch.yml", "docs/ARCHITECTURE.md",
    "docs/VERIFICATION.md", "docs/SKILL-INVENTORY.md", "vendor/THIRD-PARTY.md", "mcp/registry.local.example.yaml"];
  add("文件清单", `共 ${files.length} 文件 / ${(total / 1024).toFixed(0)} KB；扩展名 ${Object.entries(byExt).map(([k, v]) => `${k}:${v}`).join(" ")}`, true);
  for (const n of need) add("文件清单", n, fs.existsSync(path.join(root, n)));
  // 技能装载（内置）：每个条目必须真的落到一个带 frontmatter 的 SKILL.md；规范化扁平技能同理
  {
    const farm = path.join(root, "vendor", "skills");
    if (!fs.existsSync(farm)) {
      add("技能内置", "vendor/skills/ 存在", false, "缺内置技能目录：跑 npm run vendor:skills");
    } else {
      let entries = 0, okCount = 0, bad = [];
      const fmOk = (t) => /^---\r?\n[\s\S]*?\r?\n---/.test(t) && /^name:/m.test(t) && /^description:/m.test(t);
      for (const lib of fs.readdirSync(farm)) {
        const libDir = path.join(farm, lib);
        if (!fs.statSync(libDir).isDirectory()) continue;
        for (const e of fs.readdirSync(libDir)) {
          if (e.endsWith(".txt")) continue;
          entries++;
          const skillMd = path.join(libDir, e, "SKILL.md");
          const flat = path.join(libDir, e);
          try {
            if (fs.existsSync(skillMd) && fmOk(fs.readFileSync(skillMd, "utf8"))) okCount++;
            else if (e.endsWith(".md") && fmOk(fs.readFileSync(flat, "utf8"))) okCount++;
            else bad.push(`${lib}/${e}`);
          } catch { bad.push(`${lib}/${e}`); }
        }
      }
      const cfgs = fs.readFileSync(path.join(root, "modes/network-security/agent.cordis.yml"), "utf8");
      const wired = ["claude-red", "claude-red-legacy", "reverse-skill", "anthropic", "clown"].filter((l) => cfgs.includes(`vendor/skills/${l}`));
      add("技能内置", `vendor/skills 条目 ${entries} 个，全部可装载（frontmatter 齐备）`, bad.length === 0, bad.slice(0, 8).join(", "));
      add("技能内置", `五个内置技能根均已挂进 customSkillDirs（${wired.length}/5）`, wired.length === 5, wired.join(", "));
      add("技能内置", `已验证可装载 ${okCount}/${entries}`, okCount === entries, `${okCount}/${entries}`);
      add("技能内置", "vendor 下全部为真实文件（无目录联接）", !fs.readdirSync(farm).some((lib) => { try { return fs.lstatSync(path.join(farm, lib)).isSymbolicLink(); } catch { return false; } }));
    }
  }
  const emptyFiles = files.filter((f) => fs.statSync(f).size === 0 && !path.relative(root, f).startsWith(`vendor${path.sep}`));
  add("文件清单", "无 0 字节文件（vendor/ 第三方内容除外）", emptyFiles.length === 0, emptyFiles.map((f) => path.relative(root, f)).join(", "));
}

// ── 2) JSON 全量解析 ────────────────────────────────────────────────────────
for (const f of files.filter((x) => x.endsWith(".json"))) {
  const rel = path.relative(root, f);
  try {
    const obj = JSON.parse(fs.readFileSync(f, "utf8"));
    const must = rel.startsWith("plugins" + path.sep) && rel.endsWith("package.json");
    if (must) {
      add("JSON", rel, Boolean(obj.name && obj.version && obj.type === "module" && obj.main), `name=${obj.name} main=${obj.main}`);
    } else {
      add("JSON", rel, true);
    }
  } catch (e) {
    add("JSON", rel, false, e.message);
  }
}

// ── 3) YAML 全量解析（预设 / 注册表 / patch）────────────────────────────────
if (!YAML) {
  add("YAML", "宿主 yaml 包可用", false, "未找到 profiles/node_modules/yaml，跳过解析");
} else {
  for (const rel of ["modes/network-security/agent.cordis.yml", "modes/network-security/preset.yml",
    "plugins/vore-blackboard/cordis.patch.yml", "plugins/vore-guard/cordis.patch.yml",
    "plugins/vore-console/cordis.patch.yml", "plugins/vore-settings/cordis.patch.yml",
    "cordis.patch.yml", "mcp/registry.yaml", "skills/registry.yaml"]) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) { add("YAML", rel, false, "文件不存在"); continue; }
    try {
      const doc = YAML.parse(fs.readFileSync(p, "utf8"));
      const n = Array.isArray(doc) ? doc.length : (doc && typeof doc === "object" ? Object.keys(doc).length : 0);
      add("YAML", rel, true, Array.isArray(doc) ? `数组 ${n} 项` : `对象 ${n} 键`);
    } catch (e) {
      add("YAML", rel, false, e.message.split("\n")[0]);
    }
  }
}

// ── 4) 角色卡（13 份，字段与章节齐备）──────────────────────────────────────
{
  const dir = path.join(root, "agents");
  const cards = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  add("角色卡", `共 ${cards.length} 份`, cards.length === 13, cards.join(", "));
  const REQUIRED_SECTIONS = ["授权与边界", "输入前置条件", "纪律", "工作方法", "黑板协议", "输出格式"];
  for (const f of cards) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const hasFm = Boolean(fm);
    const fields = ["id", "name", "description", "kind"];
    const missingFields = hasFm ? fields.filter((k) => !new RegExp(`^${k}:`, "m").test(fm[1])) : fields;
    const missingSections = REQUIRED_SECTIONS.filter((s) => !text.includes(`## ${s}`));
    // 非总控卡都必须写黑板协议里的认领/结论工具名
    const needsTools = f !== "orchestrator.md" ? /bb_intent_claim/.test(text) && /bb_fact_add/.test(text) : true;
    add("角色卡", f, hasFm && missingFields.length === 0 && missingSections.length === 0 && needsTools,
      [missingFields.length ? `缺字段 ${missingFields.join("/")}` : "", missingSections.length ? `缺章节 ${missingSections.join("/")}` : "", needsTools ? "" : "缺 bb_intent_claim/bb_fact_add"].filter(Boolean).join("；"));
  }
}

// ── 5) 技能注册表：全量路径存在性 + id 唯一 + 字段齐备 ───────────────────────
{
  const text = fs.readFileSync(path.join(root, "skills", "registry.yaml"), "utf8");
  const entries = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const idm = line.match(/^\s*- id:\s*(\S+)/);
    if (idm) { cur = { id: idm[1] }; entries.push(cur); continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+(name|path|kind|stage|desc|exec|source|subdomain|note):\s*(.*)$/);
    if (kv) cur[kv[1]] = kv[2];
  }
  add("技能注册表", `条目 ${entries.length}`, entries.length >= 200);
  const dup = entries.map((e) => e.id).filter((v, i, a) => a.indexOf(v) !== i);
  add("技能注册表", "id 全局唯一", dup.length === 0, dup.slice(0, 5).join(", "));

  const missingPath = entries.filter((e) => !e.path).map((e) => e.id);
  add("技能注册表", "每条都有 path 字段", missingPath.length === 0, missingPath.slice(0, 5).join(", "));

  // 全量路径存在性：path 是**仓库相对路径**（可发布），逐条相对仓库根 stat
  const paths = entries.map((e) => String(e.path ?? "").replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
  const bad = [];
  const absolute = [];
  for (const p of paths) {
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/")) { absolute.push(p); continue; }
    try { if (!fs.existsSync(path.join(root, p))) bad.push(p); } catch { bad.push(p); }
  }
  add("技能注册表", `全量路径存在性（${paths.length} 条相对仓库根逐条 stat）`, bad.length === 0, bad.slice(0, 5).join(" , "));
  add("技能注册表", "path 全为仓库相对路径（无本机绝对路径）", absolute.length === 0, absolute.slice(0, 5).join(", "));

  const noKind = entries.filter((e) => !e.kind).map((e) => e.id);
  add("技能注册表", "每条都有 kind", noKind.length === 0, noKind.slice(0, 5).join(", "));
  const kinds = {};
  for (const e of entries) { const k = String(e.kind ?? "").trim(); kinds[k] = (kinds[k] ?? 0) + 1; }
  add("技能注册表", `kind 分布 ${Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(" ")}`, true);
}

// ── 6) MCP 注册表：字段齐备 + command 路径存在性 ────────────────────────────
{
  const text = fs.readFileSync(path.join(root, "mcp", "registry.yaml"), "utf8");
  const entries = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const idm = line.match(/^\s*- id:\s*(\S+)/);
    if (idm) { cur = { id: idm[1] }; entries.push(cur); continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+(name|transport|url|command|registered|tools_count):\s*(.*)$/);
    if (kv) cur[kv[1]] = kv[2];
  }
  add("MCP 注册表", `条目 ${entries.length}`, entries.length >= 10);
  const badFields = entries.filter((e) => !e.name || !e.transport).map((e) => e.id);
  add("MCP 注册表", "每条含 name/transport", badFields.length === 0, badFields.join(", "));
  const httpNoUrl = entries.filter((e) => (e.transport === "http" || e.transport === "sse") && (!e.url || e.url === "null")).map((e) => e.id);
  add("MCP 注册表", "http/sse 条目含 url", httpNoUrl.length === 0, httpNoUrl.join(", "));
  const stdioNoCmd = entries.filter((e) => e.transport === "stdio" && (!e.command || e.command === "null")).map((e) => e.id);
  add("MCP 注册表", "stdio 条目含 command", stdioNoCmd.length === 0, stdioNoCmd.join(", "));
  // command 是绝对路径的，检查文件是否存在
  const checked = [];
  for (const e of entries) {
    const cmd = String(e.command ?? "").replace(/^['"]|['"]$/g, "");
    if (/^[A-Za-z]:[\\/]/.test(cmd)) {
      const alt = cmd.replace(/\//g, "\\");
      const exists = fs.existsSync(cmd) || fs.existsSync(alt);
      checked.push({ id: e.id, cmd, exists });
    }
  }
  const badCmd = checked.filter((c) => !c.exists);
  add("MCP 注册表", `绝对路径 command 存在性（${checked.length} 条）`, badCmd.length === 0, badCmd.map((c) => `${c.id}:${c.cmd}`).join(" , "));
  const excluded = entries.filter((e) => /registered:\s*false/.test(text.split(`- id: ${e.id}`)[1]?.slice(0, 400) ?? ""));
  add("MCP 注册表", `排除项 ${excluded.length} 条带 registered:false`, excluded.length >= 1, excluded.map((e) => e.id).join(", "));
  add("MCP 注册表", "hexstrike 未注册为服务器", !entries.some((e) => /hexstrike/i.test(e.id)));
  for (const need of ["anything-analyzer", "adaptix-c2-mcp", "fofa-mcp"]) {
    add("MCP 注册表", `含 ${need}`, entries.some((e) => e.id === need));
  }
}

// ── 6.5) 客户端面板依赖可解析（dsh.client.inject 指向宿主真实包）────────────
{
  const hostRoot = path.join(home, "profiles", "node_modules");
  for (const d of fs.readdirSync(path.join(root, "plugins"))) {
    const p = path.join(root, "plugins", d, "package.json");
    if (!fs.existsSync(p)) continue;
    const meta = JSON.parse(fs.readFileSync(p, "utf8"));
    const client = meta.dsh?.client;
    if (!client) { add("客户端面板", `${d}：纯宿主插件（无面板）`, true); continue; }
    const missing = (client.inject ?? []).filter((n) => !fs.existsSync(path.join(hostRoot, ...n.split("/"))));
    const clientFile = meta.exports?.["./client"];
    add("客户端面板", `${d}：platform=${client.platform} inject ${client.inject?.length ?? 0} 项可解析 + client 文件存在`,
      missing.length === 0 && Boolean(clientFile) && fs.existsSync(path.join(root, "plugins", d, clientFile)),
      [missing.length ? `缺 ${missing.join(", ")}` : "", clientFile ? "" : "缺 exports[./client]"].filter(Boolean).join("；"));
  }
}

// ── 6.6) 客户端 bundle 新鲜度（生成物不得落后于源）──────────────────────────
{
  const gen = path.join(root, "plugins", "vore-console", "lib", "client.js");
  const srcs = [path.join(root, "plugins", "vore-console", "lib", "pure.mjs"), path.join(root, "plugins", "vore-console", "lib", "panel.js")];
  if (!fs.existsSync(gen)) {
    add("客户端 bundle", "vore-console/lib/client.js 存在", false, "缺失，需跑 node plugins/vore-console/scripts/build-client.mjs");
  } else {
    const gt = fs.statSync(gen).mtimeMs;
    const stale = srcs.filter((s) => fs.existsSync(s) && fs.statSync(s).mtimeMs > gt + 1000).map((s) => path.basename(s));
    const code = fs.readFileSync(gen, "utf8");
    add("客户端 bundle", "vore-console/lib/client.js 由源生成且不落后于源", stale.length === 0,
      stale.length ? `需重新构建（源更新：${stale.join(", ")}）` : "");
    add("客户端 bundle", "vore-console bundle 含内联纯函数（防漏建）", code.includes("computeLayout") && code.includes("extractFindings"));
    add("客户端 bundle", "两个面板都走 __ModuleLoader__ 契约",
      ["vore-console", "vore-settings"].every((d) => {
        const p = path.join(root, "plugins", d, "lib", d === "vore-settings" ? "client.cjs" : "client.js");
        return fs.existsSync(p) && /__ModuleLoader__\.load\(/.test(fs.readFileSync(p, "utf8"));
      }));
    add("客户端 bundle", "WebShell 面板已移除（C2 走 AdaptixC2 MCP）", !fs.existsSync(path.join(root, "plugins", "vore-webshell")));
  }
}

// ── 7) 禁用引用扫描（区分「运行时代码必须干净」与「说明性文件允许提及」）────
{
  const norm = (rel) => rel.split(path.sep).join("/");
  const isRuntime = (rel) =>
    /^lib\//.test(rel) || /^modes\//.test(rel) || /^plugins\/[^/]+\/(lib|mcp|payload-src|plugins)\//.test(rel) ||
    rel === "cordis.patch.yml" || rel === "package.json" ||
    /^plugins\/[^/]+\/(package\.json|cordis\.patch\.yml)$/.test(rel);
  const isScanner = (rel) => /^tests\//.test(rel) || /^plugins\/[^/]+\/tests\//.test(rel);
  // 运行时代码只应引用本项目插件与宿主包：任何别家的 bundle 名出现即失败。
  // 不写死"某某项目"的名字 —— 判定标准是「不是本项目的插件、也不是 @deepseek-ai/* 宿主包」。
  const ourPlugins = new Set(
    fs.readdirSync(path.join(root, "plugins"))
      .map((d) => { try { return JSON.parse(fs.readFileSync(path.join(root, "plugins", d, "package.json"), "utf8")).name; } catch { return null; } })
      .filter(Boolean),
  );
  // 本项目自身的根包也算"我方"（cordis.patch.yml / package.json 里会写它）
  try { ourPlugins.add(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name); } catch { /* ignore */ }
  const foreignBundle = /@(?!deepseek-ai\/)[a-z0-9-]+\/[a-z0-9-]+/gi;
  const patterns = [
    { name: "被排除的扫描器/工具（零引用）", re: /hexstrike/i },
  ];
  const scanFiles = files
    .filter((f) => /\.(js|mjs|cjs|json|yml|yaml)$/i.test(f))
    .map((f) => ({ rel: norm(path.relative(root, f)), f }))
    .filter(({ rel }) => !isScanner(rel));
  for (const p of patterns) {
    const runtimeHits = [];
    const docHits = [];
    for (const { rel, f } of scanFiles) {
      const text = fs.readFileSync(f, "utf8");
      if (!p.re.test(text)) continue;
      const isCommentOnly = text.split(/\r?\n/).filter((l) => p.re.test(l)).every((l) => /^\s*(\/\/|\*|\/\*|#|<!--)/.test(l));
      if (isRuntime(rel)) runtimeHits.push(isCommentOnly ? `${rel}（仅注释）` : `${rel}（**含非注释行**）`);
      else docHits.push(rel);
    }
    add("禁用引用·运行时代码", p.name, runtimeHits.length === 0, runtimeHits.join(", "));
    add("禁用引用·说明性文件", `${p.name}（允许，仅登记）`, true, docHits.join(", ") || "无");
  }

  // 运行时代码里的外部包引用：只允许 @deepseek-ai/*（宿主）与本项目插件
  {
    const foreign = [];
    for (const { rel, f } of scanFiles) {
      if (!isRuntime(rel)) continue;
      for (const m of fs.readFileSync(f, "utf8").matchAll(foreignBundle)) {
        if (ourPlugins.has(m[0])) continue;
        foreign.push(`${rel}: ${m[0]}`);
      }
    }
    add("外部引用", "运行时代码只引用本项目插件与 @deepseek-ai/* 宿主包", foreign.length === 0, [...new Set(foreign)].slice(0, 5).join(", "));
  }
}

// ── 8) 预设一致性：组合行引用的包都在 plugins/ 或宿主里 ─────────────────────
{
  const yml = fs.readFileSync(path.join(root, "modes/network-security/agent.cordis.yml"), "utf8");
  const localPkgs = new Set();
  for (const d of fs.readdirSync(path.join(root, "plugins"))) {
    const p = path.join(root, "plugins", d, "package.json");
    if (fs.existsSync(p)) localPkgs.add(JSON.parse(fs.readFileSync(p, "utf8")).name);
  }
  const rows = [...yml.matchAll(/^\s*- id:\s*(\S+)[\s\S]{0,120}?^\s+name:\s*'?([^'\n]+)'?/gm)].map((m) => ({ id: m[1], name: m[2].trim() }));
  const ours = rows.filter((r) => r.name.startsWith("@dsh-external/"));
  add("预设一致性", `@dsh-external 行 ${ours.length} 条均指向本项目插件`, ours.every((r) => localPkgs.has(r.name)),
    ours.filter((r) => !localPkgs.has(r.name)).map((r) => r.name).join(", "));
  const hostPkgs = [...new Set(rows.filter((r) => r.name.startsWith("@deepseek-ai/")).map((r) => r.name))];
  const hostRoot = path.join(home, "profiles", "node_modules", "@deepseek-ai");
  // 允许子路径导出（如 @deepseek-ai/dsh-tool-subagent-control/list-agents）：只核对包名部分
  const missingHost = hostPkgs
    .map((p) => p.split("/").slice(0, 2).join("/"))
    .filter((p, i, a) => a.indexOf(p) === i)
    .filter((p) => !fs.existsSync(path.join(hostRoot, p.replace("@deepseek-ai/", ""))));
  add("预设一致性", `宿主包 ${hostPkgs.length} 个可解析（子路径按包名核对）`, missingHost.length === 0, missingHost.join(", "));
  add("预设一致性", "persona 含范式与门禁关键词", ["状态空间", "Fact", "Intent", "Hint", "禁 DDoS"].every((k) => yml.includes(k)));
}

// ── 9) 角色卡与总控花名册一致性 ─────────────────────────────────────────────
{
  const orch = fs.readFileSync(path.join(root, "agents", "orchestrator.md"), "utf8");
  const cards = fs.readdirSync(path.join(root, "agents")).filter((f) => f.endsWith(".md") && f !== "orchestrator.md").map((f) => f.replace(/\.md$/, ""));
  const notMentioned = cards.filter((id) => !orch.includes(id));
  add("花名册一致性", `12 个子 agent 都被总控花名册提及`, notMentioned.length === 0, notMentioned.join(", "));
}

// ── 10) profile 安装态 ──────────────────────────────────────────────────────
{
  const pkgPath = path.join(profileDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const profile = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const names = fs.readdirSync(path.join(root, "plugins"))
      .map((d) => path.join(root, "plugins", d, "package.json"))
      .filter((p) => fs.existsSync(p))
      .map((p) => JSON.parse(fs.readFileSync(p, "utf8")).name);
    for (const n of names) {
      const dep = profile.dependencies?.[n];
      const inBundles = (profile.dsh?.profile?.bundles ?? []).includes(n);
      const linked = fs.existsSync(path.join(profileDir, "node_modules", "@dsh-external", n.replace("@dsh-external/", "")));
      add("安装态", `${n}：dependencies + bundles + node_modules 链接`, Boolean(dep) && inBundles && linked,
        [!dep ? "缺 dependencies" : "", !inBundles ? "缺 bundles" : "", !linked ? "缺 node_modules 链接" : ""].filter(Boolean).join("；"));
    }
    const bak = fs.readdirSync(profileDir).filter((f) => f.startsWith("package.json.bak-voredteam-"));
    add("安装态", `profile 备份文件 ${bak.length} 个（可回滚）`, bak.length >= 1, bak.slice(-2).join(", "));
  } else {
    add("安装态", "profile package.json 可读", false, pkgPath);
  }
  add("安装态", "预设 junction 已链接", fs.existsSync(path.join(home, ".agent-presets", "network-security")));
}

// ── 输出 ────────────────────────────────────────────────────────────────────
let lastSection = "";
let okCount = 0;
console.log(`\ndsh-voredteam 全量验证（root=${root}）\n${"═".repeat(78)}`);
for (const r of results) {
  if (r.section !== lastSection) { console.log(`\n▌ ${r.section}`); lastSection = r.section; }
  if (r.ok) okCount++;
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.item}${r.detail ? `  ${r.detail}` : ""}`);
}
const total = results.length;
console.log(`\n${"═".repeat(78)}`);
console.log(`  ${okCount}/${total} 项通过${okCount === total ? " —— 全量验证通过" : " —— 见上方 ✗ 项"}\n`);
process.exit(okCount === total ? 0 : 1);
