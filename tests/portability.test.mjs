// 可移植性闸门：**出厂文件里不得出现本机绝对路径**（项目要发布）。
//
// 覆盖范围：仓库内会随包发布的文件（README / modes / plugins / skills / mcp / deploy / vendor 的说明文件…）。
//   · 排除 docs/（审计报告按性质会描述作者机器布局）、tests/（开发脚本，用环境变量指向本机资源）、
//     vendor/skills（第三方内容原样内置）、以及 *.local.* / _uninstall-backup（本地专用文件）。
// 允许的形式：占位符 ${VAR} / %VAR%、模板 {{PROJECT_ROOT}}、回环地址、以及仓库相对路径。
//
// 用法：node --no-warnings tests/portability.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 绝对路径扫描：docs/ 与 tests/ 允许出现作者机器布局（审计与开发脚本的性质）
const SKIP_DIRS = new Set(["node_modules", ".git", "docs", "tests", "vendor", "_uninstall-backup", "lib"]);
// 「他项目特征名」扫描：全仓库（只排除 vendor 第三方内容与本地专用文件）
const ORIGIN_SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "_uninstall-backup", "lib"]);
const SKIP_FILE_RE = /(\.local\.|registry\.local\.|package\.json\.bak|\.bak-|\.log$)/;
const EXTS = new Set([".md", ".yml", ".yaml", ".json", ".js", ".mjs", ".cjs", ".ps1", ".sh", ".txt"]);

/** 本机绝对路径的特征（Windows 盘符、macOS/Linux 家目录）。 */
const PATTERNS = [
  { re: /[A-Za-z]:[\\/]{1,2}(?:Users|everything|Program Files|Windows|opt|tools)/i, what: "Windows 本机绝对路径" },
  { re: /(?:^|[\s`"'(])\/(?:Users|home)\/[A-Za-z0-9._-]+\//, what: "类 Unix 家目录绝对路径" },
  { re: /[A-Za-z]:[\\/]{1,2}Desktop[\\/]{1,2}/i, what: "桌面绝对路径" },
];

/** 允许出现的例外（占位符行、示例说明、正则/检测代码自身）。 */
const ALLOW_LINE = [
  /\$\{[A-Z_]+\}/,
  /\{\{PROJECT_ROOT\}\}/,
  /allowed|允许|排除|例外|placeholder|占位/,
  /PATTERNS|SKIP_DIRS|what: "|re:\s*\//,
];

let checkOriginClean = true;
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
    if (SKIP_FILE_RE.test(e.name)) continue;
    if (!EXTS.has(path.extname(e.name).toLowerCase())) continue;
    files.push(path.join(dir, e.name));
  }
})(root);

const hits = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (ALLOW_LINE.some((re) => re.test(line))) return;
    for (const { re, what } of PATTERNS) {
      if (re.test(line)) {
        hits.push({ file: path.relative(root, f), line: i + 1, what, text: line.trim().slice(0, 120) });
        break;
      }
    }
  });
}

console.log(`扫描 ${files.length} 个出厂文件（排除 docs/ tests/ vendor/ 与 *.local.*）`);
if (hits.length === 0) {
  console.log("  ✓ 未发现本机绝对路径");
} else {
  for (const h of hits.slice(0, 40)) console.log(`  ✗ ${h.file}:${h.line} [${h.what}] ${h.text}`);
  if (hits.length > 40) console.log(`  … 另有 ${hits.length - 40} 处`);
}

// 断言：仓库内不得出现任何「被参照过的项目」的特征名（品牌、插件名、项目名）——项目只呈现自身。
// 注意：**连本文件也不写字面量**：下面的词由片段拼接而成，这样闸门自身也不算"残留痕迹"。
// 需要新增禁止词时，照抄这种拼法：["片段1","片段2"].join("")。
{
  const piece = (...parts) => new RegExp(parts.join(""), "i");
  const FORBIDDEN = [
    { re: piece("Ca", "irn"), what: "被参照项目的名字" },
    { re: piece("Des", "Red", "Team"), what: "被参照项目的名字" },
    { re: piece("dsh-", "redteam-", "model"), what: "被参照项目的包名" },
    { re: piece("attack-", "atlas"), what: "被参照项目的插件名" },
    { re: piece("dsh-", "hunter"), what: "被参照项目的插件名" },
    { re: piece("webshell-", "mgr"), what: "被参照项目的插件名" },
  ];
  // 全仓库扫描（含 docs/ 与 tests/）：任何被参照项目的品牌/插件名都不该出现
  const allFiles = [];
  (function walkAll(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!ORIGIN_SKIP_DIRS.has(e.name)) walkAll(path.join(dir, e.name)); continue; }
      if (SKIP_FILE_RE.test(e.name)) continue;
      if (!EXTS.has(path.extname(e.name).toLowerCase())) continue;
      allFiles.push(path.join(dir, e.name));
    }
  })(root);
  const hits2 = [];
  for (const f of allFiles) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/被参照项目|FORBIDDEN|const piece/.test(line)) return; // 闸门自身的说明行
      for (const { re, what } of FORBIDDEN) if (re.test(line)) { hits2.push(`${path.relative(root, f)}:${i + 1} [${what}] ${line.trim().slice(0, 100)}`); break; }
    });
  }
  if (hits2.length) { console.log(`\n他项目特征名检查（扫描 ${allFiles.length} 个文件）：`); for (const h of hits2.slice(0, 20)) console.log(`  ✗ ${h}`); }
  else console.log(`\n  ✓ 全仓库 ${allFiles.length} 个文件不含任何他项目特征名`);
  checkOriginClean = hits2.length === 0;
}

// 附带断言：模板块里出现 {{PROJECT_ROOT}}（说明模板机制还在用），且 renderPresetFile 在 deploy 里存在
const presetYml = fs.readFileSync(path.join(root, "modes", "network-security", "agent.cordis.yml"), "utf8");
const deploySrc = fs.readFileSync(path.join(root, "deploy", "deploy.mjs"), "utf8");
const checks = [
  ["预设模板含 {{PROJECT_ROOT}} 占位符", presetYml.includes("{{PROJECT_ROOT}}")],
  ["deploy 会渲染 {{PROJECT_ROOT}}", deploySrc.includes("PRESET_ROOT_TOKEN") && deploySrc.includes("renderPresetFile")],
  // 本机额外技能根走"模板占位符 + 环境变量"：既能让本机技能农场（如桌面上另建的 voskill）
  // 被 skill 工具装载，又不在仓库里写死路径 —— 两侧少一个就静默失效，所以钉住
  ["预设模板含 {{EXTRA_SKILL_DIRS}} 占位符", presetYml.includes("- '{{EXTRA_SKILL_DIRS}}'")],
  ["deploy 会渲染 {{EXTRA_SKILL_DIRS}}（读 VORE_EXTRA_SKILL_DIRS）", deploySrc.includes("PRESET_EXTRA_SKILLS_LINE") && deploySrc.includes("VORE_EXTRA_SKILL_DIRS")],
  ["技能注册表路径全为仓库相对", !/^\s+path:\s*'?[A-Za-z]:/m.test(fs.readFileSync(path.join(root, "skills", "registry.yaml"), "utf8"))],
  ["MCP 注册表使用 ${VAR} 占位符", /\$\{[A-Z_]+\}/.test(fs.readFileSync(path.join(root, "mcp", "registry.yaml"), "utf8"))],
  ["vendor 下无目录联接", !fs.readdirSync(path.join(root, "vendor", "skills")).some((n) => fs.lstatSync(path.join(root, "vendor", "skills", n)).isSymbolicLink())],
  // 仓库路径**含非 ASCII**（中文目录名）时，脚本必须用 fileURLToPath 解析自身位置：
  // `new URL(import.meta.url).pathname` 是百分号编码的，会把 ROOT 指到一个不存在的目录
  // （真实事故：仓库移到 `D:\vonandi\桌面的\sentou\voredteam` 后，deploy 报"modes/ 目录不存在"、
  //   4 个插件全被当成"陈旧项"、apply 还把预设渲染成 `%E6%A1%8C%E9%9D%A2%E7%9A%84` 的错路径）。
  ["脚本位置一律用 fileURLToPath（URL.pathname 遇非 ASCII 路径会变成 %E6…）", !urlPathnameOffenders().length],
];

/** 扫全仓库脚本，找出"用 new URL(import.meta.url).pathname 代替 fileURLToPath"的地方。 */
function urlPathnameOffenders() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!["node_modules", ".git", "vendor", "_uninstall-backup"].includes(e.name)) walk(path.join(dir, e.name)); continue; }
      if (![".mjs", ".js", ".cjs"].includes(path.extname(e.name).toLowerCase())) continue;
      const src = fs.readFileSync(path.join(dir, e.name), "utf8");
      src.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|#)/.test(line)) return;                          // 注释行（包括本闸门的说明行）
        if (/fileURLToPath/.test(line)) return;                            // 同行里已经用了正确写法
        if (/new URL\(import\.meta\.url\)\.pathname/.test(line)) out.push(`${path.relative(root, path.join(dir, e.name))}:${i + 1}`);
      });
    }
  })(root);
  return out;
}
let ok = hits.length === 0 && checkOriginClean;
console.log("");
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "✓" : "✗"} ${label}`);
  if (!pass) ok = false;
}

console.log(`\n结果：${ok ? "通过" : "未通过"}`);
process.exit(ok ? 0 : 1);
