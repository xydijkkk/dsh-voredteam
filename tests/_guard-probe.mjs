// 门禁边界探针（手动跑，不进 npm test）：把"合法但可能被误拦"的命令过一遍 scanCommand。
// 关注点：竞态/并发类测试所需的**低并发批处理**是否被拦。
import { scanCommand } from "../plugins/vore-guard/lib/index.js";

const CASES = [
  ["低频模糊（基准，必须放行）", "ffuf -u http://t/FUZZ -w d.txt -rate 5"],
  ["单请求", "curl -s -o /dev/null -w '%{http_code}' http://t/api/v1/order?id=1"],
  ["xargs 并发 9", "xargs -P 9 -I{} curl -s http://t/{} < urls.txt"],
  ["xargs 并发 5", "xargs -P 5 -I{} curl -s http://t/{} < urls.txt"],
  ["xargs 并发 3", "xargs -P 3 -I{} curl -s http://t/{} < urls.txt"],
  ["seq|xargs 并发 5（竞态小批）", "seq 1 5 | xargs -P 5 -I{} curl -s http://t/coupon/redeem"],
  ["seq|xargs 并发 50（应拦）", "seq 1 10000 | xargs -P 50 -I{} curl -s http://t/?id={}"],
  ["curl 并行 -Z", "curl -Z --parallel-max 5 -K urls.txt"],
  ["shell 后台并发 5", "for i in $(seq 1 5); do curl -s http://t/coupon & done; wait"],
  ["python 竞态脚本", "python poc/race_coupon.py --concurrency 5 --rounds 1"],
  ["ab 小并发", "ab -n 20 -c 5 http://t/"],
  ["hey 小并发", "hey -n 20 -c 5 http://t/"],
  ["vegeta 小并发", "echo 'GET http://t/' | vegeta attack -rate 5 -duration 2s"],
  ["nmap 限速", "nmap -T2 --max-rate 50 -p 80,443 t"],
  ["nmap 高速率", "nmap -T4 --max-rate 5000 -p- t"],
  ["k6 小并发", "k6 run --vus 5 --duration 2s script.js"],
  ["curl --limit-rate", "curl --limit-rate 10k -s http://t/"],
  ["wrk 压测（应拦）", "wrk -t2 -c10 -d5s http://t/"],
  ["curl 循环 20 次（人工限速）", "for i in 1 2 3 4 5; do curl -s http://t/coupon -o /dev/null; sleep 0.3; done"],
];

let blocked = 0;
for (const [label, cmd] of CASES) {
  const r = scanCommand(cmd);
  const verdict = r ? `拦截（${String(r.reason).replace(/^唯一门禁·/, "").split("。")[0]}）` : "放行";
  if (r) blocked++;
  console.log(`${verdict.padEnd(58)} | ${label}\n${" ".repeat(58)} | ${cmd}`);
}
console.log(`\n共 ${CASES.length} 条，拦截 ${blocked} 条`);
