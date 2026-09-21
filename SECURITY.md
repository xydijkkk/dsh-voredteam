# 使用边界与安全声明

## 只用于**你有明确授权**的目标

dsh-voredteam 是一套**授权渗透测试**的作业与记录工具（黑板 + 作业法 + 面板）。它不授予任何授权：

- 只对你**已经拿到书面授权**的资产使用（SRC 授权范围表、甲方授权书、自己的资产）；
- 授权范围之外的资产一律不碰；范围表里的"硬排除"主机要写进 `bb_project_init` 的 origin 与首条 hint，让每个子 agent 都看得见；
- 报告与证据按你的合同/法规要求脱敏后再外发（本项目默认把原始报文落 `evidence/`，不自动脱敏）。

## 门禁是**安全下限**，不是许可

`vore-guard` 会在命令执行前拦掉三类动作：

1. **DDoS 特征**（洪水、压测、连接耗尽、并发打满）；
2. **在线爆破**（`hydra` / `kerbrute` / `netexec` / `nxc` / `--password-file` 等；离线 `hashcat`/`john` 不拦）；
3. **未声明限速的模糊测试**（ffuf/dirsearch/gobuster/wfuzz/nuclei 必须带显式低频参数；nmap 大范围必须带合规 `--max-rate`）。

它只覆盖**已知命令形态**：通过 MCP 工具、脚本、编码变形绕过去是完全可能的。**放行 ≠ 授权**，判定责任在人。

## 密钥与数据

- 测绘 API（FOFA / Shodan）与其它密钥只存在**本机** `~/.dsh/voredteam/settings.json`，仓库里只有 `${VAR}` 占位符；设置面板读取时只回显掩码；
- 黑板库 `~/.dsh/voredteam/blackboard.db` 含测试原始证据，**不要**提交到任何仓库（已在 `.gitignore` 里）；
- 删除面板前该库会自动落一份 `blackboard.backup-<时间>.db` 一致性快照，里面同样是真实数据 —— 外发前先清理。

## 第三方内容

`vendor/skills/` 是内置的**第三方技能库**，版权与许可证归各自作者（见 `vendor/THIRD-PARTY.md` 与 `vendor/licenses/`），其中 `clown` 一项未标注许可证。
再分发本仓库时请自行核对这些许可；只发布本项目自身代码可执行：

```bash
git rm -r --cached vendor/skills && echo "vendor/skills/" >> .gitignore
```

## 漏洞与问题反馈

发现本项目的安全问题（例如门禁可被轻易绕过、面板可被注入、密钥可能泄漏）请开 issue，或在 issue 里只写"复现步骤 + 影响"，**不要**贴真实目标数据与真实密钥。
