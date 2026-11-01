import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { openWebDatabase, webCommand } from "./web-store";
import { empty, uid, type Snapshot, type Asset } from "./model";
const asset: Asset = {
  id: "device",
  kind: "device",
  name: "Web 设备",
  status: "active",
  fields: {},
};
describe("IndexedDB 实际事务", () => {
  it("新空间保持空审计，可恢复快照并找回旧备份", async () => {
    const db = await openWebDatabase(uid());
    await webCommand("save_asset", { asset, revision: 0 }, db);
    const next = await webCommand<Snapshot>("new_workspace", {}, db);
    expect(next.events).toHaveLength(0);
    const restored = await webCommand<Snapshot>(
      "restore_snapshot",
      { snapshot: { ...empty, assets: [asset] }, revision: next.revision },
      db,
    );
    expect(restored.assets).toHaveLength(1);
    const backups = await webCommand<{ id: string }[]>("list_backups", {}, db);
    expect(backups).toHaveLength(1);
    const previous = await webCommand<Snapshot>(
      "read_backup",
      { id: backups[0].id },
      db,
    );
    expect(previous.assets[0].name).toBe(asset.name);
    db.close();
  });
  it("持久化、跨连接旧修订拒绝、引用删除回滚", async () => {
    const name = uid(),
      db = await openWebDatabase(name);
    await webCommand("save_asset", { asset, revision: 0 }, db);
    db.close();
    const second = await openWebDatabase(name);
    expect(
      (await webCommand<Snapshot>("load", {}, second)).assets[0].name,
    ).toBe("Web 设备");
    await expect(
      webCommand("save_asset", { asset, revision: 0 }, second),
    ).rejects.toThrow(/刷新/);
    await webCommand(
      "save_asset",
      {
        asset: {
          ...asset,
          id: "os",
          kind: "environment",
          fields: { device_id: "device" },
        },
        revision: 1,
      },
      second,
    );
    await expect(
      webCommand("delete_asset", { id: "device", revision: 2 }, second),
    ).rejects.toThrow(/引用/);
    expect((await webCommand<Snapshot>("load", {}, second)).revision).toBe(2);
    second.close();
  });
  it("并发写入仅一个成功、非法同步不改库", async () => {
    const db = await openWebDatabase(uid());
    const outcomes = await Promise.allSettled([
      webCommand("save_asset", { asset, revision: 0 }, db),
      webCommand(
        "save_asset",
        { asset: { ...asset, id: "other" }, revision: 0 },
        db,
      ),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    await expect(
      webCommand(
        "replace_snapshot",
        {
          snapshot: { ...empty, assets: [{ ...asset, kind: "invalid" }] },
          revision: 1,
        },
        db,
      ),
    ).rejects.toThrow();
    expect((await webCommand<Snapshot>("load", {}, db)).assets).toHaveLength(1);
    db.close();
  });
});
