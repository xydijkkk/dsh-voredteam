// 验证 {{EXTRA_SKILL_DIRS}} 渲染：设变量 → 物化预设里出现该目录；不设 → 整行消失。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preset = path.join(os.homedir(), ".dsh", ".agent-presets", "network-security", "agent.cordis.yml");
const dirsOf = () => {
  const t = fs.readFileSync(preset, "utf8");
  return t.slice(t.indexOf("customSkillDirs:")).split("\n").filter((l) => /^\s*-\s+'/.test(l)).map((s) => s.trim().replace(/^-\s*'|'$/g, ""));
};
const run = (env) => execFileSync(process.execPath, ["deploy/deploy.mjs", "--apply"], {
  cwd: REPO, env: { ...process.env, VORE_EXTRA_SKILL_DIRS: env }, encoding: "utf8",
});

const extra = path.join(REPO, "..", "voskill").replace(/\\/g, "/");
console.log(`探针目录：${extra}（存在=${fs.existsSync(extra)}）`);

run("");
const off = dirsOf();
console.log(`\n不设变量：${off.length} 个技能根；含探针目录 = ${off.includes(extra)}`);

run(extra);
const on = dirsOf();
console.log(`设了变量：${on.length} 个技能根；含探针目录 = ${on.includes(extra)}`);
for (const d of on) console.log(`  ${fs.existsSync(d) ? "✓" : "✗"} ${d}`);

run("");
const off2 = dirsOf();
console.log(`\n再清空：${off2.length} 个技能根；含探针目录 = ${off2.includes(extra)}`);

const okAll = !off.includes(extra) && on.includes(extra) && !off2.includes(extra) && on.every((d) => fs.existsSync(d));
console.log(`\n结论：${okAll ? "✓ 渲染逻辑正确（设→出现，不设→消失，且路径都真实存在）" : "✗ 有异常"}`);
process.exit(okAll ? 0 : 1);
