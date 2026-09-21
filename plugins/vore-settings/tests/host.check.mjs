// vore-settings / tests/host.check.mjs —— 宿主面端到端自检（离线：只写临时目录，不联网）。
//
// 真的把 lib/index.js 加载起来，在假 ctx 上跑：
//   工具注册 → HTTP 路由注册 → 同源栅栏 / CSRF 栅栏 → settings.get/set/test、
//   skills.scan、mcp.list 的完整往返 → 四个模型工具的 execute 与 render。
//
// 运行：node tests/host.check.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const mod = await import("../lib/index.js");

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-settings-host-"));
const settingsPath = path.join(dir, "voredteam", "settings.json");
const REPO_REGISTRY = path.join(REPO_ROOT, "mcp", "registry.yaml");

const tools = [];
const effects = [];
const routes = [];

const ctx = {
  tools: { register: (t) => tools.push(t) },
  effect(fn, label) { effects.push({ label, dispose: fn() }); },
  webServer: { register: (route) => { routes.push(route); return () => {}; } },
  webRuntime: { trustedHosts: [] },
};

mod.apply(ctx, { settingsPath });

console.log(`vore-settings 宿主面自检（settings 落在 ${settingsPath}）`);
console.log("注册面");

ok("注册 4 个模型工具", () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), ["vore_mcp_list", "vore_settings_get", "vore_settings_set", "vore_skill_search"]);
});
ok("注册 1 条 effect 与 1 个 prefix 路由", () => {
  assert.equal(effects.length, 1);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, "prefix");
  assert.equal(routes[0].path, "/vore-settings");
});

// ── 最小 req/res 装置 ──────────────────────────────────────────────────────
const handler = routes[0].handler;

function call(method, url, { headers = {}, body = null } = {}) {
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  req.headers = { host: "127.0.0.1:3080", ...headers };
  const chunks = [];
  const res = {
    statusCode: 0,
    writeHead(code, h) { this.statusCode = code; this.headers = h; },
    end(buf) { chunks.push(buf ?? ""); },
  };
  const done = handler(req, res).then(() => ({ status: res.statusCode, body: chunks.join("") }));
  if (body !== null) req.push(body);
  req.push(null);
  return done;
}

console.log("HTTP 栅栏");
let token = "";
await (async () => {
  const bad = await call("GET", "/vore-settings/csrf", { headers: { host: "evil.example.com" } });
  ok("非同源 Host → 403", () => assert.equal(bad.status, 403));

  const csrf = await call("GET", "/vore-settings/csrf");
  ok("同源 GET /csrf 下发 token", () => {
    assert.equal(csrf.status, 200);
    token = JSON.parse(csrf.body).token;
    assert.equal(typeof token, "string");
    assert.equal(token.length, 48);
  });

  const noCsrf = await call("POST", "/vore-settings/settings.get", { body: "{}" });
  ok("缺 x-dsh-csrf 的 POST → 403", () => assert.equal(noCsrf.status, 403));

  const getOnly = await call("PUT", "/vore-settings/settings.get", { headers: { "x-dsh-csrf": token } });
  ok("非 POST 非 /csrf → 405", () => assert.equal(getOnly.status, 405));
})();

const post = (endpoint, payload) => call("POST", `/vore-settings/${endpoint}`, {
  headers: { "x-dsh-csrf": token, "content-type": "application/json" },
  body: JSON.stringify(payload ?? {}),
});

console.log("设置读写");
await (async () => {
  const r = await post("settings.get");
  const body = JSON.parse(r.body);
  ok("settings.get 返回默认值且 apiKey 为空", () => {
    assert.equal(r.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.settings.fofa.baseUrl, "https://fofoapi.com");
    assert.equal(body.settings.mcp.enabled.join(","), "anything-analyzer,adaptix-c2");
    assert.equal(body.settings.fofa.apiKey, "");
    assert.equal(body.settings.fofa.hasKey, false);
  });

  const w = await post("settings.set", { settings: { fofa: { apiKey: "abcdef1234567890" }, skills: { roots: [dir] } } });
  const wb = JSON.parse(w.body);
  ok("settings.set 部分更新：掩码回显 + 落盘（磁盘上存明文）", () => {
    assert.equal(wb.ok, true);
    assert.deepEqual(wb.applied, ["fofa", "skills"]);
    assert.equal(wb.settings.fofa.apiKey, "abcdef…");
    assert.equal(wb.settings.fofa.hasKey, true);
    const onDisk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(onDisk.fofa.apiKey, "abcdef1234567890");
    assert.equal(onDisk.shodan.apiKey, "");
  });

  const c = await post("settings.set", { settings: { fofa: { apiKey: "" } } });
  ok("settings.set 空串 = 清除密钥", () => {
    assert.equal(JSON.parse(c.body).settings.fofa.hasKey, false);
    assert.equal(JSON.parse(fs.readFileSync(settingsPath, "utf8")).fofa.apiKey, "");
  });

  const badGroup = await post("settings.set", { settings: { evil: { x: 1 } } });
  ok("非白名单分组被拒", () => {
    assert.equal(JSON.parse(badGroup.body).ok, false);
  });

  const t = await post("settings.test", { provider: "nope" });
  ok("settings.test 未知 provider → 可读原因（不联网）", () => {
    const b = JSON.parse(t.body);
    assert.equal(b.ok, false);
    assert.match(b.note, /未知 provider/);
  });

  const unknown = await post("nope.nope");
  ok("未知端点 → 400 + 明确错误", () => {
    assert.equal(unknown.status, 400);
    assert.match(JSON.parse(unknown.body).error, /unknown endpoint/);
  });
})();

console.log("技能与 MCP");
await (async () => {
  const r = await post("skills.scan", {});
  ok("skills.scan 空目录不报错", () => {
    const b = JSON.parse(r.body);
    assert.equal(b.ok, true);
    assert.equal(b.total, 0);
    assert.deepEqual(b.list, []);
  });

  const skillDir = path.join(dir, "skills", "demo-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: 演示技能\ndescription: 面板扫描用样例\n---\n", "utf8");
  const r2 = await post("skills.scan", { roots: [path.join(dir, "skills")] });
  ok("skills.scan 命中 SKILL.md 并回 name/desc", () => {
    const b = JSON.parse(r2.body);
    assert.equal(b.total, 1);
    assert.equal(b.list[0].name, "演示技能");
    assert.ok(b.list[0].desc.includes("样例"));
  });

  await post("settings.set", { settings: { mcp: { registryPath: path.join(dir, "no-such-registry.yaml") } } });
  const missing = await post("mcp.list");
  ok("mcp.list 缺文件 → 空数组 + 提示（不是错误）", () => {
    const b = JSON.parse(missing.body);
    assert.equal(b.ok, true);
    assert.equal(b.exists, false);
    assert.deepEqual(b.servers, []);
    assert.match(b.note, /不存在/);
  });

  if (fs.existsSync(REPO_REGISTRY)) {
    await post("settings.set", { settings: { mcp: { registryPath: REPO_REGISTRY } } });
    const real = JSON.parse((await post("mcp.list")).body);
    ok(`mcp.list 解析仓库真实 registry（${real.servers.length} 条，含 url/command/transport）`, () => {
      assert.equal(real.exists, true);
      const ids = real.servers.map((s) => s.id);
      for (const want of ["anything-analyzer", "burp-suite-mcp", "adaptix-c2-mcp", "fofa-mcp"]) {
        assert.ok(ids.includes(want), `应解析出 ${want}；实际 ${ids.join(",")}`);
      }
      assert.equal(real.servers.find((s) => s.id === "burp-suite-mcp").url, "http://127.0.0.1:9876/sse");
      assert.equal(real.servers.find((s) => s.id === "adaptix-c2-mcp").transport, "stdio");
      assert.ok(real.servers.find((s) => s.id === "adaptix-c2-mcp").command.endsWith("uv.exe"));
      assert.equal(real.enabled.join(","), "anything-analyzer,adaptix-c2");
    });
  }
})();

console.log("模型工具面");
await (async () => {
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const g = await byName.vore_settings_get.execute({}, {});
  ok("vore_settings_get：掩码回显（模型面也拿不到明文）", () => {
    assert.equal(g.ok, true);
    assert.match(g.text, /settings: /);
    assert.match(g.text, /defaultRps=5/);
  });

  const set = await byName.vore_settings_set.execute({ group: "rate", json: '{"wafRps":1}' }, {});
  ok("vore_settings_set：写单分组 / 拒非法 group / 拒非法 json", async () => {
    assert.equal(set.ok, true);
    assert.equal((await byName.vore_settings_set.execute({ group: "evil", json: "{}" }, {})).ok, false);
    assert.equal((await byName.vore_settings_set.execute({ group: "rate", json: "{oops" }, {})).ok, false);
    assert.equal((await byName.vore_settings_set.execute({ group: "rate", json: "[1,2]" }, {})).ok, false);
  });

  const s = await byName.vore_skill_search.execute({ keyword: "演示" }, {});
  ok("vore_skill_search：命中临时技能树", () => {
    assert.equal(s.ok, true);
    assert.equal(s.count, 1);
    assert.match(s.text, /演示技能/);
  });

  const m = await byName.vore_mcp_list.execute({}, {});
  ok("vore_mcp_list：返回 registry 清单与启用标记", () => {
    assert.equal(m.ok, true);
    assert.equal(typeof m.path, "string");
    assert.ok(Array.isArray(m.servers));
  });

  ok("四个工具的 output.render 全部可用（不抛）", () => {
    for (const t of tools) {
      const out = t.output.render({}, { ok: true, text: "x", note: "y", group: "rate", error: "" });
      assert.ok(Array.isArray(out) && typeof out[0].text === "string");
    }
  });
})();

for (const ef of effects) {
  assert.equal(typeof ef.dispose, "function");
  ef.dispose();
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n全部通过：${passed} 项`);
