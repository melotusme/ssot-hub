import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Code2,
  FileCode2,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { commands } from "./api";
import { RecordList } from "./components/RecordList";
export interface Shortcut {
  id: string;
  group: string;
  key: string;
  mods: string[];
  app: string;
  bundle_id: string;
  match_window: string;
  advanced: boolean;
  line: number;
}
export interface ShortcutSource {
  path: string;
  engine: "hammerspoon" | "ahk_v2";
  revision: string;
  groups: string[];
  shortcuts: Shortcut[];
  reserved: string[];
  warnings: string[];
}
interface Change {
  id: string | null;
  group: string;
  key: string;
  mods: string[];
  app: string;
  bundle_id: string;
  match_window: string;
}
interface Preview {
  revision: string;
  before: string;
  after: string;
  path: string;
}
interface Draft {
  change: Change;
  revision: string;
  path: string;
  engine: ShortcutSource["engine"];
  advanced: boolean;
}
function appName(path: string) {
  return (
    path
      .replace(/[\\/]$/, "")
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.app$/, "") || path
  );
}
export function shortcutLabel(
  s: { mods: string[]; key: string },
  engine: ShortcutSource["engine"],
) {
  return [
    ...["ctrl", "alt", "shift", "cmd"]
      .filter((m) => s.mods.includes(m))
      .map(
        (m) =>
          ({
            ctrl: "Ctrl",
            alt: engine === "hammerspoon" ? "Option" : "Alt",
            shift: "Shift",
            cmd: engine === "hammerspoon" ? "⌘" : "Win",
          })[m],
      ),
    s.key.toUpperCase(),
  ].join(" + ");
}
function SourceDialog({
  draft,
  sourceRevision,
  groups,
  close,
  onSaved,
}: {
  draft: Draft;
  sourceRevision: string;
  groups: string[];
  close: () => void;
  onSaved: (s: ShortcutSource) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [change, setChange] = useState(draft.change);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  const update = (next: Partial<Change>) => {
    setChange((v) => ({ ...v, ...next }));
    setPreview(null);
    setError("");
  };
  const attempt = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = () =>
    attempt(async () => {
      const path = await open({
        multiple: false,
        filters: [
          {
            name:
              draft.engine === "hammerspoon" ? "macOS 应用" : "Windows 应用",
            extensions: draft.engine === "hammerspoon" ? ["app"] : ["exe"],
          },
        ],
      });
      if (typeof path !== "string") return;
      if (draft.engine === "hammerspoon") {
        const [app, bundle_id] = await commands.shortcut_application(path);
        update({ app, bundle_id });
      } else {
        const exe = path.split(/[\\/]/).pop() || "";
        update({ app: path, match_window: `ahk_exe ${exe}` });
      }
    });
  const stale = sourceRevision !== draft.revision;
  return (
    <dialog
      className="dialog shortcut-dialog"
      ref={dialog}
      aria-label={change.id ? "编辑应用快捷键" : "新增应用快捷键"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="dialog-head">
        <div>
          <span className="eyebrow">CODE IS THE SOURCE OF TRUTH</span>
          <h2>{change.id ? "编辑" : "新增"}应用快捷键</h2>
        </div>
        <button
          aria-label="关闭快捷键编辑"
          className="icon-button"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            setPreview(
              await commands.shortcut_preview(
                draft.path,
                draft.revision,
                change,
              ),
            );
          });
        }}
      >
        <div className="source-target">
          <FileCode2 size={16} />
          <code>{draft.path}</code>
        </div>
        {draft.advanced && (
          <div className="banner">
            <ShieldCheck size={18} />
            该应用有专用启动逻辑，可调整快捷键；应用和启动参数由源码维护。
          </div>
        )}
        {stale && (
          <p className="form-error" role="alert">
            源码已在外部更新。请保留需要的内容，关闭编辑并重新打开该条目。
          </p>
        )}
        <div className="form-grid">
          <label>
            分类
            {change.id ? (
              <input readOnly value={change.group} />
            ) : (
              <select
                value={change.group}
                onChange={(e) => update({ group: e.target.value })}
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label>
            主键 / 按键录入
            <input
              required
              autoFocus
              value={change.key}
              onChange={(e) => update({ key: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Tab") return;
                if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
                  e.preventDefault();
                  return;
                }
                if (e.metaKey || e.ctrlKey || e.altKey) {
                  e.preventDefault();
                  const key = /^Key[A-Z]$/.test(e.code)
                    ? e.code.slice(3)
                    : /^Digit[0-9]$/.test(e.code)
                      ? e.code.slice(5)
                      : e.key;
                  update({
                    key,
                    mods: [
                      e.ctrlKey ? "ctrl" : "",
                      e.altKey ? "alt" : "",
                      e.shiftKey ? "shift" : "",
                      e.metaKey ? "cmd" : "",
                    ].filter(Boolean),
                  });
                }
              }}
              placeholder="例如 E、F1、space"
            />
          </label>
          <fieldset className="wide modifier-options">
            <legend>修饰键 *</legend>
            {[
              ["ctrl", "Ctrl"],
              ["alt", draft.engine === "hammerspoon" ? "Option" : "Alt"],
              ["shift", "Shift"],
              ["cmd", draft.engine === "hammerspoon" ? "⌘ Command" : "Win"],
            ].map(([v, label]) => (
              <label key={v}>
                <input
                  type="checkbox"
                  checked={change.mods.includes(v)}
                  onChange={(e) =>
                    update({
                      mods: e.target.checked
                        ? [...change.mods, v]
                        : change.mods.filter((m) => m !== v),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="shortcut-combo wide">
            <Keyboard size={18} />
            <strong>{shortcutLabel(change, draft.engine)}</strong>
            <small>已被系统占用的组合可用上方选项手动设置</small>
          </div>
          <label className="wide">
            应用路径 *
            <div className="input-with-action">
              <input
                required
                value={change.app}
                readOnly={draft.advanced}
                onChange={(e) => update({ app: e.target.value })}
                placeholder={
                  draft.engine === "hammerspoon"
                    ? "/Applications/Example.app"
                    : "C:\\Program Files\\Example\\Example.exe"
                }
              />
              <button
                type="button"
                disabled={busy || draft.advanced}
                onClick={pick}
              >
                <FolderOpen size={16} />
                选择应用
              </button>
            </div>
          </label>
          {draft.engine === "hammerspoon" ? (
            <label className="wide">
              Bundle ID
              <input
                readOnly={draft.advanced}
                value={change.bundle_id}
                onChange={(e) => update({ bundle_id: e.target.value })}
                placeholder="选择应用后自动读取，也可留空"
              />
            </label>
          ) : (
            <label className="wide">
              窗口匹配条件 *
              <input
                required
                readOnly={draft.advanced}
                value={change.match_window}
                onChange={(e) => update({ match_window: e.target.value })}
                placeholder="ahk_exe Code.exe"
              />
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {preview && (
          <CodeChanges before={preview.before} after={preview.after} />
        )}
        <div className="dialog-foot">
          <span className="hint">
            <ShieldCheck size={15} /> 写入前备份，源码外的内容逐字保留
          </span>
          <button type="button" disabled={busy} onClick={close}>
            取消
          </button>
          {preview ? (
            <button
              type="button"
              className="primary"
              disabled={busy || stale || preview.before === preview.after}
              onClick={() =>
                void attempt(async () => {
                  onSaved(
                    await commands.shortcut_save(
                      draft.path,
                      preview.revision,
                      change,
                    ),
                  );
                })
              }
            >
              {busy ? "保存中…" : "确认写入代码"}
            </button>
          ) : (
            <button type="submit" className="primary" disabled={busy || stale}>
              {busy ? "检查中…" : "预览代码变更"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
export function changedLines(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  let first = 0;
  while (first < Math.min(a.length, b.length) && a[first] === b[first]) first++;
  if (first === a.length && first === b.length) return null;
  let endA = a.length,
    endB = b.length;
  while (endA > first && endB > first && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return {
    line: first + 1,
    before: a.slice(first, endA).join("\n"),
    after: b.slice(first, endB).join("\n"),
  };
}
function CodeChanges({ before, after }: { before: string; after: string }) {
  const diff = changedLines(before, after);
  return (
    <section className="code-changes">
      <h3>代码变更预览{diff ? ` · 第 ${diff.line} 行起` : ""}</h3>
      {diff ? (
        <>
          <div className="code-before">
            <span>修改前</span>
            <pre>{diff.before || "（新增）"}</pre>
          </div>
          <div className="code-after">
            <span>修改后</span>
            <pre>{diff.after || "（移除）"}</pre>
          </div>
        </>
      ) : (
        <p>当前设置与源码一致。</p>
      )}
      <details>
        <summary>查看写入后的完整代码</summary>
        <pre>{after}</pre>
      </details>
    </section>
  );
}
export default function ShortcutsPage() {
  const [source, setSource] = useState<ShortcutSource | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState("all");
  const [mode, setMode] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const request = useRef(0);
  const read = useCallback(async (path?: string, silent = false) => {
    const id = ++request.current;
    if (!silent) setLoading(true);
    try {
      const s = await commands.shortcut_source(path || null);
      if (request.current !== id) return;
      setSource(s);
      setError("");
      try {
        localStorage.setItem("ssot.shortcuts.sourcePath", s.path);
      } catch {
        /* optional preference */
      }
    } catch (e) {
      if (request.current === id) setError(String(e));
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let path: string | undefined;
    try {
      path = localStorage.getItem("ssot.shortcuts.sourcePath") || undefined;
    } catch {
      /* optional preference */
    }
    void read(path);
  }, [read]);
  useEffect(() => {
    if (!source) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void read(source.path, true);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [source?.path, read]);
  const openSource = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "快捷键源码", extensions: ["lua", "ahk"] }],
      });
      if (typeof path === "string") {
        setGroup("all");
        setMode("all");
        await read(path);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const createAhk = async () => {
    setError("");
    try {
      const path = await save({
        defaultPath: "launchers.ahk",
        filters: [{ name: "AutoHotkey v2", extensions: ["ahk"] }],
      });
      if (!path) return;
      const s = await commands.shortcut_create_ahk(path);
      setSource(s);
      setGroup("all");
      setMode("all");
      try {
        localStorage.setItem("ssot.shortcuts.sourcePath", s.path);
      } catch {
        /* optional preference */
      }
      setNotice("已创建可运行的 AHK v2 源码，请添加应用快捷键。");
    } catch (e) {
      setError(String(e));
    }
  };
  const edit = (row?: Shortcut) => {
    if (!source) return;
    setDraft({
      path: source.path,
      revision: source.revision,
      engine: source.engine,
      advanced: row?.advanced || false,
      change: row
        ? {
            id: row.id,
            group: row.group,
            key: row.key,
            mods: row.mods,
            app: row.app,
            bundle_id: row.bundle_id,
            match_window: row.match_window,
          }
        : {
            id: null,
            group: group === "all" ? source.groups[0] : group,
            key: "",
            mods:
              source.engine === "hammerspoon"
                ? ["cmd", "ctrl"]
                : ["ctrl", "alt"],
            app: "",
            bundle_id: "",
            match_window: "",
          },
    });
  };
  const items =
    source?.shortcuts.filter(
      (r) =>
        (group === "all" || r.group === group) &&
        (mode === "all" || (mode === "advanced") === r.advanced),
    ) || [];
  return (
    <section className="shortcuts-page">
      <div className="source-heading">
        <div className="source-description">
          <Code2 size={23} />
          <div>
            <strong>源码即唯一权威</strong>
            <p>
              直接读取 Lua / AHK v2
              声明，编辑结果写回同一份代码。手工修改后，重新读取即可反映到界面。
            </p>
          </div>
        </div>
        <div className="source-actions">
          <button disabled={loading} onClick={openSource}>
            <FolderOpen size={16} />
            打开源码
          </button>
          <button disabled={loading} onClick={createAhk}>
            <FileCode2 size={16} />
            新建 AHK v2
          </button>
        </div>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button disabled={loading} onClick={() => void read(source?.path)}>
            重试读取
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭快捷键通知"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {source ? (
        <>
          <div className="source-file panel">
            <FileCode2 size={20} />
            <div>
              <strong>
                {source.engine === "hammerspoon"
                  ? "Hammerspoon"
                  : "AutoHotkey v2"}{" "}
                · {source.shortcuts.length} 项应用快捷键
              </strong>
              <code>{source.path}</code>
            </div>
            <button disabled={loading} onClick={() => void read(source.path)}>
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              重新读取
            </button>
          </div>
          {source.warnings.length > 0 && (
            <p className="form-error">{source.warnings.join("；")}</p>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>应用启动与聚焦</h2>
                <p>
                  有运行窗口时聚焦；未运行时启动。高级启动逻辑由原有代码执行。
                </p>
              </div>
              <button
                className="primary"
                disabled={!source.groups.length}
                onClick={() => edit()}
              >
                <Plus size={16} />
                新增快捷键
              </button>
            </div>
            <RecordList
              listKey={`shortcuts.${source.engine}.${source.path}`}
              label="快捷键"
              items={items}
              search={(r) =>
                `${r.key} ${r.mods.join(" ")} ${r.app} ${r.bundle_id} ${r.group} ${r.match_window}`
              }
              sortFields={[
                {
                  key: "key",
                  label: "快捷键",
                  value: (r) => shortcutLabel(r, source.engine),
                },
                { key: "app", label: "应用", value: (r) => appName(r.app) },
                { key: "group", label: "分类", value: (r) => r.group },
                { key: "line", label: "代码行号", value: (r) => r.line },
              ]}
              scope={`${group}|${mode}`}
              filtered={group !== "all" || mode !== "all"}
              empty="这份源码还没有应用快捷键，点击新增开始登记。"
              filters={
                <>
                  <select
                    aria-label="快捷键分类筛选"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    <option value="all">全部分类</option>
                    {source.groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="快捷键启动方式筛选"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="all">全部启动方式</option>
                    <option value="simple">普通启动</option>
                    <option value="advanced">高级逻辑</option>
                  </select>
                </>
              }
            >
              {(rows) => (
                <div className="table-wrap">
                  <table className="shortcut-table">
                    <thead>
                      <tr>
                        <th>应用 / 路径</th>
                        <th>快捷键</th>
                        <th>分类</th>
                        <th>代码位置</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <span className="launcher-name">
                              {appName(row.app)}
                            </span>
                            <code className="launcher-path">{row.app}</code>
                            {row.advanced && (
                              <span className="badge neutral">
                                高级启动逻辑
                              </span>
                            )}
                          </td>
                          <td>
                            <kbd className="keycap">
                              {shortcutLabel(row, source.engine)}
                            </kbd>
                          </td>
                          <td>{row.group}</td>
                          <td className="subtle">第 {row.line} 行</td>
                          <td>
                            <button
                              className="text-button"
                              aria-label={`编辑 ${appName(row.app)} 快捷键`}
                              onClick={() => edit(row)}
                            >
                              编辑
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </RecordList>
          </section>
          <div className="shortcut-help">
            <ShieldCheck size={16} />
            <p>
              保存时自动备份并检查源码版本。Hammerspoon 保存后使用你现有的{" "}
              <kbd>⌘ Ctrl Shift R</kbd> 重载；AutoHotkey v2
              重新运行脚本生效。冲突检查覆盖本文件可识别的绑定；其他脚本和系统快捷键请另外核对。
            </p>
          </div>
        </>
      ) : loading ? (
        <div className="empty">
          <LoaderCircle className="spin" />
          <h3>正在读取快捷键源码…</h3>
        </div>
      ) : (
        <div className="panel empty">
          <Keyboard size={32} />
          <h3>选择现有快捷键代码</h3>
          <p>
            {
              "支持现有 Hammerspoon app_shortcuts 表与 SSOT Hub 的 AHK v2 声明格式。"
            }
          </p>
        </div>
      )}
      {draft && source && (
        <SourceDialog
          draft={draft}
          sourceRevision={source.revision}
          groups={source.groups}
          close={() => setDraft(null)}
          onSaved={(s) => {
            setSource(s);
            setDraft(null);
            setNotice(
              "源码已保存并备份。请重载 Hammerspoon 或重新运行 AHK v2 脚本以生效。",
            );
          }}
        />
      )}
    </section>
  );
}
