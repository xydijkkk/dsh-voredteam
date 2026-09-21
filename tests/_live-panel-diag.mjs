// 用**线上真实 payload** 跑一遍作战面板（迷你 React，同 panel-render.mjs 的套路），看它到底渲染出什么、有没有抛错。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = ROOT;
const BUNDLE = path.join(ROOT, "plugins", "vore-console", "lib", "client.js");
const BASE = "http://127.0.0.1:3080/vore-blackboard";
const SESSION = process.argv[2] ?? "session-c44b3a1c-1aa4-4058-8635-74dcfbd01a05";

const csrf = await (await fetch(`${BASE}/csrf`)).json().then((j) => j.token);
const post = async (endpoint, payload = {}) => {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dsh-csrf": csrf },
    body: JSON.stringify(payload),
  });
  return await res.json();
};

const graph = await post("graph", { sessionId: SESSION });
const status = await post("status", { sessionId: SESSION });
const coverage = await post("coverage", { sessionId: SESSION });
const assets = await post("assets", { sessionId: SESSION, limit: 500 });
console.log("=== 线上 payload 形状 ===");
console.log("graph.project:", graph.graph?.project?.id, "| facts:", graph.graph?.facts?.length, "| intents:", graph.graph?.intents?.length, "| hints:", graph.graph?.hints?.length);
console.log("assets:", assets.assets?.length, "| coverage.stages:", Object.keys(coverage.coverage?.stages ?? {}).join(","));
console.log("coverage.phase:", coverage.coverage?.phase, "| reflow:", JSON.stringify(coverage.coverage?.reflow));

// ── 迷你 React（与测试同款，够这个组件用）───────────────────────────────────
function createMiniReact() {
  let current = null;
  const scheduleRerender = (inst) => {
    if (inst.dirty) return;
    inst.dirty = true;
    queueMicrotask(() => { inst.dirty = false; render(inst); });
  };
  function render(inst) {
    current = inst;
    inst.hookIndex = 0;
    try { inst.tree = inst.type(inst.props); inst.error = null; }
    catch (e) { inst.error = e; }
    finally { current = null; }
  }
  const hookSlot = () => { const inst = current; const i = inst.hookIndex++; if (inst.hooks.length <= i) inst.hooks.push({}); return { inst, slot: inst.hooks[i] }; };
  const React = {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props ?? {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, children };
    },
    useState(init) {
      const { inst, slot } = hookSlot();
      if (!("value" in slot)) slot.value = typeof init === "function" ? init() : init;
      slot.setter = slot.setter ?? ((v) => { const next = typeof v === "function" ? v(slot.value) : v; if (Object.is(next, slot.value)) return; slot.value = next; scheduleRerender(inst); });
      return [slot.value, slot.setter];
    },
    useRef(v) { const { slot } = hookSlot(); if (!("ref" in slot)) slot.ref = { current: v }; return slot.ref; },
    useCallback(fn, deps) { const { slot } = hookSlot(); if (!slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i]))) { slot.fn = fn; slot.deps = deps ? [...deps] : null; } return slot.fn; },
    useMemo(fn, deps) { const { slot } = hookSlot(); if (!slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i]))) { slot.value = fn(); slot.deps = deps ? [...deps] : null; } return slot.value; },
    useEffect(fn, deps) { const { slot } = hookSlot(); const changed = !slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i])); if (changed) { slot.pending = fn; slot.deps = deps ? [...deps] : null; } },
  };
  function mount(type, props) {
    const inst = { type, props, hooks: [], hookIndex: 0, dirty: false, tree: null };
    render(inst);
    for (const slot of inst.hooks) if (slot.pending) { slot.cleanup = slot.pending(); slot.pending = null; }
    return inst;
  }
  return { React, mount };
}
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out; }
  if (typeof node.type === "function") { textOf(node.props?.children, out); return out; }
  textOf(node.props?.children, out);
  return out;
}
const countType = (node, kind, acc = { n: 0 }) => {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { for (const n of node) countType(n, kind, acc); return acc; }
  if (node.type === kind) acc.n++;
  countType(node.props?.children, kind, acc);
  return acc;
};

const code = fs.readFileSync(BUNDLE, "utf8");
const { React, mount } = createMiniReact();
const registrations = [];
const payloads = { graph, status, coverage, assets, projects: await post("projects", { sessionId: SESSION }) };
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, queueMicrotask,
  fetch: async (url) => {
    if (String(url).endsWith("/csrf")) return { status: 200, json: async () => ({ token: "t" }) };
    const key = String(url).includes("/projects") ? "projects" : String(url).includes("/graph") ? "graph" : String(url).includes("/status") ? "status" : String(url).includes("/coverage") ? "coverage" : "assets";
    return { status: 200, json: async () => payloads[key] };
  },
  window: { confirm: () => true, addEventListener: () => {} },
  document: { getElementById: () => null, createElement: () => ({ id: "", textContent: "", style: {}, setAttribute() {} }), head: { appendChild: () => {} }, addEventListener: () => {}, hidden: false },
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window.__ModuleLoader__ = { load: (spec) => registrations.push(spec) };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "vore-console-client.js" });
const mod = registrations[0].factory((spec) => { if (spec === "react") return React; throw new Error(`bundle require 了 ${spec}`); });
const sessionsStore = { list: { getSnapshot: () => ({ ids: [SESSION], byId: {}, current: SESSION, phase: "ready" }) } };
let component = null;
mod.apply({
  effect: (fn) => { try { fn(); } catch { /* 无 DOM */ } return () => {}; },
  inject: (_d, cb) => { cb({ sessions: sessionsStore }); return () => {}; },
  slots: { inject: (_n, cb) => { cb(); return () => {}; }, register: (_s, c) => { component = c; return () => {}; } },
});
const inst = mount(component({}).type, component({}).props);
await new Promise((r) => setTimeout(r, 60));
await new Promise((r) => setTimeout(r, 60));

console.log("\n=== 渲染结果 ===");
if (inst.error) {
  console.log("✗ 渲染期抛错（浏览器里就是整块空白）：", inst.error.message);
  console.log(String(inst.error.stack).split("\n").slice(1, 4).join("\n"));
} else {
  const t = textOf(inst.tree).join(" ");
  console.log("渲染文本长度:", t.length);
  console.log("svg:", countType(inst.tree, "svg").n, "| rect:", countType(inst.tree, "rect").n, "| text:", countType(inst.tree, "text").n, "| path:", countType(inst.tree, "path").n);
  console.log("文本（前 600 字）:", t.slice(0, 600));
}
