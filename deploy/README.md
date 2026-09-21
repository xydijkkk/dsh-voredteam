# deploy —— dsh-voredteam 一键部署

把本项目的**预设模式**与**全部子插件**挂进 DSH，并做成可重复执行的校验/应用流程。

## 三种用法

```bash
node deploy/deploy.mjs              # 默认 = --check：离线校验，逐项打 ✓/✗，不写盘
node deploy/deploy.mjs --dry-run    # 预演：打印将要发生的变更（含备份文件名），不写盘
node deploy/deploy.mjs --apply      # 幂等写入：建/修预设 junction + 备份并更新 profile package.json
```

可选：`--home <path>`（默认 `$DSH_HOME`，其次 `~/.dsh`）、`--profile <name>`（默认 `web`）、
`--mode <id>`（默认 `network-security`）、`--only preset|profile`（只处理一类）。
退出码：`0` = 校验通过/已应用；`1` = 存在 ✗ 项。

## 它装了什么

| 装到哪 | 什么 | 说明 |
|---|---|---|
| `<DSH_HOME>/.agent-presets/network-security` | **实体目录**（源模板的副本，`{{PROJECT_ROOT}}` 已渲染成绝对路径） | 让 DSH 发现「网络安全模式」预设；**不能用 junction**——宿主 `scanRoot` 用 `Dirent.isDirectory()` 过滤，链接会被静默跳过 |
| `<DSH_HOME>/profiles/web/package.json` | `dependencies["<pkg>"] = "link:<插件绝对路径>"` | 逐个挂载 `plugins/*/package.json`（**自动发现**，不硬编码插件名） |
| 同上 | `dsh.profile.bundles` 追加 `<pkg>` | 保留原有顺序，新插件追加末尾 |
| `<DSH_HOME>/profiles/<profile>/node_modules/<scope>/<name>` | junction → 插件目录（**变更 3**） | 与 pnpm 处理 `link:` 依赖等价；建好后**无需 `pnpm install` 也能被 loader 解析**（已存在且指向正确则跳过） |
| 项目根 | `lib/index.js` + `cordis.patch.yml` | 合集入口包 `@dsh-external/dsh-voredteam`，保证包可被加载 |

`--apply` 会改的文件与备份：

- 新建/修复：`<DSH_HOME>/.agent-presets/<mode>`（已指向本项目则**跳过**；指向别处才先删再建）
- 新建/修复：`<DSH_HOME>/profiles/<profile>/node_modules/...` 链接（变更 3；已就绪则打印「均已就绪，无需改动」）
- 改前备份：`<DSH_HOME>/profiles/<profile>/package.json.bak-voredteam-<YYYYMMDD-HHMMSS>`
- 再写：`<DSH_HOME>/profiles/<profile>/package.json`（JSON 缩进 2 空格；link 值用 `\\` 转义，保持合法 JSON）

## 应用之后

```bash
cd "<DSH_HOME>/profiles" && pnpm install   # 可选：变更 3 已建立 node_modules 链接时可跳过；跑一次可让 lockfile 记账一致
```
然后**重启 dsh web**。宿主平面插件（`lib/index.js` 被宿主加载）必须重启才生效；
客户端面板（声明了 `dsh.client` 的插件）在变更 3 已建立链接的情况下，重启即可加载。

## 卸载

1. 编辑 `<DSH_HOME>/profiles/<profile>/package.json`：删掉 `dependencies` 里所有 `vore-*` 项，
   以及 `dsh.profile.bundles` 里对应的包名（`@dsh-external/dsh-voredteam` 与各 `@dsh-external/vore-*`）。
2. 删除预设目录：`Remove-Item -Recurse -Force "<DSH_HOME>\.agent-presets\network-security"`（它是本项目落盘的副本，删掉不影响仓库里的模板）。
3. `cd "<DSH_HOME>/profiles" && pnpm install`，再重启 dsh web。
4. 需要回滚时用同目录下的 `package.json.bak-voredteam-<时间戳>` 覆盖回去。

## 注意事项

- **宿主插件改动要重启 dsh web**；客户端面板改动在 `pnpm run dev:web` 运行时可热更（否则也要重启）。
- `--check` 与 `--dry-run` 只读，可随时跑；`--apply` 只在确有变更时写盘，重复跑不会产生重复条目。
- 插件目录被删除后遗留的陈旧记账（指向本项目但包已不存在）**只报告、不自动删**，请人工确认后移除。
- 脚本零第三方依赖，需 Node ≥ 22。预设落盘是**复制 + 模板渲染**（不是链接）；只有插件依赖链接（变更 3）用 `fs.symlinkSync(…, "junction")`，Windows 上不需要管理员权限。
