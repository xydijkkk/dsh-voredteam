# 技能库说明（skills/registry.yaml 导读）

`registry.yaml` 由 `deploy/gen-skill-registry.mjs`（`npm run registry:gen`）从**仓库内置**的技能目录生成，
共 **247 条**（246 个 `kind: skill` + 1 个 `kind: knowledge`），`path` 全部是**仓库相对路径**（可发布，不含任何本机位置）：

| 来源 | 条数 | 位置 | 许可 |
|---|---|---|---|
| 自研作战手册 | 4 | `skills/` | 本项目 MIT |
| Claude-Red-main | 50 | `vendor/skills/claude-red/` | MIT（SnailSploit / Kai Aizen） |
| Claude-Red 老格式规范化副本 | 28 | `vendor/skills/claude-red-legacy/` | 同上（宿主只认带 frontmatter 的一层目录，故生成扁平副本） |
| reverse-skill-main | 43 | `vendor/skills/reverse-skill/` | MIT（zhaoxuya520） |
| Anthropic-Cybersecurity-Skills | 120 | `vendor/skills/anthropic/` | Apache-2.0（选取清单 `vendor/anthropic.selection.txt`） |
| clown-src-6k-skill | 1 | `vendor/skills/clown/` | **未附许可证，见 `vendor/THIRD-PARTY.md`** |

> 三个第三方库是**真实文件内置**（不是指向本机的目录联接）。刷新方式：`npm run vendor:skills:apply`
> （源库位置写在 `deploy/vendor-sources.local.json`，该文件不随仓库发布）。

`kind: skill` = 宿主 `skill` 工具能装载的（一层 `<name>/SKILL.md` 或带 frontmatter 的扁平 `.md`）；
`kind: knowledge` = 只能 `read` 的参考件。`stage` 是按名字/描述推的粗分类标签，仅供检索。

## 该常驻的几个（改行为，不改知识量）

| 技能 | 位置 | 作用 |
|---|---|---|
| `vore-blackboard-ops` | `skills/vore-blackboard-ops/SKILL.md` | 黑板三类对象写法、派单四要素、意图认领与结论、死路登记 |
| `vore-rate-discipline` | `skills/vore-rate-discipline/SKILL.md` | 唯一门禁细则：禁 DDoS / 禁爆破 / 模糊测试智能化低频 |
| `vore-report` | `skills/vore-report/SKILL.md` | 报告七项结构、高危判定、证据要求 |
| `reverse-skill-router` | `vendor/skills/reverse-skill/SKILL.md` | 逆向 / 渗透 / CTF / 移动 / 固件的总路由 |
| `clown-src-skill` | `vendor/skills/clown-src-skill/SKILL.md` | 中文 SRC 实战主入口（短表开场、价值矩阵、续挖规则） |

## 结构性缺口（子 agent 定义已按此配置）

- 内网 / 云 / 逆向三块主要靠 Anthropic 与 reverse-skill 两个库填充（120 + 43 条），
  所以 `internal-network` / `cloud-ai` / `app-reverse` 三个子 agent 的纪律里**强制要求先读对应技能**，不要凭记忆打。
- 免杀类内容最少：命中率低时优先走 `reverse-skill` 的 EDR 绕过与 `claude-red` 的 shellcode 两节。

## 治理信息（程序与 agent 都要尊重）

- `clown-src-6k-skill` 未附许可证文件：**发布前请确认授权**；不允许再分发就删除 `vendor/skills/clown/`
  并从 `modes/network-security/agent.cordis.yml` 的技能根里去掉。
- 第三方库里的 `SKILL.md` **不要改动**（刷新会被覆盖）；要写自己的规则请放 `skills/`。
- 需要登记**本机独有**的外部资产（不随仓库发布）时，写在 `skills/registry.local.yaml`（已 gitignore），
  生成脚本不会碰它。
- 技能目录会渲染进每轮 system prompt：当前内置 245 个可装载技能、目录体积约 39 KB（单条描述按 200 字截断，
  由预设里 `dsh-tool-skill` 的 `catalogDescriptionMaxLength` 控制）。想缩小检索面就减少 `vendor/skills/` 下的目录。
