# 出处与第三方声明（NOTICE）

本文件是**声明与致谢**，不改变 `LICENSE` 的授权条款（本项目自身代码 = MIT）。

## 本项目自身

`plugins/`、`agents/`、`skills/`（自研 4 个）、`modes/`、`deploy/`、`tests/`、`docs/`、`mcp/` 的结构与描述 —— MIT，见 `LICENSE`。

## 设计参考（只借鉴范式与组织形态，不含其代码）

- 范式（黑板 + Fact/Intent/Hint + reason/explore 循环）借鉴自公开的**黑板式状态空间搜索**类开源编排项目（其许可归各自作者）。
- 组织形态（安全模式 + 多专业子代理 + 门禁分层）借鉴自公开的**多代理安全编排**类项目（Apache-2.0 / MIT 均有）的公开思路。

本仓库与上述思路来源**没有代码级复制关系**；若你发现任何一处逐字相同的内容而缺少署名，请开 issue，我会补署名或改写。

## 内置的第三方技能库（`vendor/skills/`）

按来源与许可证逐项登记：见 **`vendor/THIRD-PARTY.md`** 与 **`vendor/licenses/`**。

- `claude-red`（50）· `claude-red-legacy`（28，规范化扁平副本）· `reverse-skill`（43）· `anthropic`（受控选取 120）· `clown`（1，**未标注许可证**）；
- 再分发本仓库前请自行核对这些许可；只发布本项目自身代码可执行：
  `git rm -r --cached vendor/skills && echo "vendor/skills/" >> .gitignore`。

## 内置 MCP 注册表（`mcp/registry.yaml`）

条目指向的是**第三方工具/服务**（如 C2 框架、资产测绘 API、抓包与逆向工具）的调用方式，不包含其代码或二进制；名称与工具清单仅用于说明如何接入。相关工具的使用请遵守其各自许可与当地法律。

## 明确不在本仓库内的东西

- `vore-webshell`（WebShell 管理面板）**已被有意移除**：C2/后渗透改由内置的 **AdaptixC2 MCP** 承担。
  `tests/acceptance.mjs` 与 `tests/verify-all.mjs` 里保留了「插件目录中不得存在 vore-webshell」的**反向断言**，那是回归守卫，不是残留引用。
- 任何真实目标的测试数据、证据与密钥：只在个人机器上的 `~/.dsh/voredteam/`（`blackboard.db` / `settings.json`），已在 `.gitignore` 中排除。
