# 内置技能盘点（SKILL-INVENTORY）

> 回答：**内置 skill 有哪些？还能不能新加？**
> 口径：以宿主 `@deepseek-ai/dsh-skill-filesystem` 的**真实发现规则**为准（一层深度 + frontmatter 必填），不看 `registry.yaml` 有多少行。
> **本轮已修复上一版记录的两个缺陷，并把 `Claude-Red-main` 接入内置技能。**

---

## 一、三层结构（当前实态）

| 层 | 载体 | 谁能看到 | 实测 |
|---|---|---|---|
| ① **装载面** | 宿主 `skill-filesystem` → `skill` 工具 | 模型可 `<skill>` 装载正文 | **245 个**（原 5 个） |
| ② **检索面** | 设置面板 `skills.roots` → `vore_skill_search` | 搜得到路径，正文自己 `read` | **984 条，无截断**（原 500 条截断） |
| ③ **索引面** | `skills/registry.yaml` | 只是总账，不进上下文 | 500 条（路径 500/500 存在） |

---

## 二、装载面：245 个（逐根实测，`tests/skill-discovery.mjs`）

| 根（`agent.cordis.yml` 的 `customSkillDirs`） | 可加载 | 说明 |
|---|---|---|
| `voredteam\skills` | **4** | 自研作战手册：`vore-testing-methodology`（三阶段作业法）、`vore-blackboard-ops`（黑板/覆盖账本规程）、`vore-rate-discipline`（门禁细则）、`vore-report`（报告规范） |
| `skill-roots\claude-red` | **50** | **Claude-Red-main** 带 frontmatter 的技能（联接农场，指向源目录，不改源） |
| `skill-roots\claude-red-legacy` | **28** | Claude-Red 老格式（`# SKILL` + `## Description`，无 frontmatter，宿主本来会跳过）→ 由 `sync-skill-roots.mjs` **生成规范化扁平技能**（合成 frontmatter + 原文正文） |
| `skill-roots\reverse-skill` | **43** | reverse-skill-main 的逆向纵深（ida/apk/固件/pwn/EDR/协议逆向…） |
| `skill-roots\anthropic` | **120** | Anthropic 817 个技能里**按关键词受控选取**的一批（清单可手改：`skill-roots/anthropic.selection.txt`） |
| `vendor/skills/clown`（内置） | **1** | 中文 SRC 主入口壳技能（`skills\skill\SKILL.md`） |
| 宿主默认根（`<项目>/.dsh/skills`、`<项目>/.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`） | 0 | 前两个不存在、`~/.dsh/skills` 空、`~/.agents/skills` 不存在 |

**系统提示代价**：技能目录（名字 + 截断描述）≈ **39.4 KB ≈ 11.5k tokens**（description 按 200 字截断，preset 里 `dsh-tool-skill.catalogDescriptionMaxLength: 200` 控制；调成 120 可压到 31 KB）。
该目录对每轮请求稳定 → 走 KV cache 命中，稳态成本远低于首轮。

---

## 三、检索面：984 条（`npm run skills` / 面板「扫描技能」）

```
voredteam 3 · clown 1 · anthropic 817 · reverse-skill 89 · claude-red 74 = 984    truncated = false
```

- 扫描规则：递归 **6 层**找 `SKILL.md`；单文件 ≤256 KB、单次总量 ≤**64 MB**、条数上限 **3000**。
- 四个根全部覆盖（含 Claude-Red 74 条；其 4 个超 256 KB 的大文件被单文件上限记入 skipped）。
- 与装载面的区别：这里**只出路径**，正文要 `read`；且**不保证**宿主能装载（一层规则 + frontmatter 仍适用）。

---

## 四、本轮修复的两个缺陷（上一版记录）

### 缺陷 1 ✅ 已修：外部根「指高了一层」+ Claude-Red 两层结构

宿主只认一层，而 Anthropic / reverse-skill 的技能在 `skills\` 子目录下、Claude-Red 在 `Skills\<类>\<技能>\` 两层。
**修法**：新增 `deploy/sync-skill-roots.mjs` —— 用**目录联接（junction）**把源目录摊平成
`skill-roots/<lib>/<name>/SKILL.md`，再把农场目录挂进 `customSkillDirs`；源库**只读、零改动**。
对 Claude-Red 的 28 个「无 frontmatter」旧格式技能，脚本**生成**规范化扁平技能（合成 `name`/`description` frontmatter + 原文正文）到 `skill-roots/claude-red-legacy/`，源文件同样不动。

```bash
node deploy/sync-skill-roots.mjs --check     # 报告差异（默认）
node deploy/sync-skill-roots.mjs --apply     # 建/刷新联接 + 生成规范化技能（幂等）
node deploy/sync-skill-roots.mjs --apply --prune   # 顺带清理清单外的旧联接
node deploy/sync-skill-roots.mjs --list      # 列出农场内容
```

**取舍（有意为之）**：Anthropic 817 个**不全量挂**（目录会到 96 KB ≈ 28k tokens），改为关键词受控选取 120 个；
要调整就编辑 `skill-roots/anthropic.selection.txt`（脚本以该文件为准）后重跑 `--apply`。

### 缺陷 2 ✅ 已修：检索面被上限截断

原 `SKILL_SCAN_LIMIT = 500` + `SKILL_MAX_TOTAL_BYTES = 8 MB`：
第 4 个根（reverse-skill）整根漏扫，且 Anthropic 817 个一读完就把 8 MB 预算吃光，连后面的 Claude-Red 都扫不到（实测 `skipped` 86 条「超过总字节预算」）。
**修法**：`SKILL_SCAN_LIMIT` → **3000**、`SKILL_MAX_TOTAL_BYTES` → **64 MB**（`plugins/vore-settings/lib/pure.js`）。修复后命中 984 条、`truncated=false`、`skipped=4`（4 个超单文件上限的大文件）、耗时仍在秒级。

---

## 五、还能不能新加 skill —— 四条路

| 想加什么 | 改哪里 | 生效 | 谁能看见 |
|---|---|---|---|
| **项目内新技能**（推荐） | 建 `skills/<kebab-name>/SKILL.md` | **即时**（Chokidar 监听 + 写文件走 `fs/observed` 快路径） | 装载面 + 检索面 |
| **外部技能库** | 在 `deploy/sync-skill-roots.mjs` 的 `SOURCES` 加一条（lib 名 + 源目录 + `shape`）→ `--apply` → 把农场目录加进 `customSkillDirs` | 重装预设 / 重启 dsh web | 装载面 |
| **只在面板加根** | 设置面板「技能管理」一行一个根 | 立即 | **只有检索面** ⚠️ 装载面看不到，要两处都配 |
| **只登记总账** | `skills/registry.yaml` 加一条（`id/name/path/kind/stage/desc`） | 立即 | 都不是，纯索引 |

### 格式硬要求（不满足就静默不生效）

- frontmatter **必须有** kebab-case 的 `name` 与 `description`（Claude-Red 的 28 个老格式就是这么被挡掉的 → 已用规范化绕过）。
- 只认**一层**：`<root>/<name>/SKILL.md` 或 `<root>/<name>.md`；**不递归**（嵌套 `**/SKILL.md` 一律不认）。
- `disable-model-invocation: true` 只留给用户命令；`user-invocable: false` 反向；两者被无效值污染时**整条排除**（fail-closed）。
- 技能根不能是盘符根或一级目录（`rootRejectReason` 拒），单文件 ≤256 KB。

### 名称冲突与遮蔽顺序（rank）

`project-dsh(100) → project-agents(200) → custom(300) → user-dsh(400) → user-agents(500)`：**靠前的根赢**，
所以自研技能用同名 id 可以遮蔽外部库的同名技能（这也是把农场放在 `custom` 而非用户根的原因）。

---

## 六、复现

```bash
cd <voredteam 仓库根>
npm run skills                       # 逐根装载面盘点 + registry 500 条对照
node tests/skill-discovery.mjs       # 一层规则 + frontmatter 校验（含联接跟随）
node tests/skill-catalog-size.mjs    # 系统提示技能目录体积（--cap N 试算）
node deploy/sync-skill-roots.mjs --check  # 农场与源库的差异
```
