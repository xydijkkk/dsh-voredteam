// dsh-voredteam 验收自检：一条命令给出全项目的结构与契约体检（离线，不需要 DSH 运行）。
// 运行：node --no-warnings tests/acceptance.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
const rows = [];
const add = (name, ok, detail = "") => rows.push({ name, ok, detail });

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

// 1) 预设
const presetDir = path.join(root, "modes", "network-security");
add("预设 preset.yml", exists(path.join(presetDir, "preset.yml")));
add("预设 agent.cordis.yml", exists(path.join(presetDir, "agent.cordis.yml")));
const presetText = exists(path.join(presetDir, "agent.cordis.yml")) ? fs.readFileSync(path.join(presetDir, "agent.cordis.yml"), "utf8") : "";
add("persona 含范式关键词", ["状态空间", "Fact", "Intent", "Hint"].every((k) => presetText.includes(k)));
add("persona 含唯一门禁", ["禁 DDoS", "爆破", "低频"].every((k) => presetText.includes(k)));
add("预设不挂载任何本项目之外的第三方 bundle", !/@dsh-external\/(?!vore-)/.test(presetText));

// 2) 角色卡
const agentsDir = path.join(root, "agents");
const cards = exists(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")) : [];
add(`角色卡 ${cards.length} 份`, cards.length === 13, cards.join(", "));
add("总控卡在册（kind: orchestrator）", cards.includes("orchestrator.md") &&
  /kind:\s*orchestrator/.test(fs.readFileSync(path.join(agentsDir, "orchestrator.md"), "utf8")));
add("12 个专业子 agent 齐备", ["recon", "js-reverse", "api-security", "web-injection", "auth-logic", "component-cve", "app-reverse", "internal-network", "cloud-ai", "exploit-dev", "reviewer", "reporter"]
  .every((id) => cards.includes(`${id}.md`)));
const cardMissing = cards.filter((f) => {
  const t = fs.readFileSync(path.join(agentsDir, f), "utf8");
  return !/^---\r?\n/.test(t) || !/黑板协议|bb_intent_claim/.test(t);
});
add("角色卡均带 frontmatter 与黑板协议", cardMissing.length === 0, cardMissing.join(", "));

// 3) 插件
const pluginsDir = path.join(root, "plugins");
const plugins = exists(pluginsDir)
  ? fs.readdirSync(pluginsDir).filter((d) => exists(path.join(pluginsDir, d, "package.json")))
  : [];
for (const dir of plugins) {
  const meta = readJson(path.join(pluginsDir, dir, "package.json"));
  const mainOk = exists(path.join(pluginsDir, dir, meta.main ?? ""));
  const patchOk = !meta.dsh?.bundle?.patch || exists(path.join(pluginsDir, dir, meta.dsh.bundle.patch));
  const clientExport = meta.exports?.["./client"];
  const clientOk = !clientExport || exists(path.join(pluginsDir, dir, clientExport));
  add(`插件 ${dir}`, mainOk && patchOk && clientOk,
    [meta.name, mainOk ? "" : "main 缺失", patchOk ? "" : "patch 缺失", clientOk ? "" : "client 缺失"].filter(Boolean).join(" "));
}
add("两块面板插件在册（作战面板/设置）",
  ["vore-console", "vore-settings"].every((d) => plugins.includes(d)), plugins.join(", "));
add("已移除 WebShell 面板（C2 走内置 AdaptixC2 MCP）", !plugins.includes("vore-webshell"));
add("黑板与门禁插件在册", ["vore-blackboard", "vore-guard"].every((d) => plugins.includes(d)));

// 4) 技能与 MCP 注册表
const skillsReg = path.join(root, "skills", "registry.yaml");
const skillCount = exists(skillsReg) ? [...fs.readFileSync(skillsReg, "utf8").matchAll(/^\s*- id:/gm)].length : 0;
add(`技能注册表 ${skillCount} 条（内置技能，仓库相对路径）`, skillCount >= 200);
const mcpReg = path.join(root, "mcp", "registry.yaml");
const mcpText = exists(mcpReg) ? fs.readFileSync(mcpReg, "utf8") : "";
const mcpIds = [...mcpText.matchAll(/^\s*- id:\s*(\S+)/gm)].map((m) => m[1]);
add(`MCP 注册表 ${mcpIds.length} 条`, mcpIds.length >= 10);
add("内建 MCP 三项在册", ["anything-analyzer", "fofa-mcp", "adaptix-c2-mcp"].every((id) => mcpIds.includes(id)));
add("hexstrike 未注册为服务器", !mcpIds.some((id) => /hexstrike/i.test(id)) && !/^\s*command:.*hexstrike/im.test(mcpText),
  "（注释里出现「已排除 hexstrike」字样是允许的）");
for (const s of ["vore-blackboard-ops", "vore-report", "vore-rate-discipline"]) {
  add(`技能 ${s}`, exists(path.join(root, "skills", s, "SKILL.md")));
}

// 5) 宿主安装状态（信息项：安装需要用户执行 deploy --apply + pnpm install + 重启 dsh web）
const info = [];
const profilePkg = path.join(home, "profiles", "web", "package.json");
if (exists(profilePkg)) {
  const profile = readJson(profilePkg);
  const missing = plugins.filter((d) => {
    const name = readJson(path.join(pluginsDir, d, "package.json")).name;
    return !(profile.dependencies?.[name] && (profile.dsh?.profile?.bundles ?? []).includes(name));
  });
  info.push(["profile 记账", missing.length === 0 ? "已记账" : `未记账 ${missing.length} 项（跑 deploy --apply）`]);
} else {
  info.push(["profile package.json", `未找到：${profilePkg}`]);
}
info.push(["预设 junction", exists(path.join(home, ".agent-presets", "network-security")) ? "已链接" : "未链接（跑 deploy --apply）"]);

// 6) 文档
add("README / ARCHITECTURE / LICENSE", ["README.md", "docs/ARCHITECTURE.md", "LICENSE", "deploy/README.md"].every((f) => exists(path.join(root, f))));
add("离线测试三件套", ["tests/smoke.mjs", "tests/registry.test.mjs", "tests/preset.test.mjs"].every((f) => exists(path.join(root, f))));
{
  // 授权使用声明必须是"活的"：文件在册 + README 里有指向它的链接 + 四段要件齐备
  // （防止哪天被静默删掉，或者在 README 里失去入口 —— 那等于没有声明）
  const declPath = path.join(root, "AUTHORIZED-USE.md");
  const readmePath = path.join(root, "README.md");
  const declOk = exists(declPath);
  const decl = declOk ? fs.readFileSync(declPath, "utf8") : "";
  const linked = exists(readmePath) && /AUTHORIZED-USE\.md/.test(fs.readFileSync(readmePath, "utf8"));
  const missing = ["授权", "五问", "禁止", "免责"].filter((k) => !decl.includes(k));
  add("授权使用声明（AUTHORIZED-USE.md）在册且被 README 引用", declOk && linked && missing.length === 0,
    !declOk ? "文件不存在"
      : !linked ? "README 里没有指向它的链接"
      : missing.length ? `缺要件：${missing.join("/")}`
      : "文件 + README 链接 + 四段要件齐备");
}

// 输出
const pad = (s, n) => s + " ".repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
console.log("\ndsh-voredteam 验收自检\n" + "─".repeat(72));
for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"}  ${pad(r.name, 40)} ${r.detail ?? ""}`);
const ok = rows.filter((r) => r.ok).length;
console.log("─".repeat(72));
console.log(`  ${ok}/${rows.length} 项通过` + (ok === rows.length ? " —— 项目自检通过" : " —— 见上方 ✗ 项"));
if (info.length) {
  console.log("\n  宿主安装状态（信息项，不参与判定）：");
  for (const [k, v] of info) console.log(`    · ${pad(k, 24)} ${v}`);
}
console.log("");
process.exit(ok === rows.length ? 0 : 1);
