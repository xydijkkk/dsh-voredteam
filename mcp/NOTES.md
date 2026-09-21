# dsh-voredteam MCP 接入注意事项（NOTES）

> 来源：本机（Windows）安全工具集实测盘点，**只读**扫描，未修改任何被盘点目录。
> 盘点时间：2026-09-19（文件核对 + 端口探测 + MCP 协议实拉）。
> 配套文件：同目录 `registry.yaml`（内置 MCP 注册表，被 vore-settings 的 `mcp.list` 与部署脚本读取）。
> 范围：已排除 `${VORE_TOOLS_DIR}/app/hexstrike-ai-client` 及任何 hexstrike 相关项。

---

## 1. 端口占用现状（实测）

| 端口 | 状态 | 占用者 / 说明 |
|---|---|---|
| 23816 | **LISTEN** | Anything Analyzer（pid 15316）—— MCP HTTP 端点 |
| 8888 | LISTEN | Anything Analyzer（辅助端口） |
| 4321 | LISTEN | `wslrelay.exe` —— WSL2 转发 AdaptixC2 teamserver，**仅监听 `::1`** |
| 5432 / 6379 / 8000 | LISTEN | `wslrelay`（WSL 内的 postgres / redis 等） |
| 3080 | LISTEN | node（DSH Web GUI） |
| 12306 / 8377 | LISTEN | node |
| 9876（Burp SSE） | free | Burp 未运行，需手动启动 |
| 17896（CDP 网关） | free | 网关未运行 |
| 9222（Trae CDP） | free | Trae 未以调试模式启动，需手动启动 |
| 8443（PentAGI） | free | docker 栈未起 |
| 8080 / 8081（CyberStrikeAI） | free | 服务未起；8081 还须先改 `mcp.enabled: true` |
| 8765（trae-codex-bridge 非 stdio 时） | free | 默认走 stdio，不占端口 |

## 2. 端口冲突要点

- Burp 扩展默认 `127.0.0.1:9876`，与其它服务无冲突；但 Burp 的 SSE 端口可在扩展的 **MCP tab → Advanced options** 里改，改了就要同步改 `registry.yaml` 里 `burp-suite-mcp.url` 与 `burp-mcp-proxy-stdio.args` 的 `--sse-url`。
- CDP 网关 `17896` 与 pentagi-mcp 无冲突（后者根本不开端口）。
- **CyberStrikeAI 的 Web 端口 8080 与 MCP 端口 8081**：本机 3080 / 8377 / 12306 已被 node 占用，若 8080 也被占，需在 `config.yaml` 里同时改 `server.port` 与前端引用；`mcp.port` 改完要同步改 `registry.yaml`。
- **Trae 多账号模式**会依次占用 `9222 + account_index` 的连续端口段。当前 `accounts.json` 只有 1 个账号（`cdpPort 9222`），若要扩账号，先确认端口段（如 9222–9232）未被占用。
- 网关绑定 `0.0.0.0:17896`，靠 **源 IP CIDR 白名单**（默认 `127.0.0.0/8,172.16.0.0/12,192.168.65.0/24`）兜底；纯本机使用建议改成只绑 `127.0.0.1`，避免在局域网内被扫到。

## 3. 鉴权方式

| 服务器 | 鉴权 |
|---|---|
| `anything-analyzer` | 无鉴权（仅回环），但**必须带 `mcp-session-id`**：`initialize` 响应头下发，客户端握手后自动持有；无 session 直接 `tools/list` 会收到 400 |
| `burp-suite-mcp` | 无鉴权，但扩展侧有**双重人工审批**：HTTP 请求审批、数据访问审批（HTTP 历史 / WebSocket 历史 / Organizer 各有 always-allow 开关），另有目标自动批准白名单；`filterConfigCredentials` 默认开启，会过滤配置导出里的凭据 |
| `pentagi-mcp` | `Authorization: Bearer <token>`；token 在 PentAGI 的 **Settings → API Tokens** 生成，只把 token 文本写进 `${VORE_TOOLS_DIR}/app/pentagi-mcp/.pentagi-api-token`；工具调用时实时读文件，**换 token 不用改 MCP 配置** |
| `pentagi-cdp-gateway` | `Authorization: Bearer <data\gateway.token>`（`secrets.token_urlsafe(48)`，长度 ≥32）；另加源 IP CIDR 白名单 |
| `trae-codex-bridge` | stdio 无鉴权；若改 `--transport sse|streamable-http` 则 `127.0.0.1:8765` **无任何鉴权**，只允许本机使用 |
| `cyberstrikeai-http-mcp` | 首选用户 `Authorization: Bearer <token>`（需 `mcp:execute` 权限）；兼容模式 `X-MCP-Token: <value>` **需 `allow_global_access: true`，属高风险全局服务身份，默认 false，不要开** |
| `cyberstrikeai-stdio-mcp` | 无网络鉴权（进程级 stdio） |
| `cs-pent-claude-agent` | 自身无鉴权，但需要可用的 `ANTHROPIC_API_KEY`（配置里是 `sk-xxx` 占位） |
| `fofa-mcp` | FOFA API key（三账号：主号 + backup + backup2，限流自动轮转），key 存在 `.env` 或客户端 env |
| `adaptix-c2-mcp` | teamserver 共享口令 `operator1 / pass`（`profile.yaml` 为 `only_password: true`），流程是 login → 一次性 OTP（TTL 60s）→ `wss://.../connect?otp=` |

## 4. 超时与限额

- `pentagi-mcp`：内部 httpx 固定 **30 s** 超时。
- `pentagi-cdp-gateway`：lease TTL **14400 s**、auto-confirm 间隔 **2 s**、请求体 ≤128 KiB、结果 ≤1 MiB、prompt ≤64 KiB。
- `adaptix-c2-mcp`：`ADAPTIX_CMD_TIMEOUT=180`、`ADAPTIX_SYNC_WAIT=20` —— 单条 beacon 命令最长等 3 分钟，**MCP 客户端侧超时不要低于 200 s**，否则长任务会被客户端先掐断。
- `anything-analyzer`：`run_analysis` 会真调 LLM，属长任务，客户端超时给足（≥120 s）。
- CDP 首连等待 **30 s**（`_wait_for_cdp`），冷启动 Trae 时不要过早判定超时。

## 5. 协议与 SDK 差异（最容易踩）

- 协议版本：Anything Analyzer = `2024-11-05`；ARTEX 客户端 = `2025-06-18`；其余 stdio 服务由各自 SDK 协商。
- **三套互不兼容的 SDK 入口**，插件必须按服务器分别绑各自的 venv/解释器，**不要共用一个 Python 环境**：

  | 入口写法 | 使用者 |
  |---|---|
  | `from mcp.server.fastmcp import FastMCP`（mcp 1.x） | fofa、pentagi-mcp、cs-reverse-shell、cs-pent-claude-agent |
  | `from fastmcp import FastMCP`（fastmcp 4.x） | AdaptixC2_mcp |
  | `from mcp.server import MCPServer`（mcp 2.x） | trae-codex-bridge |

- 各服务的解释器现状：

  | 路径 | 关键包 |
  |---|---|
  | `${VORE_TOOLS_DIR}/other/codex-mcp/.venv/Scripts/python.exe` | mcp 2.0.0（CDP 网关也复用它） |
  | `${VORE_TOOLS_DIR}/app/pentagi-mcp/.venv/Scripts/python.exe` | mcp 1.29.0 + httpx 0.28.1（uv 造的 Py 3.12.2，**无 pip**） |
  | `${VORE_TOOLS_DIR}/app/CyberStrikeAI/venv/Scripts/python.exe` | Py 3.12.2 + mcp 2.0.0 |
  | `${HOME}/Desktop/C2/AdaptixC2_mcp/.venv` | fastmcp + websocket-client + requests |
  | fofa（**无 .venv**） | 靠 `uv run` 现场同步（`uv.lock` 存在，`uv 0.12.0`，本机有 CPython 3.12.2 满足 `.python-version=3.12`） |

- 传输形态两套都要支持：Burp 是**旧式 SSE**（`/sse` + POST 消息端点），Anything Analyzer / CyberStrikeAI / ARTEX 用 **Streamable HTTP**。只实现一套会有一半服务器连不上。
- 纯 stdio 服务的**日志纪律**：CyberStrikeAI `cmd/mcp-stdio` 明确把日志写 stderr 以免污染 JSON-RPC。插件捕获 stdio 输出时不要把 stderr 混进协议流。

## 6. 有副作用、需要人工确认的工具面

建议在插件里对这些打人工确认标记（写操作 / 不可逆 / 影响会话）：

| 服务器 | 工具 |
|---|---|
| `burp-suite-mcp` | `set_project_options`、`set_user_options`、`set_proxy_intercept_state` |
| `pentagi-mcp` | `create_flow`、`control_flow`（脚本内已强制 `confirmed_authorized=true` 与授权说明 ≥20 字） |
| `pentagi-cdp-gateway` | `lease`、`release`、`send` |
| `cyberstrikeai-*` | `manage_webshell_*`、`webshell_*`、`c2_*` 全套、`batch_task_*` 写操作 |
| `anything-analyzer` | `clear_browser_env`（会丢登录态）、`delete_session`、`replay_interactions` |
| `adaptix-c2-mcp` | `*_kill`、`rm`、`terminate_*`、`uacbybass_*`、`kerbeus_*`（票据操作） |
| `cs-reverse-shell` | 全部（起监听/接管交互壳属明确攻击动作） |

## 7. 已知坑（历史记录，别重复踩）

1. **Burp 官方代理 v1.0.0** 会把 `initialize` 转发给已初始化的 SSE 会话 → Burp 返回 `Server already initialized`。本机 `mcp-proxy-all.jar` 已打补丁（见 `${VORE_TOOLS_DIR}/app/burp-mcp-proxy/LOCAL-COMPATIBILITY-PATCH.md`），补丁只移除了那一处转发 handler。
2. **AdaptixC2 上游 MCP** 针对 Adaptix **v0.x**，对 v1.2 服务端完全不可用（不是小修）；本机已按 v1.2 协议重写传输层，原文件保留为 `AdaptixC2_mcp.legacy-v0.py`。
3. **WSL2 只转发 `::1`** —— Adaptix 必须用 `ADAPTIX_HOST=localhost`，写 `127.0.0.1` 连不上。
4. Adaptix `profile.yaml` 是 `only_password: true`，**共享口令是 `pass` 不是 `pass1`**；用 `pass1` 会走到 404 而不是"密码错误"。
5. gemini-cli 关闭后 **WebSocket 可能残留**，需在终端手工 kill 再重开。
6. `wsl.exe` 会打印 `Failed to translate ...` 噪声，解析输出时要过滤（本机 `start.ps1` 已做过滤）。
7. **CyberStrikeAI 的 `mcp.enabled` 默认 false**、`vision.enabled` 默认 false、`c2.enabled` 默认 false —— `analyze_image`、`c2_*` 工具在对应开关打开前根本不注册，工具清单里的它们属"条件可见"。

## 8. 按需启动清单（需要用户先手动启动什么，附确切命令）

> 原则：凡 `registry.yaml` 里 `require_running` 非空的条目，插件检测失败时应给出明确提示，**不要反复重试**。

### 8.1 `anything-analyzer` — 需启动 GUI 程序

```powershell
# 启动 Anything Analyzer（GUI，非命令行拉起；启动后 23816 / 8888 才在监听）
Start-Process '${HOME}/AppData/Local/Programs/Anything Analyzer\Anything Analyzer.exe'
# 探活（Expect 200 + mcp-session-id 响应头）
curl.exe -s -D - -o NUL -X POST http://127.0.0.1:23816/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"vore\",\"version\":\"1.0\"}}}"
```

### 8.2 `burp-suite-mcp` / `burp-mcp-proxy-stdio` — 需启动 Burp 并加载扩展

```powershell
# 1) 启动 Burp，Extensions → Add → Extension type: Java → 选 ${VORE_TOOLS_DIR}/other/burp-mcp-all.jar → Next
# 2) 切到 MCP tab：勾 Enabled（按需勾 "Enable tools that can edit your config"），确认 Host/Port = 127.0.0.1 / 9876
# 探活（Expect 200 或 SSE 流）
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:9876/sse
# 如需给只支持 stdio 的客户端：重建代理（可选，产物已存在）
cd ${VORE_TOOLS_DIR}/app/burp-mcp-proxy
.\gradlew.bat '-Dorg.gradle.java.home=${JAVA_HOME}' shadowJar
```

### 8.3 `pentagi-mcp` — 需先起 PentAGI docker 栈 + 配 token

```powershell
# 1) 起栈（容器 8443 → 宿主 127.0.0.1:8443）
docker compose --env-file ${VORE_TOOLS_DIR}/app/pentagi/.env -f ${VORE_TOOLS_DIR}/app/pentagi/docker-compose.yml up -d
# 查容器
docker compose --env-file ${VORE_TOOLS_DIR}/app/pentagi/.env -f ${VORE_TOOLS_DIR}/app/pentagi/docker-compose.yml ps
# 2) 浏览器打开 https://127.0.0.1:8443 自行登录 → Settings → API Tokens → 新建 token
# 3) 只把 token 文本写进 token 文件（不要写别的字符）
Set-Content -LiteralPath '${VORE_TOOLS_DIR}/app/pentagi-mcp/.pentagi-api-token' -Value '<PASTE_TOKEN>' -NoNewline -Encoding utf8
# 4) 探活（Expect ok=true，含 title/api_version）
curl.exe -s https://127.0.0.1:8443/api/v1/swagger/doc.json -k -o NUL -w "%{http_code}`n"
```

### 8.4 `cyberstrikeai-http-mcp` — 需起 Web 服务并打开 mcp 开关

```powershell
# 1) 改配置：${VORE_TOOLS_DIR}/app/CyberStrikeAI/config.yaml
#    mcp:  enabled: true   host: 127.0.0.1   port: 8081
#    （按需）vision.enabled: true + vision.model；c2.enabled: true（会注册 c2_* 工具）
# 2) 启动 Web 服务（一键脚本）
& '${VORE_TOOLS_DIR}/app/CyberStrikeAI/启动-CyberStrikeAI.cmd'
#    等价命令：cd ${VORE_TOOLS_DIR}/app/CyberStrikeAI ; .\cyberstrike-ai.exe -config config.yaml --https
# 探活（未带 token 会 401，属正常——说明 MCP 服务在监听）
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://127.0.0.1:8081/mcp -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}"
```

### 8.5 `cyberstrikeai-stdio-mcp` / `cs-reverse-shell` / `cs-pent-claude-agent` — 无需常驻服务

```powershell
# stdio 单文件入口（不需要 Web 服务在跑，只读 config.yaml）
& '${VORE_TOOLS_DIR}/app/CyberStrikeAI/cyberstrike-mcp-stdio.exe' -config '${VORE_TOOLS_DIR}/app/CyberStrikeAI/config.yaml'
# 反向 Shell（由 MCP 客户端拉起即可；目标机需能回连本机）
& '${VORE_TOOLS_DIR}/app/CyberStrikeAI/venv/Scripts/python.exe' '${VORE_TOOLS_DIR}/app/CyberStrikeAI/mcp-servers/reverse_shell/mcp_reverse_shell.py'
# Pentest Agent 包装（先把 ANTHROPIC_API_KEY 换成可用 key）
& '${VORE_TOOLS_DIR}/app/CyberStrikeAI/venv/Scripts/python.exe' '${VORE_TOOLS_DIR}/app/CyberStrikeAI/mcp-servers/pent_claude_agent/mcp_pent_claude_agent.py' --config '${VORE_TOOLS_DIR}/app/CyberStrikeAI/mcp-servers/pent_claude_agent/pent_claude_agent_config.yaml'
```

### 8.6 `pentagi-cdp-gateway` — 需 Trae 调试模式 + 账号清单 + 网关进程

```powershell
# 1) Trae SOLO CN 必须以调试端口启动（脚本会先 taskkill 再启动）
& '${VORE_TOOLS_DIR}/other/codex-mcp/start_trae_debug.bat'
#    等价命令：Start-Process '${HOME}/AppData/Local/Programs/TRAE SOLO CN\TRAE SOLO CN.exe' -ArgumentList '--remote-debugging-port=9222'
# 2) 账号清单（网关从这里读 name → cdpPort）
notepad ${HOME}/Desktop/account/accounts.json
# 3) 首次安装：初始化 token + 注册计划任务 "PentAGI CDP Gateway" + 等 /healthz 通过（30 s）
powershell -NoProfile -ExecutionPolicy Bypass -File ${VORE_TOOLS_DIR}/app/pentagi-cdp-gateway/install.ps1
# 4) 日常启动（-Foreground 才前台；不带则隐藏窗口后台起，日志落 logs\gateway.stdout.log）
powershell -NoProfile -ExecutionPolicy Bypass -File ${VORE_TOOLS_DIR}/app/pentagi-cdp-gateway/start.ps1 -Foreground
# 探活
curl.exe -s http://127.0.0.1:17896/healthz
```

### 8.7 `trae-codex-bridge` — 需 Trae 调试模式（仅 CDP 类工具）

```powershell
& '${VORE_TOOLS_DIR}/other/codex-mcp/start_trae_debug.bat'   # 仅 send_to_window / analyze_chat_ui / auto_confirm_dialog 依赖
# 邮件桥本身（send_message / get_messages / reply / get_status）不需要 Trae
# 若改走 sse：<venv python> ${VORE_TOOLS_DIR}/other/codex-mcp/server.py --transport sse --host 127.0.0.1 --port 8765
```

### 8.8 `adaptix-c2-mcp` — 需 WSL 内先起 teamserver

```powershell
# 1) 起服务端（WSL Ubuntu 内跑 adaptixserver，监听 :4321，仅 ::1）+ 可选 Qt 客户端
powershell -File ${HOME}/Desktop/C2/start.ps1 -Server
#    服务端 + 客户端一起起：.\start.ps1        停止服务端：.\start.ps1 -Stop
# 2) 探活（Expect 返回含 access_token；注意必须用 localhost，不能用 127.0.0.1）
curl.exe -sk --max-time 10 -X POST 'https://localhost:4321/endpoint/login' -H 'Content-Type: application/json' --data-binary '{\"username\":\"operator1\",\"password\":\"pass\",\"version\":\"v1.2\"}'
# 3) MCP 本体（正常由 MCP 客户端拉起）
cd ${HOME}/Desktop/C2/AdaptixC2_mcp
uv run AdaptixC2_mcp.py
# 4) 自测脚本
.\.venv\Scripts\python.exe tests\stdio_probe.py AdaptixC2_mcp.py
.\.venv\Scripts\python.exe tests\test_transport_live.py
```

### 8.9 `fofa-mcp` — 无需常驻服务，只需 key

```powershell
# 首次会现场同步依赖（.venv 尚未创建，靠 uv.lock + Python 3.12 解析）
${HOME}/.local/bin/uv.exe run --active '${VORE_CLOWN_DIR}/mcp-servers/fofa_MCP/fofa.py'
# key 在 .env（已填 3 组）或由 MCP 客户端 env 注入：
notepad '${VORE_CLOWN_DIR}/mcp-servers/fofa_MCP/.env'
```

### 8.10 不注册为 MCP、但可能要用的两项

```powershell
# ARTEX（MCP 客户端/宿主，无对外 MCP 服务；本机无预编译产物）
cd ${VORE_TOOLS_DIR}/app/ARTEX-main ; .\build.sh          # 或走 docker compose -f docker-compose.yml up -d
# 启动后：-addr :8787（HTTP API）、-proxy :8788（流量记录代理）
# openai_sec（@openai/codex-security CLI，无 MCP 入口，应走命令执行型工具）
cd ${VORE_TOOLS_DIR}/app/openai_sec ; .\node_modules\.bin\codex-security.cmd scan . --model gpt-5.6-terra --effort high
```
