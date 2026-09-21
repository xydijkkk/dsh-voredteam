---
name: vore-blackboard-ops
description: voredteam 网络安全模式的黑板操作规程：Fact/Intent/Hint 三类对象的写法、派单四要素、意图认领与结论、死路登记、人类提示吸收、六阶段检查矩阵（info/verifyInfo/shallow/verifyShallow/owasp/deep）、三层核实关系、未测面登记与事实复核、与成果面板的对应关系。总控与所有子 agent 开工前都应加载。
---

# 黑板操作规程（vore-blackboard-ops）

> 范式：把作业还原为**状态空间搜索**——`origin`（起点）已知、`goal`（终点）已定义、**路径未知**。
> 图上每一个 Fact 是垫脚石，每一个 Intent 是迈向未知的一步。你不需要"走完流程"，你需要**把图长到 goal**。
> 图之外还有一本**检查矩阵**（Asset × stage × key）：它不回答"这站安不安全"，只回答"你到底测过什么"。

## 一、三类对象怎么写

### Fact（事实）——只写已确认的客观结论
格式：`什么 + 在哪 + 如何验证 + 证据路径`

```
✅ f012 https://app.example.com/api/v2/order/{id} 对 id 参数无属主校验：用 A 账号
   token 请求 B 账号订单 id=10086 返回 200 且含 B 的收货手机号；
   证据 evidence/req-order-10086.txt（请求+响应原文）；复现命令同目录 run.sh
❌ f012 测试了订单接口的越权问题          ← 无对象、无证据、无法复现
❌ f013 可能存在 SQL 注入（未验证）        ← 这是候选，不是事实（要写 confidence=suspected）
```

- 长数据（响应体、扫描结果、JS bundle）落文件，事实里**只写指针**。
- 未验证的候选写 `bb_fact_add` 时带 `confidence=suspected`；被推翻的用 `bb_fact_deprecate`（不删、留痕）。
- 事实写多了不是成绩——**一条可复现的事实胜过十条"我看了"**。
- `category=vuln` 的事实**必须**有一条复核记录（`bb_fact_review`），否则不得进入报告。

### Intent（意图）——只写"朝哪打 + 为什么值"
格式：`方向 + 依据（from）+ 期望产出`

```
✅ i007 从 /static/js/*.chunk.js 提取全部接口清单与签名算法，找未在页面暴露的接口
      （依据 f003：JS 里出现 /api/v2/admin/ 前缀但页面无入口）
❌ i007 测试所有接口                     ← 不可判定、不可结论
```

- 一条意图必须**能独立执行**、**能判定成败**、**与其他意图不重叠**。
- 新方向不要自己展开：`bb_intent_propose` 交给总控（子 agent 只提，不自己追加）。

### Hint（提示）——人类判断，开工先读
- 每轮开工 `bb_hint_list`：用户可能补了范围、凭据、禁测项、时间窗口。
- 用户的硬约束（禁测资产、只测某子域）出现在 hint 里时，**优先于你自己的判断**。

## 二、四步闭环（谁做什么）

| 步骤 | 角色 | 工具 |
|---|---|---|
| Observe 读全图 | 双方 | `bb_graph` + `bb_hint_list` + **`bb_coverage`**（六阶段 + 六张 `stages` 缺口 + `untested` + `reviews`） |
| Reason 判阶段/提方向 | **总控** | 缺口即派单来源 → `bb_intent_propose`（≤3 条） |
| Explore 认领并执行 | **子 agent** | `bb_intent_claim` → 干活 → `bb_asset_check` 落状态 → `bb_intent_conclude` |
| 出关推进 | 总控 | `bb_phase_advance`（门禁不满足会被拒绝并列缺口） |
| 收口 | 总控 | `bb_untested_add` 逐条声明 + `bb_coverage {declareUntested:true}` + `bb_assets {onlyGaps:true}` + `reporter` |

**认领互斥**：同一意图同时只能被一个 worker 认领；被占用时换一条，别抢。

## 二之二、覆盖账本（Asset）——「没登记 = 没测」

阶段机与覆盖率是这套作业法的**判分口径**，详见技能 `vore-testing-methodology`：

| 工具 | 用途 |
|---|---|
| `bb_asset_add` | 批量登记资产（`kind`/`value`/`tech`/`priority`/`notes`）。**任何新发现（子域、接口、JS、密钥、云桶）都必须立刻登记** —— 这就是"回灌"。`priority < 3` 必须在 `notes` 写明理由（可审计的降级） |
| `bb_assets` | 按类别/优先级查清单；`{onlyGaps:true}` 是收尾自查 |
| `bb_asset_update` | 只写指纹 `tech`、调 `priority`、写 `notes`；**资产阶段状态不再用它**（那是 `bb_asset_check` 的事） |
| `bb_asset_check` | 登记一条检查结果：`{asset:{id}\|{kind,value}, stage:"info"\|"verifyInfo"\|"shallow"\|"verifyShallow"\|"owasp"\|"deep", key, status, evidence?, note?, reviewed?}` |
| `bb_asset_checks` | 查检查矩阵：`{asset?, stage?, onlyGaps?}` —— 开工看自己这单要填哪些 key，收尾自查还有哪些空 |
| `bb_untested_add` | 登记**未测面**：`{surface, why, stage?}`（`stage` 可写 P1–P6；做不了/没做的面，必须显式声明） |
| `bb_fact_review` | 复核一条事实：`{fact_id, verdict:"confirm"\|"challenge", evidence, note?}`（`evidence` 必填） |
| `bb_coverage` | 覆盖率 + 阶段门 + 收轮（`{endRound:true}`）+ 标来源穷尽（`{sourceExhausted:[...]}`）+ 声明未测面登记完（`{declareUntested:true}`） |
| `bb_phase_advance` | 推进 **P1→P2→P3→P4→P5→P6**；**门禁不满足即拒绝**，禁止自我宣布推进 |

**六个阶段（每一层先核实上一层，再做本层的工作）**：
**P1 起点**（资产收集，连续一轮 0 新增才算饱和，7 类来源齐或显式穷尽）
→ **P2 信息收集**（逐个资产把必查信息项采全：BASE 12 项 + 按 kind 追加项）
→ **P3 浅层**（①核实信息收集的产出 `verifyInfo`：`ok`/`wrong`/`unknown`；②浅层测试 `shallow` 8 项：`fp`/`pathTruth`/`params`/`authEdge`/`errLeak`/`expose`/`lowFuzz`/`compHint`）
→ **P4 中间层**（①核实浅层的工作 `verifyShallow`（同 8 个 key）；②每个资产过 OWASP Top 10 (2021) `A01`–`A10`）
→ **P5 深层**（读全量已有证据 → 核验中间层（`wrong` 项独立复算并 `reviewed`）→ 8 个必测类别：`unauth`/`authz`/`inj`/`ssrf`/`upload`/`logic`/`race`/`deser`）
→ **P6 成果**（证据索引 + 报告 + 未测面显式声明 + 每条 vuln 有复核）。

**三层核实关系（这是六阶段的核心机制，别跳）**：

| 谁核实谁 | 矩阵 | 判据 |
|---|---|---|
| P3 核实 P2 的信息收集 | `verifyInfo`（核 `info` 的同一套 key） | 行为验证通过 → `ok`；只凭响应头/软 404/历史记录 → `wrong`；无法核验 → `unknown`（写原因） |
| P4 核实 P3 的浅层 | `verifyShallow`（核 `shallow` 的同一套 8 个 key） | 证据链完整、口径正确、面集合无漏 → `ok`；否则 `wrong`；无法核实 → `unknown` |
| P5 核实 P4 中间层 | `reviewed:true` + `bb_fact_review` | `owasp` 每一行与所有 `wrong` 项必须被独立复算；`category=vuln` 的事实必须有复核记录 |

**状态取值**：`info`: `done|na|doing`；`verifyInfo`/`verifyShallow`: `ok|wrong|unknown|na`；`shallow`/`owasp`/`deep`: `done|hit|na`（`hit` 必须给 `evidence`；`na`/`wrong`/`unknown` 必须写 `note` 理由）。

**矩阵范围**：`info` 与 `verifyInfo` 要求**所有资产**；`shallow`/`verifyShallow`/`owasp`/`deep` 只要求 **`priority ≥ 3`** 的资产 —— 登记成 `priority < 3` 时必须在 `notes` 写明理由（机器强制），这是可审计的降级，不是偷偷免测。

**回灌**：任何阶段新增资产 → 该资产**六张矩阵的缺口同时出现**（`info`/`verifyInfo`/`shallow`/`verifyShallow`/`owasp`/`deep` 全是 `pending`）→ **阶段自动退回 P1 起点（信息收集）** → 必须从 `info` 重新走一遍 → 才允许继续推进。**新资产 = 回到 P1 起点（再收一轮 → P2→P5）**。

## 二之三、`bb_coverage` 的三个读数怎么读

| 字段 | 含义 | 怎么用 |
|---|---|---|
| `stages.{info,verifyInfo,shallow,verifyShallow,owasp,deep}.{required,done,pct,gaps,gapCount}` | 六张矩阵各自的必查项数、已 done 数、完成率、缺口清单 | `gaps` 就是下一轮的派单清单；`pct` 达标不等于 `done` 达标——**`done`/`hit` 与 `na` 要分开看**；后四张只统计 `priority ≥ 3` |
| `untested.{declared,count,items}` | 未测面是否已声明、已登记的未测面条目 | `declared=false` 时 P6 不放行；`items` 要逐条写清"哪个面 + 为什么没测 + 卡在哪个阶段" |
| `reviews.{vuln,reviewed,pending,challenged}` | `category=vuln` 事实总数 / 已复核 / 待复核 / 被挑战 | `pending>0` 说明有漏洞结论没人独立复核，**不许进报告**；`challenged>0` 要看到对应的废弃或改写记录 |
| `blockers.{P1..P5}` | 每个阶段各自的阻塞文本 | 门禁被拒时先读它，那就是下一轮要派的单 |
| `canAdvanceTo.{P2..P6}` | 能否推进到某阶段（布尔） | 唯一权威；模型不得自行宣布阶段推进 |

**`na` 不是漂白剂**：`done+hit+na=required` 允许出关，但对外声明必须写 `done=x, hit=y, na=z`；"不适用"与"没做"是两件事——没做的要 `bb_untested_add`，不是 `na`。无理由的 `na` 会被门禁直接点出来。

## 三、结论的两条路（都不许悬空）

- **有收获**：`bb_intent_conclude(intent_id, fact_description="…", evidence="…")` —— 产出的事实自动接到该意图的边上。
- **死路**：`bb_intent_conclude(intent_id, dead=true, note="试过 A/B/C，均 403；原因推测：WAF 规则")` —— **死路也是资产**：写清试过什么，后人就不会重跑。

任何方向都不许"测了没结果就不管了"——悬空的意图会让总控误判进度。

## 四、派单四要素（总控硬约束，缺一不得派出）

```
目标标识：完整 URL / IP:Port / 域名+路径（精确到要打的那个对象）
授权边界：本单允许触碰的范围，出界即停
唯一子目标：一句话（"枚举 X 的接口" 而不是 "看看这个站"）
成功标准：产物形态 + 判定依据（如"落地 artifacts/api.txt 并写一条事实"）
+ 意图 id：让子 agent 认领
+ 已知事实要点：子 agent 看不到你的对话，必须把上下文写进 prompt
+ 本单要覆盖的资产清单：资产 id + stage + key（从 bb_assets / bb_asset_checks 取）
```

**子 agent 侧退单协议**：四要素缺任一 → **立刻停止**，只回「缺失字段清单」，不得猜测、不得用历史目标替代。

## 五、与作战面板的对应

| 面板视图 | 数据来源 |
|---|---|
| 实时情况（图） | `facts`（节点）+ `intents`（边；未结论的是虚线"待探索"节点） |
| 实时情况（右侧） | 待认领意图、人类提示（可直接在面板写 hint） |
| 任务汇总（成果） | `category=vuln` / 带 `severity` 的事实 + 资产/接口事实 + 死路清单 + 未测面清单 |

面板看到的颜色：青蓝=已确认事实，琥珀虚线=疑似（suspected），灰=废弃（deprecated），红/橙/黄/蓝=critical/high/medium/low 漏洞。

## 六、常见错误（都发生过）

1. 把扫描器输出当事实写进图 → 复核员推翻后整张图失去可信度。**扫描命中只能当候选**。
2. 一条意图里塞三件事 → 无法结论、无法判定成败。拆开。
3. 子 agent 自作主张扩大范围 → 出界即违规。发现新面只提意图，由总控决定。
4. 死路不登记 → 下一个人重跑同样的死路，烧时间烧请求（还可能触发风控）。
5. 忘了读 hint → 违反用户明示的禁测项。
6. 用"我做了"代替 `bb_asset_check` → 检查矩阵里是空的，阶段门照旧不放行，等于没做。
7. 把未测面写成 `na` → 缺口被漂白，"不适用"与"没做"混为一谈；正确做法是 `pending` + `bb_untested_add`。
8. `category=vuln` 的事实没有复核记录 → 报告里出现未经独立复核的漏洞结论，可信度归零。
9. **用 `bb_asset_update` 去落阶段状态** → 状态不会进六张矩阵，门禁照旧不放行。状态只有 `bb_asset_check` 一个入口，`bb_asset_update` 只写 `tech`/`priority`/`notes`。
10. **把 `verifyInfo` 与 `verifyShallow` 合成一步做** → 两层核实各自都有门禁，合并等于有一层没核实；而且它们核的是**两个不同对象的产出**（前者核 P2 的信息，后者核 P3 的浅层结论）。
11. **`shallow` 的 `hit` 直接当漏洞定级** → 浅层只登记命中点与线索（`compHint` 甚至不许 `hit`），定级与最小可复现证据属于 P5。
12. **发现新资产只在回报文字里提，不 `bb_asset_add`** → 六张矩阵的分母不变，覆盖率虚高，那条资产永远不会被信息全采。
13. **`priority < 3` 不写理由** → 登记会被直接拒绝；即使登记成功，无理由的降级在复核时也会被挑战。
14. **拿一个 `pct` 汇报完成度** → `na` 会把空白盖过去；汇报必须同时给 `done`/`hit`/`na` 三个数。
15. **门禁被拒就 `force`** → `force` 只保留给人类明确要求跳阶段的场景；被拒应该去读 `blockers` 补缺口。
