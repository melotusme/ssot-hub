// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { empty, type Snapshot } from "./model";
let db: Snapshot;
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "load") return structuredClone(db);
    if (name === "data_path") return "/test/ssot.sqlite3";
    if (name === "save_asset") {
      db = {
        ...db,
        revision: db.revision + 1,
        assets: [...db.assets, args.asset as Snapshot["assets"][number]],
      };
      return structuredClone(db);
    }
    throw Error("Unexpected command " + name);
  }),
}));
import App from "./App";
beforeEach(() => {
  db = structuredClone(empty);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
describe("桌面登记流程", () => {
  it("空状态登记设备、刷新并检索，详情可编辑", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("你的资产台账，等待第一笔登记");
    await user.click(screen.getByRole("button", { name: "登记第一项资产" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("资产名称 *"), "工作 Mac");
    await user.selectOptions(
      within(dialog).getByLabelText("设备类型"),
      "computer",
    );
    await user.click(within(dialog).getByRole("button", { name: "保存资产" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "刷新台账" }));
    const search = screen.getByRole("textbox", { name: "搜索资产" });
    await user.type(search, "不存在");
    expect(screen.getByText("没有符合条件的资产")).toBeInTheDocument();
    await user.clear(search);
    await user.click(screen.getByRole("button", { name: /工作 Mac 设备/ }));
    expect(
      screen.getByRole("button", { name: "编辑资产" }),
    ).toBeInTheDocument();
    expect(db.assets[0].fields.device_kind).toBe("computer");
  });
});
