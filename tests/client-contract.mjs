// 客户端 bundle 契约回归测试（**这条测试的存在是为了防住一次真实的白屏事故**）。
//
// 事故：vore-settings 的 client 工厂曾写成 `factory(require, module, exports)`，
// 而宿主 ClientModuleSystem.materialize 只传一个参数（`registered(makeRequire(edges))`，见
// deepseek-harness/packages/client/modules/src/client/system.ts:159），
// 于是 module 为 undefined → `module.exports = ...` 抛
// "Cannot set properties of undefined (setting 'exports')" → Web UI 直接 "Failed to load plugins" 白屏。
//
// 本测试在 vm 沙箱里按宿主同款语义装载**每一个**声明了 dsh.client 的插件的客户端 bundle：
//   1) 只注册一次、id === 包名；
//   2) **factory 形参个数 ≤ 1**（关键回归点）；
//   3) factory(require) 返回 {name, inject, apply}，且只 require 平台 seed 词；
//   4) apply(fakeCtx) 真的注册了预期槽位，并且注册进去的组件能渲染出元素（浅渲染不抛）。
// 运行：node --no-warnings tests/client-contract.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPanelBundle } from "../plugins/vore-console/scripts/vm-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = path.join(root, "plugins");

/** 每个面板插件应有的槽位（新增面板/页签时在这里登记）。
 *  设计口径：会话页签 = conversation.view（作战面板 + 设置 并排）；设置弹窗内 = settings.section. */
const EXPECT = {
  "@dsh-external/vore-console": { slots: [{ name: "conversation.view", label: "作战面板" }], minInject: 1, owner: "@deepseek-ai/dsh-client-ui-conversation" },
  "@dsh-external/vore-settings": {
    slots: [{ name: "conversation.view", label: "设置" }, { name: "settings.section", label: "dsh-voredteam 设置" }],
    minInject: 1,
    owners: ["@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-settings-general"],
  },
};

let pass = 0, fail = 0;
const ok = (label, fn) => {
  try { fn(); pass++; console.log(`  \u2713 ${label}`); }
  catch (e) { fail++; console.log(`  \u2717 ${label}\n      ${e.message}`); }
};

const plugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(pluginsDir, e.name, "package.json")))
  .map((e) => ({ name: e.name, dir: path.join(pluginsDir, e.name) }));

console.log(`客户端 bundle 契约（${plugins.length} 个插件）`);
ok("至少两个面板插件在册（vore-console / vore-settings）", () => {
  const names = plugins.map((p) => p.name);
  for (const n of ["vore-console", "vore-settings"]) if (!names.includes(n)) throw new Error(`缺插件 ${n}`);
});

const seen = new Set();
for (const p of plugins) {
  const pkg = JSON.parse(fs.readFileSync(path.join(p.dir, "package.json"), "utf8"));
  const hasClient = Boolean(pkg.dsh?.client);

  if (!hasClient) {
    ok(`${p.name}: 未声明 dsh.client，且不导出 ./client（无客户端面，符合预期）`, () => {
      if (pkg.exports?.["./client"]) throw new Error("声明了 ./client 却没有 dsh.client，半接线状态");
    });
    continue;
  }

  seen.add(pkg.name);
  const rel = pkg.exports?.["./client"];
  const file = rel ? path.join(p.dir, rel) : null;
  const code = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const expect = EXPECT[pkg.name];

  ok(`${p.name}: ./client 指向存在的文件（${rel}）`, () => {
    if (!rel) throw new Error("缺 exports['./client']");
    if (!code) throw new Error(`文件不存在：${file}`);
  });

  ok(`${p.name}: bundle 是 classic script（无 ESM import / no export 语句）`, () => {
    if (!code) throw new Error("bundle 不可读");
    if (/^\s*import\s/m.test(code)) throw new Error("含 ESM import");
    if (/^\s*export\s/m.test(code)) throw new Error("含 ESM export");
  });

  ok(`${p.name}: factory 形参 ≤1 + 只 require seed + 槽位齐备（${(expect?.slots ?? []).map((s) => s.name).join(" / ") || "任意"}）+ 图依赖边齐备`, () => {
    if (!code) throw new Error("bundle 不可读");
    const info = loadPanelBundle({ code, pkgName: pkg.name });
    if (info.factoryArity > 1) throw new Error(`factory 形参 ${info.factoryArity} 个（宿主只传 1 个）`);
    if (!info.seedRequires.includes("react")) throw new Error("未 require react");
    const bad = info.seedRequires.filter((s) => s !== "react");
    if (bad.length) throw new Error(`require 了非 seed 模块：${bad.join(", ")}`);
    if (expect?.minInject && info.inject.length < expect.minInject) throw new Error(`inject 面为空（应声明 ≥ ${expect.minInject} 个宿主服务）`);
    if (!info.slots.length) throw new Error("apply 未注册槽位");
    for (const want of expect?.slots ?? []) {
      const got = info.slots.find((s) => s.name === want.name);
      if (!got) throw new Error(`未注册槽位 ${want.name}（实际 ${info.slots.map((s) => s.name).join(", ")}）`);
      if (want.label && got.label !== want.label) throw new Error(`槽位 ${want.name} 的标签应为「${want.label}」，实际「${got.label}」`);
    }
    // 图依赖边：dsh.client.inject 必须包含槽位 owner 包（否则可能先于声明激活）
    const owners = [...(expect?.owner ? [expect.owner] : []), ...(expect?.owners ?? [])];
    for (const o of owners) {
      if (!(pkg.dsh.client.inject ?? []).includes(o)) throw new Error(`dsh.client.inject 缺 owner 包 ${o}`);
    }
  });

  ok(`${p.name}: 注册进槽位的组件能浅渲染出元素（组件体不抛）`, () => {
    if (!code) throw new Error("bundle 不可读");
    const info = loadPanelBundle({ code, pkgName: pkg.name });
    const wants = (expect?.slots ?? []).map((s) => s.name);
    const targets = wants.length ? info.slots.filter((s) => wants.includes(s.name)) : info.slots;
    if (!targets.length) throw new Error("找不到目标槽位");
    for (const slot of targets) {
      if (typeof slot.component !== "function") throw new Error(`槽位 ${slot.name} 没有注册组件`);
      const el = slot.component({});
      if (!el || typeof el !== "object" || !("type" in el)) throw new Error(`槽位 ${slot.name} 的组件首帧没有返回 React 元素`);
    }
  });
}

ok("应覆盖的面板插件都已覆盖（无遗漏）", () => {
  for (const n of Object.keys(EXPECT)) if (!seen.has(n)) throw new Error(`未检查到 ${n}`);
});

// ── 闸门自证（变异测试）：把"在 slots.inject 里注册"改回"裸 register"，本闸门必须报错 ──
ok("闸门自证：裸 ctx.slots.register 会被判失败（宿主对未声明槽位的 register 会抛错）", () => {
  const p = path.join(pluginsDir, "vore-console", "lib", "client.js");
  const good = fs.readFileSync(p, "utf8");
  const mutant = good.replace('ctx.slots.inject("conversation.view", function () {', "(function () {");
  if (mutant === good) throw new Error('变异未生效（找不到 slots.inject("conversation.view") 片段）');
  let threw = false;
  try { loadPanelBundle({ code: mutant, pkgName: "@dsh-external/vore-console", expectSlot: "conversation.view" }); }
  catch { threw = true; }
  if (!threw) throw new Error("变异体竟然通过了 —— 闸门形同虚设");
});

// ── 在线面：浏览器实际拿到的那份字节也要过同一套契约（能定位"文件已修但页面仍白屏"这类缓存/下发问题）──
const base = process.env.VORE_WEB_URL ?? "http://127.0.0.1:3080";
let online = false;
try {
  const res = await fetch(base + "/", { signal: AbortSignal.timeout(4000) });
  online = res.ok;
} catch { online = false; }

if (!online) {
  console.log(`\n（dsh web 未在 ${base} 监听 —— 跳过"浏览器实收字节"校验；设 VORE_WEB_URL 可指定）`);
} else {
  console.log(`\n在线面：${base} 下发的客户端 bundle（浏览器实际执行的那份）`);
  const html = await (await fetch(base + "/")).text();
  for (const pkgName of Object.keys(EXPECT)) {
    const m = html.match(new RegExp(`/plugins/${pkgName.replace(/[/@.]/g, "\\$&")}/client\\.js\\?rev=[0-9a-f]+`));
    ok(`${pkgName}: boot 页已登记客户端 bundle（带 rev 防缓存）`, () => {
      if (!m) throw new Error("boot 页未引用该 bundle");
    });
    if (!m) continue;
    const code = await (await fetch(base + m[0])).text();
    ok(`${pkgName}: 下发字节通过全套契约（id / factory 形参 ≤1 / 槽位齐备 / 组件可渲染）`, () => {
      const info = loadPanelBundle({ code, pkgName });
      if (info.factoryArity > 1) throw new Error(`下发的 factory 形参 ${info.factoryArity} 个（浏览器会抛 exports undefined）`);
      for (const want of EXPECT[pkgName].slots) {
        const slot = info.slots.find((s) => s.name === want.name && s.label === want.label);
        if (typeof slot?.component !== "function") throw new Error(`下发字节缺槽位 ${want.name}（标签「${want.label}」）`);
        if (!slot.component({})) throw new Error(`槽位 ${want.name} 组件首帧没有返回元素`);
      }
    });
  }
}

console.log(`\n全部通过：${pass} 项${fail ? `，未通过 ${fail} 项` : ""}`);
process.exit(fail ? 1 : 0);
