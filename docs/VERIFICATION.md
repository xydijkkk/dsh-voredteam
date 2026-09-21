# dsh-voredteam 全量验证报告（VERIFICATION）

> 变更（本轮）：① 移除 `vore-webshell` 面板（C2/后渗透改由内置 **AdaptixC2 MCP** 承担）；② **技能全部内置**（`vendor/skills/`）、出厂文件零本机路径；③ 预设模板化（`{{PROJECT_ROOT}}`）并修掉三处 mount 阻塞。
>
> 回答一个问题：**项目源码是否被完整验证？** 结论：可机器复验的全量验证 —— 88 项结构/契约 + 142 项断言 + 25 项验收 + 28 项部署 + 可移植性闸门 + 真实装配冒烟（`npm run preset:mount`）。
> 事故与修复的完整记录见第七～十二章。
---

## 一、项目侧：全量验证结果（全部可复现）

| 验证 | 命令 | 结果 |
|---|---|---|
| 全量体检 | `npm run verify` | **88/88 项通过** |
| 断言测试 | `npm test` | **142 项**：黑板引擎 31 · 注册表 9 · **预设 11** · 装载冒烟 19 · 作战面板 17 · **面板真渲染 9** · 设置面板 29 · **客户端契约 17** |
| 客户端契约 | `npm run client` | **17 项通过**：vm 按宿主语义装载每个面板 bundle（id / **factory 形参 ≤ 1** / 只 require seed 词 / 注册槽位 / 组件浅渲染），并**在线校验 3080 实际下发的那份字节** |
| 验收自检 | `npm run accept` | **25/25 项通过** |
| 部署校验 | `node deploy/deploy.mjs --check` | **28/28 项通过**（原 34 项，移除 WebShell 面板后自然减少 6 项），`--apply` 已落到本机 profile（幂等、自动备份） |
| 预设装配 | `npm run preset:mount` | 真实 boot + `agentPresets.mount('network-security')`：**43 个工具**、关键工具齐备（subagent / subagent_fork / workflow / exit_plan_mode / bb_*）；需 DSH 检出目录 |
| 可移植性 | `npm test` 内的 `tests/portability.test.mjs` | **通过**：出厂文件无本机绝对路径；模板/注册表/占位符/无联接四项旁证 |
| 技能盘点 | `npm run skills` | **装载面 245 个（全部仓库内置）**（3 自研 + Claude-Red 78 + reverse-skill 43 + Anthropic 受控 120 + clown 1）、**检索面 984 条无截断**、registry 500 条路径 100% 存在；两处缺陷已修 + Claude-Red 已接入（`docs/SKILL-INVENTORY.md`） |
| 语法 | `node --check`（全部 47 个 .js/.mjs/.cjs） | **0 失败** |
| JSON | 全部 `package.json` 等 | 全部 `JSON.parse` 通过 |
| YAML | 预设/注册表/patch（宿主 `yaml` 包解析） | 10 个文件全部解析通过（预设数组 18 行、技能 500 条、MCP 19 条） |
| 角色卡 | 13 份 | 每份均有 frontmatter（id/name/description/kind）与六段骨架（授权与边界/输入前置条件/纪律/工作方法/黑板协议/输出格式）；12 个子 agent 均含 `bb_intent_claim`/`bb_fact_add` |
| 技能注册表 | 500 条 | id 全局唯一；**500 条路径逐条 `stat` 全部存在**；kind 分布 skill 256 / knowledge 182 / rules 28 / script 27 / tool 7 |
| MCP 注册表 | 19 条 | 每条含 name/transport；http/sse 含 url、stdio 含 command；路径经 `${VAR}` 占位符展开，**缺变量的条目被标为未配置** |
| 客户端 bundle | 2 个面板 | 均走 `window.__ModuleLoader__.load({id, factory})` 契约；vore-console 有构建脚本 + `--check` 防漂移；vm 装载自检通过（注册 `conversation.view` / `settings.section`） |
| 外部引用 | 运行时代码 | 预设与插件**只引用本项目插件与宿主基础包**（不挂载任何第三方 bundle） |
| 预设一致性 | 组合行 18 行 | 2 条本项目插件行可解析、20 个宿主包可解析、persona 含范式与门禁关键词 |
| 安装态 | profile | **4 个插件**（blackboard/console/guard/settings）dependencies + bundles + node_modules 链接齐备；预设 junction 已链接；profile 备份文件可回滚 |

**本轮为通过验证而修的问题**（全部有测试固化）：

1. `vore-console` 客户端**不符合 DSH bundle 契约**（原为 ESM）→ 改为构建产物 classic bundle（`lib/pure.mjs` + `lib/panel.js` → `lib/client.js`）+ `scripts/build-client.mjs --check` 防漂移 + vm 装载自检。
2. 技能根越界可遍历全盘 → `rootRejectReason` 拒绝盘根/一级目录；`skills.scan` 只认**落盘配置**（忽略请求体 roots）；单文件 256 KB 与单次 8 MB 预算上限。
3. 设置写盘非原子 + 解析损坏静默回默认（会抹掉全部密钥）→ `tmp + rename` 原子替换 + `.bak`；损坏时**抛错**并在端点回显，只对"文件不存在"回默认。
4. 门禁阈值"无人消费"（假安全感）→ `vore-guard` 读 `settings.json` 的 `rate`（mtime 缓存）作为真实上限；面板侧 `RATE_BOUNDS` 夹紧（defaultRps 1..200、wafRps 0.1..50、fuzzSampleFirst 1..500）。
6. `genCore("delete")` 引用未定义的 `st`（必然 400）→ 修好并同时删除产物文件。
7. 测试基础设施缺陷（会让"测试通过"失去意义）：假 React 的 `createElement` 未把 children 放进 `props.children`、`findAll` 不摊平数组 → 已按 React 语义修正。

---

## 三、项目源码侧：谁写的、谁审的

| 模块 | 来源 | 验证方式 |
|---|---|---|
| 预设 persona / 组合行、`agents/*.md` 13 份 | 我写 + 1 个子代理按精确骨架代写 12 份 | 我逐份读过结构（本报告 §一 角色卡项）+ verify-all 逐份断言六段骨架与工具名 |
| `vore-blackboard`（store/index/角色卡工具/HTTP/注入） | 我写 | 19 项 smoke + 15 项 load 端到端 + 我逐段复核 |
| `vore-guard` | 我写 | 19 项 smoke（含设置驱动阈值）+ load 装载 |
| `vore-console`（pure + panel + 构建脚本） | 我写（原 `client.mjs` 由子代理起头，我重构为契约正确形态） | 14 项测试 + vm 装载自检 + `--check` 防漂移 |
| `vore-settings`（index/pure/client） | **子代理代写** | **独立代码审计**（记录在本机 `汇总报告/voredteam-audits/CODE-AUDIT.md`）→ 修复其 Top-3（越界扫描、非原子写、静默回默认）+ 阈值接线；29 项测试 |
| ~~`vore-webshell`（移植 68 文件）~~ **已移除** | 子代理移植 → 独立代码审计 → 修数据目录隔离与 `genCore` bug；**随后按要求删除该面板**（C2 由 AdaptixC2 MCP 承担） |
| deploy / 测试 / 文档 | 我写 + 1 个子代理代写 deploy | deploy 在**假 home 夹具**上验证幂等（apply→复跑零写入→check 28/28） |

### 审计发现但**未修**的项（记录在本机 `汇总报告/voredteam-audits/CODE-AUDIT.md`）

1. `vore_settings_set` 缺少审计留痕（谁在何时改了哪些键、旧值是什么）——面板与工具侧均无记录。
2. ~~webshell 相关 5 项~~（无卸载钩子、读-改-写非事务、`logOp` 静默吞错、HTTP 路由无模式门禁、口令复制进 `meta_json`）——**该插件已按要求删除，随之为失效项**。

---

## 四、复现全部结论

```bash
cd <dsh-voredteam 仓库根>

npm test                       # 142 项断言
npm run accept                 # 25 项验收自检
npm run verify                 # 88 项全量体检
node deploy/deploy.mjs --check  # 28 项部署校验
node plugins/vore-console/scripts/build-client.mjs --check   # 面板 bundle 不漂移

# 审计报告（只读审计 + 覆盖证据）
type docs\SKILL-INVENTORY.md    # 内置技能盘点：装载面 5 / 检索面 500 截断 / registry 500 条 + 新加技能四条路
```

## 五、仍未验证 / 无法在本机验证的

- **浏览器内实际渲染**：需要**重启 dsh web** 才会加载新插件；我用 vm 假 loader + 假 React 做了契约与渲染断言（36+ 项），但没有真实浏览器截图。
- **需外部程序的 MCP**：Anything Analyzer 只验证到 `initialize` 握手成功；Burp/PentAGI/CyberStrikeAI/AdaptixC2 需要各自宿主程序运行（`mcp/NOTES.md` 的按需启动清单）。
- **`pnpm install`**：未执行（变更 3 已建立 node_modules 链接，故可跳过；跑一次可让 lockfile 记账一致）。
- 上述 §三"未修清单"5 项。

---

## 七、事故与修复：vore-settings 客户端白屏（2026-09-19）

**症状**：重启后 Web UI 顶部横幅
`HARNESS / Failed to load plugins / failed to import loader entry 92e6f967 (@dsh-external/vore-settings): Cannot set properties of undefined (setting 'exports')`，页面无内容。

**根因**：`plugins/vore-settings/lib/client.cjs` 的客户端工厂签名写成 `function factory(require, module, exports)`，
而宿主 `ClientModuleSystem.materialize` 是 `registered(this.makeRequire(edges))` —— **只传一个参数**
（`deepseek-harness/packages/client/modules/src/client/system.ts:159`），导出取**返回值**。
于是 `module` 为 `undefined`，工厂内 `module.exports = {...}` 直接抛错 → 该 entry 导入失败 → 整个客户端插件图起不来。

**为什么自家测试没拦住（重要教训）**：`plugins/vore-settings/tests/settings.test.mjs` 的 `materializeClient()`
**照着错误契约写的**（自己造 `module` 并以三参调用 `factory(require, module, exports)`），于是"测试通过"是**假绿**——
它验证的是我方想象出的契约，不是宿主的契约。同项目的 `vore-console` 因为走构建脚本（生成式 classic bundle，`factory: (require) => ...`）而没踩这个坑。

**修复**：工厂改回 `function factory(require)`，在工厂内自声明 `var module = { exports: {} }` 并返回 `module.exports`；
`settings.test.mjs` 的 `materializeClient()` 同步改为"单参调用 + 取返回值"，并加 `factory.length <= 1` 断言。

**新增的回归门（永久）**：`tests/client-contract.mjs`（`npm run client`，已并入 `npm test`）
1. 扫描所有声明 `dsh.client` 的插件，逐个按宿主语义在 vm 里装载；
2. 断言 `factory` **形参个数 ≤ 1**（本次事故的精确特征）、只 `require` 平台 seed 词、注册预期槽位；
3. **浅渲染**注册进槽位的组件，确认首帧不抛；
4. **在线面**：从 `http://127.0.0.1:3080` 取 boot 页与实际下发的 bundle 字节，再过同一套断言——能区分"文件已修"与"浏览器拿到的仍是旧的"。
   同时 `plugins/vore-console/scripts/vm-check.mjs` 增加了同一道 arity 闸门，构建脚本 `--check` 也会拦。

**变异验证**：把修复后的 bundle 还原成三形参形态跑新测试 → **被精确捕获**（"factory 只能声明 (require) 一个形参，实际 3 个"），证明这道门不是摆设。

**恢复路径**：客户端 bundle 由宿主按请求下发且带 `?rev=<内容哈希>` + `Cache-Control: no-cache`，
所以**修完只需刷新页面**（无需重启进程）；若页面仍异常，再跑 `deploy/restart-dsh-web.ps1`。

---

## 八、第二起：模式列表里没有「网络安全模式」+ 面板不显示（2026-09-19 晚）

用户反馈：重启后模式选择只有宿主自带的 **标准 / PTC / 极简 / 创造**，当前会话也**只有「对话」「轨迹」两个页签**。两个症状，两条独立根因。

### 8.1 模式不出现 —— 预设目录用了 junction，被宿主**静默跳过**

`deploy/deploy.mjs` 原先在 `<DSH_HOME>/.agent-presets/<id>` 建 **junction**。而宿主 `@deepseek-ai/dsh-agent-presets` 的 `scanRoot()` 判定是
（`packages/preset/agent-presets/src/discovery.ts:150`）：

```ts
for (const child of children) {
  if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
```

Windows 上 Node 把 junction 报成 `isSymbolicLink() === true / isDirectory() === false`（libuv 依据 REPARSE_POINT 属性），
于是**整个预设被跳过**，不报错、也不列 broken —— 用户只看到「少了一个模式」。实测：宿主 `scanRoot` 对 `.agent-presets` 返回 **0 个用户预设**。
（实测：宿主对目录联接一律跳过，只有**实体目录**才会被认成预设。）

**修复**：改为**实体目录 + 内容复制**（`materializePreset()`），目录内写 `.vore-preset.json` 标记（源路径/模式/时间）用于漂移检测；
`deploy --check` 现在比对**文件内容**而非链接目标，`--apply` 会重建/刷新。
**复验（用宿主自己的 discovery 代码跑）**：`scanRoot({path: <dshHome>/.agent-presets})` → **1 个预设：id=network-security，name=网络安全模式，broken=无**。

### 8.2 面板不显示 —— 注册进未声明槽位（且缺图依赖边）

`vore-console` 的客户端直接 `ctx.slots.register({name:'conversation.view', …})`。但该槽位的**声明**由
`@deepseek-ai/dsh-client-ui-conversation` 在自己的 apply 里提交（`children` 表），而 `slots.register` 的前置校验在宿主 core：
**未声明的目标会抛错**（`slots.ts:367-370` 注释：all load-time validation (undeclared target …) throws there）。宿主自带插件一律写成
`ctx.slots.inject('conversation.view', () => ctx.slots.register({ … }, Component))`。

**修复**：`lib/panel.js` 改为 `ctx.slots.inject("conversation.view", …)` 包裹注册并**重建 bundle**；
同时补图依赖边（与宿主 `ui-trajectory` 同做法）：`vore-console.dsh.client.inject` 增 `@deepseek-ai/dsh-client-ui-conversation`，
`vore-settings.dsh.client.inject` 增 `@deepseek-ai/dsh-client-ui-settings-general`（`settings.section` 的声明者）。

**新增闸门（永久）**：`vm-check.mjs` 的假 `slots.register` 现在**只在 `slots.inject` 回调内放行**，裸注册判失败；
`tests/client-contract.mjs` 追加**闸门自证**（把包裹换成裸调用必须报错）——现共 17 项断言。

### 8.3 两个面板的落点（按用户口径定稿）

用户要求「作战面板 + 设置」两个选项标签并排。定稿：**两者都注册成会话页签**（`conversation.view`），
「设置」**同时**保留设置弹窗里的一节（`settings.section`）——双入口、同一组件。
`order`：作战面板 50 → 设置 60（并排且固定相对次序）。两处注册都在 `slots.inject` 内，
`dsh.client.inject` 相应补齐 owner 包（`dsh-client-ui-conversation` / `dsh-client-ui-settings-general`）。
闸门同步收紧：`tests/client-contract.mjs` 按**逐插件多槽位**断言（vore-settings 必须有 `conversation.view` 与 `settings.section` 两个条目 + 两个 owner 边），
`settings.test.mjs` 断言注册项为 2 条、页签 order=60/标签「设置」、设置节 order=130/标签「dsh-voredteam 设置」。

### 8.4 「没选模式也是网络安全模式」——默认位被 preset.yml 的 `order: 0` 抢走

症状：用户没选任何模式，新会话默认就是网络安全模式。

链路（都在宿主源码里）：① roster 排序 = `order` 升序、未声明的排最后（`discovery.ts:164-169`）；
② 客户端选默认 = `presets.find(p => p.isDefault)?.id ?? presets[0]?.id`（`seat-store.ts:93`）——**没有任何预设被标记 default 时回退到列表第一项**；
③ 宿主自带模式 order 为 1..4（标准 1 / PTC 2 / 极简 3 / 创造 4），部署默认 `config.default = 'standard'`。
本项目的 `preset.yml` 当初写了 `order: 0` → 排到最前 → 成为回退默认。**删掉 `order`** 后本模式排最后，回退位回到 `standard`。

**新增闸门**：`tests/preset.test.mjs` 断言 `preset.yml` 的 `order` 必须缺省或 >4（附原因）；
`npm run preset:roster`（`tests/preset-roster.mjs`）按宿主规则打印整个模式列表并标出回退默认位，本模式占用默认位时**退出码 1**。

> 这已是第三起同类问题：**契约细节只在宿主源码里，不在我的测试里**。三次修法一致——找到宿主的判定点、写清文件:行号、落成断言。

### 8.5 教训

两起事故都属于**「契约在我方被想当然」**：第一起是客户端工厂形参，第二起是「槽位随时可注册」。
两次都不是靠跑自己的测试发现的，而是靠**读宿主实现**（`system.ts:159`、`slots.ts:367`、`discovery.ts:150`）才定位。
本项目现在的纪律：凡与宿主交互的契约，必须在宿主源码里指出 **文件:行号** 并落成断言，不接受「我们的测试过了」。

---

## 八、预设组合行的逐条对账：又查出 5 处（2026-09-19 深夜）

方法：新增 `tests/preset-config-schema.mjs`（`npm run preset:schema`）——在 DSH 检出目录里按包名找到每个宿主插件的源码，
import 它自己的 `Config`（cordis schema），把预设行里的 `config` 跑一遍校验，并**探测未被 schema 声明的键**
（宿主对未知键是宽容的：原样带回，所以写错字段名不报错、只静默失效）。审计对象：18 个顶层行 + 8 个嵌套行。

| # | 位置 | 问题 | 后果 | 依据 |
|---|---|---|---|---|
| 1 | `persona` 行 | 写了 `prefix:`，而 `@deepseek-ai/dsh-persona` 的 Config 只认 `text / complete / includeRuntimeContext` | **整段 54 行总控人格被静默丢弃**，模型只拿到 4 行速记（范式/派单四要素/门禁/事实纪律全部没进 system prompt） | `packages/preset/persona/src/index.ts:48-52` |
| 2 | `tool-fs-search` | 缺必需键 `sampleOverCapGlobResults`（无默认值） | 该行配置校验失败，mount 被拒 | `packages/fs/tool-fs-search/src/index.ts`（Config 内 `sampleOverCapGlobResults: boolean` 无默认）；宿主 standard 预设给 `false` |
| 3 | `tool-todo` | 缺必需键 `allowParallelInProgress` | 同上 | `z.object({ allowParallelInProgress: z.boolean().required() })`；standard 预设给 `true` |
| 4 | `delegation` / `planning` / `compaction` 三个 group 行 | 缺 **`group: true`** | 没有它，行里的 `config` **不会**被当成嵌套条目清单 → 组内 **8 个插件行全部没挂载**：`plan-mode`、`subagent-control`、`subagent`(spawn)、`subagent`(fork)、`workflow`、`compaction-basic`、`command-compact`、`tool-result-pruner`。**总控根本没有 subagent / workflow 工具**——派单范式的核心手段缺失 | `packages/boot/app-boot/tests/config-reload.spec.ts:258`（`loader.create({ name: 'cordis:group', group: true, config: [] })`）；`discovery.ts:70`（只有 `group === true` 才递归校验 config） |
| 5 | 委派组两个 subagent 行 | 都没写 `toolName`，而 schema 默认值是 `'subagent'` → **两行同名**；也都没写 `backgroundMode`（默认 `one-shot`）；且缺 `list-agents` 行 | fork 那行等于丢失（`subagent_fork` 不存在，而人格与角色卡都要求用它）；子 agent 不可续跑（`send_message` 起新一轮失效）；总控看不到自己在跑的后台子 agent | `packages/subagent/tool-subagent/src/index.ts:81-85`（`toolName` 默认 `'subagent'`、`backgroundMode` 默认 `'one-shot'`）；宿主 standard 预设的写法 |

**修法**：`persona` 只留一个 `text`（把原 `prefix` 正文整体搬进去，并追加一行浓缩速记）；两个工具行补必需键；三个 group 行补 `group: true`；
两个 subagent 行分别写 `toolName: subagent` / `subagent_fork` 且都设 `backgroundMode: continuable`；补 `subagent-list-agents` 行。
`deploy/deploy.mjs` 的预设落盘同时学会**清理副本里来源之外的文件**（宿主读的是副本，多一个旧备份就破坏等价性）。

**新增闸门（永久）**：
- `tests/preset.test.mjs` +3 项：每个 `cordis:group` 行必须有 `group: true` 与 `isolate`；两个 subagent 行的 `toolName` 必须不同且为 `subagent` / `subagent_fork`；`tool-fs-search` / `tool-todo` 的必需键必须在（共 10 项）。
- `tests/preset-config-schema.mjs`：逐行对宿主 schema 对账（需要 DSH 检出目录，按需运行）。
- `tests/verify-all.mjs`：宿主包解析改为**按包名**核对（允许 `…/list-agents` 这类子路径导出）。

> 这一轮最值得记住的是第 4 条：**`group: true` 缺失时没有任何报错**，预设照样挂载，只是少了 8 个插件行。
> 如果只看"模式出现了、面板也出来了"，会以为一切正常——直到要用 `subagent` 派单时才发现工具不存在。

---

## 九、第三起：点「网络安全模式」自动跳回「标准模式」（2026-09-19 深夜）

**机制**：客户端的模式芯片是在**空白会话**上把预设交接给宿主的（`ui-agent-preset/seat-store.ts:151-176`）：
`select(id)` → `agentPresets.select({sessionId, agentPreset})`；宿主一旦**拒绝**，客户端执行
`this.set({ busy:false, error:<message>, current: this.fallback })` —— `fallback` 就是部署默认（standard）。
所以「点一下就弹回去」= **宿主 mount 该预设失败**，错误文本就在芯片旁（容易被忽略）。

**复现与真因**：新增 `tests/preset-mount.mjs`（`npm run preset:mount`）——用宿主自己的 `boot()` 起真实 profile，
再做一次与 GUI 完全相同的 `agentPresets.mount(agentCtx, 'network-security')`。第一次跑就抓到**三个 mount 期阻塞**：

| # | 报错 | 真因 | 修法 |
|---|---|---|---|
| 1 | `webserver: duplicate prefix route "/vore-blackboard"` | 预设里写了 `vore-blackboard` / `vore-guard` 两行，而这两个插件**本来就在 profile bundles**（宿主面）里 → 同一条 HTTP 前缀路由注册两次 | 删掉这两行；宿主面插件对每个会话都生效，行为由工具内部的模式判定约束 |
| 2 | `PlanModeConfig needs a non-empty \`section\`` | `plan-mode` 行的 `config.section` 必填（计划模式激活时替换的提示词段） | 补一段 dsh-voredteam 口径的计划模式策略 |
| 3 | `workflow: waiting for workflowEngine` | 只挂了 `tool-workflow`，没挂引擎行；宿主 standard 预设在同组里有 `@deepseek-ai/dsh-workflow-worker-thread`（`provider: spawn`）并声明 `isolate: { workflowEngine: true }` | 补引擎行，并把三个 group 的 `isolate` 从 `true` 对齐成命名 realm（`workflowEngine` / `planMode` / `compaction`+`toolResultPruner`） |

**修好后**：`npm run preset:mount` → `✓ mount('network-security') 成功：工具 43 个`，关键工具齐备：
`subagent`、`subagent_fork`、`workflow`、`exit_plan_mode`、`bb_project_init`、`bb_graph`（另有 13 个 bb_* 与 bash/pwsh/read/edit/glob/grep/skill/todo_write/jobs/goal 等）。

### 9.1 为什么前面几章都没查出来

前九章的断言都在**离线**层面：YAML 形状、行 id/name、宿主 schema 校验、技能/注册表契约、bundle 装载（假 ctx）。
而这三个错误**只在真实装配时出现**——`webserver` 的路由表、`PlanModeConfig` 的运行时校验、cordis 的服务等待，
离线假 ctx 全都看不到。**结论**：预设的正确性必须用「真实 boot + 真 mount」验，离线断言只是第一层。

新增闸门：`tests/preset.test.mjs` +2 项（预设行不得与 profile bundles 重复；plan-mode 必须有 `section` 且必须带 workflow 引擎行）→ 预设 11 项。

---

## 十、发布就绪：把外部依赖全部内置（本轮）

要求：项目要发布到网上，**出厂文件里不能出现本机绝对路径**；技能、MCP 与其它配置全部写进项目。

| 类别 | 之前 | 现在 |
|---|---|---|
| 技能 | 目录联接指向本机外部库（`skill-roots/` → 外部路径；预设里 6 个绝对路径） | **真实文件内置** `vendor/skills/`：claude-red 50 · claude-red-legacy 28 · reverse-skill 43 · anthropic 120 · clown-src-skill 1（共 988 个文件 / 10.2 MB）；预设模板只写 `{{PROJECT_ROOT}}/…` |
| 技能索引 | `skills/registry.yaml` 500 条，path 指向本机外部库 | 由 `npm run registry:gen` 从内置目录生成 **246 条**，path 全为仓库相对路径；本机独有索引移到 `skills/registry.local.yaml`（gitignore） |
| MCP | 注册表里 11 处本机绝对路径（含 args/env/说明文本） | 全部换成 `${VORE_TOOLS_DIR}` / `${JAVA_HOME}` / `${HOME}` / `${VORE_UV_BIN_DIR}` / `${VORE_CLOWN_DIR}`；`mcp.list` 会展开占位符，并把**缺变量的条目标成未配置**（当前 19 条里 8 条需要环境变量） |
| 插件默认值 | vore-settings 的 `skills.roots` / `mcp.registryPath` 写死本机路径 | 由**插件自身位置**推导（`PROJECT_ROOT` = `plugins/vore-settings/lib` 上溯三级）→ 换机器/换目录都成立 |
| 运维脚本 | `restart-dsh-web.ps1` 写死本机路径 | 默认值取自 `$env:DSH_CHECKOUT` / `$env:DSH_HOME`（脚本内不含任何机器路径） |
| 许可合规 | 无 | `vendor/licenses/`（三份许可证原文）+ `vendor/THIRD-PARTY.md`（出处/许可/条数/风险提示） |

**新增闸门**：`tests/portability.test.mjs`（并入 `npm test`）——扫描 44 个出厂文件，发现盘符绝对路径/家目录绝对路径即失败；
并旁证四条：预设模板含 `{{PROJECT_ROOT}}`、deploy 会渲染它、技能注册表无绝对路径、MCP 注册表用占位符、`vendor/` 下无目录联接。
（`docs/` 与 `tests/` 不在扫描面内：前者按性质会描述作者机器布局，后者是开发脚本。）

**刷新流程（作者本机）**：`npm run vendor:skills`（看差异）→ `npm run vendor:skills:apply`（内置/刷新）→ `npm run registry:gen`（重建索引）→ `node deploy/deploy.mjs --apply`（落盘预设）。
**发布前检查**：`npm test`（含可移植性闸门）、`npm run verify`、`npm run preset:mount`、并确认 `vendor/THIRD-PARTY.md` 里的未授权提示（`clown-src-6k-skill`）已处理。

---

## 十一、作业法重设计：三阶段 + 回灌循环 + 覆盖账本（本轮）

**问题**：原设计只有「总控按图提意图、子 agent 认领」的通用循环，没把「先把面铺满 → 每个面浅扫一遍 → 再挑值钱的深打」写成纪律，
于是**测得全不全无法判定**：模型可以说「扫完了」，而没有任何数据能反驳它。

**改法**（方法论落到数据层，而不是只写在提示词里）：

| 新增 | 内容 |
|---|---|
| 阶段机 | `projects.phase` = P1 收集 / P2 浅测 / P3 深测 / P4 收口；推进只能经 `bb_phase_advance`，门禁不满足即拒绝并列缺口 |
| 覆盖账本 | `assets` 表（kind/value/tech/priority/浅测 `s2`/深测 `s3`）；**没登记 = 没测** |
| 饱和判据 | P1 出关要求「连续一轮收集 0 新增」+ 七类来源齐（或显式标记穷尽）；`bb_coverage {endRound:true}` 收轮 |
| 回灌循环 | P2/P3 期间新增资产 → 浅测覆盖率下降 → 门禁重新阻塞 → 必须补浅测；数据上自动成立，不靠自觉 |
| 新工具 5 个 | `bb_asset_add` / `bb_assets` / `bb_asset_update` / `bb_coverage` / `bb_phase_advance`（工具总数 13 → 18） |
| 新技能 | `skills/vore-testing-methodology/SKILL.md`：每类资产的浅测清单（指纹来源、低频模糊参数、JS 逆向提取项）与深测清单（CVE/逻辑/业务/越权/上传）、回灌规则、覆盖率读法、六条反模式 |
| 面板 | 作战面板新增第三个分栏 **覆盖矩阵**：阶段横幅 + 阻塞项 + 浅测/深测进度 + 按类别覆盖表 + 缺口清单（点选看资产详情） |
| 角色卡 | 13 份角色卡改为**阶段驱动**：frontmatter 增 `阶段:`，开工前必读 `bb_coverage`/`bb_assets`，回报给「资产 id + 阶段 + 结论 + 证据」四元组 |

**新增断言**：`tests/smoke.mjs` +6 项（阶段机全链路：P1 需收轮才饱和 → P2 需逐资产 done/na → P3 期间新增资产必须让覆盖率下降并重新阻塞 → P4 收敛；`force` 必须带 reason）；
`tests/load.mjs` 工具数 13 → 18 并点名 5 个新工具；面板侧 +3 项（三分栏存在、覆盖率视图模型、空数据不抛）。

---

## 十二、第四起：作战面板三个分栏全空（本轮，真凶有三层）

用户反馈：装上新版 dsh-voredteam 后「作战面板里面没有任何显示」。查下来是**三层叠加**，前两层各自都足以让面板看起来是空的。

### 12.1 第一层（真凶）：id 是"按项目编号"，主键却是全局的 → 第二个项目建不出来

`facts/intents/hints/assets` 的 id 由 `scoped_counters(project_id, kind)` **按项目**从 001 编（`f001`/`i001`/`a001`），
但表定义写的是 `id TEXT PRIMARY KEY` —— **全局唯一**。于是第二个项目连虚拟根都插不进去：

```
createProject → INSERT projects ✓ → INSERT facts(id='origin') ✗ UNIQUE constraint failed: facts.id
```

而 `createProject` 当时**没有事务**，projects 行已经落库 → 留下一个**没有任何事实的"幽灵项目"**。线上库实测：

```
projects: eng_001(session-e053938f…, 115 facts)  eng_002(session-08fefd15…, 0 facts)
facts 按项目计数：eng_001:115          ← eng_002 一行都没有，正是幽灵
```

叠加第三层（面板取数不带会话）后，面板读到最近更新的 `eng_002` → 图空、汇总空、覆盖矩阵空。

**修复**：

| 项 | 改法 |
|---|---|
| 主键 | `facts/intents/hints/assets` 改为 `PRIMARY KEY (project_id, id)`；`intent_sources` 改为 `(project_id, intent_id, fact_id)` |
| 迁移 | `rescopeIds()`：识别"主键里没有 project_id"的旧表 → 整表重建（改名 → **按 SCHEMA 的新定义建表** → 搬共有列 → 丢旧表），失败整体回滚；索引由重跑 `SCHEMA` 补回 |
| 幽灵清理 | 迁移时为缺少 origin/goal 的项目补回这两行（图才画得出来） |
| 建项目 | `createProject` 包进 `BEGIN IMMEDIATE … COMMIT`，失败 `ROLLBACK` —— **再也不会有幽灵项目** |
| 排序 | `listProjects()` 加 `rowid DESC` 兜底（`updated_at` 只到秒，同秒建的项目顺序原先不稳定） |

**线上库副本彩排**（`tests/_livecopy-migrate.mjs`，先拷副本再迁移，不拿真库冒险）：

```
迁移前 {'projects':2,'facts':115,'intents':53,'hints':2,'assets':0}  perProject: eng_001:115
迁移后 {'projects':2,'facts':117,'intents':53,'hints':2,'assets':0}  perProject: eng_001:115 eng_002:2
facts 主键: PRIMARY KEY (project_id, …)   新建第三项目 eng_003 ✓ 写事实 f001 ✓
```

### 12.2 第二层：面板取项目时不知道"我在哪个会话"

面板调 `/vore-blackboard/{graph,status,coverage}` 时**不带任何会话信息**，宿主端只能
`payload.projectId ?? store.listProjects()[0]?.id` —— 即"最近更新的项目"。别的会话新建一个项目，
本会话的面板就跑去读别人的（空）项目。

**修复（两端都改）**：

- 客户端：`panel.js` 从注入的 `props.sessionsStore` 读 `list.getSnapshot().current`（宿主 `SessionListState.current: SessionId|undefined`），
  经 `createApi` 的 `withScope()` 把 `sessionId` 附在 **graph/status/coverage/hint.add/intent.drop** 每一个请求上；
  另加 1s 会话哨兵：切会话或首次挂载时 sessions 尚未就绪（`current` 由 undefined 变真实 id）都会重新取数。
- 宿主端：`dispatch` 按 **显式 projectId > 请求 sessionId 对应项目 > 最近更新的非空项目 > 最近更新项目** 解析；
  `list` 端点给每个项目加 `empty` 标记。**"非空优先"这一档是必要的**：即使客户端拿不到会话 id（宿主版本较旧、sessions 未就绪），
  面板也不会再落到一个空项目上。

### 12.3 记一笔：测试自己是"假绿"的

新写的会话断言一开始没生效，原因是 `panel-render.mjs` 的 `ok()` **不 await** 断言体：
`ok("…", async () => { … })` 里的 `await` 之后的抛错只会变成未处理的 rejection，而 `pass++` 已经计上了。
同一个文件里"切分栏"的断言也是同步读渲染树 —— `setTab` 走的是异步重渲染，读到的是**上一个分栏的顶栏**，
配上宽松的正则（`/覆盖|阶段/`）就永远是绿的。修法：`ok` 改 `async` 并逐处 `await`；切栏后 `await flush()`；
断言词换成**只有该分栏才有、且来自 fixture 数据**的字符串（如「阶段 P2（P2 浅测）」「10.0.0.11:8443」「成果 1」）。
样例数据也从"线上抓的 eng_002（空项目）"换成**自造的脱敏富数据**（含 origin/goal、1 条 vuln、1 条死路、2 条 hint、6 个资产、
3 条缺口），否则"带数据渲染"测试其实一直在渲染空态。

### 12.4 本轮新增闸门

| 测试 | 新增断言 |
|---|---|
| `tests/smoke.mjs` | +6 项：两项目共存且编号各自从 001 起；同名 id 不串项目；建项目是事务（失败不留幽灵）；旧库迁移数据原样保留 + 主键已改；迁移后能建第二个项目；幽灵项目补回 origin/goal（共 31 项） |
| `tests/load.mjs` | +5 项：CSRF/跨源 403；不带 projectId 时不落到最新空项目；带 sessionId 按会话解析；显式 projectId 优先；面板写提示落到正确项目（共 19 项） |
| `plugins/vore-console/tests/panel-render.mjs` | +2 项（请求带当前会话 id / 会话未就绪时不带）；分栏断言改数据驱动（共 9 项） |

**现场修复动作**：插件是 `link:` 依赖，代码改动即时生效，但**宿主进程必须重启**才会加载新的 store/dispatch；
客户端 bundle 走 `?rev=` 防缓存，刷新页面即可。

### 12.5 测试规模对照：三阶段（浅+深）改造**之前** vs 现在

问题：改造会不会是"用新测试换掉旧测试"，覆盖面反而缩了？逐套件对账如下（**只增不减**）：

| 套件 | 三阶段之前 | 现在 | 增量来自 |
|---|---|---|---|
| 黑板引擎 `tests/smoke.mjs` | 19 | **31** | +6 阶段机/覆盖账本（P1 需收轮饱和 → P2 逐资产 done/na → 回灌重阻塞 → P4 收敛）· +6 多项目隔离/建项目事务/旧库迁移/幽灵补行 |
| 技能注册表 `tests/registry.test.mjs` | 9 | 9 | — |
| 预设 `tests/preset.test.mjs` | 11 | 11 | — |
| 装载冒烟 `tests/load.mjs` | 14 | **19** | +5 面板 HTTP 通道（CSRF/跨源 403、按会话解析、非空回退、显式 projectId 优先、提示归属） |
| 作战面板 `plugins/vore-console/tests/console.test.mjs` | 14 | **17** | +3 覆盖矩阵分栏（视图模型、三分栏存在、空数据不抛） |
| **面板真渲染** `panel-render.mjs` | **0（当时不存在）** | **9** | 迷你 React 真跑组件：首帧/取数后/三分栏数据驱动/会话归属/单端点失败韧性 |
| 设置面板 `tests/settings.test.mjs` | 29 | 29 | — |
| 客户端契约 `tests/client-contract.mjs` | 17 | 17 | — |
| **合计** | **113** | **142** | **+29** |

另外四层独立验证的口径没变：`verify`（**实测 88/88**；文档里旧值 87 与 95 是不同时期的快照，本轮统一改成实测值）、
`accept` 25/25、`deploy --check` 28/28、`preset:mount`（真实装配 43 个工具），以及三个内置闸门
（可移植性、`vendor` 逐字节一致、MCP 一致性）。

**项数不是重点，重点是"有没有一条断言能证明这件事"**。下面这五类面在改造前**一条断言都没有**：

| 面 | 改造前 | 现在 |
|---|---|---|
| 阶段/覆盖率（能不能推进、算不算测全） | 无 | 6 项（含"回灌新资产必须让覆盖率下降并重新阻塞"） |
| 资产清单工具与覆盖矩阵 | 无 | 工具名点检 + 3 项面板断言 |
| 面板在**有数据**时是否真渲染 | 无（只要不抛错就算过） | 9 项，且断言词必须是该分栏独有的数据 |
| 多项目共存 / 旧库能否迁移 | 无（第二个项目必炸且没人发现） | 6 项（含线上库副本彩排脚本 `tests/_livecopy-migrate.mjs`） |
| 面板 HTTP 通道的归属与安全 | 无 | 5 项 |

结论：**现在这一版更全面**，而且是"同一批旧断言一条没删"的前提下更全面；三阶段改造带来的不是替换，是叠加。

---

## 十三、第五起：门禁两侧都错了（误拦合法测试 + 漏放高噪声扫描）

触发问题：「目前这种测试的模式会遗漏掉某些渗透测试吗？」——查下来会，而且第一层原因不是"少了个插件"，是**唯一门禁本身在两边都判错**，加上**覆盖账本只记一个布尔位**。

### 13.1 误拦：爆破规则的 `/i` 把工具名里的 `-p` 也算命中

原规则 `/\b(?:--password-file|--passwords|-P)\s*[^\s|;&]+/i` —— `/i` 让它对大小写不敏感，于是：

| 命令 | 实际命中 | 后果 |
|---|---|---|
| `bloodhound-python -u user -p pass -d corp.local -c All` | `-python` | AD 枚举被拦 |
| `impacket-psexec corp/admin@target -hashes :aabb…` | `-psexec` | 横向移动/凭据复用被拦 |
| `impacket-… -no-pass` | `-pass` | 无密码登录验证被拦 |

量化（`tests/_skill-guard-scan.mjs`：720 份内置技能、83670 行围栏命令，逐行过 `scanCommand`）：

| | 判定会被拦 | 其中"禁止爆破" |
|---|---|---|
| 修复前 | **960 行** | 835 行（绝大多数是上述误报） |
| 修复后 | **217 行** | 87 行（真阳性） |

**为什么这条比"漏放"更要紧**：被拦之后模型只有两条路——换写法（门禁明令禁止）或放弃该测试面。**误拦直接等于漏测**，而且账本上看不出来（资产照样能标 `done`，只是没人测过它）。

**修复**：工具名必须出现在**命令词位置**（`^`/`;`/`|`/`&`/空白之后）才算命中；删掉裸 `-P` 规则（hydra/medusa/ncrack/wpscan 已被工具名规则覆盖）；顺带补 `nxc`（netexec 的新名字，原先是个绕过口子）。

### 13.2 漏放：nmap 的"速率控制"判定方向是反的

```
修复前： nmap -p- -T4             → 放行   （-T4 只是时序模板，不限制 pps）
        nmap -p- --min-rate 5000  → 放行   （--min-rate 是速率**下限**，越扫越快 —— 最激进的选项被当成"已限速"）
        nmap -p- --max-rate 20000 → 放行   （--max-rate 有值也不夹紧）
修复后： 三者全部拦截；上限 = defaultRps × 60，夹紧 100..1000
        `--top-ports 100` / `-p 80,443` / `-T2 --max-rate 50` 放行（拒绝文案推荐的替代方案自己不能被拦）
```

### 13.3 覆盖账本的漂白通道：`na` 不需要理由

`na`（判定不适用）与 `done` 一样计入覆盖率，但原先 `updateAsset` 完全不校验理由（`notes` 可选、门禁只认 `∈{done,na}`）——
于是"把难的面标 na"就是把覆盖率刷到 100% 的**合法**路径，而报告上看不出来。

**修复**：无理由 / 理由 <4 字一律拒绝（并给出怎么写理由的 hint）；覆盖率新增 `naShallow`/`naDeep`/`naNoReason` 与 `pct.shallowTested`/`deepTested`；
`bb_coverage` 与面板「覆盖矩阵」并列显示"其中 na … → 真测过 浅测 X% / 深测 Y%"。

### 13.4 内置第三方技能与本项目门禁的冲突（写进纪律，不改门禁）

`vendor/skills/` 1000+ 份外部技能给的是通用写法，其中 217 行会被本项目门禁拦（`nmap -sS -p- --min-rate 1000 -T4`、无 `-rate` 的 ffuf/nuclei/gobuster、`hydra`、netexec 喷洒等）。
处置：在 `skills/vore-rate-discipline/SKILL.md` 写明"读它们取思路与 payload，落到命令要改成本项目限速写法；被拦是预期，按拒绝文案改写，不要绕"，并在同一技能里列出**放行清单**（免得模型自己吓自己不敢用 `impacket-*`/`curl -u`）。

### 13.5 仍然会漏的（已单独成文，待决策）

**账本是"资产 × 一个布尔位"，不是"资产 × 测试类别集合"**：某接口标了 `s3=done` 之后，IDOR 之外的所有漏洞族（SQLi/SSRF/参数污染/竞态/上传绕过…）都失去痕迹。
同类问题还有：`priority` 自报（给 1~2 分即合法免除深测）、`SOURCE_CLASSES` 只有 7 类（云/凭据/仓库/客户端永不阻塞 P1）、没有"未测面"这一等对象（死路只记"试过没成"）、越权类缺"需要 ≥2 角色"的前置条件登记、唯一键合并多环境与 vhost、复核只复核结论不复核覆盖。
完整清单、证据与 7 条修法（含改动量与代价）见 **`docs/COVERAGE-GAPS.md`**；其中"测试类别账本"与"未测面账本"会改变阶段门语义，等用户拍板。

### 13.6 本轮新增断言（`npm test` 142 → 149）

| 套件 | 新增 |
|---|---|
| `tests/smoke.mjs` | +6 项：误拦回归（内网凭据复用类必须放行）· URL/路径里的工具名子串不算爆破 · 真阳性仍拦住 · nmap 速率纪律 12 条 · na 无理由被拒 · 覆盖率 na/真测过分开出数（共 37 项） |
| `plugins/vore-console/tests/panel-render.mjs` | +1 项：覆盖矩阵必须并列显示"其中 na"与"真测过"（共 10 项） |

新增文件：`docs/COVERAGE-GAPS.md`（遗漏面清单）、`tests/_guard-probe.mjs`、`tests/_guard-fp-probe.mjs`、`tests/_skill-guard-scan.mjs`（三只手动手动的探针，`_` 前缀不进 `npm test`）。

---

## 十四、第六起（重构）：五阶段作业法 + 检查矩阵 + 垂直作战面板（本轮）

用户口径（原话要点）：

1. **P2「浅层测试」不是"扫一眼"**，而是**逐资产把信息采全**：JS 逆向、后端语言、代码、中间件、操作系统、网站架构、网站目录、网站路径，以及"你能想到的其他任何内容"。
2. **P3「深层测试」要完整读已有信息，并核实中间层的工作是否有误**（例如实时抓包验证服务端未验证漏洞、越权漏洞等），覆盖中间层没测过的漏洞。
3. **在深层之前增加「中间层」**：核实浅层拿到的每一条资产信息，并对每个资产做 **OWASP Top 10** 测试。
4. **作战面板改为"起点——浅层——中间层——深层——成果"从上到下**（而不是从左到右），并把已有的目标（origin）与死点一并展示。

### 14.1 阶段机：P1–P4 → P1–P5

| 阶段 | 名称 | 出关条件 |
|---|---|---|
| P1 | 起点 | 资产非空 + 七类来源齐/穷尽 + **连续一轮 0 新增** |
| P2 | 浅层（信息全采） | 每个资产的 **info 必查项**全部有结论（`done`/`na`，na 带理由） |
| P3 | 中间层（核验 + OWASP Top 10） | 每个资产的 **verify 必查项**有结论 **且** `A01`–`A10` 有结论 |
| P4 | 深层 | `priority ≥ 3` 资产的 **deep 8 类**有结论；`verify=wrong` 已独立复算；`na` 都有理由 |
| P5 | 成果 | **未测面已显式声明** + **每条漏洞事实都有复核记录** |

旧库 `phase='P4'`（原语义=收口）在迁移时改写为 `P5`，避免"看起来已收口、其实没到成果"。

### 14.2 检查矩阵取代"布尔位"

新增表 `asset_checks (project_id, asset_id, stage, key, status, evidence, note, reviewed)`，四张矩阵：

- `info`（浅层信息采集）：BASE 12 项（`tech lang middleware os arch dirs paths cert dns waf third sec`）+ 按 kind 追加（js→`jsrev,params`、url/endpoint→`params`、ip/port/service→`banner`、app→`client`、repo→`repo`、cred→`cred`、cloud→`cloud`、domain/subdomain→`sub`）
- `verify`（中间层核验）：同 key 集合，状态 `ok|wrong|unknown|na`
- `owasp`（中间层）：`A01`–`A10`（OWASP Top 10 2021）
- `deep`（深层）：`unauth authz inj ssrf upload logic race deser`

机器强制：`na`/`wrong`/`unknown` 必须给理由（<4 字也拒）；`hit` 必须给证据；key 必须属于该 kind 的必查集（拒绝时回传合法 key 列表）。
`assets.s2/s3` 退化为**由矩阵自动同步的汇总位**（`syncAssetStages`），不再人工写。

### 14.3 另外三处"账本制度化"

- **未测面账本**：`untested` 表 + `bb_untested_add`（必须写 why ≥4 字）+ `bb_coverage {declareUntested:true}`；P5 出关要求显式声明。
- **优先级复核**：`priority ≤ 2` 的资产登记时必须带理由，否则 `upsertAssets` 直接跳过（`skipped` 回传原因）——不能靠自报低分免除深测。
- **复核**：`bb_fact_review(fact_id, verdict, evidence)`（`confirm|challenge`，证据必填）；P5 出关要求所有 `category=vuln` 事实都有复核记录。
- **回灌**：新增资产时若阶段已超过 P1，**自动退回 P2** 并在 `phase_note` 写明"回灌：新增 N 个资产（原阶段 Px）"。
  （**第十五章已把这条再收紧为"退回 P1 起点 + 必须先再收一轮确认穷尽"**；本节保留当时的实现描述。）

### 14.4 新增工具（18 → 22）

`bb_asset_check`（登记一条矩阵项）· `bb_asset_checks`（查矩阵/缺口）· `bb_untested_add`（未测面）· `bb_fact_review`（复核）。
`bb_coverage` 扩展返回 `stages.{info,verify,owasp,deep}.{required,done,pct,gaps}`、`untested{declared,count,items}`、`reviews{vuln,reviewed,pending,challenged}`、`blockers.{P1..P4}`、`canAdvanceTo.{P2..P5}`；
HTTP 新增 `/vore-blackboard/checks` 端点；`/assets` 每行附 `checks`（stage→key→status）与 `checkSummary`。

### 14.5 作战面板：从左到右 → 从上到下

「实时情况」改为**垂直五泳道**：起点 → 浅层 → 中间层 → 深层 → 成果；origin 固定第一条泳道、成果固定最后一条；资产节点按各阶段完成度落位；**死点**（`dead` 意图与 `deprecated` 事实）集中在右侧灰色虚框区；待探索仍是虚框；
「覆盖矩阵」并列显示四张矩阵的完成度、缺口、未测面清单与复核进度。

### 14.6 迁移踩坑（记一笔）

`rebuild()`（整表重建）是**按 SCHEMA 的新定义**建表的，而新列（`review_status`/`untested_declared`）是用 `ALTER` 补的 —— 我最初把 `rescopeIds()` 放在 `ALTER` **之后**，导致旧库迁移时刚补上的列又被新定义覆盖掉（`no such column: review_status`）。
修法：`migrate()` 里**先整表重建、再补列**。这条已由 `tests/smoke.mjs`「旧库迁移：新表与新列一并就位」钉住。

### 14.7 断言变化

`tests/smoke.mjs` 37 → **43 项**（+5 组五阶段门禁：浅层 info 全覆盖 / 中间层 verify+OWASP / `wrong` 必须复算 / P5 三条件 / 漏洞复核；+1 组旧库新表新列；并改造回灌、na、低优先级三组）；
`tests/load.mjs` 19 → **22 项**（工具面 18→22、检查矩阵工具端到端、会话模式门 3 项）；
面板侧断言由垂直改造一并更新（见 `plugins/vore-console/tests/`）。

---

## 十五、第七起（再收敛）：信息收集独立成阶段 + 六段流水线（本轮）

用户口径（原话要点）：

1. **「浅层」之前还有一个"信息收集"的步骤**；
2. **浅层先核实信息收集阶段的工作内容，然后才做浅层的工作内容**。

于是作业法从五阶段再收敛为**六阶段**，并确立"**每一层先核实上一层，再做本层**"的纪律：

```
P1 起点 → P2 信息收集 → P3 浅层（核实信息收集 + 浅层测试） → P4 中间层（核实浅层 + OWASP Top 10） → P5 深层（读全量 + 核验中间层 + 漏洞验证） → P6 成果
```

### 15.1 六张矩阵（`asset_checks` 的 stage）

| stage | 属于 | key 集合 | 状态取值 |
|---|---|---|---|
| `info` | P2 信息收集 | BASE 12 + 按 kind 追加 | `done`/`na`/`doing` |
| `verifyInfo` | P3 浅层·核实信息收集 | 同 `info` | `ok`/`wrong`/`unknown`/`na` |
| `shallow` | P3 浅层·浅层测试 | 8 项：`fp pathTruth params authEdge errLeak expose lowFuzz compHint` | `done`/`hit`/`na` |
| `verifyShallow` | P4 中间层·核实浅层 | 同 `shallow` | `ok`/`wrong`/`unknown`/`na` |
| `owasp` | P4 中间层 | `A01`–`A10` | `done`/`hit`/`na` |
| `deep` | P5 深层 | 8 类：`unauth authz inj ssrf upload logic race deser` | `done`/`hit`/`na` |

**范围**：`info`/`verifyInfo` 要求所有资产；后四张只要求 `priority ≥ 3`（低优先资产登记时必须写理由 → 可审计的降级，不是偷偷免测）。

### 15.2 出关条件

| 推进 | 条件 |
|---|---|
| P1→P2 | 资产非空 + 七类来源齐/穷尽 + 连续一轮 0 新增 |
| P2→P3 | `info` 全项有结论 |
| P3→P4 | `verifyInfo` 全项 **且** `priority ≥ 3` 的 `shallow` 8 项 |
| P4→P5 | `verifyShallow` 全项 **且** `priority ≥ 3` 的 `A01`–`A10` |
| P5→P6 | `priority ≥ 3` 的 `deep` 8 类；`wrong` 已 `reviewed`；**中间层 OWASP 结论已 `reviewed`**；`na` 都有理由；未测面已声明；每条漏洞事实已复核 |

### 15.3 迁移（这次踩到三个坑，都写进断言了）

1. **阶段映射不能逐条 UPDATE**：`P3→P4` 写完会被下一条 `P4→P5` 再命中，一路滚到 `P6`。改成**一条 `CASE` 语句**同时完成映射与 `phase_scheme=1`。
2. **旧 stage 名要改名**：五阶段时代的 `stage='verify'`（核实信息收集）→ `verifyInfo`，同一次升级事务里 `UPDATE asset_checks SET stage='verifyInfo' WHERE stage='verify'`。
3. **stage 名大小写**：`setCheck` 曾把 stage 统一 `toLowerCase()`，导致合法的 `verifyInfo` 被判成"未知 stage"——现在按大小写不敏感匹配回规范名。

`tests/smoke.mjs`「六阶段升级：旧五阶段的 phase 与 stage 命名会被就地改写（且只改一次）」覆盖：`P3→P4`、`P5→P6`、`verify→verifyInfo`、`reviewed` 保留、二次打开不重复映射。

### 15.4 面板：五泳道 → **六泳道**

「实时情况」改为**六条泳道从上到下**：起点 → 信息收集 → 浅层 → 中间层 → 深层 → 成果；origin 固定第一条、成果固定最后一条；资产节点按六张矩阵完成度落位（浅层泳道显示 `verifyInfo + shallow`、中间层显示 `verifyShallow + owasp`、深层显示 `deep x/8 · 命中 n`）；死点区仍集中在右侧灰虚框。
「覆盖矩阵」并列显示**六阶段完成度**（含每阶段缺口数与 `asset:key` 点名）、**六张矩阵**各自完成度、未测面清单、复核进度，并保留"na 与真测过分开"。

### 15.5 断言变化

`tests/smoke.mjs` 43 → **45 项**；`tests/load.mjs` 22 项；`plugins/vore-console/tests/console.test.mjs` **24 项**、`panel-render.mjs` **15 项**（六泳道 + 六矩阵 + 旧契约兜底）；`tests/verify-all.mjs` **88/88**。

### 15.6 回灌的语义再收紧：**回到 P1 起点，且必须先再收一轮**

用户追问「JS 逆向 / 目录探测 / 配置文件里发现新资产后，会从这个循环的起点开始吗」—— 五阶段那版是"退回 P2（信息收集）"，**不够诚实**：新资产出现恰恰证明"面还没穷尽"，
那么上一轮的 **P1 饱和判定本身就该作废**。现在改成：

1. `upsertAssets` 新增资产 → `phase='P1'` + **`reflow_pending=1`** + `reflow_count += n` + `reflow_source=<来源>`（js-reverse / dir-fuzz / config / cert…）+ `phase_note` 写「回灌：新增 N 个资产（来源 X；原阶段 Px）→ 回到 P1 起点，需再收一轮确认穷尽」。
2. `coverage().blockers.P1` 多一条「**回灌未收轮**」，于是 `canAdvanceTo.{P2..P6}` 全部为否 —— 任何阶段都推不动。
3. `endReconRound` 清掉 `reflow_pending`；但**这一轮若仍有新增**（`addedThisRound > 0`），P1 的"上一轮仍有 N 个新增"阻塞仍在 → 还得再收一轮。**连续 0 新增才解封**。
4. 解封后按正常顺序走：P2 给这批新资产做信息收集 → P3 核实 + 浅层测试 → P4 核实 + OWASP → P5 深层 → P6 成果（旧资产已有的检查行不受影响，只有新资产是缺口）。
5. 可见性：`bb_coverage` 渲染出「⚠ 回灌未收轮…」行；逐轮快照注入同样带这行；面板覆盖矩阵顶部出横幅（`panel-render.mjs` 有断言）。

断言：`tests/smoke.mjs` +1 组（回灌 → P1、`reflow.pending/source`、P1 阻塞、再收一轮清 pending、本轮有新增则继续阻塞、连续 0 新增后解封并可回 P2），并把 P5 出关用例改成"回灌打断 → 再收两轮 → 回 P2 补矩阵"的真实场景（共 **46 项**）。


> 备注：本轮面板与技能文本改造原本派了两个子 agent，两个都在中途失败；**剩余部分（面板测试对齐、角色卡阶段字段、persona 六阶段表、文本里残留的 `verify` 口径）由我接手完成**，所以断言数与文件状态以本节为准。

## 十六、第八起（小改）：作战面板全屏模式（本轮）

用户口径（原话）：「能否给作战面板加一个全屏模式方便观看」。

### 16.1 实现

- **入口**：状态条右侧新增 **「全屏」/「退出全屏」** 按钮（`title="全屏看整张图（Esc 退出）"`）。
- **两级降级**：优先 `requestFullscreen()`（Fullscreen API，真全屏、隐藏浏览器 UI）；被浏览器拒绝（非用户手势、iframe 缺 `allowfullscreen`、策略限制）时**自动降级**为 CSS 兜底全屏 —— 根元素加 `is-fs`：`.dsh-vc-root.is-fs{position:fixed;inset:0;z-index:2147483000;background:var(--vore-panel-bg,#fff);padding:6px;}`（深色主题下 `--vore-panel-bg:#0f1420`）。所以按钮**永远有反馈**，不会"点了没反应"。
- **退出**：再点按钮 / **Esc** / 浏览器原生退出（`fullscreenchange` 监听，点 Esc 会同步回状态，不会状态错位）。三个 return 分支的根元素统一用 `rootProps`（`className` 含 `is-fs`、`ref: rootRef`），因此空项目、加载中、正常三种画面都能进全屏。
- **画布自适应**：进全屏那一刻按**新容器尺寸**重算缩放（`canvasRef.getBoundingClientRect()` → `fitView`），全屏状态下「适应窗口」按钮同样按全屏容器算 —— 否则全屏后图会缩在左上角一小块。
- **提示行**：全屏期间画布底部显示「全屏中：滚轮缩放 · 拖拽平移 ·「适应窗口」回全局 · Esc 退出」，让暗色全屏里也有操作指引。

### 16.2 这次改动的真实风险点：hook 顺序

全屏功能要新增**两个 hook**（`useState(false)` 存 `isFs` + 一个 `useEffect` 监听 `fullscreenchange`/`keydown`）。而本面板此前刚因 **React #310**（hook 数量两帧间 26 → 27）白屏过 —— 病灶正是"某个 hook 写在提前 return 之后"。所以这次：

1. 两个新 hook 都插在**任何 return 之前**，与既有 12 个 `useState`、3 个 `useEffect`、1 个 `useCallback`、5 个 `useMemo` 并列；
2. 复核脚本按源码顺序切出所有 return，断言**每个 return 之后的 hook 调用数 = 0**；
3. `panel-render.mjs` 的 mini-React 本来就带 **hook 数量守恒门**（`inst.hookViolation`），两帧 hook 数必须相同，且断言文件里加了一条**全屏切换断言**：点「全屏」→ 根元素带 `is-fs` + 出现「全屏中」提示 → 按钮文案变「退出全屏」→ 再点 → 复原，且全程 `inst.error` 为空。

### 16.3 断言与实测

| 项 | 结果 |
|---|---|
| `plugins/vore-console/tests/panel-render.mjs` | 18 → **19 项**（新增全屏切换断言） |
| `npm test` 全量 | **177 项**（smoke 46 / registry 9 / preset 11 / load 22 / console 24 / panel-render 19 / settings 29 / client-contract 17）+ portability / vendor-integrity / mcp-integrity 三组门 |
| `npm run verify` | **88/88** |
| `npm run accept` | **25/25** |
| `node deploy/deploy.mjs --apply` | 预设与插件**内容一致，跳过写入**（本轮只改客户端 bundle，未动预设与 profile） |

### 16.4 「要不要重启宿主」——实测结论：不需要，刷新页面即可

客户端 bundle 由宿主**按请求从磁盘读**，不存在进程内缓存。所以直接对运行中的宿主取包比对：

```
GET http://127.0.0.1:3080/plugins/@dsh-external/vore-console/client.js
→ 200 · 108558 字节 · 含 is-fs / 全屏中
SHA256 仓库文件 = SHA256 线上响应 = 4999BB43F59133764C2B3B422AAC7EB2DBC36204A7C80310F3CB3BCC690E1985
```

**字节级一致** → 用户只需 **Ctrl+F5 刷新页面**，点新出现的「全屏」按钮即可；本轮**没有**为了它重启 dsh web。（此前那条"客户端面板的改动要重启宿主"的结论对**宿主侧**改动成立——工具面、HTTP 路由、preset 是启动期装载的；客户端 bundle 是静态文件，按请求读盘。）

## 十七、第九起：全屏还是一大片黑的（真因是**一条泳道两万五千像素宽**）+ 泳道改八条（本轮）

用户口径（原话要点）：

1. **「全屏模式下左下角有一个很大的黑色区域」**；
2. **「（适应窗口 ＋ －）的位置不是固定的」**；
3. **「目前的分层是 起点-信息收集-浅层-中间层-深层-成果，我希望改为 起点-信息收集-浅层-中间层-深层-线索（分为已确认事实和未确认）-死点-成果（也就是挖到的漏洞）」**；
4. **「将字体改为肉眼易见的字体（目前的字体是黑色搭配背景完全看不见）」**。

### 17.1 先量，再改：黑区域不是渲染 bug，是**布局尺寸**问题

拿线上真实项目（`eng_002`，91 个资产）跑一遍布局，数据说话：

```
修复前：layout = 25916 × 676     （宽高比 38:1）
        起点泳道把 91 个资产 + origin 排成**一行**：36 + 168 + 90×(168+116) ≈ 25.9 千像素
        fitZoom(25916, 676, 1590, 900) = 0.06 —— 旧实现的下限是 0.12，**压不到**
        → 屏幕上只剩极窄一条横向切片，其余全是空底色（就是用户说的"左下角一大片黑色区域"）
```

**两条修复**（缺一条都不成立）：

1. **泳道内换行**（`PER_ROW_MAX = 10`，按条数取平方根成方格阵）：91 个资产从"一行 25.9 千像素"变成
   "10 列 10 行"，整图 25916×676 → **2912×1262**；
2. **缩放下限 0.12 → 0.05**，并把比例算法抽成可离线断言的 `pure.fitZoom()`（`pure.mjs`）。

修复后同一份线上数据：

| 画布 | 缩放 | 覆盖 |
|---|---|---|
| 普通分栏 1100×420 | 0.321 | 宽 85% · 高 96% |
| 全屏 1920×1080（画布 1590×900） | 0.537 | 宽 98% · 高 75% |
| 全屏 2560×1440 | 0.753 | 宽 98% · 高 77% |
| 旧行为：进全屏瞬间量到的小窗 | **0.321 被一直沿用 → 全屏后图仍是小窗比例** | —— |

### 17.2 「位置不固定」：工具条原来在**滚动容器里**

`适应窗口 / ＋ / －` 早先写在 `.dsh-vc-canvas`（`overflow:auto`）里面用 `position:absolute` 定位，
**一滚图 / 一平移就跟着图跑掉**。现在拆成两层：`.dsh-vc-canvaswrap`（定位层，`position:relative`）
+ `.dsh-vc-canvas`（滚动层）+ `.dsh-vc-canvasctl`（钉在定位层右上角，另加缩放百分比读数）。
`panel-render.mjs` 有断言：工具条**不得**出现在滚动容器内部。

另外补上"进全屏后按新容器重算缩放"：进全屏那一刻 React 还没重渲染、浏览器也还没完成全屏切换，
量到的还是**旧小窗口** —— 所以把 `fitView` 存进 `fitRef`，进全屏后用 rAF + 120ms + 420ms 补算三次，
再挂 `resize` 监听。

### 17.3 八条泳道：线索（已确认 / 未确认）+ 死点

| # | 泳道 | 内容 |
|---|---|---|
| ① | 起点 | `origin` 锚点；完成度 = 资产数 + 收集轮次（标题里说话） |
| ②③④⑤ | 信息收集 / 浅层 / 中间层 / 深层 | **资产节点**按六张矩阵落位（同上版） |
| ⑥ | **线索** | 事实分两组上下摆：**已确认事实**（confidence=confirmed） / **未确认**（疑似 + 待探索方向） |
| ⑦ | **死点** | 死路意图 + 被推翻的事实（灰色虚框）—— 从"右侧灰框"搬进泳道 |
| ⑧ | 成果 | `goal` + `category=vuln` / 带 severity 的事实 |

顺带两个"看着别扭"的地方一起收了：

- **待探索虚框**从"成果泳道"挪到"线索 · 未确认"（未结论的方向本来就不是成果）；
- **资产清单不再在起点泳道重复画一遍**：同一批资产在起点 + 信息收集各画一次，节点数直接翻倍、
  图被撑高一倍，全屏后字就小到看不清。现在资产落在**信息收集**泳道第一格（待采集清单，如实显示 `info 0/0`），
  起点泳道靠标题的「91/91 · 收集轮次 1」说话。实测线上节点数 **182 → 91**，渲染文本 10502 → 7019 字符。
- **序号改用 ①②③…**（不用 P1–P6）：八条泳道 + 作业法六阶段号混在一屏里，用户会数不清；
  覆盖矩阵里的"六阶段完成度"仍是 P1–P6（口径不变，`phaseRows` 过滤掉计数型泳道后重新编号）。

### 17.4 字体：黑字压深底的真因是 **SVG 文本默认 fill 是黑色**

`.dsh-vc-node text{fill:currentColor}` 只管节点文字；**泳道标题 / 副标题 / 组名 / 死点标题都没有 fill**
→ SVG 规范里它们默认就是**黑色**，深色主题下等于隐身。修复：

1. 专类写死：`.dsh-vc-lanetitle / .dsh-vc-lanesub / .dsh-vc-grouptitle / .dsh-vc-deadtitle{fill:var(--vore-ink|--vore-muted)}`，
   同时给这些 `<text>` 打上 `fill` 属性（双保险）；
2. **配色不再赌宿主主题**：面板自带 `--vore-ink / --vore-muted / --vore-canvas-bg / --vore-grid` 两套值，
   画布有**不透明底色**；深色由 `body[data-ds-dark-theme]` **或** 面板自己探测（`detectDarkTheme()`
   → `.dsh-vc-root.is-dark`，1 秒哨兵跟着宿主切换）触发；
3. 字号整体 +1~1.5px（节点 11→12.5、泳道标题 12→14 加粗、副标题 10→12），字体栈带中文
   （Microsoft YaHei UI / PingFang SC / Noto Sans CJK SC）；`opacity` 从 .6~.75 提到 .8~.92。

### 17.5 事故：这次改动静悄悄损坏了 `lib/panel.js`（如实记录）

改到一半时用了一条 PowerShell 惯用写法：

```powershell
(Get-Content lib\panel.js -Raw) -replace 'a','b' | Set-Content lib\panel.js -Encoding UTF8 -NoNewline
```

本机 `Get-Content` 按 **ANSI 码页**解码这个 UTF-8 文件 → 中文全部变成乱码（部分字节无法映射，回写时变成 `?`，
**不可逆**），而且换行也被吞掉，文件从 954 行塌成 899 行。**这是本项目第二次踩同一个坑**（第一次是 README）。

抢救方式：损坏前刚跑过 `build-client`，`lib/client.js` 里**逐字包含**未损坏的 `panel.js`
（构建脚本就是 `BANNER + pure + panel + 尾部` 三段拼接）。于是写了 `tests/_restore-panel.mjs`：
按 `// vore-console 面板实现…` 与 `module.exports = { name: "vore-console-client"` 两处锚点把那段切出来写回，
再用 `build-client --check` / 全量测试验证。**结论：源文件只能用文件工具或编辑器改，禁止
PowerShell 的 `Get-Content | Set-Content` 往返**（已写进 `plugins/vore-console/README.md` 的显眼提醒）。

### 17.6 断言与实测

| 项 | 结果 |
|---|---|
| `plugins/vore-console/tests/console.test.mjs` | 25 → **27 项**（+ 线索分组 / + 适应窗口与全屏补算机制） |
| `plugins/vore-console/tests/panel-render.mjs` | 19 → **21 项**（+ 工具条固定在滚动容器外 + 可读性 CSS 契约） |
| `npm test` 全量 | **182 项** 全过 + 可移植性 / vendor 完整性 / MCP 三组门 |
| 线上实测（`eng_002`，91 资产） | 八条泳道齐、节点 91、布局 2912×1262、全屏覆盖 98%×75%、渲染无异常 |

> 「字还是小」的说明：91 个资产 + 六层矩阵铺在一屏里，**适应窗口**给出的是"看得见全貌"的比例；
> 看细节用滚轮 / ＋ 放大、拖拽平移（全屏下更好用）。这是有意的取舍：全屏第一诉求是"看整张图"。

## 十八、第十起：**一个会话一个项目**（新会话不再"继承"上一个会话的作战面板）

用户口径（原话要点）：「我开新会话后没有使用新的作战面板，似乎直接把所有会话测试过的全部放到同一个作战面板里面了。
我希望按会话在作战面板中分类，比如某个会话测试了巨人网络，作战面板里就会显示巨人网络测试项目，
点开后就是那次测试的作战面板，新开会话测试则是新的」。

### 18.1 真因：面板项目解析里有一档 **「最近更新的非空项目」**

```js
// 旧口径（问题就在这里）
resolvePanelProject = (payload) =>
  payload.projectId
  ?? findProject({ sessionId })                 // 本会话有项目 → 用它
  ?? (listProjects().find(p => !p.isEmpty))     // ⚠ 本会话没有 → 直接端出**别人的**项目
  ?? listProjects()[0];
```

那一档最初是为了救"面板三个分栏全空"（当时是幽灵空项目抢走了最近更新位），
代价是**新会话没有自己的黑板时，面板会显示上一个会话的项目** —— 正是用户看到的现象。
更糟的是同一套"cwd 回退"也用在**系统提示注入**上：新会话一开就被塞进上一个项目的图快照，
模型会以为自己还在测上一个目标。

### 18.2 新口径：**会话是项目的唯一边界**（子 agent 例外）

| 调用方 | 解析规则 |
|---|---|
| 顶层会话（人看的那个） | **只认自己 `session_id` 绑定的项目**；没有 → 空（面板显示"本会话还没有黑板"），**绝不按 cwd 借** |
| 子 agent（会话头 `origin=subagent` / `delegationDepth>0`） | 自己 session → **父会话**（`header.parentSession`）→ 工作目录回退 → 空 |
| 任何调用方显式传 `project` | 直接用那个项目（最高优先） |
| 面板 HTTP | `projectId`（人点开的历史项目）> 本会话 `sessionId` > **null**（不再有任何"猜一个"的档） |

配套的三处硬约束：

1. **`findProject({allowCwd})`**：`allowCwd=false` 时**完全不看** cwd —— 顶层会话与面板都走这条；
2. **`ensureProject({allowCwd})`**：顶层会话 `bb_project_init` 时若本会话没有项目就**新建一个**，
   不会去接管同目录里别人建过的项目（否则"新开会话"等于直接续上一轮）；
3. **黑板归顶层会话**：万一 `bb_project_init` 是子 agent 打的，也把 `session_id` 绑到
   `header.parentSession` 上，人看的那块面板才找得到自己的图。

### 18.3 面板 UI：顶栏「会话」下拉 + 历史项目清单

- 顶栏新增 **`会话` 选择器**：`本会话：<项目名>` 一个选项 + 其余按会话分组的 `<optgroup>`（选项里直接写
  `阶段 · 资产 N · 事实 N`）；选中别的会话的项目即"钉住"，并出现黄色横幅「正在看历史项目：…」+ **「回到本会话」**按钮；
  钉的 id 记在 `localStorage`（刷新页面还停在那张图上）。
- **本会话没有黑板时**：不再显示任何别人的图，改为显示空态 ——
  「本会话还没有黑板（一个会话一个项目）」+ 本会话短 id + **历史项目清单（按会话归类，点一条就打开）** +
  「或直接给本会话建黑板」（origin / goal 两个输入框 + 按钮，调 `project.create` 绑到本会话）。
- 新增 HTTP 端点 **`POST /vore-blackboard/projects`**：返回每个项目的 `sessionId / phase / counts / empty / mine`，
  面板据此分组（纯函数 `projectsView()` 可离线断言：本会话组永远第一，其余按更新时间倒序，未绑会话的单独一组）。
- 所有 `bb_*` 工具新增可选参数 **`project`**（21 个工具）：派单时把它写进子 agent 的 prompt，
  多层子 agent / 跨会话都不会认错图（`needProject(exec, { projectId })` 优先吃它）。

### 18.4 断言与实测

| 项 | 结果 |
|---|---|
| `tests/load.mjs` | 22 → **24 项**：新增「新会话不会借到别人的图（`graph=null` + `scope.source='none'`）」「`projects` 端点给出 `mine` 标记与进度」「顶层会话不按 cwd 借项目」「子 agent 仍能按 cwd/父会话命中」「子 agent 建的板绑到父会话」 |
| `plugins/vore-console/tests/panel-render.mjs` | 21 → **24 项**：新增「顶栏会话选择器（本会话 + 历史项目 + 计数）」「新会话空态 + 历史清单 + 建板表单，且不借别人的图」「点开历史项目→带 projectId + 横幅 + 回到本会话」 |
| `npm test` 全量 | **187 项** 全过；`verify` 88/88；`accept` 25/25 |
| 生效方式 | **宿主侧改动**（插件后端 + 客户端 bundle）→ 需要 `deploy --apply` + **重启 dsh web**（与上一轮不同：上一轮只改客户端 bundle） |

### 18.5 对既有数据的影响（如实说明）

线上已有两个项目：`eng_001`（绑 `session-e053938f…`）、`eng_002`（绑 `08fefd15…`）。
重启后，**任何不是这两个会话的会话**打开作战面板都会看到"本会话还没有黑板"，但历史项目清单里能一键点开
`eng_001` / `eng_002` 看它们各自的图；要让某个新会话有自己的图，让总控在那个会话里 `bb_project_init` 即可
（新建，不会覆盖历史项目）。

## 十九、加一个「清缓存」按钮（并说清什么才算缓存）

用户口径：「先清空作战面板里面的缓存」。

先把账摊开 —— 面板到底缓存了什么，逐条落实（不靠"清一下试试"）：

| 层 | 有没有缓存 | 处理 |
|---|---|---|
| `localStorage`（钉住的历史项目 `vore.panel.pinnedProject`） | **有** | 新增 **「清缓存」**：删掉所有 `vore.*` 键（**不动**别的应用的键），回执里列出删了哪些 |
| 内存态（选中对象 / 缩放 / 平移 / 分栏 / 提示输入 / 取数快照） | 有（刷新即失） | `清缓存` 一并复位，随后立即重新取数 |
| CSRF 令牌（`createApi` 内部缓存） | 有 | `清缓存` 调 `api.reset()` |
| 浏览器**文件缓存**（旧 `client.js`） | 有，但 JS 清不掉 | 新增 **「强刷页面」**（`location.replace(href + "?vore_reload=<ts>")`，换 URL 强制重取）＝ Ctrl+F5 |
| 服务端（黑板 HTTP / 图 / 覆盖矩阵） | **没有** | 响应一律 `cache-control: no-store`，图与矩阵都按 SQLite 现算；`~/.dsh/voredteam/blackboard.db` 是**数据不是缓存** |

刻意没做的一件事：`清缓存` **不清空已显示的图**。先清再取数会闪一下"本会话还没有黑板"的假空态
（`busyRef` 里可能还有一次在飞的刷新），所以只清缓存与本地状态、保留最后一张图，等新数据覆盖它 —— 这条也写进了断言。

断言：`panel-render.mjs` 24 → **25 项**，新增「清缓存：清掉 `vore.*` 本地键（`unrelated` 键必须留着）+ 复位钉住的历史项目
+ 回执提示 + 重新取数」。实测线上库只有 2 个项目且都非空（`eng_001` 112 事实 / `eng_002` 91 资产），
**没有空壳项目可清** —— 面板里那两条历史项目是真实数据，不是缓存。

## 二十、「清缓存」改成「删除该面板」（并把不可逆动作做实）

用户口径：「将清缓存改为删除该面板，选择某个作战面板后将该面板删除」。

### 20.1 面板侧：删的就是**当前显示的那一块**

按钮改成红色描边的 **「删除该面板」**，删的对象 = `graph.project.id`（本会话的黑板，或从「会话」下拉里点开的历史项目），
不是"随手找一块"。流程：确认框（写清项目 id / 标题 / 会连带删掉多少条：事实 · 意图 open·claimed·dead · 提示 · 资产 · 六张矩阵 · 未测面 + "不可逆"）
→ `POST /vore-blackboard/project.delete {projectId}` → 回执（各表条数 + 备份路径）→ 若删的是被钉住的历史项目，顺手清掉钉住状态回到本会话。
点「取消」**一个请求都不发**（防误删，有断言）。

### 20.2 服务端：先备份，再原子删除

`store.deleteProject(id)`：

1. **先落库备份**：`VACUUM INTO 'blackboard.backup-<YYYYMMDDTHHMMSS>.db'`（SQLite 原生一致性快照，WAL 下也安全）。
   备份失败 → **中止删除**并如实报错（数据未动），绝不"删了却没备份"；
2. **一个事务**删 9 张表：`intent_sources / asset_checks / untested / facts / intents / hints / assets / scoped_counters / projects`；
   任一步抛错 → `ROLLBACK`，返回"已回滚（数据未动）"；
3. 返回逐表计数（回执里给人看）+ 备份路径；项目不存在返回 `{ok:false, error:"项目 … 不存在"}`（幂等）。

对应工具面：`bb_project_delete { project, confirm: true, reason? }` —— `confirm` 写成**必填**，
缺了在框架层就报 `INVALID_ARGS: missing required property "confirm"`（不靠 execute 里的软兜底）；
`project` 走与其它工具同一套解析（显式 id > 本会话 > 父会话 > 子 agent 的 cwd 回退）。

### 20.3 断言与实测

| 项 | 结果 |
|---|---|
| `tests/load.mjs` | 24 → **27 项**：新增「删面板整块删干净（逐表条数对上删除前图上的条数）+ 不影响别的项目 + 再删报不存在 + 不给 projectId 明确拒绝」「`bb_project_delete` 缺 `confirm` 被框架层拒 + 补齐后能删」「**文件库**：删除前落一份**可用**备份（从备份里能读回整块面板），主库那边确实删空」 |
| `plugins/vore-console/tests/panel-render.mjs` | 25 → **26 项**：新增「删除该面板：确认框（写明项目/不可逆）→ 带 projectId 调 `project.delete` → 回执含备份路径 → 清掉钉住状态」「点取消时不发任何请求」 |
| 工具面 | 22 → **23 个**（`bb_project_init` 之外新增 `bb_project_delete`） |
| `npm test` 全量 | **192 项** 全过；`verify` 88/88；`accept` 25/25 |
| 测试串扰（顺手修掉） | 「删除面板」用例原本共用 `sess-D`，与另一条并发用例各建了一个 sess-D 项目；`created_at` 只精确到秒 → `ORDER BY created_at DESC` 任意挑一个，删除计数对不上。改成独占会话 `sess-DEL`（测试串扰不是产品行为） |

## 二十一、右侧详情栏可拉伸 / 收起（不再固定 330px）

用户口径：「实时情况的右边（选中对象 / 待认领意图 / 人类提示）占了大半个屏幕，我希望可以拉伸这个框框」。

### 21.1 做法

- 画布与右栏之间加一条 **8px 分隔条**（`.dsh-vc-split`，`cursor:col-resize`）：**按住往左拖 → 右栏变宽**；
- 夹紧区间 `220px .. 面板宽度-320px`（左边至少留 320px 给画布）；量不到面板宽度时退化成 `220..900`；
- **松手才写 `localStorage`**（`vore.panel.asideWidth`）—— 拖动过程中每帧写盘既浪费又会让落盘值抖动；
- **双击分隔条**复位默认 330px；分隔条上的 **`⟩`/`⟨`** 箭头 = 收起 / 展开（收起 = 宽度 0 + `.is-collapsed`
  收掉内边距与左边框，只留一条窄条可点回来）；
- 「任务汇总」本来就是通栏（没有右栏），不受影响；「实时情况」与「覆盖矩阵」共用同一套分隔条 + 右栏。

### 21.2 断言

`panel-render.mjs` 26 → **27 项**。为了这条，给迷你 `document` 补了**真正可用的事件注册表**：
`addEventListener` 收进 Map，测试用 `fireDoc("mousemove"|"mouseup", …)` 派发 —— 拖动逻辑走的是 document 级监听，
不给实现就只能"看上去有分隔条"（假绿）。用例逐步断言：默认 330px → 往左拖 120px 变 **450px** → 往右拖被夹在 **≥220px**
→ **松手后** `localStorage` 里正是最终宽度 → 双击复位 330px → 箭头收起变 **0px** 且带 `is-collapsed` 类 → 再点展开回 330px。

### 21.3 实测

线上 bundle 与仓库文件 SHA256 一致（125699 字符，含 `dsh-vc-split` / `vore.panel.asideWidth`）→ **刷新页面即生效**，
本轮只改客户端，不需要重启宿主。`npm test` 全量 **193 项** 全过。



