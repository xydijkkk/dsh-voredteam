// 发布前隐私扫描：仓库里有没有本机绝对路径（会泄漏用户名 / 目录结构）。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;
const pats = [
  [/C:\\+Users\\+[^\s"')]+/g, "Windows 用户路径"],
  [/\/Users\/[A-Za-z0-9_.-]+\//g, "macOS 用户路径"],
  [/C:\\+Users\\+user\\+Desktop[^\s"')]*/g, "Desktop 具体路径"],
];
const hits = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.isFile() || fs.statSync(p).size > 8e6) continue;
    let text;
    try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    for (const [re, name] of pats) {
      re.lastIndex = 0;
      const m = text.match(re);
      if (!m) continue;
      const rel = path.relative(root, p).replace(/\\/g, "/");
      const cur = hits.get(rel) ?? { n: 0, kinds: new Set() };
      cur.n += m.length; cur.kinds.add(name);
      hits.set(rel, cur);
    }
  }
})(root);

const rows = [...hits.entries()].sort((a, b) => b[1].n - a[1].n);
console.log(`含本机路径的文件：${rows.length} 个，命中 ${rows.reduce((n, r) => n + r[1].n, 0)} 处`);
for (const [f, v] of rows.slice(0, 20)) console.log(`  ${String(v.n).padStart(4)}  ${f}  [${[...v.kinds].join("/")}]`);
