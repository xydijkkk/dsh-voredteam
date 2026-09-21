---
name: vore-testing-methodology
description: dsh-voredteam 网络安全模式的六阶段作业法：P1 起点（资产收集到连续一轮 0 新增）→ P2 信息收集（对每个资产把信息画像采全：JS 逆向/语言/代码与构建/中间件/OS/架构/目录/路径参数/证书/DNS/WAF/第三方/安全头 + 按 kind 追加项）→ P3 浅层（先核实信息收集的产出 verifyInfo，再做 8 项浅层测试 shallow）→ P4 中间层（先核实浅层的产出 verifyShallow，再过 OWASP Top 10 A01–A10）→ P5 深层（读全量信息、核验中间层、8 个必测类别逐资产验证）→ P6 成果（证据索引 + 报告 + 未测面显式声明 + 每条 vuln 有复核）。含四份清单、六张检查矩阵、回灌规则、覆盖率读法与反模式表。总控与所有子 agent 开工前必读。
---

# 六阶段作业法（vore-testing-methodology）

> 一句话：**先把面铺满（P1）→ 把每个面的信息画像采全（P2）→ 核实这些信息是真的，再做浅层测试（P3）→ 核实浅层怎么测的，再过一遍 OWASP（P4）→ 才挑值钱的深打（P5）→ 收成证据与报告（P6）。**
>
> 判"测得全不全"不看模型自述，看**六张检查矩阵**：没登记进资产清单的东西等于没测；登记了却没有 `info`/`verifyInfo`/`shallow`/`verifyShallow`/`owasp`/`deep` 状态的项，同样等于没测。

## 〇、三条不可动摇的纪律（贯穿六个阶段）

1. **每一层先核实上一层，再做本层的工作。** P3 的第一件事是核实 P2 采到的信息是不是真的、全不全（`verifyInfo`）；P4 的第一件事是核实 P3 的浅层测试有没有证据、有没有漏面（`verifyShallow`）；P5 的第一件事是读完该资产的全部已有信息、核验中间层（`owasp`/`verifyShallow`）的结论是否有误。**跳过核实直接做本层工作，本层的结论就没有地基。**
2. **信息收集与浅层测试是两个阶段，不许压缩成一个。** P2 只回答"这个资产是什么"；P3 才回答"这个资产怎么打、能不能打"。先把指纹跑一遍就开打的，会在 P3 发现参数面、鉴权边界、暴露面全是空白，只能回头重跑。
3. **上一层的结论未经复算不得沿用。** 任何 `wrong`/`unknown`/`hit` 的结论都要能被独立复算（自己重放、自己看响应、自己写判定），并在检查行里带 `reviewed:true` 或配套的 `bb_fact_review` 记录。

## 一、六个阶段与出关条件

| 阶段 | 名称 | 做什么 | 出关条件（机器判定） |
|---|---|---|---|
| **P1** | **起点** | **资产收集**：把授权范围内的面铺满 —— 域名/子域/IP:端口/服务/URL/接口/JS/仓库/凭据/云/客户端产物 | ① 资产清单非空；② 7 类来源（`domain subdomain ip port url endpoint js`）都有结果或被 `bb_coverage {sourceExhausted:[...]}` 显式标记穷尽；③ **连续一轮 0 新增**（`bb_coverage {endRound:true}` 收轮） |
| **P2** | **信息收集** | 对**每一个资产**把信息**采全**（不是"扫一眼"，是穷尽该资产的信息画像）：JS 逆向（接口/密钥/签名/路由/加密）、后端语言与框架、代码与构建特征、中间件与网关、操作系统、站点架构（前后分离/CDN 回源/多活）、网站目录、路径与参数、TLS 证书与 SAN、DNS（解析/CNAME/历史/接管线索）、WAF/CDN、第三方依赖与 SDK、安全头与 Cookie；按 `kind` 追加（`js`→`jsrev`+`params`；`url`/`endpoint`→`params`；`ip`/`port`/`service`→`banner`；`app`→`client`；`repo`→`repo`；`cred`→`cred`；`cloud`→`cloud`；`domain`/`subdomain`→`sub`） | **所有资产**的 `info` 必查项**全部**有结论（`done`/`na`，`na` 必须写理由），任一项 `pending`/`doing` 即阻塞 |
| **P3** | **浅层** | ① **核实信息收集的工作**：逐项判 `ok`（采到的是真的）/`wrong`（采错了，例：版本只来自响应头、目录其实不存在）/`unknown`（无法核验，写清原因）—— 登记在 `verifyInfo` 矩阵；② **浅层测试**（`shallow` 矩阵 8 项）：`fp` 指纹/版本**行为**验证、`pathTruth` 目录/路径真值（404/SPA 兜底排除、目录列举）、`params` 参数面与正常请求基线、`authEdge` 鉴权边界快照（无凭据 vs 有凭据的最小对照）、`errLeak` 错误页与信息泄露、`expose` 暴露面存在性（`.git`/备份/`swagger`/`actuator`/控制台/默认页）、`lowFuzz` 低频模糊小样本（≤50、显式限速、去重、命中即停）、`compHint` 组件版本→公开漏洞线索（只记线索，**不在浅层定级**） | `verifyInfo` 必查项（**所有资产**）全部有结论 **且** `priority ≥ 3` 资产的 `shallow` 8 项全部有结论 |
| **P4** | **中间层** | ① **核实浅层的工作**：浅层每一项的结论是否有证据、有没有漏（登记 `verifyShallow` 矩阵，同 8 个 key）；② 对每个资产做 **OWASP Top 10 (2021) A01–A10** 逐类测试（登记 `owasp` 矩阵） | `verifyShallow` 必查项（**所有资产**）全部有结论 **且** `priority ≥ 3` 资产的 `A01`–`A10` 全部有结论 |
| **P5** | **深层** | ① **完整读取该资产已有全部信息**（事实 + 证据索引，不许凭印象）② **核验中间层是否有误**（`owasp`/`verifyShallow` 的结论必须被独立复算：`bb_asset_check … reviewed=true`；`wrong` 的项必须复算）③ 逐资产**漏洞验证**（`deep` 矩阵 8 类）：`unauth` 未鉴权/缺鉴权、`authz` 越权（水平/垂直）、`inj` 注入链、`ssrf`、`upload` 上传/导入导出、`logic` 业务逻辑与状态机、`race` 竞态并发、`deser` 反序列化 | `priority ≥ 3` 资产的 `deep` 8 类全部有结论；所有 `verifyInfo`/`verifyShallow = wrong` 的项已 `reviewed`；所有 `owasp` 行已 `reviewed` |
| **P6** | **成果** | 证据索引 + 报告 + **未测面显式声明** + **每条 `category=vuln` 事实有复核记录** | 无 `pending`；`untested_declared` 已声明（`bb_coverage {declareUntested:true}`）；所有 `category=vuln` 事实都有 `bb_fact_review` 记录 |

**推进只能调用 `bb_phase_advance {to:"P2"|"P3"|"P4"|"P5"|"P6"}`**：门禁不满足时它拒绝并列出 `blockers.{P1..P5}`；缺口就是下一轮要派的单。人类明确要求跳阶段时才 `force=true` + `reason`。

**矩阵范围（可审计的降级，不是偷偷免测）**：`info` 与 `verifyInfo` 要求**所有资产**；`shallow`/`verifyShallow`/`owasp`/`deep` 只要求 **`priority ≥ 3`** 的资产 —— 把资产登记成 `priority < 3` **必须在 `bb_asset_add`/`bb_asset_update` 的 `notes` 里写明理由**（机器强制，不写会被拒绝）。

## 二、状态取值与工具面（唯一的状态入口是 `bb_asset_check`）

| 工具 | 入参 | 用途 |
|---|---|---|
| `bb_asset_check` | `{asset:{id} 或 {kind,value}, stage:"info"\|"verifyInfo"\|"shallow"\|"verifyShallow"\|"owasp"\|"deep", key, status, evidence?, note?, reviewed?}` | **登记一条检查结果**。这是把"我做了"变成"账本上有"的唯一动作 |
| `bb_asset_checks` | `{asset?, stage?, onlyGaps?}` | 查矩阵与缺口：我这单的资产哪些 key 还是空的 |
| `bb_untested_add` | `{surface, why, stage?}` | 登记**未测面**（做不了/没做的面），`stage` 可写 P1–P6 |
| `bb_fact_review` | `{fact_id, verdict:"confirm"\|"challenge", evidence, note?}` | 复核一条事实（`category=vuln` 的事实**必须**有一条） |
| `bb_coverage` | `{}` / `{endRound:true}` / `{sourceExhausted:[...]}` / `{declareUntested:true}` | 覆盖率与阶段门；收轮、标来源穷尽、声明未测面登记完 |
| `bb_phase_advance` | `{to:"P2"\|"P3"\|"P4"\|"P5"\|"P6"}` | 推进阶段（门禁不满足即拒绝并列缺口） |
| `bb_asset_add` / `bb_assets` / `bb_asset_update` | 登记/查询/写 `tech`·`priority`·`notes` | 账本基础三件套（回灌、取数、写指纹） |

**状态取值（写错会被拒）**

| stage | 允许取值 | 语义 |
|---|---|---|
| `info` | `done` / `na` / `doing` | `done` = 已采到并落证据；`na` = 该项对本资产不适用（**必须写理由**）；`doing` = 正在采（不是终态） |
| `verifyInfo` | `ok` / `wrong` / `unknown` / `na` | `ok` = 采到的是真的且与行为一致；`wrong` = 信息收集采错了（P5 必须独立复算并标 `reviewed`）；`unknown` = 无法核验（写清原因，不许用 `ok` 顶）；`na` = 不适用（写理由） |
| `shallow` | `done` / `hit` / `na` | `done` = 该项测过且未命中；`hit` = 命中（**必须给 `evidence`**）；`na` = 该项对本资产不适用（写理由） |
| `verifyShallow` | `ok` / `wrong` / `unknown` / `na` | `ok` = 浅层那一行的结论被证据支撑、没有漏面；`wrong` = 浅层测错了/口径不对（必须独立复算 + `reviewed`）；`unknown` = 无法核实（写原因）；`na` = 不适用（写理由） |
| `owasp` | `done` / `hit` / `na` | `done` = 该类测过且结论为"未命中"；`hit` = 命中（**必须给 `evidence`**）；`na` = 不适用（写理由） |
| `deep` | `done` / `hit` / `na` | 同上 |

**`na`、`unknown`、`wrong` 一律要写 `note` 理由**：无理由的 `na` 会被门禁直接点出来（它把缺口洗成覆盖）。

**六张矩阵与三个"谁核实谁"的关系**

| 矩阵 | 归属阶段 | 谁做 | 谁核实 |
|---|---|---|---|
| `info` | P2 信息收集 | P2 各专业角色（recon / js-reverse / app-reverse / cloud-ai / internal-network / component-cve） | `verifyInfo`（P3 浅层） |
| `verifyInfo` | P3 浅层 | P3 角色（recon / api-security / web-injection / component-cve / cloud-ai / internal-network / js-reverse / app-reverse / auth-logic） | P5 的独立复算（`reviewed:true`） |
| `shallow` | P3 浅层 | 同上（按 8 项分工） | `verifyShallow`（P4） |
| `verifyShallow` | P4 中间层 | P4 角色（api-security / web-injection / component-cve / auth-logic / internal-network / cloud-ai） | P5 的独立复算（`reviewed:true`） |
| `owasp` | P4 中间层 | 同上（按 A01–A10 分工） | P5：所有 `owasp` 行必须 `reviewed` |
| `deep` | P5 深层 | P5 角色（api-security / web-injection / auth-logic / component-cve / internal-network / cloud-ai / exploit-dev） | `reviewer` + `bb_fact_review`（每条 vuln） |

**必查 key 集合**

- **`info` / `verifyInfo` BASE（12，所有资产都要）**：`tech`（技术栈指纹）`lang`（后端语言/框架）`middleware`（中间件/网关）`os`（操作系统）`arch`（站点架构）`dirs`（目录枚举-低频）`paths`（路径/接口/参数）`cert`（TLS 证书与 SAN）`dns`（解析/CNAME/历史）`waf`（WAF/CDN）`third`（第三方依赖/SDK）`sec`（安全头/Cookie）
- **`info` / `verifyInfo` 按 `kind` 追加**：`js`→`jsrev`+`params`；`url`/`endpoint`→`params`；`ip`/`port`/`service`→`banner`；`app`→`client`；`repo`→`repo`；`cred`→`cred`；`cloud`→`cloud`；`domain`/`subdomain`→`sub`
- **`shallow` / `verifyShallow`（8，`priority ≥ 3`）**：`fp` `pathTruth` `params` `authEdge` `errLeak` `expose` `lowFuzz` `compHint`
- **`owasp`（10，`priority ≥ 3`）**：`A01`–`A10`
- **`deep`（8，`priority ≥ 3`）**：`unauth` `authz` `inj` `ssrf` `upload` `logic` `race` `deser`

## 三、回灌循环（本模式的核心，不是可选项）

任何阶段发现的新资产 —— JS 里的接口/参数/内部域名/密钥、浅层测试暴露的新路径与参数、指纹带出的新组件与新域名、响应头里的内网地址、证书 SAN 里的域名、客户端产物里的接口 —— **必须立刻 `bb_asset_add`**。

登记之后：

1. **六张矩阵的缺口同时出现**（新资产的 `info`/`verifyInfo`/`shallow`/`verifyShallow`/`owasp`/`deep` 全部是 `pending`）；
2. `bb_coverage` / `bb_phase_advance` 会把"新增 N 个资产未完成"列为阻塞；
3. **阶段自动退回 P1 起点（信息收集）** —— 该资产必须从 `info` 重新走一遍（信息全采 → 浅层核实与浅层测试 → 中间层核实与 OWASP → 深打），才允许继续推进。

> **新资产 = 回到 P1 起点（再收一轮 → P2→P5）。** 判分：一轮作业里新资产不回灌，等同于这一轮没做完。总控派单时必须把"本单可能产出新资产，产出即登记"写进成功标准。

## 四、资产清单怎么记（`bb_asset_add` 字段口径）

| 字段 | 口径 |
|---|---|
| `kind` | `domain` / `subdomain` / `ip` / `port` / `service` / `url` / `endpoint` / `js` / `repo` / `cred` / `cloud` / `app` / `other` |
| `value` | **规范化唯一值**：域名写 `a.example.com`；IP 带端口写 `1.2.3.4:8443`；URL 写完整 `https://host/path`；接口写路径 `https://host/api/order`；JS 写文件 URL（带 hash 更好） |
| `tech` | 指纹：中间件/框架/语言/版本/组件，如 `nginx 1.24 / Spring Boot 2.7.5 / Vue3` |
| `priority` | 1..5，深测排序。入口、后台、带参接口、上传点、认证面 → 4~5；静态资源、纯展示页 → 1~2 |
| `notes` | 特殊情况（WAF、限流、需登录、客户特别声明等）。**`priority < 3` 时必须写明降级理由**（机器强制） |

一个资产一行；**同一资产的不同阶段状态是 `bb_asset_check` 的多行**，不要重复登记资产。**资产阶段状态不再走 `bb_asset_update`** —— 它只写 `tech`/`priority`/`notes`。

## 五、清单① P2 信息收集清单（逐 key：采什么 / 怎么采 / 最低证据标准）

### BASE 12 项

| key | 采什么 | 怎么采 | 最低证据标准 |
|---|---|---|---|
| `tech` | 技术栈指纹：框架/组件/版本/构建工具 | `httpx -tech-detect`、favicon（mmh3 查指纹库）、报错页特征、静态资源路径与文件名、Cookie 命名、JS 里的版本号 | **≥2 条互相独立的证据**（如响应头 + 静态文件名 + 行为路径差异）；只有单个 `Server` 头 → 只能写「疑似」，不许 `done` |
| `lang` | 后端语言与框架（PHP/Java/Go/Node/.NET/Python；Spring/Laravel/Django/Express…） | 错误页栈、URL 后缀（`.php`/`.jsp`/`.do`/`.action`）、Cookie 名（`JSESSIONID`/`PHPSESSID`/`laravel_session`）、`X-AspNet-Version`、`/actuator`、`/server-status` 行为 | 至少 1 条行为证据 + 1 条静态证据；两者矛盾时按行为证据为准并记 `verifyInfo=wrong` 候选 |
| `middleware` | 中间件/网关（nginx/Apache/IIS/Tomcat/WebLogic/Kong/APISIX/Ingress） | 响应头、默认页哈希、默认错误页（400/404/410）、特征路径（`/nacos`、`/solr/`、`/_cat/indices`、`/console`） | 默认页内容哈希 + 特征路径行为；只凭 `Server` 头不算 |
| `os` | 操作系统与发行版 | 大小写敏感（`/INDEX.HTML` 与 `/index.html` 的差异）、默认 404 页、`Server` 头、TTL、端口侧 banner（SMB/RDP/SSH） | **≥2 条独立信号**；只靠 TTL 或 `Server` 头 → 疑似 |
| `arch` | 站点架构：前后端分离 / CDN 回源 / 多活 / 反代层数 / SSR | 直连 IP 与域名对照、CDN 头（`X-Cache`/`Via`/`CF-Ray`/`X-Cache-Status`）、同域不同路径 Server 头差异、JS 里的 `baseURL`、多 A 记录行为差异 | 直连 IP vs 域名**对照包**各一份 + CDN/回源判定依据 |
| `dirs` | 目录枚举（低频） | 词表按技术栈裁剪（Java → `/actuator`、`/druid`、`/swagger-ui`）；≤50 请求小样本起步，默认 ≤5 req/s（WAF/生产 ≤1 req/s），请求去重、命中即停 | 目录清单落文件 + **每个命中一条请求编号** + 软 404 排除说明（随机路径对照包） |
| `paths` | 路径 / 接口 / 参数 | `robots.txt`、`sitemap.xml`、`security.txt`、`.well-known/`、Wayback/Common Crawl 历史 URL、HTML 表单与 `a[href]`、前端产物里的接口表 | 路径表落文件，**每条标来源**（哪个来源、哪一行）；历史 URL 要标快照时间 |
| `cert` | TLS 证书：CN/SAN、签发者、有效期、密钥算法、是否自签/过期 | `openssl s_client -connect host:443 -servername host`、`httpx -tls-grab`、CT 日志（crt.sh） | 证书原文落文件 + **SAN 全量列出**；SAN 里的新域名必须回灌 |
| `dns` | 解析记录与历史：A/AAAA/CNAME/MX/TXT/NS、CNAME 指向（CDN/云存储 = 接管线索）、历史解析 | `dig`、CT 日志、历史 DNS 源；**必须做泛解析判定**（随机子域对照） | 解析结果文件 + 泛解析对照包（随机子域无解析或行为可区分，否则一切子域结论都要标"疑似泛解析"） |
| `waf` | WAF / CDN 判定（有无、厂商、拦截页特征） | 单次无害探测（URL 参数里放 `<script>` 置等价样本）看拦截页与响应头（`Server: cloudflare`、`X-Sucuri`、`waf` cookie） | 拦截页原文 + 请求编号；判"无 WAF"必须写清**试了哪个探测点**；探测**只做单次**，不刷 |
| `third` | 第三方依赖与 SDK（jQuery/axios/Vue 版本、统计/推送/支付 SDK、CDN 资源域） | 静态资源路径里的版本号、JS 内 SDK 标识、`package.json`/`composer.lock` 泄漏、外链域名 | 依赖清单 + **每个版本的出处行号**；按版本判 CVE 时须另找行为证据（A06） |
| `sec` | 安全头与 Cookie 属性、CORS | 完整响应头（CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）、`Set-Cookie` 属性（HttpOnly/Secure/SameSite/Domain/Path/Expires）、`Origin` 反射与 `Access-Control-Allow-Credentials` | 登录前/登录后各一份**完整响应头原文**；注意本规范里安全头缺失多为「线索」而非高危，须按业务影响定级 |

### 按 `kind` 追加项

| 追加 key | 适用 kind | 采什么 / 最低证据标准 |
|---|---|---|
| `jsrev` | `js` | JS 逆向：接口表（方法/路径/参数/是否鉴权）、硬编码密钥（标公开型/越权型）、签名与加密算法、前端路由与隐藏入口、云桶与内部域名。**每条都要 bundle 路径 + 行号**；判"无接口/无密钥"必须写清扫了哪些文件、用了什么正则、结果行数 |
| `params` | `js` / `url` / `endpoint` | 参数面：参数名、类型、是否必填、位置（query/body/header/cookie）、是否需鉴权。落成参数表 + 来源指位；无参资产写 `na` + 理由 |
| `banner` | `ip` / `port` / `service` | 服务 banner：协议、软件与版本、握手结果（TLS 协议/套件、SSH 版本、Redis `INFO` 头行等）。**每个服务只做一次版本握手**，不做登录尝试 |
| `client` | `app` | 客户端产物：样本指纹（平台/包名/版本/加固）、反编译目录、SDK 清单、本地存储与凭据、证书固定实现、加密算法。样本原文落 `evidence/app/`，密钥只写指位 |
| `repo` | `repo` | 仓库面：可见性（公开/私有）、CI 配置（`.github/workflows`、`.gitlab-ci.yml`）、提交历史里的凭据、`.git/config` 可读性。只读，不 clone 大仓库 |
| `cred` | `cred` | 凭据只读有效性：`sts get-caller-identity` 等价调用、账号/角色/权限层级。**只做一次只读验证**；明文只进本地凭据库，账本只写指位 |
| `cloud` | `cloud` | 桶/对象存储：存在性、`ListBucket` 是否未授权、ACL、静态网站配置；元数据面：IMDS 版本与可取内容；K8s/容器：匿名 API、kubelet、etcd。全部**只读、单次、不列举超量** |
| `sub` | `domain` / `subdomain` | 子域面：子域清单、泛解析判定、CNAME 接管线索（指向未占用的云资源）、历史子域。逐条可核对（解析结果文件 + 对照） |

**P2 收尾判据**：所有资产的 `info` 必查项都有 `done`/`na` 结论；"没采到"不是结论 —— 要么写清采不到的前置条件并留 `pending` + `bb_untested_add`，要么给 `na` 理由。

## 六、清单② P3 浅层清单（先核实信息收集，再做浅层测试）

### 6.1 核实信息收集（`verifyInfo`）——"行为验证"与"只看响应头"的分界

**总原则：P2 采到的是"信号"，P3 要把它变成"结论"。只看响应头/只看字符串得到的项，在 P3 一律不能给 `ok`。**

| key | 行为验证怎么做 | 只靠响应头会怎样（→ `wrong`） | `unknown` 的写法 |
|---|---|---|---|
| `tech` / `lang` / `middleware` | 用特征路径行为确认（该版本才有/才没有的路径、默认错误页、大小写敏感）、触发一次报错看栈 | `Server: nginx` 被反代覆盖，真实后端是 Tomcat | 报错被统一处理页遮蔽且无第二信号 → `unknown` + "被统一错误页遮蔽，无第二信号" |
| `os` | 大小写敏感 + 默认页 + 端口侧 banner 交叉 | TTL 猜 OS | 目标全走同一层代理、无端口侧信号 |
| `arch` | 直连 IP 与域名各取一次对照包，比对 Server/Cache 头与内容哈希 | 仅凭 `Via` 头断言有 CDN | CDN 回源不可控、直连被拒 → `unknown` |
| `dirs` | **逐个命中重放一次**（换随机 query 绕缓存），确认不是软 404 / 不是 200 通配 | 软 404 被当成目录存在 | 目标整体返回 200 且长度恒定 → 整理为 `wrong` 或 `unknown` 并说明 |
| `paths` / `params` | 重放确认状态码与鉴权边界（登录前后各一次）；JS 抽出的接口实际请求一次 | JS 里存在但线上 404（旧接口）被当成有效接口 | 接口需登录而本单无凭据 → `unknown` + 说明缺什么前置条件 |
| `cert` / `dns` | 现网重新握手 / 重新解析，与 P2 记录逐字段比对 | 历史 CT 记录被当成当前状态 | 历史源不可查 → `unknown` |
| `waf` | 换一个**不同**探测点复判（仍是单次） | 拦截页断言过度（把 CDN 缓存页当 WAF） | 无允许的探测手法 → `unknown` |
| `third` / `sec` | 直接读原文核对（响应头/Cookie 原文，不靠记忆） | 凭印象写"缺 HSTS" | 响应头被网关裁剪、看不到源站头 → `unknown` |
| `jsrev` / `client` | 回到产物核对行号；算法用抓包/复现脚本对齐 | 字符串像密钥就当密钥有效 | 产物加壳/混淆不可读 → `unknown` |
| `cloud` / `cred` | 只读调用复判一次 | 凭桶名猜测权限 | 无调用凭据 → `unknown` + 说明 |
| `banner` | 重新握手一次 | 单次 banner 当稳定 | 服务不稳定、握手超时 → `unknown` |

**`wrong` 的处理铁律**：标了 `wrong` **必须**在 P5 由他人（或独立复算的你自己）重新验证并把该检查行标 `reviewed:true`，否则 P5 门禁不放行。

### 6.2 浅层测试（`shallow`）8 项：每项怎么做、判据是什么

| key | 做什么 | 判据（`hit` 条件） | `na` 的写法 |
|---|---|---|---|
| `fp` | **指纹/版本行为验证**：用只有该版本才有的路径/默认页/报错签名/大小写行为确认真实组件与版本；对"版本号声称"独立复核 | 行为证据与声称版本**矛盾**（`Server: nginx 1.14` 但行为是 Tomcat）→ `hit`（指纹造假/被覆盖本身就是发现）；一致且证据齐 → `done` | 目标无任何可观测指纹面（纯静态无响应头无报错）→ `na` + 理由 |
| `pathTruth` | **目录/路径真值**：对 P2 命中的每条目录/路径用随机 query 重放、与随机不存在路径对照，排除 404 兜底页、SPA 200 通配、软 404；可列目录的做一次目录列举 | 排除兜底后**确实存在**且暴露了不该暴露的内容（目录列举、备份、配置、源码）→ `hit`；全部为兜底 → `done` | 路径字典已按技术栈裁剪仍无任何命中且目标返回恒定兜底页 → `na` + 理由（须附对照包） |
| `params` | **参数面与正常请求基线**：取 P2 参数表，对每个参数确认可解析（改值/删值/加类型混淆各一次），并记录**正常请求基线**（status/len/time/body 哈希，重放 2 次确认稳定） | 参数可解析且服务端行为随参数值改变（进入注入/越权候选）→ `hit`；参数全部只读且无差异 → `done` | 该资产无任何输入解析面（纯静态资源、无参接口）→ `na` + 理由 |
| `authEdge` | **鉴权边界快照**：无凭据 vs 有凭据（若有低权限账号）对同一接口各请求一次，记录状态码/长度/关键字段；标出哪些接口在不带凭据时仍返回业务数据 | 无凭据即可拿到受保护数据/功能 → `hit`（浅层只登记**快照与线索**，定级与取证留 P5 `unauth`/`authz`） | 本单无任何凭据且目标全部接口都强制登录（无凭据一律 401/302 统一跳转）→ `na` + 理由 |
| `errLeak` | **错误页与信息泄露**：构造 4xx/5xx（越界 ID、坏 JSON、超长参数、错方法），看栈信息、绝对路径、SQL 片段、内网主机名、框架版本 | 错误页泄漏了栈/路径/SQL/内网主机等可定向利用的信息 → `hit` | 目标用统一自定义错误页且无任何细节（需附 3 类错误包）→ `na` + 理由 |
| `expose` | **暴露面存在性**：`.git/config`、`/.svn/`、`*.zip|*.bak|*.sql|*.tar.gz`、`swagger-ui`/`v2/api-docs`、`actuator`（含 `env`/`heapdump`）、`h2-console`、`druid`、管理控制台、安装页/默认页 —— **只做单次存在性 GET，发现即停** | 未授权即可访问上述任一（读配置/接口文档/管理台/源码）→ `hit` | 已按技术栈裁剪的暴露面清单逐条单次探测均 404/403（附清单与请求编号）→ `na` + 理由 |
| `lowFuzz` | **低频模糊小样本**：按参数类型选 ≤50 个高价值样本（类型混淆/边界/编码/结构四类），单参数串行、去重（归一化哈希）、显式限速（默认 ≤5 req/s、WAF/生产 ≤1 req/s）、命中即停 | 任一样本产生稳定且可解释的差异（错误类型变化、延时、marker）→ `hit`（转 P5 做三件套取证） | 无参数面或目标已明确禁止模糊测试（客户声明）→ `na` + 理由（写清是谁禁的） |
| `compHint` | **组件版本→公开漏洞线索**：把 `tech`/`lang`/`middleware`/`banner` 的版本与 NVD/厂商公告对照，输出候选 CVE 清单（含未授权可达性、是否需要认证） | **浅层只记线索不判漏洞**：命中候选 CVE 列表 → `done` + note 写清候选清单与判据；**不在浅层写 `hit`** | 无任何版本信息（全部 `unknown`）→ `na` + 理由 |

**浅层纪律**：`hit` 只代表"这一项**有可疑/已命中**"，不代表定级 —— 定级与最小可复现证据属于 P5。浅层 `hit` 必须带 `evidence`，否则会被门禁/复核员打回。

## 七、清单③ P4 中间层清单（先核实浅层，再过 OWASP）

### 7.1 核实浅层的工作（`verifyShallow`，同 8 个 key）

核实对象**不是目标，而是 P3 那一行结论本身**。逐项问三句话：**证据在哪？口径对不对？有没有漏面？**

| 核实动作 | 怎么核实 | 判 `wrong` / `unknown` 的典型情形 |
|---|---|---|
| **证据链完整性** | 对 `shallow` 每一行，要求指到具体证据（请求编号/文件路径/命令回显）。指不到 → `wrong`（"结论未被证据支撑"） | 只有结论描述、没有报文；`done` 是"没看到"推断出来的 |
| **口径正确性** | `pathTruth` 的 404 兜底是否用随机路径对照过；`authEdge` 的"无凭据"是否真的去掉了 Cookie/token；`lowFuzz` 是否真去了重、真限速 | 兜底页当目录、把"带空 token"当"无凭据"、`lowFuzz` 实际是无限刷 |
| **漏面检查** | 对照 P2 的 `dirs`/`paths`/`params` 清单，逐条确认浅层测过的**面集合**是否覆盖完整；按 `kind` 确认没有整类漏掉 | P2 列了 30 条路径只测了 5 条且没说明 |
| **`na` 的理由** | 逐条读 `note`：理由是否具体、可复核、指向真实前置条件 | 只写"无漏洞""不适用"→ `wrong`；理由具体但确实做不了 → `unknown` + 说明缺什么 |
| **与信息收集的一致性** | `shallow` 结论是否与 `info`/`verifyInfo` 冲突（如 `tech` 说是 Tomcat，`fp` 却说 nginx） | 冲突未解释 → `wrong` |

**判 `ok` 的唯一口径**：证据可指、口径正确、面集合覆盖完整、与上游信息不冲突。四项缺一都不许 `ok`。

### 7.2 OWASP Top 10 (2021) A01–A10：每类测什么、判什么

| 类别 | 测试动作 | 判据（`hit` 条件） |
|---|---|---|
| **A01** Broken Access Control | 三态对照（无凭据 / 低权限 / 高权限）；换对象 ID 与租户；换方法（GET↔POST↔PUT）；路径绕过（`/admin`→`/Admin`、`//admin`、`/admin/..;/`、`/admin%2f`）；`X-Original-URL` / `X-Rewrite-URL`；越权读他人数据 | 同请求不同身份返回**不同的业务数据**（不是不同的错误码）→ `hit`，须附 ≥2 组对照包 |
| **A02** Cryptographic Failures | TLS 版本与套件、明文 HTTP 是否可用、证书链、JWT 算法与密钥强度、前端硬编码密钥、密码散列、敏感数据落在 URL/Cookie 明文 | 可读取或可伪造敏感数据（如 `alg:none` 通过、明文口令可取）→ `hit` |
| **A03** Injection | SQL/NoSQL/命令/SSTI/XXE/LDAP/表达式/CRLF 与头注入；判定顺序：引号 → 算术 → 布尔对 → 时间盲 → 编码绕过 | **三件套齐**（基线包 + 差分包 + marker/延时/回连）才 `hit`，否则只能写候选 |
| **A04** Insecure Design | 业务流程缺步骤校验、无频次限制、无幂等、状态机可跳步、把信任放在客户端、无并发约束 | 正常流程 vs 异常流程**差分** + 服务端状态变化 → `hit` |
| **A05** Security Misconfiguration | 默认口令（厂商文档极小字典，≤20 条、限速、写明理由）、目录列表、调试页与堆栈、`/actuator`/`/swagger-ui`/`/h2-console`/`/druid` 暴露、CORS 宽松、Cookie 属性缺失（线索级） | 未授权即可读取配置/进入管理功能 → `hit`；仅安全头缺失只能记线索（`done` + note） |
| **A06** Vulnerable and Outdated Components | 组件版本 → NVD/厂商公告对照 → **行为验证**（版本不可信原则）；默认配置与未授权服务面 | 版本证据（版本接口/静态文件名/CHANGELOG/行为差异）+ 行为差异 → `hit`；只有版本匹配 → `done` + 「疑似」note |
| **A07** Identification and Authentication Failures | 登录响应差异与锁定策略、验证码可复用/可空、多因素可回退、会话固定（登录前后 session 是否轮换）、登出/改密后 token 是否失效、密码重置可猜可复用、JWT `alg:none`/弱密钥/声明篡改 | 用**服务端最终状态**（登录成功/账户创建/余额变化）证明绕过 → `hit` |
| **A08** Software and Data Integrity Failures | 反序列化入口（Java `rO0AB`/`aced0005`、PHP `O:`、pickle、Node `_$$ND_FUNC$$_`）、原型链污染、签名算法可降级、未签名更新/CI 产物可篡改 | 回连记录或无害命令回显、污染可观测证据 → `hit`；本地复现优先 |
| **A09** Security Logging and Monitoring Failures | **只做只读观察**：是否有审计端点、登录失败是否有可观测反馈、日志是否含敏感信息（越权读日志即 A01/A05）。**不主动制造攻击来"测试告警"** | 多数只能 `unknown`/`na` + 写清"无审计权限，无法判定告警链路"；把"无法判定"记成 `done` 是不允许的 |
| **A10** SSRF | 参数面里找 URL/回调/图片抓取/导入/Webhook/预览；打三类：我方回连地址、云元数据 `169.254.169.254`（单次读角色名即止）、授权内网单点；绕过用 IP 编码、DNS 重绑定、302、`@` 混淆 | **我方回连记录**或元数据单次读取成功 → `hit`；只凭参数名叫 `url` 不算 |

**中间层纪律**：`owasp` 每一类都要有结论（`done`/`hit`/`na` + 理由），**`na` 不能当漂白剂**；`hit` 必须带 `evidence`；所有 `owasp` 行在 P5 必须被独立复算并标 `reviewed:true`。

## 八、清单④ P5 深层清单（读全量 → 核验中间层 → 8 类打法）

进入 P5 前，每个资产必须先完成三件事（顺序不可颠倒）：

1. **读全量**：`bb_assets` + `bb_asset_checks {asset}` + `bb_graph` 把该资产的**全部**已有信息（facts + 证据指位）读完 —— `info` 采了什么、`verifyInfo` 哪些是 `wrong`/`unknown`、`shallow` 哪些 `hit`、`verifyShallow` 与 `owasp` 哪些有异议。**不许凭印象开打**；凭印象深打＝漏掉 P2/P3/P4 已有的线索。
2. **核验中间层**：对 `owasp`/`verifyShallow` 的结论做独立复算（自己重放、自己判定），在 `bb_asset_check` 里带 `reviewed:true`；`wrong` 的项**必须**复算。
3. **确认未测面已登记**：本单做不了的项留 `pending` + `bb_untested_add`，不许改 `na`。

然后按资产类别做 8 个必测类别（`deep`）：

| 类别 | 适用资产 | 打法 |
|---|---|---|
| `unauth` | `url`/`endpoint`/`service`/`cloud` | 去掉凭据重放整个接口族（含 `/internal`、`/admin`、`/v2` 变体）；换方法、改路径大小写与尾斜杠；未授权服务面（Redis/Mongo/ES/Docker API/K8s/etcd）单次只读判定 |
| `authz` | `endpoint`/`url` | 水平：换对象 ID（自增/UUID/手机号编码）、跨租户各取 1 个即定性；垂直：低权限调管理接口、批量赋值（`role`/`is_admin`/`tenantId`） |
| `inj` | 带参 `url`/`endpoint` | 按 A03 判定顺序，三件套齐；SQLi 只做最少次数布尔/时间证明（时间盲 delay ≤3s、≤5 次），不 `--dump`；命令注入只跑 `id`/`echo marker` 等价只读 |
| `ssrf` | 有 URL/回调/导入参数的资产 | 按 A10；只打我方回连、元数据单次、授权内网单点 |
| `upload` | 上传/导入导出/模板资产 | 类型与内容校验绕过（魔数、双扩展名、`Content-Type` 伪造、%00）、路径穿越、模板注入、导出接口越权与批量数据面 |
| `logic` | 业务流程资产（`url`/`endpoint`） | 状态机跳步与重放、金额/数量符号与精度、优惠券叠加、参数污染开关（`debug=1`/`channel=internal`/`X-Forwarded-For`） |
| `race` | 一次性资源（优惠券/库存/余额/抽奖次数） | 同 key 并发（单批 ≤9 请求，`xargs -P 9` 等合规写法）、时间戳对齐、重复一批判稳定；不做长时间循环压测 |
| `deser` | 有序列化入口的 `service`/`endpoint` | 识别入口特征 → **本地复现优先** → 对目标单次触发（回连/无害命令为准），不投递破坏性 gadget 链 |

**深测纪律**：不做破坏性动作（删数据、停服务、改配置）；批量读取先算量级并申请；命中高危立刻停止放大，转成最小可复现证据；**每条深测结论都要有证据指位**，`hit` 必须带 `evidence`。

## 九、覆盖率账本怎么读（`bb_coverage`）

```
阶段 P4（中间层…）｜资产 27
stages:
  info          required 351  done 300  na 12  pct 89%  gaps 39
  verifyInfo    required 351  done 210  na 5   pct 61%  gaps 136
  shallow       required 192  done 150  hit 4   pct 78%  gaps 38   （只算 priority ≥ 3：24 个资产）
  verifyShallow required 192  done 96   na 0   pct 50%  gaps 96
  owasp         required 240  done 190  hit 3   na 0   pct 79%  gaps 47
  deep          required 192  done 40   hit 6   na 0   pct 21%  gaps 146
untested: declared=false  count=3
reviews:  vuln 9  reviewed 6  pending 3  challenged 1
收集轮次：已确认 3 轮，上一轮新增 0 个，本轮累计新增 4 个
推进阻塞：blockers.P2 = info 缺口 39；blockers.P3 = verifyInfo 缺口 136 + owasp 缺口 47
canAdvanceTo: P2=true P3=false P4=false P5=false（返回对象以 `stages`/`blockers`/`canAdvanceTo` 为准）
```

**读法（三条铁律）**

1. **`na` 与"真测过"必须分开看**：`done` = 真的测过且有证据；`na` = 不适用。出关口径允许 `done + na + hit = required`，但**给用户/报告的声明里必须写`done=x, hit=y, na=z`三个数**，不许用 `pct` 一个数把 `na` 里的空白盖过去。
2. **`stages.*.gaps` 就是下一轮的派单清单**：`bb_coverage` 的 `stages.*.gaps` 与 `bb_asset_checks {onlyGaps:true}` 出的是同一批缺口，直接派单，不要自己去猜。注意矩阵范围差异：`info`/`verifyInfo` 覆盖全部资产，后四张只覆盖 `priority ≥ 3`。
3. **`untested` 与 `reviews` 是收口的硬条件**：`untested.declared=true` 且 `untested.items` 已登记完 → P6 的门禁条件之一；`reviews.pending>0` 说明还有 `category=vuln` 的事实没人复核，**不许进报告**。

- 收轮：每跑完一轮收集调 `bb_coverage {endRound:true, note:"本轮跑了哪些来源"}`；某类来源确实没有更多可挖的，用 `{sourceExhausted:["cloud"]}` 显式标记（并写理由）。
- 声明未测面登记完：`bb_coverage {declareUntested:true}`（前置动作是逐条 `bb_untested_add`）。
- `blockers.{P1..P5}` 与 `canAdvanceTo.{P2..P6}` 是唯一权威；模型不得自行宣布阶段推进。

## 十、未测面与复核纪律

**未测面（`bb_untested_add {surface, why, stage?}`）**：做不了/没做的面必须显式登记，一条一句"哪个面 + 为什么没测 + 卡在哪个阶段（P1–P6）"。

- 典型：拿不到第二个账号 → 无法证明越权；目标在客户维护窗口不可达；需授权内网范围未给；无凭据无法核验 `cred`/`cloud`；模型拒答且无服务端副作用。
- **不要把未测面写成 `na`**：`na` 是"不适用"，未测面是"适用但没做"。把未测面标 `na` 等于把缺口漂白（见反模式表）。
- 前置条件缺失时保留 `pending` **并且** 登记一条未测面，两者并存才是诚实的。
- P6 前必须 `bb_coverage {declareUntested:true}`；没声明不放行。

**复核纪律（`bb_fact_review {fact_id, verdict, evidence, note?}`）**：

- 凡 `category=vuln` 的事实，**必须**有一条复核记录（`confirm` 或 `challenge`）；`evidence` 是必填项。
- `challenge` 必须给出可执行的差异清单（哪一步、哪个字段、原判是什么、复算得到什么、请求编号），不许只说"我不认同"；被推翻的事实用 `bb_fact_deprecate` 留痕（不删）。
- 复核独立重算：从原始材料自己重放、自己看响应、自己写判定，不复用上游判定函数、不引用他人"已验证"字样。
- `verifyInfo`/`verifyShallow = wrong` 的检查项复核完成后，在 `bb_asset_check` 里带 `reviewed:true` 重写该行；`owasp` 的每一行在 P5 也要 `reviewed:true`。

## 十一、反模式表（都发生过）

| 反模式 | 为什么错 | 正确做法 |
|---|---|---|
| **浅层不看信息收集的产出就开测** | P3 的输入是 P2 的 `info`/`verifyInfo` 账本；不看就开测 → 参数面、路径面、鉴权面全是空白，测出来的"无漏洞"是假的 | P3 第一件事 `bb_asset_checks {asset}` 读全量 → 先做 `verifyInfo` → 再按 `info` 给出的面做 8 项 `shallow` |
| **把 `na` 当漂白** | `na` 是"不适用"，不是"没做"。把没测的项标 `na`，覆盖率涨了、漏洞没测 | 不适用写 `na` 并给可复核理由；**不适用之外的空白一律留 `pending`**，另 `bb_untested_add` 声明未测面 |
| **信息收集只跑一次指纹就标 `done`** | P2 要的是"信息画像穷尽"，不是"扫一眼"。只跑一次 httpx 就把 13 个必查 key 全标 `done`，等于浅层无米下锅、中间层无从核实 | 按清单①逐 key 采，每个 key 给 `bb_asset_check` 一条 + 证据；采不到就 `na`（写理由）或留 `pending` |
| **上一层的结论不复算就沿用** | 版本只来自响应头、目录其实是软 404、参数面来自 JS 而非现网 —— 上游结论错，本层全错 | `verifyInfo` 逐 key 做行为验证；`verifyShallow` 逐项要证据链；`owasp` 与 `wrong` 项在 P5 必须独立复算并标 `reviewed:true` |
| **深层不读已有证据** | 凭印象开打，重复劳动、且会漏掉 P2–P4 已有的线索（比如 `verifyInfo=wrong` 的目录其实不存在） | P5 第一步 `bb_asset_checks {asset}` + `bb_graph` 读全量，再动手 |
| **发现不做独立复核** | 单侧证据被当结论，报告失去可信度；一个假阳性毁掉整份交付 | 每条 `category=vuln` 走 `bb_fact_review`；`wrong` 项独立复算并标 `reviewed:true` |
| **把 `shallow` 的 `hit` 当漏洞定级** | 浅层只登记线索（`compHint` 甚至不许 `hit`）；定级必须有最小可复现证据 | 浅层 `hit` 只写"命中点 + 证据指位"，定级/取证在 P5 的 8 类里做 |
| **P3/P4 两个核实动作被合并／跳过** | `verifyInfo` 与 `verifyShallow` 是两张独立矩阵，各自门禁；合成一步做，必然有一层没核实 | 分别落行：`verifyInfo` 核 P2，`verifyShallow` 核 P3 的 8 项 |
| **没登记资产就开始扫** | 覆盖率无法计算，"测全了"没有依据 | 先 `bb_asset_add` 落清单，再逐条 `bb_asset_check` 推进状态 |
| **JS 读完只写一条事实** | 挖到的接口/域名没进清单 → 后续不会有人测它们 | 每条发现都 `bb_asset_add`（回灌），再补 `info` 检查 |
| **用"我扫完了"代替状态** | 阶段门只认 `bb_asset_check` 的矩阵，不认自述 | 逐项落状态（`done`/`na`/`hit`/`ok`/`wrong`/`unknown`），`hit` 附 `evidence` |
| **只挑一个资产打到深** | 面没铺满就深打，命中率低且容易漏 | P1 饱和 → P2 全覆盖 → P3 全核实 + 浅测 → P4 全核实 + OWASP → 再 P5 挑优先级 |
| **`verifyInfo`/`verifyShallow` 全标 `ok`** | 不核实就给"与行为一致"，两个核实层等于没做 | 按 6.1/7.1 的判据逐项判；只有响应头/没有证据链的项一律不许 `ok` |
| **为了推进阶段跳门** | 缺口会被带进报告，等于交付残缺 | 被 `bb_phase_advance` 拒绝就读 `blockers` 补缺口；`force` 只用于人类明确要求 |
| **模糊测试直接上大字典** | 违反唯一门禁，也打不中 | 小样本差分 → 命中再放大，遵守速率上限、去重、命中即停 |
| **收口时不做未测面声明** | 客户以为"全测了"，实际是"没测的没写" | P6 前逐条 `bb_untested_add` + `bb_coverage {declareUntested:true}` |
| **把 `A09`/`A06` 直接标 `done` 掩盖没做** | 无法核验的项必须 `unknown`/`na` 并写原因；`done` 意味着真的做过且有证据 | 无法判定就写清"为什么无法判定"，这是结论，不是瑕疵 |
