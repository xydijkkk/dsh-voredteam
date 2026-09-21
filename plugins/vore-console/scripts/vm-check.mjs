// 客户端 bundle 装载校验（被 scripts/build-client.mjs 与 tests 共用）：
// 在假 window/document/React 沙箱里跑一遍 classic bundle，断言它确实按 DSH 契约
// 注册了 bundle（window.__ModuleLoader__.load({id, factory})），并且 apply() 至少注册一个槽位。
//
// 用法：import { loadPanelBundle } from "./vm-check.mjs";
//      const info = loadPanelBundle({ code, pkgName, expectSlot: "conversation.view" });

import vm from "node:vm";

export function makeFakeReact() {
  return {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props ?? {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, children };
    },
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  };
}

/**
 * @param {{code:string, pkgName:string, expectSlot?:string, expectLabel?:string}} opts
 * @returns {{bundleId:string, slots:Array<{name:string,id:string,label:string}>, effects:number, styleTags:number, seedRequires:string[]}}
 */
export function loadPanelBundle({ code, pkgName, expectSlot, expectLabel }) {
  const registrations = [];
  const styleTags = [];
  const seedRequires = [];
  const fakeReact = makeFakeReact();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => ({ status: 200, json: async () => ({ ok: true, graph: null, settings: null, servers: [] }) }),
    window: { confirm: () => false },
    document: {
      getElementById: () => null,
      createElement: () => ({ id: "", textContent: "" }),
      head: { appendChild: (el) => styleTags.push(el) },
      addEventListener: () => {},
      hidden: false,
    },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  sandbox.window.__ModuleLoader__ = { load: (spec) => registrations.push(spec) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: `${pkgName}-client.js` });

  if (registrations.length !== 1) throw new Error(`应注册 1 个 bundle，实际 ${registrations.length}`);
  const reg = registrations[0];
  if (reg.id !== pkgName) throw new Error(`bundle id 应为 ${pkgName}，实际 ${reg.id}`);
  if (typeof reg.factory !== "function") throw new Error("factory 不是函数");
  // DSH 的 ClientModuleSystem.materialize 只传一个参数：registered(makeRequire(edges))。
  // 工厂若声明 (require, module, exports)，module 就是 undefined，
  // 典型症状是 `Cannot set properties of undefined (setting 'exports')` —— 页面直接白屏。
  if (reg.factory.length > 1) {
    throw new Error(`factory 只能声明 (require) 一个形参（宿主只传 1 个），实际 ${reg.factory.length} 个：${String(reg.factory).slice(0, 80)}`);
  }

  const mod = reg.factory((spec) => { seedRequires.push(spec); if (spec === "react") return fakeReact; throw new Error(`bundle 只应 require 平台 seed 词，实际：${spec}`); });
  if (!mod || typeof mod.apply !== "function" || typeof mod.name !== "string") throw new Error("factory 未导出 {name, inject, apply}");

  const slots = [];
  let effects = 0;
  let insideInject = 0;
  mod.apply({
    effect: (fn, label) => { effects++; try { fn(); } catch { /* 样式注入在无 DOM 时可能失败，忽略 */ } return () => {}; },
    inject: (deps, cb) => { cb({ sessions: {} }); return () => {}; },
    slots: {
      // 宿主 core 对**未声明**槽位的 register 会抛错；而槽位声明由 owner 包（ui-conversation /
      // ui-settings-general）在自己的 apply 里提交，顺序不保证。因此契约是：
      //   ctx.slots.inject('<slot>', () => ctx.slots.register({...}, Comp))
      // 这里把"裸 register"直接判为失败，防住"面板不显示但测试全绿"这类假绿。
      register: (spec, component) => {
        if (insideInject === 0) {
          throw new Error(`slots.register('${spec.name}') 必须在 slots.inject('${spec.name}', …) 内调用 —— 宿主对未声明槽位的 register 会抛错，面板会静默消失`);
        }
        slots.push({ name: spec.name, id: spec.id, label: typeof spec.label === "function" ? String(spec.label()) : String(spec.label ?? ""), component });
        return () => {};
      },
      inject: (name, cb) => {
        insideInject++;
        try { cb(); } finally { insideInject--; }
        return () => {};
      },
    },
  });
  if (slots.length === 0) throw new Error("apply 未注册任何槽位");
  if (expectSlot && !slots.some((s) => s.name === expectSlot)) throw new Error(`未注册槽位 ${expectSlot}（实际 ${slots.map((s) => s.name).join(",")}）`);
  if (expectLabel && !slots.some((s) => s.label === expectLabel)) throw new Error(`槽位标签应为「${expectLabel}」（实际 ${slots.map((s) => s.label).join(",")}）`);

  return {
    bundleId: reg.id, moduleName: mod.name, slots, effects, styleTags: styleTags.length,
    seedRequires: [...new Set(seedRequires)], factoryArity: reg.factory.length, inject: mod.inject ?? [],
  };
}
