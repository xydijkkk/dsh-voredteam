// MCP 注册表**内容完整性**核对：结构字段齐备 + tools 清单与计数一致 + 占位符规范 + 文档互指。
//
// 为什么单独一个测试：占位符化（去本机路径）是用脚本批量改写的，最容易的副作用就是
// 行内数组/环境映射被改坏、条目数悄悄变化、或者 tools 清单与 tools_count 对不上。
//
// 用法：node --no-warnings tests/mcp-integrity.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = path.join(ROOT, "mcp", "registry.yaml");
const NOTES = path.join(ROOT, "mcp", "NOTES.md");

let pass = 0, fail = 0;
const ok = (label, fn) => {
  try { fn(); pass++; console.log(`  \u2713 ${label}`); }
  catch (e) { fail++; console.log(`  \u2717 ${label}\n      ${e.message}`); }
};

const text = fs.readFileSync(REG, "utf8");
const lines = text.split(/\r?\n/);

/** 逐条目解析（极简行解析，与 vore-settings 的 mcp.list 同款口径）。 */
const servers = [];
let cur = null, inTools = false, toolsBuf = "";
for (const raw of lines) {
  const line = raw.replace(/\t/g, "  ");
  const t = line.trim();
  if (t === "" || t.startsWith("#")) continue;
  const idm = t.match(/^-\s*id:\s*(\S+)/);
  if (idm) { cur = { id: idm[1], tools: [], fields: {} }; servers.push(cur); inTools = false; continue; }
  if (!cur) continue;
  if (/^tools:\s*\[/.test(t)) {
    const rest = t.replace(/^tools:\s*\[/, "");
    if (rest.includes("]")) { // 单行数组：tools: [...] 或 tools: []
      cur.tools = rest.replace(/\]\s*$/, "").split(",").map((s) => s.trim()).filter(Boolean);
      inTools = false;
    } else { inTools = true; toolsBuf = rest; }
    continue;
  }
  if (inTools) {
    if (t.includes("]")) { inTools = false; toolsBuf += " " + t.replace(/\]$/, ""); cur.tools = toolsBuf.split(",").map((s) => s.trim()).filter(Boolean); }
    else toolsBuf += " " + t;
    continue;
  }
  const kv = t.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
  if (kv) cur.fields[kv[1]] = kv[2].trim();
}

console.log(`MCP 注册表（${path.relative(ROOT, REG)}）`);
console.log(`  解析到 ${servers.length} 条`);

ok("条目数 19（与审计基线一致）", () => {
  if (servers.length !== 19) throw new Error(`条目数 ${servers.length}，应为 19`);
});

ok("每条都有 id / name / transport；http|sse 有 url、stdio 有 command", () => {
  const bad = [];
  for (const s of servers) {
    const f = s.fields;
    if (!f.name) bad.push(`${s.id}: 缺 name`);
    if (!f.transport) bad.push(`${s.id}: 缺 transport`);
    if (/^(http|sse)$/.test(String(f.transport).replace(/['"]/g, "")) && !f.url) bad.push(`${s.id}: http/sse 缺 url`);
    if (/^stdio$/.test(String(f.transport).replace(/['"]/g, "")) && !f.command) bad.push(`${s.id}: stdio 缺 command`);
  }
  if (bad.length) throw new Error(bad.join("; "));
});

ok("tools 清单与 tools_count 一致（有清单的条目）", () => {
  const bad = [];
  for (const s of servers) {
    const c = Number(String(s.fields.tools_count ?? "0").replace(/['"]/g, ""));
    if (!Number.isFinite(c)) continue;
    if (s.tools.length === 0 && c > 0) bad.push(`${s.id}: tools_count=${c} 但没有 tools 清单`);
    else if (s.tools.length > 0 && c !== s.tools.length) bad.push(`${s.id}: 清单 ${s.tools.length} ≠ count ${c}`);
  }
  if (bad.length) throw new Error(bad.join("; "));
});

ok("路径字段用 ${VAR} 占位符，且不含盘符绝对路径", () => {
  const pathFields = ["command", "args", "env", "env_file", "extension_jar", "require_running", "note"];
  const bad = [];
  for (const s of servers) {
    for (const f of pathFields) {
      const v = s.fields[f];
      if (!v) continue;
      if (/[A-Za-z]:[\\/]/.test(v.replace(/https?:\/\//g, ""))) bad.push(`${s.id}.${f} 含盘符路径`);
    }
  }
  if (bad.length) throw new Error(bad.join("; "));
  if (!/\$\{VORE_TOOLS_DIR\}/.test(text)) throw new Error("未见 ${VORE_TOOLS_DIR} 占位符（占位符化可能被回退）");
});

ok("占位符只使用已声明的变量名（忽略注释里的 ${VAR} 写法）", () => {
  const declared = new Set(["VORE_TOOLS_DIR", "VORE_CLOWN_DIR", "VORE_UV_BIN_DIR", "JAVA_HOME", "HOME"]);
  const body = text.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n");
  const used = new Set([...body.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]));
  const unknown = [...used].filter((v) => !declared.has(v));
  if (unknown.length) throw new Error(`未声明的变量：${unknown.join(", ")}（头部说明里应列出）`);
});

ok("NOTES.md 的启动清单与注册表条目互相覆盖", () => {
  const notes = fs.readFileSync(NOTES, "utf8");
  const ids = servers.map((s) => s.id);
  // 允许极少数只在注册表出现的纯索引/指位条目（NOTES.md §8.10 以"不注册为 MCP"的口径说明）
  const indexOnly = ["burp-mcp-server-src", "burp-mcp-all-jar-pin", "ctf-tool-index-source", "cyberstrikeai-tool-recipes", "chrome-mcp-server", "artex-main", "openai-sec"];
  const unexplained = ids.filter((id) => !notes.includes(id) && !indexOnly.includes(id));
  if (unexplained.length) throw new Error(`NOTES.md 未提及：${unexplained.join(", ")}`);
});

ok("registered: false / 排除项标记保留", () => {
  const falseCount = (text.match(/registered:\s*false/g) ?? []).length;
  if (falseCount < 5) throw new Error(`registered:false 只剩 ${falseCount} 条（审计基线为 5）`);
  if (!/hexstrike/i.test(text)) throw new Error("缺少「不登记 hexstrike」的口径说明");
});

console.log(`\n结果：通过 ${pass} 项${fail ? `，未通过 ${fail} 项` : ""}`);
process.exit(fail ? 1 : 0);
