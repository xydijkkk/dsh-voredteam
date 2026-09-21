// 面板**带数据渲染**回归测试：用迷你 React（支持 state/effect/memo/ref + 重渲染）
// 把 vore-console 的 bundle 真跑一遍：mount → 异步取数 → 重渲染 → 三个分栏逐个激活，
// 断言每个分栏都能出文本（而不是空白），并捕获任何渲染期异常。
//
// 为什么需要：vm 装载测试只渲染首帧（空态），首帧正常 ≠ 有数据时正常；
// 组件在数据到达后的某次渲染里抛错，在真实 React 里表现为**整块面板空白**——正是线上最容易踩的坑。
//
// 运行：node --no-warnings plugins/vore-console/tests/panel-render.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, "..", "lib", "client.js");
const FIXTURE = path.join(HERE, "fixtures", "live-blackboard.json");

let pass = 0, fail = 0;
// 必须是 await 的：断言体里有 async 用例，不 await 的话断言抛错只会变成
// 未处理的 rejection，而 pass 已经被计数 —— 假绿。
const ok = async (label, fn) => {
  try { await fn(); pass++; console.log(`  \u2713 ${label}`); }
  catch (e) { fail++; console.log(`  \u2717 ${label}\n      ${e.message}`); }
};

// ── 迷你 React：够这个组件用（函数组件 + hooks + 重渲染）────────────────────
function createMiniReact() {
  let current = null; // 当前渲染中的组件实例
  const scheduleRerender = (inst) => {
    if (inst.dirty) return;
    inst.dirty = true;
    queueMicrotask(() => { inst.dirty = false; render(inst); });
  };
  function render(inst) {
    current = inst;
    inst.hookIndex = 0;
    try {
      inst.tree = inst.type(inst.props);
      inst.error = null;
    } catch (e) {
      // 真实 React 里渲染期抛错 → 整块子树被卸载（表现为面板空白）。这里如实记录。
      inst.error = e;
    } finally {
      current = null;
      // **hook 数量必须逐帧一致**（React 的规则）：真实 React 违反它会报 error #310
      // ——「Rendered more hooks than during the previous render」，浏览器里就是整块空白。
      // 迷你 React 不做这个检查，所以必须在这里显式补上（本用例就是为一次真实事故加的：
      // 面板把 `useMemo(computeLayout)` 写在了 `if (!graph) return …` 之后）。
      const now = inst.hookIndex;
      if (inst.hookCount !== undefined && inst.hookCount !== now && !inst.error) {
        inst.hookViolation = { prev: inst.hookCount, now };
      }
      inst.hookCount = now;
    }
  }
  const hookSlot = () => {
    const inst = current;
    if (!inst) throw new Error("hook 在组件外调用");
    const i = inst.hookIndex++;
    if (inst.hooks.length <= i) inst.hooks.push({});
    return { inst, slot: inst.hooks[i], index: i };
  };
  const React = {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      const merged = Object.assign({}, props ?? {});
      if (children.length) merged.children = children.length === 1 ? children[0] : children;
      return { type, props: merged, children };
    },
    useState(init) {
      const { inst, slot } = hookSlot();
      if (!("value" in slot)) slot.value = typeof init === "function" ? init() : init;
      slot.setter = slot.setter ?? ((v) => {
        const next = typeof v === "function" ? v(slot.value) : v;
        if (Object.is(next, slot.value)) return;
        slot.value = next;
        scheduleRerender(inst);
      });
      return [slot.value, slot.setter];
    },
    useRef(v) {
      const { slot } = hookSlot();
      if (!("ref" in slot)) slot.ref = { current: v };
      return slot.ref;
    },
    useCallback(fn, deps) {
      const { slot } = hookSlot();
      if (!slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i]))) { slot.fn = fn; slot.deps = deps ? [...deps] : null; }
      return slot.fn;
    },
    useMemo(fn, deps) {
      const { slot } = hookSlot();
      if (!slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i]))) { slot.value = fn(); slot.deps = deps ? [...deps] : null; }
      return slot.value;
    },
    useEffect(fn, deps) {
      const { slot } = hookSlot();
      const changed = !slot.deps || !deps || deps.some((d, i) => !Object.is(d, slot.deps[i]));
      if (changed) { slot.pending = fn; slot.deps = deps ? [...deps] : null; }
    },
  };
  function mount(type, props) {
    const inst = { type, props, hooks: [], hookIndex: 0, dirty: false, tree: null };
    render(inst);
    // 跑 effect（同步执行，异步部分由测试 await）
    for (const slot of inst.hooks) { if (slot.pending) { slot.cleanup = slot.pending(); slot.pending = null; } }
    return inst;
  }
  return { React, mount, render };
}

/** 把渲染树摊平成文本（跳函数/组件，只取真的元素与字符串）。 */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out; }
  if (typeof node.type === "function") { textOf(node.props?.children, out); return out; }
  textOf(node.props?.children, out);
  return out;
}
function findByClass(node, cls, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) findByClass(n, cls, out); return out; }
  const className = node.props?.className ?? node.className;
  if (typeof className === "string" && className.split(/\s+/).includes(cls)) out.push({ ...node, className });
  findByClass(node.props?.children, cls, out);
  return out;
}
/** 点某个分栏标签。 */
function clickTab(inst, label) {
  const buttons = findByClass(inst.tree, "dsh-vc-tab");
  const btn = buttons.find((b) => textOf(b).join("") === label);
  if (!btn) throw new Error(`找不到分栏「${label}」，实际：${buttons.map((b) => textOf(b).join("")).join(" / ")}`);
  btn.props.onClick();
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const code = fs.readFileSync(BUNDLE, "utf8");

console.log("面板带数据渲染（迷你 React 真跑组件）");

const graph = fixture.graph;
const status = fixture.status;
const coverage = fixture.coverage;
const assets = fixture.assets;

// 旧宿主：/coverage 还是四阶段的老契约（没有 stages/untested/reviews，资产也没有 checks）
const legacyCoverage = {
  ok: true,
  coverage: {
    phase: "P2",
    phaseLabel: "P2 浅测",
    recon: { rounds: 1, lastAdded: 2, addedThisRound: 2, markEpoch: 1, assetEpoch: 1 },
    sourcesMissing: [],
    counts: { assets: 6, shallowDone: 5, deepTargets: 5, deepDone: 3, gaps: 3, naShallow: 0, naDeep: 1, naNoReason: 0 },
    pct: { shallow: 83, deep: 60, shallowTested: 83, deepTested: 40 },
    blockers: { P1: [], P2: [] },
    canAdvanceTo: { P2: true, P3: false, P4: false },
    gaps: fixture.coverage.coverage.gaps,
  },
  assets: fixture.coverage.assets.map((a) => {
    const b = Object.assign({}, a);
    delete b.checks;
    delete b.checkSummary;
    return b;
  }),
};

// 「按会话分类」清单：两个会话各一个项目（eng_001 属于 sess-A，eng_002 属于 sess-B）。
// 后端按请求里的 sessionId 标 mine —— 这里照做，测试才能验证"本会话 / 历史项目"的分组。
const projectRows = [
  {
    id: "eng_001", title: "巨人网络SRC · 第17轮", origin: "https://giant.example", goal: "证据链",
    sessionId: "session-A", cwd: "C:\\work\\giant", phase: "P1", status: "active", updatedAt: "2026-09-21T10:00:00Z",
    counts: { facts: 8, intents: 6, open: 3, hints: 1, assets: 91 }, empty: false, mine: false,
  },
  {
    id: "eng_002", title: "天台测试目录范围说明", origin: "https://tt.example", goal: "范围说明",
    sessionId: "session-B", cwd: "C:\\work\\tt", phase: "P2", status: "active", updatedAt: "2026-09-20T09:00:00Z",
    counts: { facts: 2, intents: 1, open: 1, hints: 0, assets: 4 }, empty: false, mine: false,
  },
];
function projectsPayload(sessionId) {
  const rows = projectRows.map((p) => ({ ...p, mine: Boolean(sessionId) && p.sessionId === sessionId }));
  return { ok: true, sessionId: sessionId ?? null, mineId: rows.find((p) => p.mine)?.id ?? null, projects: rows };
}

// 带上 projectId 的请求要拿到**那个项目**的图（否则点开历史项目的断言会假绿：
// 面板显示的数据与它以为在看的项目不一致，删除按钮就会删错对象）
function withProject(payload, pid) {
  if (!pid || !payload) return payload;
  const row = projectRows.find((p) => p.id === pid);
  if (!row) return payload;
  const clone = JSON.parse(JSON.stringify(payload));
  if (clone.graph && clone.graph.project) {
    clone.graph.project.id = row.id;
    clone.graph.project.title = row.title;
    clone.graph.project.origin = row.origin;
    clone.graph.project.goal = row.goal;
  }
  if (clone.summary && clone.summary.project) {
    clone.summary.project.id = row.id;
    clone.summary.project.title = row.title;
  }
  return clone;
}
function pidOf(body) { return (/"projectId":"([^"]+)"/.exec(body) || [])[1] ?? null; }

// 按端点返回对应 payload（照面板 api 的真实请求形状）
function payloadFor(url, opts = {}, body = "") {
  // poison：模拟"宿主字段形状漂移"（真实事故：旧 bundle 遇上新 payload 会在渲染期抛错 → 整块空白）
  if (opts.poison && url.includes("/vore-blackboard/assets")) return { ok: true, assets: "poisoned-not-an-array" };
  if (opts.poison && url.includes("/vore-blackboard/coverage")) {
    const bad = JSON.parse(JSON.stringify(coverage));
    bad.assets = "poisoned-not-an-array";
    return bad;
  }
  if (url.includes("/vore-blackboard/projects")) return opts.noMine ? projectsPayload(null) : projectsPayload(opts.projectSessionId ?? null);
  // 删除面板：照后端真实回执（含各表删除条数与备份路径）
  if (url.includes("/vore-blackboard/project.delete")) {
    const pid = (/"projectId":"([^"]+)"/.exec(body) || [])[1] ?? "eng_002";
    return {
      ok: true, id: pid, title: "巨人网络SRC · 第17轮",
      deleted: { facts: 9, intents: 6, intentSources: 5, hints: 4, assets: 91, assetChecks: 30, untested: 2 },
      backupPath: "C:\\Users\\user\\.dsh\\voredteam\\blackboard.backup-20260921T150000.db",
    };
  }
  // 本会话没黑板（noMine）且没显式点开历史项目时：后端**必须**回 null —— 面板显示"本会话还没有黑板"
  if (opts.noMine && !body.includes('"projectId"')) {
    if (url.includes("/vore-blackboard/graph")) return { ok: true, graph: null, scope: { id: null, source: "none" } };
    if (url.includes("/vore-blackboard/status")) return { ok: true, summary: null, scope: { id: null, source: "none" } };
    if (url.includes("/vore-blackboard/coverage")) return { ok: true, coverage: null, assets: [], scope: { id: null, source: "none" } };
    if (url.includes("/vore-blackboard/assets")) return { ok: true, assets: [], scope: { id: null, source: "none" } };
  }
  const pid = pidOf(body);
  if (url.includes("/vore-blackboard/graph")) return withProject(graph, pid);
  if (url.includes("/vore-blackboard/status")) return withProject(status, pid);
  if (url.includes("/vore-blackboard/coverage")) return withProject(opts.legacyCoverage ? legacyCoverage : coverage, pid);
  if (url.includes("/vore-blackboard/assets")) return opts.legacyCoverage ? { ok: true, assets: legacyCoverage.assets } : assets;
  if (url.includes("/vore-blackboard/list")) return fixture.list;
  return { ok: true };
}

function harnessWithLiveData(arg) {
  // arg 可以是旧的 failFor 函数，也可以是 { failFor, sessionId }
  const opts = typeof arg === "function" ? { failFor: arg } : (arg ?? {});
  const { React, mount } = createMiniReact();
  const registrations = [];
  const requested = [];   // { url, body }
  // 迷你 document：把 addEventListener 记下来，测试可以真的"派发" mousemove / mouseup
  // （拖动分隔条改右栏宽度靠的就是 document 级监听；不给它一个实现，这条就测不了）
  const docListeners = new Map();
  const fireDoc = (type, ev) => { for (const fn of docListeners.get(type) ?? []) fn(ev); };
  const documentStub = {
    getElementById: () => null,
    createElement: () => ({ id: "", textContent: "", style: {}, setAttribute() {} }),
    head: { appendChild: () => {} },
    hidden: false,
    addEventListener: (type, fn) => { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type).add(fn); },
    removeEventListener: (type, fn) => { docListeners.get(type)?.delete(fn); },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, queueMicrotask,
    fetch: async (url, init) => {
      const body = init && init.body ? String(init.body) : "";
      requested.push({ url, body });
      if (url.endsWith("/csrf")) return { status: 200, json: async () => ({ token: "tok" }) };
      if (opts.failFor) opts.failFor(url);
      return { status: 200, json: async () => payloadFor(url, opts, body) };
    },
    window: { confirm: opts.confirm ?? (() => true), addEventListener: () => {} },
    document: documentStub,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: opts.localStorage ?? { getItem: () => null, setItem: () => {} },
  };
  sandbox.window.__ModuleLoader__ = { load: (spec) => registrations.push(spec) };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "vore-console-client.js" });
  const mod = registrations[0].factory((spec) => { if (spec === "react") return React; throw new Error(`bundle 只应 require react，实际：${spec}`); });
  // 形如宿主真实会话服务：scope.sessions.list.getSnapshot() → { ids, byId, current, phase }
  const sessionsStore = opts.sessionId
    ? { list: { getSnapshot: () => ({ ids: [opts.sessionId], byId: { [opts.sessionId]: { id: opts.sessionId, cwd: "C:\\tmp" } }, current: opts.sessionId, phase: "ready" }) } }
    : { list: { getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: "ready" }) } };
  let component = null;
  mod.apply({
    effect: (fn) => { try { fn(); } catch { /* 无 DOM */ } return () => {}; },
    inject: (_deps, cb) => { cb({ sessions: sessionsStore }); return () => {}; },
    slots: { inject: (_n, cb) => { cb(); return () => {}; }, register: (_s, c) => { component = c; return () => {}; } },
  });
  const inst = mount(component({}).type, component({}).props);
  return { inst, requested, fireDoc, ls: opts.localStorage ?? null };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

let live = null;
await ok("首帧渲染出面板骨架（标题/三个分栏标签）", () => {
  live = harnessWithLiveData();
  const t = textOf(live.inst.tree).join(" ");
  for (const kw of ["作战面板", "实时情况", "任务汇总", "覆盖矩阵"]) {
    if (!t.includes(kw)) throw new Error(`首帧缺「${kw}」：${t.slice(0, 160)}`);
  }
});

await (async () => {
  await flush(); await flush();
  await ok("异步取数后仍能渲染（数据到达后的那次渲染不抛错）", () => {
    if (live.inst.error) throw new Error(`渲染期抛错（浏览器里会整块空白）：${live.inst.error.message}\n      ${String(live.inst.error.stack).split("\n")[1]?.trim() ?? ""}`);
    const t = textOf(live.inst.tree).join(" ");
    if (!t.trim()) throw new Error("渲染树为空");
    if (/加载中/.test(t) && !/未建项目|尚未建立黑板|阶段/.test(t)) throw new Error(`数据已到达却仍在「加载中」：${t.slice(0, 160)}`);
    const bar = findByClass(live.inst.tree, "dsh-vc-bar");
    if (!bar.length) throw new Error(`顶栏没了；当前文本：${t.slice(0, 200)}`);
  });

  await ok("请求覆盖三个端点（graph + status + coverage）", () => {
    const eps = live.requested.filter((r) => r.url.includes("/vore-blackboard/")).map((r) => r.url.split("/").pop());
    for (const need of ["graph", "status", "coverage"]) {
      if (!eps.includes(need)) throw new Error(`没有请求 ${need}；实际请求：${eps.join(", ")}`);
    }
  });

  await ok("资产清单也来自 /assets（泳道里的资产节点用它画）", () => {
    const eps = live.requested.filter((r) => r.url.includes("/vore-blackboard/")).map((r) => r.url.split("/").pop());
    if (!eps.includes("assets")) throw new Error(`没有请求 assets；实际请求：${eps.join(", ")}`);
  });

  // 会话归属：面板必须把"我所在会话的 id"带给宿主，否则宿主只能退化成"最近更新的项目"，
  // 一旦别的会话新建了空项目，本会话面板就会显示成空（= "作战面板没有任何显示"）。
  await ok("请求带上当前会话 id（否则会读到别的会话的空项目）", async () => {
    const scoped = harnessWithLiveData({ sessionId: "sess-e053938f" });
    await flush(); await flush();
    const posts = scoped.requested.filter((r) => r.url.includes("/vore-blackboard/") && !r.url.endsWith("/csrf"));
    if (!posts.length) throw new Error("没有发出黑板请求");
    const missing = posts.filter((r) => !r.body.includes('"sessionId":"sess-e053938f"')).map((r) => r.url.split("/").pop());
    if (missing.length) throw new Error(`这些端点没带 sessionId：${missing.join(", ")}`);
  });

  await ok("会话未就绪时不带 sessionId（退回宿主默认解析，不报错）", async () => {
    const anon = harnessWithLiveData();
    await flush(); await flush();
    const posts = anon.requested.filter((r) => r.url.includes("/vore-blackboard/") && !r.url.endsWith("/csrf"));
    if (!posts.length) throw new Error("没有发出黑板请求");
    const leaked = posts.filter((r) => r.body.includes("sessionId")).map((r) => r.url.split("/").pop());
    if (leaked.length) throw new Error(`无会话却带了 sessionId：${leaked.join(", ")}`);
    if (anon.inst.error) throw new Error(`渲染期抛错：${anon.inst.error.message}`);
  });

  // 分栏切换断言：必须 await flush（setTab 触发的是异步重渲染），
  // 且断言词必须是"该分栏独有的、来自 fixture 的**数据**"，而不是顶栏文本 ——
  // 否则读到的是上一个分栏的顶栏，测试会假绿（这条踩过）。
  const tabText = async (label) => { clickTab(live.inst, label); await flush(); return textOf(live.inst.tree).join(" "); };

  await ok("实时情况：八条泳道按顺序出现（起点→信息收集→浅层→中间层→深层→线索→死点→成果）", async () => {
    const t = await tabText("实时情况");
    // ① 泳道标题必须精确按用户口径从上到下出现，且带序号 ①…⑧
    const seq = ["① 起点", "② 信息收集", "③ 浅层", "④ 中间层", "⑤ 深层", "⑥ 线索", "⑦ 死点", "⑧ 成果"];
    const order = seq.map((kw) => {
      const i = t.indexOf(kw);
      if (i < 0) throw new Error(`缺泳道「${kw}」：${t.slice(0, 400)}`);
      return i;
    });
    for (let i = 1; i < order.length; i++) {
      if (order[i] < order[i - 1]) throw new Error(`泳道顺序不对（第 ${i + 1} 条在后面？）：${t.slice(0, 500)}`);
    }
    // ② 起点 / 成果固定在首尾泳道：origin 与 goal 的事实必须在图上
    if (!t.includes("origin")) throw new Error("origin（起点事实）没画出来");
    if (!t.includes("goal")) throw new Error("goal（成果）没画出来");
    // ③ 资产节点：浅层显示 info 完成度、深层显示 deep 完成度与命中（数据来自 /coverage.assets）
    for (const kw of ["30/36", "deep 2/8 · 命中 2", "待探索 i001"]) {
      if (!t.includes(kw)) throw new Error(`实时情况缺「${kw}」：${t.slice(0, 500)}`);
    }
    // ④ 线索泳道分两组摆：已确认事实（f001 asset / f003 endpoint / f004 cred）/ 未确认
    //    （f005 疑似 + 待探索 i001、i002），且带条数
    for (const kw of ["已确认事实（3）", "未确认（疑似结论 / 待探索方向）（3）", "线索 6 条 · 已确认 3 · 未确认 3"]) {
      if (!t.includes(kw)) throw new Error(`线索泳道缺「${kw}」：${t.slice(0, 600)}`);
    }
    // ⑤ 死点泳道（不再是右侧灰框）：死意图 i004 + 被推翻的事实 f006 都在泳道里，且有计数
    if (!t.includes("死点 2 个 · 死路方向 1 · 被推翻结论 1")) throw new Error(`死点泳道没有计数：${t.slice(0, 600)}`);
    if (!t.includes("死点 i004")) throw new Error("死点泳道没有死意图 i004");
    if (!t.includes("死点 f006")) throw new Error("死点泳道没有被推翻的事实 f006");
    if (live.inst.error) throw new Error(`渲染期抛错：${live.inst.error.message}`);
  });

  await ok("实时情况右栏仍有待认领意图 / 人类提示（分栏内容不能因改布局而丢）", async () => {
    const t = await tabText("实时情况");
    for (const kw of ["待认领意图（2）", "人类提示（2）", "低频模糊"]) {
      if (!t.includes(kw)) throw new Error(`实时情况右栏缺「${kw}」：${t.slice(0, 240)}`);
    }
  });

  await ok("任务汇总：成果计数、定级与资产表来自黑板事实", async () => {
    const t = await tabText("任务汇总");
    for (const kw of ["成果 1", "high 1", "越权读取", "资产与接口（3）", "死路与未排除面（1）"]) {
      if (!t.includes(kw)) throw new Error(`任务汇总缺「${kw}」：${t.slice(0, 240)}`);
    }
  });

  // 覆盖矩阵：五阶段完成度 / 缺口 / 未测面 / 复核，数字都来自 /coverage 的新契约字段
  await ok("覆盖矩阵：阶段、来源缺口与资产明细来自 /coverage", async () => {
    const t = await tabText("覆盖矩阵");
    for (const kw of ["阶段 P1（起点（资产收集直到饱和））", "可推进到 P2", "来源未齐：cloud", "收集轮次 2 · 本轮新增 0", "资产明细（6）", "10.0.0.11:8443"]) {
      if (!t.includes(kw)) throw new Error(`覆盖矩阵缺「${kw}」：${t.slice(0, 300)}`);
    }
  });

  await ok("覆盖矩阵：六阶段各自的完成度与缺口（起点/信息收集/浅层/中间层/深层/成果）", async () => {
    const t = await tabText("覆盖矩阵");
    const base = t.indexOf("六阶段完成度");
    if (base < 0) throw new Error("覆盖矩阵缺「六阶段完成度」");
    const order = ["P1 起点", "P2 信息收集", "P3 浅层", "P4 中间层", "P5 深层", "P6 成果"].map((kw) => {
      const i = t.indexOf(kw, base);
      if (i < 0) throw new Error(`覆盖矩阵缺「${kw}」：${t.slice(0, 400)}`);
      return i;
    });
    for (let i = 1; i < order.length; i++) {
      if (order[i] < order[i - 1]) throw new Error("六阶段完成度没有按 P1→P6 从上到下排列");
    }
    // 数字来自 stages：信息收集 30/36 = 83%、浅层 (18+33)/(20+40) = 85%、中间层 (17+14)/(20+50) = 44%、深层 3/32 = 9%
    if (!t.includes("83% · 30/36")) throw new Error("信息收集完成度没显示（应为 83% · 30/36）");
    if (!t.includes("85% · 51/60")) throw new Error("浅层完成度没显示（核实 + 浅层测试 = 51/60）");
    if (!t.includes("44% · 31/70")) throw new Error("中间层完成度没显示（核验浅层 + OWASP = 31/70）");
    if (!t.includes("9% · 3/32")) throw new Error("深层完成度没显示（应为 9% · 3/32）");
    if (!/（\d+ 个缺口）/.test(t)) throw new Error("阶段缺口数没显示");
    if (!/缺：[^\s]+/.test(t)) throw new Error("缺口没点到具体资产项（asset:key）");
    if (!/P6 成果/.test(t)) throw new Error("成果泳道没显示复核/未测面口径");
  });

  // 工具条必须钉在**画布外层**：早先它写在滚动容器里，一滚图「适应窗口 / ＋ / －」就跟着图跑掉了
  await ok("工具条钉在画布外层（滚图不会带走「适应窗口 ＋ －」）+ 显示当前缩放", async () => {
    const live = harnessWithLiveData();
    await flush(); await flush();
    const wrap = findByClass(live.inst.tree, "dsh-vc-canvaswrap")[0];
    if (!wrap) throw new Error("缺少画布外层容器（工具条只能钉在它上面）");
    const canvasEl = findByClass(wrap, "dsh-vc-canvas")[0];
    const ctl = findByClass(wrap, "dsh-vc-canvasctl")[0];
    if (!canvasEl || !ctl) throw new Error("画布或工具条缺失");
    const labels = findByClass(ctl, "dsh-vc-btn").map((b) => textOf(b).join(""));
    for (const kw of ["适应窗口", "＋", "－"]) {
      if (!labels.includes(kw)) throw new Error(`工具条缺「${kw}」：${labels.join("/")}`);
    }
    if (findByClass(canvasEl, "dsh-vc-canvasctl").length) {
      throw new Error("工具条被放进了滚动容器里（滚动/平移时会跟着图跑掉）");
    }
    if (!/%/.test(textOf(ctl).join(" "))) throw new Error("工具条没显示当前缩放百分比：" + textOf(ctl).join(" "));
  });

  // 可读性（真实反馈：深色底下字体是黑色，完全看不见）：SVG 文本必须写死高对比 fill
  await ok("可读性：SVG 文字写死高对比 fill + 画布自带不透明底色 + 中文友好字体栈", () => {
    const code = fs.readFileSync(BUNDLE, "utf8");
    if (!/\.dsh-vc-lanetitle\{fill:var\(--vore-ink/.test(code)) throw new Error("泳道标题没有写死 fill（SVG 文本默认黑色）");
    if (!/\.dsh-vc-node text\{[^}]*fill:var\(--vore-ink/.test(code)) throw new Error("节点文字没有写死 fill");
    if (!/\.dsh-vc-canvas\{[^}]*background-color:var\(--vore-canvas-bg/.test(code)) throw new Error("画布没有自带不透明底色");
    if (!/--vore-canvas-bg:#f4f7fc/.test(code)) throw new Error("缺浅色画布底色");
    if (!/--vore-canvas-bg:#0b111b/.test(code)) throw new Error("缺深色画布底色");
    if (!/Microsoft YaHei/.test(code)) throw new Error("缺中文友好字体栈");
    if (!/\.dsh-vc-root\.is-dark\{/.test(code)) throw new Error("深色主题要能被面板自己触发（不能只赌宿主属性）");
    if (!/\.dsh-vc-canvas>svg\{margin:auto/.test(code)) throw new Error("缺居中规则（图小于画布时要居中，不能缩在左上角）");
  });

  // ── 按会话分类（用户口径：新会话 = 新的作战面板，历史项目要点开看）──────────
  await ok("顶栏有「会话」选择器：本会话 + 其他会话的历史项目（带阶段/资产/事实计数）", async () => {
    const mine = harnessWithLiveData({ sessionId: "session-A" });
    await flush(); await flush();
    const sel = findByClass(mine.inst.tree, "dsh-vc-select")[0];
    if (!sel) throw new Error("顶栏没有会话选择器");
    const text = textOf(sel).join(" | ");
    for (const kw of ["本会话：巨人网络SRC · 第17轮", "天台测试目录范围说明", "P2", "资产 4"]) {
      if (!text.includes(kw)) throw new Error(`选择器缺「${kw}」：${text}`);
    }
    const groups = findByClass(sel, "dsh-vc-selectgroup").length;
    void groups;
    if (sel.props.value !== "eng_001") throw new Error(`默认应停在本会话的项目上，实际 value=${sel.props.value}`);
    // 首次取图不该显式带 projectId（就靠会话 id 解析）；后续 status/coverage 带上已解析到的 id 是正常的
    const firstGraph = mine.requested.filter((r) => r.url.endsWith("/graph"))[0];
    if (!firstGraph) throw new Error("没请求 graph");
    if (firstGraph.body.includes('"projectId"')) throw new Error("本会话项目不该显式带 projectId 去取图");
    const posts = mine.requested.filter((r) => r.url.includes("/vore-blackboard/") && !r.url.endsWith("/csrf") && !r.url.endsWith("/projects"));
    for (const r of posts) {
      if (!r.body.includes('"sessionId":"session-A"')) throw new Error(`请求没带会话 id：${r.url} ${r.body}`);
    }
  });

  await ok("新会话（本会话还没有黑板）：显示空态 + 历史项目清单 + 建黑板表单，且**不借别人的图**", async () => {
    const fresh = harnessWithLiveData({ noMine: true, sessionId: "session-NEW" });
    await flush(); await flush();
    const t = textOf(fresh.inst.tree).join(" ");
    for (const kw of ["本会话还没有黑板（一个会话一个项目）", "本会话 id：", "历史项目（按会话归类：2 个会话 / 2 个项目）", "建立本会话黑板", "巨人网络SRC · 第17轮"]) {
      if (!t.includes(kw)) throw new Error(`空态缺「${kw}」：${t.slice(0, 400)}`);
    }
    if (/① 起点/.test(t)) throw new Error("新会话不该画出别人的泳道图");
    const gReq = fresh.requested.filter((r) => r.url.endsWith("/graph"));
    if (!gReq.length) throw new Error("没请求 graph");
    if (gReq.some((r) => r.body.includes('"projectId"') || r.body.includes('"sessionId":"session-A"'))) {
      throw new Error(`新会话的请求串到了别人的项目：${gReq.map((r) => r.body).join(" | ")}`);
    }
  });

  await ok("点开历史项目：下一次取数带 projectId + 出现「回到本会话」；回到本会话后不再带", async () => {
    const h = harnessWithLiveData({ sessionId: "session-A" });
    await flush(); await flush();
    const sel0 = findByClass(h.inst.tree, "dsh-vc-select")[0];
    sel0.props.onChange({ target: { value: "eng_002" } });
    await flush(); await flush();
    const after = h.requested.filter((r) => r.url.endsWith("/graph")).slice(-1)[0];
    if (!after || !after.body.includes('"projectId":"eng_002"')) throw new Error(`点开历史项目后没带 projectId：${after && after.body}`);
    const t = textOf(h.inst.tree).join(" ");
    if (!/正在看历史项目/.test(t)) throw new Error(`缺历史项目横幅：${t.slice(0, 300)}`);
    const back = findByClass(h.inst.tree, "dsh-vc-btn").find((b) => textOf(b).join("") === "回到本会话");
    if (!back) throw new Error("缺「回到本会话」按钮");
    back.props.onClick();
    await flush(); await flush();
    const backReq = h.requested.filter((r) => r.url.endsWith("/graph")).slice(-1)[0];
    if (backReq.body.includes('"projectId"')) throw new Error(`回到本会话后仍带 projectId：${backReq.body}`);
    if (/正在看历史项目/.test(textOf(h.inst.tree).join(" "))) throw new Error("回到本会话后横幅没消失");
  });

  // 「删除该面板」= 删掉当前显示的那一块（项目 + 它名下一切）：要确认、要带 projectId、要回执、要清掉钉住状态
  await ok("删除该面板：确认框 → 带 projectId 调 project.delete → 回执（含备份路径）→ 回到本会话", async () => {
    const store = new Map([["vore.panel.pinnedProject", "eng_002"], ["unrelated", "keep"]]);
    const fakeLs = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    const asks = [];
    const h = harnessWithLiveData({
      sessionId: "session-A", localStorage: fakeLs,
      confirm: (msg) => { asks.push(String(msg)); return true; },
    });
    await flush(); await flush();
    if (!/正在看历史项目/.test(textOf(h.inst.tree).join(" "))) throw new Error("预置失败：没进入历史项目态");
    const btn = findByClass(h.inst.tree, "dsh-vc-btn").find((b) => textOf(b).join("") === "删除该面板");
    if (!btn) throw new Error("工具栏没有「删除该面板」按钮");
    btn.props.onClick();
    await flush(); await flush();
    if (!asks.length) throw new Error("删除前没有弹确认框（不可逆动作必须确认）");
    if (!/不可逆/.test(asks[0]) || !/eng_002/.test(asks[0])) throw new Error("确认框没说清删哪个/不可逆：" + asks[0].slice(0, 120));
    const del = h.requested.filter((r) => r.url.endsWith("/project.delete"));
    if (!del.length) throw new Error("没有发出 project.delete 请求");
    if (!del[0].body.includes('"projectId":"eng_002"')) throw new Error("删除请求没带 projectId：" + del[0].body);
    const t = textOf(h.inst.tree).join(" ");
    if (!/已删除作战面板 eng_002/.test(t)) throw new Error("没有删除回执：" + t.slice(0, 260));
    if (!/blackboard\.backup-/.test(t)) throw new Error("回执没写备份路径：" + t.slice(0, 300));
    if (/正在看历史项目/.test(t)) throw new Error("删完仍停在被删的历史项目上");
    if (store.has("vore.panel.pinnedProject")) throw new Error("删除后没清掉钉住的项目");
    if (!store.has("unrelated")) throw new Error("删除不该动别的键");
  });

  await ok("删除该面板：用户点「取消」时什么都不发（防误删）", async () => {
    const h = harnessWithLiveData({ sessionId: "session-A", confirm: () => false });
    await flush(); await flush();
    const before = h.requested.length;
    findByClass(h.inst.tree, "dsh-vc-btn").find((b) => textOf(b).join("") === "删除该面板").props.onClick();
    await flush();
    if (h.requested.length !== before) throw new Error("点了取消却发了请求");
    if (h.requested.some((r) => r.url.endsWith("/project.delete"))) throw new Error("取消后仍调用了 project.delete");
  });

  // 右侧详情栏要能"拉伸"：拖分隔条改宽度（往左拖变宽）→ 夹在合理区间 → 落 localStorage；双击复位；箭头可收起
  await ok("右侧详情栏可拉伸：拖动分隔条改宽度 + 落盘 + 双击复位 + 收起/展开", async () => {
    const store = new Map();
    const fakeLs = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    const h = harnessWithLiveData({ sessionId: "session-A", localStorage: fakeLs });
    await flush(); await flush();
    const split = findByClass(h.inst.tree, "dsh-vc-split")[0];
    if (!split) throw new Error("画布与右栏之间没有分隔条（无法拉伸）");
    const asideOf = () => findByClass(h.inst.tree, "dsh-vc-aside")[0];
    const widthOf = () => String(asideOf().props.style?.width ?? "");
    if (widthOf() !== "330px") throw new Error(`默认宽度应为 330px，实际 ${widthOf()}`);

    // 拖动：mousedown 在分隔条上，然后 document 级 mousemove 往左 120px（右栏应加宽到 450）
    split.props.onMouseDown({ clientX: 1000, preventDefault: () => {} });
    h.fireDoc("mousemove", { clientX: 880 });
    await flush();
    if (widthOf() !== "450px") throw new Error(`往左拖 120px 后应为 450px，实际 ${widthOf()}`);
    // 往右拖回去（右栏变窄），并验证下限夹紧
    h.fireDoc("mousemove", { clientX: 1600 });
    await flush();
    const w = Number(String(widthOf()).replace("px", ""));
    if (!(w >= 220)) throw new Error(`宽度应被夹在下限 220 之上，实际 ${widthOf()}`);
    // 松手才落盘
    h.fireDoc("mouseup", {});
    await flush();
    if (String(store.get("vore.panel.asideWidth")) !== String(w)) {
      throw new Error(`宽度没落 localStorage：${store.get("vore.panel.asideWidth")} vs ${w}`);
    }
    // 双击复位
    findByClass(h.inst.tree, "dsh-vc-split")[0].props.onDoubleClick({});
    await flush();
    if (widthOf() !== "330px") throw new Error(`双击后应复位 330px，实际 ${widthOf()}`);
    // 收起 / 展开
    const toggle = findByClass(h.inst.tree, "dsh-vc-splitbtn")[0];
    if (!toggle) throw new Error("分隔条上没有收起/展开按钮");
    toggle.props.onClick({ stopPropagation: () => {} });
    await flush();
    if (widthOf() !== "0px") throw new Error(`收起后宽度应为 0，实际 ${widthOf()}`);
    if (!findByClass(h.inst.tree, "dsh-vc-aside")[0].className.includes("is-collapsed")) throw new Error("收起后缺 is-collapsed 类");
    findByClass(h.inst.tree, "dsh-vc-splitbtn")[0].props.onClick({ stopPropagation: () => {} });
    await flush();
    if (widthOf() !== "330px") throw new Error(`展开后应回到 330px，实际 ${widthOf()}`);
  });

  // 渲染期自保：宿主字段形状突变时**不许白屏**，必须显示可读错误（本用例喂一个被污染的 payload）
  // 真实事故回归（React error #310）：首帧无数据、随后有数据 —— 两帧的 hook 数量必须一致
  // 全屏模式：按钮可切换、根元素带 is-fs、全屏提示出现、再点一次能退出
  await ok("全屏：点「全屏」→ 根元素带 is-fs + 出现全屏提示；再点「退出全屏」→ 复原", async () => {
    const live = harnessWithLiveData();
    await flush(); await flush();
    const rootOf = () => findByClass(live.inst.tree, "dsh-vc-root")[0];
    const btnOf = (label) => (findByClass(live.inst.tree, "dsh-vc-btn") || []).find((b) => textOf(b).join("") === label);
    if (!rootOf()) throw new Error("找不到面板根元素");
    if (rootOf().className.includes("is-fs")) throw new Error("默认不该是全屏");
    const on = btnOf("全屏");
    if (!on) throw new Error("工具栏没有「全屏」按钮：" + (findByClass(live.inst.tree, "dsh-vc-btn") || []).map((b) => textOf(b).join("")).join("/"));
    on.props.onClick();
    await flush();
    if (!rootOf().className.includes("is-fs")) throw new Error("点全屏后根元素没有 is-fs（CSS 兜底全屏没生效）");
    if (!/全屏中/.test(textOf(live.inst.tree).join(" "))) throw new Error("全屏态没有出现操作提示（滚轮缩放/Esc 退出）");
    const off = btnOf("退出全屏");
    if (!off) throw new Error("全屏态下按钮没变成「退出全屏」");
    off.props.onClick();
    await flush();
    if (rootOf().className.includes("is-fs")) throw new Error("点退出后仍处于全屏态");
    if (live.inst.error) throw new Error("全屏切换过程中渲染抛错：" + live.inst.error.message);
  });

  await ok("hook 顺序稳定：首帧（无数据）与有数据那一帧的 hook 数量必须一致（否则 React #310 → 整块空白）", async () => {
    const live = harnessWithLiveData();
    await flush(); await flush();
    if (live.inst.hookViolation) {
      throw new Error(`hook 数量在两帧之间变了（前 ${live.inst.hookViolation.prev} → 后 ${live.inst.hookViolation.now}）——真实 React 会报 error #310 并整块空白`);
    }
    if (live.inst.error) throw new Error(`渲染期抛错：${live.inst.error.message}`);
    // 分栏切换、再刷新一轮，hook 数量也必须保持不变
    clickTab(live.inst, "覆盖矩阵");
    await flush();
    clickTab(live.inst, "任务汇总");
    await flush();
    if (live.inst.hookViolation) throw new Error("切换分栏导致 hook 数量变化");
  });

  await ok("payload 形状被污染时不白屏：显示「面板渲染出错」而不是空白", async () => {    const broken = harnessWithLiveData({ poison: true });
    await flush(); await flush();
    const txt = textOf(broken.inst.tree).join(" ");
    if (!txt.trim()) throw new Error("面板整块空白（最糟的表现）");
    if (!/面板渲染出错/.test(txt)) throw new Error(`应显示可读错误，实际：${txt.slice(0, 200)}`);
    if (!/Ctrl\+F5|刷新/.test(txt)) throw new Error("错误提示里要给出「先刷新页面」的可操作指引");
  });

  await ok("覆盖矩阵：回灌未收轮时显眼提示（新资产 → 退回 P1 起点，先再收一轮）", async () => {
    const t = await tabText("覆盖矩阵");
    for (const kw of ["回灌未收轮", "js-reverse", "退回起点阶段", "连续 0 新增"]) {
      if (!t.includes(kw)) throw new Error(`缺「${kw}」：${t.slice(0, 300)}`);
    }
  });

  await ok("覆盖矩阵：未测面清单（含未测原因）与复核进度", async () => {
    const t = await tabText("覆盖矩阵");
    for (const kw of ["未测面（2，已声明）", "[未测面] u001 · P2 · 小程序 wxapkg 包", "模拟器未装微信", "[未测面] u002 · P4 · SCADA 10.0.0.0/24 网段", "复核（1/2）", "已复核 1 · 待复核 1", "还有 1 条成果没复核，P6 不能收口"]) {
      if (!t.includes(kw)) throw new Error(`缺「${kw}」：${t.slice(0, 400)}`);
    }
  });

  // na（判定不适用）也算覆盖，但证据强度不同：面板必须把"真测过"单列，否则覆盖率会骗人
  await ok("覆盖矩阵把 na 与真测过分开显示（na 不得刷满覆盖）", async () => {
    const t = await tabText("覆盖矩阵");
    for (const kw of ["其中 na", "浅测 0 · 深测 1", "真测过：浅测 83% / 深测 40%"]) {
      if (!t.includes(kw)) throw new Error(`缺「${kw}」：${t.slice(0, 300)}`);
    }
    if (/⚠️/.test(t)) throw new Error("fixture 里的 na 都写了理由，不应出现无理由告警");
  });

  // ── 韧性：单个端点失败不得让其它分栏空白（"面板什么都没有"最常见的成因）──
  await ok("宿主缺 /coverage 时：实时情况与任务汇总仍有内容，只有覆盖矩阵报缺口", async () => {
    const broken = harnessWithLiveData((url) => {
      if (url.includes("/vore-blackboard/coverage")) throw new Error("404 Not Found");
      return payloadFor(url);
    });
    await flush(); await flush();
    if (broken.inst.error) throw new Error(`渲染期抛错：${broken.inst.error.message}`);
    const t = textOf(broken.inst.tree).join(" ");
    if (!t.trim()) throw new Error("整块面板被端点失败带空了");
    if (!/TARGET\.example|尚未建立黑板|作战面板/.test(t)) throw new Error(`顶栏内容丢失：${t.slice(0, 160)}`);
    // 每次切分栏都要等一次 microtask：setTab 走的是异步重渲染，同步读树只会读到上一个分栏。
    const textAfterTab = async (label) => { clickTab(broken.inst, label); await flush(); return textOf(broken.inst.tree).join(" "); };
    const liveText = await textAfterTab("实时情况");
    if (!/实时情况/.test(liveText) || liveText.length < 80) throw new Error(`实时情况分栏内容异常：${liveText.slice(0, 160)}`);
    const sumText = await textAfterTab("任务汇总");
    if (!/任务汇总/.test(sumText) || sumText.length < 80) throw new Error(`任务汇总分栏内容异常：${sumText.slice(0, 160)}`);
    const covText = await textAfterTab("覆盖矩阵");
    if (!/失败|加载中/.test(covText)) throw new Error(`覆盖矩阵应显示失败提示，实际：${covText.slice(0, 200)}`);
  });

  // 旧宿主（四阶段口径）：没有 stages/untested/reviews，资产也没有 checks —— 不能白屏，
  // 八条泳道必须照画，覆盖矩阵按 s2/s3 兜底。
  await ok("旧契约（缺 stages/untested/reviews/checks）时八条泳道照画、覆盖矩阵兜底", async () => {
    const legacy = harnessWithLiveData({ legacyCoverage: true });
    await flush(); await flush();
    if (legacy.inst.error) throw new Error(`渲染期抛错：${legacy.inst.error.message}`);
    const t = textOf(legacy.inst.tree).join(" ");
    for (const kw of ["起点", "信息收集", "浅层", "中间层", "深层", "线索", "死点", "成果"]) {
      if (!t.includes(kw)) throw new Error(`旧契约下缺泳道「${kw}」：${t.slice(0, 240)}`);
    }
    if (!t.includes("死点")) throw new Error("旧契约下死点泳道丢了");
    if (!t.includes("线索")) throw new Error("旧契约下线索泳道丢了");
    const textAfter = async (label) => { clickTab(legacy.inst, label); await flush(); return textOf(legacy.inst.tree).join(" "); };
    const covText = await textAfter("覆盖矩阵");
    for (const kw of ["六阶段完成度", "后端未给 stages", "尚未声明未测面", "复核（0/0）", "真测过：浅测 83% / 深测 40%"]) {
      if (!covText.includes(kw)) throw new Error(`旧契约下覆盖矩阵缺「${kw}」：${covText.slice(0, 300)}`);
    }
  });
})();

console.log(`\n全部通过：${pass} 项${fail ? `，未通过 ${fail} 项` : ""}`);
process.exit(fail ? 1 : 0);
