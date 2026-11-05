// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { empty } from "./model";
const command = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: command }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import SyncPanel from "./SyncPanel";
beforeEach(() => {
  localStorage.clear();
  command.mockReset();
  command.mockImplementation(async (name: string) => {
    if (name === "verge_dav_profile")
      return { url: "https://dav.example.com/dav/", username: "qa" };
    if (name === "dav_request") return { status: 404, body: "", etag: null };
    throw Error("unexpected command");
  });
});
afterEach(cleanup);
it("本机连接复用不回传密码，重挂载保留来源，修改地址撤销复用", async () => {
  const user = userEvent.setup();
  const app = render(<SyncPanel snapshot={empty} onChange={() => {}} />);
  await user.click(screen.getByText("配置 WebDAV / 坚果云"));
  await user.click(
    screen.getByRole("button", { name: "复用本机 Clash Verge WebDAV" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("WebDAV 根目录")).toHaveValue(
      "https://dav.example.com/dav/",
    ),
  );
  expect(screen.getByLabelText("WebDAV 应用密码")).toHaveValue("");
  expect(JSON.parse(localStorage.getItem("ssot.dav")!)).toEqual({
    url: "https://dav.example.com/dav/",
    username: "qa",
    source: "clash-verge",
  });
  await user.click(screen.getByRole("button", { name: "检查连接 / 下载预览" }));
  await screen.findByText("云端尚无台账，可以首次上传。未改动本地数据。");
  expect(command).toHaveBeenCalledWith(
    "dav_request",
    expect.objectContaining({ useVerge: true, password: "" }),
  );
  app.unmount();
  render(<SyncPanel snapshot={empty} onChange={() => {}} />);
  await user.click(screen.getByText("配置 WebDAV / 坚果云"));
  expect(
    screen.getByRole("button", { name: "检查连接 / 下载预览" }),
  ).toBeEnabled();
  await user.type(screen.getByLabelText("WebDAV 根目录"), "other/");
  expect(
    screen.getByRole("button", { name: "检查连接 / 下载预览" }),
  ).toBeDisabled();
});
