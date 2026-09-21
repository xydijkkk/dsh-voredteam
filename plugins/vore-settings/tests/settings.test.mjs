// vore-settings / tests/settings.test.mjs —— 离线自测（不联网、不碰真实 ~/.dsh）。
//
// 覆盖：
//   1) apiKey 掩码（settings.get 只回前 6 位 + hasKey）
//   2) 深合并 / 部分更新语义（缺字段保留、空串=清除）
//   3) 极简 YAML 行解析（吃本文件内联的 registry 样例）
//   4) 技能扫描（空目录不报错；临时树能抓到 SKILL.md，frontmatter 与首标题都能认）
//   5) 客户端 bundle 契约（classic script 只注册工厂；materialize 后 apply 注册 settings.section；
//      三段面板在极简 React 运行时下能渲染、控件回调可点）
//
// 运行：node tests/settings.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import * as pure from "../lib/pure.js";
import { fileURLToPath } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const failures = [];
let passed = 0;

function test(label, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => { passed++; console.log(`  ok   ${label}`); },
        (err) => { failures.push({ label, err }); console.log(`  FAIL ${label}\n         ${err?.message ?? String(err)}`); },
      );
    }
    passed++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures.push({ label, err });
    console.log(`  FAIL ${label}\n         ${err?.message ?? String(err)}`);
  }
  return Promise.resolve();
}

/** 顺序执行链：主流程只 await __chain，不在模块顶层用 await（保持 .mjs 可直接跑）。 */
let __chain = Promise.resolve();
const t = (label, fn) => { __chain = __chain.then(() => test(label, fn)); };

function section(title) {
  __chain = __chain.then(() => { console.log(`\n${title}`); });
}
const sec = section;

// ── 1) 掩码 ─────────────────────────────────────────────────────────────────

section("[1] apiKey 掩码");
t("maskKey：前 6 位 + 省略号", () => {
  assert.equal(pure.maskKey("abcdef1234567890"), "abcdef…");
  assert.equal(pure.maskKey("1234567"), "123456…");
});
t("maskKey：短串/空串/非字符串", () => {
  assert.equal(pure.maskKey("abc"), "a…");
  assert.equal(pure.maskKey(""), "");
  assert.equal(pure.maskKey("   "), "");
  assert.equal(pure.maskKey(null), "");
  assert.equal(pure.maskKey(12345), "");
});
t("maskSettings：只回掩码 + hasKey，绝不回明文", () => {
  const s = pure.defaultSettings();
  s.fofa.apiKey = "fofa-plain-secret-0001";
  s.shodan.apiKey = "shodan-plain-secret-0002";
  const masked = pure.maskSettings(s);
  assert.equal(masked.fofa.apiKey, "fofa-p…");
  assert.equal(masked.fofa.hasKey, true);
  assert.equal(masked.shodan.hasKey, true);
  assert.equal(masked.yescaptcha.apiKey, "");
  assert.equal(masked.yescaptcha.hasKey, false);
  assert.equal(masked.rate.defaultRps, 5);
  assert.deepEqual(masked.mcp.enabled, ["anything-analyzer", "adaptix-c2"]);
  assert.ok(!JSON.stringify(masked).includes("plain-secret"), "掩码结果里不能出现明文密钥");
  assert.equal(s.fofa.apiKey, "fofa-plain-secret-0001", "原对象不被改动");
});

// ── 2) 深合并 / 部分更新 ─────────────────────────────────────────────────────

section("[2] 部分更新语义");
t("applyPatch：缺字段保留、空串清除、数组整表替换", () => {
  const current = pure.defaultSettings();
  current.fofa.apiKey = "keep-me-1234";
  const { settings, applied } = pure.applyPatch(current, {
    fofa: { baseUrl: "https://fofa.info" },
    skills: { roots: ["D:\\tmp\\only"] },
  });
  assert.deepEqual(applied, ["fofa", "skills"]);
  assert.equal(settings.fofa.apiKey, "keep-me-1234", "未出现的字段必须保留");
  assert.equal(settings.fofa.baseUrl, "https://fofa.info");
  assert.equal(settings.fofa.backupUrl, "http://107.173.248.139:18999", "未出现的字段保留默认");
  assert.deepEqual(settings.skills.roots, ["D:\\tmp\\only"]);
});
t("applyPatch：空串 = 清除密钥", () => {
  const current = pure.defaultSettings();
  current.shodan.apiKey = "to-be-cleared";
  const { settings } = pure.applyPatch(current, { shodan: { apiKey: "" } });
  assert.equal(settings.shodan.apiKey, "");
  assert.equal(pure.maskSettings(settings).shodan.hasKey, false);
});
t("applyPatch：非白名单分组被丢弃且不算改动", () => {
  const { applied } = pure.applyPatch(pure.defaultSettings(), { evil: { x: 1 }, rate: {} });
  assert.deepEqual(applied, []);
});
t("applyPatch：限速数值覆盖", () => {
  const { settings } = pure.applyPatch(pure.defaultSettings(), { rate: { wafRps: 0.5 } });
  assert.equal(settings.rate.wafRps, 0.5);
  assert.equal(settings.rate.defaultRps, 5);
});
t("withDefaults：空/损坏输入回默认值", () => {
  assert.equal(pure.withDefaults(null).mcp.registryPath.endsWith("registry.yaml"), true);
  assert.equal(pure.withDefaults({ fofa: { apiKey: "x" } }).fofa.backupUrl, "http://107.173.248.139:18999");
});
t("JSON 读写往返（临时目录，不碰真实 ~/.dsh）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-settings-"));
  const file = path.join(dir, "nested", "settings.json");
  const s = pure.defaultSettings();
  s.grokGateway.apiKey = "gw-key-abcdef";
  pure.writeSettingsFile(s, file);
  assert.ok(fs.existsSync(path.join(dir, "nested")), "目录应被递归创建");
  const back = pure.loadSettings(file);
  assert.equal(back.grokGateway.apiKey, "gw-key-abcdef");
  assert.equal(pure.loadSettings(path.join(dir, "missing.json")).fofa.baseUrl, "https://fofoapi.com");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 3) 极简 YAML 行解析 ──────────────────────────────────────────────────────

const REGISTRY_SAMPLE = `# voredteam MCP registry（样例）
version: 1
servers:
  - id: anything-analyzer
    name: Anything Analyzer
    transport: stdio
    command: node D:\\tools\\anything-analyzer\\index.js
    enabled: true
  - id: adaptix-c2
    name: "Adaptix C2"
    transport: sse
    url: http://127.0.0.1:8090/sse   # 本地实例
  - frida-mcp
    name: Frida MCP
    transport: http
    url: 'http://127.0.0.1:9000/mcp'
notes:
  - 这行在列表外但不是服务器键，应被忽略为 notes 项
`;

section("[3] 极简 YAML 解析（MCP registry）");
t("parseMcpRegistry：条数 / 字段 / 引号 / 行内注释", () => {
  const { servers, total } = pure.parseMcpRegistry(REGISTRY_SAMPLE);
  assert.equal(total, 3, `应解析出 3 条服务器，实际 ${total}：${JSON.stringify(servers)}`);
  const [a, b, c] = servers;
  assert.equal(a.id, "anything-analyzer");
  assert.equal(a.transport, "stdio");
  assert.equal(a.command, "node D:\\tools\\anything-analyzer\\index.js");
  assert.equal(a.enabled, true);
  assert.equal(b.id, "adaptix-c2");
  assert.equal(b.name, "Adaptix C2", "双引号应被剥离");
  assert.equal(b.url, "http://127.0.0.1:8090/sse", "行内注释和 URL 的 # 不能混淆");
  assert.equal(c.id, "frida-mcp", "裸条目名应成为 id");
  assert.equal(c.url, "http://127.0.0.1:9000/mcp", "单引号应被剥离");
  assert.equal(b.enabled, null, "未写 enabled 的行不作判断");
});
t("parseMcpRegistry：空文本 / 纯注释不报错", () => {
  assert.deepEqual(pure.parseMcpRegistry("").servers, []);
  assert.deepEqual(pure.parseMcpRegistry("# nothing here\n\n").servers, []);
});
t("parseMcpRegistry：URL 里的 #fragment 不被截断", () => {
  const { servers } = pure.parseMcpRegistry("- id: x\n  url: http://h/p#frag\n");
  assert.equal(servers[0].url, "http://h/p#frag");
});
t("parseMcpRegistry：吃下仓库真实 registry 全部条目（≥15，审计后已追加）", () => {
  const real = path.join(REPO_ROOT, "mcp", "registry.yaml");
  if (!fs.existsSync(real)) return;
  const { servers } = pure.readMcpRegistry(real);
  const ids = servers.map((s) => s.id);
  assert.ok(servers.length >= 15, `条目数应 ≥15，实际 ${servers.length}：${ids.join(",")}`);
  assert.equal(new Set(ids).size, servers.length, "不应有重复/误吞条目");
  assert.equal(servers.find((s) => s.id === "burp-suite-mcp").url, "http://127.0.0.1:9876/sse");
  assert.equal(servers.find((s) => s.id === "adaptix-c2-mcp").transport, "stdio");
  assert.ok(servers.find((s) => s.id === "adaptix-c2-mcp").command.endsWith("uv.exe"));
});
t("readMcpRegistry：文件不存在给出可读提示而非抛错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-reg-"));
  const missing = path.join(dir, "nope.yaml");
  const r = pure.readMcpRegistry(missing);
  assert.equal(r.ok, true);
  assert.equal(r.exists, false);
  assert.deepEqual(r.servers, []);
  assert.ok(r.note.includes("不存在"), `提示应说明文件不存在：${r.note}`);
  const real = path.join(dir, "registry.yaml");
  fs.writeFileSync(real, REGISTRY_SAMPLE, "utf8");
  const r2 = pure.readMcpRegistry(real);
  assert.equal(r2.exists, true);
  assert.equal(r2.servers.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 4) 技能扫描 ─────────────────────────────────────────────────────────────

section("[4] 技能扫描");
t("scanSkills：空目录不报错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-empty-"));
  const r = pure.scanSkills([dir]);
  assert.equal(r.total, 0);
  assert.deepEqual(r.list, []);
  assert.deepEqual(r.skipped, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
t("scanSkills：不存在的根只记 skipped，不抛错", () => {
  const r = pure.scanSkills(["Z:\\definitely\\not\\here", ""]);
  assert.equal(r.total, 0);
  assert.equal(r.skipped.length, 1);
  // 根校验前置（rootRejectReason）会给出更明确的原因；旧实现是 readdir 的 ENOENT
  assert.match(String(r.skipped[0].reason), /不存在|不可访问|ENOENT/);
});
t("scanSkills：拒绝盘根与一级目录（防越权遍历全盘）", () => {
  const root = path.parse(process.cwd()).root;                       // 例如 C:\
  const oneLevel = path.join(root, "Users");                          // 一级目录
  const r = pure.scanSkills([root, oneLevel]);
  assert.equal(r.total, 0);
  assert.equal(r.skipped.length, 2);
  assert.ok(r.skipped.every((s) => /一级目录|盘根/.test(String(s.reason))), `拒绝原因不符：${JSON.stringify(r.skipped)}`);
});
t("scanSkills：超大 SKILL.md 按大小跳过（读前 statSync）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-skills-big-"));
  const sub = path.join(dir, "huge");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, "SKILL.md"), "x".repeat(pure.SKILL_MAX_BYTES + 10));
  const r = pure.scanSkills([dir]);
  assert.equal(r.total, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(String(r.skipped[0].reason), /超过单文件上限/);
  fs.rmSync(dir, { recursive: true, force: true });
});
t("readSettingsFile：内容损坏抛错（不静默回默认，避免下次写盘抹掉密钥）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-settings-bad-"));
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, "{ 这不是 JSON", "utf8");
  assert.throws(() => pure.readSettingsFile(file), /设置文件损坏/);
  // 文件不存在 → 默认值（唯一允许回退的情形）
  assert.equal(pure.readSettingsFile(path.join(dir, "nope.json")).rate.defaultRps, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});
t("writeSettingsFile：原子替换并保留 .bak", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-settings-w-"));
  const file = path.join(dir, "settings.json");
  const s = pure.defaultSettings();
  s.shodan.apiKey = "first-round";
  pure.writeSettingsFile(s, file);
  s.shodan.apiKey = "second-round";
  pure.writeSettingsFile(s, file);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).shodan.apiKey, "second-round");
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")).shodan.apiKey, "first-round");
  assert.ok(!fs.readdirSync(dir).some((n) => n.includes(".tmp-")), "临时文件应已被 rename 消费");
  fs.rmSync(dir, { recursive: true, force: true });
});
t("applyPatch：rate 越界被夹紧（门禁阈值不允许设成 0/负数）", () => {
  const { settings, notes } = pure.applyPatch(pure.defaultSettings(), { rate: { defaultRps: 0, wafRps: -3, fuzzSampleFirst: 99999 } });
  assert.equal(settings.rate.defaultRps, 1);
  assert.equal(settings.rate.wafRps, 0.1);
  assert.equal(settings.rate.fuzzSampleFirst, 500);
  assert.equal(notes.length, 3, `应产生 3 条夹紧注记：${JSON.stringify(notes)}`);
});
t("scanSkills：抓到 SKILL.md（frontmatter 与首标题两种）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-skills-"));
  const a = path.join(dir, "sql-injection");
  const b = path.join(dir, "group", "re-tools", "frida-hook");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, "SKILL.md"), [
    "---",
    "name: SQL 注入利用",
    "description: 从报错到盲注的完整打法与注入点定位",
    "---",
    "",
    "# 正文标题不应覆盖 frontmatter name",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(b, "skill.md"), [
    "# Frida Hook 速查",
    "",
    "用 frida 在移动端做方法级 hook 与证书固定绕过。",
  ].join("\n"), "utf8");
  const r = pure.scanSkills([dir]);
  assert.equal(r.total, 2, `应扫到 2 条：${JSON.stringify(r.list)}`);
  assert.deepEqual(r.list.map((x) => x.name).sort(), ["Frida Hook 速查", "SQL 注入利用"]);
  const sql = r.list.find((x) => x.name === "SQL 注入利用");
  assert.ok(sql.path.endsWith("SKILL.md"));
  assert.ok(sql.desc.includes("盲注"), `描述应来自 frontmatter：${sql.desc}`);
  const frida = r.list.find((x) => x.name === "Frida Hook 速查");
  assert.ok(frida.path.toLowerCase().endsWith("skill.md"));
  assert.ok(frida.desc.includes("证书固定"), `描述应退化为首段：${frida.desc}`);
  assert.equal(pure.searchSkills([dir], "frida").length, 1);
  assert.equal(pure.searchSkills([dir], "盲注")[0].name, "SQL 注入利用");
  assert.equal(pure.searchSkills([dir], "zzz-no-hit").length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
t("scanSkills：limit 截断被如实标记", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-limit-"));
  for (let i = 0; i < 5; i++) {
    const d = path.join(dir, `s${i}`);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "SKILL.md"), `# skill ${i}\n`, "utf8");
  }
  const r = pure.scanSkills([dir], { limit: 3 });
  assert.equal(r.total, 3);
  assert.equal(r.truncated, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
t("parseSkillDoc：无 frontmatter / 无标题的退化路径", () => {
  assert.equal(pure.parseSkillDoc("# Only Title").name, "Only Title");
  assert.equal(pure.parseSkillDoc("just prose").name, "");
  assert.equal(pure.parseSkillDoc("just prose").desc, "just prose");
});

// ── 5) 客户端 bundle 契约 ───────────────────────────────────────────────────

section("[5] 客户端 bundle（lib/client.cjs）");
const clientPath = path.join(import.meta.dirname, "..", "lib", "client.cjs");

/** 浏览器全局桩（装到**真实 globalThis** 上，这样 bundle 里的裸 fetch / window / document 都可控）。 */
const styleTags = [];
const registrations = [];
globalThis.window ??= {};
globalThis.window.__ModuleLoader__ = { load(reg) { registrations.push(reg); } };
globalThis.document ??= {
  head: { appendChild(tag) { styleTags.push(tag); } },
  createElement(tag) { return { tag, textContent: "", dataset: {}, setAttribute(k, v) { this[k] = v; }, remove() {} }; },
};

/**
 * 把 lib/client.cjs 当 classic script 在**当前全局上下文**里执行一次
 * （等同浏览器注入同源 <script> 的行为），返回本次注册的工厂。
 */
function loadClientBundle() {
  const source = fs.readFileSync(clientPath, "utf8");
  const before = registrations.length;
  vm.runInThisContext(source, { filename: clientPath });
  const added = registrations.slice(before);
  return { registrations: added, styleTags };
}

function jsonRes(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

/** 极简 React 运行时：函数组件 + hooks 状态 + 事件触发重渲染 + 树遍历。 */
function makeReactRuntime() {
  let tree = null;
  let current = { store: {}, effectsRun: new Set(), setters: {} };
  let cursor = 0;
  const React = {
    createElement(type, props) {
      // 与 React 语义一致：children 同时进 props.children（组件读它）与 node.children（遍历读它）。
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props ?? {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, children };
    },
    useState(init) {
      const i = cursor++;
      const store = current.store;
      if (!(i in store)) store[i] = typeof init === "function" ? init() : init;
      const setter = (v) => {
        store[i] = typeof v === "function" ? v(store[i]) : v;
        tree = null; // 下次 render 重新执行组件
        if (process.env.VSET_DEBUG) console.log("DBG set state", i, "=>", JSON.stringify(store[i]));
      };
      current.setters[i] = setter; // 事件处理器闭包里捕获的是首次渲染的 setter，需指向同一 store
      return [store[i], setter];
    },
    useEffect(fn) { const i = cursor++; if (!current.effectsRun.has(i)) { current.effectsRun.add(i); fn(); } },
    useCallback(fn) { cursor++; return fn; },
    useMemo(fn) { cursor++; return fn(); },
  };
  const findAll = (node, pred, acc = []) => {
    // 与 React 语义一致：children 里的嵌套数组要摊平（map 出来的列表就是数组）
    if (Array.isArray(node)) { for (const c of node) findAll(c, pred, acc); return acc; }
    if (!node || typeof node !== "object" || !node.type) return acc;
    // 函数组件按 React 语义展开（component(props) → 元素），这样遍历到的是渲染结果
    const rendered = typeof node.type === "function" ? node.type(node.props) : node;
    if (!rendered || typeof rendered !== "object" || !rendered.type) return acc;
    if (pred(rendered)) acc.push(rendered);
    for (const c of rendered.children ?? []) findAll(c, pred, acc);
    return acc;
  };
  const textOf = (node) => {
    if (node === null || node === undefined || node === false) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(" ");
    const rendered = typeof node.type === "function" ? node.type(node.props) : node;
    if (!rendered || typeof rendered !== "object") return "";
    const own = typeof rendered.props?.placeholder === "string" ? `${rendered.props.placeholder} ` : "";
    return own + (rendered.children ?? []).map(textOf).join(" ");
  };
  return {
    React,
    render(component) {
      if (tree !== null) return tree;
      cursor = 0;
      tree = component({ close() {} });
      return tree;
    },
    findAll,
    text: textOf,
    state: (i) => current.store[i],
    raw: () => tree,
  };
}

/** materialize 一次 bundle，返回 { module, registrations, styleTags }。
 *  契约要点（勿改回三形参）：宿主 ClientModuleSystem.materialize 是
 *  `registered(makeRequire(edges))` —— **只传 require 一个参数**，导出取返回值。
 *  曾因工厂声明 (require, module, exports) 导致 Web UI 白屏：
 *  module 为 undefined → `Cannot set properties of undefined (setting 'exports')`。 */
function materializeClient(reactStub) {
  const { registrations, styleTags } = loadClientBundle();
  assert.ok(registrations[0].factory.length <= 1, `factory 只能声明 (require) 一个形参，实际 ${registrations[0].factory.length} 个`);
  const exports = registrations[0].factory((spec) => {
    assert.equal(spec, "react", `bundle 只应 require 平台 seed 词：${spec}`);
    return reactStub;
  });
  return { module: { exports }, registrations, styleTags };
}

/** 用一个「注册即捕获组件」的假 ctx 跑 apply（双入口：conversation.view 页签 + settings.section 一节）。 */
function applyClient(module) {
  const effects = [];
  const components = new Map();
  const ctx = {
    effect(fn, label) { effects.push({ label, dispose: fn() }); },
    slots: {
      inject(name, cb) { effects.push({ label: `slots.inject:${name}`, dispose: cb() }); },
      register(options, c) { components.set(options.name, c); return () => {}; },
    },
  };
  module.exports.apply(ctx);
  return { effects, getComponent: (name = "settings.section") => components.get(name), components };
}

const __origFetch = globalThis.fetch;

t("bundle 只注册工厂（执行时零副作用）", () => {
  const { registrations, styleTags } = loadClientBundle();
  assert.equal(registrations.length, 1, "应恰好注册一次工厂");
  assert.equal(registrations[0].id, "@dsh-external/vore-settings");
  assert.equal(typeof registrations[0].factory, "function");
  assert.ok(registrations[0].factory.length <= 1, "factory 只应声明 (require) —— 宿主只传一个参数");
  assert.equal(styleTags.length, 0, "样式必须在 materialize 之后才注入");
});

t("materialize 后导出 {name, inject, apply} 且 apply 注册 settings.section", () => {
  const ReactStub = {
    createElement(type, props) {
      // 与 React 语义一致：children 同时进 props.children（组件读它）与 node.children（遍历读它）。
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props ?? {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, children };
    },
    useState(init) { return [typeof init === "function" ? init() : init, function () {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
  };
  const { module, styleTags } = materializeClient(ReactStub);
  assert.equal(module.exports.name, "vore-settings-client");
  assert.equal(module.exports.inject.length, 1);
  assert.equal(module.exports.inject[0], "slots");
  assert.equal(typeof module.exports.apply, "function");

  const { effects } = applyClient(module);
  const section = effects.find((x) => x.label === "slots.inject:settings.section");
  const view = effects.find((x) => x.label === "slots.inject:conversation.view");
  assert.ok(section, "apply 必须注册 settings.section（设置弹窗内的一节）");
  assert.ok(view, "apply 必须注册 conversation.view（会话页签「设置」，与作战面板并排）");
  assert.equal(effects.length, 3, "应登记 styles + 两个 slots.inject 共三个 effect");
  assert.equal(styleTags.length, 1, "installStyles 应注入一个 <style>");
  const css = String(styleTags[0].textContent);
  assert.ok(css.includes(".dsh-vset-root"), "样式应使用 dsh-vset- 前缀");
  assert.ok(css.includes("body[data-ds-dark-theme]"), "样式应含深色自适应");
});

t("注册项元数据：双入口的 id / order / label（页签 60 · 设置节 130）", () => {
  const seen = [];
  const { module } = materializeClient({ createElement: () => null, useState: () => [null, () => {}], useEffect() {}, useCallback: (f) => f, useMemo: (f) => f() });
  module.exports.apply({
    effect() {},
    slots: { inject(_n, cb) { cb(); }, register(options, c) { seen.push({ options, c }); return () => {}; } },
  });
  const byName = new Map(seen.map((s) => [s.options.name, s.options]));
  assert.equal(seen.length, 2, "应注册两个入口（conversation.view + settings.section）");
  const section = byName.get("settings.section");
  assert.ok(section, "缺 settings.section");
  assert.equal(section.id, "vore-settings");
  assert.equal(section.order, 130);
  assert.equal(section.label(), "voredteam 设置");
  const view = byName.get("conversation.view");
  assert.ok(view, "缺 conversation.view 页签");
  assert.equal(view.id, "vore-settings");
  assert.equal(view.order, 60, "页签应排在作战面板（order 50）之后");
  assert.equal(view.label(), "设置");
  for (const s of seen) assert.equal(typeof s.c, "function");
});

t("未取到设置时只渲染骨架（不抛错）", () => {
  const ReactStub = { createElement(type, props) { return { type, props: props ?? {}, children: Array.prototype.slice.call(arguments, 2) }; }, useState: (i) => [typeof i === "function" ? i() : i, () => {}], useEffect() {}, useCallback: (f) => f, useMemo: (f) => f() };
  const { module } = materializeClient(ReactStub);
  globalThis.fetch = async () => jsonRes({ ok: true, settings: null });
  const { getComponent } = applyClient(module);
  const tree = getComponent()({ close() {} });
  assert.ok(tree.props.className === "dsh-vset-root", "根节点应带 dsh-vset-root 类");
  const flat = JSON.stringify(tree.children.map((c) => (c && c.props && c.props.children ? [c.props.children, tree.props] : c)));
  assert.ok(flat.includes("加载中"), `未取到设置前应显示加载中：${flat.slice(0, 200)}`);
});

t("三段面板渲染 + 控件回调可点（含 MCP 启用勾选写回）", async () => {
  const calls = [];
  const fakeSettings = {
    fofa: { apiKey: "abcdef…", hasKey: true, baseUrl: "https://fofoapi.com", backupUrl: "http://107.173.248.139:18999" },
    shodan: { apiKey: "", hasKey: false },
    yescaptcha: { apiKey: "", hasKey: false },
    grokGateway: { apiKey: "", hasKey: false, baseUrl: "http://127.0.0.1:3001/" },
    rate: { defaultRps: 5, wafRps: 1, fuzzSampleFirst: 50 },
    skills: { roots: ["D:\\skills"] },
    mcp: { enabled: ["anything-analyzer"], registryPath: "D:\\reg.yaml" },
  };
  const fakeMcp = {
    ok: true, path: "D:\\reg.yaml", exists: true, note: "",
    servers: [
      { id: "anything-analyzer", name: "抓包", transport: "http", url: "http://127.0.0.1:23816/mcp", command: "" },
      { id: "adaptix-c2-mcp", name: "C2", transport: "stdio", url: "", command: "uv.exe run" },
    ],
    enabled: ["anything-analyzer"],
  };
  const h = makeReactRuntime();
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/csrf")) return jsonRes({ token: "tok" });
    if (url.endsWith("/settings.get")) return jsonRes({ ok: true, settings: fakeSettings });
    if (url.endsWith("/mcp.list")) return jsonRes(fakeMcp);
    return jsonRes({ ok: true, applied: ["mcp"], settings: fakeSettings });
  };
  const { module } = materializeClient(h.React);
  const { getComponent } = applyClient(module);
  const component = getComponent();

  h.render(component);
  await new Promise((r) => setTimeout(r, 0)); // 让 useEffect 里的 fetch 链跑完
  assert.ok(calls.some((u) => u.endsWith("/settings.get")), `应拉取设置：${calls.join(",")}`);

  // 折叠头：渲染后是带 role=button 的 div（点它展开该段）
  const heads = h.findAll(h.render(component), (n) => n.props && n.props.role === "button" && typeof n.props.onClick === "function");
  assert.equal(heads.length, 3, `应有三段折叠区，实际 ${heads.length}`);
  for (const [idx, hd] of heads.entries()) {
    try {
      hd.props.onClick();
    } catch (err) {
      console.log("DBG head", idx, "threw:", err?.message);
      throw err;
    }
  }
  const open = h.render(component);
  const raw = h.raw();
  const txt = h.text(open);
  if (process.env.VSET_DEBUG) {
    const secs = raw.children.filter((c) => c && typeof c.type === "function");
    console.log("DBG final open flags:", secs.map((s) => s.props.open).join(","));
    console.log("DBG txt head:", JSON.stringify(txt.slice(0, 200)));
  }
  assert.ok(txt.includes("测绘与辅助 API") && txt.includes("技能管理") && txt.includes("MCP 管理"), `三段标题应齐全：${txt.slice(0, 200)}`);
  assert.ok(txt.includes("已配置 abcdef…"), `已配置的 key 应显示掩码：${txt.slice(0, 500)}`);
  assert.ok(txt.includes("fuzzSampleFirst"), "限速段应渲染");

  // MCP 清单是挂载即拉取的异步链，等它落地再断言（给两轮宏任务）
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const boxes = h.findAll(h.render(component), (n) => n.type === "input" && n.props.type === "checkbox");
  assert.equal(boxes.length, 2, `应渲染 2 个 MCP 勾选框，实际 ${boxes.length}`);
  assert.equal(boxes[0].props.checked, true, "anything-analyzer 应显示为已启用");
  assert.equal(boxes[1].props.checked, false);
  boxes[1].props.onChange({ target: { checked: true } });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((u) => u.endsWith("/settings.set")), "勾选应写回 mcp.enabled");

  const areas = h.findAll(h.render(component), (n) => n.type === "textarea");
  assert.equal(areas.length, 1);
  areas[0].props.onChange({ target: { value: "D:\\a\nD:\\b" } });
  const btns = h.findAll(h.render(component), (n) => n.type === "button" && h.text(n).includes("保存根目录"));
  assert.equal(btns.length, 1, "应有「保存根目录」按钮");
  btns[0].props.onClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.filter((u) => u.endsWith("/settings.set")).length >= 2, "保存技能根应再次写回");
});

// ── 汇总（等待顺序链跑完）──────────────────────────────────────────────────
await __chain;
globalThis.fetch = __origFetch;

console.log(`\n${"-".repeat(58)}`);
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项断言组`);
  process.exit(0);
}
console.log(`通过 ${passed} 项，失败 ${failures.length} 项：`);
for (const f of failures) console.log(`  ✗ ${f.label}\n    ${f.err?.stack ?? f.err}`);
process.exit(1);
