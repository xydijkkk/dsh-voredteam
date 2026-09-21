// 模式列表排序与「默认模式」诊断：按宿主 agent-presets 的真实规则排出 roster，
// 并指出客户端在无人标记 default 时会回退到哪一项（presets[0]）。
//
// 规则来源：
//   - 排序：packages/preset/agent-presets/src/discovery.ts:164-169（order 升序，未声明的排最后）
//   - 回退：packages/client/ui-agent-preset/src/client/seat-store.ts:93（isDefault ?? presets[0]）
//   - 部署默认：apps/cli 的 agent-presets 行 config.default = 'standard'
//
// 用法：node tests/preset-roster.mjs [--checkout <DSH 检出目录>]
import { readdirSync, readFileSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// 这些探针要读 DSH 的宿主源码/预设装载面：没给 checkout 就明确报错，别给"莫名其妙的断言失败"
if (!process.env.DSH_CHECKOUT && !(process.env.DSH_HOME && existsSync(process.env.DSH_HOME))) {
  const guess = (process.argv.find((a) => a.startsWith("--checkout=")) ?? "").slice(11);
  if (!guess) {
    console.error("需要 DSH checkout：设环境变量 DSH_CHECKOUT=<deepseek-harness 目录>（或 --checkout=<目录>）再跑。");
    process.exit(2);
  }
}

const argv = process.argv.slice(2);
const ci = argv.indexOf("--checkout");
const checkout = ci >= 0 ? argv[ci + 1] : (process.env.DSH_CHECKOUT ?? "");
if (!checkout || !existsSync(checkout)) {
  console.error("需要 DSH checkout 目录：设 DSH_CHECKOUT=<deepseek-harness>，或用 --checkout <目录>。");
  process.exit(2);
}
const home = process.env.DSH_HOME ?? join(os.homedir(), ".dsh");
const shipped = join(checkout, "apps", "cli", "config", "agent-presets");
const user = join(home, ".agent-presets");

const rows = [];
for (const [trust, dir] of [["system", shipped], ["user", user]]) {
  if (!existsSync(dir)) continue;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) {
      rows.push({ id: e.name, trust, skipped: "不是目录（junction/链接会被宿主 scanRoot 跳过）" });
      continue;
    }
    // 与宿主一致：Dirent.isDirectory() 为假的一律跳过
    if (!lstatSync(join(dir, e.name)).isDirectory()) { rows.push({ id: e.name, trust, skipped: "非实体目录" }); continue; }
    const meta = join(dir, e.name, "preset.yml");
    let order, name;
    if (existsSync(meta)) {
      const t = readFileSync(meta, "utf8");
      const om = t.match(/^order:\s*(\d+)\s*$/m);
      if (om) order = Number(om[1]);
      const nm = t.match(/^name:\s*(.+)$/m);
      if (nm) name = nm[1].trim();
    }
    rows.push({ id: e.name, trust, order, name });
  }
}

rows.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id));

console.log(`模式列表（checkout=${checkout}）`);
for (const r of rows) {
  const o = r.order === undefined ? "  —" : String(r.order).padStart(3);
  console.log(`  ${o}  ${r.id.padEnd(20)} ${r.trust.padEnd(7)} ${r.name ?? ""}${r.skipped ? "  ⚠ " + r.skipped : ""}`);
}

const first = rows.find((r) => !r.skipped);
const ours = rows.find((r) => r.id === "network-security");
console.log("");
console.log(`部署默认（宿主 config.default）：standard`);
console.log(`客户端回退位（无 isDefault 时取 presets[0]）：${first?.id ?? "(空)"}`);
console.log(`本模式位置：${ours ? `${ours.order === undefined ? "未声明 order（排最后）" : `order=${ours.order}`}` : "未发现"}`);

const bad = ours && first && ours.id === first.id;
console.log(bad ? "\n✗ 本模式占据了回退默认位 —— 去掉 preset.yml 的 order 或改成 >4" : "\n✓ 本模式没有占据默认位");
process.exit(bad ? 1 : 0);
