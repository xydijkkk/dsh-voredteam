// 一次性救援脚本：lib/panel.js 被 PowerShell 的 Get-Content|Set-Content 编码往返搞坏了（GBK 误解码 → '?' 丢字）。
// 好在就在损坏前刚跑过 build-client，lib/client.js 里逐字包含**未损坏**的 panel.js 源码。
// 这里把那一段切出来写回 lib/panel.js。（事后用 build-client --check 验证：重建后应与 client.js 完全一致）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientPath = path.join(root, "plugins", "vore-console", "lib", "client.js");
const panelPath = path.join(root, "plugins", "vore-console", "lib", "panel.js");

const code = fs.readFileSync(clientPath, "utf8");
const lines = code.split("\n");
const startMark = "// vore-console 面板实现（构建期被 scripts/build-client.mjs 拼接进 lib/client.js）";
const endMark = 'module.exports = { name: "vore-console-client"';
const start = lines.findIndex((l) => l.includes(startMark));
const end = lines.findIndex((l) => l.startsWith(endMark));
if (start < 0 || end < 0 || end <= start) throw new Error(`定位失败：start=${start} end=${end}`);

const panel = lines.slice(start, end).join("\n") + "\n";
if (!panel.includes("fitZoom(")) throw new Error("切出来的 panel.js 不含 fitZoom —— 可能切错段");
if (!panel.includes("dsh-vc-canvaswrap")) throw new Error("切出来的 panel.js 不含画布外层容器");
if (panel.includes("\uFFFD")) throw new Error("切出来的内容里已有替换字符");
fs.writeFileSync(panelPath, panel, "utf8");
console.log(`✓ 已从 client.js 还原 lib/panel.js：${panel.length} 字符 / ${panel.split("\n").length} 行`);
