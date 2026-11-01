// Read-only OpenWrt observation; never infer a person, model or physical device from a MAC.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const run = promisify(execFile);
const [target, controlPath, output] = process.argv.slice(2);
if (
  !target ||
  !controlPath ||
  !output ||
  !/^[\w.@:-]+$/.test(target) ||
  target.startsWith("-")
)
  throw Error(
    "Usage: node scripts/collect-router-inventory.mjs user@host control-socket private/output-dir",
  );
const commands = {
  board: "ubus call system board",
  leases: "cat /tmp/dhcp.leases",
  neighbors: "ip -4 neigh show dev br-lan",
  staticHosts: "uci -q show dhcp | grep -E '=host$|\\.name=|\\.mac=|\\.ip='",
  routerMac: "cat /sys/class/net/br-lan/address",
  addresses: "ip -4 addr show dev br-lan",
};
const raw = Object.fromEntries(
  await Promise.all(
    Object.entries(commands).map(async ([name, command]) => {
      const { stdout } = await run(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=8",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `ControlPath=${controlPath}`,
          target,
          command,
        ],
        { timeout: 15000, maxBuffer: 1024 * 1024 },
      );
      return [name, stdout];
    }),
  ),
);
const observedAt = new Date().toISOString(),
  board = JSON.parse(raw.board),
  entries = new Map();
const ipv4 = (value) =>
  value.split(".").reduce((n, octet) => (n * 256 + Number(octet)) >>> 0, 0);
const networks = [
  ...raw.addresses.matchAll(/inet (\d+\.\d+\.\d+\.\d+)\/(\d+)/g),
].map(([, ip, bits]) => ({
  ip,
  mask: (0xffffffff << (32 - Number(bits))) >>> 0,
}));
if (!networks.length)
  throw Error("No observed LAN IPv4 prefix; refusing to infer one");
const inLan = (ip) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
  networks.some((n) => (ipv4(ip) & n.mask) === (ipv4(n.ip) & n.mask));
const add = (mac, ip, name, source, state) => {
  mac = mac.toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return;
  if (ip && !inLan(ip)) return; // Observed LAN prefixes only, never routed/VPN neighbors.
  const e = entries.get(mac) || {
    mac,
    ip: "",
    name: "",
    ips: [],
    sources: [],
    networkState: "not-observed",
    warnings: [],
  };
  if (ip && !e.ips.includes(ip)) e.ips.push(ip);
  if (ip && (source === "neighbor" || !e.ip)) e.ip = ip;
  if (
    name &&
    name !== "*" &&
    !/^[0-9a-f]{12}$/i.test(name) &&
    (!e.name || source === "dhcp")
  )
    e.name = name;
  if (!e.sources.includes(source)) e.sources.push(source);
  if (state) e.networkState = state;
  entries.set(mac, e);
};
for (const line of raw.leases.trim().split(/\r?\n/).filter(Boolean)) {
  const [, mac, ip, name] = line.split(/\s+/);
  add(mac, ip, name, "dhcp");
}
const hosts = {};
for (const line of raw.staticHosts.split(/\r?\n/)) {
  const m = line.match(/^dhcp\.([\w-]+)\.(name|mac|ip)='([^']*)'$/);
  if (m) (hosts[m[1]] ||= {})[m[2]] = m[3];
}
for (const h of Object.values(hosts))
  if (h.mac) add(h.mac, h.ip, h.name, "static");
let neighborCount = 0;
for (const line of raw.neighbors.split(/\r?\n/)) {
  const m = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+lladdr\s+([\da-f:]+)\s+(\w+)/i);
  if (m && inLan(m[1])) {
    add(m[2], m[1], "", "neighbor", m[3]);
    neighborCount++;
  }
}
add(raw.routerMac.trim(), networks[0].ip, board.hostname, "router", "self");
const candidates = [...entries.values()].sort(
  (a, b) => Number(a.ip.split(".").at(-1)) - Number(b.ip.split(".").at(-1)),
);
for (const c of candidates) {
  c.name ||= `待确认设备 · ${c.ip}`;
  if (c.ips.length > 1) c.warnings.push("多地址观测，须人工核对");
  if (c.mac.startsWith("bc:24:11:"))
    c.warnings.push("PVE 常见 MAC 前缀，疑似虚拟机，不作为实体硬件确认");
  if (parseInt(c.mac.slice(0, 2), 16) & 2)
    c.warnings.push("本地管理 MAC，可能是随机地址或虚拟接口，不等于独立硬件");
  if (c.networkState === "not-observed")
    c.warnings.push("本次邻居表未观测到，不代表已报废或必然离线");
  c.warnings.push("使用人、主备用途、型号均待确认");
}
const dir = resolve(output);
await mkdir(dir, { recursive: true, mode: 0o700 });
const write = (name, value) =>
  writeFile(resolve(dir, name), value, { mode: 0o600, flag: "wx" });
const counts = {
  dhcpLeases: raw.leases.trim().split(/\r?\n/).filter(Boolean).length,
  staticReservations: Object.keys(hosts).length,
  lanNeighbors: neighborCount,
  uniqueMacCandidatesIncludingRouter: candidates.length,
};
await write(
  "observations.json",
  JSON.stringify({ observedAt, board, counts, raw, candidates }, null, 2),
);
await write(
  "candidates.json",
  JSON.stringify(
    candidates.map((c) => ({
      mac: c.mac,
      ip: c.ip,
      hostname: c.name,
      comment: c.warnings.join("；"),
    })),
    null,
    2,
  ),
);
await write(
  "inventory.md",
  `# 家庭网络观测清单\n\n采集：${observedAt}。只读 SSH，未改路由器配置。DHCP ${counts.dhcpLeases} 条、静态绑定 ${counts.staticReservations} 条、LAN 邻居 ${counts.lanNeighbors} 条，按 MAC 合并后含路由器 ${candidates.length} 个候选；不是物理设备数量。REACHABLE 为采集时邻居状态，STALE 不是离线判定。\n\n| 名称 | IP | MAC | 观测状态 | 来源 | 待核对 |\n|---|---|---|---|---|---|\n${candidates.map((c) => `| ${c.name.replaceAll("|", "\\|")} | ${c.ip} | ${c.mac} | ${c.networkState} | ${c.sources.join(", ")} | ${c.warnings.join("；")} |`).join("\n")}\n`,
);
console.log(JSON.stringify({ output: dir, observedAt, counts }, null, 2));
