import type { Asset, Snapshot } from "./model";
export interface Candidate {
  mac: string;
  ip: string;
  name: string;
  suggestedKind: "device" | "environment";
  warning: string;
}
export function networkCandidates(text: string): Candidate[] {
  if (text.length > 5 * 1024 * 1024) throw Error("网络清单不能超过 5 MB");
  let rows: {
    mac?: unknown;
    ip?: unknown;
    ip_addr?: unknown;
    hostname?: unknown;
    name?: unknown;
    comment?: unknown;
  }[];
  if (text.trim().startsWith("[")) {
    rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw Error("请提供 JSON 数组");
  } else
    rows = text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4)
          throw Error("请提供 dnsmasq DHCP leases 或 JSON 数组");
        return {
          mac: parts[1],
          ip: parts[2],
          hostname: parts[3] === "*" ? "" : parts[3],
        };
      });
  const found = new Map<string, Candidate>();
  for (const r of rows) {
    if (!r || typeof r !== "object") throw Error("设备条目无效");
    const mac = String(r.mac || "")
      .replaceAll("-", ":")
      .toLowerCase();
    if (
      !/^([\da-f]{2}:){5}[\da-f]{2}$/.test(mac) ||
      mac === "00:00:00:00:00:00"
    )
      throw Error("设备清单包含无效 MAC");
    const ip = String(r.ip || r.ip_addr || "");
    if (
      ip &&
      (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ||
        ip.split(".").some((n) => Number(n) > 255))
    )
      throw Error("设备清单包含无效 IPv4");
    let name = String(r.name || r.hostname || r.comment || ip || mac);
    try {
      name = decodeURIComponent(name);
    } catch {
      /* Keep source label if it is not percent-encoded. */
    }
    if (name.length > 200) throw Error("设备名称过长");
    const virtual = /\bVM\s*\d+|虚拟机/i.test(name);
    found.set(mac, {
      mac,
      ip,
      name,
      suggestedKind: virtual ? "environment" : "device",
      warning: virtual
        ? "疑似虚拟机，需核对宿主"
        : "仅网络观测，型号 / 使用人未确认",
    });
  }
  return [...found.values()];
}
export function candidateAsset(
  c: Candidate,
  kind: "device" | "environment",
  snapshot: Snapshot,
  observedAt: string,
  source: string,
): Asset {
  const matches = snapshot.assets.filter(
    (a) => a.fields.mac?.toLowerCase().replaceAll("-", ":") === c.mac,
  );
  if (matches.length > 1) throw Error(`${c.mac} 对应多条登记，请先人工去重`);
  const existing = matches[0];
  if (existing && existing.kind !== kind)
    throw Error(`${c.name} 已登记为其他类型，请核对`);
  return {
    id: existing?.id || `network:${c.mac}`,
    kind,
    name: c.name,
    status: "active",
    fields: { mac: c.mac, ip: c.ip, observed_at: observedAt, evidence: source },
  };
}
