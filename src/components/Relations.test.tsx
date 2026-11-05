// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { RelationForm, TransferForm, UsagePanel } from "./Relations";
import { empty, today, type Asset, type Link, type Snapshot } from "../model";

afterEach(cleanup);
const asset = (id: string, kind: Asset["kind"], name: string): Asset => ({
  id,
  kind,
  name,
  status: "active",
  fields: {},
});
const s: Snapshot = {
  ...empty,
  assets: [
    asset("me", "person", "我"),
    asset("kid", "person", "孩子"),
    asset("ipad", "device", "iPad"),
  ],
  links: [
    {
      id: "u1",
      type: "uses",
      from: "me",
      to: "ipad",
      attrs: { usage_role: "primary", starts_on: "2026-01-01" },
    },
  ],
};

it("给谁用：只问成员，角色和日期已预填", async () => {
  const submit = vi.fn();
  const user = userEvent.setup();
  render(
    <RelationForm
      anchor={s.assets[2]}
      assets={s.assets}
      initialType="uses"
      submit={submit}
      busy={false}
      error=""
    />,
  );
  expect(screen.queryByLabelText("关系")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText(/谁使用「iPad」/), "kid");
  await user.click(screen.getByRole("button", { name: "保存" }));
  const link = submit.mock.calls[0][0] as Link;
  expect(link).toMatchObject({
    type: "uses",
    from: "kid",
    to: "ipad",
    attrs: { usage_role: "primary", starts_on: today() },
  });
});

it("其他关系可选类型，两端按类型过滤", async () => {
  const user = userEvent.setup();
  render(
    <RelationForm
      anchor={s.assets[0]}
      assets={s.assets}
      submit={() => {}}
      busy={false}
      error=""
    />,
  );
  const type = screen.getByLabelText("关系");
  expect(type).toHaveValue("uses");
  const target = screen.getByLabelText(/「我」使用/);
  expect(target.querySelectorAll("option")).toHaveLength(2);
  await user.selectOptions(type, "related");
  expect(screen.getByLabelText("备注")).toBeInTheDocument();
});

it("现在谁在用、换人和交接", async () => {
  const onTransfer = vi.fn();
  const user = userEvent.setup();
  render(
    <UsagePanel
      asset={s.assets[2]}
      snapshot={s}
      onAssign={() => {}}
      onTransfer={onTransfer}
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText(/我 · 主力/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /换人/ }));
  expect(onTransfer).toHaveBeenCalledWith(s.links[0]);
  cleanup();
  const submit = vi.fn();
  render(
    <TransferForm
      link={s.links[0]}
      snapshot={s}
      submit={submit}
      busy={false}
      error=""
    />,
  );
  await user.selectOptions(screen.getByLabelText("交给谁"), "kid");
  await user.click(screen.getByRole("button", { name: "确认交接" }));
  expect(submit).toHaveBeenCalledWith("kid", today());
});
