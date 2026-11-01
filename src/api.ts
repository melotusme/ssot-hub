import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { webCommand } from "./web-store";
export const desktop = isTauri();
export async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop) {
    return webCommand<T>(name, args);
  }
  return invoke<T>(name, args);
}
export async function chooseFile(directory = false) {
  if (!desktop) {
    if (directory) throw Error("目录扫描仅支持桌面版");
    return new Promise<string | null>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (file && file.size > 20 * 1024 * 1024)
            throw Error("快照不能超过 20 MB");
          resolve(file ? await file.text() : null);
        } catch (e) {
          reject(e);
        }
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
  return open({
    directory,
    multiple: false,
    filters: directory
      ? undefined
      : [{ name: "JSON 快照", extensions: ["json"] }],
  });
}
export async function chooseExport() {
  if (!desktop) return "browser-download";
  return save({
    defaultPath: `ssot-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 快照", extensions: ["json"] }],
  });
}
