// voredteam 冒烟测试：黑板引擎（store）与唯一门禁（guard）的核心逻辑。
// 运行：node tests/smoke.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openStore, requiredKeys } from "../plugins/vore-blackboard/lib/store.js";
import { renderSnapshot } from "../plugins/vore-blackboard/lib/index.js";
import { scanCommand } from "../plugins/vore-guard/lib/index.js";

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ✓ ${label}`); };

console.log("黑板引擎（store）");
const store = openStore(":memory:");

ok("建项目：origin/goal 作为虚拟事实落图", () => {
  const p = store.createProject({ sessionId: "s1", cwd: "C:/work", title: "授权测试", origin: "https://target.example", goal: "拿到可复现高危证据链" });
  assert.match(p.id, /^eng_\d{3}$/);
  const g = store.graph(p.id);
  assert.deepEqual(g.facts.map((f) => f.id).sort(), ["goal", "origin"]);
  assert.equal(g.project.status, "active");
});

ok("按 session/cwd 解析项目（子 agent 走 cwd 回退）", () => {
  const bySession = store.findProject({ sessionId: "s1" });
  const byCwd = store.findProject({ cwd: "C:/work" });
  assert.ok(bySession && byCwd && bySession.id === byCwd.id);
});

const pid = store.findProject({ sessionId: "s1" }).id;

ok("写事实：自动编号 f001 起", () => {
  const f = store.addFact(pid, { description: "https://target.example/api/v1/user?id=1 返回他人资料", evidence: "evidence/req-001.txt", category: "vuln" });
  assert.equal(f.id, "f001");
  const g = store.graph(pid);
  assert.equal(g.facts.length, 3);
});

ok("提意图：≤3 条、from 校验事实存在", () => {
  const r = store.proposeIntents(pid, [{ from: ["f001"], description: "验证 id 参数越权范围（遍历 1-5 确认影响）", domain: "api-security", priority: 1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.created[0].id, "i001");
  const bad = store.proposeIntents(pid, [{ from: ["f999"], description: "x" }]);
  assert.equal(bad.ok, false);
});

ok("认领互斥：同一意图不能被两个 worker 占", () => {
  assert.equal(store.claimIntent(pid, "i001", "api-security").ok, true);
  const second = store.claimIntent(pid, "i001", "web-injection");
  assert.equal(second.ok, false);
  assert.match(second.error, /已被/);
});

ok("释放后可被他人认领", () => {
  store.releaseIntent(pid, "i001", "换人");
  assert.equal(store.claimIntent(pid, "i001", "web-injection").ok, true);
});

ok("结论意图：非死路必须给事实；落入 to_fact 边", () => {
  const noFact = store.concludeIntent(pid, "i001", { dead: false });
  assert.equal(noFact.ok, false);
  const r = store.concludeIntent(pid, "i001", { factDescription: "id 参数越权成立：换 id 即返回他人手机号", evidence: "evidence/req-002.txt" });
  assert.equal(r.ok, true);
  assert.match(r.fact, /^f002$/);
  const g = store.graph(pid);
  const it = g.intents.find((i) => i.id === "i001");
  assert.equal(it.to_fact, "f002");
  assert.ok(it.concluded_at);
});

ok("死路结论：dead=true 记备注（死路也是资产）", () => {
  store.proposeIntents(pid, [{ from: ["f002"], description: "试 WAF 绕过", domain: "web-injection" }]);
  const r = store.concludeIntent(pid, "i002", { dead: true, note: "试过 12 种编码，全部 403" });
  assert.equal(r.dead, true);
  assert.equal(store.graph(pid).intents.find((i) => i.id === "i002").dead, true);
});

ok("事实废弃：不删除、标 deprecated", () => {
  assert.equal(store.deprecateFact(pid, "f001", "复核推翻：为缓存响应").ok, true);
  const f = store.graph(pid).facts.find((x) => x.id === "f001");
  assert.equal(f.deprecated, true);
});

ok("hint：随时可写、读图时全量可见", () => {
  store.addHint(pid, "禁止测试 data02.wsp 资产", "Human");
  assert.equal(store.graph(pid).hints.length, 1);
  const h2 = store.addHint(pid, "yescaptcha key 见设置面板");
  assert.equal(h2.id, "h002");
});

ok("summary + 快照渲染（给模型的逐轮注入）", () => {
  const s = store.summary(pid);
  assert.equal(s.counts.facts, 1);          // origin/goal 不计入；f001 已废弃也不计入
  assert.equal(s.counts.dead, 1);
  const text = renderSnapshot(s);
  assert.match(text, /\[vore 黑板\]/);
  assert.match(text, /open intents/);
  assert.ok(text.length < 1600);
});

ok("废弃的事实仍留在图里（痕迹不可抹）", () => {
  const g = store.graph(pid);
  assert.equal(g.facts.length, 4);          // origin + goal + f001 + f002
  assert.equal(g.facts.find((f) => f.id === "f001").description.length > 0, true);
});

ok("listProjects 带统计（只算未废弃事实）", () => {
  const list = store.listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].fact_count, 1);
});

console.log("唯一门禁（guard）");
const blocked = (cmd) => { const r = scanCommand(cmd); assert.ok(r?.block, `应拦截：${cmd}`); return r; };
const allowed = (cmd) => assert.equal(scanCommand(cmd), null, `不应拦截：${cmd}`);

ok("拦截 DDoS：洪水/压测/高并发", () => {
  assert.match(blocked("hping3 -S --flood -p 80 target.example").reason, /DDoS/);
  blocked("wrk -t12 -c400 -d30s http://target.example");
  blocked("seq 1 10000 | xargs -P 50 -I{} curl -s http://target.example/?id={}");
  blocked("nmap -p- --script dos target.example");
});

ok("拦截爆破：在线字典/凭据填充", () => {
  assert.match(blocked("hydra -L users.txt -P pass.txt target.example http-post-form").reason, /爆破/);
  blocked("kerbrute passwordspray -d corp.local users.txt 'Passw0rd'");
  blocked("netexec smb 10.0.0.1 -u users.txt -p pass.txt");
  assert.match(blocked("nmap --script http-brute target.example").reason, /爆破/);
});

ok("模糊测试必须带显式低频参数", () => {
  assert.match(blocked("ffuf -u http://target.example/FUZZ -w dict.txt").reason, /低频/);
  assert.match(blocked("ffuf -u http://target.example/FUZZ -w dict.txt -rate 500").reason, /超阈值/);
  blocked("nuclei -u http://target.example -t cves/");
  blocked("dirsearch -u http://target.example -w dict.txt -t 40");
});

ok("合规低频调用放行（阈值来自设置，默认 defaultRps=5）", () => {
  allowed("ffuf -u http://target.example/FUZZ -w dict.txt -rate 5");
  allowed("dirsearch -u http://target.example -w dict.txt -t 5 --delay=0.2");
  allowed("nuclei -u http://target.example -rl 5 -c 5");
  allowed("nmap -p- --max-rate 300 -T3 target.example");
  allowed("curl -s -o /dev/null -w '%{http_code}' http://target.example/api/v1/user?id=1");
  allowed("hashcat -m 1000 hashes.txt rockyou.txt");
});

ok("阈值由设置驱动：把 defaultRps 调到 50 后 -rate 20 才放行；调回 5 又拦住", () => {
  const high = { defaultRps: 50, wafRps: 1, fuzzSampleFirst: 50 };
  assert.equal(scanCommand("ffuf -u http://t/FUZZ -w d.txt -rate 20", high), null, "高阈值下 -rate 20 应放行");
  assert.match(scanCommand("ffuf -u http://t/FUZZ -w d.txt -rate 80", high).reason, /超阈值/);
  assert.match(scanCommand("ffuf -u http://t/FUZZ -w d.txt -rate 20", { defaultRps: 5 }).reason, /超阈值/);
  // 门禁阈值不可被设成 0/负数（vore-settings 侧夹紧；guard 侧也做兜底运算）
  assert.equal(scanCommand("ffuf -u http://t/FUZZ -w d.txt -rate 1", { defaultRps: 0 }), null, "0 视为无效值 → 回出厂 5，故 -rate 1 放行");
  assert.match(scanCommand("ffuf -u http://t/FUZZ -w d.txt -rate 2", { defaultRps: -5 }).reason, /超阈值/, "负数兜底为下限 1，-rate 2 被拦");
  // 建议文案里带上当前设置值
  assert.match(scanCommand("nuclei -u http://t", high).downgrade, /-rl 50/);
});

ok("拒绝文案自带降级路径（先小样本/限速/去重/命中即停）", () => {
  const r = blocked("hydra -l admin -P pass.txt target.example ssh");
  assert.match(r.downgrade, /降级替代/);
  const f = blocked("ffuf -u http://t/FUZZ -w d.txt");
  assert.match(f.downgrade, /≤50|小样本/);
});

// ── 门禁边界（两侧都要测：误拦会挡掉合法测试面，漏放会让纪律失效）────────────
// 回归来源：爆破规则曾写成 `/\b(?:…|-P)\s*[^\s|;&]+/i`，`/i` 让它连**工具名里的 -p** 都命中
// （`bloodhound-python`→"-python"、`impacket-psexec`→"-psexec"、`-no-pass`→"-pass"），
// 于是内网凭据复用/AD 枚举/无密码登录验证这些**合法**动作全被拦（实测语料 720 份技能里 960 行被拦，
// 其中绝大多数是这类误报）；nmap 侧则反过来：`--min-rate`（速率下限，越扫越快）被当成"已限速"，
// 而 `--max-rate` 根本没有上限夹紧。
ok("误拦回归：内网凭据复用/枚举类命令必须放行", () => {
  allowed("bloodhound-python -d corp.local -u user -p pass -ns 10.0.0.1 -c All");
  allowed("impacket-GetNPUsers corp.local/ -usersfile users.txt -dc-ip 10.0.0.1 -no-pass");
  allowed("impacket-psexec corp/admin@target -hashes :aabbccddeeff");
  allowed("KRB5CCNAME=admin.ccache impacket-secretsdump -k -no-pass dc.corp.local");
  allowed("scp -P 2222 /tmp/loot.tar user@10.0.0.1:/tmp/");
  allowed("curl -s -u admin:pass http://t/api/me");
  allowed("sqlmap -u 'http://t/?id=1' --batch --level 1");
});

ok("误拦回归：URL/路径里的工具名子串不算爆破工具", () => {
  allowed("./mythic-cli install github https://github.com/MythicAgents/medusa");
  allowed("nmap -p 80,443 -sV target.example");
});

ok("真阳性仍然拦得住（不能因为修误报把规则修没了）", () => {
  blocked("hydra -L users.txt -P pass.txt target.example http-post-form");
  blocked("medusa -h target.example -U users.txt -P pass.txt -M ssh");
  blocked("netexec smb 10.0.0.1 -u users.txt -p pass.txt");
  blocked("nxc smb 10.0.0.1 -u users.txt -p pass.txt");
  blocked("curl --password-file pass.txt http://t/login");
  assert.match(blocked("for u in $(cat pass.txt); do curl -u $u http://t; done").reason, /爆破/);
});

ok("nmap 速率纪律：-T4/--min-rate 不算限速，--max-rate 必须有上限", () => {
  assert.match(blocked("nmap -p- target.example").reason, /--max-rate/);
  assert.match(blocked("nmap -p- -T4 target.example").reason, /--max-rate/, "-T4 只是时序模板，不限制 pps");
  assert.match(blocked("nmap -p- --min-rate 5000 target.example").reason, /下限/);
  assert.match(blocked("nmap -p- --max-rate 20000 target.example").reason, /超过上限/);
  blocked("nmap -p 1-65535 target.example");
  blocked("nmap --top-ports 5000 target.example");
  allowed("nmap -p- --max-rate 300 -T3 target.example");
  allowed("nmap -p- --max-rate 100 target.example");
  allowed("nmap --top-ports 100 target.example");       // 拒绝文案里推荐的保守替代，自己不能被拦
  allowed("nmap --top-ports 500 target.example");
  allowed("nmap -T2 --max-rate 50 10.0.0.0/24");
  // 上限随设置面板的 defaultRps 缩放（defaultRps=1 → 1×60=60 → 夹紧到下界 100）
  assert.equal(scanCommand("nmap -p- --max-rate 90 target.example", { defaultRps: 1 }), null);
  assert.match(scanCommand("nmap -p- --max-rate 500 target.example", { defaultRps: 1 }).reason, /超过上限/);
});

// ── 阶段机 / 覆盖账本（三阶段作业法）────────────────────────────────────────
console.log("\n阶段机与覆盖账本（P1 收集 → P2 浅测 → P3 深测，新资产回灌）");

{
  const s = openStore(":memory:");
  const p = s.createProject({ sessionId: "sm", cwd: "C:/smoke", origin: "example.com", goal: "拿证据链" });

  ok("新项目默认在 P1，资产为空时不能推进", () => {
    const cov = s.coverage(p.id);
    assert.equal(cov.phase, "P1");
    assert.equal(cov.counts.assets, 0);
    const r = s.advancePhase(p.id, "P2");
    assert.equal(r.ok, false);
    assert.ok(r.blockers.join(" ").includes("资产清单为空"));
  });

  ok("登记资产是幂等的（同 kind+value 只更新不新增）", () => {
    const a = s.upsertAssets(p.id, [{ kind: "domain", value: "example.com" }, { kind: "subdomain", value: "a.example.com", priority: 4 }], "recon");
    assert.equal(a.addedCount, 2);
    const b = s.upsertAssets(p.id, [{ kind: "domain", value: "example.com", tech: "nginx 1.24" }], "fingerprint");
    assert.equal(b.addedCount, 0);
    assert.equal(b.updatedCount, 1);
    assert.equal(s.coverage(p.id).counts.assets, 2);
    assert.equal(s.listAssets(p.id, { kind: "domain" })[0].tech, "nginx 1.24");
  });

  ok("P1 出关：需要「收轮」且连续一轮 0 新增 + 来源齐（或显式标记穷尽）", () => {
    let r = s.advancePhase(p.id, "P2");
    assert.equal(r.ok, false, "没来源、没收轮时不该放行");
    s.markSourceExhausted(p.id, ["domain", "subdomain", "ip", "port", "url", "endpoint", "js"]);
    r = s.advancePhase(p.id, "P2");
    assert.equal(r.ok, false, "还没收轮 → 不饱和，不放行");
    const round1 = s.endReconRound(p.id, "首轮");
    assert.equal(round1.addedThisRound, 2);
    assert.equal(round1.saturated, false);
    const round2 = s.endReconRound(p.id, "复核轮");
    assert.equal(round2.addedThisRound, 0);
    assert.equal(round2.saturated, true);
    r = s.advancePhase(p.id, "P2");
    assert.equal(r.ok, true);
    assert.equal(r.phase, "P2");
  });

  // ── 六阶段 + 六张矩阵：P2 信息收集 / P3 浅层 / P4 中间层 / P5 深层 ──────────
  const fill = (stage, status, opts = {}) => {
    for (const a of s.listAssets(p.id)) {
      for (const key of requiredKeys(a.kind, stage)) {
        const r = s.setCheck(p.id, { id: a.id }, { stage, key, status, evidence: opts.evidence ?? "evidence/smoke.txt", note: opts.note ?? `smoke 批量登记：${stage}.${key}`, reviewed: Boolean(opts.reviewed) });
        assert.equal(r.ok, true, `${stage}.${key} 登记失败：${JSON.stringify(r).slice(0, 160)}`);
      }
    }
  };

  ok("P2 出关：信息收集阶段每个资产的必采信息项（info）都要有结论", () => {
    let r = s.advancePhase(p.id, "P3");
    assert.equal(r.ok, false, "信息收集没做完不该放行");
    assert.match(r.blockers.join(" "), /信息收集未完成/);
    fill("info", "done");
    r = s.advancePhase(p.id, "P3");
    assert.equal(r.ok, true, JSON.stringify(r.blockers ?? r));
    assert.equal(s.coverage(p.id).stages.info.pct, 100);
    // s2 汇总位由检查矩阵自动同步（不再是人工写）
    assert.equal(s.listAssets(p.id).every((a) => a.s2 === "done"), true, "info 采齐后 s2 应自动为 done");
  });

  ok("P3 出关：浅层要「核实信息收集」+ 做完 8 项浅层测试", () => {
    let r = s.advancePhase(p.id, "P4");
    assert.equal(r.ok, false, "浅层没做完不该放行");
    assert.match(r.blockers.join(" "), /浅层·核实信息收集未完成/);
    fill("verifyInfo", "ok");
    r = s.advancePhase(p.id, "P4");
    assert.equal(r.ok, false, "浅层测试还没做（8 项）");
    assert.match(r.blockers.join(" "), /浅层测试未完成/);
    fill("shallow", "done");
    r = s.advancePhase(p.id, "P4");
    assert.equal(r.ok, true, JSON.stringify(r.blockers ?? r));
    assert.equal(r.phase, "P4");
  });

  ok("P4 出关：中间层要「核实浅层」+ 跑完 OWASP A01–A10", () => {
    let r = s.advancePhase(p.id, "P5");
    assert.equal(r.ok, false, "中间层没做完不该放行");
    assert.match(r.blockers.join(" "), /中间层·核实浅层未完成/);
    fill("verifyShallow", "ok");
    r = s.advancePhase(p.id, "P5");
    assert.equal(r.ok, false, "OWASP 还没做");
    assert.match(r.blockers.join(" "), /OWASP Top 10 未完成/);
    fill("owasp", "done");
    r = s.advancePhase(p.id, "P5");
    assert.equal(r.ok, true, JSON.stringify(r.blockers ?? r));
    assert.equal(r.phase, "P5");
    // 中间层的结论**还没被深层核验过** —— 这会在"进 P6"时拦（见下一个用例）
    assert.ok(s.coverage(p.id).owaspUnreviewed > 0, "OWASP 结论默认未核验，应由深层置 reviewed");
  });

  ok("上一层被核实为 wrong：必须被下一步独立复算后才放行", () => {
    const a = s.listAssets(p.id).find((x) => x.priority >= 3);
    const w = s.setCheck(p.id, { id: a.id }, { stage: "verifyInfo", key: "tech", status: "wrong", note: "版本只来自响应头，行为验证与 1.24 不符（实为 1.18）" });
    assert.equal(w.ok, true);
    let r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "有未复算的 wrong 不放行");
    assert.match(r.blockers.join(" "), /被核实为 wrong/);
    s.setCheck(p.id, { id: a.id }, { stage: "verifyInfo", key: "tech", status: "wrong", note: "已复算：实为 1.18", reviewed: true });
    const cov = s.coverage(p.id);
    assert.equal(cov.wrongChecks.length, 1);
    assert.equal(cov.wrongChecks[0].stage, "verifyInfo");
    assert.equal(cov.wrongChecks[0].reviewed, true);
  });

  ok("P5 出关：深层的必测类别 + 核验中间层 + 未测面声明 + 漏洞事实复核", () => {
    const before = s.coverage(p.id);
    s.upsertAssets(p.id, [{ kind: "endpoint", value: "https://example.com/api/order", priority: 5, notes: "带参接口，入口" }], "js-reverse");
    // 新资产 = 回灌：阶段回到 P1，且必须先再收一轮确认穷尽
    const afterAdd = s.coverage(p.id);
    assert.equal(afterAdd.phase, "P1", "回灌后阶段回到 P1 起点");
    assert.equal(afterAdd.reflow.pending, true);
    assert.ok(afterAdd.blockers.P1.some((b) => /回灌未收轮/.test(b)));
    s.endReconRound(p.id, "回灌确认轮 1");
    s.endReconRound(p.id, "回灌确认轮 2");
    assert.equal(s.coverage(p.id).reflow.pending, false, "连续 0 新增后回灌解封");
    assert.equal(before.phase, "P5", "回灌前的阶段确实是 P5，说明这是「进行中被打断」的真实场景");
    s.advancePhase(p.id, "P2");   // 回到 P2 继续给新资产补矩阵
    fill("info", "done");
    fill("verifyInfo", "ok");
    fill("shallow", "done");
    fill("verifyShallow", "ok");
    let r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "深层没做不该放行");
    assert.match(r.blockers.join(" "), /深层未完成/);
    fill("owasp", "done");                       // 新资产的 OWASP 行（未核验）
    fill("deep", "done");
    r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "中间层结论还没被深层核验过");
    assert.match(r.blockers.join(" "), /还没被深层核验过/);
    fill("owasp", "done", { reviewed: true });   // 深层复算后置 reviewed
    r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "未测面还没声明");
    assert.match(r.blockers.join(" "), /未测面还没显式声明/);
    s.addUntested(p.id, { surface: "微信小程序包提取", why: "模拟器未安装微信，取证否定；需真机", stage: "P3" });
    const noWhy = s.addUntested(p.id, { surface: "iOS ipa", why: "" });
    assert.equal(noWhy.ok, false, "未测面必须写理由");
    s.declareUntested(p.id, "本轮共 1 条未测面");
    s.addFact(p.id, { description: "接口未鉴权可读他人数据", category: "vuln", evidence: "evidence/api/1.http" });
    r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "漏洞事实还没复核");
    assert.match(r.blockers.join(" "), /没有复核记录/);
  });

  ok("漏洞事实复核：confirm/challenge 都要证据；补完才能进 P6", () => {
    const f = s.addFact(p.id, { description: "接口未鉴权可读他人数据", category: "vuln", evidence: "evidence/api/1.http" });
    assert.equal(s.reviewFact(p.id, f.id, { verdict: "confirm" }).ok, false, "没证据的复核要被拒");
    assert.equal(s.reviewFact(p.id, f.id, { verdict: "maybe", evidence: "x" }).ok, false, "verdict 只能是 confirm|challenge");
    assert.equal(s.reviewFact(p.id, f.id, { verdict: "confirm", evidence: "evidence/review/1-replay.http" }).ok, true);
    // 本轮前面登记过的漏洞事实也要复核（门禁查的是"全部"）
    const pending = s.db.prepare("SELECT id FROM facts WHERE project_id=? AND category='vuln' AND deprecated=0 AND (review_status IS NULL OR review_status='')").all(p.id);
    for (const row of pending) {
      assert.equal(s.reviewFact(p.id, row.id, { verdict: "confirm", evidence: `evidence/review/${row.id}-replay.http` }).ok, true);
    }
    const r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, true, JSON.stringify(r.blockers ?? r));
    assert.equal(r.phase, "P6");
    assert.equal(s.coverage(p.id).reviews.pending, 0);
  });

  ok("回灌：新增资产让六张矩阵缺口重现，并把阶段退回 **P1 起点**（即使已在 P6）", () => {
    const add = s.upsertAssets(p.id, [{ kind: "js", value: "https://example.com/assets/app.7f3a.js", priority: 4 }], "js-reverse");
    assert.equal(add.addedCount, 1);
    const cov = s.coverage(p.id);
    assert.ok(cov.stages.info.gapCount > 0, "新资产没做信息收集 → info 缺口必须出现");
    assert.ok(cov.stages.shallow.gapCount > 0, "新资产没做浅层测试 → shallow 缺口必须出现");
    assert.ok(cov.stages.deep.gapCount > 0, "新资产没做深层 → deep 缺口必须出现");
    assert.equal(cov.canAdvanceTo.P6, false, "有回灌缺口时不能进成果");
    assert.equal(cov.phase, "P1", "回灌 = 面还没穷尽 → 阶段退回 P1 起点");
    assert.equal(cov.reflow.pending, true, "回灌未收轮要显式标记");
    assert.equal(cov.reflow.source, "js-reverse", "要记下来源（js-reverse / 目录探测 / 配置…）");
    assert.match(String(cov.reflow.note), /回到 P1 起点/);
    assert.ok(cov.blockers.P1.some((b) => /回灌未收轮/.test(b)), "P1 必须出现「回灌未收轮」阻塞");
    const r = s.advancePhase(p.id, "P6");
    assert.equal(r.ok, false, "清完缺口前不能收口");
    assert.match((r.blockers ?? []).join(" "), /回灌未收轮|信息收集未完成|浅层测试未完成|深层未完成/);
  });

  ok("回灌之后必须再收一轮（连续 0 新增）才解封；本轮仍有新增就继续收", () => {
    const round1 = s.endReconRound(p.id, "回灌后确认轮");
    assert.equal(round1.reflowCleared, true, "收轮要清掉回灌 pending");
    assert.equal(round1.addedThisRound, 1, "这一轮里确实看到了那个新资产");
    let cov = s.coverage(p.id);
    assert.equal(cov.reflow.pending, false);
    assert.ok(cov.blockers.P1.length > 0, "上一轮仍有新增 → P1 还没饱和");
    assert.equal(s.advancePhase(p.id, "P2").ok, false, "没饱和不能进 P2");
    const round2 = s.endReconRound(p.id, "再确认轮");
    assert.equal(round2.addedThisRound, 0);
    assert.equal(round2.saturated, true);
    cov = s.coverage(p.id);
    assert.deepEqual(cov.blockers.P1, [], "连续 0 新增 + 来源齐 → P1 出关条件满足（只剩新资产的矩阵缺口）");
    assert.equal(s.advancePhase(p.id, "P2").ok, true, "P1 出关后可回到 P2 给新资产做信息收集");
  });

  ok("检查矩阵本身也是门禁：key 必须属于该 stage 的必查集", () => {
    const js = s.listAssets(p.id, { kind: "js" })[0];
    assert.equal(s.setCheck(p.id, { id: js.id }, { stage: "info", key: "jsrev", status: "doing" }).ok, true, "js 资产的信息收集里 jsrev 是必查项");
    const bad = s.setCheck(p.id, { id: js.id }, { stage: "info", key: "banana", status: "done" });
    assert.equal(bad.ok, false);
    assert.ok(Array.isArray(bad.allowed) && bad.allowed.includes("jsrev"), "拒绝时要给出合法 key 列表");
    // 八个浅层测试项与 OWASP/深层 key 都必须是"关起来"的集合
    assert.equal(s.setCheck(p.id, { id: js.id }, { stage: "shallow", key: "lowFuzz", status: "done", evidence: "e/log.txt" }).ok, true);
    assert.equal(s.setCheck(p.id, { id: js.id }, { stage: "shallow", key: "notAClass", status: "done" }).ok, false, "浅层只有 8 个合法项");
    const hitNoEv = s.setCheck(p.id, { id: js.id }, { stage: "deep", key: "inj", status: "hit" });
    assert.equal(hitNoEv.ok, false, "hit 必须带证据");
    assert.equal(s.setCheck(p.id, { id: js.id }, { stage: "deep", key: "inj", status: "hit", evidence: "poc/inj.txt" }).ok, true);
  });

  // `na`（判定不适用）与 `done` 一样计入覆盖 —— 所以它必须**机器可校验**地给理由，
  // 否则"把难的面标 na"就是把覆盖率刷到 100% 的漂白通道（比漏测更糟：报告上看不出来）。
  ok("na 必须带可复核的理由（检查矩阵层同样强制）", () => {
    s.upsertAssets(p.id, [{ kind: "url", value: "https://example.com/static/logo.png", priority: 3 }], "smoke");
    const asset = s.listAssets(p.id, { kind: "url" }).find((a) => a.value.endsWith("logo.png"));
    // 旧汇总位（s2/s3）这条路径仍然强制理由
    const noReason = s.updateAsset(p.id, { id: asset.id }, { s2: "na" });
    assert.equal(noReason.ok, false, "无理由的 na 必须被拒");
    assert.match(noReason.error, /理由/);
    assert.ok(noReason.hint, "被拒时要给出怎么写理由的提示");
    // 检查矩阵层
    const chkNoReason = s.setCheck(p.id, { id: asset.id }, { stage: "info", key: "cert", status: "na" });
    assert.equal(chkNoReason.ok, false, "检查矩阵的 na 也要理由");
    assert.equal(s.setCheck(p.id, { id: asset.id }, { stage: "info", key: "cert", status: "na", note: "该 URL 走内网回源，无独立证书面" }).ok, true);
  });

  ok("覆盖率把 na 与「真测过」分开出数（na 不得刷满覆盖）", () => {
    const c = s.coverage(p.id);
    assert.equal(c.counts.naNoReason, 0, "带理由的 na 不计入 naNoReason");
    assert.ok(c.pct.shallow <= 100 && c.pct.shallowTested <= c.pct.shallow, `真测过(${c.pct.shallowTested}%) 不得高于含 na 的覆盖(${c.pct.shallow}%)`);
    assert.ok(c.stages.info.required > 0 && c.stages.info.pct >= 0);
    assert.equal(Object.keys(c.stages).length, 6, "六张矩阵都要出数");
    // 已标 na 的资产再改别的字段时不应因为"没重新给理由"被拒（沿用原理由）
    const asset = s.listAssets(p.id, { kind: "url" }).find((a) => a.value.endsWith("logo.png"));
    assert.equal(s.updateAsset(p.id, { id: asset.id }, { tech: "nginx 1.24", notes: "纯静态图片，无参数面" }).ok, true);
  });

  ok("低优先级（<3）必须给理由才准登记：否则等于给自己免测开绿灯", () => {
    const bad = s.upsertAssets(p.id, [{ kind: "other", value: "低价值资产", priority: 1 }], "smoke");
    assert.equal(bad.addedCount, 0, "priority<3 无理由必须被拒");
    assert.ok(bad.skippedCount >= 1 && /理由/.test(bad.skipped[0]));
    const good = s.upsertAssets(p.id, [{ kind: "other", value: "低价值资产", priority: 1, notes: "纯静态占位页，无业务面" }], "smoke");
    assert.equal(good.addedCount, 1);
    // 低优先资产不要求后四个矩阵（浅层测试/核实浅层/OWASP/深层）—— 这是"写了理由的可审计降级"
    const low = s.listAssets(p.id, { kind: "other" })[0];
    assert.equal(low.checkSummary.shallow.applicable, false);
    assert.equal(low.checkSummary.info.applicable, true, "信息收集对所有资产都要求");
    const high = s.listAssets(p.id).find((a) => a.priority >= 3);
    assert.equal(high.checkSummary.shallow.applicable, true);
  });
}

// ── 多项目隔离 / 幽灵项目 / 旧库迁移 ────────────────────────────────────────
// 回归来源（真实故障）：facts/intents/hints/assets 的 id 是按项目从 001 编的，
// 可主键却只有 id 一列 → 第二个项目连 origin/goal 都插不进去
// （UNIQUE constraint failed: facts.id）；而 createProject 又没事务，
// 于是 projects 表里留下一个"没有任何事实的幽灵项目"，面板默认取"最近更新的项目"
// 正好读到它 → 三个分栏全空，表现为"作战面板没有任何显示"。
console.log("\n多项目隔离与旧库迁移");

{
  const s = openStore(":memory:");
  const a = s.createProject({ sessionId: "sess-A", cwd: "C:/a", origin: "https://a.example", goal: "A 目标" });
  const b = s.createProject({ sessionId: "sess-B", cwd: "C:/b", origin: "https://b.example", goal: "B 目标" });

  ok("两个项目可以共存，编号各自从 001 起", () => {
    assert.notEqual(a.id, b.id);
    assert.equal(s.addFact(a.id, { description: "A 的事实" }).id, "f001");
    assert.equal(s.addFact(b.id, { description: "B 的事实" }).id, "f001", "第二个项目也要能从 f001 起");
    assert.equal(s.addHint(a.id, "A 的提示").id, "h001");
    assert.equal(s.addHint(b.id, "B 的提示").id, "h001");
    assert.equal(s.upsertAssets(a.id, [{ kind: "domain", value: "a.example" }]).added[0].id, "a001");
    assert.equal(s.upsertAssets(b.id, [{ kind: "domain", value: "b.example" }]).added[0].id, "a001");
    assert.equal(s.proposeIntents(a.id, [{ from: ["f001"], description: "A 的方向" }]).created[0].id, "i001");
    assert.equal(s.proposeIntents(b.id, [{ from: ["f001"], description: "B 的方向" }]).created[0].id, "i001");
  });

  ok("同名 id 不会串项目：读图/改状态各自隔离", () => {
    s.deprecateFact(a.id, "f001", "只废弃 A 的");
    assert.equal(s.graph(a.id).facts.find((f) => f.id === "f001").deprecated, true);
    assert.equal(s.graph(b.id).facts.find((f) => f.id === "f001").deprecated, false, "B 的 f001 不该被连坐");
    s.updateAsset(a.id, { kind: "domain", value: "a.example" }, { s2: "done" });
    assert.equal(s.coverage(a.id).pct.shallow, 100);
    assert.equal(s.coverage(b.id).pct.shallow, 0);
  });

  ok("建项目是事务：中途失败不留幽灵项目", () => {
    const before = s.listProjects().length;
    // 用一个无法绑定到 SQLite 的值在第 2 条语句处炸掉（projects 行已经插进去了）
    assert.throws(() => s.createProject({ sessionId: { bad: true }, origin: "https://x.example", goal: "x" }));
    const after = s.listProjects();
    assert.equal(after.length, before, "失败的项目不应留在列表里");
    assert.equal(after.filter((p) => p.origin === "https://x.example").length, 0);
    assert.equal(s.listProjects().every((p) => s.graph(p.id).facts.length >= 2), true, "每个项目都要有 origin/goal 两行");
  });
}

{
  // 造一个"旧库"：单列主键 + 一个幽灵项目，然后交给 openStore 迁移
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-migrate-"));
  const dbPath = path.join(dir, "old.db");
  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, session_id TEXT, cwd TEXT, title TEXT, origin TEXT, goal TEXT, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE facts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL, category TEXT, evidence TEXT, confidence TEXT, source_intent TEXT, deprecated INTEGER DEFAULT 0, created_at TEXT NOT NULL, severity TEXT, target TEXT, poc TEXT, fix TEXT, status TEXT);
    CREATE TABLE intents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL, domain TEXT, priority INTEGER, status TEXT, worker TEXT, claimed_at TEXT, to_fact TEXT, dead INTEGER DEFAULT 0, note TEXT, creator TEXT, created_at TEXT NOT NULL, concluded_at TEXT);
    CREATE TABLE intent_sources (intent_id TEXT NOT NULL, project_id TEXT NOT NULL, fact_id TEXT NOT NULL, PRIMARY KEY (intent_id, fact_id));
    CREATE TABLE hints (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, content TEXT NOT NULL, creator TEXT, created_at TEXT NOT NULL);
    CREATE TABLE assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, label TEXT, tech TEXT, priority INTEGER DEFAULT 3, s2 TEXT DEFAULT 'pending', s3 TEXT DEFAULT 'pending', evidence TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER DEFAULT 0);
    CREATE TABLE scoped_counters (project_id TEXT NOT NULL, kind TEXT NOT NULL, value INTEGER DEFAULT 0, PRIMARY KEY (project_id, kind));
    INSERT INTO counters VALUES ('project', 2);
    INSERT INTO projects VALUES ('eng_001','sess-old','C:/old','旧项目','https://old.example','旧目标','active','2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');
    INSERT INTO projects VALUES ('eng_002','sess-ghost','C:/ghost','幽灵项目','https://ghost.example','幽灵目标','active','2025-01-01T00:00:01Z','2025-01-01T00:00:01Z');
    INSERT INTO facts VALUES ('origin','eng_001','任务起点：https://old.example','origin',NULL,'confirmed',NULL,0,'2025-01-01T00:00:00Z',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO facts VALUES ('goal','eng_001','任务目标：旧目标','goal',NULL,'confirmed',NULL,0,'2025-01-01T00:00:00Z',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO facts VALUES ('f001','eng_001','旧库里的第一条事实','vuln','evidence/old-1.txt','confirmed',NULL,0,'2025-01-01T00:01:00Z','high',NULL,NULL,NULL,NULL);
    INSERT INTO intents VALUES ('i001','eng_001','旧库方向','api-security',5,'open',NULL,NULL,NULL,0,NULL,'orchestrator','2025-01-01T00:02:00Z',NULL);
    INSERT INTO intent_sources VALUES ('i001','eng_001','f001');
    INSERT INTO hints VALUES ('h001','eng_001','旧库提示','Human','2025-01-01T00:03:00Z');
    INSERT INTO assets VALUES ('a001','eng_001','domain','old.example','旧主域','nginx',4,'done','pending',NULL,NULL,'2025-01-01T00:04:00Z','2025-01-01T00:04:00Z');
  `);
  raw.close();

  const s = openStore(dbPath);

  ok("旧库迁移：数据原样保留，主键改成含 project_id", () => {
    const g = s.graph("eng_001");
    assert.equal(g.facts.length, 3);
    assert.equal(g.facts.find((f) => f.id === "f001").description, "旧库里的第一条事实");
    assert.equal(g.facts.find((f) => f.id === "f001").severity, "high");
    assert.equal(g.intents.length, 1);
    assert.equal(g.intents[0].from.join(","), "f001");
    assert.equal(g.hints.length, 1);
    assert.equal(s.listAssets("eng_001")[0].tech, "nginx");
    assert.equal(s.coverage("eng_001").pct.shallow, 100, "assets 的 s2 也要原样搬过来");
    const sql = s.db.prepare("SELECT sql FROM sqlite_master WHERE name='facts'").get().sql;
    assert.match(sql, /PRIMARY KEY \(project_id, id\)/);
  });

  ok("迁移后能建第二个项目（旧库这是必炸的操作）", () => {
    const p = s.createProject({ sessionId: "sess-new", cwd: "C:/new", origin: "https://new.example", goal: "新目标" });
    assert.equal(s.addFact(p.id, { description: "新项目第一条" }).id, "f001");
    assert.equal(s.graph(p.id).facts.length, 3);
    assert.equal(s.graph("eng_001").facts.length, 3, "老项目不受影响");
  });

  ok("旧库迁移：新表与新列一并就位（检查矩阵 / 未测面 / 复核）", () => {
    const id = s.createProject({ sessionId: "sess-new2", cwd: "C:/new2", origin: "https://m.example", goal: "验证新列" }).id;
    s.upsertAssets(id, [{ kind: "domain", value: "m.example", priority: 4 }]);
    const asset = s.listAssets(id, { kind: "domain" })[0];
    assert.equal(s.setCheck(id, { id: asset.id }, { stage: "info", key: "tech", status: "done", evidence: "e/1.txt" }).ok, true, "asset_checks 表要在旧库上可用");
    assert.equal(s.addUntested(id, { surface: "客户端包提取", why: "环境不具备，需真机" }).ok, true, "untested 表要在旧库上可用");
    const f = s.addFact(id, { description: "疑似未鉴权", category: "vuln", evidence: "e/2.http" });
    assert.equal(s.reviewFact(id, f.id, { verdict: "confirm", evidence: "e/review/2-replay.http" }).ok, true, "review_* 列要在旧库上可用");
    const cov = s.coverage(id);
    assert.equal(cov.reviews.reviewed, 1);
    assert.ok(cov.stages.info.required > 0 && cov.stages.info.done === 1);
  });

  ok("六阶段升级：旧五阶段的 phase 与 stage 命名会被就地改写（且只改一次）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vore-scheme-"));
    const dbPath = path.join(dir, "five.db");
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, session_id TEXT, cwd TEXT, title TEXT, origin TEXT, goal TEXT, status TEXT,
                             phase TEXT, phase_scheme INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
      CREATE TABLE asset_checks (project_id TEXT NOT NULL, asset_id TEXT NOT NULL, stage TEXT NOT NULL, key TEXT NOT NULL,
                                 status TEXT NOT NULL, evidence TEXT, note TEXT, reviewed INTEGER DEFAULT 0,
                                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                                 PRIMARY KEY (project_id, asset_id, stage, key));
      INSERT INTO projects VALUES ('eng_001','s1','C:/x','t','o','g','active','P3',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
      INSERT INTO projects VALUES ('eng_002','s2','C:/y','t2','o2','g2','active','P5',0,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
      INSERT INTO asset_checks VALUES ('eng_001','a001','verify','tech','ok','e/1.txt',NULL,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
    `);
    raw.close();
    const s2 = openStore(dbPath);
    assert.equal(s2.getProject("eng_001").phase, "P4", "旧 P3（中间层）→ 新 P4（中间层）");
    assert.equal(s2.getProject("eng_002").phase, "P6", "旧 P5（成果）→ 新 P6（成果）");
    assert.equal(s2.getProject("eng_001").phase_scheme, 1);
    const row = s2.db.prepare("SELECT * FROM asset_checks WHERE project_id='eng_001'").get();
    assert.equal(row.stage, "verifyInfo", "旧 stage=verify（核实信息收集）→ verifyInfo");
    assert.equal(row.reviewed, 1, "reviewed 等字段原样搬过来");
    s2.close();
    // 二次打开不应再改（phase_scheme 已置 1）
    const s3 = openStore(dbPath);
    assert.equal(s3.getProject("eng_001").phase, "P4", "重复打开不能反复映射阶段");
    assert.equal(s3.getProject("eng_002").phase, "P6");
    s3.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 下 WAL 句柄偶尔未释放 */ }
  });

  ok("幽灵项目被补回 origin/goal（图才画得出来）", () => {
    const g = s.graph("eng_002");
    assert.equal(g.facts.length, 2);
    assert.deepEqual(g.facts.map((f) => f.id).sort(), ["goal", "origin"]);
    assert.match(g.facts.find((f) => f.id === "origin").description, /ghost\.example/);
  });

  s.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 下 WAL 句柄偶尔还没释放 */ }
}

console.log(`\n全部通过：${passed} 项`);
