import {
  empty,
  uid,
  connections,
  type Snapshot,
  type Asset,
  type Link,
} from "./model";
import { validateSnapshot } from "./validation";

export function openWebDatabase(name = "ssot-hub-v2"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("state");
      r.result.createObjectStore("backups");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(Error("无法打开本地 IndexedDB，请检查浏览器存储权限"));
  });
}
function download(s: Snapshot) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `ssot-${new Date().toISOString().replaceAll(":", "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function webCommand<T>(
  name: string,
  args: Record<string, unknown> = {},
  database?: IDBDatabase,
): Promise<T> {
  if (name === "data_path")
    return "本浏览器 IndexedDB · ssot-hub-v2（清除网站数据会删除台账，请定期导出）" as T;
  if (name === "cycle_cost") {
    const decimal = (s: string) => {
      const [whole, part = ""] = s.split(".");
      return { n: BigInt(whole + part), scale: part.length };
    };
    const p = decimal(String(args.price)),
      r = decimal(String(args.rate));
    const denominator = 10n ** BigInt(p.scale + r.scale);
    const cents = (p.n * r.n * 100n * 2n + denominator) / (denominator * 2n);
    return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}` as T;
  }
  if (name === "preview_snapshot") {
    const s: unknown = JSON.parse(String(args.path));
    validateSnapshot(s);
    return s as T;
  }
  const db = database || (await openWebDatabase());
  if (["list_backups", "read_backup"].includes(name)) {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("backups", "readonly"),
        store = tx.objectStore("backups");
      const request =
        name === "read_backup"
          ? store.get(String(args.id))
          : store.openCursor();
      const result: { id: string; at: string; count: number }[] = [];
      let restored: unknown;
      request.onsuccess = () => {
        if (name === "read_backup") {
          restored = request.result;
          return;
        }
        const cursor = request.result as IDBCursorWithValue | null;
        if (cursor) {
          const s = cursor.value as Snapshot;
          result.push({
            id: String(cursor.key),
            at: s.events.at(-1)?.at || "",
            count: s.assets.length,
          });
          cursor.continue();
        }
      };
      tx.oncomplete = () => {
        if (!database) db.close();
        if (name === "read_backup" && !restored) reject(Error("备份不存在"));
        else resolve((name === "read_backup" ? restored : result) as T);
      };
      tx.onerror = () => {
        if (!database) db.close();
        reject(Error("读取备份失败"));
      };
    });
  }
  const readOnly = ["load", "delete_plan", "export_snapshot"].includes(name);
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(
      ["state", "backups"],
      readOnly ? "readonly" : "readwrite",
    );
    let result: unknown, failure: unknown;
    tx.oncomplete = () => {
      if (!database) db.close();
      resolve(result as T);
    };
    tx.onabort = tx.onerror = () => {
      if (!database) db.close();
      reject(failure || tx.error || Error("本地保存失败，数据未更改"));
    };
    const state = tx.objectStore("state");
    const r = state.get("active");
    r.onsuccess = () => {
      try {
        let s: Snapshot = r.result || structuredClone(empty);
        validateSnapshot(s);
        s.version = 3;
        if (name === "load") {
          result = s;
          return;
        }
        if (name === "export_snapshot") {
          download(s);
          result = true;
          return;
        }
        if (name === "delete_plan") {
          const asset = s.assets.find((a) => a.id === args.id);
          if (!asset) throw Error("资产不存在");
          result = {
            revision: s.revision,
            asset,
            blockers: connections(asset, s)
              .filter(
                (c) =>
                  c.linkId ||
                  (s.assets.find((a) => a.id === c.id)?.fields &&
                    Object.values(
                      s.assets.find((a) => a.id === c.id)!.fields,
                    ).includes(asset.id)),
              )
              .map((c) => c.label),
          };
          return;
        }
        if (name === "backup") {
          tx.objectStore("backups").put(s, uid());
          result = "浏览器本地备份；请另行导出文件避免清除网站数据丢失";
          return;
        }
        if (name !== "new_workspace" && args.revision !== s.revision)
          throw Error("数据已更新，请刷新后重试。");
        const before = structuredClone(s);
        let action = name,
          detail: unknown = args;
        if (name === "save_asset") {
          const a = args.asset as Asset,
            old = s.assets.find((x) => x.id === a.id);
          if (old && old.kind !== a.kind) throw Error("不能改变资产类型");
          s.assets = [...s.assets.filter((x) => x.id !== a.id), a];
          action = old ? "update" : "create";
          detail = { before: old, after: a };
        } else if (name === "transfer_asset") {
          const next = args.next as Asset,
            old = s.assets.find(
              (a) => a.id === args.id && a.kind === "assignment",
            );
          if (
            !old ||
            old.status !== "active" ||
            old.fields.ends_on ||
            next.kind !== "assignment" ||
            next.fields.asset_id !== old.fields.asset_id ||
            s.assets.some((a) => a.id === next.id)
          )
            throw Error("只能交接同一资产的持续使用记录");
          old.fields.ends_on = next.fields.starts_on;
          s.assets.push(next);
          action = "transfer";
        } else if (name === "save_link") {
          s.links.push(args.link as Link);
          action = "link";
        } else if (name === "remove_link") {
          if (!s.links.some((l) => l.id === args.id)) throw Error("关系不存在");
          s.links = s.links.filter((l) => l.id !== args.id);
          action = "unlink";
        } else if (name === "delete_asset") {
          const a = s.assets.find((a) => a.id === args.id);
          if (!a) throw Error("资产不存在");
          s.assets = s.assets.filter((a) => a.id !== args.id);
          detail = a;
          action = "delete";
          tx.objectStore("backups").put(before, uid());
        } else if (name === "restore_snapshot") {
          if (s.assets.length || s.links.length || s.events.length)
            throw Error("恢复仅允许空台账；请先创建空工作空间");
          s = structuredClone(args.snapshot as Snapshot);
          s.revision = before.revision;
          s.version = 3;
          action = "restore";
          detail = "从快照恢复";
        } else if (name === "replace_snapshot") {
          s = structuredClone(args.snapshot as Snapshot);
          s.revision = before.revision;
          s.version = 3;
          action = "sync_download";
          detail = "应用同步快照（旧台账已备份）";
          tx.objectStore("backups").put(before, uid());
        } else if (name === "new_workspace") {
          tx.objectStore("backups").put(before, uid());
          s = structuredClone(empty);
          s.revision = before.revision;
          detail = "原台账已保存到浏览器备份";
        } else if (name === "apply_import") {
          for (const a of args.assets as Asset[]) {
            const old = s.assets.find((x) => x.id === a.id);
            if (old) {
              if (old.kind !== a.kind) throw Error("导入 ID 类型冲突");
              old.fields = { ...old.fields, ...a.fields };
            } else s.assets.push(a);
          }
          action = "scan_import";
        } else
          throw Error("此功能需要桌面版，本端不支持操作本机文件或执行扫描");
        validateSnapshot(s);
        if (name !== "new_workspace")
          s.events.push({
            id: uid(),
            at: new Date().toISOString(),
            actor: "web",
            action,
            detail: JSON.stringify(detail),
          });
        s.revision++;
        state.put(s, "active");
        result = s;
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
  });
}
