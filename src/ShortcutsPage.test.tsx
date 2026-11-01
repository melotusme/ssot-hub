// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./api", () => ({ desktop: true, command: invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import ShortcutsPage, { changedLines } from "./ShortcutsPage";
const source = {
  path: "/test/hotkeys.lua",
  engine: "hammerspoon",
  revision: "original",
  groups: ["ide"],
  shortcuts: [
    {
      id: "ide:1",
      group: "ide",
      key: "E",
      mods: ["cmd", "ctrl"],
      app: "/Applications/Editor.app",
      bundle_id: "",
      match_window: "",
      advanced: false,
      line: 4,
    },
  ],
  reserved: [],
  warnings: [],
};
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  invoke.mockReset();
  invoke.mockImplementation(async (name: string) => {
    if (name === "shortcut_source") return source;
    if (name === "shortcut_preview")
      return {
        path: source.path,
        revision: source.revision,
        before: 'key = "E"',
        after: 'key = "K"',
      };
    if (name === "shortcut_save")
      return {
        ...source,
        revision: "changed",
        shortcuts: [{ ...source.shortcuts[0], key: "K" }],
      };
    throw Error(name);
  });
});
afterEach(cleanup);
describe("源码快捷键工作台", () => {
  it("先预览后保存，写回原路径与读取时的版本", async () => {
    const user = userEvent.setup();
    render(<ShortcutsPage />);
    await user.click(await screen.findByLabelText("编辑 Editor 快捷键"));
    const dialog = screen.getByRole("dialog");
    const key = within(dialog).getByLabelText("主键 / 按键录入");
    await user.clear(key);
    await user.type(key, "K");
    expect(invoke.mock.calls.some((c) => c[0] === "shortcut_save")).toBe(false);
    await user.click(
      within(dialog).getByRole("button", { name: "预览代码变更" }),
    );
    await screen.findByText("修改后");
    await user.click(
      within(dialog).getByRole("button", { name: "确认写入代码" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(invoke).toHaveBeenCalledWith(
      "shortcut_save",
      expect.objectContaining({
        path: source.path,
        revision: "original",
        change: expect.objectContaining({ key: "K" }),
      }),
    );
    expect(localStorage.getItem("ssot.shortcuts.sourcePath")).toBe(source.path);
    expect(localStorage.getItem("ssot.shortcuts.sourcePath")).not.toContain(
      "revision",
    );
  });
  it("外部更新不会用旧编辑草稿覆盖代码", async () => {
    const user = userEvent.setup();
    render(<ShortcutsPage />);
    await user.click(await screen.findByLabelText("编辑 Editor 快捷键"));
    invoke.mockImplementation(async (name: string) => {
      if (name === "shortcut_source")
        return { ...source, revision: "external" };
      throw Error(name);
    });
    window.dispatchEvent(new Event("focus"));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "预览代码变更" })).toBeDisabled();
  });
  it("变更预览仅展开被改动的行", () => {
    expect(changedLines("a\nb\nc", "a\nx\nc")).toEqual({
      line: 2,
      before: "b",
      after: "x",
    });
    expect(changedLines("same", "same")).toBeNull();
  });
});
