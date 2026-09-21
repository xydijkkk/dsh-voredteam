// 列出**我们自己的**文件里泄漏本机路径的具体行（vendor/ 是第三方内容，单独统计）。
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;
const re = /C:\\+Users\\+user\\+Desktop[^\s"')]*/g;
const rows = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.isFile() || fs.statSync(p).size > 8e6) continue;
    let text;
    try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    const rel = path.relative(root, p).replace(/\\/g, "/");
    re.lastIndex = 0;
    const hits = [...text.matchAll(re)].map((m) => m[0]);
    if (hits.length) rows.push({ rel, hits, vendor: rel.startsWith("vendor/") });
  }
})(root);

const ours = rows.filter((r) => !r.vendor);
const vendor = rows.filter((r) => r.vendor);
console.log(`我们自己的文件：${ours.length} 个`);
for (const r of ours) {
  const uniq = [...new Set(r.hits)];
  console.log(`\n  ${r.rel}  (${r.hits.length} 处)`);
  for (const u of uniq.slice(0, 4)) console.log(`      ${u}`);
  if (uniq.length > 4) console.log(`      …另 ${uniq.length - 4} 种`);
}
console.log(`\nvendor/（第三方内容，保持原样）：${vendor.length} 个文件`);
const kinds = new Set();
for (const r of vendor) for (const h of r.hits) kinds.add(h.replace(/\\[^\\]+$/, "\\…"));
for (const k of [...kinds].slice(0, 10)) console.log(`  ${k}`);
