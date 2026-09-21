// vore-blackboard —— 网络安全模式的黑板引擎（宿主平面插件）。
//
// 范式：把作业还原为状态空间搜索。黑板三类对象：
//   Fact   已确认的客观事实（append-only；只能由 bb_fact_add / bb_intent_conclude 新建）
//   Intent 待探索方向（一条 intent = 一条边 from[] → to_fact；认领即占用，结论即落定）
//   Hint   人类注入的判断（随时可写；每轮读图时全量吸收）
// 总控做 reason（读全图 → 判目标 → 提 ≤3 个 Intent → 派单）；
// 子 agent 做 explore（认领一个 Intent → 执行 → 回报增量 Fact）。
//
// 本插件提供：bb_* 工具面 + 逐轮图快照注入（systemPrompt context）+ 作战面板 HTTP 通道。

import { defineTool } from "@deepseek-ai/dsh-tools";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore, DEFAULT_DB, PHASES, PHASE_LABEL, CHECK_STAGES, CHECK_STAGE_LABEL, INFO_BASE, INFO_KEY_LABEL, OWASP_TOP10, DEEP_CLASSES, DEEP_LABEL, requiredKeys } from "./store.js";

export const name = "vore-blackboard";
export const inject = ["tools", "webServer", "webRuntime", "agentPresets", "systemPrompt"];
export const ROUTE_PATH = "/vore-blackboard";
export const MODE_ID = "network-security";

const CSRF_TOKEN = crypto.randomBytes(24).toString("hex");

/** 角色卡目录：项目根的 agents/（本插件位于 <root>/plugins/vore-blackboard/lib）。 */
export function defaultAgentsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "agents");
}

/** 读全部角色卡（frontmatter + 正文）。 */
export function loadAgentCards(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")).sort()) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const body = fm ? text.slice(fm[0].length).trim() : text.trim();
    const pick = (k) => {
      const m = fm?.[1]?.match(new RegExp(`^${k}:\\s*(.+)$`, "m"));
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    out.push({
      file,
      id: pick("id") || file.replace(/\.md$/i, ""),
      name: pick("name"),
      description: pick("description"),
      kind: pick("kind") || "subagent",
      body,
    });
  }
  return out;
}

// ── 会话/上下文解析 ─────────────────────────────────────────────────────────

function presetOf(ctx, agent) {
  try {
    const p = ctx.agentPresets.composedPreset(agent?.ctx);
    return typeof p === "string" ? p : "";
  } catch {
    return "";
  }
}

function sessionOf(ctx, exec) {
  const agent = exec?.agent;
  const session = agent?.session;
  const header = session?.header ?? {};
  const id = session?.id;
  const cwd = header?.cwd;
  const preset = presetOf(ctx, agent);
  // 子 agent 判定：宿主在会话头上写明 origin='subagent' / delegationDepth>0（父会话 id 在 parentSession）。
  // 这个判定决定了"能不能按工作目录回退找项目"——见 resolveContext。
  const depth = Number(header?.delegationDepth ?? 0);
  const isChild = header?.origin === "subagent" || (Number.isFinite(depth) && depth > 0);
  return {
    id: typeof id === "string" ? id : "",
    cwd: typeof cwd === "string" ? cwd : "",
    preset,
    isChild,
    parentSessionId: isChild && typeof header?.parentSession === "string" ? header.parentSession : null,
  };
}

/**
 * 本项目会话 = network-security 预设的主会话，或（子 agent）解析到项目后的会话。
 *
 * **一个会话一个项目**：顶层会话只认自己 session_id 绑定的项目，**不按工作目录回退** ——
 * 否则在同一目录里新开一个会话，就会把上一次测试的项目端出来（真实反馈：
 * "新开会话没有用新的作战面板，似乎把所有会话测试过的都放到同一个作战面板里了"）。
 * 子 agent 的 session_id 与总控不同，所以它才允许按「父会话 → 工作目录」回退命中同一张图。
 */
function resolveContext(ctx, exec, store) {
  const s = sessionOf(ctx, exec);
  const bound = store.findProject({ sessionId: s.id, cwd: s.cwd, allowCwd: s.isChild })
    ?? (s.isChild && s.parentSessionId ? store.findProject({ sessionId: s.parentSessionId }) : null);
  const allowed = s.preset === MODE_ID || (s.preset === "" && bound !== null);
  return { ...s, project: bound, allowed };
}

// ── HTTP 通道（自注册路由 + 同源栅栏 + CSRF）────────────────────────────────

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]" || hostname === "::1") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function isTrustedRequest(req, trustedHosts) {
  const host = typeof req.headers?.host === "string" ? req.headers.host : "";
  if (host === "") return false;
  let hostUrl;
  try { hostUrl = new URL(`http://${host}`); } catch { return false; }
  const okHost = isLoopbackHostname(hostUrl.hostname) ||
    (trustedHosts ?? []).some((t) => { try { return new URL(`http://${t}`).hostname === hostUrl.hostname; } catch { return false; } });
  if (!okHost) return false;
  const origin = req.headers?.origin;
  if (typeof origin === "string" && origin !== "null") {
    try { if (new URL(origin).host !== hostUrl.host) return false; } catch { return false; }
  }
  return true;
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function checkCsrf(req) {
  const token = req.headers?.["x-dsh-csrf"];
  if (typeof token !== "string" || token.length !== CSRF_TOKEN.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CSRF_TOKEN)); } catch { return false; }
}

// ── 图快照渲染（给模型看的紧凑文本，预算受控）────────────────────────────────

export function renderSnapshot(summary, maxChars = 1500) {
  if (!summary) return "";
  const lines = [];
  const c = summary.counts;
  lines.push(`[vore 黑板] 项目=${summary.project.id}（${summary.project.title}）状态=${summary.project.status}`);
  lines.push(`goal: ${String(summary.project.goal ?? "").slice(0, 160)}`);
  lines.push(`origin: ${String(summary.project.origin ?? "").slice(0, 120)}`);
  lines.push(`facts=${c.facts} intents=${c.intents}（open ${c.open} / claimed ${c.claimed} / dead ${c.dead}）hints=${c.hints}`);
  // 阶段 + 检查矩阵：这是"测得全不全"的唯一事实来源，每轮都要摆在最显眼处
  if (summary.coverage) {
    const cov = summary.coverage;
    lines.push(`阶段=${summary.phase}（${summary.phaseLabel}）资产=${c.assets ?? 0} 本轮新增=${cov.newSincePhase}`);
    const st = summary.stages;
    if (st) {
      lines.push(`六张矩阵：信息收集 ${st.info.pct}% · 核实采集 ${st.verifyInfo.pct}% · 浅层测试 ${st.shallow.pct}% · 核实浅层 ${st.verifyShallow.pct}% · OWASP ${st.owasp.pct}% · 深层 ${st.deep.pct}%`);
      lines.push(`未测面：${summary.untested?.declared ? "已声明" : "未声明"}｜复核：${summary.reviews?.reviewed ?? 0}/${summary.reviews?.vuln ?? 0} 条漏洞事实`);
      if (cov.reflow?.pending) lines.push(`⚠ 回灌未收轮：新增 ${cov.reflow.count} 个资产（来源 ${cov.reflow.source ?? "未知"}）→ 阶段已退回 P1 起点，先再收一轮确认 0 新增，再给这批资产走 P2→P5`);
    } else {
      lines.push(`汇总位（旧口径）：浅测=${cov.shallowPct}% 深测=${cov.deepPct}% 缺口=${cov.gaps}`);
    }
    const next = summary.phase === "P5" ? "P5" : PHASES[Math.min(PHASES.length - 1, PHASES.indexOf(summary.phase) + 1)];
    lines.push(`可推进到 ${next}：${cov.canAdvanceTo?.[next] ? "是（用 bb_phase_advance）" : "否 —— 先 bb_coverage 看阻塞项"}`);
  }
  if (summary.openIntents.length) {
    lines.push("open intents（认领用 bb_intent_claim <id>）：");
    for (const i of summary.openIntents.slice(0, 6)) {
      lines.push(`  ${i.id}${i.worker ? `[${i.worker}认领中]` : ""} ${i.domain ? `(${i.domain}) ` : ""}${String(i.description).slice(0, 110)} ← ${(i.from ?? []).join(",")}`);
    }
  } else {
    lines.push("open intents: 无 —— 总控需 bb_intent_propose 提新方向，或判定目标已达成");
  }
  if (summary.recentFacts.length) {
    lines.push("最近事实：");
    for (const f of summary.recentFacts.slice(-5)) lines.push(`  ${f.id} ${String(f.description).slice(0, 110)}`);
  }
  for (const h of (summary.hints ?? []).slice(-3)) lines.push(`hint ${h.id}（${h.creator}）：${String(h.content).slice(0, 120)}`);
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "…（截断，读全图用 bb_graph）";
  return text;
}

// ── apply ───────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const store = openStore(config?.dbPath ?? DEFAULT_DB);
  const trustedHosts = () => { try { return ctx.webRuntime?.trustedHosts ?? []; } catch { return []; } };

  const needProject = (exec, { allowCreate = false, title, origin, goal, projectId } = {}) => {
    const c = resolveContext(ctx, exec, store);
    if (!c.allowed) return { error: "仅「网络安全模式」会话（或其子 agent 工作目录绑定项目后）可用黑板工具" };
    // 显式 projectId（派单时把它写进子 agent 的 prompt）优先：跨会话/多层子 agent 也不会认错图
    if (projectId) {
      const explicit = store.getProject(String(projectId));
      if (explicit) return { c, project: explicit };
      if (!allowCreate) return { error: `项目 ${projectId} 不存在` };
    }
    if (c.project) return { c, project: c.project };
    if (!allowCreate) return { error: "本项目尚未建立黑板——先调 bb_project_init 写清 origin 与 goal" };
    const project = store.createProject({ sessionId: c.id, cwd: c.cwd, title, origin, goal });
    return { c, project };
  };

  // 1) 项目初始化（origin + goal + 可选人类提示）
  ctx.tools.register(defineTool({
    name: "bb_project_init",
    description: "建立本项目黑板：写清 origin（起点：目标资产/范围）与 goal（要交付的成果）。一个会话一个项目；子 agent 共享工作目录即可读写同一张图。已存在则更新 origin/goal。",
    parameters: {
      origin: { type: "string", required: true, description: "起点：授权目标与范围（域名/IP/路径，尽量具体）" },
      goal: { type: "string", required: true, description: "终点：要交付的成果（如：拿到可复现的高危漏洞证据链 + 完整报告）" },
      title: { type: "string", description: "任务标题（默认取 origin）" },
      hint: { type: "string", description: "可选：用户原话里的关键判断，作为首条 hint 写入" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `黑板已建立：${v.project.id}（origin/goal 就位，counts=${JSON.stringify(v.counts)}）` : `建立失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const s = sessionOf(ctx, exec);
        if (s.preset !== MODE_ID && s.preset !== "") return { ok: false, error: "仅「网络安全模式」会话可建立黑板" };
        // 黑板归**顶层会话**所有：万一这一枪是子 agent 打的，也绑到父会话上，
        // 否则父会话（人看的那块面板）会找不到自己的图（一个会话一个项目）。
        const owner = s.isChild && s.parentSessionId ? s.parentSessionId : s.id;
        const project = store.ensureProject({ sessionId: owner, cwd: s.cwd, allowCwd: s.isChild, title: args.title, origin: args.origin, goal: args.goal });
        if (args.hint) store.addHint(project.id, args.hint, "Human");
        const sum = store.summary(project.id);
        return { ok: true, project: { id: project.id, title: project.title }, counts: sum.counts };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 1b) 删除作战面板（人类明确要求时用；面板上也有「删除该面板」按钮）
  ctx.tools.register(defineTool({
    name: "bb_project_delete",
    description: "**删除一整块作战面板**（项目 + 它名下的事实/意图/提示/资产/检查矩阵/未测面）。只在人类明确要求删除某轮测试时用；删除前会自动落一份库备份（blackboard.backup-<ts>.db），删失败整体回滚。删本会话的面板后需重新 bb_project_init 才能继续。",
    parameters: {
      project: { type: "string", required: true, description: "要删的项目 id（如 eng_002）；不传就删本会话绑定那块" },
      confirm: { type: "boolean", required: true, description: "必须显式 true：确认这是人类的删除意图（不可逆，只留库备份）" },
      reason: { type: "string", description: "为什么删（写进回执，便于事后追溯）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? `已删除作战面板 ${v.id}（${v.title}）：事实 ${v.deleted.facts} · 意图 ${v.deleted.intents} · 提示 ${v.deleted.hints} · 资产 ${v.deleted.assets} · 检查行 ${v.deleted.assetChecks} · 未测面 ${v.deleted.untested}\n备份：${v.backupPath ?? "（未落备份）"}`
          : `删除失败：${v.error}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        if (args.confirm !== true) return { ok: false, error: "删除不可逆：必须显式传 confirm=true（并确认这是人类的要求）" };
        const r = store.deleteProject(need.project.id);
        return r.ok ? { ...r, reason: String(args.reason ?? "") } : r;
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 2) 读全图
  ctx.tools.register(defineTool({
    name: "bb_graph",
    description: "读黑板全图：事实（含废弃）/ 意图（含 from→to 边、认领状态）/ 人类提示。总控每次 reason 前、子 agent 每次开工前都先读它。",
    parameters: {
      full: { type: "boolean", description: "true=输出全部事实与意图正文；默认紧凑（最近 20 条事实 + 全部意图）" },
      project: { type: "string", description: "项目 id（缺省=当前会话绑定的项目）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `读取失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        const g = store.graph(args.project ?? r.project.id);
        if (!g) return { ok: false, error: "项目不存在" };
        const out = [];
        out.push(`# 项目 ${g.project.id} ${g.project.title} [${g.project.status}]`);
        out.push(`origin: ${g.project.origin}`);
        out.push(`goal: ${g.project.goal}`);
        const facts = args.full ? g.facts : g.facts.slice(-20);
        out.push(`\n## 事实（${g.facts.length}）`);
        for (const f of facts) out.push(`- ${f.id} [${f.category}${f.deprecated ? "/废弃" : ""}/${f.confidence}] ${f.description}${f.evidence ? `\n    证据: ${f.evidence}` : ""}`);
        out.push(`\n## 意图（${g.intents.length}）`);
        for (const i of g.intents) {
          const state = i.dead ? "死路" : i.concluded_at ? `已结论→${i.to_fact ?? "-"}` : i.worker ? `认领中(${i.worker})` : "待认领";
          out.push(`- ${i.id} [${state}]${i.domain ? `(${i.domain})` : ""} ${i.description}\n    来自: ${(i.from ?? []).join(",") || "origin"}${i.note ? `\n    备注: ${i.note}` : ""}`);
        }
        out.push(`\n## 人类提示（${g.hints.length}）`);
        for (const h of g.hints) out.push(`- ${h.id}（${h.creator}）${h.content}`);
        return { ok: true, text: out.join("\n") };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 3) 写事实
  ctx.tools.register(defineTool({
    name: "bb_fact_add",
    description: "把一条**已确认**的客观事实写进黑板。写法：什么 + 在哪 + 如何验证 + 证据文件路径；长数据落文件、只写指针。未验证的结论写 confidence=疑似。",
    parameters: {
      description: { type: "string", required: true, description: "事实正文（客观、可验证、不含主观推测）" },
      evidence: { type: "string", description: "证据指位：请求/响应包编号、文件路径、命令回显、PoC 路径" },
      category: { type: "string", description: "分类：fact/asset/endpoint/cred/vuln/note（默认 fact）" },
      confidence: { type: "string", enum: ["confirmed", "suspected"], description: "confirmed=已验证；suspected=疑似待验" },
      source_intent: { type: "string", description: "产出该事实的意图 id（子 agent 填自己认领的 intent）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `事实已写入：${v.fact.id} ${String(v.fact.description).slice(0, 80)}` : `写入失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        const f = store.addFact(r.project.id, {
          description: args.description, evidence: args.evidence, category: args.category ?? "fact",
          confidence: args.confidence ?? "confirmed", sourceIntent: args.source_intent ?? null,
        });
        return { ok: true, fact: f };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 4) 提意图（总控）
  ctx.tools.register(defineTool({
    name: "bb_intent_propose",
    description: "总控提出新的探索方向（一个待探索方向）。每条 intent 必须是独立、可并行、高价值、不重叠的方向：写「朝哪打 + 为什么值」，不写实现细节。一次 ≤3 条；给出 from（依据的事实 id，缺省 origin）。",
    parameters: {
      intents: { type: "string", required: true, description: "JSON 数组字符串：[{\"from\":[\"f001\"],\"description\":\"...\",\"domain\":\"recon|js-reverse|api-security|web-injection|auth-logic|component-cve|app-reverse|internal-network|cloud-ai|exploit-dev\",\"priority\":1-9}]" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已提出 ${v.created.length} 条意图：${v.created.map((x) => `${x.id}(${x.domain ?? "-"})`).join("、")}` : `提出失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        let items = [];
        try { items = JSON.parse(args.intents); } catch { return { ok: false, error: "intents 必须是合法 JSON 数组字符串" }; }
        if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "至少一条意图" };
        if (items.length > 3) items = items.slice(0, 3);
        return store.proposeIntents(r.project.id, items, "orchestrator");
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 5) 认领 / 释放 / 结论
  ctx.tools.register(defineTool({
    name: "bb_intent_claim",
    description: "子 agent 认领一个意图开始探索（一个意图同时只能被一个 worker 认领）。认领后你就是这条方向的责任人。",
    parameters: {
      intent_id: { type: "string", required: true, description: "意图 id（如 i003）" },
      worker: { type: "string", description: "你的角色名（如 recon / api-security）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已认领 ${v.id}（worker=${v.worker}）` : `认领失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        return store.claimIntent(r.project.id, String(args.intent_id), String(args.worker ?? "subagent"));
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "bb_intent_release",
    description: "放弃当前认领的意图（上下文不足、需换人、或先去做别的）。释放后意图回到待认领池。",
    parameters: {
      intent_id: { type: "string", required: true, description: "意图 id" },
      note: { type: "string", description: "为何放弃（会写进图的备注）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已释放 ${v.id}` : `释放失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        return store.releaseIntent(r.project.id, String(args.intent_id), args.note ?? null);
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "bb_intent_conclude",
    description: "结论一个意图：**有收获**就写 fact_description（一条可验证的事实）；**判定死路**就 dead=true 并写 note 说明试过什么、为什么此路不通（死路也是资产，防止后人重跑）。",
    parameters: {
      intent_id: { type: "string", required: true, description: "意图 id" },
      fact_description: { type: "string", description: "产出的客观事实（dead=true 时留空）" },
      evidence: { type: "string", description: "证据指位" },
      dead: { type: "boolean", description: "true=此方向无果" },
      note: { type: "string", description: "备注：死路原因 / 未排除面" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? (v.dead ? `意图 ${v.id} 已结为死路` : `意图 ${v.id} 已结论，产出事实 ${v.fact}`) : `结论失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        const dead = Boolean(args.dead);
        if (!dead && !String(args.fact_description ?? "").trim()) {
          return { ok: false, error: "非死路结论必须给 fact_description（无收获就 dead=true）" };
        }
        return store.concludeIntent(r.project.id, String(args.intent_id), {
          factDescription: args.fact_description ?? null, evidence: args.evidence ?? null, dead, note: args.note ?? null,
        });
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 6) 事实废弃（复核员推翻错误事实）
  ctx.tools.register(defineTool({
    name: "bb_fact_deprecate",
    description: "把一条错误/被推翻的事实标记为废弃（不删除，保留痕迹）。复核员挑战成立时使用。",
    parameters: {
      fact_id: { type: "string", required: true, description: "事实 id（如 f007）" },
      reason: { type: "string", required: true, description: "推翻依据" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `事实 ${v.id} 已废弃` : `操作失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        return store.deprecateFact(r.project.id, String(args.fact_id), String(args.reason));
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 7) 人类提示
  ctx.tools.register(defineTool({
    name: "bb_hint_list",
    description: "读人类注入的提示（hint）。每次开工前读一次——用户可能在作战面板里补充了范围、凭据、禁测项。",
    parameters: {
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? (v.hints.length ? v.hints.map((h) => `${h.id}（${h.creator}）${h.content}`).join("\n") : "暂无人类提示") : `读取失败：${v.error}` }],
    },
    execute(_args, exec) {
      try {
        const r = needProject(exec, { projectId: _args.project });
        if (r.error) return { ok: false, error: r.error };
        const g = store.graph(r.project.id);
        return { ok: true, hints: g?.hints ?? [] };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "bb_hint_add",
    description: "把人类（用户）在对话中给出的关键判断写成 hint，供后续每轮读图时吸收。",
    parameters: {
      content: { type: "string", required: true, description: "提示内容（用户原话要点）" },
      creator: { type: "string", description: "来源（默认 Human）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `提示已写入：${v.id}` : `写入失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const r = needProject(exec, { projectId: args.project });
        if (r.error) return { ok: false, error: r.error };
        return store.addHint(r.project.id, String(args.content), String(args.creator ?? "Human"));
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 8) 状态摘要
  ctx.tools.register(defineTool({
    name: "bb_status",
    description: "读本项目作战状态摘要（事实/意图计数、待认领意图、最近事实）——用于向用户汇报进度或判断是否可以收尾。",
    parameters: {
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `读取失败：${v.error}` }],
    },
    execute(_args, exec) {
      try {
        const r = needProject(exec, { projectId: _args.project });
        if (r.error) return { ok: false, error: r.error };
        const s = store.summary(r.project.id);
        return { ok: true, text: renderSnapshot(s, 3000), summary: s };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 9) 角色卡：派单时把对应角色的定义读出来，拼进子 agent 的 prompt
  //    （DSH 的 subagent 是自由 prompt 派发，没有"命名子代理类型"——所以角色卡由角色目录提供，
  //     总控派单前先读卡，再按四要素组装 prompt。）
  const agentsDir = config?.agentsDir ?? defaultAgentsDir();

  ctx.tools.register(defineTool({
    name: "vore_agents_list",
    description: "列出可用角色卡（agents/*.md）：id / 名称 / 一句话职责 / 类型。派单前用它确认该派给谁。",
    parameters: {
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? (v.agents.length ? v.agents.map((a) => `${a.id}（${a.name}）${a.kind === "orchestrator" ? "[总控]" : ""} — ${a.description}`).join("\n") : `角色目录为空：${v.dir}`) : `读取失败：${v.error}` }],
    },
    execute() {
      try {
        const cards = loadAgentCards(agentsDir);
        return { ok: true, dir: agentsDir, agents: cards.map((c) => ({ id: c.id, name: c.name, description: c.description, kind: c.kind })) };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  ctx.tools.register(defineTool({
    name: "vore_agent_card",
    description: "读取一个角色卡的完整定义（正文含授权边界/输入前置条件/纪律/工作方法/黑板协议/输出格式）。派单时把它**整段拼进子 agent 的 prompt**，再补上目标标识、授权边界、唯一子目标、成功标准与 intent_id。",
    parameters: {
      role: { type: "string", required: true, description: "角色 id（如 recon / api-security / reviewer；见 vore_agents_list）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? v.text : `读取失败：${v.error}` }],
    },
    execute(args) {
      try {
        const cards = loadAgentCards(agentsDir);
        const want = String(args.role ?? "").trim().toLowerCase();
        const hit = cards.find((c) => c.id.toLowerCase() === want) ??
          cards.find((c) => c.file.toLowerCase() === `${want}.md`) ??
          cards.find((c) => c.name.includes(String(args.role ?? "")));
        if (!hit) return { ok: false, error: `未找到角色「${args.role}」；可用：${cards.map((c) => c.id).join(", ")}` };
        const text = `# 角色：${hit.name}（${hit.id}）\n> ${hit.description}\n\n${hit.body}`;
        return { ok: true, id: hit.id, name: hit.name, text };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 12) 登记资产（覆盖率的分母）
  ctx.tools.register(defineTool({
    name: "bb_asset_add",
    description: "把发现的资产批量登记进黑板资产清单（幂等 upsert）。**未登记的资产等于没测**：浅层/中间层/深层四张检查矩阵都以这份清单为分母。子 agent（recon/js-reverse/指纹/模糊）拿到新域名、子域、IP:端口、URL、接口路径、JS 文件、仓库、凭据、云资源都要立刻登记。priority < 3 的资产必须用 notes 写明理由（否则拒绝登记）。",
    parameters: {
      assets: {
        type: "array", required: true,
        description: "资产数组；每项 {kind, value, label?, tech?, priority?, notes?}。kind ∈ domain|subdomain|ip|port|service|url|endpoint|js|repo|cred|cloud|app|other",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", required: true, description: "资产类别" },
            value: { type: "string", required: true, description: "规范化的唯一值：域名 / IP:端口 / 完整 URL / 接口路径 / JS 文件 URL" },
            label: { type: "string", description: "人类可读名字（默认取 value）" },
            tech: { type: "string", description: "指纹信息：中间件/框架/语言/版本/组件（如 nginx 1.24 / Spring Boot 2.7）" },
            priority: { type: "number", description: "1..5，深测排序（默认 3；入口/后台/带参接口给 4-5）" },
            notes: { type: "string", description: "备注" },
          },
        },
      },
      source: { type: "string", description: "来源标注：recon / js-reverse / fingerprint / fuzz / hint 等" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? [
            `新增 ${v.addedCount} 个、更新 ${v.updatedCount} 个资产（当前共 ${v.total} 个；信息收集完成 ${v.infoPct}%，深层完成 ${v.deepPct}%）`,
            v.skippedCount ? `⚠️ 跳过 ${v.skippedCount} 个：\n- ${v.skipped.join("\n- ")}` : "",
            v.addedCount > 0 ? `注意：新资产进入清单后六张矩阵缺口同时出现，且阶段**退回 P1 起点**（面还没穷尽）—— 先 bb_coverage {endRound:true} 再收一轮确认 0 新增，然后给这批新资产逐项补 bb_asset_check（P2 信息收集 → P3 核实+浅层测试 → P4 核实+OWASP → P5 深层）。` : "",
          ].filter(Boolean).join("\n")
          : `登记失败：${v.error}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const items = Array.isArray(args.assets) ? args.assets : [];
        if (!items.length) return { ok: false, error: "assets 为空数组" };
        const r = store.upsertAssets(need.project.id, items, args.source ?? "unknown");
        const cov = store.coverage(need.project.id);
        return {
          ok: true, added: r.added, updated: r.updated, skipped: r.skipped ?? [], addedCount: r.addedCount, updatedCount: r.updatedCount, skippedCount: r.skippedCount ?? 0,
          total: cov.counts.assets, infoPct: cov.stages.info.pct, deepPct: cov.stages.deep.pct, shallowPct: cov.pct.shallow,
          phase: cov.phase, reflow: cov.reflow, nextStep: r.addedCount > 0 ? "回灌：阶段已退回 P1 起点，需再收一轮 + 补六张矩阵" : "无需回灌",
        };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 13) 查资产清单
  ctx.tools.register(defineTool({
    name: "bb_assets",
    description: "列资产清单（可按类别/浅测汇总位/深测汇总位/优先级筛选），并给出每个资产的**检查矩阵完成度**（info 浅层 / verify 核验 / owasp A01–A10 / deep 深层）。派单前用它把「这一单要覆盖哪些资产、补哪些检查项」写清楚；收尾前用它确认没有漏测资产。",
    parameters: {
      kind: { type: "string", description: "只看某类资产（domain/subdomain/url/endpoint/js…）" },
      s2: { type: "string", description: "浅测汇总位过滤：pending|doing|done|na" },
      s3: { type: "string", description: "深测汇总位过滤：pending|doing|done|na" },
      priorityMin: { type: "number", description: "只看优先级 ≥ 该值的资产" },
      onlyGaps: { type: "boolean", description: "只要有缺口的（检查矩阵必查项还没结论）" },
      limit: { type: "number", description: "最多返回条数（默认 200，上限 2000）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? `资产 ${v.assets.length} 条${v.total !== v.assets.length ? `（共 ${v.total} 条，已截断）` : ""}：\n` +
            v.assets.map((a) => {
              const cs = a.checkSummary;
              const prog = cs ? `｜info ${cs.info.done}/${cs.info.required} verify ${cs.verify.done}/${cs.verify.required} owasp ${cs.owasp.done}/${cs.owasp.required} deep ${cs.deep.done}/${cs.deep.required}` : "";
              return `${a.id} [${a.kind}] ${String(a.value).slice(0, 70)}｜p${a.priority}${prog}${a.tech ? `｜${String(a.tech).slice(0, 40)}` : ""}`;
            }).join("\n")
          : `读取失败：${v.error}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const assets = store.listAssets(need.project.id, args ?? {});
        const cov = store.coverage(need.project.id);
        return { ok: true, assets, total: cov.counts.assets };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 14) 更新资产（指纹/优先级/汇总位）——**逐项测试结果用 bb_asset_check 登记**
  ctx.tools.register(defineTool({
    name: "bb_asset_update",
    description: "更新单个资产的指纹、优先级、备注；`s2`/`s3` 是**汇总位**（由检查矩阵自动同步，一般不用手写）。**逐项测试结果请用 bb_asset_check 登记**（info/verify/owasp/deep 四张矩阵）——阶段门只看矩阵，不看这两个汇总位。确实不适用时手写 `na` 必须带 notes 理由。",
    parameters: {
      id: { type: "string", description: "资产 id（如 a012）；与 kind+value 二选一" },
      kind: { type: "string", description: "资产类别（与 value 一起定位）" },
      value: { type: "string", description: "资产唯一值（与 kind 一起定位）" },
      tech: { type: "string", description: "指纹信息（技术栈/中间件/OS/版本，浅层 info.tech 的证据落在这里）" },
      priority: { type: "number", description: "1..5（<3 = 不要求深层，登记时必须给理由）" },
      s2: { type: "string", description: "浅层汇总位：pending|doing|done|na（一般由检查矩阵自动同步）" },
      s3: { type: "string", description: "深层汇总位：pending|doing|done|na（一般由检查矩阵自动同步）" },
      evidence: { type: "string", description: "证据指位（事实 id / 文件路径 / 请求响应记录）" },
      notes: { type: "string", description: "备注。**标 na 或降级到 priority<3 时必填且要能复核**（机器强制：不带理由会拒绝）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? `资产 ${v.id} 已更新：汇总位 浅层=${v.s2} 深层=${v.s3}${v.coverage ? `（info ${v.coverage.stages?.info?.pct ?? "-"}% · verify ${v.coverage.stages?.verify?.pct ?? "-"}% · owasp ${v.coverage.stages?.owasp?.pct ?? "-"}% · deep ${v.coverage.stages?.deep?.pct ?? "-"}%，缺项用 bb_asset_check 补）` : ""}`
          : `更新失败：${v.error}${v.hint ? `\n提示：${v.hint}` : ""}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const ref = args.id ? { id: args.id } : { kind: args.kind, value: args.value };
        const r = store.updateAsset(need.project.id, ref, args);
        if (!r.ok) return { ok: false, error: r.error, hint: r.hint };
        const cov = store.coverage(need.project.id);
        return { ok: true, id: r.id, s2: r.s2, s3: r.s3, coverage: { pct: cov.pct, counts: cov.counts, blockers: cov.blockers } };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 15) 覆盖率 / 阶段门 / 收轮
  ctx.tools.register(defineTool({
    name: "bb_coverage",
    description: "看覆盖率与阶段门：当前阶段、**四张检查矩阵**（info 浅层信息采集 / verify 中间层信息核验 / owasp 中间层 A01–A10 / deep 深层漏洞验证）的完成度与缺口、未测面、复核进度，以及「能不能进入下一阶段」的阻塞项。每轮 reason 都要读它。收一轮资产收集用 {endRound:true}（饱和判据 = 连续一轮 0 新增）；确认某类来源已穷尽用 {sourceExhausted:[...]}；未测面登记完用 {declareUntested:true} 显式声明。",
    parameters: {
      endRound: { type: "boolean", description: "收一轮资产收集：记录本轮新增数并重置轮次标记" },
      note: { type: "string", description: "收轮备注（本轮跑了哪些来源）" },
      sourceExhausted: { type: "array", description: "标记已穷尽的来源类别（domain/subdomain/ip/port/url/endpoint/js）", items: { type: "string" } },
      declareUntested: { type: "boolean", description: "显式声明「未测面已经登记完」（P5 成果阶段的门禁条件之一）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? [
            `阶段 ${v.phase}（${v.phaseLabel}）｜资产 ${v.counts.assets}`,
            `浅层 info：${v.stages.info.pct}%（${v.stages.info.done}/${v.stages.info.required}）｜中间层 verify：${v.stages.verify.pct}%（${v.stages.verify.done}/${v.stages.verify.required}）｜中间层 OWASP：${v.stages.owasp.pct}%（${v.stages.owasp.done}/${v.stages.owasp.required}）｜深层 deep：${v.stages.deep.pct}%（${v.stages.deep.done}/${v.stages.deep.required}，只算 priority ≥ 3）`,
            `汇总位：浅测 s2 ${v.counts.shallowDone}/${v.counts.assets}｜深测 s3 ${v.counts.deepDone}/${v.counts.deepTargets}${v.counts.naNoReason ? `｜⚠️ ${v.counts.naNoReason} 个 na 没写理由` : ""}`,
            `未测面：${v.untested.declared ? "已显式声明" : "**尚未声明**"}${v.untested.count ? `（${v.untested.count} 条）` : ""}｜复核：${v.reviews.reviewed}/${v.reviews.vuln} 条漏洞事实${v.reviews.challenged ? `（其中 ${v.reviews.challenged} 条被挑战）` : ""}`,
            `收集轮次：已确认 ${v.recon.rounds} 轮，上一轮新增 ${v.recon.lastAdded < 0 ? "（还没收轮）" : v.recon.lastAdded} 个，本轮累计新增 ${v.recon.addedThisRound} 个`,
            v.sourcesMissing.length ? `来源缺口：${v.sourcesMissing.join(", ")}` : "来源类别：齐",
            v.reflow?.pending ? `⚠ 回灌未收轮：新增 ${v.reflow.count} 个资产（来源 ${v.reflow.source ?? "未知"}）→ 已退回 P1 起点；先 bb_coverage {endRound:true} 再收一轮确认 0 新增` : (v.reflow?.count ? `回灌累计：${v.reflow.count} 个资产（来源 ${v.reflow.source ?? "-"}；已收轮确认）` : ""),
            v.round ? `本轮收集结果：新增 ${v.round.addedThisRound} 个 → ${v.round.saturated ? "已饱和" : "未饱和，继续收集"}` : "",
            v.blockers.length ? `推进阻塞（进入 ${v.next}）：\n- ${v.blockers.join("\n- ")}` : `无阻塞：可以推进到 ${v.next}`,
            v.stages.info.gaps.length ? `浅层缺口示例：${v.stages.info.gaps.slice(0, 6).map((g) => `${g.assetId}:${g.key}`).join("；")}` : "",
            v.stages.deep.gaps.length ? `深层缺口示例：${v.stages.deep.gaps.slice(0, 6).map((g) => `${g.assetId}:${g.key}`).join("；")}` : "",
          ].filter(Boolean).join("\n")
          : `读取失败：${v.error}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        let round = null;
        if (args.endRound) round = store.endReconRound(need.project.id, args.note ?? "");
        if (Array.isArray(args.sourceExhausted) && args.sourceExhausted.length) store.markSourceExhausted(need.project.id, args.sourceExhausted);
        let declared = null;
        if (args.declareUntested) declared = store.declareUntested(need.project.id, args.note ?? "");
        const cov = store.coverage(need.project.id);
        const next = cov.phase === "P5" ? "P5" : PHASES[Math.min(PHASES.length - 1, PHASES.indexOf(cov.phase) + 1)];
        const upto = PHASES.slice(0, PHASES.indexOf(next)).map((p) => cov.blockers[p] ?? []);
        const blockers = upto.flat();
        return { ok: true, ...cov, round, declared, next, blockers, canAdvance: cov.canAdvanceTo[next] ?? true };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 15.1) 检查矩阵：登记一条"这条资产在这个阶段做了什么"
  ctx.tools.register(defineTool({
    name: "bb_asset_check",
    description: "登记一条检查结果（**覆盖率的真实判据**）。stage=info 浅层信息采集（key 如 jsrev/lang/middleware/os/arch/dirs/paths/cert/dns/waf/third/sec…）；stage=verify 中间层核验（ok=与行为一致 / wrong=浅层采错了 / unknown=没法核验）；stage=owasp 中间层 OWASP Top 10（A01–A10）；stage=deep 深层漏洞验证（unauth/authz/inj/ssrf/upload/logic/race/deser）。na/wrong/unknown 必须写 note 理由，hit 必须给 evidence。",
    parameters: {
      asset: { type: "string", description: "资产定位：资产 id（a001）或 kind+value 组合中的 id" },
      asset_id: { type: "string", description: "资产 id（与 asset 二选一）" },
      kind: { type: "string", description: "资产类别（配合 value 定位）" },
      value: { type: "string", description: "资产唯一值（配合 kind 定位）" },
      stage: { type: "string", description: "info | verifyInfo | shallow | verifyShallow | owasp | deep", required: true },
      key: { type: "string", description: "检查项：info/verifyInfo 用信息项 key；shallow/verifyShallow 用 8 项（fp/pathTruth/params/authEdge/errLeak/expose/lowFuzz/compHint）；owasp 用 A01–A10；deep 用类别 key", required: true },
      status: { type: "string", description: "info: done|na|doing；verifyInfo/verifyShallow: ok|wrong|unknown|na；shallow/owasp/deep: done|hit|na", required: true },
      evidence: { type: "string", description: "证据指位（请求/响应文件、事实 id、脚本路径）；hit 必填" },
      note: { type: "string", description: "理由/结论（na、wrong、unknown 必填）" },
      reviewed: { type: "boolean", description: "该条是否已被**下一步**独立复算过（上一层的 wrong 与中间层的 OWASP 结论都必须在深层核验并置 true）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? `已登记 ${v.asset} 的 ${v.stage}.${v.key} = ${v.status}${v.summary ? `｜该资产：信息收集 ${v.summary.info.done}/${v.summary.info.required} · 核实采集 ${v.summary.verifyInfo.done}/${v.summary.verifyInfo.required} · 浅层测试 ${v.summary.shallow.done}/${v.summary.shallow.required} · 核实浅层 ${v.summary.verifyShallow.done}/${v.summary.verifyShallow.required} · OWASP ${v.summary.owasp.done}/${v.summary.owasp.required} · 深层 ${v.summary.deep.done}/${v.summary.deep.required}` : ""}`
          : `登记失败：${v.error}${v.hint ? `\n提示：${v.hint}` : ""}${v.allowed ? `\n该 stage 合法 key：${v.allowed.join(", ")}` : ""}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const ref = args.asset_id || args.asset ? { id: args.asset_id ?? args.asset } : { kind: args.kind, value: args.value };
        const r = store.setCheck(need.project.id, ref, {
          stage: args.stage, key: args.key, status: args.status,
          evidence: args.evidence ?? null, note: args.note ?? null, reviewed: Boolean(args.reviewed),
        });
        if (!r.ok) return r;
        return { ok: true, ...r };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 15.2) 查看检查矩阵
  ctx.tools.register(defineTool({
    name: "bb_asset_checks",
    description: "查看检查矩阵：某资产（或全部资产）在四个 stage 上登记了什么、还缺什么。派单前用它把「这一单要补哪些检查项」写清楚；收尾前用它确认没有漏项。",
    parameters: {
      asset: { type: "string", description: "资产 id（不填=全部资产）" },
      stage: { type: "string", description: "只看某个 stage（info|verify|owasp|deep）" },
      onlyGaps: { type: "boolean", description: "只列缺口（必查项还没结论的）" },
      limit: { type: "number", description: "最多列多少个资产（默认 50）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? [
            `资产 ${v.assets.length} 个${v.stage ? `（stage=${v.stage}）` : ""}${v.onlyGaps ? "（只列有缺口的）" : ""}｜覆盖：info ${v.pct.info}% · verify ${v.pct.verify}% · owasp ${v.pct.owasp}% · deep ${v.pct.deep}%`,
            ...v.lines,
          ].join("\n")
          : `读取失败：${v.error}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const all = store.listAssets(need.project.id, { limit: 2000 });
        const rows = args.asset ? all.filter((a) => a.id === String(args.asset) || a.value === String(args.asset)) : all;
        const stage = args.stage ? String(args.stage).toLowerCase() : null;
        const scoped = args.onlyGaps
          ? rows.filter((a) => (stage ? a.checkSummary[stage]?.missing.length : CHECK_STAGES.some((s) => a.checkSummary[s].missing.length)))
          : rows;
        const shown = scoped.slice(0, Math.max(1, Math.min(200, Number(args.limit) || 50)));
        const total = (s) => rows.reduce((acc, a) => acc + (a.checkSummary[s]?.required ?? 0), 0);
        const done = (s) => rows.reduce((acc, a) => acc + (a.checkSummary[s]?.done ?? 0), 0);
        const p = (s) => (total(s) === 0 ? 100 : Math.round((done(s) / total(s)) * 100));
        return {
          ok: true, stage, onlyGaps: Boolean(args.onlyGaps),
          assets: shown.map((a) => ({ id: a.id, kind: a.kind, value: a.value, checks: a.checks, checkSummary: a.checkSummary })),
          pct: Object.fromEntries(CHECK_STAGES.map((s) => [s, p(s)])),
          lines: shown.map((a) => {
            const parts = CHECK_STAGES.map((s) => `${s} ${a.checkSummary[s]?.done ?? 0}/${a.checkSummary[s]?.required ?? 0}`).join(" · ");
            const miss = CHECK_STAGES.filter((s) => (a.checkSummary[s]?.missing ?? []).length)
              .map((s) => `${s}缺 ${a.checkSummary[s].missing.slice(0, 6).join("/")}${a.checkSummary[s].missing.length > 6 ? "…" : ""}`).join("；");
            return `${a.id} [${a.kind}] ${String(a.value).slice(0, 60)}｜${parts}${miss ? `｜${miss}` : ""}`;
          }),
        };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 15.3) 未测面账本
  ctx.tools.register(defineTool({
    name: "bb_untested_add",
    description: "登记**未测面**（没做/做不了的面）：与「死路」不同——死路是试过没成，这里是压根没做。必须写清 why（为什么没做/做不了：缺凭据、缺授权、环境限制、超出本轮范围…）。进入 P5（成果）前必须把所有未测面登记完并显式声明。",
    parameters: {
      surface: { type: "string", description: "哪个面没测（资产/接口/功能/协议/客户端…尽量具体）", required: true },
      why: { type: "string", description: "为什么没做/做不了（至少 4 字，要能被人复核）", required: true },
      stage: { type: "string", description: "它属于哪个阶段（P1–P6，可空）" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已登记未测面 ${v.id}：${v.surface}` : `登记失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const r = store.addUntested(need.project.id, { surface: args.surface, why: args.why, stage: args.stage ?? null });
        if (!r.ok) return r;
        return { ok: true, ...r, total: store.listUntested(need.project.id).length };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 15.4) 事实复核（独立复核员）
  ctx.tools.register(defineTool({
    name: "bb_fact_review",
    description: "复核一条事实（独立复核员用）：confirm=独立复算后确认；challenge=复算发现不成立/口径有误（随后应 bb_fact_deprecate 或改写）。必须给 evidence（你自己复算的报文/脚本路径）。进入 P5 前每条漏洞事实都要有复核记录。",
    parameters: {
      fact_id: { type: "string", description: "事实 id（f001）", required: true },
      verdict: { type: "string", description: "confirm | challenge", required: true },
      evidence: { type: "string", description: "独立复算的证据指位（必填）", required: true },
      note: { type: "string", description: "差异清单/挑战理由" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{ type: "text", text: v.ok ? `已复核 ${v.id}：${v.verdict === "confirm" ? "确认" : "挑战"}` : `复核失败：${v.error}` }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const r = store.reviewFact(need.project.id, args.fact_id, { verdict: args.verdict, evidence: args.evidence, note: args.note ?? null });
        if (!r.ok) return r;
        return { ok: true, ...r, reviews: store.coverage(need.project.id).reviews };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // 16) 推进阶段（门禁不放行就拒绝）
  ctx.tools.register(defineTool({
    name: "bb_phase_advance",
    description: "推进作业阶段：P1 起点（资产收集到饱和）→ P2 信息收集（逐资产信息全采）→ P3 浅层（核实信息收集的工作 + 浅层测试 8 项）→ P4 中间层（核实浅层的工作 + OWASP Top 10 A01–A10）→ P5 深层（读全量信息 + 核验中间层 + 逐资产漏洞验证）→ P6 成果（报告 + 未测面声明 + 复核）。**门禁不满足会拒绝并列出缺口**；只有人类明确要求跳阶段时才用 force=true 并写明 reason。",
    parameters: {
      to: { type: "string", description: "目标阶段 P2（信息收集）/P3（浅层）/P4（中间层）/P5（深层）/P6（成果）；缺省 = 下一个" },
      force: { type: "boolean", description: "人类明确要求跳阶段时才允许" },
      reason: { type: "string", description: "force 时必填：谁、何时、为何要求跳阶段" },
      project: { type: "string", description: "项目 id（缺省=本会话 / 父会话绑定的项目；派单时显式传给子 agent 最稳）" },
    },
    output: {
      schema: { type: "object", additionalProperties: true, properties: { ok: { type: "boolean", required: true } } },
      render: (_a, v) => [{
        type: "text",
        text: v.ok
          ? `已进入 ${v.phase}（${v.phaseLabel}）${v.forced ? "（强制跳阶段，已记录依据）" : ""}`
          : `不能推进：${v.error}${v.blockers?.length ? `\n缺口：\n- ${v.blockers.join("\n- ")}` : ""}${v.hint ? `\n${v.hint}` : ""}`,
      }],
    },
    execute(args, exec) {
      try {
        const need = needProject(exec, { projectId: args.project });
        if (need.error) return { ok: false, error: need.error };
        const r = store.advancePhase(need.project.id, args.to, { force: Boolean(args.force), reason: args.reason ?? "" });
        if (!r.ok) return { ok: false, error: r.error, blockers: r.blockers, hint: r.hint };
        return { ok: true, phase: r.phase, phaseLabel: r.phaseLabel, forced: r.forced };
      } catch (e) { return { ok: false, error: e?.message ?? String(e) }; }
    },
  }));

  // ── 逐轮图快照注入（Observe：每一步都能看到全图态势）──────────────────────
  ctx.systemPrompt.context({
    name: "vore-blackboard",
    order: 520,
    text: (assembly) => {
      const agent = assembly?.agent;
      if (!agent) return "";
      try {
        const preset = presetOf(ctx, agent);
        const sessionId = agent?.session?.id;
        const header = agent?.session?.header ?? {};
        const cwd = header?.cwd;
        if (preset !== MODE_ID && preset !== "") return "";
        // 与 resolveContext 同一套口径：顶层会话只认自己的项目（不看工作目录），子 agent 才回退。
        // 否则新会话一开就把"上一个会话的项目快照"塞进系统提示，模型会以为自己接着在测上一个目标。
        const depth = Number(header?.delegationDepth ?? 0);
        const isChild = header?.origin === "subagent" || (Number.isFinite(depth) && depth > 0);
        const project = store.findProject({ sessionId, cwd, allowCwd: isChild })
          ?? (isChild && typeof header?.parentSession === "string" ? store.findProject({ sessionId: header.parentSession }) : null);
        if (!project) return "";
        return renderSnapshot(store.summary(project.id));
      } catch { return ""; }
    },
  });

  // ── 作战面板 HTTP 通道 ────────────────────────────────────────────────────
  // 面板请求的项目解析顺序：显式 projectId > 请求里的 sessionId 对应项目 > **空（本会话还没有黑板）**。
  //
  // **不再有"最近更新的非空项目"这一档**：那一档会让新会话（还没建黑板）的面板直接端出上一次
  // 测试的项目 —— 用户看到的正是"新开会话没建黑板，面板里还是上一个会话的项目"（真实反馈）。
  // 现在一个会话一个项目：本会话没有黑板时，面板显示"本会话还没有黑板" + 可选的历史项目清单
  // （要点开看，就显式传 projectId —— 谁也不会认错图）。
  const projectIsEmpty = (p) => {
    if ((p.fact_count ?? 0) > 0 || (p.intent_count ?? 0) > 0 || (p.hint_count ?? 0) > 0) return false;
    try { return store.listAssets(p.id, { limit: 1 }).length === 0; } catch { return true; }
  };
  const resolvePanelProject = (payload) => {
    if (payload.projectId) return { id: String(payload.projectId), source: "explicit" };
    const sid = typeof payload.sessionId === "string" && payload.sessionId.trim() ? payload.sessionId.trim() : null;
    if (sid) {
      const bySession = store.findProject({ sessionId: sid, allowCwd: false });
      if (bySession) return { id: bySession.id, source: "session" };
      return { id: null, source: "none" };
    }
    return { id: null, source: "unbound" };
  };
  /** 面板顶栏「按会话分类」用的清单：每个项目带上绑定的会话、阶段、进度 */
  const projectsForPanel = (sessionId) => {
    const mine = sessionId ? store.findProject({ sessionId, allowCwd: false }) : null;
    return store.listProjects().map((p) => {
      let coverage = null;
      try { coverage = store.coverage(p.id); } catch { coverage = null; }
      return {
        id: p.id, title: p.title, origin: p.origin, goal: p.goal, status: p.status,
        sessionId: p.session_id ?? null, cwd: p.cwd ?? null,
        createdAt: p.created_at ?? null, updatedAt: p.updated_at ?? null,
        phase: coverage?.phase ?? null, phaseLabel: coverage?.phaseLabel ?? null,
        counts: {
          facts: p.fact_count ?? 0, intents: p.intent_count ?? 0, open: p.open_count ?? 0,
          hints: p.hint_count ?? 0, assets: p.asset_count ?? 0,
        },
        empty: projectIsEmpty(p),
        mine: mine ? p.id === mine.id : false,
      };
    });
  };
  const dispatch = async (endpoint, payload) => {
    const pid = payload.projectId ?? null;
    const scopedId = () => resolvePanelProject(payload);
    switch (endpoint) {
      case "list":
        return { ok: true, projects: projectsForPanel(payload.sessionId ?? null) };
      // 面板顶栏的「按会话分类」清单：mineId = 本会话绑定的项目（没有则 null）
      case "projects": {
        const sid = typeof payload.sessionId === "string" && payload.sessionId.trim() ? payload.sessionId.trim() : null;
        const rows = projectsForPanel(sid);
        return { ok: true, sessionId: sid, mineId: rows.find((p) => p.mine)?.id ?? null, projects: rows };
      }
      case "graph": {
        const scoped = scopedId();
        if (!scoped.id) return { ok: true, graph: null, scope: scoped };
        return { ok: true, graph: store.graph(scoped.id), scope: scoped };
      }
      case "status": {
        const scoped = scopedId();
        if (!scoped.id) return { ok: true, summary: null, scope: scoped };
        return { ok: true, summary: store.summary(scoped.id), scope: scoped };
      }
      // 作战面板「覆盖矩阵」分栏用：资产清单 + 覆盖率/阶段门
      case "assets": {
        const scoped = scopedId();
        if (!scoped.id) return { ok: true, assets: [], scope: scoped };
        return { ok: true, assets: store.listAssets(scoped.id, { kind: payload.kind, s2: payload.s2, s3: payload.s3, onlyGaps: Boolean(payload.onlyGaps), limit: payload.limit ?? 500 }), scope: scoped };
      }
      case "coverage": {
        const scoped = scopedId();
        if (!scoped.id) return { ok: true, coverage: null, assets: [], scope: scoped };
        return { ok: true, coverage: store.coverage(scoped.id), assets: store.listAssets(scoped.id, { limit: 500 }), scope: scoped };
      }
      // 面板「覆盖矩阵」的第二入口：只要检查矩阵（可按资产/stage/缺口筛）
      case "checks": {
        const scoped = scopedId();
        if (!scoped.id) return { ok: true, checks: [], assets: [], scope: scoped };
        return {
          ok: true,
          checks: store.listChecks(scoped.id, { assetId: payload.assetId ?? null, stage: payload.stage ?? null }),
          assets: store.listAssets(scoped.id, { onlyGaps: Boolean(payload.onlyGaps), limit: payload.limit ?? 500 }),
          scope: scoped,
        };
      }
      case "hint.add": {
        const id = pid ?? scopedId().id;
        if (!id) return { ok: false, error: "projectId required" };
        return store.addHint(id, String(payload.content ?? ""), String(payload.creator ?? "Human"));
      }
      case "intent.drop": {
        const id = pid ?? scopedId().id;
        if (!id) return { ok: false, error: "projectId required" };
        return store.dropIntent(id, String(payload.intentId ?? ""), payload.note ? String(payload.note) : "面板取消");
      }
      case "project.create": {
        const p = store.createProject({
          sessionId: payload.sessionId ?? null, cwd: payload.cwd ?? null,
          title: payload.title, origin: payload.origin, goal: payload.goal,
        });
        return { ok: true, project: p };
      }
      // 面板「删除该面板」：删掉当前这块作战面板（项目 + 它名下的一切）。
      // 删除前 store 会先落一份一致性备份（VACUUM INTO），删失败整体回滚。
      case "project.delete": {
        const target = payload.projectId ?? scopedId().id;
        if (!target) return { ok: false, error: "projectId required（要删哪一块面板？）" };
        const r = store.deleteProject(target);
        if (!r.ok) return r;
        return { ok: true, deleted: r.deleted, title: r.title, backupPath: r.backupPath };
      }
      default:
        throw new Error(`unknown endpoint ${endpoint}`);
    }
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      if (!isTrustedRequest(req, trustedHosts())) { res.writeHead(403); res.end("forbidden"); return; }
      let pathname = "";
      try { pathname = new URL(req.url ?? "/", "http://x").pathname; } catch { pathname = ""; }
      if (req.method === "GET" && pathname === ROUTE_PATH + "/csrf") { send(200, { token: CSRF_TOKEN }); return; }
      if (req.method !== "POST") { res.writeHead(405); res.end("method not allowed"); return; }
      if (!checkCsrf(req)) { res.writeHead(403); res.end("csrf token missing or invalid"); return; }
      let endpoint = "";
      try { endpoint = decodeURIComponent(pathname.slice(ROUTE_PATH.length)).replace(/^\/+/, ""); } catch { endpoint = ""; }
      try {
        const raw = await readBody(req);
        const payload = raw === "" ? {} : JSON.parse(raw);
        send(200, await dispatch(endpoint, payload));
      } catch (e) {
        send(400, { ok: false, error: e?.message ?? String(e) });
      }
    },
  }), "vore-blackboard: web route");
}

export { openStore };
