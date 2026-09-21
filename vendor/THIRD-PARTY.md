# 第三方技能库（vendor/skills/）

本项目**内置**了以下第三方技能库的内容（复制到 `vendor/skills/`，非目录联接），以便发布后自包含：

| 目录 | 来源 | 许可 | 技能数 |
|---|---|---|---|
| `vendor/skills/claude-red` | Claude-Red-main (SnailSploit / Kai Aizen, MIT) | LICENSE（见 vendor/licenses/） | 50 |
| `vendor/skills/reverse-skill` | reverse-skill-main (zhaoxuya520, MIT) | LICENSE（见 vendor/licenses/） | 43 |
| `vendor/skills/anthropic` | Anthropic-Cybersecurity-Skills-1.3.0 (Apache-2.0)；共 817 个技能，选取 120 个 | LICENSE（见 vendor/licenses/） | 120 |
| `vendor/skills/clown-src-skill` | clown-src-6k-skill（**未附许可证文件**） | **未标注** | 1 |

各库许可证原文见 `vendor/licenses/`。若你重新分发本项目，请保留本文件与许可证副本。

> ⚠ `clown-src-skill` 未附许可证文件，发布前请确认授权；不确定就删除该目录并从 `modes/network-security/agent.cordis.yml` 的技能根里去掉。
