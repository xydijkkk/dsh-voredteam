// vore-settings / lib/index.js —— 宿主平面插件（ESM）。
//
// 职责：
//   1) 把 dsh-voredteam 的运行期设置持久化到 ~/.dsh/voredteam/settings.json；
//   2) 提供设置面板的 HTTP 通道（同源栅栏 + CSRF，写法照抄 vore-blackboard）；
//   3) 提供模型侧工具面：vore_settings_get / vore_settings_set / vore_skill_search / vore_mcp_list。
// 纯逻辑（掩码、深合并、目录扫描、极简 YAML 解析）全在 ./pure.js，可离线自测。

import { defineTool } from "@deepseek-ai/dsh-tools";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  SETTINGS_PATH, WRITABLE_GROUPS, applyPatch, loadSettings, maskSettings, parseMcpRegistry,
  parseSkillDoc, readMcpRegistry, searchSkills, scanSkills, withDefaults, writeSettingsFile,
} from "./pure.js";

export const name = "vore-settings";
export const inject = ["tools", "webServer", "webRuntime"];
export const ROUTE_PATH = "/vore-settings";

const CSRF_TOKEN = crypto.randomBytes(24).toString("hex");
const FETCH_TIMEOUT_MS = 12000;

// 纯函数再导出，便于测试与其它插件复用
export {
  SETTINGS_PATH, applyPatch, loadSettings, maskSettings, parseMcpRegistry, parseSkillDoc,
  readMcpRegistry, scanSkills, searchSkills, withDefaults, writeSettingsFile,
};

// ── HTTP 栅栏（照抄 vore-blackboard 的四个辅助函数写法）─────────────────────

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function isTrustedRequest(req, trustedHosts) {
  const host = typeof req.headers?.host === "string" ? req.headers.host : "";
  if (host === "") return false;
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { return false; }
  const okHost = isLoopbackHostname(hostUrl.hostname) ||
    (trustedHosts ?? []).some((t) => { try { return new URL(`http://${t}`).hostname === hostUrl.hostname; } catch { return false; } });
  if (!okHost) return false;
  const origin = req.headers?.origin;
  if (typeof origin === "string" && origin !== "null") {
    try { if (new URL(origin).host !== hostUrl.host) return false; } catch { return false; }
  }
  return true;
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkCsrf(req) {
  const token = req.headers?.["x-dsh-csrf"];
  if (typeof token !== "string" || token.length !== CSRF_TOKEN.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CSRF_TOKEN)); } catch { return false; }
}

// ── 探活（真实发一次请求；失败给可读原因）───────────────────────────────────

/** 解码响应体：FOFA 系接口默认 gzip，手工解压避免依赖 undici 自动解压行为差异。 */
async function readText(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const enc = String(res.headers.get("content-encoding") ?? "").toLowerCase();
  try {
    if (enc.includes("gzip")) return zlib.gunzipSync(buf).toString("utf8");
    if (enc.includes("deflate")) return zlib.inflateSync(buf).toString("utf8");
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf).toString("utf8");
  } catch { /* 解压失败就按原文看 */ }
  return buf.toString("utf8");
}

function short(v, n = 200) {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function probe(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, redirect: "follow", signal: ctl.signal });
    return { res, text: await readText(res) };
  } finally {
    clearTimeout(timer);
  }
}

/** 探活失败的统一可读化：超时 / 连接被拒 / DNS / TLS / 其它。 */
function reasonOf(e) {
  const msg = e?.message ?? String(e);
  const code = e?.cause?.code ?? e?.code ?? "";
  if (e?.name === "AbortError" || code === "ABORT_ERR") return `请求超时（> ${FETCH_TIMEOUT_MS}ms）`;
  if (code === "ECONNREFUSED") return "连接被拒绝（服务未启动或被防火墙拦截）";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "域名解析失败（DNS/网络不可达）";
  if (code === "ECONNRESET") return "连接被重置（中间设备或服务端主动断开）";
  if (String(code).startsWith("ERR_TLS") || String(code).includes("CERT")) return `TLS 校验失败（${code}）`;
  if (code) return `${msg}（${code}）`;
  return msg;
}

async function testFofa(cfg) {
  const key = String(cfg?.apiKey ?? "").trim();
  if (key === "") return { ok: false, status: 0, note: "未配置 fofa apiKey" };
  const base = String(cfg?.baseUrl ?? "").trim() || "https://fofoapi.com";
  const url = `${base.replace(/\/+$/, "")}/api/v1/info/my?key=${encodeURIComponent(key)}`;
  try {
    const { res, text } = await probe(url, { headers: { accept: "application/json,*/*" } });
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON：按文本报 */ }
    if (data === null) return { ok: false, status: res.status, note: `非 JSON 响应：${short(text, 160)}` };
    const errcode = data.error_code ?? data.errorCode ?? data.code;
    if (errcode !== undefined && String(errcode) !== "0" && data.error !== false) {
      const msg = data.errmsg ?? data.msg ?? data.message ?? data.error ?? "";
      return { ok: false, status: data.error_code ?? res.status, note: `FOFA 拒绝：${errcode} ${short(msg, 120)}`.trim() };
    }
    if (data.error === true) return { ok: false, status: res.status, note: `FOFA 错误：${short(data.errmsg ?? data.msg ?? text, 120)}` };
    const who = data.email ?? data.username ?? data.name ?? "";
    const vip = data.isvip ?? data.vip_level ?? null;
    const fpoints = data.fofa_point ?? data.points ?? data.remain_free_point ?? null;
    const note = [who ? `账号 ${who}` : "账号信息已返回", vip === null ? "" : `VIP=${vip}`, fpoints === null ? "" : `积分=${fpoints}`]
      .filter(Boolean).join("，");
    return { ok: true, status: res.status, note };
  } catch (e) {
    return { ok: false, status: 0, note: reasonOf(e) };
  }
}

async function testShodan(cfg) {
  const key = String(cfg?.apiKey ?? "").trim();
  if (key === "") return { ok: false, status: 0, note: "未配置 shodan apiKey" };
  const url = `https://api.shodan.io/api-info?key=${encodeURIComponent(key)}`;
  try {
    const { res, text } = await probe(url, { headers: { accept: "application/json,*/*" } });
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    if (data === null) return { ok: false, status: res.status, note: `非 JSON 响应：${short(text, 160)}` };
    if (res.status === 401 || data.error) return { ok: false, status: res.status, note: `Shodan 拒绝：${short(data.error ?? text, 140)}` };
    const plan = data.plan ?? "-";
    const credits = data.credits ?? data.query_credits ?? "-";
    return { ok: true, status: res.status, note: `套餐 ${plan}，剩余查询额度 ${credits}` };
  } catch (e) {
    return { ok: false, status: 0, note: reasonOf(e) };
  }
}

async function testYescaptcha(cfg) {
  const key = String(cfg?.apiKey ?? "").trim();
  if (key === "") return { ok: false, status: 0, note: "未配置 yescaptcha apiKey" };
  const url = "https://api.yescaptcha.com/getBalance";
  try {
    const { res, text } = await probe(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json,*/*" },
      body: JSON.stringify({ clientKey: key }),
    });
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    if (data === null) return { ok: false, status: res.status, note: `非 JSON 响应：${short(text, 160)}` };
    if (data.errorId && data.errorId !== 0) {
      return { ok: false, status: res.status, note: `YesCaptcha 拒绝：${data.errorCode ?? data.errorId} ${short(data.errorDescription ?? "", 120)}`.trim() };
    }
    const bal = data.balance ?? data.data?.balance ?? null;
    return { ok: true, status: res.status, note: bal === null ? "密钥有效（未返回余额）" : `密钥有效，余额 ${bal}` };
  } catch (e) {
    return { ok: false, status: 0, note: reasonOf(e) };
  }
}

async function testGrokGateway(cfg) {
  const base = String(cfg?.baseUrl ?? "").trim();
  if (base === "") return { ok: false, status: 0, note: "未配置 grokGateway baseUrl" };
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const headers = { accept: "application/json,*/*" };
  if (String(cfg?.apiKey ?? "").trim() !== "") headers.authorization = `Bearer ${String(cfg.apiKey).trim()}`;
  let url = `${baseWithSlash}models`;
  try {
    let out = await probe(url, { headers });
    if (out.res.status === 404) out = await probe(baseWithSlash, { headers });
    const { res, text } = out;
    const alive = res.status < 500;
    const authNote = res.status === 401 || res.status === 403 ? "（网关在，但 apiKey 未通过鉴权）" : "";
    return {
      ok: alive,
      status: res.status,
      note: alive ? `网关存活（HTTP ${res.status}）${authNote}` : `网关返回 HTTP ${res.status}：${short(text, 120)}`,
    };
  } catch (e) {
    return { ok: false, status: 0, note: reasonOf(e) };
  }
}

/** settings.test 派发：只对已知 provider 做真实探活。 */
export async function runProviderTest(provider, settings) {
  const p = String(provider ?? "").toLowerCase();
  if (p === "fofa") return { provider: "fofa", ...(await testFofa(settings?.fofa)) };
  if (p === "shodan") return { provider: "shodan", ...(await testShodan(settings?.shodan)) };
  if (p === "yescaptcha") return { provider: "yescaptcha", ...(await testYescaptcha(settings?.yescaptcha)) };
  if (p === "grokgateway" || p === "grok") return { provider: "grokGateway", ...(await testGrokGateway(settings?.grokGateway)) };
  return { provider: p, ok: false, status: 0, note: `未知 provider：${provider}（支持 fofa/shodan/yescaptcha/grokGateway）` };
}

// ── apply ───────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const settingsPath = config?.settingsPath ?? SETTINGS_PATH;
  const trustedHosts = () => { try { return ctx.webRuntime?.trustedHosts ?? []; } catch { return []; } };
  const read = () => loadSettings(settingsPath);
  /** 读设置的安全包装：损坏的设置文件不静默回默认（否则下次保存会抹掉密钥），这里把错误显式回给调用方。 */
  const readSafe = () => {
    try { return { ok: true, settings: read() }; } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
  };

  const write = (settings) => {
    writeSettingsFile(settings, settingsPath);
    return settings;
  };

  /** 施加一次部分更新并落盘。 */
  const setGroups = (payload) => {
    const cur = readSafe();
    if (!cur.ok) return { ok: false, error: cur.error };
    const { settings, applied, notes } = applyPatch(cur.settings, payload);
    if (applied.length === 0) return { ok: false, error: `没有可写分组（白名单：${WRITABLE_GROUPS.join("/")}）` };
    write(settings);
    return { ok: true, applied, notes, settings: maskSettings(settings) };
  };

  // ── 模型侧工具面 ──────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: "vore_settings_get",
    description: "读 dsh-voredteam 运行期设置（~/.dsh/voredteam/settings.json）：测绘 API（fofa/shodan/yescaptcha/grokGateway）、限速、技能根、MCP registry。apiKey 只回前 6 位掩码 + hasKey，绝不回明文。",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `失败：${v.error}` }],
    },
    execute() {
      try {
        const cur = readSafe();
        if (!cur.ok) return { ok: false, error: cur.error };
        const s = maskSettings(cur.settings);
        const lines = [
          `settings: ${settingsPath}`,
          "## 测绘与辅助 API",
          `- fofa      key=${s.fofa.apiKey || "(空)"} baseUrl=${s.fofa.baseUrl} backupUrl=${s.fofa.backupUrl}`,
          `- shodan    key=${s.shodan.apiKey || "(空)"}`,
          `- yescaptcha key=${s.yescaptcha.apiKey || "(空)"}`,
          `- grokGateway baseUrl=${s.grokGateway.baseUrl} key=${s.grokGateway.apiKey || "(空)"}`,
          "## 限速",
          `- defaultRps=${s.rate.defaultRps} wafRps=${s.rate.wafRps} fuzzSampleFirst=${s.rate.fuzzSampleFirst}`,
          "## 技能根",
          ...(s.skills.roots.length ? s.skills.roots.map((r) => `- ${r}`) : ["- （未配置）"]),
          "## MCP",
          `- registryPath=${s.mcp.registryPath}`,
          `- enabled=${s.mcp.enabled.join(", ") || "(空)"}`,
        ];
        return { ok: true, text: lines.join("\n"), settings: s };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vore_settings_set",
    description: "写一个顶层设置分组（部分更新）。group ∈ fofa/shodan/yescaptcha/grokGateway/rate/skills/mcp；json 为该分组的 JSON 对象字符串，未出现的字段保留原值，空字符串表示清除（apiKey 清空即传 \"\"）。",
    parameters: {
      group: { type: "string", required: true, description: "分组名：fofa|shodan|yescaptcha|grokGateway|rate|skills|mcp" },
      json: { type: "string", required: true, description: '分组内容 JSON 对象字符串，如 {"apiKey":"xxxxxx"} 或 {"roots":["D:\\\\skills"]}' },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已写入 ${v.group}（${v.note}）` : `写入失败：${v.error}` }],
    },
    execute(args) {
      try {
        const group = String(args.group ?? "").trim();
        if (!WRITABLE_GROUPS.includes(group)) return { ok: false, error: `group 必须是 ${WRITABLE_GROUPS.join("/")} 之一` };
        let parsed = null;
        try { parsed = JSON.parse(String(args.json ?? "")); } catch { return { ok: false, error: "json 必须是合法 JSON 对象字符串" }; }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, error: "json 必须解析为对象（不是数组/标量）" };
        const r = setGroups({ [group]: parsed });
        if (!r.ok) return r;
        const fields = Object.keys(parsed).join(", ") || "(无字段)";
        return { ok: true, group, note: `更新字段 ${fields}；已落盘 ${settingsPath}`, settings: r.settings };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vore_skill_search",
    description: "在 skills.roots 里按关键词检索技能（匹配 SKILL.md 的 name/description/路径），返回最多 20 条路径。取到路径后用 read/glob 工具读该 SKILL.md 正文。",
    parameters: {
      keyword: { type: "string", required: true, description: "关键词（如 sql 注入 / webshell / 反编译 / jwt）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `检索失败：${v.error}` }],
    },
    execute(args) {
      try {
        const cur = readSafe();
      if (!cur.ok) return { ok: false, error: cur.error };
      const s = cur.settings;
        const rows = searchSkills(s.skills?.roots, args.keyword, 20);
        const text = rows.length === 0
          ? `未命中「${args.keyword}」（已扫 ${s.skills?.roots?.length ?? 0} 个技能根）`
          : rows.map((r) => `- ${r.name}${r.desc ? ` —— ${r.desc.slice(0, 110)}` : ""}\n    ${r.path}`).join("\n");
        return { ok: true, text, count: rows.length };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vore_mcp_list",
    description: "读 MCP registry（mcp.registryPath）的服务器清单与启用状态。文件不存在时返回空清单并给出提示；只解析 - id:/name:/transport:/url:/command:/enabled: 这几种行。",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `读取失败：${v.error}` }],
    },
    execute() {
      try {
        const cur = readSafe();
      if (!cur.ok) return { ok: false, error: cur.error };
      const s = cur.settings;
        const reg = readMcpRegistry(s.mcp?.registryPath);
        const enabled = new Set(s.mcp?.enabled ?? []);
        const lines = [`registry: ${reg.path || "(未配置)"}（${reg.exists ? "已读取" : "文件不存在"}）`];
        if (reg.note) lines.push(`提示：${reg.note}`);
        if (reg.servers.length) {
          lines.push("## 服务器");
          for (const srv of reg.servers) {
            const target = srv.url || srv.command || "(无 url/command)";
            lines.push(`- ${srv.id} ${enabled.has(srv.id) ? "[启用]" : "[停用]"} ${srv.name || ""} ${srv.transport ? `(${srv.transport})` : ""} → ${target}`);
          }
        }
        return { ok: true, text: lines.join("\n"), servers: reg.servers, enabled: [...enabled], exists: reg.exists, path: reg.path, note: reg.note };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // ── 面板 HTTP 通道 ────────────────────────────────────────────────────────

  const dispatch = async (endpoint, payload) => {
    switch (endpoint) {
      case "settings.get": {
        const cur = readSafe();
        return cur.ok ? { ok: true, path: settingsPath, settings: maskSettings(cur.settings) } : { ok: false, error: cur.error };
      }
      case "settings.set":
        return setGroups(payload?.settings ?? payload?.patch ?? payload ?? {});
      case "settings.test": {
        const cur = readSafe();
        if (!cur.ok) return { ok: false, error: cur.error };
        const r = await runProviderTest(payload?.provider, cur.settings);
        return { ok: r.ok, provider: r.provider, status: r.status, note: r.note };
      }
      case "skills.scan": {
        const cur = readSafe();
        if (!cur.ok) return { ok: false, error: cur.error };
        // 技能根只认**落盘配置**，不接受请求体传入（防经面板越权遍历任意目录）
        const ignored = Array.isArray(payload?.roots) ? payload.roots.length : 0;
        const r = scanSkills(cur.settings.skills?.roots);
        return {
          ok: true, roots: cur.settings.skills?.roots ?? [], total: r.total, truncated: r.truncated,
          list: r.list, skipped: r.skipped, bytesRead: r.bytesRead,
          note: ignored ? `请求体传入的 roots（${ignored} 项）已忽略——技能根只能通过 settings.set 落盘后生效` : "",
        };
      }
      case "mcp.list": {
        const cur = readSafe();
        if (!cur.ok) return { ok: false, error: cur.error };
        const reg = readMcpRegistry(cur.settings.mcp?.registryPath);
        return {
          ok: true, path: reg.path, exists: reg.exists, note: reg.note,
          servers: reg.servers, enabled: cur.settings.mcp?.enabled ?? [],
          // 含未展开 ${VAR} 的条目数（内置注册表可发布靠占位符，缺变量时要显式提示）
          unresolved: reg.unresolved ?? 0, missingVars: reg.missingVars ?? [],
        };
      }
      default:
        throw new Error(`unknown endpoint ${endpoint}`);
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      if (!isTrustedRequest(req, trustedHosts())) { res.writeHead(403); res.end("forbidden"); return; }
      let pathname = "";
      try { pathname = new URL(req.url ?? "/", "http://x").pathname; } catch { pathname = ""; }
      if (req.method === "GET" && pathname === ROUTE_PATH + "/csrf") { send(200, { token: CSRF_TOKEN }); return; }
      if (req.method !== "POST") { res.writeHead(405); res.end("method not allowed"); return; }
      if (!checkCsrf(req)) { res.writeHead(403); res.end("csrf token missing or invalid"); return; }
      let endpoint = "";
      try { endpoint = decodeURIComponent(pathname.slice(ROUTE_PATH.length)).replace(/^\/+/, ""); } catch { endpoint = ""; }
      try {
        const raw = await readBody(req);
        const payload = raw === "" ? {} : JSON.parse(raw);
        send(200, await dispatch(endpoint, payload));
      } catch (e) {
        send(400, { ok: false, error: e?.message ?? String(e) });
      }
    },
  }), "vore-settings: web route");
}
