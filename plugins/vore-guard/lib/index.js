// vore-guard —— 网络安全模式的**唯一门禁**。
//
// 三条规则（其余门禁已全部移除）：
//   1) 禁止 DDoS：洪水 / 压测 / 连接耗尽 / 并发打满
//   2) 禁止爆破：在线字典爆破与凭据填充（离线破解不算）
//   3) 模糊测试必须智能化低频：显式速率/线程上限，且不得超阈值
// 命中即拦，并在每一条拒绝里给出**合规的降级路径**（先小样本、低速率、去重、命中即停）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const name = "vore-guard";
export const inject = ["tools", "agentPresets"];
export const MODE_ID = "network-security";
/** 设置面板写入的限速配置（vore-guard 是它的**执行侧消费者**）。 */
export const SETTINGS_PATH = path.join(os.homedir(), ".dsh", "voredteam", "settings.json");
/** 出厂限速（settings.json 缺失/损坏时使用，与 vore-settings 的默认值保持一致）。 */
export const DEFAULT_RATE = { defaultRps: 5, wafRps: 1, fuzzSampleFirst: 50 };

/** 读限速配置（按 mtime 缓存，避免每次命令都读盘）。 */
export function makeRateLoader(settingsPath = SETTINGS_PATH) {
  let mtime = -1;
  let rate = DEFAULT_RATE;
  return function loadRate() {
    try {
      const st = fs.statSync(settingsPath);
      if (st.mtimeMs !== mtime) {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const r = parsed?.rate ?? {};
        rate = {
          defaultRps: Number.isFinite(Number(r.defaultRps)) ? Number(r.defaultRps) : DEFAULT_RATE.defaultRps,
          wafRps: Number.isFinite(Number(r.wafRps)) ? Number(r.wafRps) : DEFAULT_RATE.wafRps,
          fuzzSampleFirst: Number.isFinite(Number(r.fuzzSampleFirst)) ? Number(r.fuzzSampleFirst) : DEFAULT_RATE.fuzzSampleFirst,
        };
        mtime = st.mtimeMs;
      }
    } catch { /* 无配置文件/损坏 → 用出厂默认 */ }
    return rate;
  };
}

const CMD_TOOLS = new Set(["bash", "pwsh", "shell", "exec"]);

const normalize = (s) => String(s ?? "").replace(/\\\r?\n/g, " ").replace(/\s+/g, " ").trim();

/** 出厂文案（scanCommand 内会按当前设置重算，见 advice 变量）。 */
export const RATE_ADVICE =
  "合规做法（智能化低频）：先跑小样本确认命中特征 → 加显式速率上限 → 请求去重 → 命中即停并转人工复核。";

// ── 1) DDoS / 洪水 / 压测 ───────────────────────────────────────────────────
const DOS_PATTERNS = [
  [/\bhping3\b[^|;&]*--flood/i, "hping3 洪水模式"],
  [/\b(?:slowloris|slowhttptest|t50|mhddos|ddos-attack|goldeneye)\b/i, "低速/洪水攻击工具"],
  [/\b(?:wrk|vegeta|siege|jmeter|locust|hey|bombardier|k6)\b/i, "压测工具"],
  [/\bab\s+(?:-[a-z]*\s+)*-n\s*(\d{3,})/i, "ab 大请求量压测"],
  [/\b(?:--flood|--dos|-flood)\b/i, "洪水/DoS 参数"],
  [/\b(?:syn|udp|ack|icmp)[-_ ]?flood\b/i, "协议洪水"],
  [/\bnmap\b[^|;&]*--script[= ](?:dos|broadcast|flood)/i, "nmap DoS/broadcast 脚本"],
  [/\bmsfconsole?\b[^|;&]*\b(?:dos|flood)\b/i, "MSF DoS 模块"],
  [/\bxargs\b[^|;&]*-P\s*(\d{2,})/i, "xargs 高并发（≥10）"],
  [/\bwhile\s+true\s*;?\s*do\b[^|;&]*\bcurl\b/i, "无限循环压请求"],
  [/\bseq\s+\d+\s*\|\s*xargs\b[^|;&]*-P/i, "seq|xargs 并发压请求"],
];

// ── 2) 在线爆破 / 凭据填充 ─────────────────────────────────────────────────
/**
 * ⚠️ 这一条曾经写成 `/\b(?:--password-file|--passwords|-P)\s*[^\s|;&]+/i`，
 * `/i` 让它连**工具名里的 -p** 都算命中，于是把大量合法命令误判成"字典爆破"：
 *   `bloodhound-python …` → 匹配到 "-python"    `impacket-psexec …` → 匹配到 "-psexec"
 *   `impacket-… -no-pass` → 匹配到 "-pass"
 * 误拦的后果不是"更安全"，而是**模型被挡在合法测试面之外**（内网凭据复用、AD 枚举、
 * 无密码登录验证全在里面）。所以这里改成：只认显式长选项 + 爆破工具名，
 * 并且工具名必须出现在**命令词位置**（`;`/`|`/`&&` 之后或行首），避免 URL/路径里的
 * 同名子串（如 `.../MythicAgents/medusa`）被判成爆破工具。
 */
const BRUTE_PATTERNS = [
  [/(?:^|[\s;&|])(?:hydra|medusa|ncrack|patator|crowbar|brutex|wegong|web-brute)\b/i, "在线爆破工具"],
  [/(?:^|[\s;&|])hydra\b[^|;&]*\s-P\s/i, "hydra 字典攻击"],
  [/(?:^|[\s;&|])kerbrute\b/i, "kerbrute 域口令尝试（userenum / passwordspray / brute）"],
  [/(?:^|[\s;&|])(?:netexec|crackmapexec|nxc)\b/i, "CrackMapExec/NetExec 凭据喷洒"],
  [/\bnmap\b[^|;&]*--script[= ](?:brute|http-brute|ssh-brute)/i, "nmap 爆破脚本"],
  [/(?:^|[\s;&|])wpscan\b[^|;&]*(?:--passwords|-P\b)/i, "wpscan 口令爆破"],
  [/(?:^|[\s;&|])(?:--password-file|--passwords)\s+\S+/i, "字典文件驱动的口令尝试"],
  [/\bfor\s+\w+\s+in\s+\$\(cat\s+[^\s)]*(?:pass|pwd|user|account|dict)[^\s)]*\)/i, "脚本循环口令尝试"],
  [/\b(?:password|passwd|pwd)[-_ ]?(?:list|dict|wordlist|top\d+)\b/i, "口令字典文件"],
];

// ── 3) 模糊测试的低频强制（工具 → 速率/线程上限）────────────────────────────
//    [匹配正则, 工具名, 需要的显式限速参数正则, 出厂上限, 建议写法, 上限来源]
//    上限来源 rate = 取 settings.rate.defaultRps（面板可调，夹紧在 1..200）
const FUZZ_RULES = [
  [/\bffuf\b/i, "ffuf", /(?:^|\s)-rate\s+(\d+)/i, 50, "-rate <defaultRps 值>（或 -p 0.2 控速）", "rate"],
  [/\bferoxbuster\b/i, "feroxbuster", /--rate-limit\s+(\d+)/i, 50, "--rate-limit <defaultRps 值>", "rate"],
  [/\bdirsearch\b/i, "dirsearch", /(?:^|\s)-t\s+(\d+)/i, 10, "-t 5 --delay=0.2", "threads"],
  [/\bgobuster\b/i, "gobuster", /(?:^|\s)-t\s+(\d+)/i, 10, "-t 5 --delay 200ms", "threads"],
  [/\bwfuzz\b/i, "wfuzz", /(?:^|\s)-t\s+(\d+)/i, 10, "-t 5 -s 0.2", "threads"],
  [/\bnuclei\b/i, "nuclei", /(?:-rl|-rate-limit)\s+(\d+)/i, 50, "-rl <defaultRps 值> -c 5", "rate"],
  [/\barjun\b/i, "arjun", /(?:^|\s)-t\s+(\d+)/i, 10, "-t 5 --stable", "threads"],
];

/** 扫描一条命令（导出的纯函数，供测试）。rate 可注入（默认出厂值）。 */
export function scanCommand(command, rate = DEFAULT_RATE) {
  const cmd = normalize(command);
  if (!cmd) return null;
  const rps = Number(rate?.defaultRps) || DEFAULT_RATE.defaultRps;
  const sample = Number(rate?.fuzzSampleFirst) || DEFAULT_RATE.fuzzSampleFirst;
  const advice = `合规做法（智能化低频）：先跑 ≤${sample} 条样本确认命中特征 → 加显式速率上限（当前设置 ${rps} req/s，WAF/生产目标更低）→ 请求去重 → 命中即停并转人工复核。`;

  for (const [re, label] of DOS_PATTERNS) {
    if (re.test(cmd)) {
      return {
        block: true,
        reason: `唯一门禁·禁止 DDoS：检测到「${label}」。洪水、压测、连接耗尽、并发打满一律禁止（可能打挂目标并触发风控）。`,
        downgrade: `降级替代：改单点最小验证——1~3 个请求确认现象；需要覆盖度时按目录/接口清单逐条串行请求，串行 + 间隔 ≥0.5s。${advice}`,
      };
    }
  }

  for (const [re, label] of BRUTE_PATTERNS) {
    if (re.test(cmd)) {
      return {
        block: true,
        reason: `唯一门禁·禁止爆破：检测到「${label}」。不做字典爆破与凭据填充（会造成账号锁定、风控封禁、服务不可用）。`,
        downgrade: "降级替代：① 用已知/泄露凭据或默认凭据做**单次**登录验证（≤3 次尝试）；② 改为在其他面找凭据（JS 硬编码、配置泄露、接口越权）；③ 离线哈希破解（hashcat/john，本地运行）不受限。",
      };
    }
  }

  for (const [toolRe, toolName, rateRe, factoryCap, suggest, kind] of FUZZ_RULES) {
    if (!toolRe.test(cmd)) continue;
    // 上限来源：rate 类取 settings.rate.defaultRps；threads 类取 min(出厂, rps×2)
    const cap = kind === "threads"
      ? Math.max(2, Math.min(factoryCap, Math.round(rps * 2)))
      : Math.max(1, Math.min(factoryCap, Math.round(rps)));
    const suggestText = String(suggest).replace("<defaultRps 值>", String(cap));
    const m = cmd.match(rateRe);
    if (!m) {
      return {
        block: true,
        reason: `唯一门禁·模糊测试必须智能化低频：${toolName} 未带显式速率/线程上限（当前上限 ${cap}）。`,
        downgrade: `合规写法：加 ${suggestText} 后重试。${advice}`,
      };
    }
    const value = Number(m[1]);
    if (Number.isFinite(value) && value > cap) {
      return {
        block: true,
        reason: `唯一门禁·模糊测试速率超阈值：${toolName} 设置 ${m[0].trim()}（当前上限 ${cap}；面板设置 defaultRps=${rps}）。`,
        downgrade: `合规写法：改成 ${suggestText}；先小样本（≤${sample}）确认字典质量，再决定是否放量。${advice}`,
      };
    }
  }

  // nmap 全端口 / 大范围扫描：必须给出**速率上限**。
  // 曾经的判定是"有 --max-rate 或 -T2/3/4 或 --min-rate 就算合规"，两个方向都错：
  //   · `-T4` 只是时序模板，不约束 pps；`--min-rate 5000` 是**速率下限**（越扫越快），
  //     它恰恰是最激进的选项，却被当成"已限速"放行；
  //   · `--max-rate` 给了值也不夹紧，`--max-rate 20000` 照样放行。
  // 实测（改造前）：`nmap -p- -T4` / `nmap -p- --min-rate 5000` / `nmap -p- --max-rate 20000` 全部放行。
  if (/\bnmap\b/i.test(normalize(cmd))) {
    // 什么算"大范围"：全端口 -p- / -p 1-65535 / 跨度 ≥2000 的 -p a-b / --top-ports ≥1000。
    // （`--top-ports 100` 是给用户的保守替代方案，必须放行，否则建议本身会被拦。）
    const range = /(?:^|\s)-p\s*(\d{1,5})-(\d{1,5})/i.exec(cmd);
    const topPorts = /--top-ports\s*(\d+)/i.exec(cmd);
    const wide = /(?:^|\s)-p-/.test(cmd)
      || (range && Number(range[2]) - Number(range[1]) >= 2000)
      || (topPorts && Number(topPorts[1]) >= 1000);
    if (wide) {
      if (/(?:^|\s)--min-rate\b/i.test(cmd)) {
        return {
          block: true,
          reason: "唯一门禁·速率纪律：nmap `--min-rate` 是速率**下限**（强制不低于该速率发出，越扫越快），与低频纪律相反。",
          downgrade: "合规写法：用 `--max-rate 300 -T3` 控制上限；需要先做概览时 `--top-ports 100`。",
        };
      }
      const maxRate = /(?:^|\s)--max-rate\s+(\d+)/i.exec(cmd);
      const nmapCap = Math.max(100, Math.min(1000, Math.round(rps * 60)));
      if (!maxRate) {
        return {
          block: true,
          reason: `唯一门禁·速率纪律：nmap 全端口/大范围扫描未带 \`--max-rate\`（\`-T2/-T3/-T4\` 只是时序模板，不限制每秒包数）。当前上限 ${nmapCap}。`,
          downgrade: `合规写法：加 \`--max-rate ${Math.min(nmapCap, 300)} -T3\`（更保守用 \`--max-rate 100\`），或先 \`--top-ports 100\` 概览再定向。`,
        };
      }
      if (Number(maxRate[1]) > nmapCap) {
        return {
          block: true,
          reason: `唯一门禁·速率纪律：nmap \`--max-rate ${maxRate[1]}\` 超过上限 ${nmapCap}（上限 = defaultRps ${rps} × 60，夹紧在 100..1000）。`,
          downgrade: `合规写法：改成 \`--max-rate ${Math.min(nmapCap, 300)} -T3\`；确需更快时先在设置面板调 defaultRps 并说明理由。`,
        };
      }
    }
  }

  return null;
}

export function buildGuard({ resolveMode, appendLog, logFile, rate } = {}) {
  return function guard(exec) {
    if (!exec || !CMD_TOOLS.has(exec.name)) return undefined;
    const mode = typeof resolveMode === "function" ? resolveMode(exec.agent) : undefined;
    // 网络安全模式会话及其子 agent（预设解析为空时同样受控）
    if (mode !== undefined && mode !== MODE_ID && mode !== "") return undefined;
    const command = exec.arguments?.command ?? exec.arguments?.cmd;
    if (typeof command !== "string") return undefined;
    const hit = scanCommand(command, typeof rate === "function" ? rate() : rate);
    if (!hit) return undefined;
    try { appendLog?.(logFile, exec, hit); } catch { /* 审计失败不阻塞拦截 */ }
    return `${hit.reason}\n${hit.downgrade}`;
  };
}

export function appendGuardLog(file, exec, hit) {
  if (!file) return;
  const line = `| ${new Date().toISOString()} | ${exec.name} | ${hit.reason.split("：")[0]} | ${normalize(exec.arguments?.command ?? exec.arguments?.cmd).slice(0, 120).replace(/\|/g, "/")} |\n`;
  try {
    if (!fs.existsSync(file)) fs.writeFileSync(file, "# vore 门禁审计（vore-guard 自动留痕）\n\n| 时间 | 工具 | 判定 | 命令片段 |\n|---|---|---|---|\n" + line, "utf8");
    else fs.appendFileSync(file, line, "utf8");
  } catch { /* 审计失败不阻塞 */ }
}

export function apply(ctx, config) {
  const resolveMode = (agent) => {
    try {
      const p = ctx.agentPresets.composedPreset(agent?.ctx);
      return typeof p === "string" ? p : undefined;
    } catch { return undefined; }
  };
  // 门禁阈值由设置面板的 settings.json 提供（vore-settings 写入 → vore-guard 执行）
  const loadRate = makeRateLoader(config?.settingsPath ?? SETTINGS_PATH);
  ctx.tools.guard((exec) => {
    if (!exec || !CMD_TOOLS.has(exec.name)) return undefined;
    const mode = resolveMode(exec.agent);
    if (mode !== undefined && mode !== MODE_ID && mode !== "") return undefined;
    const command = exec.arguments?.command ?? exec.arguments?.cmd;
    if (typeof command !== "string") return undefined;
    const hit = scanCommand(command, loadRate());
    if (!hit) return undefined;
    const cwd = exec?.agent?.session?.header?.cwd;
    const file = config?.logFile ?? (typeof cwd === "string" && cwd ? path.join(cwd, "vore-guard-log.md") : null);
    appendGuardLog(file, exec, hit);
    return `${hit.reason}\n${hit.downgrade}`;
  });
}
