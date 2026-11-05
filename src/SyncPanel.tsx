import { useState } from "react";
import { commands, chooseExport, chooseFile } from "./api";
import type { Value } from "./bindings";
import type { Snapshot } from "./model";
import {
  davDirectory,
  decryptPayload,
  encryptPayload,
  readRemote,
  uploadRemote,
  type DavConfig,
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
  const transport = (): Transport => (url, method, body, condition) =>
    commands.dav_request(
      url,
      method,
      config.username,
      config.password,
      body ?? null,
      condition ? [condition.name, condition.value] : null,
      config.source === "clash-verge",
    );
  // Decrypted content is untrusted: the backend validates it before any preview.
  const decrypt = async (text: string): Promise<SyncPayload> => {
    const payload = await decryptPayload(text, passphrase);
    return {
      ...payload,
      // May be an older snapshot version; the backend upgrades and validates it.
      snapshot: await commands.check_snapshot(
        payload.snapshot as unknown as Value,
      ),
    };
  };
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
      JSON.stringify({
        url: config.url,
        username: config.username,
        ...(config.source ? { source: config.source } : {}),
      }),
    );
  const reuseVerge = () =>
    run(async () => {
      const profile = await commands.verge_dav_profile();
      const next: DavConfig = {
        ...profile,
        password: "",
        source: "clash-verge",
      };
      setConfig(next);
      setPreview(null);
      localStorage.setItem(
        "ssot.dav",
        JSON.stringify({ ...profile, source: "clash-verge" }),
      );
      setMessage(
        "已复用本机连接。应用密码留在后端读取，不复制或修改 Clash Verge 配置；尚未上传台账。",
      );
    });
  const hasCredential = !!config.password || config.source === "clash-verge";
  const exportEncrypted = () =>
    run(async () => {
      const content = await encryptPayload(payload(), passphrase);
      const path = await chooseExport();
      if (!path) return;
      await commands.write_encrypted(path, content);
      setMessage("加密快照已导出；请通过私有渠道传递，口令另行保管。");
    });
  const importEncrypted = () =>
    run(async () => {
      const file = await chooseFile();
      if (!file) return;
      const text = await commands.read_encrypted(file);
      const result = await decrypt(text);
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
      const result = await decrypt(remote.body);
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
      const result = await commands.replace_snapshot(
        preview.payload.snapshot,
        preview.revision,
      );
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
          "台账已应用并备份，但列表偏好保存失败；请勿直接上传，先重新核对云端。",
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
          使用第三方应用密码。只保存 URL 与用户名；密码关闭窗口即丢弃。
        </p>
        <button disabled={busy} onClick={reuseVerge}>
          复用本机 Clash Verge WebDAV
        </button>
        {config.source === "clash-verge" && (
          <p role="status">
            正在复用本机加密连接；密码不返回页面。修改地址、账号或密码将切回手动连接。
          </p>
        )}
        <label>
          WebDAV 根目录
          <input
            type="url"
            placeholder="https://dav.example.com/dav/"
            value={config.url || ""}
            onChange={(e) => {
              setConfig({ ...config, url: e.target.value, source: undefined });
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
              setConfig({
                ...config,
                username: e.target.value,
                source: undefined,
              });
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
            onChange={(e) =>
              setConfig({
                ...config,
                password: e.target.value,
                source: undefined,
              })
            }
          />
        </label>
        <div className="head-actions">
          <button
            disabled={busy || !config.url || !config.username || !hasCredential}
            onClick={download}
          >
            检查连接 / 下载预览
          </button>
          <button
            disabled={busy || !config.url || !config.username || !hasCredential}
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
