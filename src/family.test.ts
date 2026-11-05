import { describe, it, expect } from "vitest";
import {
  connections,
  currentUses,
  empty,
  usageLabel,
  type Asset,
  type Link,
  type Snapshot,
} from "./model";
const a = (
  id: string,
  kind: Asset["kind"],
  fields: Asset["fields"] = {},
): Asset => ({ id, kind, name: id, status: "active", fields });
const uses = (id: string, from: string, attrs: Link["attrs"]): Link => ({
  id,
  type: "uses",
  from,
  to: "laptop",
  attrs: { usage_role: "primary", ...attrs },
});
function family(): Snapshot {
  return {
    ...structuredClone(empty),
    assets: [
      a("me", "person"),
      a("child", "person"),
      a("company", "person"),
      a("laptop", "device", { owner_id: "company", location: "公司" }),
    ],
    links: [
      uses("old", "me", { starts_on: "2025-01-01", ends_on: "2026-10-01" }),
      uses("new", "child", { starts_on: "2026-10-01", usage_role: "backup" }),
    ],
  };
}
describe("家庭资产模型", () => {
  it("产权和使用人分离，按日期查询使用历史", () => {
    const s = family();
    expect(currentUses(s, "laptop", "2026-09-30")[0].from).toBe("me");
    expect(currentUses(s, "laptop", "2026-10-01")[0].from).toBe("child");
    expect(usageLabel(s.assets[3], s)).toMatch(/^child · /);
    expect(s.assets[3].fields.owner_id).toBe("company");
  });
  it("硬盘到系统和设备关系双向可追踪", () => {
    const s = family();
    s.assets.push(
      a("disk", "device", { device_kind: "ssd", parent_id: "laptop" }),
      a("linux", "environment", { storage_id: "disk" }),
    );
    expect(
      connections(s.assets[4], s)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["laptop", "linux"]);
  });
});
