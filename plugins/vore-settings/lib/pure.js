// vore-settings / lib/pure.js —— 纯函数层（无副作用、无 DSH 依赖）。
//
// 这里只放可离线自测的逻辑：默认设置与深合并、掩码、JSON 文件读写、
// 目录扫描、极简 YAML 行解析。lib/index.js 从这里再导出，tests/settings.test.mjs
// 直接 import 本文件取断言目标（不触发任何 tools/webServer 注册）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 本项目根目录（由本文件位置推导：plugins/vore-settings/lib → 上溯三级）。
 * 出厂默认设置一律用**项目相对**路径推导，绝不写死本机绝对路径——项目要能发布。
 */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 内置技能根（全部在仓库内，真实文件）：见 vendor/THIRD-PARTY.md。 */
export const DEFAULT_SKILL_ROOTS = [
  path.join(PROJECT_ROOT, "skills"),
  path.join(PROJECT_ROOT, "vendor", "skills", "claude-red"),
  path.join(PROJECT_ROOT, "vendor", "skills", "claude-red-legacy"),
  path.join(PROJECT_ROOT, "vendor", "skills", "reverse-skill"),
  path.join(PROJECT_ROOT, "vendor", "skills", "anthropic"),
  path.join(PROJECT_ROOT, "vendor", "skills", "clown-src-skill"),
];

/**
 * 技能扫描硬上限（条）。
 * 500 会把第 4 个技能根整根挤掉（实测：本机 4 个根合计 944 条，reverse-skill-main 一条都搜不到），
 * 故放宽到 3000 —— 覆盖面优先，单次扫描仍在秒级（有深度 6 + 单文件 256 KB + 总量 8 MB 三重保护）。
 */
export const SKILL_SCAN_LIMIT = 3000;
/** 技能搜索返回条数上限。 */
export const SKILL_SEARCH_LIMIT = 20;
/** 技能目录递归深度上限（防大目录树挂死）。 */
const SKILL_MAX_DEPTH = 6;
/** MCP registry 行解析上限（防异常文件）。 */
const MCP_MAX_LINES = 20000;

/** 用户配置文件位置：~/.dsh/voredteam/settings.json */
export const SETTINGS_HOME = path.join(os.homedir(), ".dsh", "voredteam");
export const SETTINGS_PATH = path.join(SETTINGS_HOME, "settings.json");

export function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** 出厂默认设置（深合并的基底）。 */
export function defaultSettings() {
  return {
    fofa: { apiKey: "", baseUrl: "https://fofoapi.com", backupUrl: "http://107.173.248.139:18999" },
    shodan: { apiKey: "" },
    yescaptcha: { apiKey: "" },
    grokGateway: { baseUrl: "http://127.0.0.1:3001/", apiKey: "" },
    rate: { defaultRps: 5, wafRps: 1, fuzzSampleFirst: 50 },
    skills: {
      roots: [...DEFAULT_SKILL_ROOTS],
    },
    mcp: {
      enabled: ["anything-analyzer", "adaptix-c2"],
      registryPath: path.join(PROJECT_ROOT, "mcp", "registry.yaml"),
    },
  };
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 把 patch 并入 base：普通对象递归、数组整表替换、标量覆盖。
 * 空字符串是「显式清除」值（apiKey 清空语义），与缺字段（保留原值）区分开。
 */
export function mergeInto(base, patch) {
  const out = isPlainObject(base) ? base : {};
  if (!isPlainObject(patch)) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) mergeInto(out[k], v);
    else if (Array.isArray(v)) out[k] = v.slice();
    else out[k] = v;
  }
  return out;
}

/** 在默认值上合并已存设置（缺分组自动补齐，未知分组保留）。 */
export function withDefaults(stored) {
  const merged = defaultSettings();
  mergeInto(merged, stored ?? {});
  return merged;
}

/** 掩码：前 6 位 + "…"；空/非字符串 → ""。 */
export function maskKey(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (s === "") return "";
  if (s.length <= 6) return `${s[0] ?? ""}…`;
  return `${s.slice(0, 6)}…`;
}

/** 技能文档读取上限（超限只按大小跳过，不读入内存）。 */
export const SKILL_MAX_BYTES = 256 * 1024;
/** 单次扫描累计读取字节上限（防大目录树 OOM）。 */
/**
 * 单次扫描的总字节预算。
 * 原为 8 MB，实测被 Anthropic 的 817 个 SKILL.md 在走到第 3 个根时就吃光，
 * 导致后面的根（Claude-Red）整根漏扫（skipped 记 86 条"超过总字节预算"）→ 放宽到 64 MB。
 */
export const SKILL_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** 读设置文件。仅「文件不存在」回默认值；**内容损坏一律抛错**（静默回默认会在下次写盘时抹掉全部密钥）。 */
export function readSettingsFile(file = SETTINGS_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return defaultSettings();
    throw e;
  }
  try {
    return withDefaults(JSON.parse(raw));
  } catch (e) {
    const err = new Error(`设置文件损坏：${file}（${e.message}）——已拒绝回退默认值（否则下次保存会覆盖全部密钥）。请修复或删除该文件。`);
    err.code = "SETTINGS_PARSE_ERROR";
    throw err;
  }
}

/** 写设置文件：先写临时文件再 rename 原子替换，并保留上一版 .bak。 */
export function writeSettingsFile(settings, file = SETTINGS_PATH) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(settings, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, `${file}.bak`); } catch { /* 备份失败不阻塞写入 */ }
    }
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 清理失败忽略 */ }
    throw e;
  }
  return file;
}

/** 读原始设置文件（区分「文件不存在」与「内容为空」）。 */
export function loadSettings(file = SETTINGS_PATH) {
  return readSettingsFile(file);
}

/** settings.get 的对外投影：apiKey 一律掩码 + hasKey 标记。 */
export function maskSettings(s) {
  const src = withDefaults(s ?? {});
  const key = { apiKey: maskKey(src.fofa?.apiKey), hasKey: maskKey(src.fofa?.apiKey) !== "" };
  return {
    fofa: { ...src.fofa, apiKey: key.apiKey, hasKey: key.hasKey },
    shodan: { ...src.shodan, apiKey: maskKey(src.shodan?.apiKey), hasKey: maskKey(src.shodan?.apiKey) !== "" },
    yescaptcha: { ...src.yescaptcha, apiKey: maskKey(src.yescaptcha?.apiKey), hasKey: maskKey(src.yescaptcha?.apiKey) !== "" },
    grokGateway: { ...src.grokGateway, apiKey: maskKey(src.grokGateway?.apiKey), hasKey: maskKey(src.grokGateway?.apiKey) !== "" },
    rate: clone(src.rate),
    skills: clone(src.skills),
    mcp: clone(src.mcp),
  };
}

/** 允许 settings.set 的部分更新分组白名单（防任意键注入）。 */
export const WRITABLE_GROUPS = ["fofa", "shodan", "yescaptcha", "grokGateway", "rate", "skills", "mcp"];

/** 限速字段合法区间（[下限, 上限]）——门禁阈值必须落在区间内。 */
export const RATE_BOUNDS = {
  defaultRps: [1, 200],
  wafRps: [0.1, 50],
  fuzzSampleFirst: [1, 500],
};

/**
 * 技能根合法性：拒绝盘根与一级目录（例如 C:\ 或 C:\Users）——这类根一旦被配置，
 * 扫描会在几秒内遍历整盘（审计发现：roots 无边界校验可任意读盘）。
 * 返回 null 表示合法，否则返回拒绝原因。
 */
export function rootRejectReason(root) {
  const raw = String(root ?? "").trim();
  if (raw === "") return "空路径";
  let real;
  try { real = safeReal(raw); } catch { return "无法解析"; }
  if (real === null) return "路径不存在或不可访问";
  const parsed = path.parse(real);
  const rel = path.relative(parsed.root, real);
  const depth = rel === "" ? 0 : rel.split(path.sep).filter(Boolean).length;
  if (depth === 0) return "拒绝以盘根作为技能根";
  if (depth === 1) return "拒绝以一级目录作为技能根（范围过大）";
  return null;
}

/**
 * 施加一次部分更新（原地改 current 并返回它）。
 * payload 形如 { fofa: { apiKey: "..." }, skills: { roots: ["a","b"] } }；
 * 非白名单分组丢弃，空对象不产生任何改动。
 */
export function applyPatch(current, payload) {
  const target = withDefaults(current);
  const applied = [];
  const notes = [];
  if (!isPlainObject(payload)) return { settings: target, applied, notes };
  for (const g of WRITABLE_GROUPS) {
    const patch = payload[g];
    if (!isPlainObject(patch)) continue;
    if (Object.keys(patch).length === 0) continue;
    mergeInto(target[g], patch);
    applied.push(g);
  }
  // rate 分组：越界值夹紧（门禁阈值不允许被设成 0/负数——那会变成"假门禁"）
  for (const [k, [lo, hi]] of Object.entries(RATE_BOUNDS)) {
    const v = Number(target.rate?.[k]);
    if (!Number.isFinite(v)) { target.rate[k] = defaultSettings().rate[k]; notes.push(`rate.${k} 非数值，已回默认`); continue; }
    if (v < lo || v > hi) { target.rate[k] = Math.min(hi, Math.max(lo, v)); notes.push(`rate.${k}=${v} 越界，已夹紧为 ${target.rate[k]}`); }
  }
  return { settings: target, applied, notes };
}

// ── 技能目录扫描 ────────────────────────────────────────────────────────────

/** 从 SKILL.md 正文抓 name / description（支持 YAML frontmatter，退化到首个标题/首行）。 */
export function parseSkillDoc(text) {
  const out = { name: "", desc: "" };
  const src = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  let body = src;
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = src.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const k = m[1].toLowerCase();
      const v = unquote(m[2]);
      if (k === "name" && out.name === "") out.name = v;
      if ((k === "description" || k === "summary") && out.desc === "") out.desc = v;
    }
  }
  if (out.name === "") {
    const h = body.match(/^#\s+(.+)$/m);
    if (h) out.name = h[1].trim();
  }
  if (out.desc === "") {
    const rest = body.replace(/^#.*$/m, "");
    const p = rest.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#") && !l.startsWith("---"));
    if (p) out.desc = p.slice(0, 300);
  }
  return out;
}

/**
 * 扫描技能根：每个含 SKILL.md 的目录产出一条 {name,path,desc}。
 * 单根不存在/不可读只计入 skipped，不抛；条数上限 SKILL_SCAN_LIMIT。
 */
export function scanSkills(roots, { limit = SKILL_SCAN_LIMIT, maxDepth = SKILL_MAX_DEPTH, maxTotalBytes = SKILL_MAX_TOTAL_BYTES } = {}) {
  const list = [];
  const skipped = [];
  const seen = new Set();
  let bytesRead = 0;
  const walk = (dir, depth) => {
    if (list.length >= limit || depth > maxDepth || bytesRead >= maxTotalBytes) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      skipped.push({ path: dir, reason: e?.code ?? e?.message ?? "unreadable" });
      return;
    }
    const real = safeReal(dir);
    if (real !== null) {
      if (seen.has(real)) return;
      seen.add(real);
    }
    const doc = entries.find((e) => e.isFile() && e.name.toLowerCase() === "skill.md");
    if (doc) {
      const full = path.join(dir, doc.name);
      let parsed = { name: path.basename(dir), desc: "" };
      try {
        const st = fs.statSync(full);
        if (st.size > SKILL_MAX_BYTES || bytesRead + st.size > maxTotalBytes) {
          skipped.push({ path: full, reason: st.size > SKILL_MAX_BYTES ? `超过单文件上限 ${SKILL_MAX_BYTES}B` : "超过本次扫描总字节预算" });
        } else {
          bytesRead += st.size;
          parsed = parseSkillDoc(fs.readFileSync(full, "utf8"));
          list.push({ name: parsed.name || path.basename(dir), path: full, desc: parsed.desc });
        }
      } catch { /* 读不到正文就只留目录名 */
        list.push({ name: parsed.name || path.basename(dir), path: full, desc: parsed.desc });
      }
    } else if (depth === 0) {
      // 技能根**顶层**的扁平技能 `<root>/<name>.md`：宿主的 skill-filesystem 认这种形态，
      // 检索面也必须认，否则内置的"规范化扁平技能"（如 vendor/skills/claude-red-legacy/*.md）
      // 能装却不能搜 —— 装载面与检索面会不一致。
      for (const e of entries) {
        if (list.length >= limit) break;
        if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
        const full = path.join(dir, e.name);
        try {
          const st = fs.statSync(full);
          if (st.size > SKILL_MAX_BYTES || bytesRead + st.size > maxTotalBytes) {
            skipped.push({ path: full, reason: st.size > SKILL_MAX_BYTES ? `超过单文件上限 ${SKILL_MAX_BYTES}B` : "超过本次扫描总字节预算" });
            continue;
          }
          bytesRead += st.size;
          const parsed = parseSkillDoc(fs.readFileSync(full, "utf8"));
          if (!parsed.name || !parsed.desc) continue; // 与宿主一致：没有 name/description 的扁平文件不算技能
          list.push({ name: parsed.name, path: full, desc: parsed.desc });
        } catch { /* 读不到就跳过 */ }
      }
    }
    for (const e of entries) {
      if (list.length >= limit) return;
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const root of Array.isArray(roots) ? roots : []) {
    const dir = typeof root === "string" ? root.trim() : "";
    if (dir === "") continue;
    if (list.length >= limit) break;
    const reject = rootRejectReason(dir);
    if (reject !== null) { skipped.push({ path: dir, reason: reject }); continue; }
    walk(dir, 0);
  }
  return { total: list.length, truncated: list.length >= limit, list, skipped, bytesRead };
}

function safeReal(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    try { return fs.realpathSync(p); } catch { return null; }
  }
}

/** 按关键词在已扫描技能里检索（name/desc/path），返回前 limit 条。 */
export function searchSkills(roots, keyword, limit = SKILL_SEARCH_LIMIT) {
  const kw = String(keyword ?? "").trim().toLowerCase();
  const { list } = scanSkills(roots);
  if (kw === "") return list.slice(0, limit);
  return list
    .filter((s) => `${s.name}\n${s.desc}\n${s.path}`.toLowerCase().includes(kw))
    .slice(0, limit);
}

// ── 极简 YAML 行解析（不引依赖，只吃 MCP registry 的几种行）────────────────

function unquote(v) {
  let s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    s = s.slice(1, -1);
  }
  // 行内注释：仅剥离「空格 + #」形式，避免吃掉 URL 里的 #
  s = s.replace(/\s+#.*$/, "");
  return s.trim();
}

function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "on" || s === "1";
}

/**
 * 解析 MCP registry YAML 的服务器清单。
 * 只认这几种行：`- id:` / `name:` / `transport:` / `url:` / `command:` / `enabled:`，
 * 以及 `servers:`/`mcpServers:` 之类的容器键。缩进只用于识别「新的列表项」。
 * @returns {{servers: Array<object>, total: number}}
 */
/**
 * 展开字符串里的 `${VAR}` / `%VAR%` 占位符。
 *
 * **为什么需要**：内置 MCP 注册表要能发布，就不能写死本机绝对路径；外部程序位置一律写成占位符，
 * 由运行环境展开。缺失的变量**必须显式报告**（否则同一条目会以空路径被当成"可运行"，
 * 错误要等到真正调用 MCP 时才暴露）。
 * @param {string} value
 * @param {Record<string,string|undefined>} [env]
 * @returns {{value:string, missing:string[]}}
 */
export function expandEnvPlaceholders(value, env = process.env) {
  const text = String(value ?? "");
  const missing = new Set();
  const expand = (name) => {
    const v = env?.[name];
    if (v === undefined || v === "") { missing.add(name); return ""; }
    return v;
  };
  const out = text
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n) => expand(n))
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_m, n) => expand(n));
  return { value: out, missing: [...missing] };
}

/**
 * 极简 YAML 行解析：这是**故意**不用 YAML 库的（环境降级路径），不保证支持任意 YAML 语法糖，
 * 但求「预设文件被写坏时不会连带把插件启动搞挂」。
 * @param {string} text
 */
export function parseMcpRegistry(text) {  const servers = [];
  let current = null;
  const lines = String(text ?? "").split(/\r?\n/).slice(0, MCP_MAX_LINES);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed === "---" || trimmed === "...") continue;
    const item = trimmed.match(/^-\s*(.*)$/);
    if (item) {
      const rest = item[1];
      const kv = rest.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      const bare = rest.replace(/:.*$/, "").trim();
      const isBareId = !kv && /^[\w.@/-]+$/.test(bare);
      current = { id: isBareId ? bare : "", name: "", transport: "", url: "", command: "", enabled: null };
      servers.push(current);
      if (kv) assignMcpField(current, kv[1], kv[2]);
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    if (current !== null) assignMcpField(current, kv[1], kv[2]);
  }
  const clean = servers
    .map((s) => {
      // 占位符展开（${VAR} / %VAR%）：缺失变量记在 unresolved 上，由面板/工具面显式提示
      const missing = new Set();
      const perField = {};
      for (const f of ["url", "command", "extension_jar", "env_file", "args", "env"]) {
        if (typeof s[f] !== "string" || !s[f]) continue;
        const r = expandEnvPlaceholders(s[f]);
        s[f] = r.value;
        r.missing.forEach((m) => missing.add(m));
        if (r.missing.length) perField[f] = r.missing;
      }
      if (missing.size) s.unresolved = { vars: [...missing], fields: perField };
      return { ...s, id: s.id || s.name || "" };
    })
    .filter((s) => s.id !== "" || s.url !== "" || s.command !== "");
  return { servers: clean, total: clean.length, unresolved: clean.filter((s) => s.unresolved).length };
}

function assignMcpField(target, key, value) {
  const k = String(key).toLowerCase();
  const v = unquote(value);
  if (k === "id" || k === "key" || k === "server") { if (target.id === "") target.id = v; return; }
  if (k === "name" || k === "title") { if (target.name === "") target.name = v; return; }
  if (k === "transport" || k === "type") { if (target.transport === "") target.transport = v; return; }
  if (k === "url" || k === "endpoint") { if (target.url === "") target.url = v; return; }
  if (k === "command" || k === "cmd") { if (target.command === "") target.command = v; return; }
  if (k === "enabled" || k === "enable") { if (target.enabled === null) target.enabled = truthy(v); }
}

/**
 * 读 registry 文件 → {ok, exists, path, servers, note}。
 * 文件不存在不算错误：exists=false + 可读提示（面板顶部据此提示）。
 */
export function readMcpRegistry(file) {
  const p = typeof file === "string" ? file.trim() : "";
  if (p === "") return { ok: false, exists: false, path: "", servers: [], note: "未配置 mcp.registryPath" };
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (e) {
    const code = e?.code ?? "";
    const note = code === "ENOENT" ? `registry 文件不存在：${p}` : `registry 读取失败（${code || e?.message}）：${p}`;
    return { ok: true, exists: false, path: p, servers: [], note };
  }
  const { servers, unresolved } = parseMcpRegistry(text);
  const missingVars = [...new Set(servers.flatMap((s) => s.unresolved?.vars ?? []))];
  return {
    ok: true,
    exists: true,
    path: p,
    servers,
    total: servers.length,
    unresolved: unresolved ?? 0,
    missingVars,
    note: servers.length === 0
      ? "文件存在但未解析到服务器条目（只认 - id:/name:/transport:/url:/command: 行）"
      : (unresolved
        ? `${unresolved} 个条目含未展开的环境变量占位符（缺 ${missingVars.join(", ")}）——按 mcp/registry.local.example.yaml 或设环境变量后可运行`
        : ""),
  };
}
