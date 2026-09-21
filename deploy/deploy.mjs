#!/usr/bin/env node
/**
 * voredteam 一键部署 CLI —— 把「预设目录落盘」与「profile 插件挂载」两件事变成可重复执行的校验/应用。
 *
 *   node deploy/deploy.mjs              等价于 --check：离线校验，逐项打 ✓/✗（不写盘）
 *   node deploy/deploy.mjs --dry-run    打印将要发生的变更（不写盘）
 *   node deploy/deploy.mjs --apply      幂等写入：预设实体目录 + profile package.json
 *
 * 可选参数：
 *   --home <path>      DSH home（默认取环境变量 DSH_HOME，其次 ~/.dsh）
 *   --profile <name>   profile 名（默认 web）→ <DSH_HOME>/profiles/<name>/package.json
 *   --mode <id>        预设模式 id（默认 network-security）→ modes/<id> ↔ <DSH_HOME>/.agent-presets/<id>
 *   --only <kind>      只处理某类变更：preset | profile（可重复）
 *   --help             帮助
 *
 * 退出码：0 = 校验通过 / 已应用；1 = 存在 ✗ 项（--apply 时代表写入后仍有 ✗ 或发生错误）。
 *
 * 约束：Node >= 22，ESM，零第三方依赖。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

// ────────────────────────────────────────────────────────────── 基础工具

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(SCRIPT_DIR, "..");
/** 仓库根，也是预设模板里 `{{PROJECT_ROOT}}` 的替换值。 */
const rootDir = ROOT;
const PLUGINS_DIR = path.join(ROOT, "plugins");
const MODES_DIR = path.join(ROOT, "modes");

/** 这些包名永远不该出现在 voredteam 的 profile 记账里（DSH 自身基础包）。 */
const BASELINE_BUNDLES = new Set(["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);

const c = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

const ok = (s) => `${c.green}✓${c.reset} ${s}`;
const bad = (s) => `${c.red}✗${c.reset} ${s}`;
const warn = (s) => `${c.yellow}!${c.reset} ${s}`;
const info = (s) => `${c.dim}·${c.reset} ${s}`;

function width(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    // CJK / 全角区段按 2 列计
    w += (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ? 2 : 1;
  }
  return w;
}
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - width(s)));
const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*m/g, "");

/** 渲染一张对齐表格（中英混排按显示宽度补齐）。 */
function renderTable(rows, indent = "  ") {
  if (rows.length === 0) return "";
  const cols = rows[0].length;
  const widths = [];
  for (let i = 0; i < cols; i++) {
    widths[i] = Math.max(...rows.map((r) => width(stripAnsi(r[i] ?? ""))));
  }
  return rows
    .map((r) =>
      indent +
      r
        .map((cell, i) => (i === cols - 1 ? String(cell ?? "") : pad(cell ?? "", widths[i])))
        .join("  ")
        .replace(/\s+$/, ""),
    )
    .join("\n");
}

function section(title) {
  console.log(`\n${c.bold}${c.cyan}▌ ${title}${c.reset}`);
}

function readJson(file) {
  const raw = fs.readFileSync(file, "utf8");
  // DSH 的 package.json 由 pnpm 写入，可能带 UTF-8 BOM
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

function fileNonEmpty(p) {
  try {
    return fs.statSync(p).isFile() && fs.readFileSync(p, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

/** 归一化路径用于比较：去 link: 前缀、正斜杠化、折叠分隔符、去尾斜杠、小写。 */
function normPath(p) {
  let s = String(p ?? "").trim();
  if (s.toLowerCase().startsWith("link:")) s = s.slice(5);
  s = s.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return s.toLowerCase();
}

/** 更强的等价判断：两边都能 realpath 时用 realpath 比（junction/大小写/短名都能吃）。 */
function sameDir(a, b) {
  if (normPath(a) === normPath(b)) return true;
  try {
    const ra = fs.realpathSync.native(path.resolve(a));
    const rb = fs.realpathSync.native(path.resolve(b));
    return normPath(ra) === normPath(rb);
  } catch {
    return false;
  }
}

/** link: 值里路径部分的展示形态：JSON 里写单反斜杠，序列化时自动转义成 \\ */
function linkValue(dir) {
  return `link:${path.resolve(dir)}`;
}

/** 读一个 symlink/junction 的目标绝对路径；非链接或读不到返回 null。 */
function linkTarget(linkPath) {
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      const raw = fs.readlinkSync(linkPath);
      return path.resolve(path.dirname(linkPath), raw);
    }
    if (st.isDirectory()) {
      // Windows junction 在部分 Node 版本/文件系统下 lstat 不报 symlink，用 realpath 兜底
      const real = fs.realpathSync.native(linkPath);
      return normPath(real) === normPath(linkPath) ? null : real;
    }
    return null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────── CLI 参数

function parseArgs(argv) {
  const opts = {
    action: "check",
    home: process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : path.join(os.homedir(), ".dsh"),
    profile: "web",
    mode: "network-security",
    only: [],
    help: false,
  };
  const actions = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${name} 需要一个参数值`);
      return v;
    };
    if (a === "--check") actions.push("check");
    else if (a === "--apply") actions.push("apply");
    else if (a === "--dry-run" || a === "--dryrun" || a === "-n") actions.push("dry-run");
    else if (a === "--home") opts.home = need("--home");
    else if (a.startsWith("--home=")) opts.home = a.slice(7);
    else if (a === "--profile") opts.profile = need("--profile");
    else if (a.startsWith("--profile=")) opts.profile = a.slice(10);
    else if (a === "--mode") opts.mode = need("--mode");
    else if (a.startsWith("--mode=")) opts.mode = a.slice(7);
    else if (a === "--only") opts.only.push(need("--only"));
    else if (a.startsWith("--only=")) opts.only.push(a.slice(7));
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`未知参数：${a}（用 --help 看用法）`);
  }
  const uniq = [...new Set(actions)];
  if (uniq.length > 1) throw new Error(`--check / --dry-run / --apply 只能选一个（收到：${uniq.join(", ")}）`);
  if (uniq.length === 1) opts.action = uniq[0];
  opts.home = path.resolve(opts.home);
  return opts;
}

const HELP = `voredteam 一键部署 CLI

用法：
  node deploy/deploy.mjs [--check | --dry-run | --apply] [选项]

子命令（缺省 --check）：
  --check     离线校验：预设目录 / 插件包元数据 / profile 记账，逐项打 ✓✗（不写盘）
  --dry-run   打印将要发生的变更（不写盘）
  --apply     幂等写入：落盘预设实体目录 + 备份并更新 profile package.json

选项：
  --home <path>     DSH home（默认 $DSH_HOME，其次 ~/.dsh）
  --profile <name>  profile 名（默认 web）
  --mode <id>       预设模式 id（默认 network-security）
  --only preset|profile   只处理指定类别（可重复）
  -h, --help        显示本帮助

退出码：0 = 通过/已应用；1 = 存在 ✗ 项`;

// ────────────────────────────────────────────────────────────── 数据采集

function discoverPlugins() {
  const out = [];
  if (!fs.existsSync(PLUGINS_DIR)) return out;
  for (const ent of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const dir = path.join(PLUGINS_DIR, ent.name);
    const pkgFile = path.join(dir, "package.json");
    if (!fs.existsSync(pkgFile)) continue;
    let pkg = null;
    let parseError = null;
    try {
      pkg = readJson(pkgFile);
    } catch (e) {
      parseError = e.message;
    }
    out.push({ dirName: ent.name, dir, pkgFile, pkg, parseError });
  }
  return out;
}

function collectState(opts) {
  const presetSrc = path.join(MODES_DIR, opts.mode);
  const presetLink = path.join(opts.home, ".agent-presets", opts.mode);
  const profileDir = path.join(opts.home, "profiles", opts.profile);
  const profileFile = path.join(profileDir, "package.json");

  let profilePkg = null;
  let profileRaw = null;
  let profileError = null;
  try {
    profileRaw = fs.readFileSync(profileFile, "utf8");
    profilePkg = JSON.parse(profileRaw.replace(/^\uFEFF/, ""));
  } catch (e) {
    profileError = e.message;
  }

  return {
    presetSrc,
    presetLink,
    presetSrcOk: {
      presetYml: fileNonEmpty(path.join(presetSrc, "preset.yml")),
      agentYml: fileNonEmpty(path.join(presetSrc, "agent.cordis.yml")),
      isDir: fs.existsSync(presetSrc),
    },
    presetLinkTarget: fs.existsSync(presetLink) || safeLstat(presetLink) ? linkTarget(presetLink) : null,
    presetLinkExists: safeLstat(presetLink) !== null,
    profileDir,
    profileFile,
    profilePkg,
    profileError,
    plugins: discoverPlugins(),
  };
}

function safeLstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────── 计划构建

/**
 * 构建变更计划。check 与 dry-run/apply 共用同一份判定逻辑，
 * 保证「校验能过 ⇒ apply 不会做出计划外的改动」。
 */
/**
 * 收集目录下的相对文件清单（递归）。
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectRelFiles(dir, out = [], base = dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectRelFiles(p, out, base);
    else out.push(path.relative(base, p));
  }
  return out;
}

/** 由本项目托管的预设目录里的诊断标记（不属于预设本体）。 */
const PRESET_MARKER = ".vore-preset.json";

/** 预设模板里的仓库根占位符（落盘时替换为绝对路径，使仓库本身可发布）。 */
const PRESET_ROOT_TOKEN = "{{PROJECT_ROOT}}";

/**
 * 把模板源文件渲染成落盘内容（`{{PROJECT_ROOT}}` → 仓库绝对路径，正斜杠形式）。
 * @param {string} file - 源文件绝对路径
 * @returns {string}
 */
function renderPresetFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  return raw.includes(PRESET_ROOT_TOKEN)
    ? raw.split(PRESET_ROOT_TOKEN).join(rootDir.replace(/\\/g, "/"))
    : raw;
}

/**
 * 预设落盘状态。
 *
 * **为什么不能用 junction**：宿主 `@deepseek-ai/dsh-agent-presets` 的 `scanRoot()` 用
 * `readdir(dir, { withFileTypes: true })` 然后 `if (!child.isDirectory()) continue` 过滤目录，
 * 而 Node 在 Windows 上把 junction/符号链接报成 `isSymbolicLink() === true` / `isDirectory() === false`
 * ——链接会被**静默跳过**，预设根本不会出现在模式列表里（实测：宿主发现 0 个用户预设）。
 * 因此这里改为**实体目录 + 内容复制**，并把源路径与哈希写进标记文件以便检测漂移。
 * @param {string} src - 本项目 modes/<id> 源目录
 * @param {string} dest - <DSH_HOME>/.agent-presets/<id>
 * @returns {{kind:string, reason:string, files:string[], changed?:string[], missing?:string[], extra?:string[]}}
 */
function presetMaterializeState(src, dest) {
  const files = collectRelFiles(src);
  let lst = null;
  try { lst = fs.lstatSync(dest); } catch { return { kind: "create", reason: "预设目录不存在", files }; }
  if (lst.isSymbolicLink()) return { kind: "replace-link", reason: "现为软链接/junction —— 宿主 scanRoot 会跳过链接（isDirectory() === false）", files };
  if (!lst.isDirectory()) return { kind: "replace-link", reason: "现为文件而非目录", files };
  const missing = [], changed = [];
  for (const f of files) {
    const d = path.join(dest, f), s = path.join(src, f);
    if (!fs.existsSync(d)) { missing.push(f); continue; }
    // 与落盘内容比：源是模板（含 {{PROJECT_ROOT}}），落盘是渲染后的文本
    try {
      if (fs.readFileSync(d, "utf8") !== renderPresetFile(s)) changed.push(f);
    } catch { changed.push(f); }
  }
  const extra = collectRelFiles(dest).filter((f) => f !== PRESET_MARKER && !files.includes(f));
  if (missing.length || changed.length || extra.length) {
    return { kind: "refresh", reason: `内容漂移：缺 ${missing.length} / 变 ${changed.length} / 多 ${extra.length}`, files, missing, changed, extra };
  }
  return { kind: "skip", reason: "已是内容一致的实体目录", files };
}

/**
 * 把源目录内容复制进宿主预设目录（幂等；调用方保证 dest 已是实体目录）。
 * 同时删除 dest 里来源之外的文件——宿主读的就是这份副本，多出来的旧文件（例如源里已删的备份）
 * 会让「副本 = 源」的等价关系失效。
 *
 * **模板渲染**：源文件里的 `{{PROJECT_ROOT}}` 在复制时替换成本仓库的绝对路径（正斜杠形式）。
 * 这样仓库里**不出现任何本机路径**（可发布），而宿主的 customSkillDirs（内部走 path.resolve，
 * 相对路径会以进程 cwd 为基准、不可靠）拿到的仍是绝对路径。
 * @param {string} src
 * @param {string} dest
 * @param {string} mode
 */
function materializePreset(src, dest, mode) {
  const want = new Set(collectRelFiles(src));
  for (const rel of collectRelFiles(dest)) {
    if (rel === PRESET_MARKER || want.has(rel)) continue;
    try { fs.rmSync(path.join(dest, rel), { force: true }); } catch { /* 删不掉就留着，--check 会继续报"多" */ }
  }
  const rendered = [];
  for (const f of want) {
    const from = path.join(src, f), to = path.join(dest, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const raw = fs.readFileSync(from, "utf8");
    if (raw.includes(PRESET_ROOT_TOKEN)) {
      fs.writeFileSync(to, raw.split(PRESET_ROOT_TOKEN).join(rootDir.replace(/\\/g, "/")), "utf8");
      rendered.push(f);
    } else {
      fs.writeFileSync(to, raw, "utf8");
    }
  }
  fs.writeFileSync(path.join(dest, PRESET_MARKER), JSON.stringify({
    managedBy: "voredteam/deploy/deploy.mjs",
    source: src, mode, syncedAt: new Date().toISOString(),
    renderedTokens: { [PRESET_ROOT_TOKEN]: rootDir.replace(/\\/g, "/"), files: rendered },
  }, null, 2) + "\n", "utf8");
}

function buildPlan(opts, st) {
  const plan = { preset: null, profile: null, stale: [], notes: [] };

  // ---- 预设目录（实体复制）
  const onlyPreset = opts.only.length === 0 || opts.only.includes("preset");
  if (onlyPreset) {
    let action = "none", reason = "";
    if (!st.presetSrcOk.isDir) {
      action = "error";
      reason = `源目录不存在：${st.presetSrc}`;
    } else {
      const ms = presetMaterializeState(st.presetSrc, st.presetLink);
      action = ms.kind;
      reason = ms.reason;
      if (ms.kind === "skip") action = "skip";
    }
    plan.preset = { action, reason, link: st.presetLink, target: st.presetSrc };
  }

  // ---- profile package.json
  const onlyProfile = opts.only.length === 0 || opts.only.includes("profile");
  if (onlyProfile) {
    const deps = (st.profilePkg && st.profilePkg.dependencies) || {};
    const bundleList = st.profilePkg?.dsh?.profile?.bundles;
    const bundles = Array.isArray(bundleList) ? bundleList : [];
    const depChanges = [];
    const bundleAdds = [];

    for (const p of st.plugins) {
      const name = p.pkg?.name;
      if (!name) continue;
      const current = deps[name];
      if (current === undefined) {
        depChanges.push({ name, from: "(缺失)", to: linkValue(p.dir), kind: "add" });
      } else if (sameDir(current, p.dir)) {
        // 已指向本项目：不动（幂等锚点）
      } else {
        depChanges.push({ name, from: current, to: linkValue(p.dir), kind: "relink" });
      }
      if (!bundles.includes(name)) bundleAdds.push(name);
    }

    // 陈旧项：曾经由本项目挂载、但插件目录已不存在的条目
    const liveNames = new Set(st.plugins.map((p) => p.pkg?.name).filter(Boolean));
    for (const [name, val] of Object.entries(deps)) {
      if (liveNames.has(name)) continue;
      if (!normPath(val).includes(normPath(PLUGINS_DIR)) && !normPath(val).includes(normPath(ROOT) + "/plugins")) continue;
      plan.stale.push({ name, where: "dependencies", value: val });
    }
    for (const name of bundles) {
      if (liveNames.has(name) || BASELINE_BUNDLES.has(name)) continue;
      if (!name.startsWith("@dsh-external/vore-")) continue;
      plan.stale.push({ name, where: "bundles", value: "" });
    }

    plan.profile = {
      depChanges,
      bundleAdds,
      bundlesOrderPreserved: bundles.length,
      bundlesWasArray: Array.isArray(bundleList),
      file: st.profileFile,
      needsWrite: depChanges.length > 0 || bundleAdds.length > 0,
      nextBundles: [...bundles, ...bundleAdds],
    };
  }

  return plan;
}

function applyPlanToProfileJson(st, plan) {
  const pkg = structuredClone(st.profilePkg);
  if (!pkg.dependencies || typeof pkg.dependencies !== "object") pkg.dependencies = {};
  for (const ch of plan.profile.depChanges) pkg.dependencies[ch.name] = ch.to;
  if (!pkg.dsh || typeof pkg.dsh !== "object") pkg.dsh = {};
  if (!pkg.dsh.profile || typeof pkg.dsh.profile !== "object") pkg.dsh.profile = {};
  if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = [];
  for (const name of plan.profile.bundleAdds) {
    if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name);
  }
  return pkg;
}

function backupName(file, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${file}.bak-voredteam-${ts}`;
}

// ────────────────────────────────────────────────────────────── 插件包校验

function checkPluginPackage(p) {
  const items = [];
  if (p.parseError) {
    items.push({ ok: false, item: p.dirName, note: `package.json 解析失败：${p.parseError}` });
    return items;
  }
  const pkg = p.pkg || {};
  const name = pkg.name;
  items.push(
    name && typeof name === "string"
      ? { ok: true, item: p.dirName, note: `name = ${name}` }
      : { ok: false, item: p.dirName, note: "缺少 package.json 的 name 字段" },
  );

  // main 指向的文件必须存在
  const main = pkg.main;
  if (!main) {
    items.push({ ok: false, item: `${p.dirName} / main`, note: "未声明 main" });
  } else {
    const abs = path.resolve(p.dir, main);
    items.push(
      fs.existsSync(abs)
        ? { ok: true, item: `${p.dirName} / main`, note: `${main} 存在` }
        : { ok: false, item: `${p.dirName} / main`, note: `${main} 不存在（${abs}）` },
    );
  }

  // dsh.bundle.patch 指向的文件必须存在
  const patch = pkg.dsh?.bundle?.patch;
  if (!patch) {
    items.push({ ok: false, item: `${p.dirName} / dsh.bundle.patch`, note: "未声明 bundle patch" });
  } else {
    const abs = path.resolve(p.dir, patch);
    items.push(
      fileNonEmpty(abs)
        ? { ok: true, item: `${p.dirName} / dsh.bundle.patch`, note: `${patch} 存在且非空` }
        : { ok: false, item: `${p.dirName} / dsh.bundle.patch`, note: `${patch} 缺失或为空（${abs}）` },
    );
  }

  // 声明了 dsh.client 就必须有可用的 exports["./client"]
  if (pkg.dsh?.client) {
    const rel = pkg.exports?.["./client"];
    if (!rel || typeof rel !== "string") {
      items.push({ ok: false, item: `${p.dirName} / exports["./client"]`, note: "声明了 dsh.client 但未导出 ./client" });
    } else {
      const abs = path.resolve(p.dir, rel);
      items.push(
        fs.existsSync(abs)
          ? { ok: true, item: `${p.dirName} / exports["./client"]`, note: `${rel} 存在（客户端面板：需 pnpm install + 重启 dsh web）` }
          : { ok: false, item: `${p.dirName} / exports["./client"]`, note: `${rel} 不存在（${abs}）` },
      );
    }
  } else {
    items.push({ ok: true, item: `${p.dirName} / client`, note: "纯宿主插件，无客户端面板（免 pnpm install）" });
  }

  return items;
}

// ────────────────────────────────────────────────────────────── 渲染

function nextSteps(opts, st, plan, { changed = false } = {}) {
  const lines = [];
  const presetNeeded = plan.preset && (plan.preset.action === "create" || plan.preset.action === "replace");
  const profileNeeded = plan.profile?.needsWrite;
  const clientPlugins = st.plugins.filter((p) => p.pkg?.dsh?.client).map((p) => p.pkg.name);

  if (presetNeeded || profileNeeded) {
    lines.push(`1) 应用变更：${c.bold}node deploy/deploy.mjs --apply${c.reset}${changed ? "（已在本次执行）" : ""}`);
  }
  if (profileNeeded || clientPlugins.length > 0) {
    const idx = lines.length + 1;
    lines.push(
      `${idx}) 安装 profile 依赖：${c.bold}cd "${path.join(opts.home, "profiles")}" && pnpm install${c.reset}` +
        `\n   ${c.dim}pnpm 不可用时改用：cd "${path.join(opts.home, "profiles")}" && npm install${c.reset}`,
    );
  }
  const idx2 = lines.length + 1;
  lines.push(`${idx2}) 重启 dsh web（宿主插件与客户端面板的改动都要重启才生效）`);
  return lines.join("\n");
}

function printCheck(opts, st, plan) {
  const all = [];

  console.log(`${c.bold}voredteam 部署校验${c.reset} ${c.dim}(--check，不写盘)${c.reset}`);
  console.log(info(`项目根       ${ROOT}`));
  console.log(info(`DSH home     ${opts.home}${process.env.DSH_HOME ? "  (来自环境变量 DSH_HOME)" : "  (默认 ~/.dsh)"}`));
  console.log(info(`目标 profile ${opts.profile} → ${st.profileFile}`));

  // a) 预设
  section(`a) 预设模式：${opts.mode}`);
  const presetYml = path.join(st.presetSrc, "preset.yml");
  const agentYml = path.join(st.presetSrc, "agent.cordis.yml");
  const presetRows = [];
  const push = (good, item, note) => {
    presetRows.push([good ? ok("") : bad(""), item, note]);
    all.push(good);
  };
  push(st.presetSrcOk.isDir, `modes/${opts.mode}/`, st.presetSrcOk.isDir ? st.presetSrc : "目录不存在");
  push(st.presetSrcOk.presetYml, `modes/${opts.mode}/preset.yml`, st.presetSrcOk.presetYml ? "存在且非空" : `缺失或为空（${presetYml}）`);
  push(st.presetSrcOk.agentYml, `modes/${opts.mode}/agent.cordis.yml`, st.presetSrcOk.agentYml ? "存在且非空" : `缺失或为空（${agentYml}）`);
  const ms = presetMaterializeState(st.presetSrc, st.presetLink);
  const presetOk = ms.kind === "skip";
  push(
    presetOk,
    `.agent-presets/${opts.mode}`,
    presetOk
      ? `实体目录，内容与源一致（${ms.files.length} 个文件）`
      : ms.kind === "replace-link"
        ? `${ms.reason}，${c.bold}用 --apply 重建为实体目录${c.reset}`
        : ms.kind === "create"
          ? `未落盘，${c.bold}用 --apply 创建${c.reset}`
          : `${ms.reason}，${c.bold}用 --apply 刷新${c.reset}`,
  );
  console.log(renderTable([["", "项目", "结果"], ...presetRows]));

  // b) 插件
  section(`b) 插件包元数据：plugins/*/package.json（自动发现 ${st.plugins.length} 个）`);
  const pluginRows = [];
  if (st.plugins.length === 0) {
    pluginRows.push(["", "(plugins/ 下没有含 package.json 的目录)", ""]);
    all.push(false);
  }
  for (const p of st.plugins) {
    for (const it of checkPluginPackage(p)) {
      pluginRows.push([it.ok ? ok("") : bad(""), it.item, it.note]);
      all.push(it.ok);
    }
  }
  console.log(renderTable([["", "插件 / 检查项", "结果"], ...pluginRows]));

  // c) profile
  section(`c) profile 记账：${opts.profile}`);
  const profileRows = [];
  if (st.profileError) {
    profileRows.push([bad(""), st.profileFile, `无法读取/解析：${st.profileError}`]);
    all.push(false);
  } else {
    profileRows.push([ok(""), path.basename(st.profileFile), `已读取（dependencies ${Object.keys(st.profilePkg.dependencies || {}).length} 项 / bundles ${(st.profilePkg.dsh?.profile?.bundles || []).length} 项）`]);
    const depChanges = new Map((plan.profile?.depChanges || []).map((d) => [d.name, d]));
    const bundleAdds = new Set(plan.profile?.bundleAdds || []);
    const bundles = st.profilePkg.dsh?.profile?.bundles || [];
    const deps = st.profilePkg.dependencies || {};
    for (const p of st.plugins) {
      const name = p.pkg?.name;
      if (!name) continue;
      const ch = depChanges.get(name);
      const inDeps = deps[name] !== undefined;
      const good = inDeps && !ch;
      profileRows.push([
        good ? ok("") : bad(""),
        `${name} / dependencies`,
        good ? `link 正确 → ${deps[name]}` : ch ? `${ch.from} ⇒ ${ch.to}` : "缺失",
      ]);
      all.push(good);
      const inBundles = bundles.includes(name);
      profileRows.push([
        inBundles ? ok("") : bad(""),
        `${name} / bundles`,
        inBundles ? "已在 bundles" : (bundleAdds.has(name) ? "缺失，将追加到末尾" : "缺失"),
      ]);
      all.push(inBundles);
    }
    if (st.plugins.length === 0) all.push(false);
    if (plan.stale.length > 0) {
      for (const s of plan.stale) {
        profileRows.push([warn(""), `${s.name} / ${s.where}`, "陈旧项（插件目录已不存在）——apply 不自动删，需人工确认后移除"]);
      }
    }
  }
  console.log(renderTable([["", "条目 / 检查项", "结果"], ...profileRows]));

  // d) 汇总
  const passed = all.filter(Boolean).length;
  const failed = all.length - passed;
  section("d) 汇总");
  console.log(`  通过 ${c.green}${passed}${c.reset} 项，未通过 ${failed > 0 ? c.red : c.dim}${failed}${c.reset} 项`);
  const presetNeeded = plan.preset && plan.preset.action !== "skip" && plan.preset.action !== "none";
  const profileNeeded = plan.profile?.needsWrite;
  if (failed === 0 && !presetNeeded && !profileNeeded) {
    console.log(`  ${c.green}${c.bold}部署状态完好，无需变更。${c.reset}`);
    if (st.plugins.some((p) => p.pkg?.dsh?.client)) {
      console.log(info("提示：本次未检出变更；若刚改过客户端面板代码，仍需 pnpm install + 重启 dsh web。"));
    }
  } else {
    console.log(`  还需要做的：`);
    console.log("  " + nextSteps(opts, st, plan).split("\n").join("\n  "));
  }
  return failed;
}

function printDryRun(opts, st, plan) {
  console.log(`${c.bold}voredteam 部署预演${c.reset} ${c.dim}(--dry-run，不写盘)${c.reset}`);
  console.log(info(`DSH home     ${opts.home}`));
  console.log(info(`目标 profile ${opts.profile} → ${st.profileFile}`));

  section("变更 1：预设目录（实体复制，非 junction）");
  if (!plan.preset) {
    console.log(info("（--only 过滤，跳过）"));
  } else if (plan.preset.action === "skip") {
    console.log(`  ${ok("")} 无需变更：${plan.preset.link} 已与 ${plan.preset.target} 内容一致`);
  } else if (plan.preset.action === "error") {
    console.log(`  ${bad("")} 无法处理：${plan.preset.reason}`);
  } else {
    if (plan.preset.action === "replace-link" || plan.preset.action === "refresh") {
      console.log(`  ${warn("")} 先删除既有目录/链接：${plan.preset.link}`);
      console.log(`        ${c.dim}（原因：${plan.preset.reason}）${c.reset}`);
    }
    console.log(`  ${ok("")} 复制 ${plan.preset.target} → ${plan.preset.link}（preset.yml / agent.cordis.yml 等全部文件 + 标记）`);
  }

  section("变更 2：profile package.json");
  if (!plan.profile) {
    console.log(info("（--only 过滤，跳过）"));
  } else if (!plan.profile.needsWrite) {
    console.log(`  ${ok("")} 无需变更：全部 ${st.plugins.length} 个插件已在 dependencies 与 bundles 中，且 link 均指向本项目`);
  } else {
    console.log(`  目标文件：${plan.profile.file}`);
    console.log(`  备份文件：${backupName(plan.profile.file)}`);
    console.log(`  ${c.bold}dependencies 变更（${plan.profile.depChanges.length} 项）${c.reset}`);
    if (plan.profile.depChanges.length === 0) console.log(info("无"));
    for (const ch of plan.profile.depChanges) {
      console.log(`    ${ch.kind === "add" ? "+" : "~"} ${ch.name}`);
      if (ch.kind === "add") console.log(`        ${ch.to}`);
      else console.log(`        - ${ch.from}\n        + ${ch.to}`);
    }
    console.log(`  ${c.bold}bundles 追加（${plan.profile.bundleAdds.length} 项，保留原顺序，新项追加末尾）${c.reset}`);
    if (plan.profile.bundleAdds.length === 0) console.log(info("无"));
    for (const n of plan.profile.bundleAdds) console.log(`    + ${n}`);
    if (plan.profile.bundleAdds.length > 0) {
      console.log(`  ${c.dim}bundles 顺序：前 ${plan.profile.bundlesOrderPreserved} 项不动，末尾追加上述 ${plan.profile.bundleAdds.length} 项${c.reset}`);
    }
    if (plan.stale.length > 0) {
      console.log(`  ${c.bold}陈旧项（只报告，不自动删）${c.reset}`);
      for (const s of plan.stale) console.log(`    ${warn("")} ${s.name} @ ${s.where}`);
    }
  }

  section("接下来请执行");
  console.log("  " + nextSteps(opts, st, plan).split("\n").join("\n  "));
  console.log(`\n${c.dim}（预演结束，未写入任何文件）${c.reset}`);
}

function runApply(opts, st, plan) {
  console.log(`${c.bold}voredteam 部署应用${c.reset} ${c.dim}(--apply，幂等)${c.reset}`);
  console.log(info(`DSH home     ${opts.home}`));
  const errors = [];

  // 变更 1：预设目录（实体复制 —— junction 会被宿主 scanRoot 跳过）
  section("变更 1：预设目录（实体复制）");
  const p = plan.preset;
  if (!p) {
    console.log(info("（--only 过滤，跳过）"));
  } else if (p.action === "skip") {
    console.log(`  ${ok("")} 已是最新，跳过：${p.link}（内容与 ${p.target} 一致）`);
  } else if (p.action === "error") {
    console.log(`  ${bad("")} ${p.reason}`);
    errors.push(p.reason);
  } else {
    try {
      if (p.action === "replace-link" || p.action === "refresh") {
        if (fs.existsSync(p.link) || (() => { try { fs.lstatSync(p.link); return true; } catch { return false; } })()) {
          fs.rmSync(p.link, { recursive: true, force: true });
        }
      }
      fs.mkdirSync(p.link, { recursive: true });
      materializePreset(p.target, p.link, opts.mode);
      const files = collectRelFiles(p.target).length;
      console.log(`  ${ok("")} 已落盘 ${p.link}（${files} 个文件，源 ${p.target}）${p.action === "skip" ? "" : c.dim + "（" + p.reason + "）" + c.reset}`);
      console.log(`      ${c.dim}⚠ 不用 junction：宿主 scanRoot 用 Dirent.isDirectory() 过滤，链接会被静默跳过${c.reset}`);
    } catch (e) {
      console.log(`  ${bad("")} 落盘失败：${e.message}`);
      errors.push(e.message);
    }
  }

  // 变更 2：profile package.json
  section("变更 2：profile package.json");
  const pf = plan.profile;
  if (!pf) {
    console.log(info("（--only 过滤，跳过）"));
  } else if (st.profileError) {
    console.log(`  ${bad("")} 无法读取 profile：${st.profileError}`);
    errors.push(st.profileError);
  } else if (!pf.needsWrite) {
    console.log(`  ${ok("")} 已是最新，跳过写入：${pf.file}`);
  } else {
    const bak = backupName(pf.file);
    try {
      fs.mkdirSync(path.dirname(pf.file), { recursive: true });
      fs.copyFileSync(pf.file, bak);
      console.log(`  ${ok("")} 已备份：${bak}`);
      const next = applyPlanToProfileJson(st, plan);
      fs.writeFileSync(pf.file, JSON.stringify(next, null, 2) + "\n", "utf8");
      console.log(`  ${ok("")} 已写入：${pf.file}`);
      for (const ch of pf.depChanges) {
        console.log(`      ${ch.kind === "add" ? "+" : "~"} dependencies["${ch.name}"] = ${JSON.stringify(ch.to)}`);
      }
      for (const n of pf.bundleAdds) console.log(`      + bundles[] += ${n}`);
    } catch (e) {
      console.log(`  ${bad("")} 写入失败：${e.message}`);
      errors.push(e.message);
    }
  }

  // 变更 3：profile node_modules 链接（与 pnpm 的 link: 等价，免装依赖即可被 loader 解析）
  section("变更 3：profile node_modules 链接");
  {
    const nmRoot = path.join(st.profileDir, "node_modules");
    let made = 0;
    let kept = 0;
    let failed = 0;
    for (const pl of st.plugins) {
      const name = pl.pkg?.name;
      if (!name) continue;
      const parts = name.startsWith("@") ? name.split("/") : [null, name];
      const linkPath = parts[0] ? path.join(nmRoot, parts[0], parts[1]) : path.join(nmRoot, parts[1]);
      const exists = safeLstat(linkPath);
      if (exists) {
        const cur = linkTarget(linkPath);
        if (cur && sameDir(cur, pl.dir)) { kept++; continue; }
      }
      try {
        fs.rmSync(linkPath, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(pl.dir, linkPath, "junction");
        console.log(`  ${ok("")} 已链接：${linkPath} → ${pl.dir}`);
        made++;
      } catch (e) {
        console.log(`  ${bad("")} 链接失败：${linkPath}：${e.message}`);
        console.log(info(`    → 可改用：cd "${path.join(st.profileDir, "..")}" && pnpm install`));
        failed++;
      }
    }
    if (!made && !failed) console.log(info(`（${kept} 个链接均已就绪，无需改动）`));
  }

  // 复检
  section("应用后复检");
  const st2 = collectState(opts);
  const plan2 = buildPlan(opts, st2);
  // 预设按**内容**判定，而不是按"链接目标解析结果"：
  // 宿主只认实体目录，而 Windows 上 `realpath` 对某些历史遗留目录会解析出别处的路径
  // （实测：内容与源逐字节一致、宿主也加载正常，却因为链接目标解析成了旧项目路径而报 ✗）。
  const ms2 = presetMaterializeState(st2.presetSrc, st2.presetLink);
  const presetOk = ms2.kind === "skip" || ms2.kind === "ok";
  console.log(`  ${presetOk ? ok("") : bad("")} 预设：${st2.presetLink}（内容${presetOk ? "与源一致" : `需刷新：${ms2.reason}`}${st2.presetLinkTarget ? `；链接目标解析为 ${st2.presetLinkTarget}` : ""}）`);
  const stillBad = [];
  for (const pl of st2.plugins) {
    const name = pl.pkg?.name;
    if (!name) continue;
    if (st2.profilePkg?.dependencies?.[name] === undefined || !sameDir(st2.profilePkg.dependencies[name], pl.dir)) stillBad.push(`${name} 未正确 link`);
    if (!(st2.profilePkg?.dsh?.profile?.bundles || []).includes(name)) stillBad.push(`${name} 不在 bundles`);
  }
  for (const pl of st2.plugins) {
    for (const it of checkPluginPackage(pl)) if (!it.ok) stillBad.push(`${it.item}：${it.note}`);
  }
  console.log(`  ${stillBad.length === 0 ? ok("") : bad("")} 插件 ${st2.plugins.length} 个：${stillBad.length === 0 ? "全部就绪" : `${stillBad.length} 项仍有问题`}`);
  for (const s of stillBad) console.log(`      ${c.red}·${c.reset} ${s}`);
  if (plan2.stale.length > 0) {
    console.log(`  ${warn("")} 陈旧项 ${plan2.stale.length} 个（未自动删除，请人工确认）：${plan2.stale.map((s) => s.name).join(", ")}`);
  }

  section("接下来请执行");
  console.log("  " + nextSteps(opts, st2, plan2, { changed: true }).split("\n").join("\n  "));

  return errors.length + stillBad.length;
}

// ────────────────────────────────────────────────────────────── main

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(bad(e.message));
    console.error(c.dim + "用 --help 看用法" + c.reset);
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const st = collectState(opts);
  const plan = buildPlan(opts, st);

  if (opts.action === "check") {
    const failed = printCheck(opts, st, plan);
    return failed > 0 ? 1 : 0;
  }
  if (opts.action === "dry-run") {
    printDryRun(opts, st, plan);
    return 0;
  }
  const problems = runApply(opts, st, plan);
  return problems > 0 ? 1 : 0;
}

process.exitCode = main();
