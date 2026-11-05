import { open, save } from "@tauri-apps/plugin-dialog";
import { commands as generated } from "./bindings";
import type * as B from "./bindings";
import type { Asset, DeletePlan, Schema, Snapshot } from "./model";

// Rust types use plain strings for kind / status; the UI works with the narrower model types.
type Narrow<T> = T extends B.Snapshot
  ? Snapshot
  : T extends B.Asset[]
    ? Asset[]
    : T extends B.DeletePlan
      ? DeletePlan
      : T extends B.Schema_Serialize
        ? Schema
        : T;
type Generated = typeof generated;
type Typed = {
  [K in keyof Generated]: (
    ...args: Parameters<Generated[K]>
  ) => Promise<Narrow<Awaited<ReturnType<Generated[K]>>>>;
};

/** Desktop backend commands with names, arguments and results checked against the Rust code. */
export const commands = generated as unknown as Typed;

export async function chooseFile(directory = false) {
  return open({
    directory,
    multiple: false,
    filters: directory
      ? undefined
      : [{ name: "JSON 快照", extensions: ["json"] }],
  });
}
export async function chooseExport() {
  return save({
    defaultPath: `ssot-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 快照", extensions: ["json"] }],
  });
}
