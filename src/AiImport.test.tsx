// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { empty, type AiDraft, type Asset } from "./model";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import AiImport, { detachUnselected } from "./AiImport";
import AiPanel from "./AiPanel";

const asset = (
  id: string,
  kind: Asset["kind"],
  name: string,
  fields = {},
): Asset => ({
  id,
  kind,
  name,
  status: "active",
  fields: { verification: "reported", ...fields },
});
const provider = {
  id: "p1",
  name: "Magpie（本机）",
  api: "openai",
  base_url: "http://127.0.0.1:3425/v1",
  model: "x/claude-sonnet-5",
  has_key: false,
  source: "magpie",
};
const drafts: AiDraft[] = [
  {
    asset: asset("acc", "account", "Google 个人", { provider: "Google" }),
    warnings: [],
    ready: true,
  },
  {
    asset: asset("sub", "subscription", "Google One", {
      account_id: "acc",
      billing_period: "year",
    }),
    warnings: ["到期日期「2027-02-30」不是有效日期，未填写"],
    ready: true,
  },
  {
    asset: asset("app", "software", "Raycast"),
    warnings: ["缺少必填：所属系统环境，请编辑后再登记"],
    ready: false,
  },
];

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("AI 辅助录入", () => {
  it("生成草稿后只能登记可用的条目，未选草稿的引用会被去掉", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "ai_settings")
        return { providers: [provider], active: "p1" };
      if (name === "ai_extract")
        return { drafts, notes: ["从材料识别出 3 项"], model: provider.model };
      throw Error("unexpected " + name);
    });
    const apply = vi.fn();
    const user = userEvent.setup();
    render(
      <AiImport
        snapshot={empty}
        busy={false}
        error=""
        apply={apply}
        openSettings={() => {}}
      />,
    );
    await screen.findByText(/Magpie（本机）（x\/claude-sonnet-5）/);
    await user.type(screen.getByLabelText("材料"), "Google One 年付 99 元");
    await user.click(screen.getByRole("button", { name: "用 AI 生成草稿" }));
    await screen.findByText("从材料识别出 3 项");
    expect(invoke).toHaveBeenCalledWith("ai_extract", {
      text: "Google One 年付 99 元",
      images: [],
      kindHint: null,
    });
    const raycast = screen
      .getByText("Raycast")
      .closest(".ai-draft-row") as HTMLElement;
    expect(within(raycast).getByRole("checkbox")).toBeDisabled();
    expect(within(raycast).getByText(/缺少必填/)).toBeInTheDocument();
    // The subscription references the account by name in the summary.
    expect(screen.getByText(/权益持有账号：Google 个人/)).toBeInTheDocument();
    const account = screen
      .getByText("Google 个人", { selector: "strong" })
      .closest(".ai-draft-row") as HTMLElement;
    await user.click(within(account).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "登记所选 1 项" }));
    const sent = apply.mock.calls[0][0] as Asset[];
    expect(sent.map((a) => a.id)).toEqual(["sub"]);
    expect(sent[0].fields.account_id).toBeUndefined();
  });

  it("没有接入时可以一键接入 Magpie", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "ai_settings") return { providers: [], active: null };
      if (name === "ai_connect_magpie")
        return {
          settings: { providers: [provider], active: "p1" },
          models: [provider.model],
        };
      throw Error("unexpected " + name);
    });
    const user = userEvent.setup();
    render(
      <AiImport
        snapshot={empty}
        busy={false}
        error=""
        apply={() => {}}
        openSettings={() => {}}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "一键接入 Magpie" }),
    );
    await screen.findByLabelText("材料");
  });

  it("设置页的 key 只交给后端，界面不回显", async () => {
    invoke.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "ai_settings") return { providers: [], active: null };
        if (name === "ai_save_provider") {
          const p = args.provider as typeof provider;
          return {
            providers: [{ ...p, id: "n1", has_key: !!args.apiKey }],
            active: "n1",
          };
        }
        throw Error("unexpected " + name);
      },
    );
    const user = userEvent.setup();
    render(<AiPanel />);
    await user.click(
      await screen.findByRole("button", { name: "添加其他服务" }),
    );
    await user.selectOptions(screen.getByLabelText("常用服务"), "DeepSeek");
    await user.type(screen.getByLabelText(/API key/), "sk-secret");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "ai_save_provider",
        expect.objectContaining({ apiKey: "sk-secret" }),
      ),
    );
    expect(await screen.findByText(/已存钥匙串/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("sk-secret")).not.toBeInTheDocument();
  });
});

it("detachUnselected 只去掉指向未选草稿的引用", () => {
  const out = detachUnselected(
    [asset("sub", "subscription", "x", { account_id: "acc", owner_id: "me" })],
    drafts,
  );
  expect(out[0].fields).toEqual({ verification: "reported", owner_id: "me" });
});
