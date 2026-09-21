// vore-console 面板实现（构建期被 scripts/build-client.mjs 拼接进 lib/client.js）。
// 本文件不是独立模块：它假设作用域里已有 React（由工厂的 require("react") 提供）
// 与 pure.mjs 里的纯函数（computeLayout / factStyle / edgeColor / extractFindings …）。

var h = function () { return React.createElement.apply(React, arguments); };

// 缩放下限：真实作业里资产上百个（列很宽），下限太高会让"整张图"根本装不下（与 pure.fitZoom 的 min 一致）
var MIN_ZOOM = 0.05;

var CSS = [
  // 字体与配色**自己说了算**：面板不赌宿主主题（赌错了就是"黑字压深底，什么都看不见"）。
  // 背景一律给不透明底色（--vore-canvas-bg），字色一律给不透明墨色（--vore-ink），
  // 两套主题各写一份，字形用带中文的字体栈（Windows / macOS / Linux 各一条）。
  ".dsh-vc-root{display:flex;flex-direction:column;height:100%;min-height:420px;font-size:13.5px;"
    + "font-family:'Microsoft YaHei UI','Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC',system-ui,-apple-system,'Segoe UI',sans-serif;"
    + "color:var(--vore-ink,#0f1c2e);"
    + "--vore-panel-bg:#fbfcfe;--vore-ink:#0f1c2e;--vore-muted:#45586e;--vore-canvas-bg:#f4f7fc;"
    + "--vore-line:rgba(58,157,255,.28);--vore-lane-a:rgba(58,157,255,.07);--vore-lane-b:rgba(125,142,163,.11);"
    + "--vore-grid:rgba(125,142,163,.20);}",
  // 深色主题（宿主切暗色 / 面板自己探测到暗底时）：字色提到 #eaf3ff，底提到 #0b111b，保证强对比
  "body[data-ds-dark-theme] .dsh-vc-root,.dsh-vc-root.is-dark{--vore-panel-bg:#0f1420;--vore-ink:#eaf3ff;--vore-muted:#a9bdd2;"
    + "--vore-canvas-bg:#0b111b;--vore-line:rgba(58,157,255,.42);--vore-lane-a:rgba(58,157,255,.12);--vore-lane-b:rgba(125,142,163,.16);"
    + "--vore-grid:rgba(125,142,163,.26);}",
  ".dsh-vc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--vore-line,rgba(58,157,255,.28));}",
  ".dsh-vc-title{font-weight:600;}",
  ".dsh-vc-badge{padding:1px 7px;border-radius:9px;background:rgba(58,157,255,.14);border:1px solid rgba(58,157,255,.35);font-size:12px;}",
  ".dsh-vc-badge.is-ok{background:rgba(47,212,167,.14);border-color:rgba(47,212,167,.4);}",
  ".dsh-vc-goal{opacity:.8;max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
  ".dsh-vc-tabs{display:flex;gap:4px;margin-left:auto;align-items:center;}",
  ".dsh-vc-tab{padding:3px 10px;border-radius:7px;border:1px solid transparent;cursor:pointer;background:transparent;color:inherit;font:inherit;}",
  ".dsh-vc-tab.is-on{background:rgba(58,157,255,.14);border-color:rgba(58,157,255,.4);}",
  ".dsh-vc-btn{padding:3px 9px;border-radius:7px;border:1px solid rgba(58,157,255,.45);background:var(--vore-panel-bg,#fff);color:inherit;cursor:pointer;font:inherit;white-space:nowrap;}",
  ".dsh-vc-btn:hover{background:rgba(58,157,255,.16);}",
  // 危险动作（删除整块面板）：红色描边，别和普通按钮混
  ".dsh-vc-btn-danger{border-color:rgba(229,72,77,.55);color:#e5484d;}",
  ".dsh-vc-btn-danger:hover{background:rgba(229,72,77,.18);}",
  ".dsh-vc-err{padding:5px 10px;background:rgba(229,72,77,.14);border-bottom:1px solid rgba(229,72,77,.4);font-size:12px;}",
  // 操作回执（清缓存/强刷）：蓝绿色调，别和红色错误条混
  ".dsh-vc-note{padding:5px 10px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;background:rgba(47,212,167,.14);border-bottom:1px solid rgba(47,212,167,.42);font-size:12.5px;}",
  ".dsh-vc-body{display:flex;flex:1;min-height:0;}",
  // 画布：外层只做定位（工具条钉在这里，不随图滚动），内层才是滚动容器
  ".dsh-vc-canvaswrap{position:relative;flex:1;min-width:0;min-height:0;display:flex;}",
  ".dsh-vc-canvas{flex:1;min-width:0;display:flex;overflow:auto;"
    + "background-color:var(--vore-canvas-bg,#f4f7fc);"
    + "background-image:linear-gradient(var(--vore-grid,rgba(125,142,163,.2)) 1px,transparent 1px),linear-gradient(90deg,var(--vore-grid,rgba(125,142,163,.2)) 1px,transparent 1px);"
    + "background-size:26px 26px;}",
  // 图比画布小时居中（margin:auto 是 flex + overflow 下唯一不会裁掉左上角的居中写法）
  ".dsh-vc-canvas>svg{margin:auto;flex:none;}",
  ".dsh-vc-canvasctl{position:absolute;right:10px;top:10px;display:flex;gap:4px;align-items:center;z-index:3;padding:3px 4px;"
    + "border-radius:9px;background:var(--vore-panel-bg,#fff);border:1px solid var(--vore-line,rgba(58,157,255,.28));"
    + "box-shadow:0 2px 10px rgba(8,16,28,.22);}",
  ".dsh-vc-node{cursor:pointer;}",
  ".dsh-vc-node text{font-size:12.5px;fill:var(--vore-ink,#0f1c2e);pointer-events:none;}",
  ".dsh-vc-node .dsh-vc-nid{font-size:11px;opacity:.85;}",
  // SVG 里的文字必须写死 fill：SVG 文本的默认 fill 是**黑色**，深色底上等于隐身
  ".dsh-vc-lanetitle{fill:var(--vore-ink,#0f1c2e);font-size:14px;font-weight:700;}",
  ".dsh-vc-lanesub{fill:var(--vore-muted,#45586e);font-size:12px;}",
  ".dsh-vc-grouptitle{fill:var(--vore-muted,#45586e);font-size:12px;font-weight:600;}",
  ".dsh-vc-aside{flex:none;border-left:1px solid var(--vore-line,rgba(58,157,255,.28));padding:8px 10px;overflow:auto;}",
  // 右栏收起态：宽度由内联样式给 0，这里把内边距/边框一并收掉，别留一条白缝
  ".dsh-vc-aside.is-collapsed{padding:0;border-left:none;overflow:hidden;}",
  // 可拖动的分隔条（含收起/展开箭头）：拖动改右栏宽度，双击复位
  ".dsh-vc-split{flex:none;width:8px;cursor:col-resize;position:relative;display:flex;align-items:center;justify-content:center;"
    + "background:linear-gradient(90deg,transparent,rgba(125,142,163,.22),transparent);}",
  ".dsh-vc-split:hover{background:linear-gradient(90deg,transparent,rgba(58,157,255,.45),transparent);}",
  ".dsh-vc-splitbtn{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:16px;height:22px;padding:0;line-height:1;"
    + "border-radius:6px;border:1px solid var(--vore-line,rgba(58,157,255,.28));background:var(--vore-panel-bg,#fff);color:inherit;"
    + "cursor:pointer;font-size:11px;opacity:.85;}",
  ".dsh-vc-splitbtn:hover{opacity:1;background:rgba(58,157,255,.16);}",
  ".dsh-vc-aside h4{margin:6px 0 4px;font-size:12.5px;opacity:.9;}",
  ".dsh-vc-row{padding:4px 6px;border-radius:6px;cursor:pointer;}",
  ".dsh-vc-row:hover{background:rgba(58,157,255,.1);}",
  ".dsh-vc-row.is-on{background:rgba(58,157,255,.16);}",
  ".dsh-vc-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;opacity:.92;word-break:break-all;}",
  ".dsh-vc-in{width:100%;box-sizing:border-box;padding:5px 7px;border-radius:7px;border:1px solid rgba(125,142,163,.5);background:var(--vore-panel-bg,#fff);color:inherit;font:inherit;font-size:12.5px;}",
  ".dsh-vc-table{width:100%;border-collapse:collapse;font-size:12.5px;}",
  ".dsh-vc-table th,.dsh-vc-table td{padding:4px 6px;border-bottom:1px solid rgba(125,142,163,.22);text-align:left;vertical-align:top;}",
  ".dsh-vc-table tr.is-clik{cursor:pointer;}",
  ".dsh-vc-table tr.is-on{background:rgba(58,157,255,.12);}",
  ".dsh-vc-sev{display:inline-block;min-width:58px;padding:1px 6px;border-radius:8px;font-size:11.5px;text-align:center;border:1px solid;}",
  ".dsh-vc-sev.critical{color:#e5484d;border-color:rgba(229,72,77,.5);background:rgba(229,72,77,.12);}",
  ".dsh-vc-sev.high{color:#f76808;border-color:rgba(247,104,8,.5);background:rgba(247,104,8,.12);}",
  ".dsh-vc-sev.medium{color:#b98900;border-color:rgba(232,185,49,.55);background:rgba(232,185,49,.14);}",
  ".dsh-vc-sev.low{color:#2b7fd4;border-color:rgba(58,157,255,.5);background:rgba(58,157,255,.12);}",
  ".dsh-vc-empty{padding:26px;text-align:center;opacity:.8;}",
  ".dsh-vc-hint{font-size:12px;opacity:.8;margin-top:4px;}",
  ".dsh-vc-phase{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;background:rgba(58,157,255,.08);border-bottom:1px solid var(--vore-line,rgba(58,157,255,.28));}",
  ".dsh-vc-phase .dsh-vc-title{font-size:13.5px;}",
  ".dsh-vc-block{color:#e5484d;font-size:12.5px;}",
  ".dsh-vc-pct{display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(125,142,163,.2);}",
  ".dsh-vc-pctrow{display:flex;align-items:center;gap:8px;min-width:300px;flex:1;}",
  ".dsh-vc-pctrow>span:first-child{width:96px;flex:none;opacity:.9;}",
  ".dsh-vc-track{flex:1;height:8px;border-radius:5px;background:rgba(125,142,163,.22);overflow:hidden;}",
  ".dsh-vc-fill{height:100%;border-radius:5px;}",
  ".dsh-vc-num{font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.92;white-space:nowrap;}",
  ".dsh-vc-gap{display:flex;gap:8px;align-items:baseline;padding:4px 6px;border-radius:6px;cursor:pointer;}",
  ".dsh-vc-gap:hover{background:rgba(58,157,255,.1);}",
  ".dsh-vc-gap.is-on{background:rgba(58,157,255,.16);}",
  ".dsh-vc-kind{opacity:.85;font-size:12px;white-space:nowrap;}",
  ".dsh-vc-st{opacity:.85;font-size:12px;white-space:nowrap;}",
  ".dsh-vc-grid{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;}",
  ".dsh-vc-col{flex:1;min-width:320px;}",
  ".dsh-vc-scroll{overflow:auto;flex:1;min-height:0;padding:10px 12px;}",
  // 八泳道（从上到下）：泳道标题、完成度行、na 与真测过、线索/死点分组
  ".dsh-vc-stagewrap{padding:2px 0 6px;}",
  ".dsh-vc-stagerow{display:flex;align-items:center;gap:8px;min-width:340px;flex:1;}",
  ".dsh-vc-stagerow>span:first-child{width:74px;flex:none;opacity:.9;}",
  ".dsh-vc-na{display:flex;gap:8px;align-items:baseline;padding:3px 0;flex-wrap:wrap;}",
  ".dsh-vc-deadtitle{fill:var(--vore-muted,#45586e);font-size:12px;}",
  // 全屏态（CSS 兜底）：铺满视口、抬高层级、给不透明底 —— 浏览器 Fullscreen API 被策略拒时也能看全图
  ".dsh-vc-root.is-fs{position:fixed;inset:0;z-index:2147483000;width:auto;height:auto;min-height:0;background:var(--vore-panel-bg,#fbfcfe);padding:6px;box-sizing:border-box;}",
  ".dsh-vc-root.is-fs .dsh-vc-canvas,.dsh-vc-root.is-fs .dsh-vc-scroll{min-height:0;}",
  ".dsh-vc-root.is-fs .dsh-vc-canvasctl{top:12px;right:12px;}",
  ".dsh-vc-hint-fs{padding:2px 10px;font-size:12.5px;opacity:.85;}",
  // 顶栏「按会话分类」：下拉框 + 打开历史项目时的提示行
  ".dsh-vc-picker{display:inline-flex;align-items:center;gap:6px;}",
  ".dsh-vc-select{max-width:340px;padding:3px 6px;border-radius:7px;border:1px solid rgba(58,157,255,.45);"
    + "background:var(--vore-panel-bg,#fff);color:inherit;font:inherit;font-size:12.5px;}",
  ".dsh-vc-banner{padding:5px 10px;background:rgba(232,185,49,.16);border-bottom:1px solid rgba(232,185,49,.45);font-size:12.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
  ".dsh-vc-projrow{display:flex;gap:10px;align-items:baseline;padding:5px 8px;border-radius:7px;cursor:pointer;border:1px solid rgba(125,142,163,.28);margin-top:4px;}",
  ".dsh-vc-projrow:hover{background:rgba(58,157,255,.12);}",
  ".dsh-vc-projrow.is-on{background:rgba(47,212,167,.14);border-color:rgba(47,212,167,.45);}",
  ".dsh-vc-projnew{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px;}"
].join("");

function installStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("dsh-vc-style")) return;
  var el = document.createElement("style");
  el.id = "dsh-vc-style";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// 探测宿主是不是深色主题：宿主 ui-theme 会往 body 上打 `data-ds-dark-theme`；
// 另外兼容常见的 html[data-theme=dark] / .dark / data-color-scheme。探测不到就按浅色 ——
// 浅色下墨色 #0f1c2e 压在 #f4f7fc 画布上，对比度足够；两边都不会出现"黑字压深底"。
function detectDarkTheme() {
  if (typeof document === "undefined") return false;
  try {
    var b = document.body, el = document.documentElement;
    if (b && typeof b.hasAttribute === "function" && b.hasAttribute("data-ds-dark-theme")) return true;
    if (!el || typeof el.getAttribute !== "function") return false;
    var t = String(el.getAttribute("data-theme") || el.getAttribute("data-color-scheme") || "").toLowerCase();
    if (t === "dark") return true;
    if (el.classList && typeof el.classList.contains === "function" && el.classList.contains("dark")) return true;
  } catch (e) { /* 探测失败按浅色处理 */ }
  return false;
}

// 读"当前会话 id"。宿主会话服务是 { ids, byId, current: SessionId|undefined, phase }，
// 也兼容 { current: {id} } / 旧版 list() 形态 —— 面板必须带上它，
// 否则宿主只能退化成"最近更新的项目"，本会话的面板会显示成别人刚建的空项目（看起来什么都没有）。
function readSessionId(store) {
  if (!store) return null;
  var snap = null;
  try {
    var list = store.list;
    if (list && typeof list.getSnapshot === "function") snap = list.getSnapshot();
    else if (list && typeof list.get === "function") snap = list.get();
    else if (list && typeof list === "object" && !Array.isArray(list)) snap = list;
    else if (typeof store.getSnapshot === "function") snap = store.getSnapshot();
  } catch (e) { return null; }
  if (!snap) return null;
  var cur = snap.current;
  if (cur && typeof cur === "object") cur = cur.id || cur.sessionId || null;
  if (typeof cur === "string" && cur) return cur;
  return null;
}

/** 会话显示名：宿主 sessions 服务的 byId 里有 displayTitle/title，都没有就用短 id */
function sessionLabel(props, sessionId) {
  if (!sessionId) return "";
  try {
    var store = props && props.sessionsStore;
    var list = store && store.list;
    var snap = list && typeof list.getSnapshot === "function" ? list.getSnapshot() : null;
    var row = snap && snap.byId ? snap.byId[sessionId] : null;
    if (row) {
      var t = row.displayTitle || row.title;
      if (t) return String(t);
      if (row.cwd) return String(row.cwd).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(row.cwd);
    }
  } catch (e) { /* 拿不到标题就退回短 id */ }
  return "会话 " + shortSession(sessionId);
}

// 人类在顶栏点开的历史项目：记在 localStorage 里，刷新页面后还停在那张图上（可选）。
var PIN_KEY = "vore.panel.pinnedProject";
function readPin() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    var v = localStorage.getItem(PIN_KEY);
    return v && String(v).trim() ? String(v).trim() : null;
  } catch (e) { return null; }
}
function writePin(id) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    if (id) localStorage.setItem(PIN_KEY, String(id));
    else localStorage.removeItem(PIN_KEY);
  } catch (e) { /* 隐私模式等：忽略 */ }
}

// 右侧详情栏的宽度：可以拖着改（记在 localStorage，刷新后保持），双击复位，箭头收起/展开。
var ASIDE_KEY = "vore.panel.asideWidth";
var ASIDE_MIN = 220;
var ASIDE_DEFAULT = 330;
function readAsideWidth() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return ASIDE_DEFAULT;
    var v = Number(localStorage.getItem(ASIDE_KEY));
    return Number.isFinite(v) && v >= ASIDE_MIN ? Math.round(v) : ASIDE_DEFAULT;
  } catch (e) { return ASIDE_DEFAULT; }
}
function writeAsideWidth(w) {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    localStorage.setItem(ASIDE_KEY, String(Math.round(Number(w) || ASIDE_DEFAULT)));
  } catch (e) { /* 忽略 */ }
}

function ConsolePanel(props) {
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;
  var useRef = React.useRef, useCallback = React.useCallback;

  var apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = createApi(function () { return fetch.apply(null, arguments); }, ROUTE);
  var api = apiRef.current;
  // props 每轮渲染刷新一次快照：refresh 是稳定回调（deps=[api]），不能吃第一轮的陈旧 props。
  var propsRef = useRef(null);
  propsRef.current = props;

  var s0 = useState(null), graph = s0[0], setGraph = s0[1];
  var s1 = useState(null), summary = s1[0], setSummary = s1[1];
  var s2 = useState(""), err = s2[0], setErr = s2[1];
  var s3 = useState("live"), tab = s3[0], setTab = s3[1];
  var s4 = useState(true), auto = s4[0], setAuto = s4[1];
  var s5 = useState(null), sel = s5[0], setSel = s5[1];
  var s6 = useState(1), zoom = s6[0], setZoom = s6[1];
  var s7 = useState({ x: 0, y: 0 }), pan = s7[0], setPan = s7[1];
  var s8 = useState(""), hint = s8[0], setHint = s8[1];
  var s9 = useState(null), openRow = s9[0], setOpenRow = s9[1];
  var s10 = useState(null), cov = s10[0], setCov = s10[1];   // 覆盖矩阵（/coverage 响应）
  var s11 = useState(false), isFs = s11[0], setIsFs = s11[1];   // 全屏态（true = 面板铺满视口）
  var s12 = useState(function () { return detectDarkTheme(); }), isDark = s12[0], setIsDark = s12[1];
  // 按会话分类：projects = /projects 的清单（每个项目绑定的会话）；pin = 人类显式点开的历史项目
  var s13 = useState(null), projects = s13[0], setProjects = s13[1];
  var s14 = useState(function () { return readPin(); }), pin = s14[0], setPin = s14[1];
  var s15 = useState(""), newOrigin = s15[0], setNewOrigin = s15[1];
  var s16 = useState(""), newGoal = s16[0], setNewGoal = s16[1];
  var s17 = useState(""), notice = s17[0], setNotice = s17[1];   // 「清缓存/强刷」这类操作的回执
  // 右侧详情栏：宽度可拖（ASIDE_MIN..面板宽度-320），可收起；宽度记 localStorage
  var s18 = useState(function () { return readAsideWidth(); }), asideWidth = s18[0], setAsideWidth = s18[1];
  var s19 = useState(false), asideCollapsed = s19[0], setAsideCollapsed = s19[1];
  var pinRef = useRef(null);
  pinRef.current = pin;
  var scopeRef = useRef(null);      // /graph 回来的 scope：source=session 说明这张图是本会话的
  var asideRef = useRef(null);      // 拖动时的实时宽度（mouseup 时写 localStorage 用）
  asideRef.current = asideWidth;
  var busyRef = useRef(false);
  var rootRef = useRef(null);       // 面板根元素（Fullscreen API 的目标）
  var canvasRef = useRef(null);     // 画布（「适应窗口」/进全屏时按容器算缩放）
  var dragRef = useRef(null);

  var refresh = useCallback(function () {
    // 单个在飞的刷新周期：一次拉 graph + status + coverage，避免 3 秒轮询叠请求。
    // 三个端点**相互独立**：任一失败（例如宿主版本较旧、缺 /coverage 路由）只影响它对应的分栏，
    // 不能把其它分栏一起变成空白 —— 这是"面板看起来什么都没有"最常见的原因。
    if (busyRef.current) return Promise.resolve();
    busyRef.current = true;
    var failures = [];
    var step = function (label, p) {
      return Promise.resolve(p).then(function (v) { return v; }, function (e) {
        failures.push(label + "：" + String((e && e.message) || e));
        return null;
      });
    };
    var sid0 = readSessionId(propsRef.current && propsRef.current.sessionsStore);
    // 顶栏的「按会话分类」清单也一起拉：它决定面板显示的是本会话的黑板还是人类点开的历史项目
    var projectsP = step("项目清单", typeof api.projects === "function" ? api.projects(sid0) : Promise.resolve(null));
    return step("图", api.graph(pinRef.current, sid0))
      .then(function (g) {
        if (g) {
          scopeRef.current = g.scope || null;
          setGraph(g.graph || null);
          var pid = g.graph && g.graph.project ? g.graph.project.id : null;
          return Promise.all([
            step("状态", api.status(pid, sid0)),
            step("覆盖矩阵", typeof api.coverage === "function" ? api.coverage(pid, sid0) : Promise.reject(new Error("该客户端 bundle 未实现 coverage"))),
            // 资产清单也单独拉一次（拿 checks/checkSummary 画泳道里的资产节点）；
            // 老宿主没有 /assets 路由时静默失败，退回用 /coverage 里的 assets。
            step("资产", typeof api.assets === "function" ? api.assets(pid, sid0) : Promise.reject(new Error("该客户端 bundle 未实现 assets"))),
          ]);
        }
        return [null, null, null];
      })
      .then(function (r) {
        projectsP.then(function (pj) { if (pj) setProjects(pj); }, function () { /* 已记进 failures */ });
        if (r && r[0]) setSummary(r[0].summary || null);
        if (r && r[1]) {
          var fromCoverage = (r[1] && r[1].assets) || [];
          var fromAssets = (r[2] && r[2].assets) || [];
          setCov({ coverage: (r[1] && r[1].coverage) || null, assets: fromCoverage.length ? fromCoverage : fromAssets });
        } else if (r && r[2] && r[2].assets) {
          setCov({ coverage: null, assets: r[2].assets });
        }
        setErr(failures.join("；"));
      })
      .catch(function (e) { setErr(String((e && e.message) || e)); })
      .then(function () { busyRef.current = false; });
  }, [api]);

  useEffect(function () { refresh(); }, [refresh]);
  useEffect(function () {
    if (!auto) return undefined;
    var t = setInterval(function () {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    }, 3000);
    return function () { clearInterval(t); };
  }, [auto, refresh]);

  // 会话哨兵：切会话 / 首次挂载时 sessions 尚未就绪（current 从 undefined 变为真实 id）都要重新取数。
  // 轮询只在开启自动刷新时跑，这条 1s 的轻量哨兵负责"当前会话 id 变了"这一事件（顺带盯主题切换）。
  var sidRef = useRef(null);
  var darkRef = useRef(false);
  darkRef.current = isDark;
  useEffect(function () {
    var t = setInterval(function () {
      var dark = detectDarkTheme();
      if (dark !== darkRef.current) { darkRef.current = dark; setIsDark(dark); }
      var sid = readSessionId(propsRef.current && propsRef.current.sessionsStore);
      if (sid === sidRef.current) return;
      sidRef.current = sid;
      if (sid) refresh();
    }, 1000);
    return function () { clearInterval(t); };
  }, [refresh]);

  var findings = useMemo(function () { return extractFindings(graph || {}); }, [graph]);
  var assets = useMemo(function () { return extractAssets(graph || {}); }, [graph]);
  var dead = useMemo(function () { return extractDeadEnds(graph || {}); }, [graph]);
  var sev = useMemo(function () { return severityCounts(findings); }, [findings]);
  var covView = useMemo(function () { return coverageView(cov || {}); }, [cov]);
  // ⚠️ **所有 hook 必须在任何 return 之前调用**：computeLayout 是 hook，
  // 早先它被放在 `if (!graph) return …` 之后 —— 首帧（graph=null）不调用它、有数据后再调用，
  // 两次渲染的 hook 数量不一致 → React 报 **error #310（Rendered more hooks than during the previous render）**，
  // 浏览器里就是整块面板空白。这里把它提到最前面，和其余 hook 排在一起。
  var covAssetsForLayout = (cov && cov.assets) || [];
  var layout = useMemo(
    function () { return computeLayout(graph || { facts: [], intents: [] }, (cov && cov.coverage) || null, covAssetsForLayout); },
    [graph, cov]
  );
  // ── 全屏：优先浏览器 Fullscreen API；不可用或被策略拒绝时退化为 CSS 全屏 ──
  // DSH Web 可能受 iframe/CSP 限制导致 requestFullscreen reject，所以必须有 CSS 兜底，
  // 否则「全屏」按钮点了没反应。
  var canUseFsApi = function () {
    return typeof document !== "undefined" && document.documentElement &&
      typeof document.documentElement.requestFullscreen === "function";
  };
  // 适应窗口：按**当前容器**算缩放（比例算法在 pure.fitZoom 里，可离线断言），
  // 并让图在容器里居中（.dsh-vc-canvas > svg{margin:auto} 兜）。
  // 下限放到 0.12：真实作业里资产上百个（列很多），0.3 的下限会让"整张图"根本装不下。
  var fitView = function () {
    var el = canvasRef.current;
    var l = layout || {};
    var box = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    if (!box || !box.width || !box.height) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    setZoom(fitZoom(l.width || 800, l.height || 600, box.width, box.height));
    setPan({ x: 0, y: 0 });
  };
  // 进全屏那一刻量到的还是**旧容器**的尺寸（React 还没重渲染、浏览器也还没完成全屏切换），
  // 于是缩放会按小窗口算 → 全屏后图缩在左上角、其余是一大片空底色。
  // 这里把 fitView 存进 ref，进全屏后再补几次（rAF + 定时 + resize），每次都用最新容器尺寸。
  var fitRef = useRef(null);
  fitRef.current = fitView;
  var enterFs = function () { setIsFs(true); fitView(); };
  var exitFs = function () {
    setIsFs(false);
    if (canUseFsApi() && document.fullscreenElement && typeof document.exitFullscreen === "function") {
      try { document.exitFullscreen(); } catch (e) { /* 忽略 */ }
    }
  };
  var toggleFs = function () {
    if (isFs) { exitFs(); return; }
    var el = rootRef.current;
    if (canUseFsApi() && el && typeof el.requestFullscreen === "function") {
      try {
        var p = el.requestFullscreen();
        if (p && typeof p.then === "function") p.then(enterFs, enterFs);   // 被拒也照样进 CSS 全屏
        else enterFs();
      } catch (e) { enterFs(); }
    } else {
      enterFs();
    }
  };
  // 系统侧退出（Esc / 切窗口）后同步状态；CSS 兜底态下 Esc 也能退
  useEffect(function () {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return undefined;
    var onFsChange = function () { if (canUseFsApi() && !document.fullscreenElement && isFs) setIsFs(false); };
    var onKey = function (e) { if (e && e.key === "Escape" && isFs && !(canUseFsApi() && document.fullscreenElement)) exitFs(); };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("keydown", onKey);
    return function () {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [isFs]);
  // 全屏期间按**新容器**补算缩放（rAF + 120ms + 420ms 三次，覆盖浏览器全屏过渡；再挂 resize）
  useEffect(function () {
    if (!isFs) return undefined;
    var timers = [], raf = null;
    var refit = function () { if (fitRef.current) fitRef.current(); };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      raf = window.requestAnimationFrame(refit);
    }
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      timers.push(window.setTimeout(refit, 120));
      timers.push(window.setTimeout(refit, 420));
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("resize", refit);
    return function () {
      if (raf !== null && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(raf);
      if (typeof window !== "undefined" && typeof window.clearTimeout === "function") timers.forEach(function (t) { window.clearTimeout(t); });
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("resize", refit);
    };
  }, [isFs]);

  var counts = (summary && summary.counts) || {};

  // 渲染期自保：面板的取值全部基于宿主下发的字段，字段形状一变就可能在构建元素时抛错
  // （React 里表现为**整块面板空白**，用户看不出原因）。这里兜住并给出可操作的提示。
  try {

  var onAddHint = function () {
    var text = String(hint || "").trim();
    if (!text || !graph || !graph.project) return;
    api.addHint(graph.project.id, text, "Human")
      .then(function () { setHint(""); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  var onDropIntent = function (intentId) {
    if (!graph || !graph.project) return;
    if (typeof window !== "undefined" && !window.confirm("取消方向 " + intentId + "？（会在图上记为死路）")) return;
    api.dropIntent(graph.project.id, intentId, "面板取消")
      .then(function () { setSel(null); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  var onCopy = function () {
    var md = findingsMarkdown(graph || {});
    try { navigator.clipboard.writeText(md).then(function () { setErr(""); }, function () { setErr("复制失败：浏览器拒绝剪贴板访问"); }); }
    catch (e) { setErr("复制失败：" + ((e && e.message) || e)); }
  };

  // ── 删除该面板 ────────────────────────────────────────────────────────────
  // 删的是**当前显示的那一块作战面板**（本会话的，或从「会话」下拉里点开的历史项目）：
  // 项目 + 它名下的事实/意图/提示/资产/检查矩阵/未测面。不可逆 → 双击确认 + 服务端先落库备份。
  var onDeletePanel = function () {
    var id = (graph && graph.project && graph.project.id) || pinned || ownId || null;
    if (!id) {
      setNotice("当前没有面板可删：本会话还没有黑板，先让总控 bb_project_init 建立。");
      return;
    }
    var c = counts || {};
    var title = (graph && graph.project && graph.project.title) || id;
    var assets = (covView && covView.counts && covView.counts.assets) || 0;
    var msg = "删除作战面板 " + id + "（" + title + "）？\n\n"
      + "会一并删掉它的：事实 " + (c.facts || 0) + " · 意图 " + (c.open || 0) + " open / " + (c.claimed || 0) + " claimed / " + (c.dead || 0) + " dead"
      + " · 提示 " + (c.hints || 0) + " · 资产 " + assets + " · 六张检查矩阵 · 未测面\n\n"
      + "不可逆（服务端会先自动落一份 blackboard.backup-<时间>.db 备份）。\n确定删除吗？";
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(msg)) return;
    setNotice("正在删除面板 " + id + " ……");
    api.deleteProject(id)
      .then(function (r) {
        if (pinned === id) { writePin(null); setPin(null); pinRef.current = null; }
        setSel(null);
        setGraph(null);
        setSummary(null);
        setCov(null);
        setErr("");
        setNotice("已删除作战面板 " + id + "（" + (r && r.title ? r.title : "") + "）：事实 " + ((r && r.deleted && r.deleted.facts) || 0)
          + " · 意图 " + ((r && r.deleted && r.deleted.intents) || 0)
          + " · 提示 " + ((r && r.deleted && r.deleted.hints) || 0)
          + " · 资产 " + ((r && r.deleted && r.deleted.assets) || 0)
          + " · 检查行 " + ((r && r.deleted && r.deleted.assetChecks) || 0)
          + " · 未测面 " + ((r && r.deleted && r.deleted.untested) || 0)
          + "。备份：" + ((r && r.backupPath) || "（未落备份）"));
        return refresh();
      })
      .catch(function (e) { setErr("删除失败：" + ((e && e.message) || e)); setNotice(""); });
  };
  var onHardReload = function () {    setNotice("正在强刷页面……");
    try {
      if (typeof location !== "undefined" && typeof location.replace === "function") {
        var u = String(location.href || "").split("#")[0].split("?")[0];
        location.replace(u + "?vore_reload=" + Date.now());   // 换 URL → 浏览器必须重新取 index.html 与 bundle
        return;
      }
    } catch (e) { /* 落到下面的提示 */ }
    setNotice("这个环境不允许脚本改地址栏：请按 Ctrl+F5 强制刷新（会重新下载 client.js）。");
  };

  // ── 按会话分类：本会话的黑板 / 人类点开的历史项目 ──────────────────────────
  var sid = readSessionId(props && props.sessionsStore) || readSessionId(propsRef.current && propsRef.current.sessionsStore) || "";
  var pview = projectsView(projects || {}, { sessionId: sid, labelOf: function (id) { return sessionLabel(propsRef.current, id); } });
  var currentProjectId = (graph && graph.project && graph.project.id) || null;
  // 本会话的项目 id：优先用清单里的 mineId；清单拿不到（老宿主没有 /projects）时，
  // 用 /graph 回来的 scope（source=session 就说明这张图正是本会话的）。
  var scopeNow = scopeRef.current || null;
  var ownId = pview.mineId || (scopeNow && scopeNow.source === "session" ? currentProjectId : null);
  var pinned = pin && pin !== ownId ? pin : null;   // 钉的正好是本会话项目 = 没钉
  var ownTitle = pview.mine ? pview.mine.title : ((graph && graph.project && graph.project.title) || ownId || "");
  var switchTo = function (id) {
    var next = id && id !== ownId ? String(id) : null;
    writePin(next);
    setPin(next);
    setSel(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTimeout(function () { refresh(); }, 0);
  };
  var onCreateProject = function () {
    var origin = String(newOrigin || "").trim();
    var goal = String(newGoal || "").trim();
    if (!origin && !goal) return;
    var cwdSnap = null;
    try {
      var store = propsRef.current && propsRef.current.sessionsStore;
      var snap = store && store.list && typeof store.list.getSnapshot === "function" ? store.list.getSnapshot() : null;
      cwdSnap = snap && snap.byId && snap.byId[sid] ? snap.byId[sid].cwd ?? null : null;
    } catch (e) { cwdSnap = null; }
    writePin(null); setPin(null);
    api.createProject({ sessionId: sid || null, cwd: cwdSnap, title: origin.slice(0, 60), origin: origin, goal: goal })
      .then(function () { setNewOrigin(""); setNewGoal(""); return refresh(); })
      .catch(function (e) { setErr(String((e && e.message) || e)); });
  };
  // 一个会话一个项目：本会话没黑板时不能借别人的图，只能显式点开历史项目（钉住）
  var projectPicker = h("span", { className: "dsh-vc-picker" },
    h("span", { className: "dsh-vc-hint", style: { margin: 0 } }, "会话"),
    h("select", {
      className: "dsh-vc-select", value: pinned || (ownId || ""), title: "按会话分：选一个会话/项目看它的作战面板",
      onChange: function (ev) { switchTo(ev && ev.target ? ev.target.value : ""); },
    },
      h("option", { value: ownId || "" },
        ownId ? "本会话：" + (ownTitle || ownId) : "本会话（还没有黑板）"),
      pview.others.map(function (g) {
        var rows = g.rows.filter(function (r) { return r.id !== ownId; });
        if (!rows.length) return null;
        var label = (g.label || "会话") + " · " + rows.length + " 个项目";
        return h("optgroup", { key: g.key, label: label },
          rows.map(function (r) {
            return h("option", { key: r.id, value: r.id },
              r.title + "（" + (r.phase || "-") + " · 资产 " + r.counts.assets + " · 事实 " + r.counts.facts + "）");
          }));
      })),
    pinned
      ? h("button", { className: "dsh-vc-btn", onClick: function () { switchTo(""); }, title: "回到本会话的黑板" }, "回到本会话")
      : null);

  var phaseBadge = cov && cov.coverage
    ? h("span", { className: "dsh-vc-badge" + (covView.canAdvance ? " is-ok" : "") },
      "阶段 " + covView.phase + " · 浅 " + covView.pct.shallow + "% · 深 " + covView.pct.deep + "%")
    : null;

  var bar = h("div", { className: "dsh-vc-bar" },
    h("span", { className: "dsh-vc-title" }, (graph && graph.project && graph.project.title) || "作战面板"),
    h("span", { className: "dsh-vc-badge" + (graph && graph.project && graph.project.status === "active" ? " is-ok" : "") },
      (graph && graph.project && graph.project.status) || "未建项目"),
    projectPicker,
    h("span", { className: "dsh-vc-goal", title: (graph && graph.project && graph.project.goal) || "" },
      graph && graph.project && graph.project.goal ? "goal：" + graph.project.goal : "（尚未建立黑板）"),
    h("span", { className: "dsh-vc-badge" }, "facts " + (counts.facts || 0)),
    h("span", { className: "dsh-vc-badge" }, "intents open " + (counts.open || 0) + "/claimed " + (counts.claimed || 0) + "/dead " + (counts.dead || 0)),
    h("span", { className: "dsh-vc-badge" }, "hints " + (counts.hints || 0)),
    phaseBadge,
    h("div", { className: "dsh-vc-tabs" },
      h("button", { className: "dsh-vc-tab" + (tab === "live" ? " is-on" : ""), onClick: function () { setTab("live"); } }, "实时情况"),
      h("button", { className: "dsh-vc-tab" + (tab === "summary" ? " is-on" : ""), onClick: function () { setTab("summary"); } }, "任务汇总"),
      h("button", { className: "dsh-vc-tab" + (tab === "coverage" ? " is-on" : ""), onClick: function () { setTab("coverage"); } }, "覆盖矩阵"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setAuto(!auto); } }, auto ? "自动刷新：开" : "自动刷新：关"),
      h("button", { className: "dsh-vc-btn", onClick: refresh }, "立即刷新"),
      h("button", {
        className: "dsh-vc-btn dsh-vc-btn-danger", onClick: onDeletePanel,
        title: (currentProjectId ? "删除当前显示的作战面板（" + currentProjectId + "）与其全部数据" : "当前没有面板可删"),
      }, "删除该面板"),
      h("button", { className: "dsh-vc-btn", onClick: onHardReload, title: "带时间戳重载页面 → 强制重新下载 client.js（等于 Ctrl+F5）" }, "强刷页面"),
      h("button", { className: "dsh-vc-btn", onClick: toggleFs, title: "全屏看整张图（Esc 退出）" }, isFs ? "退出全屏" : "全屏"))
  );

  var rootProps = { className: "dsh-vc-root" + (isFs ? " is-fs" : "") + (isDark ? " is-dark" : ""), ref: rootRef };

  if (!graph) {
    // 本会话还没有黑板（或钉的项目已被删）：**不借别人的图**，把「按会话分类」的清单摆出来让人点。
    var pickerRow = function (r) {
      return h("div", {
        key: "proj-" + r.id, className: "dsh-vc-projrow" + (r.id === currentProjectId ? " is-on" : ""),
        onClick: function () { switchTo(r.id); },
      },
        h("span", { className: "dsh-vc-mono" }, r.id),
        h("span", { style: { flex: 1, fontWeight: 600 } }, r.title),
        h("span", { className: "dsh-vc-kind" }, (r.phase || "-") + " · 资产 " + r.counts.assets + " · 事实 " + r.counts.facts + " · 意图 " + r.counts.intents),
        h("span", { className: "dsh-vc-kind" }, r.updatedAt ? String(r.updatedAt).slice(0, 16).replace("T", " ") : ""));
    };
    return h("div", rootProps, bar,
      err ? h("div", { className: "dsh-vc-err" }, err) : null,
      h("div", { className: "dsh-vc-scroll" },
        h("div", { className: "dsh-vc-empty" },
          h("div", { style: { fontWeight: 600 } }, "本会话还没有黑板（一个会话一个项目）"),
          h("div", { className: "dsh-vc-hint" },
            "本会话 id：" + (sid ? shortSession(sid) : "（宿主尚未给出会话 id）")
            + "。让总控调 bb_project_init 写清 origin 与 goal，这张图就会长出来；"
            + "想先看别的会话测过的项目，用上面的下拉框或下面清单点进去（点开的是历史项目，本会话的新测试仍从自己的空黑板开始）。")),
        h("div", { className: "dsh-vc-projnew" },
          h("span", { className: "dsh-vc-hint", style: { margin: 0 } }, "或直接给本会话建黑板："),
          h("input", {
            className: "dsh-vc-in", style: { maxWidth: "320px" }, value: newOrigin, placeholder: "origin：授权目标与范围（域名/IP/路径）",
            onChange: function (ev) { setNewOrigin(ev && ev.target ? ev.target.value : ""); },
          }),
          h("input", {
            className: "dsh-vc-in", style: { maxWidth: "380px" }, value: newGoal, placeholder: "goal：要交付的成果",
            onChange: function (ev) { setNewGoal(ev && ev.target ? ev.target.value : ""); },
          }),
          h("button", { className: "dsh-vc-btn", onClick: onCreateProject }, "建立本会话黑板")),
        h("h4", null, "历史项目（按会话归类：" + pview.groups.length + " 个会话 / " + pview.total + " 个项目）"),
        pview.groups.map(function (g) {
          var gl = String(g.label || g.key);
          var tail = g.short && !g.mine && gl.indexOf(g.short) < 0 ? "（会话 " + g.short + "）" : "";
          return h("div", { key: "grp-" + g.key, style: { marginTop: 6 } },
            h("div", { className: "dsh-vc-hint", style: { margin: 0 } },
              (g.mine ? "本会话 · " : "") + gl + tail + " · " + g.rows.length + " 个项目"),
            g.rows.map(pickerRow));
        }),
        h("div", { className: "dsh-vc-hint" },
          "打开历史项目 = 只读地看它那张图（顶栏会出现「回到本会话」）。新会话要测新目标，就让总控在本会话里 bb_project_init 建新项目 —— 不会覆盖、也不会串到上一个会话的图上。")));
  }

  // ── SVG 图（八条泳道，从上到下：
  //   ① 起点 → ② 信息收集 → ③ 浅层 → ④ 中间层 → ⑤ 深层 → ⑥ 线索 → ⑦ 死点 → ⑧ 成果）─
  // 资产节点来自 /coverage（或 /assets）的资产清单；缺字段时退回 s2/s3 兜底（旧数据不白屏）。
  // 注意：layout 是 **hook**，必须在上方（任何 return 之前）计算，这里只取别名。
  var covAssetsAll = covAssetsForLayout;
  void layout;

  // 阶段序号徽标：① ② ③ …（**不用 P1–P6**，免得和作业法的六阶段号混）
  var ORD = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  var stageNo = function (lane) {
    var i = (covView.lanes || []).findIndex(function (l) { return l.key === (lane && lane.key); });
    return ORD[i < 0 ? 0 : i] || "·";
  };
  var laneTitleText = function (lane) {
    // 「线索」「死点」不是覆盖矩阵：只显示条数，不显示 n/m（0/0 是误导）
    if (lane.counted) return stageNo(lane) + " " + (lane.label || "");
    var hasNum = (lane.done || 0) + (lane.required || 0) > 0;
    return stageNo(lane) + " " + (lane.label || "") + (hasNum ? "　" + lane.done + "/" + lane.required + "（" + lane.pct + "%）" : "");
  };
  var laneSubText = function (lane) {
    var parts = [];
    if (lane.hint) parts.push(lane.hint);
    // 「线索」「死点」是按条数计的，不是覆盖矩阵 → 不挂"指标按资产清单就地汇总"这句
    if (lane.derived && !lane.counted) parts.push("指标按资产清单就地汇总");
    return parts.join(" · ");
  };

  var svgChildren = [];

  // ① 泳道背景条 + 泳道标题（背景条在最底层，节点与边画在它上面）
  (layout.lanes || []).forEach(function (lane, i) {
    var laneTop = lane.y != null ? lane.y : PAD + i * 100;
    var laneH = lane.h != null ? lane.h : 60;
    var bandW = Math.max(layout.laneWidth || layout.width - PAD * 2, 320);
    var parts = [
      h("rect", {
        x: PAD - 14, y: laneTop, width: bandW + 28, height: laneH, rx: 10,
        fill: i % 2 ? "var(--vore-lane-b,rgba(125,142,163,.11))" : "var(--vore-lane-a,rgba(58,157,255,.07))",
        stroke: lane.key === "dead" ? "#6e8098" : "rgba(125,142,163,.45)",
        strokeWidth: 1, strokeDasharray: lane.key === "dead" ? "4 4" : null,
      }),
      h("line", {
        x1: PAD - 6, y1: laneTop + 18, x2: PAD - 6 + bandW, y2: laneTop + 18,
        stroke: "rgba(125,142,163,.38)", strokeWidth: 1,
      }),
      // 泳道标题：fill 写死（SVG 文本默认黑色，深色底上会看不见）
      h("text", {
        x: PAD - 8, y: laneTop + 14, className: "dsh-vc-lanetitle",
        fill: "var(--vore-ink,#0f1c2e)", style: { fontSize: "14px", fontWeight: 700 },
      }, laneTitleText(lane)),
      laneSubText(lane)
        ? h("text", {
          x: PAD + 230, y: laneTop + 14, className: "dsh-vc-lanesub",
          fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px" },
        }, laneSubText(lane))
        : null,
    ];
    // 分组泳道（线索）：组名 + 一条分隔线，已确认 / 未确认 一眼分得开
    (lane.subRows || []).forEach(function (sub, si) {
      var sep = PAD - 6 + bandW;
      parts.push(h("text", {
        key: "grp:" + lane.key + ":" + sub.key, x: PAD - 4, y: sub.y + 13, className: "dsh-vc-grouptitle",
        fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px", fontWeight: 600 },
      }, (sub.label || "") + "（" + sub.count + "）"));
      parts.push(h("line", {
        key: "grpl:" + lane.key + ":" + sub.key, x1: PAD + 190, y1: sub.y + 9, x2: sep, y2: sub.y + 9,
        stroke: "rgba(125,142,163,.3)", strokeWidth: 1, strokeDasharray: "3 3",
      }));
      void si;
    });
    svgChildren.push(h("g", { key: "lane:" + (lane.id || i), "data-lane": lane.key + "|" + lane.label }, parts));
  });

  // ② 边：intent 的 from→to（concluded 实线 / dead 灰虚线 / pending 虚线）+ 资产跨泳道的纵向连线
  layout.edges.forEach(function (e) {
    var a = layout.byId.get(e.from), b = layout.byId.get(e.to);
    if (!a || !b) return;
    var stroke = edgeColor(e);
    var dash = e.kind === "concluded" ? null : e.kind === "dead" ? "2 4" : "5 4";
    var sameCol = a.x === b.x;
    var d, lx, ly;
    if (sameCol) {
      // 同一列（同一资产的上下游泳道 / 起点→浅层）：画一条纯纵向连线
      var x0 = a.x + a.w / 2, yTop = a.y + a.h, yBot = b.y;
      var down = yBot >= yTop;
      d = "M " + x0 + " " + (down ? yTop : a.y) + " L " + x0 + " " + (down ? yBot : b.y + b.h);
      lx = x0 + 8; ly = ((down ? yTop + yBot : a.y + b.y + b.h) / 2);
    } else {
      // 不同列：纵向线段 + 横向连接（自上而下）
      var x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
      if (y2 < y1) { y1 = a.y; y2 = b.y + b.h; }
      var midY = (y1 + y2) / 2;
      d = "M " + x1 + " " + y1 + " L " + x1 + " " + midY + " L " + x2 + " " + midY + " L " + x2 + " " + y2;
      lx = (x1 + x2) / 2; ly = midY - 3;
    }
    svgChildren.push(h("path", {
      key: e.id, d: d, fill: "none", stroke: stroke, strokeWidth: e.laneEdge ? 1.1 : 1.4,
      strokeDasharray: dash, opacity: e.laneEdge ? 0.55 : 0.85,
    }));
    if (e.intent) {
      svgChildren.push(h("text", {
        key: e.id + ":lbl", x: lx, y: ly, textAnchor: "middle",
        style: { fontSize: "10px" }, fill: stroke, opacity: 0.95,
      }, intentLabel(e.intent)));
    }
  });

  // ③ 节点
  layout.nodes.forEach(function (n) {
    var st = factStyle(n.fact, n.kind);
    var isPlaceholder = n.kind === "pending" || n.kind === "dead";
    var isAsset = n.kind === "lane";
    var isSel = sel && sel.id === n.id;
    var asset = n.asset || {};
    var desc, idText, subText;
    if (isAsset) {
      desc = String(asset.label || asset.value || "").slice(0, 20);
      idText = String(asset.id || "") + " · " + String(asset.value || "").slice(0, 18);
      subText = n.metric || "";
    } else if (isPlaceholder) {
      desc = String((n.intent && n.intent.description) || (n.fact && n.fact.description) || "").slice(0, 20);
    } else {
      desc = String((n.fact && n.fact.description) || "").replace(/^任务起点：|^任务目标：/, "").slice(0, 20);
    }
    if (!isAsset) {
      idText = n.kind === "pending" ? "待探索 " + ((n.intent && n.intent.id) || "")
        : n.kind === "dead" ? "死点 " + ((n.intent && n.intent.id) || (n.fact && n.fact.id) || "")
          : ((n.fact && n.fact.id) || n.id) + (n.fact && n.fact.severity ? " · " + n.fact.severity : "");
      subText = n.laneCap || "";
    }
    var subColor = n.wrong ? "#e5484d" : n.hits ? "#f76808" : null;
    var strokeColor = isSel ? "#2fd4a7" : (isAsset && n.wrong ? "#e5484d" : st.stroke);
    // 节点文字写死 fill（SVG 文本默认黑色 → 深色底上等于隐身）；第三行用指标色时覆盖
    svgChildren.push(h("g", { key: n.id, className: "dsh-vc-node", onClick: function () { setSel({ id: n.id, node: n }); } },
      h("rect", {
        x: n.x, y: n.y, width: n.w, height: n.h, rx: 8, fill: st.fill,
        stroke: strokeColor, strokeWidth: isSel ? 2.2 : (isAsset && n.wrong ? 1.8 : 1.2), strokeDasharray: st.dash,
      }),
      h("text", { x: n.x + 8, y: n.y + 16, className: "dsh-vc-nid", fill: "var(--vore-ink,#0f1c2e)" }, idText),
      h("text", { x: n.x + 8, y: n.y + 32, fill: "var(--vore-ink,#0f1c2e)" }, desc),
      h("text", {
        x: n.x + 8, y: n.y + 47, className: "dsh-vc-nid",
        fill: subColor || "var(--vore-muted,#45586e)", style: subColor ? { opacity: 1 } : null,
      }, subText)));
  });

  // ④ 死点区：死点现在有自己的**泳道**（老契约的右侧灰框只在老 payload 里才有内容）
  var dz = layout.deadZone || { nodes: [] };
  if (dz.nodes.length) {
    svgChildren.push(h("g", { key: "deadzone" },
      h("rect", {
        x: dz.x, y: dz.y, width: dz.w, height: dz.h, rx: 10,
        fill: "rgba(110,128,152,.06)", stroke: "#6e8098", strokeWidth: 1.2, strokeDasharray: "4 4",
      }),
      h("text", { x: dz.x + 12, y: dz.y + 18, className: "dsh-vc-deadtitle", fill: "var(--vore-muted,#45586e)", style: { fontSize: "12px" } },
        "死点 " + dz.nodes.length + "（死路意图 / 被推翻的结论）")));
  }

  var svg = h("svg", {
    viewBox: pan.x + " " + pan.y + " " + layout.width + " " + layout.height,
    style: { width: (layout.width * zoom) + "px", height: (layout.height * zoom) + "px", display: "block", color: "inherit" },
    onMouseDown: function (ev) { dragRef.current = { x: ev.clientX, y: ev.clientY, pan: { x: pan.x, y: pan.y } }; },
    onMouseMove: function (ev) {
      if (!dragRef.current) return;
      setPan({
        x: dragRef.current.pan.x - (ev.clientX - dragRef.current.x) / zoom,
        y: dragRef.current.pan.y - (ev.clientY - dragRef.current.y) / zoom,
      });
    },
    onMouseUp: function () { dragRef.current = null; },
    onMouseLeave: function () { dragRef.current = null; },
    onWheel: function (ev) { ev.preventDefault(); setZoom(Math.min(3, Math.max(MIN_ZOOM, zoom + (ev.deltaY > 0 ? -0.1 : 0.1)))); },
  }, svgChildren);

  // 画布 = 外层（定位工具条）+ 内层滚动容器。工具条钉在外层，所以**滚图 / 缩放都不会把它带走**。
  var canvas = h("div", { className: "dsh-vc-canvaswrap" },
    h("div", { className: "dsh-vc-canvas", ref: canvasRef }, svg),
    h("div", { className: "dsh-vc-canvasctl" },
      h("button", { className: "dsh-vc-btn", onClick: fitView, title: "按当前窗口重算缩放，整张图装进来" }, "适应窗口"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setZoom(Math.min(3, zoom + 0.15)); }, title: "放大" }, "＋"),
      h("button", { className: "dsh-vc-btn", onClick: function () { setZoom(Math.max(MIN_ZOOM, zoom - 0.15)); }, title: "缩小" }, "－"),
      h("span", { className: "dsh-vc-num" }, Math.round(zoom * 100) + "%")));

  // ── 右侧详情 ──────────────────────────────────────────────────────────────
  var openIntents = (summary && summary.openIntents) ||
    (graph.intents || []).filter(function (i) { return !i.concluded_at && !i.dead; });
  var selIsPlaceholder = sel && sel.node && (sel.node.kind === "pending" || sel.node.kind === "dead");
  // 选中资产：覆盖矩阵里点进来的（from=coverage），或图上点中的资产节点（node.asset）
  var selAssetObj = sel ? ((sel.from === "coverage" ? sel.node : null) || (sel.node && sel.node.asset) || null) : null;
  var selAssetId = selAssetObj ? selAssetObj.id : null;

  // 该资产六张矩阵的逐项状态（key 用中文名，状态也翻成中文）
  var selAssetMatrices = function (a) {
    var checks = (a && a.checks) || {};
    var sums = (a && a.checkSummary) || {};
    return (covView.matrices || []).map(function (m) {
      var stage = checks[m.key] && typeof checks[m.key] === "object" ? checks[m.key] : {};
      var keys = Object.keys(stage);
      var s = sums[m.key] && typeof sums[m.key] === "object" ? sums[m.key] : null;
      return h("div", { key: "selmx-" + m.key, style: { marginTop: 6 } },
        h("h4", null, "矩阵 " + m.label + "（" + m.lane + "）" + (s ? "　" + (s.done || 0) + "/" + (s.required || 0) : "")),
        keys.length
          ? keys.map(function (k) {
            return h("div", { key: k, className: "dsh-vc-mono" }, checkKeyLabel(k) + "：" + statusLabel(stage[k]));
          })
          : h("div", { className: "dsh-vc-hint" }, "未记录检查项（后端没给 checks）"));
    });
  };

  // 右侧栏宽度：拖动条分隔条改宽度（往左拖变宽），夹在 [ASIDE_MIN, 面板宽度-320] 之间；
  // 双击复位成默认 330；点箭头收起/展开（收起时只留一条窄条，图占满）。
  var clampAside = function (w) {
    var max = 900;
    try {
      var rw = rootRef.current && rootRef.current.clientWidth;
      if (rw) max = Math.max(ASIDE_MIN + 40, rw - 320);   // 左边给画布留至少 320
    } catch (e) { /* 量不到就用默认上限 */ }
    return Math.max(ASIDE_MIN, Math.min(max, Math.round(Number(w) || ASIDE_DEFAULT)));
  };
  var onSplitDown = function (ev) {
    if (!ev || typeof ev.preventDefault === "function") ev && ev.preventDefault();
    var startX = Number(ev && ev.clientX) || 0;
    var startW = asideRef.current || ASIDE_DEFAULT;
    var move = function (e) {
      var x = Number(e && e.clientX);
      if (!Number.isFinite(x)) return;
      setAsideWidth(clampAside(startW - (x - startX)));      // 分隔条往左 → 右栏变宽
    };
    var up = function () {
      try {
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
        }
      } catch (e) { /* 忽略 */ }
      writeAsideWidth(asideRef.current);                       // 拖完才落盘，避免每帧写 localStorage
    };
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      }
    } catch (e) { /* 无 document（离线测试）时只改这一次 */ }
    setAsideWidth(clampAside(startW));
  };
  var resetAside = function () { setAsideWidth(clampAside(ASIDE_DEFAULT)); writeAsideWidth(ASIDE_DEFAULT); };
  var asideSplit = h("div", {
    className: "dsh-vc-split" + (asideCollapsed ? " is-collapsed" : ""),
    title: "拖动调整右栏宽度（往左拖变宽；双击复位 " + ASIDE_DEFAULT + "px；点箭头收起/展开）",
    onMouseDown: onSplitDown,
    onDoubleClick: resetAside,
  },
    h("button", {
      className: "dsh-vc-splitbtn",
      title: asideCollapsed ? "展开右侧详情栏" : "收起右侧详情栏",
      onMouseDown: function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); },
      onClick: function (ev) { if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation(); setAsideCollapsed(!asideCollapsed); },
    }, asideCollapsed ? "⟨" : "⟩"));

  var aside = h("aside", {
    className: "dsh-vc-aside" + (asideCollapsed ? " is-collapsed" : ""),
    style: { width: (asideCollapsed ? 0 : asideWidth) + "px" },
  },
    selAssetObj ? h("div", null,
      h("h4", null, "选中资产"),
      h("div", { className: "dsh-vc-mono" }, String(selAssetObj.id || "")),
      h("div", { style: { marginTop: 4, whiteSpace: "pre-wrap" } }, selAssetObj.label || selAssetObj.value || "-"),
      h("div", { className: "dsh-vc-hint" }, sel.from === "coverage" ? "来源：覆盖矩阵" : "来源：图上资产节点"),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "类别"), h("div", { className: "dsh-vc-mono" }, (selAssetObj.kind || "-") + " · priority " + (selAssetObj.priority == null ? 3 : selAssetObj.priority))),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "价值 / 标识"), h("div", { className: "dsh-vc-mono" }, selAssetObj.value || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "技术栈"), h("div", null, selAssetObj.tech || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "浅测 / 深测"),
        h("div", null, "浅测 s2：" + (selAssetObj.s2 || "pending") + "（" + (stageDone(selAssetObj.s2) ? "已覆盖" : "未覆盖") + "）"),
        h("div", null, "深测 s3：" + (selAssetObj.s3 || "pending") + "（" + (deepEligible(selAssetObj) ? "priority ≥ 3，需深测" : "priority < 3，不要求深测") + "）")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "证据"), h("div", { className: "dsh-vc-mono" }, selAssetObj.evidence || "-")),
      h("div", { style: { marginTop: 6 } }, h("h4", null, "备注"), h("div", null, selAssetObj.notes || "-")),
      h("div", { style: { marginTop: 8 } }, h("h4", null, "六张矩阵逐项状态（" + (covView.matrices || []).length + "）"), selAssetMatrices(selAssetObj)),
      h("button", { className: "dsh-vc-btn", style: { marginTop: 8 }, onClick: function () { setSel(null); } }, "取消选中"))
      : sel ? h("div", null,
      h("h4", null, "选中对象"),
      h("div", { className: "dsh-vc-mono" }, sel.id),
      h("div", { style: { marginTop: 4, whiteSpace: "pre-wrap" } },
        selIsPlaceholder ? (sel.node.intent && sel.node.intent.description) : (sel.node.fact && sel.node.fact.description)),
      sel.node && sel.node.intent && sel.node.intent.note
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "备注"), h("div", null, sel.node.intent.note)) : null,
      sel.node && sel.node.fact && sel.node.fact.evidence
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "证据"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.evidence)) : null,
      sel.node && sel.node.fact && sel.node.fact.target
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "目标"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.target)) : null,
      sel.node && sel.node.fact && sel.node.fact.poc
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "POC"), h("div", { className: "dsh-vc-mono" }, sel.node.fact.poc)) : null,
      sel.node && sel.node.fact && sel.node.fact.fix
        ? h("div", { style: { marginTop: 6 } }, h("h4", null, "修复建议"), h("div", null, sel.node.fact.fix)) : null,
      sel.node && sel.node.intent
        ? h("div", { style: { marginTop: 8 } }, h("h4", null, "操作"),
          sel.node.kind === "pending"
            ? h("button", { className: "dsh-vc-btn", onClick: function () { onDropIntent(sel.node.intent.id); } }, "取消该方向（记死路）") : null,
          h("div", { className: "dsh-vc-hint" }, "来源事实：" + (((sel.node.intent.from || []).join(", ")) || "-"))) : null,
      h("button", { className: "dsh-vc-btn", style: { marginTop: 8 }, onClick: function () { setSel(null); } }, "取消选中"))
      : h("div", { className: "dsh-vc-hint" }, "点击图上节点查看详情"),
    h("h4", null, "待认领意图（" + openIntents.length + "）"),
    openIntents.length
      ? openIntents.map(function (i) {
        return h("div", {
          key: i.id, className: "dsh-vc-row",
          onClick: function () { setSel({ id: "ph_" + i.id, node: { id: "ph_" + i.id, kind: "pending", intent: i } }); },
        },
          h("div", { className: "dsh-vc-mono" }, i.id + (i.domain ? " · " + i.domain : "") + (i.worker ? " · " + i.worker + " 认领中" : "")),
          h("div", null, String(i.description || "").slice(0, 60)));
      })
      : h("div", { className: "dsh-vc-hint" }, "无待认领方向"),
    h("h4", null, "人类提示（" + ((graph.hints || []).length) + "）"),
    (graph.hints || []).slice(-6).map(function (x) {
      return h("div", { key: x.id, className: "dsh-vc-row" },
        h("div", { className: "dsh-vc-mono" }, x.id + " · " + (x.creator || "Human")),
        h("div", null, String(x.content || "").slice(0, 90)));
    }),
    h("h4", null, "写一条提示"),
    h("input", {
      className: "dsh-vc-in", value: hint, placeholder: "范围 / 凭据 / 禁测项…",
      onChange: function (e) { setHint(e.target.value); },
      onKeyDown: function (e) { if (e.key === "Enter") onAddHint(); },
    }),
    h("button", { className: "dsh-vc-btn", style: { marginTop: 6 }, onClick: onAddHint }, "提交提示"));

  // ── 任务汇总 ──────────────────────────────────────────────────────────────
  var sevBadge = function (s) { return h("span", { className: "dsh-vc-sev " + String(s || "").toLowerCase() }, s || "未定级"); };
  var summaryView = h("div", { style: { padding: "10px 12px", overflow: "auto", flex: 1 } },
    h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
      h("span", { className: "dsh-vc-badge" }, "成果 " + findings.length),
      h("span", { className: "dsh-vc-badge" }, "critical " + sev.critical),
      h("span", { className: "dsh-vc-badge" }, "high " + sev.high),
      h("span", { className: "dsh-vc-badge" }, "medium " + sev.medium),
      h("span", { className: "dsh-vc-badge" }, "low " + sev.low),
      h("button", { className: "dsh-vc-btn", style: { marginLeft: "auto" }, onClick: onCopy }, "复制 Markdown")),
    findings.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null,
          h("th", null, "ID"), h("th", null, "严重级"), h("th", null, "标题"), h("th", null, "目标"), h("th", null, "状态"), h("th", null, "证据"))),
        h("tbody", null, findings.map(function (f) {
          var row = h("tr", {
            key: f.id, className: "is-clik" + (openRow === f.id ? " is-on" : ""),
            onClick: function () { setOpenRow(openRow === f.id ? null : f.id); },
          },
            h("td", { className: "dsh-vc-mono" }, f.id),
            h("td", null, sevBadge(f.severity)),
            h("td", null, String(f.description || "").split("\n")[0].slice(0, 70)),
            h("td", { className: "dsh-vc-mono" }, f.target || "-"),
            h("td", null, f.status || f.confidence || "-"),
            h("td", { className: "dsh-vc-mono" }, f.evidence || "-"));
          if (openRow !== f.id) return row;
          return [row, h("tr", { key: f.id + ":d" }, h("td", { colSpan: 6, style: { whiteSpace: "pre-wrap", background: "rgba(58,157,255,.06)" } },
            String(f.description || "") + "\n\nPOC：" + (f.poc || "-") + "\n\n修复建议：" + (f.fix || "-") + "\n\n证据路径：" + (f.evidence || "-")))];
        })))
      : h("div", { className: "dsh-vc-empty" }, "尚无成果。子 agent 写 category=vuln 的事实（带 severity/target/poc/fix）后会出现在这里。"),
    h("h4", null, "资产与接口（" + assets.length + "）"),
    assets.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null, h("th", null, "ID"), h("th", null, "类别"), h("th", null, "描述"), h("th", null, "证据"))),
        h("tbody", null, assets.map(function (f) {
          return h("tr", { key: f.id },
            h("td", { className: "dsh-vc-mono" }, f.id), h("td", null, f.category),
            h("td", null, String(f.description || "").slice(0, 80)), h("td", { className: "dsh-vc-mono" }, f.evidence || "-"));
        })))
      : h("div", { className: "dsh-vc-hint" }, "无（子 agent 用 category=asset/endpoint/cred 登记）"),
    h("h4", null, "死路与未排除面（" + dead.length + "）"),
    dead.length
      ? dead.map(function (d) {
        return h("div", { key: d.id, className: "dsh-vc-row" },
          h("div", { className: "dsh-vc-mono" }, d.id),
          h("div", null, String(d.description || "").slice(0, 90)),
          d.note ? h("div", { className: "dsh-vc-hint" }, "← " + String(d.note).slice(0, 120)) : null);
      })
      : h("div", { className: "dsh-vc-hint" }, "无"));

  // ── 覆盖矩阵（这次作业测得全不全）──────────────────────────────────────────
  var covAssets = (cov && cov.assets) || [];

  // 缺口/类别表点一条 → 选中该资产：右侧详情栏显示它的完整字段
  var pickAsset = function (a) {
    if (a) setSel({ id: a.id, node: a, from: "coverage" });
  };

  var bar2 = function (pct, color) {
    return h("div", { className: "dsh-vc-track" },
      h("div", { className: "dsh-vc-fill", style: { width: Math.max(0, Math.min(100, Number(pct) || 0)) + "%", background: color } }));
  };

  var kindRow = function (k) {
    var hit = findAssetByValue(covAssets, k.kind, null) || covAssets.filter(function (a) { return String(a.kind) === k.kind; })[0] || null;
    return h("tr", {
      key: k.kind,
      className: hit ? "is-clik" + (selAssetId === hit.id ? " is-on" : "") : null,
      onClick: function () { pickAsset(hit); },
    },
      h("td", { className: "dsh-vc-mono" }, k.kind),
      h("td", null, String(k.total)),
      h("td", null, String(k.shallowDone) + "/" + String(k.total)),
      h("td", null, String(k.deepDone) + "/" + String(k.total)));
  };

  var gapRow = function (g) {
    var hit = findAssetByValue(covAssets, g.value, g.kind);
    return h("div", {
      key: g.id + ":" + g.stage, className: "dsh-vc-gap" + (selAssetId === (hit && hit.id) ? " is-on" : ""),
      onClick: function () { pickAsset(hit); },
    },
      h("span", { className: "dsh-vc-mono" }, g.id),
      h("span", { className: "dsh-vc-kind" }, "[" + g.kind + "]"),
      h("span", { style: { flex: 1, wordBreak: "break-all" } }, g.value),
      h("span", { className: "dsh-vc-st" }, "（" + g.stage + "）"),
      h("span", { className: "dsh-vc-st" }, "P" + (g.priority == null ? 3 : g.priority)));
  };

  // 六阶段各自的完成度 + 缺口（数据来自 /coverage 的 stages）
  var stageColor = function (pct) { return pct >= 100 ? "#2fd4a7" : pct >= 60 ? "#3a9dff" : pct >= 30 ? "#e8b931" : "#f76808"; };
  // 缺口点名用 `asset:key`（一眼看出是哪个资产的哪一项没做）
  var gapKeys = function (stage, limit) {
    var gaps = (stage && stage.gaps) || [];
    return gaps.slice(0, limit).map(function (g) { return (g.asset || g.assetId) + (g.key ? ":" + g.key : ""); }).join("、");
  };
  var stageRow = function (row) {
    var gapText = row.key === "start"
      ? (covView.sourcesMissing.length ? "来源未齐 " + covView.sourcesMissing.length + " 类" : "来源已齐")
      : row.gaps + " 个缺口";
    // 浅层 / 中间层各横跨两张矩阵，缺口两边的都要列
    var missing = (row.stageKeys || []).map(function (k) { return gapKeys(covView.stages[k], 2); }).filter(Boolean).join("、");
    return h("div", { className: "dsh-vc-stagerow", key: "stage-" + row.key },
      h("span", null, row.id + " " + row.label),
      bar2(row.pct, stageColor(row.pct)),
      h("span", { className: "dsh-vc-num" }, row.pct + "% · " + row.done + "/" + row.required),
      h("span", { className: "dsh-vc-st" }, "（" + gapText + "）"),
      missing ? h("span", { className: "dsh-vc-hint" }, "缺：" + missing) : null);
  };
  var reflowBanner = covView.reflow && covView.reflow.pending
    ? h("div", { className: "dsh-vc-block" },
      "⚠ 回灌未收轮：新增 " + covView.reflow.count + " 个资产（来源 " + (covView.reflow.source || "未知") + "）→ 已退回起点阶段：" +
      "先 bb_coverage {endRound:true} 再收一轮确认「连续 0 新增」，然后给这批新资产补六张矩阵（P2 信息收集 → P3 核实 + 浅层测试 → P4 核实 + OWASP → P5 深层）")
    : null;
  var stagesView = h("div", { className: "dsh-vc-stagewrap" },
    reflowBanner,
    (covView.counts.assets > 0 && !Object.keys(covView.stages).some(function (k) { return (covView.stages[k] && covView.stages[k].done) > 0; }))
      ? h("div", { className: "dsh-vc-block" },
        "六张矩阵全为 0：这个项目只登记了资产，还没开始逐资产检查。让总控用 bb_asset_checks {onlyGaps:true} 取缺口派单，" +
        "由各专业子 agent 落 bb_asset_check 行（信息收集 → 核实 → 浅层测试 → 核实 → OWASP → 深层）。")
      : null,
    h("h4", null, "六阶段完成度（起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果）"
      + "（「线索」「死点」不是阶段，只在图上成条，不进这张表）"
      + (covView.stageMissing ? "（后端未给 stages，已按进度字段兜底）" : "")),
    covView.phaseRows.map(stageRow));

  // 六张矩阵：各自完成度 + 缺口（缺 `asset:key` 点名）+ na 与「真测过」分开显示
  var matrixRow = function (m) {
    var named = gapKeys({ gaps: m.gaps }, 3);
    return h("div", { className: "dsh-vc-stagerow", key: "mx-" + m.key },
      h("span", null, "矩阵 " + m.label),
      bar2(m.pct, stageColor(m.pct)),
      h("span", { className: "dsh-vc-num" }, m.pct + "% · " + m.done + "/" + m.required),
      h("span", { className: "dsh-vc-st" }, "（缺口 " + m.gapCount + (m.gapShown ? "，点名前 " + Math.min(m.gapShown, 3) + " 条" : "") + "）"),
      h("span", { className: "dsh-vc-num" }, "na " + m.na + " · 真测过 " + m.tested),
      named ? h("span", { className: "dsh-vc-hint" }, "缺：" + named) : null);
  };
  var matricesView = h("div", { className: "dsh-vc-stagewrap" },
    h("h4", null, "六张覆盖矩阵（信息收集 / 核验信息收集 / 浅层测试 / 核验浅层 / OWASP 逐类测试 / 深层漏洞验证）"),
    (covView.matrices || []).map(matrixRow));

  // 未测面声明：明确「哪些面没测 + 为什么」，未声明的要显眼
  var untestedView = h("div", { className: "dsh-vc-na" },
    h("h4", null, "未测面（" + covView.untested.items.length + (covView.untested.declared ? "，已声明" : "，⚠ 未声明") + "）"),
    covView.untested.items.length
      ? covView.untested.items.map(function (u) {
        return h("div", { key: u.id || u.surface, className: "dsh-vc-row" },
          h("div", { className: "dsh-vc-mono" }, "[未测面] " + u.id + " · " + u.stage + " · " + u.surface),
          h("div", { className: "dsh-vc-hint" }, "未测原因：" + (u.why || "未写原因")));
      })
      : h("div", { className: "dsh-vc-hint" }, covView.untested.declared ? "已声明：无未测面" : "尚未声明未测面（P6 成果阶段必须写）"));

  // 复核进度：成果里的漏洞有多少被独立复核过
  var reviewsView = h("div", { className: "dsh-vc-na" },
    h("h4", null, "复核（" + covView.reviews.reviewed + "/" + covView.reviews.vuln + "）"),
    h("span", { className: "dsh-vc-num" }, "已复核 " + covView.reviews.reviewed + " · 待复核 " + covView.reviews.pending
      + (covView.counts.naNoReason ? " · na 无理由 " + covView.counts.naNoReason : "")),
    covView.reviews.pending
      ? h("span", { className: "dsh-vc-hint" }, "⚠ 还有 " + covView.reviews.pending + " 条成果没复核，P6 不能收口")
      : h("span", { className: "dsh-vc-hint" }, "全部成果已复核"));

  var coverageListView = h("div", { className: "dsh-vc-scroll" },
    // 阶段横幅
    h("div", { className: "dsh-vc-phase" },
      h("span", { className: "dsh-vc-title" }, "阶段 " + covView.label),
      h("span", { className: "dsh-vc-badge" + (covView.canAdvance ? " is-ok" : "") },
        covView.next ? "可推进到 " + covView.next + "：" + (covView.canAdvance ? "是" : "否") : "已是最后阶段"),
      covView.sourcesMissing.length
        ? h("span", { className: "dsh-vc-hint" }, "来源未齐：" + covView.sourcesMissing.join(" / ")) : null,
      covView.recon.rounds
        ? h("span", { className: "dsh-vc-num" }, "收集轮次 " + covView.recon.rounds + " · 本轮新增 " + covView.recon.addedThisRound) : null,
      covView.blockers.length
        ? h("div", { className: "dsh-vc-block" }, "阻塞项（" + covView.blockedBy + "）：" + covView.blockers.map(String).join("；"))
        : h("span", { className: "dsh-vc-hint" }, covView.next ? "无阻塞项" : "无下一阶段"),
      (covView.warnings || []).map(function (w, i) { return h("div", { key: "w" + i, className: "dsh-vc-hint" }, "提示：" + w); })),

    // 两条覆盖率
    h("div", { className: "dsh-vc-pct" },
      h("div", { className: "dsh-vc-pctrow" },
        h("span", null, "浅测覆盖"),
        bar2(covView.pct.shallow, "#3a9dff"),
        h("span", { className: "dsh-vc-num" }, covView.pct.shallow + "% · " + covView.counts.shallowDone + "/" + covView.counts.assets)),
      h("div", { className: "dsh-vc-pctrow" },
        h("span", null, "深测覆盖"),
        bar2(covView.pct.deep, "#2fd4a7"),
        h("span", { className: "dsh-vc-num" }, covView.pct.deep + "% · " + covView.counts.deepDone + "/" + covView.counts.deepTargets + "（priority ≥ 3）")),
      // na 也算覆盖（判定不适用），但它没有"真跑过"的证据强度：并列显示，别让 na 把数字刷满
      (covView.counts.naShallow || covView.counts.naDeep)
        ? h("div", { className: "dsh-vc-pctrow" },
          h("span", null, "其中 na"),
          h("span", { className: "dsh-vc-num" }, "浅测 " + covView.counts.naShallow + " · 深测 " + covView.counts.naDeep),
          h("span", { className: "dsh-vc-hint" }, "真测过：浅测 " + covView.pct.shallowTested + "% / 深测 " + covView.pct.deepTested + "%"
            + (covView.counts.naNoReason ? "；⚠️ " + covView.counts.naNoReason + " 个 na 没写理由" : "")))
        : null),

    // 六阶段完成度 / 六张矩阵 / 未测面 / 复核进度（P6 收口的判据）
    stagesView,
    matricesView,
    untestedView,
    reviewsView,

    h("div", { className: "dsh-vc-grid" },
      h("div", { className: "dsh-vc-col" },
        h("h4", null, "按类别（" + covView.byKind.length + " 类）"),
        covView.byKind.length
          ? h("table", { className: "dsh-vc-table" },
            h("thead", null, h("tr", null,
              h("th", null, "类别"), h("th", null, "总数"), h("th", null, "浅测完成"), h("th", null, "深测完成"))),
            h("tbody", null, covView.byKind.map(kindRow)))
          : h("div", { className: "dsh-vc-hint" }, "无资产（先跑资产收集）"),
        h("div", { className: "dsh-vc-hint" }, "口径：" + covView.goals.info + "；" + covView.goals.shallow + "；" + covView.goals.mid + "；" + covView.goals.deep)),
      h("div", { className: "dsh-vc-col" },
        h("h4", null, "缺口清单（" + covView.counts.gaps + "，显示前 " + covView.gaps.length + "）"),
        covView.gaps.length
          ? covView.gaps.map(gapRow)
          : h("div", { className: "dsh-vc-hint" }, "当前无缺口：浅测与 priority ≥ 3 的深测均已覆盖"),
        h("div", { className: "dsh-vc-hint" }, "点一条缺口 → 右侧详情栏显示该资产的 tech / priority / s2 / s3 / evidence / notes，以及六张矩阵的逐项状态"))),

    h("h4", null, "资产明细（" + covAssets.length + "）"),
    covAssets.length
      ? h("table", { className: "dsh-vc-table" },
        h("thead", null, h("tr", null,
          h("th", null, "ID"), h("th", null, "类别"), h("th", null, "值"), h("th", null, "技术栈"),
          h("th", null, "P"), h("th", null, "浅测"), h("th", null, "深测"), h("th", null, "六张矩阵进度"))),
        h("tbody", null, covAssets.map(function (a) {
          var matched = findAssetByValue(covAssets, a.value, a.kind);
          var sums = a.checkSummary || null;
          var fmtStage = function (stage) {
            var s = sums && sums[stage];
            return s ? s.done + "/" + s.required : "-";
          };
          return h("tr", {
            key: a.id, className: "is-clik" + (selAssetId === a.id ? " is-on" : ""),
            onClick: function () { pickAsset(matched || a); },
          },
            h("td", { className: "dsh-vc-mono" }, a.id),
            h("td", null, a.kind),
            h("td", { className: "dsh-vc-mono" }, a.value),
            h("td", null, a.tech || "-"),
            h("td", null, String(a.priority == null ? 3 : a.priority)),
            h("td", null, a.s2 || "pending"),
            h("td", null, a.s3 || "pending"),
            h("td", { className: "dsh-vc-mono" }, "info " + fmtStage("info") + " · 核验收集 " + fmtStage("verifyInfo")
              + " · 浅层 " + fmtStage("shallow") + " · 核验浅层 " + fmtStage("verifyShallow")
              + " · OWASP " + fmtStage("owasp") + " · 深层 " + fmtStage("deep")));
        })))
      : h("div", { className: "dsh-vc-hint" }, "无资产记录"));

  if (tab === "coverage" && !(cov && cov.coverage)) {
    return h("div", rootProps, bar,
      err ? h("div", { className: "dsh-vc-err" }, err) : null,
      h("div", { className: "dsh-vc-empty" }, err ? "覆盖矩阵取数失败：" + err : "加载中…"));
  }

  return h("div", rootProps,
    bar,
    err ? h("div", { className: "dsh-vc-err" }, err) : null,
    notice
      ? h("div", { className: "dsh-vc-note" }, notice,
        h("button", { className: "dsh-vc-btn", style: { marginLeft: 8 }, onClick: function () { setNotice(""); } }, "知道了"))
      : null,
    pinned
      ? h("div", { className: "dsh-vc-banner" },
        "正在看历史项目：" + ((graph && graph.project && graph.project.title) || pinned) + "（" + pinned + "）"
        + " —— 它不是本会话的黑板；本会话的新测试请让总控 bb_project_init 建新项目。",
        h("button", { className: "dsh-vc-btn", onClick: function () { switchTo(""); } }, "回到本会话"))
      : null,
    isFs ? h("div", { className: "dsh-vc-hint-fs" }, "全屏中：滚轮缩放 · 拖拽平移 · 右上角「适应窗口」回全局 · Esc 退出") : null,
    h("div", { className: "dsh-vc-body" },
      tab === "summary" ? summaryView : [tab === "live" ? canvas : coverageListView, asideSplit, aside]));
  } catch (e) {
    // 不白屏：把错误原文摆出来 + 提示先刷新（多半是浏览器还挂着旧 bundle，或宿主 payload 形状变了）
    return h("div", rootProps,
      h("div", { className: "dsh-vc-bar" }, h("span", { className: "dsh-vc-title" }, "作战面板")),
      h("div", { className: "dsh-vc-err" }, "面板渲染出错：" + String((e && e.message) || e)),
      h("div", { className: "dsh-vc-empty" },
        h("div", null, "先刷新页面（Ctrl+F5）—— 面板 bundle 与宿主插件版本不一致时会出现这种情况。"),
        h("div", { className: "dsh-vc-hint", style: { marginTop: 6 } }, "若刷新后仍报同一错误，把这段错误原文发给总控，附上会话 id。")));
  }
}

function apply(ctx) {
  ctx.effect(function () { installStyles(); }, "vore-console: styles");
  ctx.inject(["sessions"], function (scope) {
    // 必须走 slots.inject：'conversation.view' 的声明由 @deepseek-ai/dsh-client-ui-conversation
    // 在它自己的 apply 里提交（children 表），宿主 core 对**未声明**槽位的 register 会抛错。
    // slots.inject 会等到声明落地再注册（与宿主 ui-trajectory 的写法一致）。
    ctx.slots.inject("conversation.view", function () {
      return ctx.slots.register({
        name: "conversation.view",
        id: "vore-console",
        order: 50,
        label: function () { return "作战面板"; },
      }, function VoreConsole(props) {
        return h(ConsolePanel, Object.assign({}, props, { sessionsStore: scope.sessions }));
      });
    });
    return function () {};
  });
}

