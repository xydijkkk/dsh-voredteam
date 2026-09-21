# vore-console：作战面板

会话标签页「作战面板」，三个页签：**实时情况**（图）· **任务汇总**（成果）· **覆盖矩阵**（测得全不全）。
数据源：`vore-blackboard` 的同源 HTTP 通道 `/vore-blackboard`（CSRF 自动处理）。

## 顶部状态条（三个页签共用）

项目标题 / 状态徽标 / **「会话」选择器（按会话分类）** / goal 一行 / 计数（facts、intents open·claimed·dead、hints）/ 页签切换 /
**自动刷新**开关（3 秒轮询，页面隐藏时暂停）/ **立即刷新** / **删除该面板**（红框）/ **强刷页面** / **全屏**。

### 删除该面板

删的是**当前显示的那一块作战面板** —— 要么是本会话自己的，要么是从「会话」下拉里点开的历史项目：

1. 点 **「删除该面板」**（红色描边）→ 弹确认框，写清删哪个项目、会连带删掉多少东西（事实 / 意图 / 提示 / 资产 / 六张检查矩阵 / 未测面）与"不可逆"；
2. 确认后调 `POST /vore-blackboard/project.delete`：服务端**先落一份库备份**（`VACUUM INTO ~/.dsh/voredteam/blackboard.backup-<YYYYMMDDTHHMMSS>.db`），
   再在**一个事务**里删掉 `facts / intents / intent_sources / hints / assets / asset_checks / untested / scoped_counters / projects`；任一步失败整体回滚（数据不动）；
3. 成功后给出回执（各表删除条数 + 备份路径），若删的正是被钉住的历史项目，会自动清掉钉住状态并回到本会话；
4. 删本会话的面板后本会话就没有黑板了（面板回到空态），要接着测就让总控再 `bb_project_init`。

对应工具面：`bb_project_delete { project, confirm: true, reason? }`（`confirm` 是**必填**，缺了框架层直接拒；总控只在人类明确要求时用）。

**浏览器文件缓存**（旧的 `client.js`）JS 删不掉 —— 用 **「强刷页面」**（带时间戳重载，等价 Ctrl+F5）或手动 Ctrl+F5。
服务端没有额外的面板缓存：黑板 HTTP 全部带 `cache-control: no-store`，图/覆盖矩阵都由 SQLite 现算。

### 「会话」选择器 · 一个会话一个项目

- **本会话**永远是一个选项（`本会话：<项目名>`）；其余会话的项目按会话分组成 `<optgroup>`，
  选项里直接写 `阶段 · 资产 N · 事实 N`；
- 选中别的会话的项目 = **钉住**：出现黄色横幅「正在看历史项目：…」+ **「回到本会话」**按钮，
  钉的 id 记在 `localStorage`，刷新页面后仍停在那张图上；
- **本会话还没有黑板时**（新会话的常态）：面板**不显示任何别人的图**，而是显示空态 ——
  「本会话还没有黑板（一个会话一个项目）」+ 本会话短 id + **历史项目清单（按会话归类，点一条就打开）**
  + 「或直接给本会话建黑板」（origin / goal 输入框 + 按钮，调 `project.create` 绑到本会话）；
- 后端解析口径：`projectId`（人点开的历史项目）> 本会话 `sessionId` > **null**。
  **没有"猜一个最近项目"的档** —— 这正是"新会话继承了上一个会话的作战面板"的病根。

## 页签 1 · 实时情况（默认）

### 右侧详情栏可以拉伸 / 收起

「实时情况」与「覆盖矩阵」两个分栏右侧的详情栏（选中对象 / 待认领意图 / 人类提示 / 写提示框）不再是固定 330px：

- **拖动**画布与右栏之间的分隔条改宽度（**往左拖变宽**），夹在 `220px .. 面板宽度-320px` 之间（左边至少给画布留 320px）；
- **松手才落盘**：宽度记在 `localStorage` 的 `vore.panel.asideWidth`，刷新页面后保持；
- **双击**分隔条复位成默认 330px；
- 分隔条上的 **`⟩` / `⟨`** 箭头 = 收起 / 展开右栏（收起时宽度 0、图占满整屏，箭头仍在，一点就回来）；
- 右栏常出现长文（意图描述、人类提示原文），拉伸阅读比在小框里滚舒服 —— 这就是加它的原因。

- **八条泳道，从上到下**（`pure.mjs` 的 `LANES`）：
  **① 起点 → ② 信息收集 → ③ 浅层 → ④ 中间层 → ⑤ 深层 → ⑥ 线索 → ⑦ 死点 → ⑧ 成果**。
  - 序号用 ①②③…（**不用 P1–P6**，免得和作业法的六阶段号混淆；覆盖矩阵里那六行仍是 P1–P6）；
  - **起点**泳道放 `origin` 锚点，完成度由标题的「N/N · 收集轮次 k」说话；
  - **信息收集 / 浅层 / 中间层 / 深层**四条泳道放**资产节点**，按**六张矩阵**的完成度落位
    （浅层显示 `verifyInfo + shallow`、中间层显示 `verifyShallow + owasp`、深层显示 `deep x/8 · 命中 n`），
    同一资产的四条泳道之间用纵向连线串起来；信息收集没采全的资产不画后面三层；
  - **线索**泳道把事实分两组上下摆：**已确认事实** / **未确认（疑似结论 + 待探索方向）**，组名带条数；
  - **死点**泳道放死路意图与被推翻的事实（灰色虚框，留痕不消失）；
  - **成果**泳道放 `goal` + `category=vuln`/带 severity 的事实（按严重级排序）。
- **一条泳道一行最多 10 个节点，超了自动换行**（`PER_ROW_MAX`）：真实作业里资产上百个，
  一行排下去会把图拉成两万多像素宽的口袋阵，全屏后"适应窗口"也救不回来、屏幕上只剩极窄一条。
- **交互**：点击节点看详情；滚轮缩放；拖拽平移；右上角**「适应窗口」/＋/－**（固定在画布外层，
  **滚图不会把工具条带走**），旁边显示当前缩放百分比。
- **全屏**：状态条右侧 **「全屏」** —— Fullscreen API 优先，被浏览器拒绝时自动降级为 CSS 兜底全屏
  （`.dsh-vc-root.is-fs`）。进全屏后会**按新容器补算缩放**（rAF + 定时 + resize），
  Esc 或「退出全屏」复原。缩放下限 **0.05**，两万像素宽的图也真能压到装下。
- **字体与配色自己说了算**：SVG 文本的 `fill` **写死**（SVG 文本默认 fill 是黑色，深色底上等于隐身）；
  浅色/深色各一套 `--vore-ink / --vore-canvas-bg`，画布自带**不透明底色** + 网格；
  深色既能由宿主 `body[data-ds-dark-theme]` 触发，也能由面板自己探测（`.dsh-vc-root.is-dark`）；
  字体栈带中文（Microsoft YaHei / PingFang SC / Noto Sans CJK SC）。
- **右侧详情栏**：选中对象完整字段（描述 / 证据 / 目标 / POC / 修复建议 / 备注 + 六张矩阵逐项状态）；
  未选中时显示**待认领意图**、**人类提示**与「写一条提示」输入框（Enter 提交 → 面板写 hint，总控下一轮读图时吸收）；
  待探索/死路节点可一键「取消该方向（记死路）」；从覆盖矩阵点进来的资产显示「来源：覆盖矩阵」。
- **回灌提示条**：项目 `reflow_pending=1` 时顶部显示「回灌：新增 N 个资产（来源 X）→ 已退回 P1 起点，需再收一轮」。

## 页签 2 · 任务汇总

- 成果计数徽章（critical / high / medium / low）+「复制 Markdown」（导出成果表 + 死路清单，可直接贴进报告）。
- **成果表**：`category=vuln` 或带 `severity` 的事实；列 = ID / 严重级 / 标题 / 目标 / 状态 / 证据；点击行展开完整描述、POC、修复建议、证据路径。
- **资产与接口**折叠区：`category` 为 `asset` / `endpoint` / `cred` / `note` 的事实。
- **死路与未排除面**：`dead` 意图 + 备注（"试过什么、为什么不通"）。

## 页签 3 · 覆盖矩阵

- 六张矩阵（信息收集 / 核验信息收集 / 浅层测试 / 核验浅层 / OWASP 逐类测试 / 深层漏洞验证）逐资产完成度 + 缺口清单；
- **六阶段完成度**（仍按 P1–P6；「线索」「死点」不是阶段，只在图上成条，不进这张表）、阶段门状态（`blockers`）、
  **未测面**清单、**复核进度**（已复核漏洞事实 / 总数）；
- 点资产行 → 跳到实时情况并选中该资产详情。

## 数据契约

`POST /vore-blackboard/{list|graph|status|hint.add|intent.drop}` 与 `GET /vore-blackboard/{coverage|checks|csrf}`（同源 + `x-dsh-csrf`）。
项目解析顺序：`projectId` > `sessionId` > 最新**非空**项目 > 最新项目；空项目时面板提示「让总控先调 `bb_project_init`」。

## 构建与自检

面板是构建产物：`lib/panel.js` + `lib/pure.mjs` → `lib/client.js`（classic bundle，`window.__ModuleLoader__.load({id, factory})` + `ctx.slots.inject("conversation.view", …)`）。

```bash
node scripts/build-client.mjs           # 重新生成 lib/client.js（改完 panel.js/pure.mjs 必须跑）
node scripts/build-client.mjs --check   # 只校验构建物与源一致（CI 用）
node --no-warnings tests/console.test.mjs     # 27 项：八泳道/线索分组/适应窗口/配色/Markdown/HTTP/槽位注册/六矩阵视图模型
node --no-warnings tests/panel-render.mjs     # 21 项：mini-React 真渲染（含 hook 数量守恒、全屏切换、工具条固定、可读性、毒化载荷不白屏）
```

> 客户端 bundle 由宿主按请求从磁盘读（`/plugins/@dsh-external/vore-console/client.js`），改完**刷新页面（Ctrl+F5）**即生效，无需重启宿主；宿主侧改动（工具面、HTTP 路由）才需要重启。
>
> ⚠️ **别用 PowerShell 的 `Get-Content | Set-Content` 改这个仓库里的源文件**：这条管道在本机按 ANSI 码页解码 UTF-8，会把中文变成不可逆的乱码（真实事故见 `docs/VERIFICATION.md` 第十七章，那次是靠 `lib/client.js` 里的备份逐字还原的）。请用编辑器/文件工具改。
