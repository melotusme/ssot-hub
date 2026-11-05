// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { AssetEditor } from "./AssetEditor";
import { defaultsFor, empty, today, type Asset, type Snapshot } from "../model";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

const me: Asset = {
  id: "me",
  kind: "person",
  name: "我",
  status: "active",
  fields: { person_kind: "self" },
};

it("新建订阅只显示核心字段，默认人民币、所有者是自己，外币才问汇率", async () => {
  const s: Snapshot = { ...empty, assets: [me] };
  const asset: Asset = {
    id: "new",
    kind: "subscription",
    name: "",
    status: "active",
    fields: defaultsFor("subscription", s),
  };
  expect(asset.fields).toMatchObject({ owner_id: "me", currency: "CNY" });
  const save = vi.fn();
  const user = userEvent.setup();
  render(
    <AssetEditor
      asset={asset}
      assets={s.assets}
      save={save}
      close={() => {}}
      busy={false}
      error=""
    />,
  );
  const more = screen.getByText(/更多信息/).closest("details")!;
  expect(more).not.toHaveAttribute("open");
  // Name + five core fields + notes are outside the folded section.
  const outside = screen
    .getAllByRole("combobox")
    .concat(screen.getAllByRole("textbox"))
    .filter((el) => !more.contains(el));
  expect(outside.length).toBeLessThanOrEqual(7);
  expect(screen.queryByText("汇率（1 原币 = 本币）")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("币种"));
  await user.type(screen.getByLabelText("币种"), "USD");
  expect(screen.getByText("汇率（1 原币 = 本币）")).toBeInTheDocument();
  // System fields are never asked.
  expect(screen.queryByText("资料依据")).not.toBeInTheDocument();
});

it("日期默认今天", () => {
  expect(defaultsFor("course", empty).starts_on).toBe(today());
});
