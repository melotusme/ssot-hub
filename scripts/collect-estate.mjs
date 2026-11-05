// Explicit, read-only inventory. Never reads authentication files or application contents.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const exec = promisify(execFile);
const [mode, destination, target] = process.argv.slice(2);
if (!["mac", "pve"].includes(mode) || !destination ||
    (mode === "pve" && (!target || !/^[\w.@:-]+$/.test(target) || target.startsWith("-"))))
  throw Error("Usage: node scripts/collect-estate.mjs mac|pve private/new-directory [user@host]");
const observedAt = new Date().toISOString(), assets = [], gaps = [];
const id = (key) => `inv-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
const run = async (command, args) => (await exec(command, args, {timeout: 120000, maxBuffer: 32*1024*1024})).stdout;
const remote = (command) => run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes", target, command]);
const attempt = async (scope, fn) => {try {return await fn();} catch {gaps.push(`${scope} 未完成；未据此推断不存在`);return null;}};
function add(kind, key, name, fields = {}) {
  const a = {id:id(key), kind, name, status:"active", fields:{verification:"observed", observed_at:observedAt, evidence:`只读盘点：${mode}`, ...fields}};
  assets.push(a);return a.id;
}
if (mode === "mac") {
  if (process.platform !== "darwin") throw Error("mac collection requires macOS");
  const hw = JSON.parse(await run("system_profiler", ["SPHardwareDataType", "-json"])).SPHardwareDataType[0];
  const os = (await run("sw_vers", ["-productVersion"])).trim();
  const key = `mac/${hw.platform_UUID}`;
  const device = add("device", key, `本机 ${hw.machine_name} · ${hw.chip_type}`, {device_kind:"laptop", platform:"macOS", model:`${hw.machine_model} · ${hw.chip_type} · ${hw.physical_memory}`, review_note:"所在地、所有者和用途待确认"});
  const env = add("environment", `${key}/os`, `本机 macOS ${os}`, {device_id:device, os:"macOS", version:os, environment_kind:"physical", runtime_state:"running"});
  const apps = await attempt("macOS 应用清单", async()=>JSON.parse(await run("system_profiler", ["SPApplicationsDataType", "-json"])));
  const seen = new Set();
  for (const app of apps?.SPApplicationsDataType || []) {
    const path = app.path || "";
    if (!path.startsWith("/Applications/") && !path.startsWith(`${process.env.HOME}/Applications/`)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    add("software", `${key}/app/${path}`, app._name || path.split("/").at(-1), {environment_id:env, source:"app", manager:"macOS Applications", path, version:app.version || "", enabled_state:"unknown", runtime_state:"unknown"});
  }
  const brew = await attempt("Homebrew 包", async()=>JSON.parse(await run("/opt/homebrew/bin/brew", ["info", "--json=v2", "--installed"])));
  for (const item of brew?.formulae || []) {
    add("software", `${key}/brew/${item.full_name}`, item.full_name, {environment_id:env, source:"brew", manager:"homebrew", package_kind:"formula", path:`brew://formula/${item.full_name}`, version:(item.installed || []).map(x=>x.version).join(", "), enabled_state:"unknown", runtime_state:"unknown"});
  }
  // Casks are package receipts, not independent installed app instances; no double count.
  gaps.push("Homebrew cask 收据未重复计入；应用按安装路径计数，不代表日常在用");
  gaps.push("未扫描 npm/pip/容器内部软件、账号登录或文件内容；未挂载的 SSD / NAS 不代表不存在");
  const mounted = (await run("/bin/ls", ["/Volumes"])).trim().split("\n");
  gaps.push(`本机挂载点：${mounted.join("、")}；挂载点不自动当作实体硬盘`);
} else {
  const hostname = (await remote("hostname")).trim();
  const version = (await remote("pveversion")).trim();
  const key = `pve/${hostname}/${target.split("@").at(-1)}`;
  const device = add("device", key, `PVE 迷你主机 · ${hostname}`, {device_kind:"mini_pc", platform:"PVE", ip:target.split("@").at(-1), review_note:"公司位置来自用户描述；与路由器候选的实体映射待核对"});
  const env = add("environment", `${key}/os`, `${hostname} · PVE`, {device_id:device, os:"Proxmox VE", version, environment_kind:"physical", runtime_state:"running"});
  const guests = JSON.parse(await remote("pvesh get /cluster/resources --type vm --output-format json"));
  for (const vm of guests) {
    const guest = add("environment", `${key}/${vm.type}/${vm.vmid}`, `${vm.name || "未命名"} · VM ${vm.vmid}`, {host_id:env, environment_kind:vm.type === "lxc" ? "container" : "vm", vmid:String(vm.vmid), runtime_state:vm.status === "running" ? "running" : "stopped", role:"虚拟环境；不能当作独立物理 NAS / 电脑", review_note:"系统名称取自 PVE 标签；客户机实际系统/软件未核实"});
    const cfg = await attempt(`VM ${vm.vmid} 配置`, async()=>JSON.parse(await remote(`pvesh get /nodes/${vm.node}/${vm.type}/${vm.vmid}/config --output-format json`)));
    const a = assets.find(x=>x.id===guest);
    const net = Object.entries(cfg || {}).filter(([k])=>/^net\d+$/.test(k)).map(([k,v])=>`${k}: ${v}`);
    a.fields.notes = net.join("\n");
  }
  const packages = await attempt("PVE 软件包", ()=>remote("dpkg-query -W -f='${binary:Package}\\t${Version}\\n'"));
  for (const line of packages?.trim().split("\n") || []) {
    const [name, version] = line.split("\t");
    if (!name || !version) continue;
    add("software", `${key}/package/${name}`, name, {environment_id:env, source:"other", manager:"dpkg", package_kind:"system-package", path:`dpkg://${name}`, version, enabled_state:"unknown", runtime_state:"unknown"});
  }
  for (const service of ["zerotier-one", "tailscaled"]) {
    const state = await attempt(`${service} 状态`, ()=>remote(`systemctl show ${service}.service --property=LoadState,ActiveState,UnitFileState`));
    if (!state || !state.includes("LoadState=loaded")) continue;
    const installed = assets.find(a=>a.kind==="software" && a.name===(service==="tailscaled"?"tailscale":service));
    if (installed) {
      installed.fields.runtime_state = state.includes("ActiveState=active")?"running":"stopped";
      installed.fields.enabled_state = state.includes("UnitFileState=enabled")?"enabled":state.includes("UnitFileState=disabled")?"disabled":"unknown";
      installed.fields.review_note="服务状态不等于隧道连通或实际速度";
    }
  }
  gaps.push("未进入客户机或读取穿透密钥；未验证隧道连通性；NAS 虚拟机不等于用户的两台实体 NAS");
}
const dir = resolve(destination);
await mkdir(dir,{mode:0o700});
const counts = Object.fromEntries([...new Set(assets.map(a=>a.kind))].map(k=>[k,assets.filter(a=>a.kind===k).length]));
const manifest = {format:"ssot-inventory/v1", source:`${mode} read-only observation`, observedAt, assets, gaps};
await writeFile(resolve(dir,"inventory.json"), JSON.stringify(manifest,null,2), {flag:"wx",mode:0o600});
await writeFile(resolve(dir,"summary.md"), `# 只读盘点\n\n观测：${observedAt}\n\n${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join("\n")}\n\n## 边界\n\n${gaps.map(s=>`- ${s}`).join("\n")}\n`, {flag:"wx",mode:0o600});
console.log(JSON.stringify({directory:dir,observedAt,counts,gaps},null,2));
