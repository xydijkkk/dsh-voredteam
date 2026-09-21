/*!
 * vore-settings / lib/client.cjs —— voredteam 设置面板（Web 客户端插件）。
 *
 * 手写 CommonJS，无构建工具、无 JSX（React.createElement）。
 * 交付形态 = DSH 客户端 bundle 契约：一个 classic script，执行时只做工厂注册
 * （window.__ModuleLoader__.load({id, factory})），模块体（require/CSS 注入/apply）
 * 在首次 materialize 时才跑。require 从模块表取，宿主已把 react 作为平台 seed 词。
 *
 * 宿主侧 HTTP 契约（POST + CSRF）：
 *   GET  /vore-settings/csrf        → { token }
 *   POST /vore-settings/settings.get
 *   POST /vore-settings/settings.set   body: { settings: { <group>: {...} } }
 *   POST /vore-settings/settings.test  body: { provider }
 *   POST /vore-settings/skills.scan    body: { roots? }
 *   POST /vore-settings/mcp.list
 */
(function () {
  "use strict";

  var PANEL_ID = "vore-settings";

  function factory(require) {
    var module = { exports: {} }; var exports = module.exports;
    var React = require("react");

    var API = "/vore-settings";
    var e = React.createElement;
    var useCallback = React.useCallback;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;
    var useState = React.useState;

    // ── 样式（CSS 变量 + body[data-ds-dark-theme]，类名前缀 dsh-vset-）─────────
    var CSS = [
      ".dsh-vset-root{--dsh-vset-bg:var(--dsh-bg-primary,#ffffff);--dsh-vset-bg-soft:var(--dsh-bg-secondary,#f6f7f9);--dsh-vset-bg-input:var(--dsh-bg-primary,#ffffff);",
      "--dsh-vset-fg:var(--dsh-fg-primary,#1f2329);--dsh-vset-fg-dim:var(--dsh-fg-secondary,#646a73);--dsh-vset-line:var(--dsh-border-default,#e5e6eb);",
      "--dsh-vset-accent:var(--dsh-accent,#4a6cf7);--dsh-vset-accent-fg:#ffffff;--dsh-vset-danger:#d83931;--dsh-vset-ok:#2ea44f;",
      "font-size:13px;line-height:1.55;color:var(--dsh-vset-fg);display:flex;flex-direction:column;gap:10px;padding:4px 2px 18px;}",
      "body[data-ds-dark-theme] .dsh-vset-root{--dsh-vset-bg:#1c1d21;--dsh-vset-bg-soft:#25262b;--dsh-vset-bg-input:#17181c;",
      "--dsh-vset-fg:#e8e9ec;--dsh-vset-fg-dim:#a3a7b0;--dsh-vset-line:#33353c;--dsh-vset-accent:#6f8dff;--dsh-vset-ok:#3fb950;}",
      ".dsh-vset-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      ".dsh-vset-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 0 4px;}",
      ".dsh-vset-title{font-size:15px;font-weight:600;}",
      ".dsh-vset-sub{color:var(--dsh-vset-fg-dim);font-size:12px;}",
      ".dsh-vset-card{border:1px solid var(--dsh-vset-line);border-radius:8px;background:var(--dsh-vset-bg);overflow:hidden;}",
      ".dsh-vset-card-sum{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--dsh-vset-bg-soft);cursor:pointer;user-select:none;font-weight:600;}",
      ".dsh-vset-card-sum:hover{filter:brightness(1.03);}",
      ".dsh-vset-caret{display:inline-block;width:12px;color:var(--dsh-vset-fg-dim);transition:transform .12s ease;}",
      ".dsh-vset-caret[data-open='1']{transform:rotate(90deg);}",
      ".dsh-vset-body{padding:10px 12px 14px;display:flex;flex-direction:column;gap:12px;}",
      ".dsh-vset-body.is-collapsed{display:none;}",
      ".dsh-vset-row{display:flex;flex-direction:column;gap:5px;padding:8px 0;border-bottom:1px dashed var(--dsh-vset-line);}",
      ".dsh-vset-row:last-child{border-bottom:none;}",
      ".dsh-vset-rowhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".dsh-vset-label{font-weight:600;}",
      ".dsh-vset-fields{display:flex;flex-direction:column;gap:6px;}",
      ".dsh-vset-field{display:flex;align-items:center;gap:8px;}",
      ".dsh-vset-field > span{width:96px;color:var(--dsh-vset-fg-dim);font-size:12px;flex:none;}",
      ".dsh-vset-input{flex:1 1 auto;min-width:120px;padding:5px 8px;font-size:13px;color:var(--dsh-vset-fg);background:var(--dsh-vset-bg-input);",
      "border:1px solid var(--dsh-vset-line);border-radius:6px;outline:none;}",
      ".dsh-vset-input:focus{border-color:var(--dsh-vset-accent);}",
      ".dsh-vset-num{flex:0 0 110px;min-width:0;}",
      ".dsh-vset-textarea{width:100%;min-height:92px;padding:7px 9px;font-size:12.5px;color:var(--dsh-vset-fg);background:var(--dsh-vset-bg-input);",
      "border:1px solid var(--dsh-vset-line);border-radius:6px;outline:none;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}",
      ".dsh-vset-btn{padding:4px 11px;font-size:12.5px;border-radius:6px;border:1px solid var(--dsh-vset-line);background:var(--dsh-vset-bg);color:var(--dsh-vset-fg);cursor:pointer;}",
      ".dsh-vset-btn:hover{border-color:var(--dsh-vset-accent);color:var(--dsh-vset-accent);}",
      ".dsh-vset-btn[disabled]{opacity:.5;cursor:not-allowed;}",
      ".dsh-vset-btn-primary{background:var(--dsh-vset-accent);border-color:var(--dsh-vset-accent);color:var(--dsh-vset-accent-fg);}",
      ".dsh-vset-btn-primary:hover{color:var(--dsh-vset-accent-fg);filter:brightness(1.06);}",
      ".dsh-vset-tag{font-size:11.5px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsh-vset-line);color:var(--dsh-vset-fg-dim);}",
      ".dsh-vset-tag-ok{color:var(--dsh-vset-ok);border-color:var(--dsh-vset-ok);}",
      ".dsh-vset-tag-bad{color:var(--dsh-vset-danger);border-color:var(--dsh-vset-danger);}",
      ".dsh-vset-note{font-size:12px;color:var(--dsh-vset-fg-dim);word-break:break-all;}",
      ".dsh-vset-note-ok{color:var(--dsh-vset-ok);}",
      ".dsh-vset-note-bad{color:var(--dsh-vset-danger);}",
      ".dsh-vset-alert{padding:7px 10px;border-radius:6px;border:1px solid var(--dsh-vset-line);background:var(--dsh-vset-bg-soft);font-size:12px;}",
      ".dsh-vset-table{width:100%;border-collapse:collapse;font-size:12.5px;}",
      ".dsh-vset-table th,.dsh-vset-table td{border-bottom:1px solid var(--dsh-vset-line);padding:5px 7px;text-align:left;vertical-align:top;}",
      ".dsh-vset-table th{color:var(--dsh-vset-fg-dim);font-weight:600;}",
      ".dsh-vset-yes{color:var(--dsh-vset-ok);font-weight:600;}",
      ".dsh-vset-no{color:var(--dsh-vset-fg-dim);}",
      ".dsh-vset-errhead{color:var(--dsh-vset-danger);font-weight:600;}",
      ".dsh-vset-spin{font-size:12px;color:var(--dsh-vset-fg-dim);}",
      ".dsh-vset-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
    ].join("");

    function installStyles() {
      var tag = document.createElement("style");
      tag.setAttribute("data-plugin", "vore-settings");
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function () { tag.remove(); };
    }

    // ── HTTP 客户端（同源 + CSRF）────────────────────────────────────────────
    var token = null;

    function getToken() {
      if (token !== null) return Promise.resolve(token);
      return fetch(API + "/csrf", { headers: { accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (b) {
          if (!b || typeof b.token !== "string") throw new Error("CSRF token 缺失");
          token = b.token;
          return token;
        });
    }

    function post(endpoint, body) {
      return getToken()
        .then(function (t) {
          return fetch(API + "/" + endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", "x-dsh-csrf": t },
            body: JSON.stringify(body || {}),
          });
        })
        .then(function (r) {
          return r.text().then(function (txt) {
            var data = null;
            try { data = txt === "" ? null : JSON.parse(txt); } catch (err) { data = null; }
            if (!r.ok) throw new Error((data && data.error) ? data.error : (txt || ("HTTP " + r.status)));
            if (data === null) throw new Error("响应不是 JSON");
            return data;
          });
        });
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────
    var DEFAULT_GROK = "http://127.0.0.1:3001/";

    function keyState(masked) {
      var v = typeof masked === "string" ? masked : "";
      return { masked: v, has: v !== "" };
    }

    function text(value) {
      return value === undefined || value === null ? "" : String(value);
    }

    function Section(props) {
      var open = props.open;
      return e("div", { className: "dsh-vset-card" },
        e("div", { className: "dsh-vset-card-sum", onClick: props.onToggle, role: "button", tabIndex: 0 },
          e("span", { className: "dsh-vset-caret", "data-open": open ? "1" : "0" }, "\u25b6"),
          e("span", null, props.title),
          props.hint ? e("span", { className: "dsh-vset-sub" }, props.hint) : null,
          e("span", { style: { flex: "1 1 auto" } }),
          props.summary ? e("span", { className: "dsh-vset-sub" }, props.summary) : null),
        // 折叠用 CSS 控制而非条件渲染：树的形状稳定（可测、可搜索、无抖动），
        // 折叠态在浏览器里视觉上仍是收起的。
        e("div", { className: "dsh-vset-body" + (open ? "" : " is-collapsed") }, props.children));
    }

    function Field(props) {
      return e("div", { className: "dsh-vset-field" },
        e("span", null, props.label),
        e("input", {
          className: "dsh-vset-input",
          type: props.type || "text",
          value: props.value,
          placeholder: props.placeholder || "",
          spellCheck: false,
          onChange: function (ev) { props.onChange(ev.target.value); },
        }));
    }

    function ApiRow(props) {
      var cfg = props.cfg;
      var dock = props.dock;
      var st = props.testState || {};
      return e("div", { className: "dsh-vset-row" },
        e("div", { className: "dsh-vset-rowhead" },
          e("span", { className: "dsh-vset-label" }, props.label),
          props.hint ? e("span", { className: "dsh-vset-sub" }, props.hint) : null,
          st.testing ? e("span", { className: "dsh-vset-spin" }, "测试中…") : null,
          st.done ? e("span", { className: st.ok ? "dsh-vset-tag dsh-vset-tag-ok" : "dsh-vset-tag dsh-vset-tag-bad" },
            st.ok ? "可用" : "不可用") : null,
          st.done ? e("span", { className: st.ok ? "dsh-vset-note dsh-vset-note-ok" : "dsh-vset-note dsh-vset-note-bad" },
            (st.status ? "HTTP " + st.status + " · " : "") + text(st.note)) : null),
        e("div", { className: "dsh-vset-fields" }, props.children),
        e("div", { className: "dsh-vset-actions" },
          e("button", {
            className: "dsh-vset-btn", type: "button", disabled: !!st.testing || !!dock.busy,
            onClick: function () { props.onTest(); },
          }, "测试"),
          e("button", {
            className: "dsh-vset-btn dsh-vset-btn-primary", type: "button", disabled: !!dock.busy,
            onClick: function () { props.onSave(); },
          }, "保存"),
          e("span", { className: "dsh-vset-note" }, text(dock.note))));
    }

    // ── 面板主体 ────────────────────────────────────────────────────────────
    function SettingsPage() {
      var openState = useState({ api: true, skills: false, mcp: false });
      var open = openState[0], setOpen = openState[1];
      var settingsState = useState(null);
      var settings = settingsState[0], setSettings = settingsState[1];
      var errState = useState("");
      var error = errState[0], setError = errState[1];
      var busyState = useState("");
      var busy = busyState[0], setBusy = busyState[1];
      var notesState = useState({});
      var notes = notesState[0], setNotes = notesState[1];
      var testsState = useState({});
      var tests = testsState[0], setTests = testsState[1];
      var keysState = useState({ fofa: "", shodan: "", yescaptcha: "", grokGateway: "" });
      var keys = keysState[0], setKeys = keysState[1];
      var rootsState = useState("");
      var roots = rootsState[0], setRoots = rootsState[1];
      var scanState = useState(null);
      var scan = scanState[0], setScan = scanState[1];
      var mcpState = useState(null);
      var mcp = mcpState[0], setMcp = mcpState[1];

      var setNote = useCallback(function (k, v) {
        setNotes(function (prev) { var next = Object.assign({}, prev); next[k] = v; return next; });
      }, []);
      var setTest = useCallback(function (k, v) {
        setTests(function (prev) { var next = Object.assign({}, prev); next[k] = v; return next; });
      }, []);
      var setKey = useCallback(function (k, v) {
        setKeys(function (prev) { var next = Object.assign({}, prev); next[k] = v; return next; });
      }, []);

      var loadSettings = useCallback(function () {
        setBusy("加载设置");
        return post("settings.get", {})
          .then(function (r) {
            if (!r.ok) throw new Error(r.error || "读取失败");
            setSettings(r.settings);
            setRoots(((r.settings.skills || {}).roots || []).join("\n"));
            setError("");
          })
          .catch(function (err) { setError(err.message || String(err)); })
          .then(function () { setBusy(""); });
      }, []);

      var loadMcp = useCallback(function () {
        return post("mcp.list", {})
          .then(function (r) { if (r.ok) setMcp(r); })
          .catch(function (err) { setError(err.message || String(err)); });
      }, []);

      // 挂载即拉取设置与 MCP 清单（面板打开就能看到 MCP 表与启用开关，不必先展开分区）
      useEffect(function () { loadSettings(); loadMcp(); }, [loadSettings]);

      /** 保存一个分组：groupPatch 形如 { fofa: {apiKey:"…"} } */
      var save = useCallback(function (key, groupPatch, noteText) {
        setBusy("保存 " + key);
        setNote(key, "");
        return post("settings.set", { settings: groupPatch })
          .then(function (r) {
            if (!r.ok) throw new Error(r.error || "写入失败");
            setSettings(r.settings);
            setError("");
            setNote(key, noteText || ("已保存（" + r.applied.join("、") + "）"));
            return r;
          })
          .catch(function (err) {
            setError(err.message || String(err));
            setNote(key, "保存失败");
            throw err;
          })
          .then(function (r) { setBusy(""); return r; }, function (err) { setBusy(""); throw err; });
      }, [setNote]);

      var runTest = useCallback(function (provider, groupPatch) {
        setTest(provider, { testing: true });
        var seq = groupPatch ? save("api", groupPatch, "已保存，正在探活") : Promise.resolve(null);
        return seq
          .catch(function () { return null; })
          .then(function () { return post("settings.test", { provider: provider }); })
          .then(function (r) {
            setTest(provider, { done: true, ok: !!r.ok, status: r.status, note: r.note });
          })
          .catch(function (err) {
            setTest(provider, { done: true, ok: false, status: 0, note: err.message || String(err) });
          });
      }, [save, setTest]);

      /** 组装某个 provider 的提交补丁：空输入=不动；有输入=写入；清除按钮显式置空。 */
      var patchFor = useCallback(function (provider) {
        var enter = keys[provider];
        if (enter === undefined || enter === "") return null;
        var p = {};
        p[provider] = { apiKey: enter };
        return p;
      }, [keys]);

      var clearKey = useCallback(function (provider) {
        var p = {};
        p[provider] = { apiKey: "" };
        setKey(provider, "");
        return save("api", p, "已清除 " + provider + " apiKey");
      }, [save, setKey]);

      var scanSkills = useCallback(function () {
        setBusy("扫描技能");
        var rootsList = roots.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        return post("skills.scan", { roots: rootsList })
          .then(function (r) {
            if (!r.ok) throw new Error(r.error || "扫描失败");
            setScan(r);
            setError("");
          })
          .catch(function (err) { setError(err.message || String(err)); })
          .then(function () { setBusy(""); });
      }, [roots]);

      var toggleMcp = useCallback(function (id, on) {
        if (!settings) return;
        var cur = (settings.mcp && settings.mcp.enabled) || [];
        var next = on ? cur.concat(cur.indexOf(id) === -1 ? [id] : []) : cur.filter(function (x) { return x !== id; });
        setSettings(Object.assign({}, settings, { mcp: Object.assign({}, settings.mcp, { enabled: next }) }));
        save("mcp", { mcp: { enabled: next } }, "启用项已写回");
        if (mcp) setMcp(Object.assign({}, mcp, { enabled: next }));
      }, [settings, mcp, save]);

      var toggle = useCallback(function (k) {
        setOpen(function (prev) { var next = Object.assign({}, prev); next[k] = !next[k]; return next; });
      }, []);

      var fofa = settings ? settings.fofa : null;
      var shodan = settings ? settings.shodan : null;
      var yesc = settings ? settings.yescaptcha : null;
      var grok = settings ? settings.grokGateway : null;
      var rate = settings ? settings.rate : null;
      var mcpCfg = settings ? settings.mcp : null;

      var enabledSet = useMemo(function () {
        return new Set((mcpCfg && mcpCfg.enabled) || []);
      }, [mcpCfg]);

      var summaryApi = settings
        ? ["fofa", "shodan", "yescaptcha", "grok"].filter(function (k) {
          var g = { fofa: fofa, shodan: shodan, yescaptcha: yesc, grokGateway: grok }[k];
          return g && g.hasKey;
        }).length + "/4 有密钥"
        : "";

      return e("div", { className: "dsh-vset-root" },
        e("div", { className: "dsh-vset-head" },
          e("div", null,
            e("div", { className: "dsh-vset-title" }, "voredteam 设置"),
            e("div", { className: "dsh-vset-sub" }, "持久化于 ~/.dsh/voredteam/settings.json · 密钥仅回显前 6 位掩码")),
          e("div", { className: "dsh-vset-actions" },
            busy ? e("span", { className: "dsh-vset-spin" }, busy + "…") : null,
            e("button", { className: "dsh-vset-btn", type: "button", onClick: loadSettings }, "重新读取"))),
        error ? e("div", { className: "dsh-vset-alert" }, e("span", { className: "dsh-vset-errhead" }, "错误："), error) : null,
        !settings ? e("div", { className: "dsh-vset-note" }, "加载中…") : null,

        settings ? e(Section, {
          title: "测绘与辅助 API", open: open.api, onToggle: function () { toggle("api"); },
          summary: summaryApi,
        },
          e(ApiRow, {
            label: "FOFA", hint: "apiKey / baseUrl / backupUrl",
            dock: { busy: busy.indexOf("保存 ") === 0, note: notes.api },
            testState: tests.fofa,
            onTest: function () {
              var patch = { fofa: { baseUrl: fofa.baseUrl, backupUrl: fofa.backupUrl } };
              var k = patchFor("fofa");
              if (k) patch.fofa.apiKey = k.fofa.apiKey;
              runTest("fofa", patch);
            },
            onSave: function () {
              var patch = { fofa: { baseUrl: fofa.baseUrl, backupUrl: fofa.backupUrl } };
              var k = patchFor("fofa");
              if (k) patch.fofa.apiKey = k.fofa.apiKey;
              save("api", patch, "FOFA 配置已保存");
            },
          },
            e(Field, {
              label: "apiKey", value: keys.fofa,
              placeholder: fofa.hasKey ? ("已配置 " + fofa.apiKey + "（留空不变，清空则删除）") : "未配置",
              onChange: function (v) { setKey("fofa", v); },
            }),
            e(Field, { label: "baseUrl", value: fofa.baseUrl, onChange: function (v) { setSettings(Object.assign({}, settings, { fofa: Object.assign({}, fofa, { baseUrl: v }) })); } }),
            e(Field, { label: "backupUrl", value: fofa.backupUrl, onChange: function (v) { setSettings(Object.assign({}, settings, { fofa: Object.assign({}, fofa, { backupUrl: v }) })); } }),
            e("div", { className: "dsh-vset-actions" },
              e("button", { className: "dsh-vset-btn", type: "button", onClick: function () { clearKey("fofa"); } }, "清除密钥"))),

          e(ApiRow, {
            label: "Shodan", hint: "apiKey",
            dock: { busy: busy.indexOf("保存 ") === 0, note: notes.api },
            testState: tests.shodan,
            onTest: function () { runTest("shodan", patchFor("shodan")); },
            onSave: function () { var p = patchFor("shodan"); if (p) save("api", p, "Shodan 已保存"); else setNote("api", "输入框为空，未改动"); },
          },
            e(Field, {
              label: "apiKey", value: keys.shodan,
              placeholder: shodan.hasKey ? ("已配置 " + shodan.apiKey + "（留空不变）") : "未配置",
              onChange: function (v) { setKey("shodan", v); },
            })),

          e(ApiRow, {
            label: "YesCaptcha", hint: "apiKey（打码）",
            dock: { busy: busy.indexOf("保存 ") === 0, note: notes.api },
            testState: tests.yescaptcha,
            onTest: function () { runTest("yescaptcha", patchFor("yescaptcha")); },
            onSave: function () { var p = patchFor("yescaptcha"); if (p) save("api", p, "YesCaptcha 已保存"); else setNote("api", "输入框为空，未改动"); },
          },
            e(Field, {
              label: "apiKey", value: keys.yescaptcha,
              placeholder: yesc.hasKey ? ("已配置 " + yesc.apiKey + "（留空不变）") : "未配置",
              onChange: function (v) { setKey("yescaptcha", v); },
            })),

          e(ApiRow, {
            label: "Grok 网关", hint: "baseUrl / apiKey（本地中转）",
            dock: { busy: busy.indexOf("保存 ") === 0, note: notes.api },
            testState: tests.grokGateway,
            onTest: function () {
              var patch = { grokGateway: { baseUrl: grok.baseUrl || DEFAULT_GROK } };
              var k = patchFor("grokGateway");
              if (k) patch.grokGateway.apiKey = k.grokGateway.apiKey;
              runTest("grokGateway", patch);
            },
            onSave: function () {
              var patch = { grokGateway: { baseUrl: grok.baseUrl } };
              var k = patchFor("grokGateway");
              if (k) patch.grokGateway.apiKey = k.grokGateway.apiKey;
              save("api", patch, "Grok 网关已保存");
            },
          },
            e(Field, { label: "baseUrl", value: grok.baseUrl, onChange: function (v) { setSettings(Object.assign({}, settings, { grokGateway: Object.assign({}, grok, { baseUrl: v }) })); } }),
            e(Field, {
              label: "apiKey", value: keys.grokGateway,
              placeholder: grok.hasKey ? ("已配置 " + grok.apiKey + "（留空不变）") : "可留空（本地网关常无需鉴权）",
              onChange: function (v) { setKey("grokGateway", v); },
            })),

          e("div", { className: "dsh-vset-row" },
            e("div", { className: "dsh-vset-rowhead" }, e("span", { className: "dsh-vset-label" }, "限速"), e("span", { className: "dsh-vset-sub" }, "defaultRps / wafRps / fuzzSampleFirst")),
            e("div", { className: "dsh-vset-fields" },
              e("div", { className: "dsh-vset-field" }, e("span", null, "defaultRps"),
                e("input", {
                  className: "dsh-vset-input dsh-vset-num", type: "number", min: 0, step: 1, value: String(rate.defaultRps),
                  onChange: function (ev) { setSettings(Object.assign({}, settings, { rate: Object.assign({}, rate, { defaultRps: Number(ev.target.value) }) })); },
                })),
              e("div", { className: "dsh-vset-field" }, e("span", null, "wafRps"),
                e("input", {
                  className: "dsh-vset-input dsh-vset-num", type: "number", min: 0, step: 1, value: String(rate.wafRps),
                  onChange: function (ev) { setSettings(Object.assign({}, settings, { rate: Object.assign({}, rate, { wafRps: Number(ev.target.value) }) })); },
                })),
              e("div", { className: "dsh-vset-field" }, e("span", null, "fuzzSampleFirst"),
                e("input", {
                  className: "dsh-vset-input dsh-vset-num", type: "number", min: 0, step: 1, value: String(rate.fuzzSampleFirst),
                  onChange: function (ev) { setSettings(Object.assign({}, settings, { rate: Object.assign({}, rate, { fuzzSampleFirst: Number(ev.target.value) }) })); },
                }))),
            e("div", { className: "dsh-vset-actions" },
              e("button", {
                className: "dsh-vset-btn dsh-vset-btn-primary", type: "button",
                onClick: function () { save("api", { rate: rate }, "限速已保存"); },
              }, "保存限速")))) : null,

        settings ? e(Section, {
          title: "技能管理", open: open.skills, onToggle: function () { toggle("skills"); },
          summary: (settings.skills.roots || []).length + " 个根",
        },
          e("div", { className: "dsh-vset-note" }, "一行一个技能根目录；扫描会递归查找含 SKILL.md 的目录（最多 3000 条）。注意：这里只影响「检索面」，模型能 skill 装载的技能根在 agent.cordis.yml 的 customSkillDirs。"),
          e("textarea", {
            className: "dsh-vset-textarea", value: roots, spellCheck: false,
            onChange: function (ev) { setRoots(ev.target.value); },
          }),
          e("div", { className: "dsh-vset-actions" },
            e("button", {
              className: "dsh-vset-btn dsh-vset-btn-primary", type: "button",
              onClick: function () {
                var list = roots.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
                save("skills", { skills: { roots: list } }, "技能根已保存（" + list.length + " 个）");
              },
            }, "保存根目录"),
            e("button", { className: "dsh-vset-btn", type: "button", disabled: busy === "扫描技能", onClick: scanSkills }, "扫描技能"),
            e("span", { className: "dsh-vset-note" }, text(notes.skills))),
          scan ? e("div", null,
            e("div", { className: "dsh-vset-sub" },
              "扫到 " + scan.total + " 条技能" + (scan.truncated ? "（已截断至 3000）" : "")
              + ((scan.skipped || []).length ? "；跳过 " + scan.skipped.length + " 个不可读目录" : "")),
            scan.list.length === 0
              ? e("div", { className: "dsh-vset-note" }, "无结果：确认根目录存在且其中有 SKILL.md。")
              : e("table", { className: "dsh-vset-table" },
                e("thead", null, e("tr", null, e("th", null, "名称"), e("th", null, "路径"), e("th", null, "描述"))),
                e("tbody", null, scan.list.map(function (row, i) {
                  return e("tr", { key: i },
                    e("td", null, row.name),
                    e("td", { className: "dsh-vset-mono" }, row.path),
                    e("td", null, row.desc || ""));
                })))) : null) : null,

        settings ? e(Section, {
          title: "MCP 管理", open: open.mcp, onToggle: function () { toggle("mcp"); loadMcp(); },
          summary: ((mcpCfg.enabled || []).length) + " 项启用",
        },
          e("div", { className: "dsh-vset-field" },
            e("span", null, "registry"),
            e("input", {
              className: "dsh-vset-input dsh-vset-mono", value: mcpCfg.registryPath, spellCheck: false,
              onChange: function (ev) { setSettings(Object.assign({}, settings, { mcp: Object.assign({}, mcpCfg, { registryPath: ev.target.value }) })); },
            }),
            e("button", {
              className: "dsh-vset-btn", type: "button",
              onClick: function () {
                save("mcp", { mcp: { registryPath: mcpCfg.registryPath } }, "registry 路径已保存").then(loadMcp).catch(function () {});
              },
            }, "保存路径")),
          mcp === null
            ? e("div", { className: "dsh-vset-note" }, "尚未读取 registry —— 点开本段即自动读取。")
            : (mcp.exists
              ? e("div", { className: "dsh-vset-note" }, "registry：" + mcp.path + "（已读取，" + (mcp.servers || []).length + " 个服务器）")
              : e("div", { className: "dsh-vset-alert" }, mcp.note || ("registry 文件不存在：" + mcp.path))),
          mcp && (mcp.servers || []).length
            ? e("table", { className: "dsh-vset-table" },
              e("thead", null, e("tr", null,
                e("th", null, "启用"), e("th", null, "id"), e("th", null, "名称"), e("th", null, "transport"), e("th", null, "url / command"))),
              e("tbody", null, mcp.servers.map(function (srv, i) {
                var on = enabledSet.has(srv.id);
                return e("tr", { key: i },
                  e("td", null, e("input", {
                    type: "checkbox", checked: on,
                    onChange: function (ev) { toggleMcp(srv.id, ev.target.checked); },
                  })),
                  e("td", { className: "dsh-vset-mono" }, srv.id),
                  e("td", null, srv.name || ""),
                  e("td", null, srv.transport || ""),
                  e("td", { className: "dsh-vset-mono" }, srv.url || srv.command || ""));
              })))
            : e("div", { className: "dsh-vset-note" }, "无服务器条目（只解析 - id:/name:/transport:/url:/command: 行）。"),
          e("div", { className: "dsh-vset-actions" },
            e("button", { className: "dsh-vset-btn", type: "button", onClick: loadMcp }, "重新读取 registry"),
            e("span", { className: "dsh-vset-note" }, text(notes.mcp)))) : null);
    }

    function apply(ctx) {
      if (ctx && typeof ctx.effect === "function") {
        ctx.effect(function () { return installStyles(); }, "vore-settings: styles");
      } else {
        installStyles();
      }
      // 双入口：① 设置弹窗里的一节（与宿主 ui-settings 的 slots 契约一致）；
      //          ② 会话页签「设置」，与「作战面板」并排（用户明确要求两个页签并排）。
      // 两者都必须走 slots.inject —— 槽位声明由 owner 包（ui-settings-general / ui-conversation）
      // 各自提交，裸 register 会被宿主 core 判为「未声明目标」而抛错。
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: PANEL_ID,
          order: 130,
          label: function () { return "voredteam 设置"; },
        }, SettingsPage);
      });
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register({
          name: "conversation.view",
          id: PANEL_ID,
          order: 60,
          label: function () { return "设置"; },
        }, SettingsPage);
      });
    }

    module.exports = { name: "vore-settings-client", inject: ["slots"], apply: apply };
    return module.exports;
  }

  window.__ModuleLoader__.load({ id: "@dsh-external/vore-settings", factory: factory });
})();
