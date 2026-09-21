// 闸门自证：故意把 hook 放到 `if (!graph) return …` 之后（= 真实事故的写法），
// 面板真渲染测试必须因此失败；然后还原。跑完自动复原。
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const PANEL = "plugins/vore-console/lib/panel.js";
const orig = fs.readFileSync(PANEL, "utf8");
const MUT = "  var _mutationProbe = useMemo(function () { return 1; }, []);   // 闸门自证用：故意放错位置\n";
const marker = "  // ── SVG 图（六阶段泳道";
if (!orig.includes(marker)) { console.error("定位失败"); process.exit(1); }

const run = (label) => {
  try {
    const out = execFileSync("node", ["--no-warnings", "plugins/vore-console/scripts/build-client.mjs"], { encoding: "utf8" });
    void out;
  } catch (e) { console.log("  build 失败：", String(e.stdout ?? e.message).slice(0, 200)); }
  let out = "";
  try {
    out = execFileSync("node", ["--no-warnings", "plugins/vore-console/tests/panel-render.mjs"], { encoding: "utf8" });
  } catch (e) { out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
  const line = out.split("\n").find((l) => /全部通过/.test(l)) ?? "(没有总结行)";
  const hookLine = out.split("\n").filter((l) => /hook 顺序|hook 数量/.test(l)).join(" | ");
  console.log(`\n[${label}] ${line.trim()}`);
  if (hookLine) console.log(`   ${hookLine.trim().slice(0, 220)}`);
  return /未通过 [1-9]/.test(out);
};

console.log("① 故意注入 bug（hook 放在 return 之后）");
fs.writeFileSync(PANEL, orig.replace(marker, MUT + marker));
const caught = run("注入后");
console.log(caught ? "   ✅ 闸门抓住了（测试失败）" : "   ❌ 闸门没抓住 —— 这个自证不成立");

console.log("\n② 还原");
fs.writeFileSync(PANEL, orig);
const okAfter = run("还原后");
console.log(okAfter ? "   ❌ 还原后仍失败" : "   ✅ 还原后通过");
process.exit(caught && !okAfter ? 0 : 1);
