// 用**真实服务返回的 payload**跑一遍面板的纯函数层，看有没有会抛错/产出空 UI 的地方
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3080/vore-blackboard";
const csrf = JSON.parse(execSync(
  `powershell -NoProfile -Command "(Invoke-WebRequest -Uri '${BASE}/csrf' -UseBasicParsing -TimeoutSec 6).Content"`,
  { encoding: "utf8" },
)).token;

function post(endpoint, payload = {}) {
  const body = JSON.stringify({ endpoint, payload }).replace(/"/g, '\\"');
  const out = execSync(
    `powershell -NoProfile -Command "(Invoke-WebRequest -Uri '${BASE}/${endpoint}' -Method POST -Body '${body}' -ContentType 'application/json' -Headers @{'x-dsh-csrf'='${csrf}'} -UseBasicParsing -TimeoutSec 8).Content"`,
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

const list = post("list");
const pid = list.projects?.[0]?.id ?? null;
const graph = post("graph", { projectId: pid });
const status = post("status", { projectId: pid });
const cov = post("coverage", { projectId: pid });
const assets = post("assets", { projectId: pid });
console.log(`项目 ${pid}｜graph facts=${graph.graph?.facts?.length} intents=${graph.graph?.intents?.length}｜assets=${assets.assets?.length}`);

const pure = await import("file:///C:/Users/user/Desktop/sentou/voredteam/plugins/vore-console/lib/pure.mjs");
console.log("pure.mjs 导出：", Object.keys(pure).join(", "));

function tryCall(label, fn) {
  try {
    const r = fn();
    const brief = typeof r === "string" ? r : JSON.stringify(r);
    console.log(`  ✓ ${label} → ${String(brief).slice(0, 160)}`);
  } catch (e) {
    console.log(`  ✗ ${label} → 抛错：${e.message}`);
  }
}

console.log("纯函数层（真实 payload）：");
for (const [name, fn] of [
  ["coverageView(coverage 响应)", () => pure.coverageView(cov)],
  ["coverageGaps(assets)", () => pure.coverageGaps(assets.assets ?? [], 20)],
  ["phaseText(coverage)", () => pure.phaseText(cov.coverage)],
  ["nextPhase(coverage)", () => pure.nextPhase(cov.coverage)],
  ["canAdvance(coverage)", () => pure.canAdvance(cov.coverage)],
]) tryCall(name, fn);

// 图布局（实时情况分栏）
if (typeof pure.computeLayout === "function") {
  tryCall("computeLayout(search 结果)", () => {
    const s = pure.createSearch ? pure.createSearch() : null;
    void s;
    return pure.computeLayout(graph.graph);
  });
}

// 成果抽取（任务汇总分栏）
for (const n of ["extractFindings", "extractAssets", "extractDeadEnds", "toMarkdown"]) {
  if (typeof pure[n] === "function") tryCall(`${n}(graph)`, () => pure[n](graph.graph));
}

// 面板源码里是否有对可空字段的直接解引用（粗筛）
const panel = readFileSync("C:/Users/user/Desktop/sentou/voredteam/plugins/vore-console/lib/panel.js", "utf8");
const risk = panel.split(/\r?\n/).map((l, i) => ({ l, i: i + 1 }))
  .filter(({ l }) => /coverage\.[a-zA-Z]+\.|\.counts\.[a-zA-Z]+|byKind\[|pct\.[a-zA-Z]+/.test(l) && !/\?\.|&&|\|\|/.test(l));
console.log(`\n面板源码里对 coverage/counts/pct 的直接解引用（需人工确认，共 ${risk.length} 处）：`);
for (const r of risk.slice(0, 10)) console.log(`  L${r.i}  ${r.l.trim().slice(0, 110)}`);
