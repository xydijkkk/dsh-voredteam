// 预设契约测试：验证 modes/network-security/agent.cordis.yml 的每一行组合引用都能解析到真实包，
// 且关键行（persona / 委派组 / 本项目插件 / 技能根）齐备。
// 运行：node tests/preset.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

const presetPath = path.join(root, "modes", "network-security", "agent.cordis.yml");
const yml = fs.readFileSync(presetPath, "utf8");

/** 极简行解析：取 `- id: x` 与其后最近一个 `name: y`，忽略缩进层级差异。 */
function parseRows(text) {
  const rows = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const id = raw.match(/^\s*- id:\s*(.+?)\s*$/);
    if (id) { cur = { id: id[1] }; rows.push(cur); continue; }
    if (!cur) continue;
    const nm = raw.match(/^\s+name:\s*(.+?)\s*$/);
    if (nm && !cur.name) { cur.name = nm[1].replace(/^['"]|['"]$/g, ""); continue; }
    const cfg = raw.match(/^\s+(provider|isolate|agentsDir):\s*(.+?)\s*$/);
    if (cfg) cur[cfg[1]] = cfg[2];
  }
  return rows;
}

const rows = parseRows(yml);
const localPkgs = new Set();
for (const dir of fs.readdirSync(path.join(root, "plugins"))) {
  const pj = path.join(root, "plugins", dir, "package.json");
  if (fs.existsSync(pj)) localPkgs.add(JSON.parse(fs.readFileSync(pj, "utf8")).name);
}

console.log("预设组合行（modes/network-security/agent.cordis.yml）");

ok("预设可解析出组合行，且关键行齐备", () => {
  assert.ok(rows.length >= 12, `组合行太少：${rows.length}`);
  const ids = rows.map((r) => r.id);
  for (const need of ["persona", "agent-instructions", "delegation", "planning", "compaction", "skill-filesystem"]) {
    assert.ok(ids.includes(need), `缺少组合行：${need}`);
  }
  const names = rows.map((r) => r.name).filter(Boolean);
  assert.ok(names.includes("@deepseek-ai/dsh-persona"), "缺少 persona");
  assert.ok(names.filter((n) => n === "@deepseek-ai/dsh-tool-subagent").length >= 2, "委派组应有两个 provider 行（spawn/fork）");
});

ok("预设不得重复挂载 profile bundle 里的插件（会撞 HTTP 前缀路由 → mount 整单失败）", () => {
  const profilePkg = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "profiles", "web", "package.json");
  let bundles = [];
  if (fs.existsSync(profilePkg)) {
    bundles = JSON.parse(fs.readFileSync(profilePkg, "utf8")).dsh?.profile?.bundles ?? [];
  }
  // 宿主面插件（本项目 4 个插件都在 bundles 里）对每个会话都生效，工具内部按模式判定行为；
  // 预设里再写一遍 → 同一条 webServer 前缀路由注册两次 → "duplicate prefix route" → 模式选择弹回默认。
  const dup = rows.map((r) => r.name).filter((n) => bundles.includes(n));
  assert.equal(dup.length, 0, `以下行与 profile bundles 重复：${dup.join(", ")}`);
  const ours = rows.map((r) => r.name).filter((n) => n?.startsWith("@dsh-external/"));
  for (const pkg of ours) assert.ok(localPkgs.has(pkg), `${pkg} 不在 plugins/* 里`);
});

ok("plan-mode 行必须给非空 section；delegation 组必须带 workflow 引擎行", () => {
  const planBlock = yml.split(/\n(?=\s*- id: )/).find((b) => /- id: plan-mode\s*$/m.test(b)) ?? "";
  assert.ok(/^\s+section:\s*\|/m.test(planBlock), "plan-mode 缺 config.section → PlanModeConfig 校验失败 → mount 失败");
  assert.ok(/name: '@deepseek-ai\/dsh-workflow-worker-thread'/.test(yml),
    "缺 workflow 引擎行（@deepseek-ai/dsh-workflow-worker-thread）→ tool-workflow 一直等 workflowEngine");
});

ok("persona 行含范式与唯一门禁的关键表述", () => {
  const persona = yml.slice(yml.indexOf("- id: persona"));
  for (const kw of ["状态空间", "Fact", "Intent", "Hint", "禁 DDoS", "低频"]) {
    assert.ok(persona.includes(kw), `persona 缺少关键表述：${kw}`);
  }
});

ok("技能根全部内置且用 {{PROJECT_ROOT}} 模板（内置目录真实存在）", () => {
  const m = yml.match(/customSkillDirs:\s*\n((?:\s+- .*\n)+)/);
  assert.ok(m, "未找到 customSkillDirs");
  const dirs = [...m[1].matchAll(/-\s*'([^']+)'/g)].map((x) => x[1]);
  assert.ok(dirs.length >= 5, `技能根太少：${dirs.length}`);
  // 出厂模板只能是 {{PROJECT_ROOT}} 相对形式 —— 写死本机路径就没法发布（另由 portability 闸门兜底）
  const absolute = dirs.filter((d) => /^[A-Za-z]:[\\/]/.test(d) || d.startsWith("/"));
  assert.equal(absolute.length, 0, `技能根出现绝对路径：${absolute.join(", ")}`);
  const bad = dirs.filter((d) => !d.startsWith("{{PROJECT_ROOT}}/"));
  assert.equal(bad.length, 0, `技能根必须以 {{PROJECT_ROOT}}/ 开头：${bad.join(", ")}`);
  // 模板相对路径在本仓库里必须真实存在（落盘时才替换成绝对路径）
  const missing = dirs
    .map((d) => d.replace("{{PROJECT_ROOT}}/", ""))
    .filter((rel) => !fs.existsSync(path.join(root, rel)));
  assert.equal(missing.length, 0, `模板指向的目录不存在：${missing.join(", ")}`);
  assert.ok(dirs.some((d) => d === "{{PROJECT_ROOT}}/skills"), "缺少本项目 skills/ 根");
  for (const lib of ["claude-red", "claude-red-legacy", "reverse-skill", "anthropic"]) {
    assert.ok(dirs.some((d) => d.includes(`vendor/skills/${lib}`)), `缺内置技能根 vendor/skills/${lib}`);
  }
});

ok("外部 @deepseek-ai/* 行在宿主里可解析（抽样，缺失只告警不失败）", () => {
  const hostRoot = path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "profiles", "node_modules", "@deepseek-ai");
  if (!fs.existsSync(hostRoot)) { console.log("    （宿主 node_modules 不存在，跳过解析核对）"); return; }
  // 允许子路径导出（如 @deepseek-ai/dsh-tool-subagent-control/list-agents），只核对包名部分
  const pkgs = [...new Set(rows.map((r) => r.name)
    .filter((n) => n?.startsWith("@deepseek-ai/"))
    .map((n) => n.split("/").slice(0, 2).join("/")))];
  const missing = pkgs.filter((p) => !fs.existsSync(path.join(hostRoot, p.replace("@deepseek-ai/", ""))));
  if (missing.length) console.log(`    ⚠ 宿主未安装：${missing.join(", ")}（装 DSH 时按需补齐）`);
  assert.ok(pkgs.length > 0);
});

ok("插件包元数据自洽（name/main/bundle.patch 三者一致）", () => {
  for (const dir of fs.readdirSync(path.join(root, "plugins"))) {
    const pj = path.join(root, "plugins", dir, "package.json");
    if (!fs.existsSync(pj)) continue;
    const meta = JSON.parse(fs.readFileSync(pj, "utf8"));
    assert.match(meta.name, /^@dsh-external\//, `${dir} 包名应以 @dsh-external/ 开头`);
    assert.ok(fs.existsSync(path.join(root, "plugins", dir, meta.main)), `${dir} 的 main 不存在`);
    const patch = meta.dsh?.bundle?.patch;
    if (patch) assert.ok(fs.existsSync(path.join(root, "plugins", dir, patch)), `${dir} 的 bundle.patch 不存在`);
  }
});

ok("预设元数据不得抢占「默认模式」位（preset.yml 不写 order，或 order > 宿主自带的 4）", () => {
  const metaPath = path.join(root, "modes", "network-security", "preset.yml");
  const meta = fs.readFileSync(metaPath, "utf8");
  assert.ok(/^name:\s*\S+/m.test(meta), "preset.yml 缺 name");
  const m = meta.match(/^order:\s*(\d+)\s*$/m);
  const order = m ? Number(m[1]) : undefined;
  // 宿主 roster 排序：order 升序，未声明 order 的排在最后（按 id）。
  // 客户端在「没有任何预设被标记为 default」时回退到 presets[0]（seat-store.ts:93），
  // 所以一旦本地预设的 order 小于宿主自带的 1..4，它就会变成**默认模式**——用户明确不要这个行为。
  assert.ok(
    order === undefined || order > 4,
    `preset.yml 的 order=${order} 会让本模式排到宿主自带模式（order 1..4）之前，从而抢占默认位；删掉 order 或写成 >4`,
  );
});

ok("每个 cordis:group 行都必须带 group: true（否则 config 数组不会被当成嵌套条目清单）", () => {
  const text = yml.replace(/\r\n/g, "\n");
  const blocks = text.split(/\n(?=- id: )/).filter((b) => /^\s*- id: /.test(b));
  const groups = blocks.filter((b) => /^\s+name: cordis:group\s*$/m.test(b));
  assert.ok(groups.length >= 3, `应有 3 个 group 行（delegation/planning/compaction），实际 ${groups.length}`);
  for (const b of groups) {
    const id = (b.match(/- id: (\S+)/) ?? [])[1];
    // 依据：packages/boot/app-boot/tests/config-reload.spec.ts:258 —— loader.create({ name: 'cordis:group', group: true, config: [...] })
    // 以及 discovery.ts:70（只有 group === true 才把 config 当作条目清单递归校验）。缺 group: true → 组内插件一个都不挂载。
    assert.ok(/^\s+group: true\s*$/m.test(b), `${id} 缺 group: true —— 组内的插件行不会挂载`);
    assert.ok(/^\s+isolate:/m.test(b), `${id} 缺 isolate —— 服务行会发布到 root realm，mount 时被判冲突`);
  }
});

ok("委派组两个 subagent provider 必须各自声明 toolName（默认同名会撞车）", () => {
  const blocks = yml.replace(/\r\n/g, "\n").split(/\n(?=- id: )|\n(?=    - id: )/);
  const subagents = blocks.filter((b) => /name: '@deepseek-ai\/dsh-tool-subagent'\s*$/m.test(b));
  assert.equal(subagents.length, 2, `应有 spawn/fork 两个 provider 行，实际 ${subagents.length}`);
  const names = subagents.map((b) => (b.match(/^\s+toolName:\s*(\S+)/m) ?? [])[1]);
  assert.ok(names.every(Boolean), `两行都必须显式声明 toolName（schema 默认都是 subagent，第二行会覆盖第一行）`);
  assert.equal(new Set(names).size, 2, `toolName 必须不同，实际：${names.join(", ")}`);
  assert.ok(names.includes("subagent") && names.includes("subagent_fork"), `toolName 应为 subagent / subagent_fork，实际：${names.join(", ")}`);
});

ok("少数插件有「必需配置键」，不得遗漏（缺了会被 mount 拒绝）", () => {
  const required = {
    "tool-fs-search": "sampleOverCapGlobResults",
    "tool-todo": "allowParallelInProgress",
  };
  for (const [id, key] of Object.entries(required)) {
    const re = new RegExp(`- id: ${id}\\n((?:.*\\n)*?)(?=- id: |\\z)`);
    const block = (yml.match(re) ?? [])[1] ?? "";
    assert.ok(new RegExp(`^\\s+${key}:`, "m").test(block), `${id} 缺必需键 ${key}（宿主 schema 里是 required，无默认）`);
  }
});

console.log(`\n全部通过：${passed} 项`);
