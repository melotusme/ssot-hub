import { describe, it, expect } from "vitest";
import {
  empty,
  currentAssignments,
  connections,
  type Asset,
  type Snapshot,
} from "./model";
const a = (
  id: string,
  kind: Asset["kind"],
  fields: Asset["fields"] = {},
): Asset => ({ id, kind, name: id, status: "active", fields });
function family(): Snapshot {
  return {
    ...structuredClone(empty),
    assets: [
      a("me", "person"),
      a("child", "person"),
      a("company", "person"),
      a("laptop", "device", { owner_id: "company", location: "公司" }),
      a("old", "assignment", {
        asset_id: "laptop",
        person_id: "me",
        starts_on: "2025-01-01",
        usage_role: "primary",
      }),
    ],
  };
}
describe("家庭资产模型", () => {
  it("产权和使用人分离，按日期查询使用历史", () => {
    const s = family();
    s.assets[4].fields.ends_on = "2026-10-01";
    s.assets.push(
      a("new", "assignment", {
        asset_id: "laptop",
        person_id: "child",
        starts_on: "2026-10-01",
        usage_role: "backup",
      }),
    );
    expect(
      currentAssignments(s, "laptop", "2026-09-30")[0].fields.person_id,
    ).toBe("me");
    expect(
      currentAssignments(s, "laptop", "2026-10-01")[0].fields.person_id,
    ).toBe("child");
    expect(s.assets[3].fields.owner_id).toBe("company");
  });
  it("硬盘到系统和设备关系双向可追踪", () => {
    const s = family();
    s.assets.push(
      a("disk", "storage", { device_id: "laptop" }),
      a("linux", "environment", { storage_id: "disk" }),
    );
    expect(
      connections(s.assets[5], s)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["laptop", "linux"]);
  });
});
