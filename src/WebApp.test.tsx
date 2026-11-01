// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { openWebDatabase, webCommand } from "./web-store";
import { empty, uid, type Snapshot, type Asset } from "./model";
let database: IDBDatabase;
vi.mock("./api", () => ({
  desktop: false,
  chooseFile: vi.fn(),
  chooseExport: vi.fn(),
  command: (name: string, args: Record<string, unknown>) =>
    webCommand(name, args, database),
}));
import App from "./App";
beforeEach(async () => {
  database = await openWebDatabase(uid());
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const a = (
    id: string,
    kind: Asset["kind"],
    fields: Asset["fields"] = {},
  ): Asset => ({ id, kind, name: id, status: "active", fields });
  await webCommand(
    "restore_snapshot",
    {
      snapshot: {
        ...empty,
        assets: [
          a("家人A", "person"),
          a("家人B", "person"),
          a("电脑", "device"),
          a("原使用记录", "assignment", {
            asset_id: "电脑",
            person_id: "家人A",
            starts_on: "2025-01-01",
            usage_role: "primary",
          }),
        ],
      },
      revision: 0,
    },
    database,
  );
});
afterEach(() => {
  cleanup();
  database.close();
});
it("真实 Web 存储：通过界面交接 A 到 B，重新挂载后当前用途与历史保留", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "查看 原使用记录" }),
  );
  await user.click(screen.getByRole("button", { name: "交接给另一位成员" }));
  const form = within(screen.getByRole("dialog"));
  await user.selectOptions(form.getByLabelText("使用成员 *"), "家人B");
  await user.selectOptions(form.getByLabelText("使用角色 *"), "backup");
  fireEvent.change(form.getByLabelText("开始日期 *"), {
    target: { value: "2026-10-01" },
  });
  await user.click(form.getByRole("button", { name: "保存资产" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const s = await webCommand<Snapshot>("load", {}, database);
  expect(s.assets.find((a) => a.id === "原使用记录")?.fields.ends_on).toBe(
    "2026-10-01",
  );
  expect(s.assets.filter((a) => a.kind === "assignment")).toHaveLength(2);
  app.unmount();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "查看 电脑" }));
  expect(screen.getAllByText("家人B · 备用").length).toBeGreaterThan(0);
  expect(screen.getByText("2025-01-01 → 2026-10-01")).toBeInTheDocument();
});
