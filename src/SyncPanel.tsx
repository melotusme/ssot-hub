import { useState } from "react";
import { command, desktop, chooseExport, chooseFile } from "./api";
import type { Snapshot } from "./model";
import {
  browserTransport,
  davDirectory,
  decryptPayload,
  encryptPayload,
  readRemote,
  uploadRemote,
  type DavConfig,
  type DavResponse,
  type SyncPayload,
  type Transport,
} from "./sync";

export default function SyncPanel({
  snapshot,
  onChange,
}: {
  snapshot: Snapshot;
  onChange: (s: Snapshot) => void;
}) {
  const [config, setConfig] = useState<DavConfig>(() => {
    try {
      return {
        ...JSON.parse(localStorage.getItem("ssot.dav") || "{}"),
        password: "",
      };
    } catch {
      return { url: "", username: "", password: "" };
    }
  });
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    payload: SyncPayload;
    revision: number;
    hash?: string;
    source?: string;
  } | null>(null);
  const connectionKey = () => `${davDirectory(config.url)}|${config.username}`;
  const transport = (): Transport =>
    desktop
      ? (url, method, body, condition) =>
          command<DavResponse>("dav_request", {
            url,
            method,
            body: body ?? null,
            username: config.username,
            password: config.password,
            condition: condition ? [condition.name, condition.value] : null,
          })
      : browserTransport(config);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const payload = (): SyncPayload => ({
    snapshot,
    preferences: Object.fromEntries(
      Object.keys(localStorage)
        .filter((k) => k.startsWith("ssot.list."))
        .map((k) => [k, localStorage.getItem(k)!]),
    ),
  });
  const rememberConnection = () =>
    localStorage.setItem(
      "ssot.dav",
      JSON.stringify({ url: config.url, username: config.username }),
    );
  const exportEncrypted = () =>
    run(async () => {
      const content = await encryptPayload(payload(), passphrase);
      if (desktop) {
        const path = await chooseExport();
        if (!path) return;
        await command("write_encrypted", { path, content });
      } else {
        const url = URL.createObjectURL(
          new Blob([content], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `ssot-encrypted-${Date.now()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage("加密快照已导出；请通过私有渠道传递，口令另行保管。");
    });
  const importEncrypted = () =>
    run(async () => {
      const file = await chooseFile();
      if (!file) return;
      const text = desktop
        ? await command<string>("read_encrypted", { path: file })
        : file;
      const result = await decryptPayload(text, passphrase);
      setPreview({ payload: result, revision: snapshot.revision });
    });
  const download = () =>
    run(async () => {
      const key = connectionKey();
      rememberConnection();
      const remote = await readRemote(davDirectory(config.url), transport());
      if (!remote) {
        setMessage("云端尚无台账，可以首次上传。未改动本地数据。");
        return;
      }
      const result = await decryptPayload(remote.body, passphrase);
      setPreview({
        payload: result,
        revision: snapshot.revision,
        hash: remote.hash,
        source: key,
      });
    });
  const upload = () =>
    run(async () => {
      const key = connectionKey();
      rememberConnection();
      const text = await encryptPayload(payload(), passphrase);
      const hash = await uploadRemote(
        davDirectory(config.url),
        text,
        localStorage.getItem(`ssot.sync.hash.${key}`),
        transport(),
      );
      localStorage.setItem(`ssot.sync.hash.${key}`, hash);
      setMessage("上传并回读校验完成。请勿多端同时上传；下一台先下载核对。");
    });
  const apply = () =>
    run(async () => {
      if (!preview) return;
      const result = await command<Snapshot>("replace_snapshot", {
        snapshot: preview.payload.snapshot,
        revision: preview.revision,
      });
      onChange(result);
      // Preference failure must not misreport a completed data replacement as rolled back.
      try {
        for (const [k, v] of Object.entries(preview.payload.preferences))
          localStorage.setItem(k, v);
        if (preview.source && preview.hash)
          localStorage.setItem(
            `ssot.sync.hash.${preview.source}`,
            preview.hash,
          );
        setMessage("已备份旧台账并应用快照。列表偏好下次进入列表时恢复。");
      } catch {
        setMessage(
          "台账已应用并备份，但浏览器偏好存储失败；请勿直接上传，先重新核对云端。",
        );
      }
      setPreview(null);
    });
  return (
    <section className="panel settings-card wide sync-panel">
      <h2>加密同步 · 多端接力</h2>
      <p>
        同步资产、关系、交接历史和列表偏好。登记的安装路径会加密同步；连接密码、快捷键源码与文件选择路径不上传。手动串行同步，不自动合并冲突。
      </p>
      <label>
        同步加密口令（至少 12 字符，只在内存保留）
        <input
          type="password"
          autoComplete="off"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <div className="head-actions">
        <button disabled={busy} onClick={exportEncrypted}>
          导出加密快照
        </button>
        <button disabled={busy} onClick={importEncrypted}>
          读取加密快照
        </button>
      </div>
      <details>
        <summary>配置 WebDAV / 坚果云</summary>
        <p className="small">
          使用第三方应用密码。只保存 URL 与用户名；密码关闭页面即丢弃。Web
          需要服务器允许 CORS；桌面没有浏览器 CORS 限制。
        </p>
        <label>
          WebDAV 根目录
          <input
            type="url"
            placeholder="https://dav.example.com/dav/"
            value={config.url || ""}
            onChange={(e) => {
              setConfig({ ...config, url: e.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label>
          WebDAV 用户名
          <input
            autoComplete="username"
            value={config.username || ""}
            onChange={(e) => {
              setConfig({ ...config, username: e.target.value });
              setPreview(null);
            }}
          />
        </label>
        <label>
          WebDAV 应用密码
          <input
            type="password"
            autoComplete="off"
            value={config.password}
            onChange={(e) => setConfig({ ...config, password: e.target.value })}
          />
        </label>
        <div className="head-actions">
          <button
            disabled={
              busy || !config.url || !config.username || !config.password
            }
            onClick={download}
          >
            检查连接 / 下载预览
          </button>
          <button
            disabled={
              busy || !config.url || !config.username || !config.password
            }
            onClick={upload}
          >
            加密上传并校验
          </button>
        </div>
      </details>
      {preview && (
        <div className="sync-preview">
          <h3>下载预览（尚未应用）</h3>
          <p>
            {preview.payload.snapshot.assets.length} 项资产 ·{" "}
            {preview.payload.snapshot.links.length} 条关系 ·{" "}
            {preview.payload.snapshot.events.length} 条历史
          </p>
          <p>
            将替换当前 {snapshot.assets.length}{" "}
            项资产；先完整备份本地，不合并。若两端都改过，请先导出本地快照。
          </p>
          <div className="head-actions">
            <button disabled={busy} onClick={() => setPreview(null)}>
              取消
            </button>
            <button className="primary" disabled={busy} onClick={apply}>
              备份本地并确认替换
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status">处理中…</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
