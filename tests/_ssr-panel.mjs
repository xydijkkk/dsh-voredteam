// 用**真实 React 18** 把作战面板 bundle 渲染一遍（SSR），验证组件本身能不能出标记。
// 这是唯一能区分「组件坏了 → 空白」与「数据没到 → 空态」的检查。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CLIENT = path.join(REPO_ROOT, "plugins", "vore-console", "lib", "client.js");
const req = createRequire(path.join(homedir(), "Desktop", "ds", "deepseek-harness", "apps", "web", "package.json"));
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
console.log(`React ${React.version}`);

const code = readFileSync(CLIENT, "utf8");
const registrations = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  fetch: async () => ({ status: 200, json: async () => ({ ok: true }) }),
  window: { confirm: () => true, addEventListener: () => {} },
  document: { getElementById: () => null, createElement: () => ({ id: "", textContent: "", style: {}, setAttribute() {} }), head: { appendChild: () => {} }, addEventListener: () => {}, hidden: false },
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: { getItem: () => null, setItem: () => {} },
};
sandbox.window.__ModuleLoader__ = { load: (spec) => registrations.push(spec) };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "vore-console-client.js" });

const reg = registrations[0];
const mod = reg.factory((spec) => {
  if (spec === "react") return React;
  throw new Error(`bundle 只应 require react，实际：${spec}`);
});
console.log(`模块：${mod.name}  inject=${JSON.stringify(mod.inject)}  factory 形参=${reg.factory.length}`);

let component = null;
const fakeCtx = {
  effect: (fn) => { try { fn(); } catch { /* 无 DOM 时样式注入失败可忽略 */ } return () => {}; },
  inject: (_deps, cb) => { cb({ sessions: {} }); return () => {}; },
  slots: {
    inject: (name, cb) => { cb(); return () => {}; },
    register: (spec, comp) => { component = comp; console.log(`注册槽位 ${spec.name} id=${spec.id} order=${spec.order} label=${typeof spec.label === "function" ? spec.label() : spec.label}`); return () => {}; },
  },
};
mod.apply(fakeCtx);
if (!component) { console.log("✗ apply 没有注册组件"); process.exit(1); }

for (const [label, props] of [["空 props", {}], ["带 sessionsStore", { sessionsStore: {} }]]) {
  try {
    const html = renderToStaticMarkup(React.createElement(component, props));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(`  ✓ ${label}：SSR 出标记 ${html.length} 字符`);
    console.log(`     文本：${text.slice(0, 220)}`);
    for (const kw of ["实时情况", "任务汇总", "覆盖矩阵", "作战面板"]) {
      if (!html.includes(kw)) console.log(`     ⚠ 首帧标记里没有「${kw}」`);
    }
  } catch (e) {
    console.log(`  ✗ ${label}：SSR 抛错 → ${e.message}`);
    console.log(String(e.stack).split("\n").slice(0, 6).map((l) => "      " + l).join("\n"));
  }
}
