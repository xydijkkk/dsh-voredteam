// vore-blackboard store —— 黑板书数据层（node:sqlite DatabaseSync，同步 API）。
//
// 图模型（状态空间搜索范式）：
//   facts    已确认的客观事实（含虚拟根 origin 与虚拟终点 goal 各一行）
//   intents  待探索方向：一条 intent = 一条边（from[] 事实集合 → to 事实 / 或 dead）
//   intent_sources  intent ← facts 的边起点集合（多 from 即超边）
//   hints    人类注入的判断（随时可写，读图时全量吸收）
// 一致性：图 append-only，事实只能由 conclude 新建，故结构上不成环；无需环检测。

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_DB = path.join(os.homedir(), ".dsh", "voredteam", "blackboard.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, session_id TEXT, cwd TEXT, title TEXT,
  origin TEXT, goal TEXT, status TEXT DEFAULT 'active',
  phase TEXT DEFAULT 'P1',          -- 五阶段：P1 起点 / P2 浅层 / P3 中间层 / P4 深层 / P5 成果
  asset_epoch INTEGER DEFAULT 0,    -- 资产登记次数（每新增一个资产 +1）；P1 饱和看它
  phase_epoch INTEGER DEFAULT -1,   -- 上次推进阶段时的 asset_epoch
  sources_done TEXT DEFAULT '[]',   -- 显式标记"已穷尽"的资产来源类别
  phase_note TEXT,                  -- 跳阶段时的依据（force 才写）
  recon_rounds INTEGER DEFAULT 0,   -- 已确认的资产收集轮数
  recon_last_added INTEGER DEFAULT -1, -- 上一轮新增资产数（-1 = 还没收过轮）
  reflow_pending INTEGER DEFAULT 0, -- 1 = 有回灌未收轮（新资产出现 → 饱和判定作废，须再收一轮）
  reflow_count INTEGER DEFAULT 0,   -- 累计回灌资产数
  reflow_source TEXT,               -- 最近一次回灌来源（js-reverse / dir-fuzz / config / cert …）
  recon_mark INTEGER DEFAULT 0,     -- 本轮起点 asset_epoch
  recon_note TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS facts (
  id TEXT NOT NULL, project_id TEXT NOT NULL, description TEXT NOT NULL,
  category TEXT DEFAULT 'fact', evidence TEXT, confidence TEXT DEFAULT 'confirmed',
  source_intent TEXT, deprecated INTEGER DEFAULT 0, created_at TEXT NOT NULL,
  severity TEXT, target TEXT, poc TEXT, fix TEXT, status TEXT,
  PRIMARY KEY (project_id, id),      -- 主键必须**含 project_id**：f001 是每个项目各自从 001 开始编的
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS intents (
  id TEXT NOT NULL, project_id TEXT NOT NULL, description TEXT NOT NULL,
  domain TEXT, priority INTEGER DEFAULT 5, status TEXT DEFAULT 'open',
  worker TEXT, claimed_at TEXT, to_fact TEXT, dead INTEGER DEFAULT 0,
  note TEXT, creator TEXT, created_at TEXT NOT NULL, concluded_at TEXT,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS intent_sources (
  intent_id TEXT NOT NULL, project_id TEXT NOT NULL, fact_id TEXT NOT NULL,
  PRIMARY KEY (project_id, intent_id, fact_id)
);
CREATE TABLE IF NOT EXISTS hints (
  id TEXT NOT NULL, project_id TEXT NOT NULL, content TEXT NOT NULL,
  creator TEXT DEFAULT 'Human', created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
-- 资产清单：覆盖率的分母。一轮作业"测得全不全"由它决定，而不是由模型自述决定。
CREATE TABLE IF NOT EXISTS assets (
  id TEXT NOT NULL, project_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- domain|subdomain|ip|port|service|url|endpoint|js|repo|cred|cloud|app|other
  value TEXT NOT NULL,             -- 规范化唯一值（域名 / IP:端口 / URL / 接口路径 / JS 文件 URL）
  label TEXT, tech TEXT,
  priority INTEGER DEFAULT 3,      -- 1..5，深层排序（<3 视为不要求深层，登记时必须给理由）
  s2 TEXT DEFAULT 'pending',       -- 浅层汇总位：由 info 检查矩阵自动同步（pending|doing|done）
  s3 TEXT DEFAULT 'pending',       -- 深层汇总位：由 deep 检查矩阵自动同步（pending|doing|done|na）
  evidence TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_uniq ON assets(project_id, kind, value);
-- 检查矩阵：把"浅层/中间层/深层到底测了什么"从模型自述变成可查询的数据。
--   stage=info   浅层：逐项信息采集（jsrev/lang/middleware/os/arch/dirs/paths/cert/dns/waf/third/sec…）
--   stage=verify 中间层：对浅层每一项做核验（ok=与行为一致 / wrong=浅层采错了 / unknown=没法核验）
--   stage=owasp  中间层：OWASP Top 10 (2021) A01–A10 逐类测试
--   stage=deep   深层：逐资产漏洞验证（unauth/authz/inj/ssrf/upload/logic/race/deser）
CREATE TABLE IF NOT EXISTS asset_checks (
  project_id TEXT NOT NULL, asset_id TEXT NOT NULL,
  stage TEXT NOT NULL, key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  evidence TEXT, note TEXT, reviewed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, asset_id, stage, key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checks_project ON asset_checks(project_id, stage, status);
-- 未测面账本：**没做的面必须留痕**（死路只记"试过没成"，这里记"根本没做/做不了"）
CREATE TABLE IF NOT EXISTS untested (
  id TEXT NOT NULL, project_id TEXT NOT NULL,
  surface TEXT NOT NULL, why TEXT NOT NULL, stage TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS scoped_counters (
  project_id TEXT NOT NULL, kind TEXT NOT NULL, value INTEGER DEFAULT 0,
  PRIMARY KEY (project_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_facts_project ON facts(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intents_project ON intents(project_id, status);
CREATE INDEX IF NOT EXISTS idx_intent_sources ON intent_sources(intent_id);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, kind);
`;

/**
 * 六阶段作业法（**每一层先核实上一层的产出，再做本层的工作**）：
 *   P1 起点      资产收集（直到连续一轮 0 新增的饱和）
 *   P2 信息收集  **信息全采**：逐资产把能拿到的一切信息采集落库（不是扫一眼，是穷尽画像）
 *   P3 浅层      ①核实信息收集的工作（verifyInfo：采到的是不是真的 / 全不全）②浅层测试（shallow：8 项）
 *   P4 中间层    ①核实浅层的工作（verifyShallow）②对每个资产做 OWASP Top 10 (2021) A01–A10
 *   P5 深层      ①完整读取已有全部信息 ②核验中间层是否有误 ③逐资产漏洞验证（deep：8 类）
 *   P6 成果      证据索引 + 报告 + 未测面声明 + 复核
 */
export const PHASES = ["P1", "P2", "P3", "P4", "P5", "P6"];
export const PHASE_LABEL = {
  P1: "起点（资产收集直到饱和）",
  P2: "信息收集（逐资产信息全采：JS 逆向 / 语言 / 代码 / 中间件 / OS / 架构 / 目录 / 路径 / 证书 / DNS / WAF / 第三方）",
  P3: "浅层（核实信息收集的工作 + 浅层测试：指纹验证 / 路径真值 / 参数面 / 鉴权边界 / 错误泄露 / 暴露面 / 低频模糊）",
  P4: "中间层（核实浅层的工作 + OWASP Top 10 A01–A10 逐类测试）",
  P5: "深层（读全量信息 + 核验中间层 + 逐资产漏洞验证：未鉴权 / 越权 / 注入 / 上传 / 逻辑 / 竞态）",
  P6: "成果（证据索引 + 报告 + 未测面 + 复核）",
};
/** 检查矩阵的六个 stage（与六阶段一一对应；后四个按 priority 收敛）。 */
export const CHECK_STAGES = ["info", "verifyInfo", "shallow", "verifyShallow", "owasp", "deep"];
export const CHECK_STAGE_LABEL = {
  info: "信息收集",
  verifyInfo: "浅层·核实信息收集",
  shallow: "浅层·浅层测试",
  verifyShallow: "中间层·核实浅层",
  owasp: "中间层·OWASP Top 10",
  deep: "深层·漏洞验证",
};
/** 只有 priority ≥ 3 的资产要求跑后四个矩阵（低优先资产登记时必须写理由 —— 可审计的降级，不是偷偷免测）。 */
export const STAGES_FOR_ALL = ["info", "verifyInfo"];
export const STAGES_FOR_DEEP = ["shallow", "verifyShallow", "owasp", "deep"];
/** P2 信息收集的必采信息项（所有资产都要） */
export const INFO_BASE = ["tech", "lang", "middleware", "os", "arch", "dirs", "paths", "cert", "dns", "waf", "third", "sec"];
export const INFO_KEY_LABEL = {
  tech: "技术栈指纹", lang: "后端语言/框架", middleware: "中间件/网关", os: "操作系统", arch: "站点架构（前后端分离/CDN 回源/多活）",
  dirs: "目录枚举（低频）", paths: "路径/接口/参数清单", cert: "TLS 证书与 SAN", dns: "解析/CNAME/历史",
  waf: "WAF/CDN 判定", third: "第三方依赖与 SDK", sec: "安全头与 Cookie 属性",
  jsrev: "JS 逆向（接口/密钥/签名/路由/加密）", params: "参数面（类型/枚举/边界）", banner: "服务 banner 与版本",
  client: "客户端产物与加固", repo: "仓库/CI/构建", cred: "凭据只读有效性", cloud: "云资源（桶/元数据/权限）", sub: "子域与接管线索",
  fp: "指纹/版本行为验证", pathTruth: "目录/路径真值（404/SPA 兜底排除）", authEdge: "鉴权边界快照（无凭据 vs 有凭据）",
  errLeak: "错误页与信息泄露", expose: "暴露面存在性（.git/备份/swagger/actuator/控制台）",
  lowFuzz: "低频模糊小样本（≤50、限速、去重、命中即停）", compHint: "组件版本→公开漏洞线索",
};
/** 按资产类别追加的必采项（信息收集）。 */
export const INFO_EXTRA = {
  js: ["jsrev", "params"], url: ["params"], endpoint: ["params"],
  ip: ["banner"], port: ["banner"], service: ["banner"],
  app: ["client"], repo: ["repo"], cred: ["cred"], cloud: ["cloud"],
  domain: ["sub"], subdomain: ["sub"],
};
/** P3 浅层测试的 8 项（priority ≥ 3 的资产都要；verifyShallow 用同一套 key 核实它们）。 */
export const SHALLOW_CLASSES = ["fp", "pathTruth", "params", "authEdge", "errLeak", "expose", "lowFuzz", "compHint"];
/** OWASP Top 10 (2021) */
export const OWASP_TOP10 = [
  { key: "A01", name: "Broken Access Control（访问控制失效）" },
  { key: "A02", name: "Cryptographic Failures（加密失败）" },
  { key: "A03", name: "Injection（注入）" },
  { key: "A04", name: "Insecure Design（不安全设计）" },
  { key: "A05", name: "Security Misconfiguration（安全配置错误）" },
  { key: "A06", name: "Vulnerable and Outdated Components（易受攻击与过时组件）" },
  { key: "A07", name: "Identification and Authentication Failures（身份识别与认证失败）" },
  { key: "A08", name: "Software and Data Integrity Failures（软件与数据完整性失败）" },
  { key: "A09", name: "Security Logging and Monitoring Failures（安全日志与监控失败）" },
  { key: "A10", name: "SSRF（服务端请求伪造）" },
];
export const OWASP_KEYS = OWASP_TOP10.map((x) => x.key);
/** 深层必测类别（priority ≥ 3 的资产都要） */
export const DEEP_CLASSES = ["unauth", "authz", "inj", "ssrf", "upload", "logic", "race", "deser"];
export const DEEP_LABEL = {
  unauth: "未鉴权/缺鉴权", authz: "越权（水平/垂直）", inj: "注入类", ssrf: "SSRF",
  upload: "上传/导入导出", logic: "业务逻辑/状态机", race: "竞态/并发", deser: "反序列化",
};
/** 各 stage 的合法状态；核实类用 ok/wrong/unknown，其余用 done/hit/na。 */
export const CHECK_STATUS = {
  info: ["pending", "doing", "done", "na"],
  verifyInfo: ["pending", "ok", "wrong", "unknown", "na"],
  shallow: ["pending", "doing", "done", "hit", "na"],
  verifyShallow: ["pending", "ok", "wrong", "unknown", "na"],
  owasp: ["pending", "doing", "done", "hit", "na"],
  deep: ["pending", "doing", "done", "hit", "na"],
};
/** 这些状态必须给理由（防止用 na 把覆盖率刷满） */
export const NEEDS_NOTE = {
  info: ["na"], verifyInfo: ["wrong", "unknown", "na"], shallow: ["na"],
  verifyShallow: ["wrong", "unknown", "na"], owasp: ["na"], deep: ["na"],
};
/** 只读/核实类的 stage（它们的"完成"取值不是 done） */
export const VERIFY_STAGES = ["verifyInfo", "verifyShallow"];
export const VERIFY_OK_STATES = ["ok", "wrong", "unknown", "na"];
export const WORK_OK_STATES = ["done", "hit", "na"];
/** 命中类状态必须给证据 */
export const NEEDS_EVIDENCE = ["hit"];

/** 某类资产在某个 stage 需要覆盖的 key 列表（六张矩阵的必查集）。 */
export function requiredKeys(kind, stage) {
  switch (stage) {
    case "owasp": return OWASP_KEYS;
    case "deep": return DEEP_CLASSES;
    case "shallow":
    case "verifyShallow": return SHALLOW_CLASSES;
    default: return [...INFO_BASE, ...(INFO_EXTRA[kind] ?? [])];   // info / verifyInfo
  }
}
/** 该 stage 是否只对 priority ≥ 3 的资产要求。 */
export const stageNeedsDeepPriority = (stage) => STAGES_FOR_DEEP.includes(stage);
export const PHASE_ORDER = PHASES;
/** P1 饱和判定要比对的资产来源类别。 */
export const SOURCE_CLASSES = ["domain", "subdomain", "ip", "port", "url", "endpoint", "js"];
/** priority ≥ 该值的资产才要求跑浅层/中间层/深层（低于它的必须给理由，见 upsertAssets）。 */
export const DEFAULT_DEEP_MIN_PRIORITY = 3;
/** 资产类别合法值。 */
export const ASSET_KINDS = ["domain", "subdomain", "ip", "port", "service", "url", "endpoint", "js", "repo", "cred", "cloud", "app", "other"];

export function utcnow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * 旧库就地升级：`CREATE TABLE IF NOT EXISTS` 不会给已存在的表补列，也不会改主键，
 * 所以 ① 阶段/资产字段显式 ALTER；② 单列主键的旧表整表重建。两步都幂等。
 *
 * 为什么必须重建主键：facts/intents/hints/assets 的 id 是**按项目**从 001 编的
 * （scoped_counters 按 (project_id, kind) 计数），可 id 却是全局主键 ——
 * 于是第二个项目连 origin/goal 两行都插不进去（UNIQUE constraint failed: facts.id），
 * 而且 createProject 不带事务，会在 projects 表里留下一个**没有事实的幽灵项目**；
 * 作战面板取"最近更新的项目"时正好读到它，表现为"面板什么都没有"。
 */
function migrate(db) {
  // **先整表重建，再补列**：rebuild() 是按 SCHEMA 的新定义建表的，
  // 若先 ALTER 补了列再重建，那些列会被新定义覆盖掉（这个坑踩过：review_status 丢列）。
  rescopeIds(db);
  const cols = (table) => {
    try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)); } catch { return new Set(); }
  };
  const add = (table, name, ddl) => {
    if (!cols(table).has(name)) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch { /* 并发下已加上 */ } }
  };
  add("projects", "phase", "phase TEXT DEFAULT 'P1'");
  add("projects", "asset_epoch", "asset_epoch INTEGER DEFAULT 0");
  add("projects", "phase_epoch", "phase_epoch INTEGER DEFAULT -1");
  add("projects", "sources_done", "sources_done TEXT DEFAULT '[]'");
  add("projects", "phase_note", "phase_note TEXT");
  add("projects", "recon_rounds", "recon_rounds INTEGER DEFAULT 0");
  add("projects", "recon_last_added", "recon_last_added INTEGER DEFAULT -1");
  add("projects", "reflow_pending", "reflow_pending INTEGER DEFAULT 0");
  add("projects", "reflow_count", "reflow_count INTEGER DEFAULT 0");
  add("projects", "reflow_source", "reflow_source TEXT");
  add("projects", "recon_mark", "recon_mark INTEGER DEFAULT 0");
  add("projects", "recon_note", "recon_note TEXT");
  add("projects", "untested_declared", "untested_declared INTEGER DEFAULT 0");
  add("projects", "phase_scheme", "phase_scheme INTEGER DEFAULT 0");   // 0=旧的 5 阶段命名，1=六阶段命名
  add("facts", "review_status", "review_status TEXT");          // confirm | challenge
  add("facts", "review_evidence", "review_evidence TEXT");
  add("facts", "reviewed_at", "reviewed_at TEXT");
  upgradeScheme(db);
}

/**
 * 一次性升级历史数据到**六阶段 / 六矩阵**命名：
 *   阶段：旧 P2 浅层(信息全采)→P3 浅层；旧 P3 中间层→P4；旧 P4 深层→P5；旧 P5 成果→P6（P1 不变）
 *   矩阵：旧 stage='verify'（核实信息收集）→ 'verifyInfo'
 * 用 projects.phase_scheme 做一次性标记，避免每次开库都重复映射。
 */
function upgradeScheme(db) {
  const needs = db.prepare("SELECT COUNT(*) c FROM projects WHERE COALESCE(phase_scheme,0) = 0").get().c;
  if (!needs) return;
  db.exec("BEGIN");
  try {
    // **一条 CASE 语句**完成映射：逐条 UPDATE 会级联（P3→P4 之后又被 P4→P5 命中，一路滚到 P6）。
    db.prepare(
      `UPDATE projects
          SET phase = CASE phase WHEN 'P2' THEN 'P3' WHEN 'P3' THEN 'P4' WHEN 'P4' THEN 'P5' WHEN 'P5' THEN 'P6' ELSE phase END,
              phase_scheme = 1
        WHERE COALESCE(phase_scheme,0) = 0`
    ).run();
    db.prepare("UPDATE asset_checks SET stage = 'verifyInfo' WHERE stage = 'verify'").run();
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    throw new Error(`黑板库六阶段升级失败（数据未改动）：${e?.message ?? e}`);
  }
}

/** 把"id 单列主键"的旧表重建为"主键含 project_id"。（数据原样搬运，WAL 下安全。） */
function rescopeIds(db) {
  const oldPk = (table) => {
    let sql = null;
    try { sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql ?? null; } catch { return false; }
    if (!sql) return false;                       // 表不存在 → 无需迁移
    const m = /PRIMARY KEY\s*\(([^)]*)\)/i.exec(sql);
    return !m || !m[1].includes("project_id");    // 主键里没有 project_id 就是旧表
  };
  const targets = ["facts", "intents", "intent_sources", "hints", "assets"].filter(oldPk);
  if (targets.length) rebuild(db, targets);
  // 幽灵项目（建项目时中途失败，只剩 projects 一行）补回 origin/goal 两行，图才画得出来
  for (const p of db.prepare("SELECT id, origin, goal FROM projects").all()) {
    for (const [id, category, text] of [["origin", "origin", `任务起点：${p.origin ?? ""}`], ["goal", "goal", `任务目标：${p.goal ?? ""}`]]) {
      const has = db.prepare("SELECT 1 FROM facts WHERE project_id = ? AND id = ?").get(p.id, id);
      if (!has) {
        db.prepare("INSERT INTO facts (id, project_id, description, category, confidence, created_at) VALUES (?,?,?,?,?,?)")
          .run(id, p.id, text, category, "confirmed", utcnow());
      }
    }
  }
}

/**
 * 整表重建：旧表改名 → **按 SCHEMA 里的新定义**建表 → 搬共有列的数据 → 丢旧表。
 * 注意必须是"新定义"：直接复用旧表的 DDL 只会把老主键原样搬回来（这个坑踩过）。
 */
function rebuild(db, targets) {
  const newDdl = (table) => {
    const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`).exec(SCHEMA);
    if (!m) throw new Error(`SCHEMA 里找不到 ${table} 的定义`);
    return m[0];
  };
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN");
    for (const t of targets) {
      const oldCols = columns(t);
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}__old`);
      db.exec(newDdl(t));
      const names = columns(t).filter((n) => oldCols.includes(n));   // 只搬新旧表都有的列
      db.exec(`INSERT INTO ${t} (${names.join(",")}) SELECT ${names.join(",")} FROM ${t}__old`);
      db.exec(`DROP TABLE ${t}__old`);
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    throw new Error(`黑板库迁移失败（数据未改动）：${e?.message ?? e}`);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  // 索引跟着旧表一起被 DROP 了：重跑一遍 SCHEMA（全是 IF NOT EXISTS，幂等）把索引补回来
  db.exec(SCHEMA);
}

export function openStore(dbPath = DEFAULT_DB) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  migrate(db);

  const nextScoped = (projectId, kind, prefix) => {
    db.prepare("INSERT OR IGNORE INTO scoped_counters (project_id, kind, value) VALUES (?, ?, 0)").run(projectId, kind);
    db.prepare("UPDATE scoped_counters SET value = value + 1 WHERE project_id = ? AND kind = ?").run(projectId, kind);
    const row = db.prepare("SELECT value FROM scoped_counters WHERE project_id = ? AND kind = ?").get(projectId, kind);
    return `${prefix}${String(row.value).padStart(3, "0")}`;
  };

  const nextProjectId = () => {
    db.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES ('project', 0)").run();
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'project'").run();
    const row = db.prepare("SELECT value FROM counters WHERE name = 'project'").get();
    return `eng_${String(row.value).padStart(3, "0")}`;
  };

  /**
   * 解析当前 agent 所属项目：优先 session_id，其次 cwd（**仅子 agent**，见 allowCwd）。
   *
   * allowCwd=false 是给**顶层会话**用的：一个会话一个项目，新会话必须从自己的空黑板开始，
   * 绝不能因为"同一个工作目录里还有别人建的项目"就把别人的图端出来
   * （真实反馈：新开会话没建黑板，面板里显示的是上一次测试的巨人网络项目）。
   */
  const findProject = ({ sessionId, cwd, allowCwd = true } = {}) => {
    if (sessionId) {
      const bySession = db.prepare("SELECT * FROM projects WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId);
      if (bySession) return bySession;
    }
    if (cwd && allowCwd) {
      return db.prepare("SELECT * FROM projects WHERE cwd = ? ORDER BY created_at DESC LIMIT 1").get(cwd) ?? null;
    }
    return null;
  };

  /**
   * 建项目必须是**一个事务**：projects 行 + origin/goal 两行要么全成、要么全不成。
   * 不这么做的话，中途抛错会在 projects 里留下一个没有任何事实的"幽灵项目"，
   * 而面板默认取"最近更新的项目" → 正好读到幽灵 → 看起来"面板什么都没有"（踩过）。
   */
  const createProject = ({ sessionId, cwd, title, origin, goal }) => {
    const now = utcnow();
    db.exec("BEGIN IMMEDIATE");
    try {
      const id = nextProjectId();
      db.prepare(
        "INSERT INTO projects (id, session_id, cwd, title, origin, goal, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).run(id, sessionId ?? null, cwd ?? null, title ?? origin ?? "未命名任务", origin ?? "", goal ?? "", "active", now, now);
      db.prepare("INSERT INTO facts (id, project_id, description, category, confidence, created_at) VALUES (?,?,?,?,?,?)").run(
        "origin", id, `任务起点：${origin ?? ""}`, "origin", "confirmed", now
      );
      db.prepare("INSERT INTO facts (id, project_id, description, category, confidence, created_at) VALUES (?,?,?,?,?,?)").run(
        "goal", id, `任务目标：${goal ?? ""}`, "goal", "confirmed", now
      );
      db.exec("COMMIT");
      return getProject(id);
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
      throw e;
    }
  };

  /**
   * 建/复用项目。`allowCwd=false`（顶层会话）时**只认自己 session_id 绑定的项目**：
   * 同一个工作目录里别人建过的项目不算我的 —— 新会话必须从自己的新项目开始，
   * 否则"新开会话"会直接接管上一个会话的图（真实反馈）。
   * 子 agent 才允许按 cwd 命中父会话那张图。
   */
  const ensureProject = ({ sessionId, cwd, title, origin, goal, allowCwd = true }) => {
    const existing = findProject({ sessionId, cwd, allowCwd });
    if (existing) {
      // 再调 bb_project_init 时：origin/goal **以及 title** 都要跟着更新。
      // 不更新 title 的话，复用的项目会一直顶着上一轮的名字（实测：同一个 cwd 换了目标，
      // 面板标题还写着上一轮的任务名，看起来"面板没反应"）。
      if (origin || goal || title) {
        db.prepare(
          `UPDATE projects SET origin = COALESCE(NULLIF(?,''), origin), goal = COALESCE(NULLIF(?,''), goal),
             title = COALESCE(NULLIF(?,''), title), updated_at = ? WHERE id = ?`
        ).run(origin ?? "", goal ?? "", title ?? "", utcnow(), existing.id);
      }
      return getProject(existing.id);
    }
    if (!origin && !goal) return null;
    return createProject({ sessionId, cwd, title, origin, goal });
  };

  const getProject = (id) => db.prepare("SELECT * FROM projects WHERE id = ?").get(id) ?? null;

  /**
   * 删掉整块作战面板（项目 + 它名下的一切）：面板上「删除该面板」按钮走这条。
   *
   * 为什么必须先备份：这是**不可逆**的数据删除（人点错了就没了）。删之前用
   * `VACUUM INTO` 落一份一致性快照到 `blackboard.backup-<ts>.db`，出事能整库还原。
   * 删除本身是**一个事务**：任何一张表删失败都整体回滚，绝不留下"半块面板"。
   *
   * 返回 { id, deleted: {facts,intents,intentSources,hints,assets,assetChecks,untested}, backupPath }。
   */
  const deleteProject = (projectId, { backup = true, now = new Date() } = {}) => {
    const id = String(projectId ?? "");
    const project = getProject(id);
    if (!project) return { ok: false, error: `项目 ${id} 不存在` };
    const count = (sql, ...args) => db.prepare(sql).get(...args)?.c ?? 0;
    const before = {
      facts: count("SELECT COUNT(*) c FROM facts WHERE project_id = ?", id),
      intents: count("SELECT COUNT(*) c FROM intents WHERE project_id = ?", id),
      intentSources: count("SELECT COUNT(*) c FROM intent_sources WHERE project_id = ?", id),
      hints: count("SELECT COUNT(*) c FROM hints WHERE project_id = ?", id),
      assets: count("SELECT COUNT(*) c FROM assets WHERE project_id = ?", id),
      assetChecks: count("SELECT COUNT(*) c FROM asset_checks WHERE project_id = ?", id),
      untested: count("SELECT COUNT(*) c FROM untested WHERE project_id = ?", id),
    };

    let backupPath = null;
    if (backup && dbPath && dbPath !== ":memory:") {
      try {
        // 备份名用**本地时间**：面板会把这条路径显示给人看，UTC 会让人误以为备份是"六个小时前的"
        const t = now instanceof Date ? now : new Date(now);
        const two = (n) => String(n).padStart(2, "0");
        const stamp = `${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}T${two(t.getHours())}${two(t.getMinutes())}${two(t.getSeconds())}`;
        const p = path.join(path.dirname(dbPath), `blackboard.backup-${stamp}.db`);
        fs.rmSync(p, { force: true });
        db.exec(`VACUUM INTO '${p.replace(/'/g, "''")}'`);     // SQLite 原生一致性快照（WAL 下也安全）
        backupPath = p;
      } catch (e) {
        return { ok: false, error: `删除前备份失败，已中止（数据未动）：${e?.message ?? e}` };
      }
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM intent_sources WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM asset_checks WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM untested WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM facts WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM intents WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM hints WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM assets WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM scoped_counters WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
      return { ok: false, error: `删除失败已回滚（数据未动）：${e?.message ?? e}`, backupPath };
    }
    return { ok: true, id, title: project.title, deleted: before, backupPath };
  };

  // rowid 兜底：updated_at 只精确到秒，同一秒内建的多个项目要有稳定顺序（否则"最新项目"不稳定）
  const listProjects = () =>
    db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM facts f WHERE f.project_id = p.id AND f.category NOT IN ('origin','goal') AND f.deprecated = 0) AS fact_count,
              (SELECT COUNT(*) FROM intents i WHERE i.project_id = p.id) AS intent_count,
              (SELECT COUNT(*) FROM intents i WHERE i.project_id = p.id AND i.status = 'open') AS open_count,
              (SELECT COUNT(*) FROM hints h WHERE h.project_id = p.id) AS hint_count,
              (SELECT COUNT(*) FROM assets a WHERE a.project_id = p.id) AS asset_count
       FROM projects p ORDER BY p.updated_at DESC, p.rowid DESC`
    ).all();

  const addFact = (projectId, { description, category = "fact", evidence = null, confidence = "confirmed", sourceIntent = null }) => {
    const id = nextScoped(projectId, "fact", "f");
    const now = utcnow();
    db.prepare(
      "INSERT INTO facts (id, project_id, description, category, evidence, confidence, source_intent, created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, projectId, String(description ?? "").trim(), category, evidence, confidence, sourceIntent, now);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    return { id, description, category, evidence, confidence };
  };

  const deprecateFact = (projectId, factId, reason) => {    const row = db.prepare("SELECT * FROM facts WHERE id = ? AND project_id = ?").get(factId, projectId);
    if (!row) return { ok: false, error: `事实 ${factId} 不存在` };
    db.prepare("UPDATE facts SET deprecated = 1, confidence = 'deprecated', evidence = COALESCE(?, evidence) WHERE id = ? AND project_id = ?")
      .run(reason ? `[废弃原因] ${reason}` : null, factId, projectId);
    return { ok: true, id: factId };
  };

  const proposeIntents = (projectId, items, creator = "orchestrator") => {
    const created = [];
    for (const item of items ?? []) {
      const froms = (item.from ?? []).map((f) => String(f).trim()).filter(Boolean);
      for (const f of froms) {
        const ok = db.prepare("SELECT 1 FROM facts WHERE id = ? AND project_id = ?").get(f, projectId);
        if (!ok) return { ok: false, error: `from 中的事实 ${f} 不存在于本项目` };
      }
      const id = nextScoped(projectId, "intent", "i");
      const now = utcnow();
      db.prepare(
        "INSERT INTO intents (id, project_id, description, domain, priority, status, creator, created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).run(id, projectId, String(item.description ?? "").trim(), item.domain ?? null, Number(item.priority ?? 5), "open", creator, now);
      for (const f of froms.length ? froms : ["origin"]) {
        db.prepare("INSERT OR IGNORE INTO intent_sources (intent_id, project_id, fact_id) VALUES (?,?,?)").run(id, projectId, f);
      }
      created.push({ id, description: item.description, domain: item.domain ?? null, priority: Number(item.priority ?? 5), from: froms });
    }
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(utcnow(), projectId);
    return { ok: true, created };
  };

  const claimIntent = (projectId, intentId, worker) => {
    const row = db.prepare("SELECT * FROM intents WHERE id = ? AND project_id = ?").get(intentId, projectId);
    if (!row) return { ok: false, error: `意图 ${intentId} 不存在` };
    if (row.concluded_at) return { ok: false, error: `意图 ${intentId} 已结论` };
    if (row.worker && row.worker !== worker) return { ok: false, error: `意图 ${intentId} 已被 ${row.worker} 认领` };
    const now = utcnow();
    db.prepare("UPDATE intents SET worker = ?, status = 'claimed', claimed_at = COALESCE(claimed_at, ?) WHERE id = ? AND project_id = ?")
      .run(worker, now, intentId, projectId);
    return { ok: true, id: intentId, worker };
  };

  const releaseIntent = (projectId, intentId, note) => {
    db.prepare("UPDATE intents SET worker = NULL, status = 'open', note = COALESCE(?, note) WHERE id = ? AND project_id = ? AND concluded_at IS NULL")
      .run(note ?? null, intentId, projectId);
    return { ok: true, id: intentId };
  };

  const concludeIntent = (projectId, intentId, { factDescription = null, evidence = null, dead = false, note = null } = {}) => {
    const row = db.prepare("SELECT * FROM intents WHERE id = ? AND project_id = ?").get(intentId, projectId);
    if (!row) return { ok: false, error: `意图 ${intentId} 不存在` };
    if (row.concluded_at) return { ok: false, error: `意图 ${intentId} 已结论（${row.to_fact ?? "dead"}）` };
    if (!dead && !String(factDescription ?? "").trim()) {
      return { ok: false, error: "非死路结论必须给出 fact_description（判定此方向无果请用 dead=true）" };
    }
    let fact = null;
    if (!dead && factDescription) {
      fact = addFact(projectId, { description: factDescription, evidence, category: "fact", sourceIntent: intentId });
    }
    const now = utcnow();
    db.prepare("UPDATE intents SET status = ?, to_fact = ?, dead = ?, note = COALESCE(?, note), concluded_at = ?, worker = COALESCE(worker, 'concluded') WHERE id = ? AND project_id = ?")
      .run(dead ? "dead" : "concluded", fact?.id ?? null, dead ? 1 : 0, note, now, intentId, projectId);
    return { ok: true, id: intentId, fact: fact?.id ?? null, dead };
  };

  // ── 资产 / 覆盖 / 阶段 ────────────────────────────────────────────────────
  /**
   * 批量登记资产（幂等 upsert）。**新资产出现即意味着"面还没穷尽"**：
   * ① epoch 自增（六张矩阵的缺口随之出现）② **阶段退回 P1 起点**，并把 `reflow_pending` 置 1 ——
   * 意思是"上一轮的饱和判定作废了"，必须再收一轮（`bb_coverage {endRound:true}` 连续 0 新增）
   * 才允许重新往上走：先补收集轮 → 再给新资产走 P2（信息收集）→ P3/P4/P5。
   * 典型来源：JS 逆向挖到的接口、目录/路径探测暴露的新面、配置文件里的新域名/凭据、证书 SAN。
   */
  const upsertAssets = (projectId, items, source = "unknown") => {
    const added = [], updated = [], skipped = [];
    const now = utcnow();
    for (const it of Array.isArray(items) ? items : []) {
      const kind = String(it?.kind ?? "").trim().toLowerCase();
      const value = String(it?.value ?? "").trim();
      if (!ASSET_KINDS.includes(kind) || value === "") continue;
      const row = db.prepare("SELECT * FROM assets WHERE project_id = ? AND kind = ? AND value = ?").get(projectId, kind, value);
      const prio = Number.isInteger(it.priority) ? Math.min(5, Math.max(1, it.priority)) : null;
      if (row) {
        // priority ≤ 2 = "不要求深测"。它是自报的，所以**降级到低分**同样要给理由（升级不受限）。
        if (prio !== null && prio < DEFAULT_DEEP_MIN_PRIORITY && !String(it.notes ?? "").trim() && !String(row.notes ?? "").trim()) {
          skipped.push(`${kind} ${value}：priority=${prio} 属于"不要求深测"，必须用 notes 写明理由`);
          continue;
        }
        db.prepare(
          `UPDATE assets SET tech = COALESCE(NULLIF(?,''), tech), label = COALESCE(NULLIF(?,''), label),
             priority = COALESCE(?, priority), notes = COALESCE(NULLIF(?,''), notes), updated_at = ?
           WHERE id = ? AND project_id = ?`
        ).run(it.tech ?? "", it.label ?? "", prio, it.notes ?? "", now, row.id, projectId);
        updated.push(row.id);
      } else {
        if (prio !== null && prio < DEFAULT_DEEP_MIN_PRIORITY && !String(it.notes ?? "").trim()) {
          skipped.push(`${kind} ${value}：priority=${prio} 属于"不要求深测"，必须用 notes 写明理由`);
          continue;
        }
        const id = nextScoped(projectId, "asset", "a");
        db.prepare(
          `INSERT INTO assets (id, project_id, kind, value, label, tech, priority, s2, s3, evidence, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,'pending','pending',?,?,?,?)`
        ).run(id, projectId, kind, value, it.label ?? value, it.tech ?? null,
          Number.isInteger(it.priority) ? Math.min(5, Math.max(1, it.priority)) : 3,
          it.evidence ?? `source=${source}`, it.notes ?? null, now, now);
        added.push({ id, kind, value });
      }
    }
    if (added.length) {
      db.prepare("UPDATE projects SET asset_epoch = asset_epoch + ?, updated_at = ? WHERE id = ?").run(added.length, now, projectId);
      // **回灌 = 回到 P1 起点**：新资产 = "面还没穷尽"，上一轮的饱和判定作废。
      // 两件事一起做：① 阶段退回 P1 ② 置 reflow_pending，逼下一轮重新收轮确认 0 新增。
      // 之后该资产仍要完整走 P2（信息收集）→ P3（核实+浅层测试）→ P4（核实+OWASP）→ P5（深层）。
      const proj = getProject(projectId);
      const from = proj?.phase && proj.phase !== "P1" ? proj.phase : null;
      const note = `回灌：新增 ${added.length} 个资产（来源 ${source}${from ? `；原阶段 ${from}` : ""}）→ 回到 P1 起点，需再收一轮确认穷尽`;
      db.prepare(
        `UPDATE projects SET phase = 'P1', phase_note = ?, reflow_pending = 1,
            reflow_count = reflow_count + ?, reflow_source = ?, updated_at = ? WHERE id = ?`
      ).run(note, added.length, String(source ?? "unknown").slice(0, 60), now, projectId);
    }
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    return { ok: true, added, updated, skipped, addedCount: added.length, updatedCount: updated.length, skippedCount: skipped.length };
  };

  /** 给资产行挂上检查矩阵摘要（面板与工具都要用；缺 checks 时不抛错）。一次查询全量 checks 再分组，避免 N+1。 */
  const withChecks = (projectId, rows) => {
    const byAsset = new Map();
    for (const c of listChecks(projectId)) {
      if (!byAsset.has(c.asset_id)) byAsset.set(c.asset_id, []);
      byAsset.get(c.asset_id).push(c);
    }
    return (rows ?? []).map((a) => {
      const mine = byAsset.get(a.id) ?? [];
      const checks = {};
      for (const stage of CHECK_STAGES) {
        checks[stage] = {};
        for (const c of mine) if (c.stage === stage) checks[stage][c.key] = c.status;
      }
      return { ...a, checks, checkSummary: summaryOf(a, mine) };
    });
  };

  const listAssets = (projectId, { kind, s2, s3, priorityMin, onlyGaps = false, limit = 200 } = {}) => {
    const where = ["project_id = ?"];
    const args = [projectId];
    if (kind) { where.push("kind = ?"); args.push(String(kind)); }
    if (s2) { where.push("s2 = ?"); args.push(String(s2)); }
    if (s3) { where.push("s3 = ?"); args.push(String(s3)); }
    if (priorityMin !== undefined) { where.push("priority >= ?"); args.push(Number(priorityMin)); }
    if (onlyGaps) where.push("(s2 NOT IN ('done','na') OR (priority >= 3 AND s3 NOT IN ('done','na')))");
    args.push(Math.max(1, Math.min(2000, Number(limit) || 200)));
    const rows = db.prepare(`SELECT * FROM assets WHERE ${where.join(" AND ")} ORDER BY kind, priority DESC, value LIMIT ?`).all(...args);
    return withChecks(projectId, rows);
  };

  const updateAsset = (projectId, ref, patch = {}) => {
    const row = (ref?.id
      ? db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(String(ref.id), projectId)
      : db.prepare("SELECT * FROM assets WHERE project_id = ? AND kind = ? AND value = ?").get(projectId, String(ref?.kind ?? ""), String(ref?.value ?? "")));
    if (!row) return { ok: false, error: `资产不存在：${JSON.stringify(ref)}` };
    const s2 = ["pending", "doing", "done", "na"].includes(patch.s2) ? patch.s2 : null;
    const s3 = ["pending", "doing", "done", "na"].includes(patch.s3) ? patch.s3 : null;
    // `na`（不适用）与 `done` 一样计入覆盖率，所以它必须有**机器可校验**的理由：
    // 否则"把难的面标 na"就是一条把覆盖率刷到 100% 的漂白通道 —— 比漏测更糟，因为报告上看不出来。
    const notes = String(patch.notes ?? "").trim();
    const nextNotes = notes || String(row.notes ?? "").trim();
    const nextS2 = s2 ?? row.s2;
    const nextS3 = s3 ?? row.s3;
    if (nextS2 === "na" || nextS3 === "na") {
      const stage = nextS2 === "na" ? "浅测 s2" : "深测 s3";
      if (!nextNotes) {
        return {
          ok: false,
          error: `标 ${stage}=na（不适用）必须在 notes 里写明理由：na 和 done 一样计入覆盖率，没有理由的 na 会让"测得全不全"失真。`,
          hint: "理由要能被人复核，例如「同 C 段同 IP 已并测」「纯静态资源无参数面」「客户声明不在范围」。测不完的留在 pending/doing 里当缺口。",
        };
      }
      if (nextNotes.length < 4) {
        return { ok: false, error: `na 的理由太短（"${nextNotes}"），无法复核：请写清为什么不适用。` };
      }
    }
    db.prepare(
      `UPDATE assets SET tech = COALESCE(NULLIF(?,''), tech), priority = COALESCE(?, priority),
         s2 = COALESCE(?, s2), s3 = COALESCE(?, s3),
         evidence = COALESCE(NULLIF(?,''), evidence), notes = COALESCE(NULLIF(?,''), notes), updated_at = ?
       WHERE id = ? AND project_id = ?`
    ).run(patch.tech ?? "", Number.isInteger(patch.priority) ? Math.min(5, Math.max(1, patch.priority)) : null,
      s2, s3, patch.evidence ?? "", notes, utcnow(), row.id, projectId);
    return { ok: true, id: row.id, s2: s2 ?? row.s2, s3: s3 ?? row.s3, notes: nextNotes };
  };

  // ── 检查矩阵：浅层 / 中间层（核验 + OWASP）/ 深层 ─────────────────────────
  /**
   * 登记一条检查结果。**这是"这条资产到底测了什么"的唯一事实来源**：
   * 一个 `s3=done` 说不清测了哪几类，`deep` 矩阵才说得清。
   * na / wrong / unknown 必须给理由（机器强制），hit 必须给证据。
   */
  const setCheck = (projectId, assetRef, { stage, key, status, evidence = null, note = null, reviewed = false } = {}) => {
    const rawStage = String(stage ?? "").trim();
    // 大小写不敏感地匹配到规范名（verifyinfo → verifyInfo），避免把合法 stage 判成未知
    const s = CHECK_STAGES.find((x) => x.toLowerCase() === rawStage.toLowerCase()) ?? rawStage;
    if (!CHECK_STAGES.includes(s)) return { ok: false, error: `未知 stage=${stage}（应为 ${CHECK_STAGES.join(" | ")}）` };
    const k = String(key ?? "").trim();
    if (!k) return { ok: false, error: "key 必填" };
    const st = String(status ?? "").trim().toLowerCase();
    if (!CHECK_STATUS[s].includes(st)) return { ok: false, error: `stage=${s} 的 status 只能是 ${CHECK_STATUS[s].join(" | ")}（收到 ${status}）` };
    const row = assetRef?.id
      ? db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(String(assetRef.id), projectId)
      : db.prepare("SELECT * FROM assets WHERE project_id = ? AND kind = ? AND value = ?").get(projectId, String(assetRef?.kind ?? ""), String(assetRef?.value ?? ""));
    if (!row) return { ok: false, error: `资产不存在：${JSON.stringify(assetRef)}（先 bb_asset_add 登记）` };
    const allowed = requiredKeys(row.kind, s);
    if (!allowed.includes(k)) {
      return { ok: false, error: `kind=${row.kind} 的 ${s} 里没有 key=${k}`, allowed };
    }
    const n = String(note ?? "").trim();
    const ev = String(evidence ?? "").trim();
    if (NEEDS_NOTE[s].includes(st) && n.length < 4) {
      return {
        ok: false,
        error: `${s} 的 status=${st} 必须用 note 写清理由（至少 4 字）：这类状态会拉高覆盖率，没有理由等于把缺口洗成覆盖。`,
        hint: VERIFY_STAGES.includes(s) ? "wrong=上一层采/测错了（例：版本只来自响应头、目录其实不存在、浅层结论无证据）；unknown=确实无法核验（例：需要凭据/需要内网）" : "na=这类面在该资产上确实不适用（例：纯静态资源无参数面）",
      };
    }
    if (NEEDS_EVIDENCE.includes(st) && !ev) {
      return { ok: false, error: `${s} 的 status=${st}（命中）必须给 evidence：没有证据的命中会被复核推翻。`, hint: "写证据指位：请求/响应文件路径、事实 id、PoC 脚本路径" };
    }
    const now = utcnow();
    db.prepare(
      `INSERT INTO asset_checks (project_id, asset_id, stage, key, status, evidence, note, reviewed, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(project_id, asset_id, stage, key) DO UPDATE SET
         status=excluded.status, evidence=COALESCE(NULLIF(excluded.evidence,''), evidence),
         note=COALESCE(NULLIF(excluded.note,''), note), reviewed=MAX(reviewed, excluded.reviewed), updated_at=excluded.updated_at`
    ).run(projectId, row.id, s, k, st, ev || null, n || null, reviewed ? 1 : 0, now, now);
    syncAssetStages(projectId, row.id);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    return { ok: true, asset: row.id, stage: s, key: k, status: st, summary: assetCheckSummary(projectId, row.id) };
  };

  const listChecks = (projectId, { assetId = null, stage = null } = {}) => {
    const where = ["project_id = ?"];
    const args = [projectId];
    if (assetId) { where.push("asset_id = ?"); args.push(String(assetId)); }
    if (stage) { where.push("stage = ?"); args.push(String(stage)); }
    return db.prepare(`SELECT * FROM asset_checks WHERE ${where.join(" AND ")} ORDER BY asset_id, stage, key`).all(...args);
  };

  /** 纯函数：由资产行 + 它的检查行算出各 stage 完成度（不要在里面查库，面板要按 2505 个资产量级调用）。 */
  const summaryOf = (asset, rows) => {
    const out = {};
    for (const stage of CHECK_STAGES) {
      const req = requiredKeys(asset.kind, stage);
      const mine = (rows ?? []).filter((r) => r.stage === stage);
      const okStates = VERIFY_STAGES.includes(stage) ? VERIFY_OK_STATES : WORK_OK_STATES;
      const done = req.filter((k) => mine.some((r) => r.key === k && okStates.includes(r.status)));
      out[stage] = {
        required: req.length, done: done.length,
        pct: req.length === 0 ? 100 : Math.round((done.length / req.length) * 100),
        missing: req.filter((k) => !done.includes(k)),
        hits: mine.filter((r) => r.status === "hit").length,
        wrong: mine.filter((r) => r.status === "wrong").length,
        applicable: !stageNeedsDeepPriority(stage) || (asset.priority ?? 3) >= DEFAULT_DEEP_MIN_PRIORITY,
      };
    }
    return out;
  };

  /** 单资产的检查完成度（各 stage：required / done / pct）。 */
  const assetCheckSummary = (projectId, assetId) => {
    const asset = db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(assetId, projectId);
    if (!asset) return null;
    return summaryOf(asset, listChecks(projectId, { assetId }));
  };

  /**
   * 由检查矩阵反推资产的 s2/s3 汇总位（老口径继续可用，但**不再是判据**）：
   *   s2=done ⇔ 信息收集（info）必采项全部 done/na
   *   s3=done ⇔ 深层（deep）必测类别全部 done/hit/na（priority < 3 的资产不要求）
   */
  const syncAssetStages = (projectId, assetId) => {
    const asset = db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(assetId, projectId);
    if (!asset) return;
    const sum = assetCheckSummary(projectId, assetId);
    const s2 = sum.info.missing.length === 0 ? "done" : sum.info.done > 0 ? "doing" : "pending";
    const deepRequired = (asset.priority ?? 3) >= DEFAULT_DEEP_MIN_PRIORITY;
    const s3 = !deepRequired ? (asset.s3 === "na" ? "na" : "pending") : (sum.deep.missing.length === 0 && sum.deep.required > 0 ? "done" : sum.deep.done > 0 ? "doing" : "pending");
    db.prepare("UPDATE assets SET s2 = ?, s3 = ?, updated_at = ? WHERE id = ? AND project_id = ?").run(s2, s3, utcnow(), assetId, projectId);
  };

  /** 未测面：**没做的面必须留痕**（与"死路"不同：死路是试过没成，这里是压根没做/做不了）。 */
  const addUntested = (projectId, { surface, why, stage = null } = {}) => {
    const s = String(surface ?? "").trim();
    const w = String(why ?? "").trim();
    if (!s) return { ok: false, error: "surface 必填（写清哪个面没测）" };
    if (w.length < 4) return { ok: false, error: "why 必填（至少 4 字）：未测面必须能被人复核，写清为什么没做/做不了" };
    const id = nextScoped(projectId, "untested", "u");
    db.prepare("INSERT INTO untested (id, project_id, surface, why, stage, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, projectId, s, w, stage ? String(stage) : null, utcnow());
    return { ok: true, id, surface: s };
  };

  const listUntested = (projectId) => db.prepare("SELECT * FROM untested WHERE project_id = ? ORDER BY id").all(projectId);

  /** 显式声明"未测面已经登记完了"（P5 出关条件之一；允许为空，但必须显式）。 */
  const declareUntested = (projectId, note = "") => {
    db.prepare("UPDATE projects SET untested_declared = 1, updated_at = ? WHERE id = ?").run(utcnow(), projectId);
    return { ok: true, declared: true, count: listUntested(projectId).length, note: String(note ?? "") };
  };

  /** 事实复核（独立复核员用）：confirm=确认 / challenge=挑战（挑战后应废弃或改写该事实）。 */
  const reviewFact = (projectId, factId, { verdict, evidence = null, note = null } = {}) => {
    const v = String(verdict ?? "").trim().toLowerCase();
    if (!["confirm", "challenge"].includes(v)) return { ok: false, error: "verdict 只能是 confirm | challenge" };
    const row = db.prepare("SELECT * FROM facts WHERE id = ? AND project_id = ?").get(String(factId), projectId);
    if (!row) return { ok: false, error: `事实 ${factId} 不存在` };
    const ev = String(evidence ?? "").trim();
    if (!ev) return { ok: false, error: "复核必须给 evidence（你自己独立复算的报文/脚本/文件路径）" };
    db.prepare("UPDATE facts SET review_status = ?, review_evidence = ?, reviewed_at = ? WHERE id = ? AND project_id = ?")
      .run(v, ev, utcnow(), factId, projectId);
    return { ok: true, id: factId, verdict: v };
  };

  /** 覆盖率与阶段门：**一切"测得全不全"的判断都从这里出数**。 */
  const coverage = (projectId) => {
    const project = getProject(projectId);
    if (!project) return null;
    const all = db.prepare("SELECT * FROM assets WHERE project_id = ?").all(projectId);
    const pct = (n, d) => (d === 0 ? 100 : Math.round((n / d) * 100));
    const shallowDone = all.filter((a) => ["done", "na"].includes(a.s2));
    const deepTargets = all.filter((a) => (a.priority ?? 3) >= DEFAULT_DEEP_MIN_PRIORITY);
    const deepDone = deepTargets.filter((a) => ["done", "na"].includes(a.s3));
    // na 与 done 都算"已覆盖"，但两者证据强度不同：na 是"判定不适用"，必须能被人复核。
    // 单独出数是为了让"用 na 把覆盖率刷满"这件事在账本上立刻可见（noReason 必须为 0）。
    const naShallow = all.filter((a) => a.s2 === "na");
    const naDeep = deepTargets.filter((a) => a.s3 === "na");
    const naNoReason = all.filter((a) => (a.s2 === "na" || a.s3 === "na") && !String(a.notes ?? "").trim()).length;
    const byKind = {};
    for (const a of all) {
      byKind[a.kind] = byKind[a.kind] ?? { total: 0, shallowDone: 0, deepDone: 0 };
      byKind[a.kind].total++;
      if (["done", "na"].includes(a.s2)) byKind[a.kind].shallowDone++;
      if (["done", "na"].includes(a.s3)) byKind[a.kind].deepDone++;
    }
    let sourcesDone = [];
    try { sourcesDone = JSON.parse(project.sources_done ?? "[]"); } catch { sourcesDone = []; }
    const kindsSeen = new Set(all.map((a) => a.kind));
    const sourcesMissing = SOURCE_CLASSES.filter((k) => !kindsSeen.has(k) && !sourcesDone.includes(k));

    const epoch = Number(project.asset_epoch ?? 0);
    const mark = Number(project.recon_mark ?? 0);
    const rounds = Number(project.recon_rounds ?? 0);
    const lastAdded = Number(project.recon_last_added ?? -1); // -1 = 还没有确认过任何一轮
    const addedThisRound = epoch - mark;

    // ── 六张矩阵：信息收集 + 浅层（核实 + 测试）+ 中间层（核实 + OWASP）+ 深层 ──
    // 后四个矩阵只对 priority ≥ 3 的资产要求（低优先资产登记时必须写理由 —— 可审计的降级）。
    const checks = listChecks(projectId);
    const stages = {};
    const stageGaps = {};
    for (const stage of CHECK_STAGES) {
      const okStates = VERIFY_STAGES.includes(stage) ? VERIFY_OK_STATES : WORK_OK_STATES;
      const scoped = stageNeedsDeepPriority(stage) ? deepTargets : all;
      let required = 0, done = 0;
      const gaps = [];
      for (const a of scoped) {
        const req = requiredKeys(a.kind, stage);
        required += req.length;
        for (const k of req) {
          const hit = checks.find((c) => c.asset_id === a.id && c.stage === stage && c.key === k);
          if (hit && okStates.includes(hit.status)) done++;
          else gaps.push({ assetId: a.id, asset: a.value, key: k, status: hit?.status ?? "pending" });
        }
      }
      stages[stage] = { required, done, pct: pct(done, required), gaps: gaps.slice(0, 40), gapCount: gaps.length };
      stageGaps[stage] = gaps;
    }
    // 每一层都要把"上一层被核实为有误"的项点出来（下一层必须独立复算）
    const wrongChecks = checks.filter((c) => VERIFY_STAGES.includes(c.stage) && c.status === "wrong");
    const wrongUnreviewed = wrongChecks.filter((c) => !c.reviewed);
    // 中间层的结论（OWASP）在深层必须被核验过（reviewed）
    const owaspRows = checks.filter((c) => c.stage === "owasp" && c.status !== "pending");
    const owaspUnreviewed = owaspRows.filter((c) => !c.reviewed);
    // 未测面 & 复核进度
    const untestedItems = listUntested(projectId);
    const vulnFacts = db.prepare("SELECT id, review_status FROM facts WHERE project_id = ? AND category = 'vuln' AND deprecated = 0").all(projectId);
    const reviewedFacts = vulnFacts.filter((f) => f.review_status);
    const reviews = {
      vuln: vulnFacts.length, reviewed: reviewedFacts.length, pending: vulnFacts.length - reviewedFacts.length,
      challenged: vulnFacts.filter((f) => f.review_status === "challenge").length,
    };
    const untested = { declared: Number(project.untested_declared ?? 0) === 1, count: untestedItems.length, items: untestedItems.slice(0, 50) };

    // 阻塞项按"进入下一阶段之前必须补齐什么"分桶：P1→P2 看 P1；P2→P3 看 P2（信息收集）；以此类推。
    const blockers = { P1: [], P2: [], P3: [], P4: [], P5: [] };
    if (!all.length) blockers.P1.push("资产清单为空：先跑资产收集");
    if (sourcesMissing.length) blockers.P1.push(`以下资产来源类别还没有结果（也没有显式标记为已穷尽）：${sourcesMissing.join(", ")}`);
    if (lastAdded < 0) blockers.P1.push("还没有确认过任何一轮收集 —— 跑完一轮收集后用 bb_coverage {endRound:true} 收轮，才能判定饱和");
    else if (lastAdded > 0) blockers.P1.push(`上一轮收集仍有 ${lastAdded} 个新增资产 —— 说明面还没穷尽，继续收集（新资产会顺带要求重跑信息收集）`);
    // 回灌 = "面还没穷尽"：饱和判定作废，必须再收一轮（连续 0 新增）才允许重新往上走
    if (Number(project.reflow_pending ?? 0) === 1) {
      blockers.P1.push(`有回灌未收轮：最近新增 ${Number(project.reflow_count ?? 0)} 个资产（来源 ${project.reflow_source ?? "未知"}）→ 按纪律回到 P1 起点，请再跑一轮收集并用 bb_coverage {endRound:true} 确认 0 新增；同时这批新资产要走完 P2→P5 六张矩阵`);
    }
    // P2 信息收集
    if (stages.info.gapCount) blockers.P2.push(`信息收集未完成 ${stages.info.gapCount} 项（覆盖 ${stages.info.done}/${stages.info.required}）：每个资产都要采齐该类的必采信息项`);
    // P3 浅层 = 核实信息收集 + 浅层测试
    if (stages.verifyInfo.gapCount) blockers.P3.push(`浅层·核实信息收集未完成 ${stages.verifyInfo.gapCount} 项（覆盖 ${stages.verifyInfo.done}/${stages.verifyInfo.required}）：信息收集的每一条都要核验（ok/wrong/unknown）`);
    if (stages.shallow.gapCount) blockers.P3.push(`浅层测试未完成 ${stages.shallow.gapCount} 项（覆盖 ${stages.shallow.done}/${stages.shallow.required}，只算 priority ≥ ${DEFAULT_DEEP_MIN_PRIORITY} 的资产）：8 项浅层测试逐项登记`);
    // P4 中间层 = 核实浅层 + OWASP
    if (stages.verifyShallow.gapCount) blockers.P4.push(`中间层·核实浅层未完成 ${stages.verifyShallow.gapCount} 项（覆盖 ${stages.verifyShallow.done}/${stages.verifyShallow.required}）：浅层的每一项结论都要被核实（是否有证据、有没有漏）`);
    if (stages.owasp.gapCount) blockers.P4.push(`中间层·OWASP Top 10 未完成 ${stages.owasp.gapCount} 项（覆盖 ${stages.owasp.done}/${stages.owasp.required}）：A01–A10 每个资产都要有结论`);
    // P5 深层 = 读全量 + 核验中间层 + 漏洞验证
    if (stageGaps.deep.length) blockers.P5.push(`深层未完成 ${stageGaps.deep.length} 项（覆盖 ${stages.deep.done}/${stages.deep.required}，只算 priority ≥ ${DEFAULT_DEEP_MIN_PRIORITY} 的资产）`);
    if (wrongUnreviewed.length) blockers.P5.push(`有 ${wrongUnreviewed.length} 个「上一层被核实为 wrong」的项还没被下一步独立复算（bb_asset_check ... reviewed=true）`);
    if (owaspUnreviewed.length) blockers.P5.push(`有 ${owaspUnreviewed.length} 条中间层（OWASP）结论还没被深层核验过（bb_asset_check ... stage=owasp, reviewed=true）`);
    if (naNoReason) blockers.P5.push(`有 ${naNoReason} 个资产标了 na 却没写理由：na 计入覆盖率，无理由的 na 等于把缺口洗成覆盖`);
    if (!untested.declared) blockers.P5.push("未测面还没显式声明：用 bb_untested_add 登记没做/做不了的面，再 bb_coverage {declareUntested:true}");
    if (reviews.pending) blockers.P5.push(`有 ${reviews.pending}/${reviews.vuln} 条漏洞事实没有复核记录（bb_fact_review）`);

    const stagesOk = (keys) => keys.every((k) => blockers[k].length === 0);
    return {
      phase: project.phase ?? "P1",
      phaseLabel: PHASE_LABEL[project.phase ?? "P1"],
      recon: { rounds, lastAdded, addedThisRound, markEpoch: mark, assetEpoch: epoch },
      // 回灌状态：新资产出现 → 阶段退回 P1 且这里 pending=true（面板/快照都要显示出来）
      reflow: {
        pending: Number(project.reflow_pending ?? 0) === 1,
        count: Number(project.reflow_count ?? 0),
        source: project.reflow_source ?? null,
        note: project.phase_note ?? null,
      },
      newSincePhase: addedThisRound,
      sourcesDone,
      sourcesMissing,
      stages,
      untested,
      reviews,
      wrongChecks: wrongChecks.map((c) => ({ assetId: c.asset_id, stage: c.stage, key: c.key, note: c.note, reviewed: !!c.reviewed })),
      owaspUnreviewed: owaspUnreviewed.length,
      counts: {
        assets: all.length, shallowDone: shallowDone.length, deepTargets: deepTargets.length, deepDone: deepDone.length,
        gaps: CHECK_STAGES.reduce((acc, s) => acc + stageGaps[s].length, 0),
        naShallow: naShallow.length, naDeep: naDeep.length, naNoReason,
      },
      pct: {
        // 只按 done 算的"真测过"比例：与 pct.shallow 并列，防止用 na 把覆盖率刷高
        shallow: pct(shallowDone.length, all.length),
        deep: pct(deepDone.length, deepTargets.length),
        shallowTested: pct(shallowDone.length - naShallow.length, all.length),
        deepTested: pct(deepDone.length - naDeep.length, deepTargets.length),
      },
      byKind,
      blockers,
      canAdvanceTo: {
        P2: stagesOk(["P1"]),
        P3: stagesOk(["P1", "P2"]),
        P4: stagesOk(["P1", "P2", "P3"]),
        P5: stagesOk(["P1", "P2", "P3", "P4"]),
        P6: stagesOk(["P1", "P2", "P3", "P4", "P5"]),
      },
      gaps: [
        ...stageGaps.info.slice(0, 20).map((g) => ({ id: g.assetId, kind: g.key, value: g.asset, stage: "信息收集", priority: null })),
        ...stageGaps.shallow.slice(0, 20).map((g) => ({ id: g.assetId, kind: g.key, value: g.asset, stage: "浅层", priority: null })),
        ...stageGaps.deep.slice(0, 20).map((g) => ({ id: g.assetId, kind: g.key, value: g.asset, stage: "深层", priority: null })),
      ],
    };
  };

  /**
   * 收一轮资产收集：记录"本轮新增了多少"，并把轮次标记推到当前资产纪元。
   * **饱和判据 = 连续一整轮 0 新增**；模型不能用"我觉得差不多了"代替它。
   * 收轮同时清掉 `reflow_pending`（这一轮就是对回灌的确认：若本轮 0 新增，说明回灌那批之后面又穷尽了）。
   */
  const endReconRound = (projectId, note = "") => {
    const project = getProject(projectId);
    if (!project) return { ok: false, error: "项目不存在" };
    const epoch = Number(project.asset_epoch ?? 0);
    const mark = Number(project.recon_mark ?? 0);
    const added = epoch - mark;
    const hadReflow = Number(project.reflow_pending ?? 0) === 1;
    db.prepare("UPDATE projects SET recon_rounds = recon_rounds + 1, recon_last_added = ?, recon_mark = ?, recon_note = ?, reflow_pending = 0, updated_at = ? WHERE id = ?")
      .run(added, epoch, String(note ?? "").slice(0, 300) || null, utcnow(), projectId);
    return {
      ok: true, round: Number(project.recon_rounds ?? 0) + 1, addedThisRound: added, saturated: added === 0, reflowCleared: hadReflow,
      hint: added === 0
        ? (hadReflow ? "本轮 0 新增：回灌已确认（面又穷尽了）→ 可以推进到 P2（信息收集）给这批新资产做画像" : "本轮 0 新增：若来源类别已齐，可推进到 P2（信息收集）")
        : `本轮新增 ${added} 个资产：继续收集（回灌后必须再收一轮确认）`,
    };
  };

  const markSourceExhausted = (projectId, kinds = []) => {
    const cur = coverage(projectId);
    if (!cur) return { ok: false, error: "项目不存在" };
    const merged = [...new Set([...(cur.sourcesDone ?? []), ...kinds.map((k) => String(k).trim()).filter((k) => SOURCE_CLASSES.includes(k))])];
    db.prepare("UPDATE projects SET sources_done = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), utcnow(), projectId);
    return { ok: true, sourcesDone: merged };
  };

  /** 阶段推进：不满足门禁就**拒绝**并列出缺口（模型不得自行宣布进入下一阶段）。 */
  const advancePhase = (projectId, to, { force = false, reason = "" } = {}) => {
    const cur = coverage(projectId);
    if (!cur) return { ok: false, error: "项目不存在" };
    const target = to ?? PHASES[Math.min(PHASES.length - 1, PHASES.indexOf(cur.phase) + 1)];
    if (!PHASES.includes(target)) return { ok: false, error: `未知阶段 ${to}（应为 ${PHASES.join(" | ")}）` };
    if (PHASES.indexOf(target) <= PHASES.indexOf(cur.phase) && !force) {
      return { ok: false, error: `当前已在 ${cur.phase}，目标 ${target} 不是更后面的阶段` };
    }
    const gateKey = `canAdvanceTo`;
    if (!cur[gateKey][target]) {
      const upto = PHASES.slice(0, PHASES.indexOf(target)).map((p) => cur.blockers[p] ?? []);
      const need = upto.flat();
      if (!force) return { ok: false, error: `不满足进入 ${target}（${PHASE_LABEL[target]}）的条件`, blockers: need, hint: "先补齐缺口；若人类明确要求跳阶段，用 force=true 并在 reason 里写明依据" };
      if (!String(reason).trim()) return { ok: false, error: "force=true 时必须给 reason（写明是谁、何时、为何要求跳阶段）" };
    }
    const now = utcnow();
    db.prepare("UPDATE projects SET phase = ?, phase_epoch = asset_epoch, phase_note = ?, updated_at = ? WHERE id = ?")
      .run(target, force ? `force: ${String(reason).trim()}` : null, now, projectId);
    return { ok: true, phase: target, phaseLabel: PHASE_LABEL[target], forced: Boolean(force), coverage: coverage(projectId) };
  };

  const addHint = (projectId, content, creator = "Human") => {
    const id = nextScoped(projectId, "hint", "h");
    db.prepare("INSERT INTO hints (id, project_id, content, creator, created_at) VALUES (?,?,?,?,?)").run(id, projectId, String(content).trim(), creator, utcnow());
    return { ok: true, id };
  };

  const dropIntent = (projectId, intentId, note = "用户取消") => {
    const row = db.prepare("SELECT * FROM intents WHERE id = ? AND project_id = ?").get(intentId, projectId);
    if (!row) return { ok: false, error: `意图 ${intentId} 不存在` };
    db.prepare("UPDATE intents SET status = 'dead', dead = 1, note = ?, concluded_at = COALESCE(concluded_at, ?) WHERE id = ? AND project_id = ?")
      .run(note, utcnow(), intentId, projectId);
    return { ok: true, id: intentId };
  };

  const graph = (projectId) => {
    const project = getProject(projectId);
    if (!project) return null;
    const facts = db.prepare("SELECT * FROM facts WHERE project_id = ? ORDER BY created_at, id").all(projectId);
    const intents = db.prepare("SELECT * FROM intents WHERE project_id = ? ORDER BY created_at, id").all(projectId);
    const sources = db.prepare("SELECT intent_id, fact_id FROM intent_sources WHERE project_id = ?").all(projectId);
    const hints = db.prepare("SELECT * FROM hints WHERE project_id = ? ORDER BY created_at").all(projectId);
    const fromMap = new Map();
    for (const s of sources) {
      if (!fromMap.has(s.intent_id)) fromMap.set(s.intent_id, []);
      fromMap.get(s.intent_id).push(s.fact_id);
    }
    return {
      project,
      facts: facts.map((f) => ({ ...f, deprecated: !!f.deprecated })),
      intents: intents.map((i) => ({
        ...i, dead: !!i.dead, from: fromMap.get(i.id) ?? [],
      })),
      hints,
    };
  };

  const summary = (projectId) => {
    const g = graph(projectId);
    if (!g) return null;
    const facts = g.facts.filter((f) => !["origin", "goal"].includes(f.category) && !f.deprecated);
    const open = g.intents.filter((i) => !i.concluded_at);
    const claimed = open.filter((i) => i.worker && i.status === "claimed");
    const cov = coverage(projectId);
    return {
      project: g.project,
      counts: {
        facts: facts.length, intents: g.intents.length, open: open.length,
        claimed: claimed.length, dead: g.intents.filter((i) => i.dead).length, hints: g.hints.length,
        assets: cov?.counts.assets ?? 0,
      },
      phase: cov?.phase ?? "P1",
      phaseLabel: cov?.phaseLabel ?? PHASE_LABEL.P1,
      coverage: cov ? { shallowPct: cov.pct.shallow, deepPct: cov.pct.deep, gaps: cov.counts.gaps, newSincePhase: cov.newSincePhase, canAdvanceTo: cov.canAdvanceTo } : null,
      stages: cov?.stages ?? null,
      untested: cov?.untested ?? { declared: false, count: 0, items: [] },
      reviews: cov?.reviews ?? { vuln: 0, reviewed: 0, pending: 0, challenged: 0 },
      openIntents: open.map((i) => ({ id: i.id, description: i.description, domain: i.domain, worker: i.worker ?? null, from: i.from })),
      recentFacts: facts.slice(-8).map((f) => ({ id: f.id, description: f.description, category: f.category })),
      hints: g.hints.slice(-5),
    };
  };

  return {
    db, findProject, createProject, ensureProject, getProject, listProjects, deleteProject, addFact, deprecateFact,
    proposeIntents, claimIntent, releaseIntent, concludeIntent, addHint, dropIntent, graph, summary,
    upsertAssets, listAssets, updateAsset, coverage, markSourceExhausted, advancePhase, endReconRound,
    setCheck, listChecks, assetCheckSummary, withChecks, addUntested, listUntested, declareUntested, reviewFact,
    close: () => { try { db.close(); } catch { /* 已关闭 */ } },
  };
}
