// 发布前密钥扫描：把 ~/.dsh/voredteam/settings.json 里的真实密钥值拿去全仓比对，
// 再按形状扫一遍可疑串。**只打印命中位置，绝不回显密钥本身**。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const repoRoot = process.cwd();
const settingsPath = path.join(os.homedir(), ".dsh", "voredteam", "settings.json");

const secrets = [];
try {
  const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  for (const [group, cfg] of Object.entries(s)) {
    if (!cfg || typeof cfg !== "object") continue;
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === "string" && v.trim().length >= 8 && /key|token|secret|passwd|password/i.test(k)) {
        secrets.push({ label: `${group}.${k}`, value: v.trim() });
      }
    }
  }
} catch (e) {
  console.log(`（读不到 ${settingsPath}：${e.code ?? e.message}）`);
}
console.log(`本机 settings 里取到 ${secrets.length} 个凭据字段（值不回显）：`);
for (const s of secrets) console.log(`  - ${s.label}（长度 ${s.value.length}，前 3 位 ${s.value.slice(0, 3)}…）`);

const SKIP = /(^|[\\/])(node_modules|\.git|\.git-cache)([\\/]|$)/;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && fs.statSync(p).size < 8 * 1024 * 1024) files.push(p);
  }
})(repoRoot);
console.log(`\n扫描 ${files.length} 个文件…`);

const hits = [];
const patterns = [
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "FOFA/Shodan 形状（32 位十六进制，且上下文提到 key）", re: /(?:fofa|shodan)[^\n]{0,80}?["'\s:=]+([0-9a-f]{32})/gi },
  { name: "疑似硬编码 apiKey", re: /(?:api[_-]?key|apikey|access[_-]?token)\s*[:=]\s*["']([^"'\s${}]{16,})["']/gi },
];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const rel = path.relative(repoRoot, f);
  for (const s of secrets) {
    if (text.includes(s.value)) hits.push({ file: rel, why: `含真实凭据 ${s.label}` });
  }
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      hits.push({ file: rel, why: `${p.name}： …${String(m[1] ?? m[0]).slice(-6)}` });
    }
  }
}
if (!hits.length) console.log("\n✓ 没有命中：仓库里不含本机任何真实密钥，也没有明显硬编码凭据");
else {
  console.log(`\n⚠ 命中 ${hits.length} 处，逐条看：`);
  for (const h of hits) console.log(`  ${h.file}  ←  ${h.why}`);
}
