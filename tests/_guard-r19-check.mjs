// 用 R19 当时真实被拦的命令，验证修复后的门禁是否已放行（并展示旧规则为何会命中）
// 当时那条命令里带了"某次作业的证据目录"绝对路径 —— 公开仓库里不留真实路径，
// 需要复现时用环境变量给：$env:VORE_EVIDENCE_DIR="<证据目录>"
import { scanCommand } from "../plugins/vore-guard/lib/index.js";

const EVIDENCE = process.env.VORE_EVIDENCE_DIR ?? "C:\\path\\to\\evidence";
const cases = [
  ['foreach($d in $dirs){ Write-Host $d }', "R19 第一条被拦（片段）"],
  [`$inv="${EVIDENCE}"; if(Test-Path $inv){ Write-Host "ok" }`, "R19 第二条被拦"],
  [`Test-Path "${EVIDENCE}"`, "R19 第三条被拦"],
  ['Get-ChildItem -Path . -Recurse -File | Measure-Object -Property Length -Sum', "普通 -Path 用法"],
  ['Get-Content -Path x.txt -Raw', "普通 -Path 用法 2"],
  ['Copy-Item -Path a.txt -Destination b.txt', "Copy-Item -Path"],
  ['hydra -L users.txt -P pass.txt target http-post-form', "真爆破（应仍拦）"],
  ['Test-Path "C:\\x"; hydra -L u -P p t ssh', "混在一条真爆破（应拦）"],
];

const OLD = /\b(?:--password-file|--passwords|-P)\s*[^\s|;&]+/i;   // 修复前的规则
for (const [c, label] of cases) {
  const now = scanCommand(c);
  const old = OLD.test(c) ? OLD.exec(c)[0] : null;
  console.log(`${(now ? "拦截" : "放行").padEnd(4)} | 旧规则命中=${JSON.stringify(old)} | ${label}`);
  console.log(`     ${c.slice(0, 100)}`);
}
