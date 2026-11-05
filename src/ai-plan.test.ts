import { expect, it } from "vitest";
import { planToChanges } from "./ai-plan";
import type { Asset, PlanItem } from "./model";

const asset = (id: string, fields: Record<string, string> = {}): Asset => ({
  id,
  kind: "subscription",
  name: id,
  status: "active",
  fields,
});
const base = {
  details: [],
  warnings: [],
  ready: true,
  link: null,
  ends: null,
  needs: [],
};

it("未选的新建项会从其他条目的字段里去掉；修改和退役同一资产合并", () => {
  const items: PlanItem[] = [
    { ...base, key: "c1", op: "create", title: "", asset: asset("acc") },
    {
      ...base,
      key: "c2",
      op: "create",
      title: "",
      asset: asset("sub", { account_id: "acc", price: "9" }),
    },
    {
      ...base,
      key: "u1",
      op: "update",
      title: "",
      asset: asset("old", { price: "25" }),
    },
    {
      ...base,
      key: "r1",
      op: "retire",
      title: "",
      asset: { ...asset("old"), status: "retired" },
    },
  ];
  const c = planToChanges(items, new Set(["c2", "u1", "r1"]));
  expect(c.create).toEqual([asset("sub", { price: "9" })]);
  expect(c.update).toEqual([
    { ...asset("old", { price: "25" }), status: "retired" },
  ]);
  expect(c.link).toEqual([]);
});
