import { describe, it, expect } from "vitest";
import { connections, demo, dueDays } from "./model";
describe("资产业务视图", () => {
  it("结构化引用和显式关系均能双向追踪", () => {
    const s = demo();
    const account = s.assets.find((a) => a.kind === "account")!;
    const subscription = s.assets.find((a) => a.kind === "subscription")!;
    expect(connections(account, s).some((r) => r.id === subscription.id)).toBe(
      true,
    );
    expect(connections(subscription, s).some((r) => r.id === account.id)).toBe(
      true,
    );
    const config = s.assets.find((a) => a.kind === "config")!;
    expect(
      connections(config, s).some((r) => r.label.includes("使用路径")),
    ).toBe(true);
  });
  it("没有日期时不误判为到期，今天为零天", () => {
    expect(dueDays()).toBeNull();
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(dueDays(date)).toBe(0);
  });
});
