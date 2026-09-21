import fs from "node:fs";
import * as P from "../plugins/vore-console/lib/pure.mjs";
const ROUTE = "http://127.0.0.1:3080/vore-blackboard";
const post = async (ep, body) => {
  const t = await (await fetch(`${ROUTE}/csrf`)).json();
  const r = await fetch(`${ROUTE}/${ep}`, { method: "POST", headers: { "content-type": "application/json", "x-dsh-csrf": t.token }, body: JSON.stringify(body || {}) });
  return r.json();
};
const cov = await post("coverage", { projectId: "eng_002" });
const assets = cov.assets || [];
const l = P.computeLayout({ facts: [], intents: [] }, cov.coverage, assets);
console.log("lane            y     h   counted  subRows                          hint");
for (const lane of l.lanes) {
  console.log(
    lane.label.padEnd(14),
    String(lane.y).padStart(5), String(lane.h).padStart(5), String(!!lane.counted).padStart(8),
    " ", (lane.subRows || []).map((s) => `${s.label}:${s.count}@${s.y}`).join(" ") || "-",
    " ", lane.hint || "");
}
console.log("\nlayout:", l.width + " x " + l.height, "lanes:", l.lanes.length, "nodes:", l.nodes.length);
const boxes = [["说明：普通分栏画布", 1100, 420], ["全屏 1920x1080（减去顶栏/右栏）", 1590, 900], ["全屏 2560x1440", 2230, 1240], ["旧行为：进全屏瞬间量到的小窗", 1100, 420]];
for (const [name, w, h] of boxes) {
  const z = P.fitZoom(l.width, l.height, w, h);
  const coverW = (l.width * z) / w, coverH = (l.height * z) / h;
  console.log(`${name.padEnd(34)} box=${w}x${h} zoom=${z.toFixed(3)} 覆盖 宽${(coverW*100).toFixed(0)}% 高${(coverH*100).toFixed(0)}%`);
}
