// 修被"移动仓库"破坏的插件依赖链接：plugins/node_modules/@deepseek-ai/dsh-tools → DSH 检出里的 packages/core/tools
// 背景：这个链接原本是 junction，移动目录时被压成了空目录，于是 tests/* 里 import 插件源码会报
// `Cannot find package .../@deepseek-ai/dsh-tools/index.js`。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const link = path.join(REPO, "plugins", "node_modules", "@deepseek-ai", "dsh-tools");
const checkout = process.env.DSH_CHECKOUT ?? path.join(process.env.USERPROFILE, "Desktop", "ds", "deepseek-harness");
const target = path.join(checkout, "packages", "core", "tools");

console.log(`链接：${link}`);
console.log(`目标：${target}（存在=${fs.existsSync(target)}）`);
if (!fs.existsSync(target)) {
  console.error("DSH 检出里找不到 packages/core/tools：用 DSH_CHECKOUT=<deepseek-harness 目录> 指定");
  process.exit(2);
}

const resolvable = () => {
  try { fs.accessSync(path.join(link, "package.json")); return true; } catch { return false; }
};

if (resolvable()) {
  console.log("✓ 已经是可解析的链接，无需处理");
} else {
  fs.rmSync(link, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "junction");   // Windows 上 junction 不需要管理员权限
  console.log(resolvable() ? "✓ 已重建 junction" : "✗ 重建后仍不可解析");
}
const pkg = JSON.parse(fs.readFileSync(path.join(link, "package.json"), "utf8"));
console.log(`解析到包：${pkg.name}（main=${pkg.main ?? "-"}）`);
console.log(`lib/index.js 在：${fs.existsSync(path.join(link, "lib", "index.js"))}`);
