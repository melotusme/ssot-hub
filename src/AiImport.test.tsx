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
import { empty, type AiPlan, type Asset, type PlanItem } from "./model";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import AiImport from "./AiImport";
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
const item = (
  key: string,
  op: PlanItem["op"],
  title: string,
  extra: Partial<PlanItem> = {},
): PlanItem => ({
  key,
  op,
  title,
  details: [],
  warnings: [],
  ready: true,
  asset: null,
  link: null,
  ends: null,
  needs: [],
  ...extra,
});
const plan: AiPlan = {
  model: provider.model,
  notes: ["整理出 4 项"],
  questions: [{ text: "M4 谁在用？", options: ["我", "孩子"] }],
  items: [
    item("create:m4", "create", "新建设备「MacbookM4」", {
      asset: asset("m4", "device", "MacbookM4", { device_kind: "laptop" }),
      details: ["种类：笔记本电脑"],
    }),
    item("relate:0", "relate", "孩子 使用 MacBook-A", {
      link: {
        id: "l1",
        type: "uses",
        from: "kid",
        to: "m3",
        attrs: { usage_role: "primary", starts_on: "2026-11-05" },
      },
      ends: "old-use",
      details: ["交接：我 的使用在 2026-11-05 结束，历史保留"],
    }),
    item("relate:1", "relate", "我 使用 MacbookM4", {
      link: {
        id: "l2",
        type: "uses",
        from: "me",
        to: "m4",
        attrs: { usage_role: "primary", starts_on: "2026-11-05" },
      },
      needs: ["create:m4"],
    }),
    item("create:app", "create", "新建软件「Raycast」", {
      asset: asset("app", "software", "Raycast"),
      ready: false,
      warnings: ["缺少必填：所在系统，请编辑后再登记"],
    }),
  ],
};

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
  it("首页带来的材料自动整理；交接和依赖新建项的关系一起写入", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "ai_settings")
        return { providers: [provider], active: "p1" };
      if (name === "ai_extract") return plan;
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
        initialText="MacBook-A 给孩子用了，我换 M4"
      />,
    );
    await screen.findByText("整理出 4 项");
    expect(invoke).toHaveBeenCalledWith("ai_extract", {
      text: "MacBook-A 给孩子用了，我换 M4",
      images: [],
      pasted: [],
      kindHint: null,
    });
    expect(screen.getByText(/交接：我 的使用/)).toBeInTheDocument();
    const raycast = screen
      .getByText("新建软件「Raycast」")
      .closest(".ai-draft-row") as HTMLElement;
    expect(within(raycast).getByRole("checkbox")).toBeDisabled();
    // Unticking the new M4 blocks the relation that needs it.
    const m4 = screen
      .getByText("新建设备「MacbookM4」")
      .closest(".ai-draft-row") as HTMLElement;
    await user.click(within(m4).getByRole("checkbox"));
    const mine = screen
      .getByText("我 使用 MacbookM4")
      .closest(".ai-draft-row") as HTMLElement;
    expect(within(mine).getByRole("checkbox")).toBeDisabled();
    expect(within(mine).getByText(/需要先勾选/)).toBeInTheDocument();
    await user.click(within(m4).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "确认并写入" }));
    expect(apply).toHaveBeenCalledWith({
      create: [plan.items[0].asset],
      update: [],
      link: [plan.items[1].link, plan.items[2].link],
      end_uses: [["old-use", "2026-11-05"]],
    });
  });

  it("点追问的候选答案会补充材料并重新整理", async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === "ai_settings")
        return { providers: [provider], active: "p1" };
      if (name === "ai_extract") return plan;
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
    await user.type(await screen.findByLabelText("材料"), "换了 M4");
    await user.click(screen.getByRole("button", { name: "交给 AI 整理" }));
    await user.click(await screen.findByRole("button", { name: "孩子" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "ai_extract",
        expect.objectContaining({ text: "换了 M4\n补充：M4 谁在用？ 孩子" }),
      ),
    );
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
