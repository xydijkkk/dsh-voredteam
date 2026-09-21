// 预设组合行 × 宿主插件配置 schema 的**逐行对账**。
//
// 为什么需要：宿主对未知配置键是**宽容**的（schema 校验后原样带回），所以写错字段名不会报错、
// 只会静默失效 —— 例如 persona 行写了 `prefix:`，而 `@deepseek-ai/dsh-persona` 的 Config 只认
// `text / complete / includeRuntimeContext`，于是整段 persona 正文被无声丢弃。
//
// 做法：解析本项目的 agent.cordis.yml，对每一行按包名在 DSH 检出目录里找到源码入口，
// import 它的 `Config`（cordis schema），用行里的 config 跑一遍校验，比对「输入键 vs 归一化后的键」。
//
// 运行（必须在 DSH 检出目录下，借它的 node_modules）：
//   cd <DSH checkout>
//   node --import tsx/esm <仓库>/tests/preset-config-schema.mjs [预设路径]
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

// 这些探针要读 DSH 的宿主源码/预设装载面：没给 checkout 就明确报错，别给"莫名其妙的断言失败"
if (!process.env.DSH_CHECKOUT && !(process.env.DSH_HOME && existsSync(process.env.DSH_HOME))) {
  const guess = (process.argv.find((a) => a.startsWith("--checkout=")) ?? "").slice(11);
  if (!guess) {
    console.error("需要 DSH checkout：设环境变量 DSH_CHECKOUT=<deepseek-harness 目录>（或 --checkout=<目录>）再跑。");
    process.exit(2);
  }
}
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHECKOUT = process.env.DSH_CHECKOUT ?? process.cwd();
const PRESET = process.argv[2] ?? path.join(REPO_ROOT, "modes", "network-security", "agent.cordis.yml");

const yaml = await import(pathToFileURL(join(CHECKOUT, "node_modules", "js-yaml", "index.js")).href).catch(() => null);
if (!yaml) { console.error("找不到 js-yaml（请在 DSH 检出目录下运行）"); process.exit(2); }

// ── 包名 → 源码目录 映射 ─────────────────────────────────────────────────────
const byName = new Map();
(function walk(dir, depth) {
  if (depth > 6) return;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (["node_modules", ".git", "dist", "lib", "tests", "docs"].includes(e.name)) continue;
    const p = join(dir, e.name);
    const pkg = join(p, "package.json");
    if (existsSync(pkg)) {
      try {
        const meta = JSON.parse(readFileSync(pkg, "utf8"));
        if (meta.name && existsSync(join(p, "src", "index.ts"))) byName.set(meta.name, join(p, "src", "index.ts"));
      } catch { /* 忽略坏 package.json */ }
    }
    walk(p, depth + 1);
  }
})(join(CHECKOUT, "packages"), 0);
(function walkApps(dir, depth) {
  if (depth > 4) return;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    if (["node_modules", ".git", "dist", "lib", "tests"].includes(e.name)) continue;
    const p = join(dir, e.name);
    const pkg = join(p, "package.json");
    if (existsSync(pkg)) {
      try {
        const meta = JSON.parse(readFileSync(pkg, "utf8"));
        if (meta.name && existsSync(join(p, "src", "index.ts"))) byName.set(meta.name, join(p, "src", "index.ts"));
      } catch { /* ignore */ }
    }
    walkApps(p, depth + 1);
  }
})(join(CHECKOUT, "apps"), 0);

// ── 解析预设行 ───────────────────────────────────────────────────────────────
const doc = yaml.load(readFileSync(PRESET, "utf8"));
const rows = [];
(function collect(list) {
  for (const row of Array.isArray(list) ? list : []) {
    if (row && typeof row === "object" && row.group === true && Array.isArray(row.config)) { collect(row.config); continue; }
    rows.push(row);
  }
})(doc);

console.log(`预设：${PRESET}`);
console.log(`组合行：${rows.length} 条（扁平化后）\n`);

let problems = 0;
for (const row of rows) {
  const name = row?.name;
  if (typeof name !== "string") { console.log(`  ⚠ 行 ${JSON.stringify(row?.id)} 没有 name`); problems++; continue; }
  const src = byName.get(name);
  if (!src) { console.log(`  · ${String(row.id).padEnd(20)} ${name} —— 未在检出目录找到源码（跳过校验）`); continue; }
  let mod;
  try { mod = await import(pathToFileURL(src).href); } catch (e) { console.log(`  · ${String(row.id).padEnd(20)} ${name} —— import 失败：${String(e.message).slice(0, 60)}`); continue; }
  const Config = mod.Config;
  const input = row.config ?? {};
  if (typeof Config !== "function") {
    // 有些插件**不导出 Config**，而是在 apply/mount 期自己校验（例：@deepseek-ai/dsh-plan-mode 的
    // resolveConfig 要求非空 `section` —— 实测 boot 时会真的校验并抛错）。
    // 静态查不到 Config 就不能断言"会被忽略"：改为在源码里找该键的踪迹，找到就算"运行期校验"。
    let srcText = "";
    try { srcText = readFileSync(src, "utf8"); } catch { /* 读不到就按未知处理 */ }
    const keys = Object.keys(input);
    const referenced = keys.filter((k) => new RegExp(`[.\\["'\`]${k}\\b`).test(srcText));
    const hasConfig = keys.length > 0;
    if (hasConfig && referenced.length === keys.length) {
      console.log(`  ✓ ${String(row.id).padEnd(20)} ${name} —— 未导出 Config，但源码在运行期引用并校验（${keys.join(", ")}）`);
    } else {
      console.log(`  ${hasConfig ? "⚠" : "✓"} ${String(row.id).padEnd(20)} ${name} —— 插件无 Config schema${hasConfig ? `，但行里写了 config：${keys.join(", ")}（源码里也没引用 → 会被忽略！）` : ""}`);
      if (hasConfig) problems++;
    }
    continue;
  }
  try {
    const out = Config(input);
    // 未知键探测：宿主 schema 对未知键是宽容的（原样带回），所以不能只看输出键集合。
    // 逐键剔除：若某个键缺席时校验仍通过且输出里没有它 → 该键就是未被声明的（会被静默忽略）。
    const outKeys = new Set(Object.keys(out ?? {}));
    const unknown = [];
    for (const k of Object.keys(input)) {
      const trimmed = { ...input };
      delete trimmed[k];
      let ok = null;
      try { ok = Config(trimmed); } catch { ok = undefined; } // 抛错 = k 是必需键，说明 schema 认识它
      if (ok !== undefined && !(k in ok) && !outKeys.has(k)) unknown.push(k);
      else if (ok !== undefined && !(k in ok) && outKeys.has(k)) {
        // 有默认值的情况：键在输出里但值等于默认 → 可能来自默认而非输入。再单独验证一次：
        const direct = Config({ ...trimmed, [k]: undefined });
        if (k in direct && JSON.stringify(direct[k]) !== JSON.stringify(out[k])) unknown.push(k);
      }
    }
    // 更可靠的一招：把该键换成一个不可能被接受的哨兵值（对象），声明的键会因类型不符而抛错。
    const strictUnknown = [];
    for (const k of Object.keys(input)) {
      const probe = { ...input, [k]: { __probe__: true } };
      if (typeof input[k] === "object" && input[k] !== null) continue; // 原值本就是对象，跳过哨兵
      try { Config(probe); strictUnknown.push(k); } catch { /* 抛错 = schema 认识这个键 */ }
    }
    const bad = [...new Set([...unknown, ...strictUnknown])];
    if (bad.length) {
      console.log(`  ✗ ${String(row.id).padEnd(20)} ${name} —— 未被 schema 声明的配置键（宿主会静默忽略）：${bad.join(", ")}`);
      problems++;
    } else {
      console.log(`  ✓ ${String(row.id).padEnd(20)} ${name} —— 配置键全部有效（${Object.keys(input).join(", ") || "无 config"}）`);
    }
  } catch (e) {
    console.log(`  ✗ ${String(row.id).padEnd(20)} ${name} —— 校验抛错：${String(e.message).split("\n")[0].slice(0, 140)}`);
    problems++;
  }
}

console.log(`\n结果：${problems === 0 ? "全部通过" : `${problems} 条有问题`}`);
process.exit(problems ? 1 : 0);
