// vore-console 客户端 bundle 构建：把 lib/pure.mjs（纯函数）与 lib/panel.js（面板实现）
// 拼进 DSH 客户端契约（classic script + window.__ModuleLoader__.load({id, factory})）。
//
// 为什么需要这一步：DSH 的 Web 客户端只加载这种 classic bundle，且 bundle 内只能
// require 平台 seed 词（react 等）——所以 pure.mjs 必须被**内联**而不是被 import。
// 构建同时做一次 vm 装载自检（scripts/vm-check.mjs）：假 loader + 假 React 下
// apply() 必须注册 conversation.view 槽位。
//
// 运行：node scripts/build-client.mjs [--check]
//   --check：只校验 lib/client.js 与源文件一致（CI 用），不写盘。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPanelBundle } from "./vm-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const pkgName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name;
const purePath = path.join(root, "lib", "pure.mjs");
const panelPath = path.join(root, "lib", "panel.js");
const outPath = path.join(root, "lib", "client.js");

const BANNER = `/*!
 * vore-console / lib/client.js —— 由 scripts/build-client.mjs 生成，请勿手改。
 * 源：lib/pure.mjs（纯函数）+ lib/panel.js（面板实现）。
 * 契约：classic script，执行时只做 window.__ModuleLoader__.load({id, factory}) 注册；
 *      模块体（require("react") / 注入样式 / apply）在首次 materialize 时运行。
 */`;

/** pure.mjs → 可内联的脚本体（去掉 ESM 语法）。 */
function pureAsScript(text) {
  return text
    .replace(/^import[^;]+;$/gm, "")
    .replace(/^export\s+(const|let|var|function)\s/gm, "$1 ")
    .replace(/^export\s*\{[^}]*\};?$/gm, "");
}

function build() {
  const pure = pureAsScript(fs.readFileSync(purePath, "utf8"));
  const panel = fs.readFileSync(panelPath, "utf8");
  const stripped = pure.replace(/\/\/.*$/gm, "");
  if (/(^|\n)\s*export\b/.test(stripped)) throw new Error("pure.mjs 里仍有 export（内联后会语法错误）");
  return [
    BANNER,
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkgName)}, factory: (require) => {`,
    `var module = { exports: {} }; var exports = module.exports;`,
    `"use strict";`,
    `var React = require("react");`,
    pure,
    panel,
    `module.exports = { name: "vore-console-client", inject: ["slots"], apply: apply };`,
    `return module.exports; } });`,
    "",
  ].join("\n");
}

const code = build();
const check = process.argv.includes("--check");

if (check) {
  const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (cur !== code) {
    console.error("✗ lib/client.js 与源文件不一致：请运行 node scripts/build-client.mjs");
    process.exit(1);
  }
  const info = loadPanelBundle({ code, pkgName, expectSlot: "conversation.view", expectLabel: "作战面板" });
  console.log(`✓ lib/client.js 与源一致；vm 装载自检通过：bundle=${info.bundleId} slots=${info.slots.map((s) => s.id).join(",")} label=${info.slots[0].label}`);
  process.exit(0);
}

const info = loadPanelBundle({ code, pkgName, expectSlot: "conversation.view", expectLabel: "作战面板" });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, code, "utf8");
console.log(`✓ 已生成 ${path.relative(root, outPath)}（${code.length} 字符）`);
console.log(`✓ vm 装载自检通过：bundle=${info.bundleId} slots=${info.slots.map((s) => s.id).join(",")} label=${info.slots[0].label}`);
