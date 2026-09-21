# dsh-voredteam 体系结构（ARCHITECTURE）

## 一、范式：把渗透测试还原为状态空间搜索

起点已知（`origin`：授权目标与范围），终点已定义（`goal`：要交付的成果），**路径未知**。
系统不靠"按流程走一遍"取胜，而靠**在黑板上生长一张图**：每个已验证的事实是垫脚石，每个意图是迈向未知的一步。

黑板只有三类对象：

| 对象 | 含义 | 谁写 |
|---|---|---|
| **Fact** | 已确认的客观结论（什么 + 在哪 + 如何验证 + 证据路径） | 子 agent 执行中 / 总控收口时 |
| **Intent** | 尚未执行的探索方向（独立、可并行、高价值、不重叠） | 只由总控提 |
| **Hint** | 人类注入的判断（范围、凭据、禁测项） | 用户（面板或对话） |

## 二、三处关键设计取舍

| 维度 | 常见做法 | dsh-voredteam 的做法 |
|---|---|---|
| Worker | 无角色，同一 Worker 跑 bootstrap/reason/explore | **总控做 reason，12 个专业子 agent 做 explore** |
| 任务来源 | 运行时由图状态生成 | 同（图状态生成）**+ 按领域路由到专家** |
| 人类介入 | hint（无 UI） | hint **+ 作战面板「实时情况」可直接写** |
| 工具面 | 容器内 CLI | CLI + **本机 MCP 联邦**（抓包/Burp/PentAGI/C2/FOFA…）+ 技能库 |
| 门禁 | 无 | **一条**：禁 DDoS / 禁爆破 / 模糊测试低频 |
| 交付 | 图 + description 引文件 | **任务汇总面板 + 七项规范的报告 + 证据落盘** |

## 二之二、作业阶段机、检查矩阵与覆盖账本（vore-blackboard）

阶段机与检查矩阵是**方法论落到数据层**的部分：作业「测得全不全」由数据判定，不由模型自述判定。

六阶段（**每一层先核实上一层的产出，再做本层的工作**）：**P1 起点**（资产收集直到饱和）→ **P2 信息收集**（逐资产信息全采）→ **P3 浅层**（核实信息收集 + 浅层测试）→ **P4 中间层**（核实浅层 + OWASP Top 10）→ **P5 深层**（读全量 + 核验中间层 + 逐资产漏洞验证）→ **P6 成果**（报告 + 未测面 + 复核）。

| 数据 | 位置 | 说明 |
|---|---|---|
| `projects.phase` | SQLite | `P1` 起点 / `P2` 信息收集 / `P3` 浅层 / `P4` 中间层 / `P5` 深层 / `P6` 成果（`phase_scheme` 一次性升级：旧 P2→P3、P3→P4、P4→P5、P5→P6） |
| `assets` 表 | SQLite | 覆盖账本的一行：`kind`、`value`（唯一）、`tech`、`priority`、`s2`/`s3`（由检查矩阵自动同步的**汇总位**，不再人工写） |
| **`asset_checks` 表** | SQLite | **真正的事实来源**：`(asset_id, stage, key) → status/evidence/note/reviewed`；六个 stage 见下表 |
| `untested` 表 | SQLite | 未测面账本（`surface` + `why`）：死路记"试过没成"，这里记"压根没做/做不了" |
| `facts.review_status` | SQLite | 事实复核（`confirm`/`challenge`）+ 复核证据；P6 要求每条漏洞事实都有复核 |
| `projects.asset_epoch` / `recon_mark` / `recon_last_added` | SQLite | 资产纪元与轮次标记；上一轮 0 新增 + 来源齐 = P1 饱和 |

**六张矩阵**（`requiredKeys(kind, stage)`）：

| stage | 属于 | key 集合 | 状态取值 |
|---|---|---|---|
| `info` | P2 信息收集 | BASE 12：`tech lang middleware os arch dirs paths cert dns waf third sec` + 按 kind 追加（`js`→`jsrev,params`；`url/endpoint`→`params`；`ip/port/service`→`banner`；`app`→`client`；`repo`→`repo`；`cred`→`cred`；`cloud`→`cloud`；`domain/subdomain`→`sub`） | `done`/`na`/`doing` |
| `verifyInfo` | P3 浅层·**核实信息收集** | 同 `info` | `ok`/`wrong`/`unknown`/`na` |
| `shallow` | P3 浅层·**浅层测试** | 8 项：`fp pathTruth params authEdge errLeak expose lowFuzz compHint` | `done`/`hit`/`na` |
| `verifyShallow` | P4 中间层·**核实浅层** | 同 `shallow` | `ok`/`wrong`/`unknown`/`na` |
| `owasp` | P4 中间层 | `A01`–`A10`（OWASP Top 10 2021） | `done`/`hit`/`na` |
| `deep` | P5 深层 | 8 类：`unauth authz inj ssrf upload logic race deser` | `done`/`hit`/`na` |

**范围**：`info`/`verifyInfo` 要求**所有**资产；`shallow`/`verifyShallow`/`owasp`/`deep` 只要求 `priority ≥ 3` 的资产 —— 把资产登记成 `priority < 3` **必须在登记时写明理由**（机器强制），属"可审计的降级"。
`na`/`wrong`/`unknown` 必须写理由（<4 字也拒）；`hit` 必须给证据。

**出关条件（`coverage()` / `advancePhase()` 实现）**：

| 推进 | 条件 |
|---|---|
| P1 → P2 | 资产非空 且 七类来源都有结果或已显式标记穷尽 且 上一轮收集 0 新增 |
| P2 → P3 | 每个资产的 **info** 必查项全部有结论（`done`/`na`，na 带理由） |
| P3 → P4 | **verifyInfo** 全项有结论 **且** `priority ≥ 3` 资产的 **shallow** 8 项有结论 |
| P4 → P5 | **verifyShallow** 全项有结论 **且** `priority ≥ 3` 资产的 `A01`–`A10` 有结论 |
| P5 → P6 | `priority ≥ 3` 资产的 **deep** 8 类有结论；`verifyInfo`/`verifyShallow` 的 `wrong` 已独立复算（`reviewed`）；**中间层的 OWASP 结论已被深层核验**（`reviewed`）；`na` 都有理由；**未测面已显式声明**；**每条漏洞事实都已复核** |

推进只能经 `bb_phase_advance`；不满足即拒绝并列缺口。人类明确要求跳阶段时 `force=true` 必须给 `reason`（记入 `projects.phase_note`）。
**回灌**在数据上是自然结果：新增资产 → 六张矩阵缺口同时重现 → 阶段**退回 P1 起点**并置 `reflow_pending`（`upsertAssets` 自动改写 `phase`）→ 必须**再收一轮确认 0 新增**（`bb_coverage {endRound:true}` 清掉 pending），然后给这批新资产走完 P2→P5。
回灌来源会被记在 `reflow_source`（如 `js-reverse` / dir-fuzz / config / cert），`bb_coverage` 与面板覆盖矩阵都会显眼提示「回灌未收轮」。

## 三、体系结构

```
┌──────────────────────────── DSH Web (:3080) ────────────────────────────┐
│  会话：网络安全模式（preset: network-security）                          │
│                                                                          │
│   总控（agents/orchestrator.md · persona）                               │
│     reason 循环：bb_graph → 判目标 → bb_intent_propose(≤3) → 派单         │
│        │                                                                 │
│        │ subagent / workflow（派单四要素 + intent_id）                    │
│        ▼                                                                 │
│   recon · js-reverse · api-security · web-injection · auth-logic ·       │
│   component-cve · app-reverse · internal-network · cloud-ai ·            │
│   exploit-dev · reviewer · reporter            （agents/*.md）           │
│        │                                                                 │
│        │ bb_intent_claim → 干活 → bb_fact_add / bb_intent_conclude        │
│        ▼                                                                 │
│   黑板（plugins/vore-blackboard）                                        │
│     SQLite: projects / facts / intents / intent_sources / hints           │
│     + bb_* 工具面 + 逐轮图快照注入 + HTTP 通道                            │
│        │                                                                 │
│        ├──► 作战面板（vore-console）  实时情况（八泳道 SVG 图，可全屏） / 任务汇总（成果） / 覆盖矩阵 │
│        └──► 设置（vore-settings）     测绘 API / 技能 / MCP               │
│   后渗透面：不经面板，直接用内置 MCP（AdaptixC2 89 工具 / FOFA 资产 / 抓包逆向）│
│                                                                          │
│   唯一门禁（vore-guard）：命令执行前确定性拦截 + vore-guard-log.md        │
└──────────────────────────────────────────────────────────────────────────┘
      工具面：bash/pwsh · fs · skill · web · subagent/workflow · todo/goal
      MCP  ：mcp/registry.yaml（19 条，按需启用）  技能：skills/registry.yaml（500 条）
```

## 四、一次作业的完整时序

1. **开工**：用户给出目标 → 总控 `bb_project_init`（origin/goal）→ 用户硬约束写成 hint。
2. **第一轮 reason**：`bb_graph`（空图）→ 提 2-3 条意图（如 `i001 资产测绘`、`i002 前端 JS 与接口面`）。
3. **派单**：把 `i001` 派给 `recon`（prompt 含四要素 + intent_id + 已知事实要点）。
4. **explore**：`recon` 先 `bb_graph` 看有没有人在做同一件事 → `bb_intent_claim(i001)` → 执行 →
   每确认一条事实立刻 `bb_fact_add`（长数据落文件、写指针）→ `bb_intent_conclude(i001, fact_description=…)`。
5. **回图**：总控 `bb_graph` 看到新事实 → 决定下一批意图（依据新事实，而非凭想象）。
6. **并行海**：无依赖的方向一次并行派多个子 agent（`workflow` 扇出）；有依赖的串行。
7. **验证与复核**：任何将进报告的高危结论 → `reviewer` 独立复核（只给原始材料、二选一确认/挑战）→
   复核通过的事实才允许进报告；被挑战的用 `bb_fact_deprecate` 标废（图留痕）。
8. **收口**：每条意图都有终态（已结论/死路）→ `reporter` 按七项规范出报告 → 成果同步为 `category=vuln` 的事实（面板「任务汇总」可见）。

## 五、数据模型

```sql
projects(id, session_id, cwd, title, origin, goal, status, created_at, updated_at)
facts(id, project_id, description, category, evidence, confidence, source_intent,
      deprecated, created_at, severity, target, poc, fix, status)
intents(id, project_id, description, domain, priority, status, worker, claimed_at,
        to_fact, dead, note, creator, created_at, concluded_at)
intent_sources(intent_id, project_id, fact_id)          -- 边的起点集合（多 from 即超边）
hints(id, project_id, content, creator, created_at)
```

- **一条 intent 就是一条边**：起点 = `intent_sources` 里的若干 fact，终点 = `to_fact`（或 `dead`）。
- **图 append-only**：fact 只能由 `bb_fact_add` / `bb_intent_conclude` 新建 → 结构上不成环，无需环检测。
- **意图状态是算出来的**：`concluded_at` 为空=未结论；`worker` 非空=被认领（`status=claimed`）；`dead=1`=死路。
- **会话绑定**：project 按 `session_id` 解析，子 agent 用 `cwd` 回退命中同一张图（子 agent 与总控共享工作目录）。
- 落库位置：`~/.dsh/voredteam/blackboard.db`（可用插件 config `dbPath` 覆盖）。

## 六、唯一门禁的位置与实现

- **位置**：`plugins/vore-guard`，注册在 `ctx.tools.guard()`（命令执行前的确定性拦截缝），只对 `network-security` 会话及其子 agent 生效。
- **三条规则**：① DDoS 特征（洪水/压测/高并发）；② 在线爆破与凭据填充（`hydra`/`kerbrute`/`netexec`/`nxc`/`--password-file` 等；离线 `hashcat`/`john` 放行；`impacket-*`/`bloodhound-python`/`smbclient -U`/`curl -u` 这类凭据**复用**不拦，工具名必须在命令词位置才算命中）；③ 模糊测试必须带显式低频参数且不超阈值（ffuf ≤50、dirsearch/gobuster/wfuzz ≤10、nuclei ≤50；nmap 全端口/大范围必须有 `--max-rate` 且 ≤ defaultRps×60（夹紧 100..1000）——`-T4` 与 `--min-rate` **不算**限速）。
- **口径两侧都要测**：误拦会挡掉合法测试面，漏放会让纪律失效。回归断言与量化数据见 `docs/COVERAGE-GAPS.md` §3 与 `tests/smoke.mjs`「门禁边界」四组。
- **拒绝文案自带降级路径**（先小样本 ≤50 → 显式限速 → 去重 → 命中即停），判定落 `<workspace>/vore-guard-log.md`。
- **为什么只有一条**：其余门禁（阶段门、覆盖矩阵、证据三件套强制流程）在真实作业里主要产生流程税；严谨性改由「事实纪律（persona）+ 独立复核员 + 证据落盘」保证。

## 七、扩展点

| 想加什么 | 改哪里 |
|---|---|
| 新的专业子 agent | `agents/<id>.md`（照现有骨架：授权与边界 / 输入前置条件 / 纪律 / 工作方法 / 黑板协议 / 输出格式 / 边做边记录）+ 在 `orchestrator.md` 花名册表加一行 |
| 新的黑板工具 | `plugins/vore-blackboard/lib/index.js`（`defineTool` 注册）+ `lib/store.js`（SQL 层） |
| 新面板 | 照 `plugins/vore-console`：**必须** `ctx.slots.inject('conversation.view', () => ctx.slots.register({name,id,order,label}, Comp))`—— 槽位声明由 owner 包（`dsh-client-ui-conversation`）提交，裸 `register` 会被宿主 core 判为「未声明目标」并抛错；同时在 `package.json` 的 `dsh.client.inject` 里加上 owner 包（图依赖边） |
| 新 MCP | `mcp/registry.yaml` 加一条（id/name/transport/url 或 command/args/env/require_running），在 `vore-settings` 面板勾选启用 |
| 新技能 | 建 `skills/<kebab-name>/SKILL.md`（frontmatter 必带 kebab-case 的 `name` + `description`）→ **即时生效**，模型可 `skill` 装载；外部技能库按 `deploy/sync-skill-roots.mjs` 的 `SOURCES` 加一条 → `--apply` 建联接农场 → 把农场目录加进 `agent.cordis.yml` 的 `customSkillDirs`（需重装预设/重启）。**注意**：在 `vore-settings` 面板加的技能根**只对 `vore_skill_search`/扫描生效**，装载面看不到 —— 详见 `docs/SKILL-INVENTORY.md` |
| 技能盘点/农场 | `npm run skills`（逐根装载面 + 目录体积）、`npm run skills:sync` / `skills:sync:apply`（联接农场差异/重建） |
| 改速率阈值 | `plugins/vore-guard/lib/index.js` 的 `FUZZ_RULES`（并同步 `skills/vore-rate-discipline/SKILL.md`） |
