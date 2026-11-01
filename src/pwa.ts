import { isTauri } from "@tauri-apps/api/core";
if (import.meta.env.PROD && !isTauri() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      /* Offline unavailable: local data still persists. */
    });
  });
}
