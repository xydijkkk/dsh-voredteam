// 门禁误报探针（手动跑）：哪些**合法**命令被拦？误拦会让模型放弃该测试面。
import { scanCommand } from "../plugins/vore-guard/lib/index.js";

const CASES = [
  "bloodhound-python -d corp.local -u user -p pass -ns 10.0.0.1 -c All",
  "bloodhound-python -u user -p pass -d corp.local -c All",
  "impacket-GetNPUsers corp.local/ -usersfile users.txt -dc-ip 10.0.0.1 -no-pass",
  "impacket-psexec corp/admin@target -hashes :aabbccddeeff",
  "KRB5CCNAME=admin.ccache impacket-secretsdump -k -no-pass dc.corp.local",
  "nxc smb 10.0.0.1 -u user -p pass",
  "curl -s -u admin:pass http://t/api/me",
  "curl -s -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y' http://t/api/me",
  "sqlmap -u 'http://t/?id=1' --batch --level 1",
  "python3 poc/login_probe.py --user admin --pass pass --once",
  "hashcat -m 1000 hashes.txt rockyou.txt",
  "john --wordlist=rockyou.txt hashes.txt",
  "ssh user@10.0.0.1 -i key.pem 'id'",
  "smbclient -L //10.0.0.1 -U user%pass",
  "redis-cli -h 10.0.0.1 INFO",
  "mysql -h 10.0.0.1 -u root -p'pass' -e 'select 1'",
  "curl -s http://t/api/user?id=1 -H 'Cookie: session=abc'",
  "amass enum -passive -d t.example",
  "subfinder -d t.example -silent",
  "httpx -l hosts.txt -sc -title",
];

for (const c of CASES) {
  const r = scanCommand(c);
  const why = r ? String(r.reason).replace("唯一门禁·", "").split("。")[0] : "";
  console.log(`${(r ? "拦截" : "放行").padEnd(4)} | ${why.slice(0, 46).padEnd(48)} | ${c.slice(0, 70)}`);
}
