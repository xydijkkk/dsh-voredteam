# vore-settings

> voredteam 的**设置面板**（双入口：会话页签「设置」+ 设置弹窗「voredteam 设置」）：测绘 / 辅助 API 密钥、限速参数、技能根与 SKILL.md 扫描、MCP registry 清单与启用开关。
> 一个宿主插件（工具面 + HTTP 通道 + JSON 持久化）+ 一个 Web 客户端面板（注册到 DSH 设置的 `settings.section`）。

---

## 1. 文件清单

```
plugins/vore-settings/
├─ package.json          # @dsh-external/vore-settings；exports 含 "." / "./pure" / "./client"
├─ cordis.patch.yml      # bundle patch：把本插件 insert 进 loader
├─ lib/
│  ├─ index.js           # 宿主插件（ESM）：4 个模型工具 + /vore-settings HTTP 通道 + 设置持久化
│  ├─ pure.js            # 纯函数层（掩码 / 深合并 / JSON 文件 / 技能扫描 / 极简 YAML 行解析）
│  └─ client.cjs         # Web 客户端面板（手写 CommonJS，无构建、无 JSX）
├─ tests/
│  ├─ settings.test.mjs  # 离线断言（21 组）：掩码 / 部分更新 / YAML 样例 / 空目录扫描 / bundle 契约
│  └─ host.check.mjs     # 宿主面端到端自检（21 项）：工具注册 / CSRF 栅栏 / 端点往返 / 真 registry 解析
└─ README.md
```

## 2. 安装（voredteam 侧）

```powershell
# 1) 校验（会逐项检查本插件的 name / main / dsh.bundle.patch / exports["./client"]）
node ${VORE_PROJECT_ROOT}/deploy/deploy.mjs --check

# 2) 应用：把本插件 link 进 profile 的 dependencies，并追加到 dsh.profile.bundles
node ${VORE_PROJECT_ROOT}/deploy/deploy.mjs --apply

# 3) 装依赖并重启 dsh web（客户端面板必须 restart 才会重新生成 __DSH_BOOT__ 图）
cd $env:USERPROFILE\.dsh\profiles; pnpm install
```

重启后进入「设置」→ 左侧导航出现 **voredteam 设置**（`order: 130`）。

## 3. 设置文件

位置：`~/.dsh/voredteam/settings.json`（目录不存在自动递归创建）。读取时与内置默认值深合并，因此**删字段/删文件都能自愈**，未知分组原样保留。

```json
{
  "fofa":        { "apiKey": "", "baseUrl": "https://fofoapi.com", "backupUrl": "http://107.173.248.139:18999" },
  "shodan":      { "apiKey": "" },
  "yescaptcha":  { "apiKey": "" },
  "grokGateway": { "baseUrl": "http://127.0.0.1:3001/", "apiKey": "" },
  "rate":        { "defaultRps": 5, "wafRps": 1, "fuzzSampleFirst": 50 },
  "skills":      { "roots": ["…voredteam\\skills", "…clown-src-6k-skill\\skills", "…Anthropic-Cybersecurity-Skills-1.3.0", "…reverse-skill-main"] },
  "mcp":         { "enabled": ["anything-analyzer", "adaptix-c2"], "registryPath": "…voredteam\\mcp\\registry.yaml" }
}
```

**部分更新语义**：未出现的字段保留原值；`""` 表示显式清除（用于清 apiKey）；数组整表替换。可写分组白名单 = `fofa / shodan / yescaptcha / grokGateway / rate / skills / mcp`，其它键一律丢弃。

**明文只落磁盘，绝不回网络/模型**：一切读路径（HTTP `settings.get`、工具 `vore_settings_get`）返回的 apiKey 都是 `前 6 位 + "…"` 掩码外加 `hasKey` 布尔；写路径落盘时写明文（否则没法拿来调 API）。

## 4. 宿主面 HTTP 通道（同源栅栏 + CSRF）

写法定式照抄 `plugins/vore-blackboard/lib/index.js`：`isLoopbackHostname` / `isTrustedRequest` / `readBody` / `checkCsrf` 四个辅助函数同款实现。
- 只接受 loopback（或 `webRuntime.trustedHosts` 命中的主机）+ Origin 必须与 Host 同源，否则 403；
- `GET /vore-settings/csrf` 下发随机 token（进程级，重启即换）；
- 其余端点只收 `POST`，且必须带 `x-dsh-csrf` 头（`timingSafeEqual` 比较），body 为 JSON。

| 端点 | 请求体 | 返回 |
|---|---|---|
| `settings.get` | `{}` | `{ ok, path, settings }`（apiKey 掩码 + hasKey） |
| `settings.set` | `{ settings: { <group>: {…} } }` | `{ ok, applied: [...], settings }` |
| `settings.test` | `{ provider: "fofa"\|"shodan"\|"yescaptcha"\|"grokGateway" }` | `{ ok, provider, status, note }` |
| `skills.scan` | `{ roots?: string[] }`（缺省用 skills.roots） | `{ ok, roots, total, truncated, list: [{name,path,desc}], skipped }` |
| `mcp.list` | `{}` | `{ ok, path, exists, note, servers, enabled }` |

### `settings.test` 的探活语义（真发一次请求，12s 超时）

| provider | 请求 | 判定 |
|---|---|---|
| fofa | `GET {baseUrl}/api/v1/info/my?key=…` | `error_code`/`error:true` → 失败并回 `errmsg`；否则 ok 并报账号/VIP/积分（自动 gunzip） |
| shodan | `GET https://api.shodan.io/api-info?key=…` | 401/`error` → 失败；否则报套餐与剩余额度 |
| yescaptcha | `POST https://api.yescaptcha.com/getBalance` | `errorId!=0` → 失败；否则报余额 |
| grokGateway | `GET {baseUrl}models`（404 退化为 `GET {baseUrl}`） | <500 视为网关存活；401/403 额外标注「网关在但 apiKey 未过鉴权」 |

失败一律给可读原因：超时（>12000ms）/ 连接被拒（ECONNREFUSED）/ DNS 解析失败 / 连接重置 / TLS 校验失败 / HTTP 4xx-5xx + 响应片段。

## 5. 模型侧工具面

| 工具 | 参数 | 说明 |
|---|---|---|
| `vore_settings_get` | 无 | 读全量设置（掩码），渲染成紧凑文本 |
| `vore_settings_set` | `group` + `json` | 写单个顶层分组；`json` 为对象字符串；空串=清除 |
| `vore_skill_search` | `keyword` | 在 `skills.roots` 里匹配 SKILL.md 的 name/description/路径，回最多 20 条 |
| `vore_mcp_list` | 无 | 读 registry 清单 + 启用状态（文件不存在给提示，不算错误） |

## 6. 客户端面板（lib/client.cjs）

三段折叠区，全部用 `React.createElement` 手写：

1. **测绘与辅助 API** —— FOFA（apiKey/baseUrl/backupUrl）、Shodan、YesCaptcha、Grok 网关各自一行：输入框 → 「测试」（先保存再探活）→ 「保存」；带「清除密钥」；末行是限速三参数（defaultRps / wafRps / fuzzSampleFirst）。
2. **技能管理** —— 技能根多行文本框（一行一个路径）→「保存根目录」/「扫描技能」→ 结果表（名称 / 路径 / 描述）+ 截断与跳过目录提示。
3. **MCP 管理** —— registry 路径（可改可保存）+ 表格（启用勾选框 / id / 名称 / transport / url 或 command）；勾选即写回 `mcp.enabled`；文件不存在时顶部显示提示条。

样式：类名统一 `dsh-vset-` 前缀，全部走 CSS 变量（`--dsh-vset-*` 回落到 `--dsh-bg-primary` / `--dsh-fg-primary` / `--dsh-border-default` / `--dsh-accent`），并用 `body[data-ds-dark-theme] .dsh-vset-root` 覆盖成深色，因此随 DSH 主题自适应。

### 6.1 客户端模块格式：为什么是 `lib/client.cjs`（CJS）而不是 ESM

**选型结论：客户端写手写 CommonJS，文件用 `.cjs` 扩展名，`exports["./client"] = "./lib/client.cjs"`。**

理由：

1. **宿主加载器要的就是 classic script + 工厂注册**。`@deepseek-ai/dsh-client-modules` 把 `exports["./client"]` 解析成绝对路径，作为同源 `<script>` 原样下发到 `/plugins/@dsh-external/vore-settings/client.js`，脚本执行时**只能**通过 `window.__ModuleLoader__.load({ id, factory })` 注册工厂；之后 cordis 客户端 loader 走 `internal.import(id)` → `factory(require)` → `exports`。`lib/client.cjs` 的第一行就是这个 IIFE 注册式调用，与本仓库 `plugins/vore-console/lib/client.js` 同构（那个文件由 `scripts/build-client.mjs` 从 `client.mjs` 生成，同样导出 `./client`）。
2. **`"type": "module"` 是本插件（也是 voredteam 全部插件）的既定约束**，包内 `.js` 一律按 ESM 解析。ESM 客户端 bundle 的下发形态反而不匹配：`export default` 在 classic script 里是语法错误，而把 `apply` 从 `module.exports` 改成 ESM 导出还要宿主再做一层包装。用 `.cjs` 让 Node 侧（`node --check`、工具脚本、未来可能的 require 校验）与浏览器侧（classic script）**两边语义一致**，零歧义。
3. **浏览器侧不看扩展名**：client-modules 只做 `join(dirname(pkgJson), clientRel)` + 读字节 + `content-type: text/javascript`，`.cjs` 与 `.js` 无差别；`deploy.mjs` 的存在性检查同样只看路径存在与否（已实测打 ✓）。
4. **与项目其余部分一致**：`inject` 里只写模块表 seed 词 `react`（`require("react")`），不需要任何子包 `external` 声明，也无需构建工具。

面板里的数据通道全部走宿主 HTTP（`fetch("/vore-settings/…")` + `x-dsh-csrf`），不依赖任何客户端侧服务注入，除了 `slots`。

## 7. 自测

```powershell
cd ${VORE_PROJECT_ROOT}/plugins/vore-settings

node --check lib/index.js      # 宿主 ESM 语法
node --check lib/pure.js
node --check lib/client.cjs    # 客户端 CJS 语法（.cjs 恒按 CommonJS 解析）

node tests/settings.test.mjs   # 离线断言：掩码/部分更新/YAML 样例/空目录扫描/bundle 契约
node tests/host.check.mjs      # 宿主面端到端：工具注册/CSRF 栅栏/端点往返/真 registry 解析
```

两个测试都**不联网、不碰真实 `~/.dsh`**：`host.check.mjs` 通过 `apply(ctx, { settingsPath })` 把设置写到临时目录（`apply` 支持 `config.settingsPath` 覆盖，默认才是 `~/.dsh/voredteam/settings.json`）。

客户端 bundle 契约的验证方式（`settings.test.mjs` 第 [5] 组）：用 `node:vm` 起一个只有 `window.__ModuleLoader__` 与 `document` 的沙盒，把 `lib/client.cjs` 当 classic script 跑一遍，断言「只注册工厂、零副作用」；再用 React 桩 `factory(require, module, exports)` 材化，断言导出 `{ name, inject: ["slots"], apply }`，且 `apply` 注册了 `settings.section`（id `vore-settings` / order 130 / label 「voredteam 设置」）、注入了含 `.dsh-vset-` 与 `body[data-ds-dark-theme]` 的样式。

## 8. 实现注记

- **零第三方依赖**：MCP registry 用极简行解析（只认 `- id:` / `name:` / `transport:` / `url:` / `command:` / `enabled:`，含裸条目名与引号剥离、行内注释剥离但不吃 URL 的 `#`），不引 YAML 库。实测吃下 `mcp/registry.yaml` 全部 15 条（含 `tools:` 多行数组、`url: null` 等真实形态而不误吞）。
- **技能扫描有界**：递归深度 ≤6、条数 ≤500（截断如实标记 `truncated`）、跳过 `node_modules` / `.git` / 点目录、`realpath` 去重防符号链接环；不可读目录只记 `skipped` 不抛。
- **CSRF token 是进程级的**：`crypto.randomBytes(24)`，重启后旧页面里的 token 失效，刷新即可。
- 面板的键盘/可访问性保持最小面：折叠头是 `role="button"` + `tabIndex=0`，其余为原生控件。

## 许可

MIT。
