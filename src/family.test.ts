import { describe, it, expect } from "vitest";
import {
  empty,
  currentAssignments,
  connections,
  type Asset,
  type Snapshot,
} from "./model";
import { validateSnapshot } from "./validation";
const a = (
  id: string,
  kind: Asset["kind"],
  fields: Asset["fields"] = {},
): Asset => ({ id, kind, name: id, status: "active", fields });
export function family(): Snapshot {
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
    expect(() => validateSnapshot(s)).not.toThrow();
    expect(
      currentAssignments(s, "laptop", "2026-09-30")[0].fields.person_id,
    ).toBe("me");
    expect(
      currentAssignments(s, "laptop", "2026-10-01")[0].fields.person_id,
    ).toBe("child");
    expect(s.assets[3].fields.owner_id).toBe("company");
  });
  it("拒绝重叠使用区间和同日零长度交接", () => {
    const s = family();
    s.assets.push(
      a("new", "assignment", {
        asset_id: "laptop",
        person_id: "child",
        starts_on: "2026-10-01",
        usage_role: "backup",
      }),
    );
    expect(() => validateSnapshot(s)).toThrow(/重叠/);
    s.assets.pop();
    s.assets[4].fields.ends_on = "2025-01-01";
    expect(() => validateSnapshot(s)).toThrow(/晚于/);
  });
  it("多人共用允许，不允许同一成员重复登记", () => {
    const s = family();
    s.assets[4].fields.usage_role = "shared";
    s.assets.push(
      a("shared", "assignment", {
        asset_id: "laptop",
        person_id: "child",
        starts_on: "2026-01-01",
        usage_role: "shared",
      }),
    );
    expect(() => validateSnapshot(s)).not.toThrow();
    s.assets[5].fields.person_id = "me";
    expect(() => validateSnapshot(s)).toThrow(/重叠/);
  });
  it("硬盘到系统和设备关系双向可追踪，非法引用阻止导入", () => {
    const s = family();
    s.assets.push(
      a("disk", "storage", { device_id: "laptop" }),
      a("linux", "environment", { storage_id: "disk" }),
    );
    validateSnapshot(s);
    expect(
      connections(s.assets[5], s)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["laptop", "linux"]);
    s.assets[6].fields.storage_id = "missing";
    expect(() => validateSnapshot(s)).toThrow(/引用/);
  });
  it("课程费用课时校验、秘密只允许引用、v1 兼容", () => {
    const s = family();
    s.version = 1;
    validateSnapshot(s);
    s.assets.push(
      a("course", "course", {
        person_id: "child",
        lessons_total: "20",
        lessons_used: "21",
      }),
    );
    expect(() => validateSnapshot(s)).toThrow(/课时/);
    s.assets[5].fields.lessons_used = "1";
    validateSnapshot(s);
    s.assets.push(a("account", "account", { secret_ref: "password" }));
    expect(() => validateSnapshot(s)).toThrow(/保险库/);
  });
});
