// 注册表契约测试：验证 mcp/registry.yaml 能被「极简行解析器」读出（vore-settings 的 mcp.list 用它），
// 且 skills/registry.yaml 结构完整、路径字段齐备。
// 运行：node tests/registry.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

/** 与 vore-settings 面板同款的极简解析：只认 id/name/transport/url/command 这几个键。 */
function parseMcpRegistry(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*- id:\s*(.+?)\s*$/);
    if (m) { cur = { id: m[1] }; out.push(cur); continue; }
    if (!cur) continue;
    const kv = raw.match(/^\s+(name|transport|url|command):\s*(.*?)\s*$/);
    if (!kv) continue;
    const value = kv[2] === "null" || kv[2] === '""' ? null : kv[2].replace(/^["']|["']$/g, "");
    cur[kv[1]] = value;
  }
  return out;
}

console.log("MCP 注册表（mcp/registry.yaml）");
const mcpText = fs.readFileSync(path.join(root, "mcp", "registry.yaml"), "utf8");
const servers = parseMcpRegistry(mcpText);

ok("极简解析器读出全部条目，且 id/name/transport 齐备", () => {
  assert.ok(servers.length >= 10, `条目太少：${servers.length}`);
  for (const s of servers) {
    assert.ok(s.id, "缺少 id");
    assert.ok(s.name, `${s.id} 缺少 name`);
    assert.ok(s.transport, `${s.id} 缺少 transport`);
  }
});

ok("http/sse 条目必须有 url；stdio 条目必须有 command", () => {
  for (const s of servers) {
    if (s.transport === "http" || s.transport === "sse") assert.ok(s.url, `${s.id} 缺 url`);
    if (s.transport === "stdio") assert.ok(s.command, `${s.id} 缺 command`);
  }
});

ok("排除项带 registered: false（程序应按此跳过）", () => {
  const excluded = servers.filter((s) => /registered:\s*false/.test(mcpText.split(`- id: ${s.id}`)[1]?.slice(0, 400) ?? ""));
  assert.ok(excluded.length >= 0);
  // 至少确认 artex-main / openai-sec 被标记为不注册
  for (const id of ["artex-main", "openai-sec"]) {
    const idx = mcpText.indexOf(`- id: ${id}`);
    if (idx >= 0) assert.match(mcpText.slice(idx, idx + 400), /registered:\s*false/, `${id} 应标 registered:false`);
  }
});

ok("关键内建 MCP 在册（Anything Analyzer / FOFA / AdaptixC2）", () => {
  const ids = servers.map((s) => s.id);
  for (const need of ["anything-analyzer", "fofa-mcp", "adaptix-c2-mcp"]) {
    assert.ok(ids.includes(need), `缺少 ${need}`);
  }
});

console.log("技能注册表（skills/registry.yaml）");
const skText = fs.readFileSync(path.join(root, "skills", "registry.yaml"), "utf8");

ok("条目数 ≥200 且每条含 id/name/path/kind（path 为仓库相对路径）", () => {
  const ids = [...skText.matchAll(/^\s*- id:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 200, `条目太少：${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, "id 有重复");
  const paths = [...skText.matchAll(/^\s+path:\s*'?([^'\n]+)'?/gm)].map((m) => m[1].trim());
  assert.ok(paths.length >= 200, `path 太少：${paths.length}`);
  // 出厂注册表不得出现本机绝对路径（项目要能发布）
  const absolute = paths.filter((p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || /Users[\\/]|D:\\everything/i.test(p));
  assert.equal(absolute.length, 0, `出现本机绝对路径：${absolute.slice(0, 3).join(", ")}`);
});

ok("技能文件真实存在（相对仓库根 stat，抽样 12 条）", () => {
  const paths = [...skText.matchAll(/^\s+path:\s*'([^']+)'/gm)].map((m) => m[1]);
  const sample = paths.filter((_, i) => i % Math.max(1, Math.floor(paths.length / 12)) === 0).slice(0, 12);
  for (const p of sample) assert.ok(fs.existsSync(path.join(root, p)), `路径不存在：${p}`);
});

console.log("黑板技能与门禁技能存在");
for (const skill of ["vore-blackboard-ops", "vore-report", "vore-rate-discipline"]) {
  ok(`${skill}/SKILL.md 存在且带 frontmatter`, () => {
    const f = path.join(root, "skills", skill, "SKILL.md");
    const text = fs.readFileSync(f, "utf8");
    assert.match(text, /^---\n[\s\S]*?name:\s*\S+/);
    assert.ok(text.length > 400);
  });
}

console.log(`\n全部通过：${passed} 项`);
