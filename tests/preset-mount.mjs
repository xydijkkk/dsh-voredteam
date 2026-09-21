// 预设**真实 mount 冒烟**：按宿主自己的 boot 路径把真实 profile 起来，做一次与 GUI 完全相同的
// `agentPresets.mount(agentCtx, '<preset>')`，并核对工具面。
//
// 为什么必须有这个测试：离线断言（组合行解析、schema 校验、YAML 形状）都**查不出 mount 期错误**。
// 本文件上线前，「点网络安全模式 → 自动跳回标准模式」的三个真因全部只在 mount 期暴露：
//   1) 预设重复挂载了 profile bundle 里已有的插件 → webserver: duplicate prefix route
//   2) plan-mode 缺 config.section            → PlanModeConfig needs a non-empty `section`
//   3) workflow 工具缺引擎行                   → waiting for workflowEngine
//
// 依赖：DSH 检出目录（借它的 node_modules 与 tsx）。
// 运行：
//   cd <DSH checkout>
//   node --import tsx/esm <仓库>/tests/preset-mount.mjs [presetId]
import { join } from "node:path";
import { boot, loadProfile, healProfilesModuleFallback } from "@deepseek-ai/dsh-app-boot";
import { provideCmdline } from "@deepseek-ai/dsh-cmdline";
import { SessionId } from "@deepseek-ai/dsh-session";
import { homedir } from "node:os";
import path from "node:path";
import fs from "node:fs";

// 这些探针要读 DSH 的宿主源码/预设装载面：没给 checkout 就明确报错，别给"莫名其妙的断言失败"
if (!process.env.DSH_CHECKOUT && !(process.env.DSH_HOME && fs.existsSync(process.env.DSH_HOME))) {
  const guess = (process.argv.find((a) => a.startsWith("--checkout=")) ?? "").slice(11);
  if (!guess) {
    console.error("需要 DSH checkout：设环境变量 DSH_CHECKOUT=<deepseek-harness 目录>（或 --checkout=<目录>）再跑。");
    process.exit(2);
  }
}

const REPO = process.env.DSH_CHECKOUT ?? "<DSH checkout>";
const HOME = process.env.DSH_HOME ?? path.join(homedir(), ".dsh");
const INSTALL_ANCHOR = join(REPO, "apps", "cli", "package.json");
const PRESET = process.argv[2] ?? "network-security";

/** 期望出现的工具（缺任一即失败）——派单范式与黑板范式的硬需求。 */
const REQUIRED_TOOLS = ["subagent", "subagent_fork", "workflow", "exit_plan_mode", "bb_project_init", "bb_graph", "bb_asset_check", "bb_asset_checks", "bb_untested_add", "bb_fact_review", "bb_coverage"];

const profileDir = join(HOME, "profiles", "web");
const rootConfig = join(profileDir, "cordis.yml");

// webserver 绑 0 号端口（OS 随机分配），与正在运行的宿主不冲突；
// 不"禁用" webserver —— vore-blackboard / vore-settings / apiproxy 都 inject 它，禁用会被 boot 断言拦住。
const overrides = [
  { id: "webserver", config: { host: "127.0.0.1", port: 0 } },
  { id: "session-telemetry-otel", disabled: true },
];

healProfilesModuleFallback(INSTALL_ANCHOR, HOME);
const profile = loadProfile("dsh-preset-mount", "web", INSTALL_ANCHOR, HOME, { userLayer: true });
const patches = [...profile.layers.flatMap((l) => l.patches), ...overrides];

console.log(`boot: root=${rootConfig}  patches=${patches.length}`);
const ctx = await boot("dsh-preset-mount", rootConfig, patches, (bootCtx) => {
  provideCmdline(bootCtx, { args: [], exit: () => {} });
});
console.log("boot ok");

const roster = await ctx.agentPresets.list();
console.log(`roster: ${roster.map((p) => `${p.id}${p.broken ? "(broken)" : ""}`).join(", ")}`);

let failed = 0;
try {
  const handle = await ctx.agents.create({
    sessionId: SessionId(`mount-smoke-${Date.now()}`),
    setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, PRESET).then(() => undefined),
  });
  const tools = ctx.tools.schemas(handle.agent).map((s) => s.name).sort();
  console.log(`\n✓ mount('${PRESET}') 成功：工具 ${tools.length} 个`);
  console.log(`   ${tools.join(", ")}`);
  const missing = REQUIRED_TOOLS.filter((t) => !tools.includes(t));
  if (missing.length) {
    failed++;
    console.log(`\n✗ 缺关键工具：${missing.join(", ")}`);
  } else {
    console.log(`\n✓ 关键工具齐备：${REQUIRED_TOOLS.join(", ")}`);
  }
  await handle.dispose();
} catch (e) {
  failed++;
  console.log(`\n✗ mount('${PRESET}') 失败：\n   ${e?.message ?? e}`);
  if (e?.cause) console.log(`   cause: ${e.cause?.message ?? e.cause}`);
}

console.log(`\n结果：${failed === 0 ? "通过" : "未通过"}`);
process.exit(failed ? 1 : 0);
