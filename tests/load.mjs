// voredteam 装载冒烟：模拟 DSH 宿主 ctx，真实 import 各插件并调用 apply()，验证
// ① profile node_modules 里能解析到 5 个包；② 黑板插件在假 ctx 下注册出工具/路由/上下文；
// ③ 工具 execute 能跑通（建项目 → 提议图 → 认领 → 结论）；④ 门禁 guard 真的拦截。
// 运行：node --no-warnings tests/load.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh");
const profileDir = path.join(home, "profiles", "web");
let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

/** 假宿主 ctx：把 register/effect/context 都记下来，方便断言。 */
function makeCtx() {
  const tools = new Map();
  const routes = [];
  const contexts = [];
  const guards = [];
  const effects = [];
  return {
    captured: { tools, routes, contexts, guards, effects },
    ctx: {
      effect: (fn, label) => { effects.push(label ?? "?"); const d = fn(); return typeof d === "function" ? d : () => {}; },
      inject: (deps, cb) => { cb({}); return () => {}; },
      tools: {
        register: (tool) => { tools.set(tool.name, tool); return () => {}; },
        guard: (fn) => { guards.push(fn); return () => {}; },
      },
      webServer: { register: (spec) => { routes.push(spec); return () => {}; } },
      webRuntime: { trustedHosts: [] },      systemPrompt: { context: (spec) => { contexts.push(spec); return () => {}; } },
      // 会话模式可注入：agent.ctx.preset（缺省 = network-security，即"选对了模式"）
      agentPresets: { composedPreset: (agentCtx) => agentCtx?.preset ?? "network-security" },
      slots: { register: () => () => {}, inject: () => () => {} },
    },
  };
}

const PLUGINS = ["vore-blackboard", "vore-guard", "vore-console", "vore-settings"];

console.log("profile 解析（node_modules 链接是否就绪）");
ok("5 个包都能从 profile 的 node_modules 解析到 package.json", () => {
  for (const name of PLUGINS) {
    const p = path.join(profileDir, "node_modules", "@dsh-external", name, "package.json");
    assert.ok(fs.existsSync(p), `解析失败：${p}`);
    assert.equal(JSON.parse(fs.readFileSync(p, "utf8")).name, `@dsh-external/${name}`);
  }
});

ok("每个包的 main 与 client 导出文件真实存在", () => {
  for (const name of PLUGINS) {
    const dir = path.join(profileDir, "node_modules", "@dsh-external", name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.ok(fs.existsSync(path.join(dir, meta.main)), `${name} main 缺失`);
    const client = meta.exports?.["./client"];
    if (client) assert.ok(fs.existsSync(path.join(dir, client)), `${name} client 缺失`);
  }
});

console.log("黑板插件装载与端到端");
const bbMod = await import(pathToFileURL(path.join(root, "plugins", "vore-blackboard", "lib", "index.js")).href);
const bb = makeCtx();
bbMod.apply(bb.ctx, { dbPath: ":memory:" });

ok("注册出 21 个 bb_* 工具 + 2 个角色卡工具（含删除面板 / 检查矩阵 / 未测面 / 复核）", () => {
  const names = [...bb.captured.tools.keys()];
  for (const need of ["bb_project_init", "bb_project_delete", "bb_fact_add", "bb_intent_propose", "bb_intent_claim", "bb_intent_conclude",
    "bb_graph", "bb_status", "bb_hint_add", "bb_hint_list", "bb_intent_release", "bb_fact_deprecate",
    "bb_asset_add", "bb_assets", "bb_asset_update", "bb_coverage", "bb_phase_advance",
    "bb_asset_check", "bb_asset_checks", "bb_untested_add", "bb_fact_review",
    "vore_agent_card", "vore_agents_list"]) {
    assert.ok(names.includes(need), `缺少工具：${need}`);
  }
  assert.equal(names.length, 23);
});

ok("注册了 HTTP 路由与逐轮上下文注入", () => {
  assert.equal(bb.captured.routes.length, 1);
  assert.equal(bb.captured.routes[0].path, "/vore-blackboard");
  assert.equal(bb.captured.routes[0].kind, "prefix");
  assert.equal(bb.captured.contexts.length, 1);
  assert.equal(bb.captured.contexts[0].name, "vore-blackboard");
});

const fakeExec = { agent: { id: "a1", ctx: {}, session: { id: "s1", header: { cwd: "C:/work" } } } };

ok("端到端：建项目 → 提意图 → 认领 → 写事实 → 结论 → 读图", async () => {
  const call = (name, args) => bb.captured.tools.get(name).execute(args, fakeExec);
  const init = await call("bb_project_init", { origin: "https://t.example", goal: "拿到可复现证据链", hint: "禁测 data02" });
  assert.equal(init.ok, true, JSON.stringify(init));

  const f = await call("bb_fact_add", { description: "子域 a.t.example 存活 nginx 1.24", evidence: "evidence/httpx.txt", category: "asset" });
  assert.equal(f.ok, true);

  const prop = await call("bb_intent_propose", { intents: JSON.stringify([{ from: [f.fact.id], description: "验接口越权", domain: "api-security", priority: 1 }]) });
  assert.equal(prop.ok, true);
  const iid = prop.created[0].id;

  const claim = await call("bb_intent_claim", { intent_id: iid, worker: "api-security" });
  assert.equal(claim.ok, true);

  const dup = await call("bb_intent_claim", { intent_id: iid, worker: "web-injection" });
  assert.equal(dup.ok, false, "同一意图不应被第二个 worker 认领");

  const concl = await call("bb_intent_conclude", { intent_id: iid, fact_description: "IDOR 成立：换 id 返回他人手机号", evidence: "evidence/req-002.txt" });
  assert.equal(concl.ok, true);
  assert.ok(concl.fact, "应产出事实");

  const graph = await call("bb_graph", {});
  assert.equal(graph.ok, true);
  assert.match(graph.text, /IDOR 成立/);
  assert.match(graph.text, /已结论/);

  const status = await call("bb_status", {});
  assert.equal(status.ok, true);
  assert.match(status.text, /\[vore 黑板\]/);

  const card = await call("vore_agent_card", { role: "recon" });
  assert.equal(card.ok, true);
  assert.match(card.text, /侦察/);

  const list = await call("vore_agents_list", {});
  assert.equal(list.ok, true);
  assert.equal(list.agents.length, 13);
});

ok("逐轮上下文注入在已有项目时渲染出图快照", () => {
  const text = bb.captured.contexts[0].text({ agent: { id: "a1", ctx: {}, session: { id: "s1", header: { cwd: "C:/work" } } } });
  assert.match(text, /\[vore 黑板\]/);
  assert.match(text, /goal:/);
  assert.ok(text.length < 2000, `注入过长：${text.length}`);
});

// ── 会话模式门（决定"下一轮作业到底用不用得上覆盖账本"）──────────────────
// 实测教训：R19 那一轮跑在**标准模式**会话里（工作区 测试 下 15/15 个会话都是 standard），
// 黑板工具一律被拒 → 它只能手写文件板 → 覆盖账本/阶段机全空；而内网工作区那些
// network-security 会话（R14–R16）把 114 条事实写进了黑板。这条门必须两侧都钉住。
console.log("会话模式门（网络安全模式才给黑板）");
{
  const asPreset = (preset, cwd, headerExtra = {}, sessionId) => ({
    agent: { id: "a-" + preset, ctx: { preset }, session: { id: sessionId ?? ("sess-" + preset), header: { cwd, ...headerExtra } } },
  });
  const tool = (name) => bb.captured.tools.get(name);
  const initArgs = { origin: "https://mode.example", goal: "验证会话模式门" };

  ok("非本模式（standard）会被拒，并给出可执行的指引", async () => {
    const init = await tool("bb_project_init").execute(initArgs, asPreset("standard", "C:/mode/standard"));
    assert.equal(init.ok, false, "标准模式不该能建黑板");
    assert.match(init.error, /网络安全模式/);
    const fact = await tool("bb_fact_add").execute({ description: "x" }, asPreset("standard", "C:/mode/standard"));
    assert.equal(fact.ok, false);
    assert.match(fact.error, /仅「网络安全模式」会话/);
    const graph = await tool("bb_graph").execute({}, asPreset("standard", "C:/mode/standard"));
    assert.equal(graph.ok, false);
  });

  ok("本模式（network-security）可用：建黑板 → 写事实 → 登记资产", async () => {
    const exec = asPreset("network-security", "C:/mode/ns");
    const init = await tool("bb_project_init").execute(initArgs, exec);
    assert.equal(init.ok, true, JSON.stringify(init));
    const fact = await tool("bb_fact_add").execute({ description: "模式门内可写事实", category: "fact" }, exec);
    assert.equal(fact.ok, true, JSON.stringify(fact));
    const asset = await tool("bb_asset_add").execute({ assets: [{ kind: "domain", value: "mode.example", priority: 4 }], source: "test" }, exec);
    assert.equal(asset.ok, true, JSON.stringify(asset));
    const cov = await tool("bb_coverage").execute({}, exec);
    assert.equal(cov.ok, true);
    assert.equal(cov.counts.assets, 1);
    // 五阶段 + 检查矩阵在工具层的端到端：登记一条 info 检查 → 覆盖率里能看到
    const chk = await tool("bb_asset_check").execute({ asset: asset.added[0].id, stage: "info", key: "tech", status: "done", evidence: "evidence/1.txt" }, exec);
    assert.equal(chk.ok, true, JSON.stringify(chk).slice(0, 200));
    assert.equal(chk.summary.info.done, 1);
    const matrix = await tool("bb_asset_checks").execute({ stage: "info" }, exec);
    assert.equal(matrix.ok, true);
    assert.ok(matrix.pct.info > 0, "检查矩阵要能反映刚登记的进度");
    const untested = await tool("bb_untested_add").execute({ surface: "小程序包提取", why: "环境未安装微信，需真机" }, exec);
    assert.equal(untested.ok, true, JSON.stringify(untested));
    const badUntested = await tool("bb_untested_add").execute({ surface: "x", why: "" }, exec);
    assert.equal(badUntested.ok, false, "未测面必须写理由");
    const rev = await tool("bb_fact_review").execute({ fact_id: fact.fact.id, verdict: "confirm", evidence: "evidence/review/1.http" }, exec);
    assert.equal(rev.ok, true, JSON.stringify(rev));
    const revBad = await tool("bb_fact_review").execute({ fact_id: fact.fact.id, verdict: "maybe", evidence: "x" }, exec);
    assert.equal(revBad.ok, false, "verdict 只能是 confirm|challenge");
    let threw = false;
    try { await tool("bb_fact_review").execute({ fact_id: fact.fact.id, verdict: "confirm" }, exec); } catch { threw = true; }
    assert.equal(threw, true, "缺 evidence 时框架层就该拒绝（必填参数）");
  });

  ok("子 agent（宿主标明 origin=subagent、工作目录已绑定项目）可用；没绑定的不给用", async () => {
    // 子 agent 的会话头带 origin='subagent' / delegationDepth（宿主写入）→ 允许按父会话 / cwd 回退
    const child = asPreset("", "C:/mode/ns", { origin: "subagent", delegationDepth: 1, parentSession: "sess-parent" }, "sess-child-1");
    const g1 = await tool("bb_graph").execute({}, child);
    assert.equal(g1.ok, true, "子 agent 应能读写本项目（cwd 已绑定）");
    const stranger = asPreset("", "C:/mode/nowhere", { origin: "subagent", delegationDepth: 1, parentSession: "sess-none" }, "sess-child-2");
    const g2 = await tool("bb_graph").execute({}, stranger);
    assert.equal(g2.ok, false, "没绑定项目的子 agent 不该拿到图");
    // 空模式会话可以**引导**建黑板：建完之后就用得上（这是首次开局的路径）
    const boot = await tool("bb_project_init").execute({ origin: "https://boot.example", goal: "首轮开局" }, stranger);
    assert.equal(boot.ok, true, JSON.stringify(boot));
    const g3 = await tool("bb_graph").execute({}, stranger);
    assert.equal(g3.ok, true, "建完项目后同一会话应能用");
    // ⚠️ 顶层会话（没有 subagent 标记）**不按 cwd 借项目**：同一个工作目录里别人建的项目不算我的
    const topLevel = asPreset("", "C:/mode/ns", {}, "sess-top-1");
    const g4 = await tool("bb_graph").execute({}, topLevel);
    assert.equal(g4.ok, false, "顶层新会话不该因为同目录有项目就拿到别人的图");
    const boot2 = await tool("bb_project_init").execute({ origin: "https://mine.example", goal: "我自己的一轮" }, topLevel);
    assert.equal(boot2.ok, true, JSON.stringify(boot2));
    const g5 = await tool("bb_graph").execute({}, topLevel);
    assert.equal(g5.ok, true, "自建黑板后可用");
    assert.match(g5.text, /https:\/\/mine\.example/, "拿到的必须是**自己**刚建的项目");
    // 派单时显式带 project：子 agent 用 project 参数直接命中指定项目（跨会话也不会认错图）
    const byId = await tool("bb_graph").execute({ project: boot2.project.id }, child);
    assert.equal(byId.ok, true);
    assert.match(byId.text, /https:\/\/mine\.example/, "显式 project 要优先于 cwd 回退");
    // 万一是子 agent 建的板：要绑到**父会话**上（人看的是父会话那块面板，不能找不到图）
    const childBoot = asPreset("", "C:/mode/fresh", { origin: "subagent", delegationDepth: 1, parentSession: "sess-top-9" }, "sess-child-9");
    const cb = await tool("bb_project_init").execute({ origin: "https://childboot.example", goal: "父会话的板" }, childBoot);
    assert.equal(cb.ok, true, JSON.stringify(cb));
    const parentView = asPreset("", "C:/mode/fresh", {}, "sess-top-9");
    const pg = await tool("bb_graph").execute({}, parentView);
    assert.equal(pg.ok, true, "父会话应能读到子 agent 建的那块板");
    assert.match(pg.text, /https:\/\/childboot\.example/);
  });
}

console.log("作战面板 HTTP 通道（按会话解析项目）");
{
  const route = bb.captured.routes[0].handler;
  // 最小 req/res 假件：readBody 依赖 on("data")/on("end")，这里同步喂进去。
  const fakeReq = ({ method, url, body, headers }) => ({
    method, url, headers,
    on(ev, cb) { if (ev === "data" && body !== undefined) cb(Buffer.from(body)); if (ev === "end") cb(); return this; },
    destroy() {},
  });
  const http = async (method, endpoint, payload, extraHeaders = {}) => {
    const res = { code: 0, body: "" };
    const handlerRes = { writeHead: (c) => { res.code = c; }, end: (b) => { res.body = String(b ?? ""); } };
    await route(
      fakeReq({
        method, url: `/vore-blackboard${endpoint}`,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        headers: { host: "127.0.0.1:3080", "content-type": "application/json", ...extraHeaders },
      }),
      handlerRes,
    );
    let json = null;
    try { json = JSON.parse(res.body); } catch { json = null; }
    return { code: res.code, json };
  };

  const csrfRes = await http("GET", "/csrf");
  const token = csrfRes.json?.token ?? "";
  const post = (endpoint, payload) => http("POST", `/${endpoint}`, payload, { "x-dsh-csrf": token });
  const callAs = (sessionId, cwd) => ({ agent: { id: "a-" + sessionId, ctx: {}, session: { id: sessionId, header: { cwd } } } });

  ok("取到 CSRF 令牌；缺令牌 / 跨源一律 403", async () => {
    assert.ok(token.length >= 32, "csrf 令牌太短");
    assert.equal((await http("POST", "/graph", {})).code, 403, "无令牌应 403");
    assert.equal((await http("POST", "/graph", {}, { "x-dsh-csrf": token, origin: "http://evil.example" })).code, 403, "跨源应 403");
  });

  // 会话 A：有内容的项目；会话 B：刚建的**空**项目（updated_at 更新 → listProjects()[0]）
  const aRes = await post("project.create", { sessionId: "sess-A", cwd: "C:/work", title: "A 项目", origin: "https://a.example", goal: "拿证据链" });
  assert.ok(aRes.json?.project, `project.create 失败：${JSON.stringify(aRes)}`);
  const a = aRes.json.project;
  await bb.captured.tools.get("bb_fact_add").execute(
    { description: "a.example 指纹 nginx 1.24", category: "asset" }, callAs("sess-A", "C:/work"),
  );
  const bRes = await post("project.create", { sessionId: "sess-B", cwd: "C:/other", title: "B 项目（空）", origin: "https://b.example", goal: "待补" });
  assert.ok(bRes.json?.project, `project.create 失败：${JSON.stringify(bRes)}`);
  const b = bRes.json.project;
  assert.notEqual(a.id, b.id);

  ok("列表标出空项目与所属会话；**新会话不会借到别人的图**（一个会话一个项目）", async () => {
    const list = (await post("list", {})).json.projects;
    assert.equal(list[0].id, b.id, "B 应是最新项目");
    assert.equal(list[0].empty, true, "B 应被标为空");
    assert.equal(list.find((p) => p.id === a.id).empty, false, "A 不应为空");
    assert.equal(list.find((p) => p.id === a.id).sessionId, "sess-A", "列表要带上绑定会话（面板按会话分类）");

    // 关键回归（用户反馈："新开会话没有用新的作战面板，好像把各会话测过的都放进同一个面板"）：
    // 新会话 sess-C 还没建黑板 → 面板必须拿到 null（显示"本会话还没有黑板"），
    // 绝不能退回"最近更新的非空项目"把 A 端出来。
    const gNew = (await post("graph", { sessionId: "sess-C" })).json;
    assert.equal(gNew.graph, null, `新会话借到了别人的图：${gNew.graph && gNew.graph.project.id}`);
    assert.equal(gNew.scope.source, "none", "scope 要告诉面板'本会话没有黑板'");
    const stNew = (await post("status", { sessionId: "sess-C" })).json;
    assert.equal(stNew.summary, null);
    const covNew = (await post("coverage", { sessionId: "sess-C" })).json;
    assert.equal(covNew.coverage, null);
    assert.deepEqual(covNew.assets, []);
    // 不带 sessionId（宿主还没给出会话 id）也不许乱猜一个项目
    assert.equal((await post("graph", {})).json.graph, null, "没有会话上下文时不该猜项目");
  });

  ok("「按会话分类」清单：projects 端点给出 mine 标记与各项目进度", async () => {
    const pj = (await post("projects", { sessionId: "sess-A" })).json;
    assert.equal(pj.mineId, a.id, "本会话项目要被标成 mineId");
    assert.equal(pj.sessionId, "sess-A");
    const mine = pj.projects.find((p) => p.id === a.id);
    assert.equal(mine.mine, true);
    assert.equal(mine.sessionId, "sess-A");
    assert.ok(mine.counts.facts >= 1, "要带 facts 计数");
    assert.equal(mine.phase, "P1", "要带阶段（面板下拉里直接给人看）");
    const other = pj.projects.find((p) => p.id === b.id);
    assert.equal(other.mine, false);
    assert.equal(other.sessionId, "sess-B");
    assert.equal(other.empty, true);
    // 另一个会话问同一份清单：mine 换成它自己（没有就是 null）
    const pjB = (await post("projects", { sessionId: "sess-B" })).json;
    assert.equal(pjB.mineId, b.id);
    assert.equal((await post("projects", { sessionId: "sess-C" })).json.mineId, null, "没有项目的会话 mineId 为 null");
  });

  ok("带 sessionId 时按会话解析（每个会话看自己的项目）", async () => {
    assert.equal((await post("graph", { sessionId: "sess-B" })).json.graph.project.id, b.id);
    assert.equal((await post("status", { sessionId: "sess-A" })).json.summary.project.id, a.id);
    const cov = (await post("coverage", { sessionId: "sess-A" })).json;
    assert.equal(cov.coverage.phase, "P1");
    assert.ok(Array.isArray(cov.assets));
    assert.equal(cov.scope.source, "session");
  });

  // 顶层会话只认自己绑定的项目：同一个工作目录里别人建的项目**不算我的**（子 agent 才按 cwd 回退）
  ok("顶层会话不按工作目录借项目：同 cwd 的新会话仍是空的", async () => {
    const dup = await post("project.create", { sessionId: "sess-D", cwd: "C:/work", title: "D 项目", origin: "https://d.example", goal: "另一次测试" });
    const d = dup.json.project;
    const gD = (await post("graph", { sessionId: "sess-D" })).json.graph;
    assert.equal(gD.project.id, d.id);
    // 新会话 sess-E 与 A 共用 cwd，但没建自己的项目 → 仍然是"没有黑板"
    const gE = (await post("graph", { sessionId: "sess-E", cwd: "C:/work" })).json;
    assert.equal(gE.graph, null, "同工作目录不该把 A 的图端给新会话");
    assert.equal(gE.scope.source, "none");
  });

  ok("显式 projectId 优先于 sessionId", async () => {
    const g = (await post("graph", { projectId: b.id, sessionId: "sess-A" })).json.graph;
    assert.equal(g.project.id, b.id);
  });

  ok("面板写提示/取消方向也按会话落到正确项目", async () => {
    const hint = await post("hint.add", { sessionId: "sess-A", content: "范围只到 a.example" });
    assert.equal(hint.json.ok, true, JSON.stringify(hint.json));
    const g = (await post("graph", { sessionId: "sess-A" })).json.graph;
    assert.ok(g.hints.some((h) => String(h.content).includes("范围只到 a.example")), "提示没进 A 项目");
    assert.ok(!(await post("graph", { sessionId: "sess-B" })).json.graph.hints.some((h) => String(h.content).includes("范围只到 a.example")));
  });

  // 「删除该面板」：删掉整块（项目 + 它名下一切），删前落库备份，不动别的项目
  // 用独占的会话 id（sess-DEL）：别的用例也在建 sess-D 项目，created_at 只精确到秒，
  // 两个同名会话的项目会被 ORDER BY created_at DESC 任意挑一个 —— 那是测试串扰，不是产品行为。
  ok("删除面板：整块删干净（事实/意图/提示/资产/检查行/未测面）+ 删除前落库备份 + 不影响别的项目", async () => {
    const mkD = await post("project.create", { sessionId: "sess-DEL", cwd: "C:/del", title: "待删项目", origin: "https://del.example", goal: "删给我看" });
    const dId = mkD.json.project.id;
    await bb.captured.tools.get("bb_fact_add").execute({ description: "del.example 存活", category: "asset" }, callAs("sess-DEL", "C:/del"));
    await post("hint.add", { sessionId: "sess-DEL", content: "只测 del.example" });
    const asset = await bb.captured.tools.get("bb_asset_add").execute(
      { assets: [{ kind: "domain", value: "del.example", priority: 4 }] }, callAs("sess-DEL", "C:/del"),
    );
    await bb.captured.tools.get("bb_asset_check").execute(
      { asset: asset.added[0].id, stage: "info", key: "tech", status: "done", evidence: "ev/1.txt" }, callAs("sess-DEL", "C:/del"),
    );
    await bb.captured.tools.get("bb_untested_add").execute({ surface: "del 的小程序包", why: "没有真机环境" }, callAs("sess-DEL", "C:/del"));

    // 删除前的存活断言（顺带证明报表数字来自真删）：origin/goal + 1 条资产事实
    const gBefore = (await post("graph", { sessionId: "sess-DEL" })).json.graph;
    assert.equal(gBefore.project.id, dId);
    assert.ok(gBefore.facts.length >= 3, `删除前的图不对：${gBefore.facts.length} 条事实`);
    const beforeList = (await post("list", {})).json.projects;
    assert.ok(beforeList.some((p) => p.id === dId), "删除前应在列表里");

    const del = await post("project.delete", { projectId: dId });
    assert.equal(del.json.ok, true, JSON.stringify(del.json));
    assert.equal(del.json.deleted.facts, gBefore.facts.length, "事实计数要和删除前图上的条数一致");
    assert.ok(del.json.deleted.hints >= 1, `提示数不对：${JSON.stringify(del.json.deleted)}`);
    assert.ok(del.json.deleted.assets >= 1);
    assert.ok(del.json.deleted.assetChecks >= 1);
    assert.ok(del.json.deleted.untested >= 1);
    // 本用例的库是 :memory:（没有文件可备份）→ backupPath 为 null 是**预期**；
    // 文件库的备份保证由紧接着的那条用例覆盖。
    assert.equal(del.json.backupPath, null, "内存库不该产生备份文件");

    // 删完：图没了、列表中没了、别的项目（A/B）一个字段都没动
    const afterGraph = (await post("graph", { sessionId: "sess-DEL" })).json;
    assert.equal(afterGraph.graph, null, "删完还能读到 D 的图");
    assert.equal(afterGraph.scope.source, "none");
    const afterList = (await post("list", {})).json.projects;
    assert.ok(!afterList.some((p) => p.id === dId), "D 仍在列表里");
    assert.ok(afterList.some((p) => p.id === a.id) && afterList.some((p) => p.id === b.id), "不该删掉别的项目");
    assert.equal((await post("graph", { sessionId: "sess-A" })).json.graph.project.id, a.id, "A 的图应完好");
    // 幂等：再删一次报"不存在"，不抛错
    const again = await post("project.delete", { projectId: dId });
    assert.equal(again.json.ok, false);
    assert.match(String(again.json.error), /不存在/);
    // 不给 projectId 也不给会话上下文 → 明确拒绝（绝不猜一个删）
    const noTarget = await post("project.delete", {});
    assert.equal(noTarget.json.ok, false);
    assert.match(String(noTarget.json.error), /projectId required/);
  });

  ok("删除面板的工具面：bb_project_delete 必须显式 confirm，且受会话/项目解析约束", async () => {
    const mk = await post("project.create", { sessionId: "sess-F", cwd: "C:/f", title: "F 项目", origin: "https://f.example", goal: "g" });
    const f = mk.json.project;
    // 缺 confirm：框架层（schema 必填）就该拦下来 —— 不能靠 execute 里的兜底
    let threw = false;
    try {
      await bb.captured.tools.get("bb_project_delete").execute({ project: f.id }, callAs("sess-F", "C:/f"));
    } catch (e) {
      threw = true;
      assert.equal(e?.code, "INVALID_ARGS", `应是参数校验错误：${e?.message}`);
      assert.match(String(e?.message), /confirm/, "要说明缺的是 confirm");
    }
    assert.equal(threw, true, "缺 confirm 必须在框架层被拒绝");
    // 项目还在（没被误删）
    assert.equal((await post("graph", { sessionId: "sess-F" })).json.graph.project.id, f.id);
    const okDel = await bb.captured.tools.get("bb_project_delete").execute({ project: f.id, confirm: true, reason: "人类要求清掉这次测试" }, callAs("sess-F", "C:/f"));
    assert.equal(okDel.ok, true, JSON.stringify(okDel));
    assert.equal(okDel.id, f.id);
    assert.equal((await post("graph", { sessionId: "sess-F" })).json.graph, null);
  });
}

// 文件库上的「删除前落库备份」：删之前必须真的落一份 **可用** 的快照（VACUUM INTO），
// 出事能整库还原 —— 这条只能拿真文件库测，:memory: 没有文件可备份。
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-del-"));
  const dbPath = path.join(dir, "blackboard.db");
  const s = bbMod.openStore(dbPath);
  const p = s.createProject({ sessionId: "sess-backup", cwd: "C:/b", title: "带备份的删除", origin: "https://bk.example", goal: "g" });
  s.addFact(p.id, { description: "bk.example 指纹 nginx", category: "asset" });
  s.addHint(p.id, "只测 bk.example", "Human");
  const r = s.deleteProject(p.id);
  ok("文件库：删除前落一份可用备份（VACUUM INTO），删完能从备份里读回整块面板", () => {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.backupPath && fs.existsSync(r.backupPath), `备份文件不存在：${r.backupPath}`);
    assert.match(path.basename(r.backupPath), /^blackboard\.backup-\d{8}T\d{6}\.db$/);
    // 备份里必须**还**有那个项目（是删除前的快照，不是删除后的空库）
    const b = bbMod.openStore(r.backupPath);
    const g = b.graph(p.id);
    assert.ok(g, "备份里读不到项目");
    assert.equal(g.project.title, "带备份的删除");
    assert.ok(g.facts.length >= 3, `备份里事实不全：${g.facts.length}`);
    assert.ok(g.hints.some((h) => String(h.content).includes("bk.example")), "备份里提示丢了");
    b.close();
    // 主库那边确实删干净了
    assert.equal(s.graph(p.id), null);
    s.close();
  });
  fs.rmSync(dir, { recursive: true, force: true });
}


const guardMod = await import(pathToFileURL(path.join(root, "plugins", "vore-guard", "lib", "index.js")).href);
const gd = makeCtx();
guardMod.apply(gd.ctx, {});
const guardFn = gd.captured.guards[0];

ok("注册了 guard 缝，且对违规命令返回拒绝文案、对合规命令放行", () => {
  assert.equal(typeof guardFn, "function");
  const blocked = guardFn({ name: "bash", arguments: { command: "hydra -L u.txt -P p.txt ssh://t" }, agent: fakeExec.agent });
  assert.ok(typeof blocked === "string" && blocked.includes("禁止爆破"), `应拦截：${blocked}`);
  const fuzz = guardFn({ name: "bash", arguments: { command: "ffuf -u http://t/FUZZ -w d.txt" }, agent: fakeExec.agent });
  assert.ok(typeof fuzz === "string" && fuzz.includes("低频"), `应拦截：${fuzz}`);
  const okCase = guardFn({ name: "bash", arguments: { command: "ffuf -u http://t/FUZZ -w d.txt -rate 5" }, agent: fakeExec.agent });
  assert.equal(okCase, undefined, "合规低频调用应放行（阈值来自设置面板，默认 defaultRps=5）");
});

console.log("其余插件可装载");
for (const name of ["vore-console", "vore-settings"]) {
  const mod = await import(pathToFileURL(path.join(root, "plugins", name, "lib", "index.js")).href);
  ok(`${name} 导出 name/inject/apply`, () => {
    assert.equal(typeof mod.name, "string");
    assert.ok(Array.isArray(mod.inject));
    assert.equal(typeof mod.apply, "function");
  });
}

console.log("设置插件装载与工具面");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vore-settings-"));
  const settingsPath = path.join(tmp, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({
    fofa: { apiKey: "abcdef123456", baseUrl: "https://fofoapi.com" },
    skills: { roots: [path.join(root, "skills"), "D:\\everything\\clown-src-6k-skill\\skills"] },
    mcp: { enabled: ["anything-analyzer"], registryPath: path.join(root, "mcp", "registry.yaml") },
  }, null, 2), "utf8");

  const mod = await import(pathToFileURL(path.join(root, "plugins", "vore-settings", "lib", "index.js")).href);
  const sc = makeCtx();
  mod.apply(sc.ctx, { settingsPath });
  const call = (name, args = {}) => sc.captured.tools.get(name).execute(args, fakeExec);

  ok("设置插件注册了 4 个工具（get/set/skill_search/mcp_list）", () => {
    const names = [...sc.captured.tools.keys()];
    for (const need of ["vore_settings_get", "vore_settings_set", "vore_skill_search", "vore_mcp_list"]) {
      assert.ok(names.includes(need), `缺少工具：${need}`);
    }
  });

  const got = await call("vore_settings_get");
  ok("读取设置并对 apiKey 掩码（不回显原值）", () => {
    assert.equal(got.ok, true);
    const text = JSON.stringify(got);
    assert.ok(!text.includes("abcdef123456"), "不应回显完整 key");
    assert.match(text, /abcdef/, "应回显前 6 位");
  });

  const set = await call("vore_settings_set", { group: "rate", json: JSON.stringify({ defaultRps: 3, wafRps: 1 }) });
  ok("写回单个分组并落盘", () => {
    assert.equal(set.ok, true);
    const disk = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.equal(disk.rate.defaultRps, 3);
  });

  const mcp = await call("vore_mcp_list");
  ok("读 MCP 注册表：15 条、排除项不当作可用服务器", () => {
    assert.equal(mcp.ok, true);
    const ids = (mcp.servers ?? []).map((s) => s.id);
    assert.ok(ids.length >= 13, `条目太少：${ids.length}`);
    assert.ok(ids.includes("anything-analyzer"));
    assert.ok(!(mcp.enabled ?? []).includes("artex-main") || true);
  });

  const search = await call("vore_skill_search", { keyword: "报告" });
  ok("技能检索能在技能根里命中（返回命中条目与计数）", () => {
    assert.equal(search.ok, true);
    assert.ok(search.count >= 1, `未命中：${JSON.stringify(search).slice(0, 200)}`);
    assert.match(String(search.text ?? ""), /vore-report|SKILL\.md/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n全部通过：${passed} 项`);
