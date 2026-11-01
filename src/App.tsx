import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Cable,
  FileCode2,
  Files,
  FolderGit2,
  Library,
  Globe2,
  HardDrive,
  LayoutDashboard,
  Keyboard,
  Link2,
  LoaderCircle,
  Monitor,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UserRound,
  Waypoints,
  X,
} from "lucide-react";
import { command, chooseFile, chooseExport, desktop } from "./api";
import {
  connections,
  demo,
  dueDays,
  empty,
  fields,
  kinds,
  names,
  primary,
  uid,
  matchesRef,
  today,
  usageLabel,
  currentAssignments,
  type Asset,
  type DeletePlan,
  type Kind,
  type Snapshot,
} from "./model";
import "./App.css";
import "./responsive.css";
import ShortcutsPage from "./ShortcutsPage";
import SyncPanel from "./SyncPanel";
import BackupPanel from "./BackupPanel";
import NetworkImport from "./NetworkImport";
import {
  RecordList,
  useRecordList,
  ListToolbar,
  ListPagination,
} from "./components/RecordList";
const icons = {
  device: Monitor,
  environment: HardDrive,
  software: Box,
  config: FileCode2,
  account: UserRound,
  phone: Smartphone,
  esim: Globe2,
  subscription: Clock3,
  person: UserRound,
  storage: HardDrive,
  domain: Globe2,
  server: Database,
  agent: Sparkles,
  course: FileCode2,
  assignment: RefreshCw,
  resource: Library,
  copy: Files,
  network: Waypoints,
  connection: Cable,
};
type View = "overview" | Kind | "history" | "settings" | "shortcuts";
type Modal =
  | { type: "edit"; asset: Asset; transferFrom?: string }
  | { type: "link"; asset: Asset }
  | { type: "delete"; plan: DeletePlan }
  | { type: "import" }
  | { type: "restore"; snapshot: Snapshot }
  | { type: "new" }
  | { type: "demo" }
  | { type: "network" };
const actionNames: Record<string, string> = {
  create: "登记资产",
  update: "更新资产",
  delete: "删除登记",
  link: "建立关联",
  unlink: "移除关联",
  restore: "恢复快照",
  scan_import: "导入采集结果",
  transfer: "资产交接",
  sync_download: "同步下载",
};
function Icon({ kind, size = 19 }: { kind: Kind; size?: number }) {
  const C = icons[kind];
  return <C size={size} aria-hidden="true" />;
}
function ModalFrame({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-head">
        <div>
          <span className="eyebrow">SSOT HUB / WORKSPACE</span>
          <h2>{title}</h2>
        </div>
        <button aria-label="关闭对话框" className="icon-button" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function AssetEditor({
  asset,
  assets,
  save,
  close,
  busy,
  error,
}: {
  asset: Asset;
  assets: Asset[];
  save: (a: Asset) => void;
  close: () => void;
  busy: boolean;
  error: string;
}) {
  const [value, setValue] = useState<Asset>(structuredClone(asset));
  const change = (key: string, v: string) =>
    setValue((a) => ({ ...a, fields: { ...a.fields, [key]: v } }));
  return (
    <ModalFrame
      title={
        assets.some((a) => a.id === asset.id)
          ? "编辑" + names[asset.kind]
          : "登记" + names[asset.kind]
      }
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save({ ...value, name: value.name.trim() });
        }}
      >
        <div className="form-grid">
          <label className="wide">
            资产名称 *
            <input
              autoFocus
              required
              maxLength={200}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
              placeholder="给这项资产一个易于识别的名字"
            />
          </label>
          {fields[asset.kind].map((f) => (
            <label key={f.key} className={f.type === "textarea" ? "wide" : ""}>
              {f.label}
              {f.ref ? (
                <select
                  required={
                    f.required ||
                    (asset.kind === "software" && f.key === "environment_id")
                  }
                  value={value.fields[f.key] || ""}
                  onChange={(e) => change(f.key, e.target.value)}
                >
                  <option value="">请选择（可选项可留空）</option>
                  {assets
                    .filter(
                      (a) => matchesRef(a.kind, f.ref) && a.id !== asset.id,
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.status === "retired" ? " · 已退役" : ""}
                      </option>
                    ))}
                </select>
              ) : f.options ? (
                <select
                  required={f.required}
                  value={value.fields[f.key] || ""}
                  onChange={(e) => change(f.key, e.target.value)}
                >
                  <option value="">未设置</option>
                  {f.options.map(([v, label]) => (
                    <option value={v} key={v}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  value={value.fields[f.key] || ""}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              ) : (
                <input
                  required={f.required}
                  type={f.type || "text"}
                  placeholder={f.placeholder}
                  value={value.fields[f.key] || ""}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              )}
            </label>
          ))}
          <label>
            资产状态
            <select
              value={value.status}
              onChange={(e) =>
                setValue({
                  ...value,
                  status: e.target.value as Asset["status"],
                })
              }
            >
              <option value="active">使用中</option>
              <option value="retired">已退役</option>
            </select>
          </label>
          <label className="wide">
            备注
            <textarea
              value={value.fields.notes || ""}
              onChange={(e) => change("notes", e.target.value)}
              placeholder="记录用途与维护说明；凭据请使用保险库引用"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="dialog-foot">
          <span className="hint">
            <ShieldCheck size={15} /> 仅保存资产信息和保险库引用
          </span>
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存资产"}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
function RelationshipForm({
  asset,
  assets,
  submit,
  busy,
  error,
}: {
  asset: Asset;
  assets: Asset[];
  submit: (to: string, relation: string) => void;
  busy: boolean;
  error: string;
}) {
  const [target, setTarget] = useState("");
  const [relation, setRelation] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(target, relation.trim());
      }}
    >
      <p className="muted">
        从「{asset.name}
        」建立一条有用途的关联。配置使用关系可填写各机器的本地路径。
      </p>
      <label>
        关联资产
        <select
          autoFocus
          required
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">请选择</option>
          {assets
            .filter((a) => a.id !== asset.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {names[a.kind]} · {a.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        关系用途
        <input
          required
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          placeholder="如：恢复号码、登录于、使用路径：~/.config"
          list="relationship-kinds"
        />
        <datalist id="relationship-kinds">
          {[
            "登录于",
            "恢复号码",
            "服务于",
            "连接到",
            "挂载于",
            "配置同步到",
            "依赖于",
          ].map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        <button className="primary" disabled={busy}>
          建立关联
        </button>
      </div>
    </form>
  );
}
function ScanForm({
  assets,
  revision,
  apply,
  busy,
  error,
}: {
  assets: Asset[];
  revision: number;
  apply: (assets: Asset[], revision: number) => void;
  busy: boolean;
  error: string;
}) {
  const [source, setSource] = useState("brew");
  const [environment, setEnv] = useState("");
  const [depth, setDepth] = useState(2);
  const [preview, setPreview] = useState<Asset[] | null>(null);
  const [localError, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  async function scan() {
    setError("");
    setScanning(true);
    try {
      const path = await chooseFile(source === "git");
      if (!path) return;
      setPreview(
        await command<Asset[]>(
          source === "git" ? "preview_git" : "preview_brew",
          { path, environment, depth },
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }
  return (
    <>
      <p className="muted">
        只读取你选择的清单或目录，预览后再更新台账。已有人工关联会保留。
      </p>
      <div className="form-grid">
        <label>
          采集方式
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPreview(null);
            }}
          >
            <option value="brew">Homebrew JSON 清单</option>
            <option value="git">Git 目录扫描</option>
          </select>
        </label>
        <label>
          所属系统环境
          <select
            value={environment}
            onChange={(e) => {
              setEnv(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">请选择</option>
            {assets
              .filter((a) => a.kind === "environment")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        {source === "git" ? (
          <label>
            扫描深度（0–5）
            <input
              type="number"
              min={0}
              max={5}
              value={depth}
              onChange={(e) => {
                setDepth(Number(e.target.value));
                setPreview(null);
              }}
            />
          </label>
        ) : (
          <div className="wide code-note">
            在目标机器生成清单：
            <code>brew info --json=v2 --installed &gt; brew.json</code>
          </div>
        )}
      </div>
      <button disabled={!environment || scanning || busy} onClick={scan}>
        {scanning ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <FolderGit2 size={16} />
        )}{" "}
        {source === "git" ? "选择目录并扫描" : "选择 JSON 并预览"}
      </button>
      {preview && (
        <div className="import-preview">
          <h3>预览 · {preview.length} 项</h3>
          <RecordList
            listKey={`import-preview.${source}`}
            label="导入项"
            items={preview}
            search={(a) => `${a.name} ${a.fields.path || ""}`}
            sortFields={[
              { key: "name", label: "名称", value: (a) => a.name },
              {
                key: "version",
                label: "版本",
                value: (a) => a.fields.version || a.fields.commit || "",
              },
            ]}
            empty="没有发现可导入的软件。"
          >
            {(rows) =>
              rows.map((a) => (
                <div className="import-preview-row" key={a.id}>
                  <span>{a.name}</span>
                  <code>
                    {a.fields.version || a.fields.commit?.slice(0, 9)}
                  </code>
                </div>
              ))
            }
          </RecordList>
        </div>
      )}
      {(error || localError) && (
        <p className="form-error" role="alert">
          {error || localError}
        </p>
      )}
      <div className="dialog-foot">
        <button
          className="primary"
          disabled={busy || !preview?.length}
          onClick={() => preview && apply(preview, revision)}
        >
          确认导入{preview ? ` ${preview.length} 项` : ""}
        </button>
      </div>
    </>
  );
}
function Cost({ asset }: { asset: Asset }) {
  const [value, setValue] = useState("");
  const f = asset.fields;
  useEffect(() => {
    let live = true;
    setValue("");
    if (f.price && f.exchange_rate)
      command<string>("cycle_cost", { price: f.price, rate: f.exchange_rate })
        .then((v) => {
          if (live) setValue(v);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [f.price, f.exchange_rate]);
  return (
    <div className="cost-box">
      <span>
        原币 /{" "}
        {({ month: "月", year: "年", once: "次" } as Record<string, string>)[
          f.billing_period
        ] || "周期"}
      </span>
      <strong>
        {f.currency || "—"} {f.price || "—"}
      </strong>
      {value && (
        <small>
          ≈ {f.base_currency || "未指定本币"} {value} · 汇率日期{" "}
          {f.rate_date || "未填写"}
        </small>
      )}
    </div>
  );
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [due, setDue] = useState("all");
  const [member, setMember] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [dimension, setDimension] = useState("");
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [path, setPath] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    try {
      setSnapshot(await command<Snapshot>("load"));
      setPath(await command<string>("data_path"));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  const run = async <T,>(fn: () => Promise<T>, success?: (v: T) => void) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const v = await fn();
      success?.(v);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const mutate = (
    name: string,
    args: Record<string, unknown>,
    message: string,
  ) =>
    run(
      () => command<Snapshot>(name, { ...args, revision: snapshot.revision }),
      (s) => {
        setSnapshot(s);
        setModal(null);
        setNotice(message);
      },
    );
  const navigate = (v: View) => {
    setView(v);
    setSelected(null);
    setQuery("");
    setStatus("active");
    setDue("all");
    setMember("");
    setKindFilter("");
    setDimension("");
    setError("");
  };
  const openModal = (m: Modal) => {
    setError("");
    setModal(m);
  };
  const newAsset = (kind: Kind) =>
    openModal({
      type: "edit",
      asset: {
        id: uid(),
        kind,
        name: "",
        status: "active",
        fields:
          kind === "assignment"
            ? { starts_on: today(), usage_role: "primary" }
            : {},
      },
    });
  const current = snapshot.assets.find((a) => a.id === selected);
  const active = snapshot.assets.filter((a) => a.status === "active");
  const expiring = active
    .filter((a) => {
      const n = dueDays(a.fields.expires_on);
      return n !== null && n <= 30;
    })
    .sort((a, b) =>
      (a.fields.expires_on || "").localeCompare(b.fields.expires_on || ""),
    );
  const dimensionKey = (
    {
      device: "device_kind",
      account: "provider",
      subscription: "category",
      course: "subject",
      assignment: "usage_role",
      person: "person_kind",
      storage: "storage_kind",
      server: "provider",
    } as Record<string, string>
  )[view];
  const candidates = snapshot.assets
    .filter(
      (a) =>
        (view === "overview" || a.kind === view) &&
        (!kindFilter || a.kind === kindFilter) &&
        (!dimension || a.fields[dimensionKey] === dimension) &&
        (status === "all" || a.status === status) &&
        (!member ||
          a.fields.owner_id === member ||
          a.fields.person_id === member ||
          currentAssignments(snapshot, a.id).some(
            (r) => r.fields.person_id === member,
          )) &&
        (due === "all" ||
          (dueDays(a.fields.expires_on) !== null &&
            dueDays(a.fields.expires_on)! <= 30)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const assetList = useRecordList({
    listKey: `assets.${view}`,
    items: candidates,
    scope: `${status}|${due}|${member}|${kindFilter}|${dimension}`,
    search: (a) =>
      `${a.name} ${Object.values(a.fields).join(" ")} ${usageLabel(a, snapshot)}`,
    sortFields: [
      { key: "name", label: "资产名称", value: (a) => a.name },
      { key: "kind", label: "类型", value: (a) => names[a.kind] },
      { key: "status", label: "状态", value: (a) => a.status },
      { key: "usage", label: "使用人", value: (a) => usageLabel(a, snapshot) },
      {
        key: "expires",
        label: "到期日期",
        value: (a) => a.fields.expires_on || "9999-12-31",
      },
    ],
  });
  const list = assetList.rows;
  const { query, setQuery } = assetList;
  const title =
    view === "overview"
      ? "资产总览"
      : view === "history"
        ? "变更记录"
        : view === "settings"
          ? "数据与备份"
          : view === "shortcuts"
            ? "应用快捷键"
            : names[view];
  const goAsset = (a: Asset) => {
    setView(a.kind);
    setQuery("");
    setStatus("all");
    setDue("all");
    setMember("");
    setKindFilter("");
    setDimension("");
    setSelected(a.id);
  };
  const backup = () =>
    run(
      () => command<string>("backup"),
      (p) => setNotice(`备份已保存：${p}`),
    );
  const restore = () =>
    run(
      async () => {
        const file = await chooseFile();
        if (!file) return null;
        return command<Snapshot>("preview_snapshot", { path: file });
      },
      (s) => {
        if (s) openModal({ type: "restore", snapshot: s });
      },
    );
  const exportData = () =>
    run(
      async () => {
        const p = await chooseExport();
        if (!p) return false;
        await command("export_snapshot", { path: p });
        return true;
      },
      (ok) => {
        if (ok) setNotice("快照已导出，可审核后交接到另一台机器。");
      },
    );
  function counts(k: Kind) {
    return active.filter((a) => a.kind === k).length;
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Database size={21} />
          </div>
          <div>
            SSOT<span>HUB</span>
          </div>
          <small>{desktop ? "DESKTOP" : "WEB"}</small>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            <HardDrive size={19} />
          </span>
          <div>
            <strong>个人工作空间</strong>
            <small>本地资产台账</small>
          </div>
          <ChevronRight size={14} />
        </div>
        <nav aria-label="主导航">
          <button
            className={view === "overview" ? "nav active" : "nav"}
            onClick={() => navigate("overview")}
          >
            <LayoutDashboard size={18} />
            资产总览
          </button>
          <div className="nav-label">资产管理</div>
          {kinds.slice(0, 4).map((k) => (
            <button
              key={k}
              className={view === k ? "nav active" : "nav"}
              onClick={() => navigate(k)}
            >
              <Icon kind={k} />
              {names[k]}
              <span className="count">{counts(k)}</span>
            </button>
          ))}
          <div className="nav-label">身份与权益</div>
          {kinds.slice(4, 8).map((k) => (
            <button
              key={k}
              className={view === k ? "nav active" : "nav"}
              onClick={() => navigate(k)}
            >
              <Icon kind={k} />
              {names[k]}
              <span className="count">{counts(k)}</span>
            </button>
          ))}
          <div className="nav-label">家庭与服务</div>
          {kinds.slice(8).map((k) => (
            <button
              key={k}
              className={view === k ? "nav active" : "nav"}
              onClick={() => navigate(k)}
            >
              <Icon kind={k} />
              {names[k]}
              <span className="count">{counts(k)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={view === "shortcuts" ? "nav active" : "nav"}
            onClick={() => navigate("shortcuts")}
          >
            <Keyboard size={18} />
            应用快捷键
          </button>
          <button
            className={view === "history" ? "nav active" : "nav"}
            onClick={() => navigate("history")}
          >
            <Activity size={18} />
            变更记录
          </button>
          <button
            className={view === "settings" ? "nav active" : "nav"}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} />
            数据与备份
          </button>
          <div className="local-indicator">
            <span />
            本地优先 <small>v0.2.2</small>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy">
              <ShieldCheck size={15} /> 数据保存在本机
            </span>
            <button
              className="icon-button"
              disabled={busy}
              aria-label="刷新台账"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main>
          <label className="mobile-navigation">
            导航
            <select
              aria-label="页面导航"
              value={view}
              onChange={(e) => navigate(e.target.value as View)}
            >
              <option value="overview">资产总览</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {names[k]}
                </option>
              ))}
              <option value="history">变更记录</option>
              <option value="settings">数据与备份 / 同步</option>
              {desktop && <option value="shortcuts">应用快捷键</option>}
            </select>
          </label>
          <div className="page-head">
            <div>
              <div className="eyebrow">YOUR DIGITAL INVENTORY</div>
              <h1>
                {title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {view === "overview"
                  ? "让分散的数字资产，在这里有迹可循。"
                  : view === "history"
                    ? "每一次变更，都保留来处。"
                    : view === "shortcuts"
                      ? "选好应用，设好按键，直接维护你的启动代码。"
                      : view === "settings"
                        ? "为你的台账保留一份可恢复、可交接的副本。"
                        : `集中管理${names[view]}，掌握状态、用途与关联。`}
              </p>
            </div>
            <div className="head-actions">
              {view !== "history" &&
                view !== "settings" &&
                view !== "shortcuts" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => openModal({ type: "network" })}
                    >
                      导入路由器清单
                    </button>
                    <button
                      disabled={busy || !desktop}
                      onClick={() => openModal({ type: "import" })}
                    >
                      <ArrowDownToLine size={16} />
                      导入清单
                    </button>
                    <button
                      disabled={busy}
                      className="primary"
                      onClick={() =>
                        newAsset(
                          kinds.includes(view as Kind)
                            ? (view as Kind)
                            : "device",
                        )
                      }
                    >
                      <Plus size={17} />
                      登记资产
                    </button>
                  </>
                )}
            </div>
          </div>
          {!desktop && (
            <div className="banner">
              <Monitor size={18} />
              <span>
                Web 本地台账 ·
                数据保存在此浏览器；清除网站数据会丢失，请定期备份或同步。快捷键源码与软件扫描仅限桌面。
              </span>
            </div>
          )}
          {error && !modal && (
            <div role="alert" className="banner error">
              {error}
              <button onClick={() => void refresh()}>重新加载</button>
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              <Check size={18} />
              <span>{notice}</span>
              <button aria-label="关闭通知" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              <h3>正在打开本地台账…</h3>
            </div>
          ) : view === "shortcuts" ? (
            <ShortcutsPage />
          ) : view === "settings" ? (
            <div className="settings-grid">
              <SyncPanel snapshot={snapshot} onChange={setSnapshot} />
              <BackupPanel snapshot={snapshot} onChange={setSnapshot} />
              <section className="panel settings-card">
                <span className="section-icon">
                  <Database />
                </span>
                <h2>本地工作空间</h2>
                <p>
                  资产、关系和变更记录保存在
                  {desktop ? "本机 SQLite" : "本浏览器 IndexedDB"}中。
                </p>
                <code className="path">{path}</code>
                <div className="metrics-inline">
                  <span>{snapshot.assets.length} 项资产</span>
                  <span>{snapshot.links.length} 条关系</span>
                  <span>修订 {snapshot.revision}</span>
                </div>
                <button
                  onClick={() => openModal({ type: "new" })}
                  disabled={busy}
                >
                  <Plus size={16} />
                  创建空工作空间
                </button>
                <p className="small">
                  创建前自动备份当前台账。旧数据库保留，新空间将在下次启动时继续使用。
                </p>
              </section>
              <section className="panel settings-card">
                <span className="section-icon">
                  <ShieldCheck />
                </span>
                <h2>备份与交接</h2>
                <p>
                  备份覆盖全部资产、关系和变更记录；JSON
                  快照可用于恢复与多机串行交接。
                </p>
                <div className="stack">
                  <button onClick={backup} disabled={busy}>
                    <ShieldCheck size={17} />
                    立即备份到本机
                  </button>
                  <button onClick={exportData} disabled={busy}>
                    <Download size={17} />
                    导出 JSON 快照
                  </button>
                  <button onClick={restore} disabled={busy}>
                    <ArrowDownToLine size={17} />
                    预览并恢复快照
                  </button>
                </div>
                <p className="small">
                  恢复仅允许空台账。导出文件包含邮箱、号码等信息，未加密；请保存在受控位置。
                </p>
              </section>
              <section className="panel settings-card wide">
                <h2>一台机器编辑，一份快照交接</h2>
                <div className="steps">
                  <div>
                    <b>01</b>
                    <strong>编辑并导出</strong>
                    <p>在机器 A 核对信息并导出快照。</p>
                  </div>
                  <ArrowRight />
                  <div>
                    <b>02</b>
                    <strong>私有渠道传递</strong>
                    <p>审核差异，经自己的私有 Git 传递。</p>
                  </div>
                  <ArrowRight />
                  <div>
                    <b>03</b>
                    <strong>空库载入接手</strong>
                    <p>机器 B 预览恢复，核对后继续维护。</p>
                  </div>
                </div>
                <p className="small">
                  并发分叉不会自动合并。保留双方快照，确认数据后再恢复。
                </p>
              </section>
            </div>
          ) : view === "history" ? (
            <section className="panel">
              <div className="panel-heading">
                <h2>台账活动</h2>
                <span className="subtle">{snapshot.events.length} 条记录</span>
              </div>
              <RecordList
                dimensions={[
                  {
                    key: "action",
                    label: "动作",
                    value: (e) => actionNames[e.action] || e.action,
                  },
                  { key: "actor", label: "来源", value: (e) => e.actor },
                ]}
                listKey="audit"
                label="变更记录"
                items={snapshot.events}
                search={(e) =>
                  `${actionNames[e.action] || e.action} ${e.actor} ${e.detail}`
                }
                sortFields={[
                  { key: "date", label: "时间", value: (e) => e.at },
                  { key: "action", label: "动作", value: (e) => e.action },
                  { key: "actor", label: "来源", value: (e) => e.actor },
                ]}
                empty="尚无变更记录，登记资产后将记录修改来源与时间。"
              >
                {(rows) => (
                  <div className="timeline">
                    {rows.map((e) => (
                      <article key={e.id}>
                        <span className="timeline-dot">
                          <Activity size={16} />
                        </span>
                        <div>
                          <strong>{actionNames[e.action] || e.action}</strong>
                          <small>
                            {new Date(e.at).toLocaleString("zh-CN")} · {e.actor}
                          </small>
                          <details>
                            <summary>查看变更内容</summary>
                            <pre>
                              {(() => {
                                try {
                                  return JSON.stringify(
                                    JSON.parse(e.detail),
                                    null,
                                    2,
                                  );
                                } catch {
                                  return e.detail;
                                }
                              })()}
                            </pre>
                          </details>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </RecordList>
            </section>
          ) : (
            <>
              {view === "overview" && (
                <>
                  <div className="stats">
                    {[
                      {
                        label: "使用中的资产",
                        value: active.length,
                        icon: Box,
                        note: `覆盖 ${kinds.filter((k) => counts(k) > 0).length} 类资产`,
                      },
                      {
                        label: "设备与系统环境",
                        value: counts("device") + counts("environment"),
                        icon: Monitor,
                        note: "连接你的工作环境",
                      },
                      {
                        label: "身份与通信资产",
                        value:
                          counts("account") + counts("phone") + counts("esim"),
                        icon: UserRound,
                        note: "账号、号码与套餐",
                      },
                      {
                        label: "30 天内到期",
                        value: expiring.length,
                        icon: Clock3,
                        note: expiring.length
                          ? "到期事项待核对"
                          : "当前无待处理事项",
                      },
                    ].map((s, i) => (
                      <button
                        className="stat"
                        key={s.label}
                        onClick={() => {
                          if (i === 3) {
                            setDue("soon");
                            setStatus("active");
                          } else if (i === 1) navigate("device");
                          else if (i === 2) navigate("account");
                          else {
                            setDue("all");
                            setStatus("active");
                          }
                        }}
                      >
                        <span>
                          {s.label}
                          <s.icon size={18} />
                        </span>
                        <strong>{s.value.toString().padStart(2, "0")}</strong>
                        <small
                          className={i === 3 && s.value ? "warning-text" : ""}
                        >
                          {s.note}
                          {i === 3 && s.value > 0 && <ArrowUpRight size={13} />}
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="overview-row">
                    <section className="welcome-strip">
                      <div className="welcome-art">
                        <Database size={30} />
                        <span className="orbit orbit-a">
                          <Monitor size={15} />
                        </span>
                        <span className="orbit orbit-b">
                          <UserRound size={15} />
                        </span>
                        <span className="orbit orbit-c">
                          <FileCode2 size={15} />
                        </span>
                      </div>
                      <div>
                        <span className="eyebrow">
                          ONE PLACE. EVERYTHING CONNECTED.
                        </span>
                        <h2>
                          {snapshot.assets.length
                            ? "资产有归属，变更有依据。"
                            : "从第一项资产，建立你的数字地图。"}
                        </h2>
                        <p>登记设备，关联账号，找到每一份配置的权威来源。</p>
                      </div>
                      <button
                        onClick={() =>
                          snapshot.assets.length
                            ? navigate("config")
                            : newAsset("device")
                        }
                      >
                        {snapshot.assets.length ? "管理配置" : "开始登记"}
                        <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              <div
                className={
                  current ? "content-grid with-detail" : "content-grid"
                }
              >
                <section className="panel inventory">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {view === "overview" ? "全部资产" : names[view as Kind]}{" "}
                        <span className="badge neutral">{assetList.total}</span>
                      </h2>
                      <p>
                        {query
                          ? "已按关键词筛选"
                          : view === "overview"
                            ? "你的设备、工具与身份，尽在一处。"
                            : "选择一项资产，查看详情与关联。"}
                      </p>
                    </div>
                    {view === "overview" && (
                      <button
                        className="text-button"
                        onClick={() => navigate("history")}
                      >
                        最近变更
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                  <ListToolbar
                    list={assetList}
                    label="资产"
                    inputRef={searchRef}
                  >
                    {view === "overview" && (
                      <select
                        aria-label="按资产类型筛选"
                        value={kindFilter}
                        onChange={(e) => setKindFilter(e.target.value)}
                      >
                        <option value="">全部类型</option>
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {names[k]}
                          </option>
                        ))}
                      </select>
                    )}
                    {dimensionKey && (
                      <select
                        aria-label="按分类筛选"
                        value={dimension}
                        onChange={(e) => setDimension(e.target.value)}
                      >
                        <option value="">全部分类</option>
                        {Array.from(
                          new Set(
                            snapshot.assets
                              .filter((a) => a.kind === view)
                              .map((a) => a.fields[dimensionKey])
                              .filter(Boolean),
                          ),
                        )
                          .sort()
                          .map((v) => (
                            <option key={v} value={v}>
                              {fields[view as Kind]
                                .find((f) => f.key === dimensionKey)
                                ?.options?.find((o) => o[0] === v)?.[1] || v}
                            </option>
                          ))}
                      </select>
                    )}
                    <select
                      aria-label="按成员筛选"
                      value={member}
                      onChange={(e) => setMember(e.target.value)}
                    >
                      <option value="">全部成员 / 使用人</option>
                      {snapshot.assets
                        .filter((a) => a.kind === "person")
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                    <select
                      aria-label="按状态筛选"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="active">使用中</option>
                      <option value="retired">已退役</option>
                      <option value="all">全部状态</option>
                    </select>
                    <select
                      aria-label="按到期日期筛选"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    >
                      <option value="all">全部日期</option>
                      <option value="soon">30 天内到期 / 已到期</option>
                    </select>
                  </ListToolbar>
                  {list.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>资产名称</th>
                            <th>归属 / 来源</th>
                            <th>状态</th>
                            <th>到期</th>
                            <th>
                              <span className="sr-only">查看</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((a) => {
                            const n = dueDays(a.fields.expires_on);
                            return (
                              <tr
                                key={a.id}
                                className={selected === a.id ? "selected" : ""}
                              >
                                <td>
                                  <button
                                    className="asset-name"
                                    onClick={() => setSelected(a.id)}
                                  >
                                    <span className={`asset-icon ${a.kind}`}>
                                      <Icon kind={a.kind} />
                                    </span>
                                    <span>
                                      <strong>{a.name}</strong>
                                      <small>
                                        {names[a.kind]}
                                        {a.fields.version
                                          ? ` · ${a.fields.version}`
                                          : ""}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td
                                  className="secondary-cell"
                                  title={primary(a, snapshot)}
                                >
                                  {primary(a, snapshot)}
                                  {["device", "storage", "server"].includes(
                                    a.kind,
                                  ) && (
                                    <small className="usage-cell">
                                      {usageLabel(a, snapshot)}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <span className={`badge ${a.status}`}>
                                    <i />
                                    {a.status === "active"
                                      ? "使用中"
                                      : "已退役"}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={
                                      n !== null && n <= 30
                                        ? "due-warning"
                                        : "subtle"
                                    }
                                  >
                                    {n === null
                                      ? "—"
                                      : n < 0
                                        ? `已到期 ${-n} 天`
                                        : n === 0
                                          ? "今天到期"
                                          : `${n} 天后`}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`查看 ${a.name}`}
                                    onClick={() => setSelected(a.id)}
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      <span className="empty-icon">
                        <Box size={28} />
                      </span>
                      <h3>
                        {snapshot.assets.length
                          ? "没有符合条件的资产"
                          : "你的资产台账，等待第一笔登记"}
                      </h3>
                      <p>
                        {snapshot.assets.length
                          ? "调整搜索或筛选条件，找到需要的资产。"
                          : "先添加常用设备，再逐步连接软件、账号与订阅。"}
                      </p>
                      <div className="empty-actions">
                        <button
                          className="primary"
                          onClick={() =>
                            newAsset(
                              kinds.includes(view as Kind)
                                ? (view as Kind)
                                : "device",
                            )
                          }
                        >
                          <Plus size={16} />
                          登记
                          {view === "overview"
                            ? "第一项资产"
                            : names[view as Kind]}
                        </button>
                        {!snapshot.assets.length && (
                          <button onClick={() => openModal({ type: "demo" })}>
                            <Sparkles size={16} />
                            体验虚构示例
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <ListPagination list={assetList} label="资产" />
                  <div className="table-foot">
                    <span>
                      {assetList.total} 项登记 · 修订 {snapshot.revision}
                    </span>
                    <span>
                      <ShieldCheck size={13} />
                      本地保存
                    </span>
                  </div>
                </section>
                {current && (
                  <aside className="panel detail">
                    <div className="detail-header">
                      <span className={`asset-icon ${current.kind}`}>
                        <Icon kind={current.kind} size={24} />
                      </span>
                      <button
                        className="icon-button"
                        aria-label="关闭详情"
                        onClick={() => setSelected(null)}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <span className="eyebrow">{names[current.kind]}</span>
                    <h2>{current.name}</h2>
                    <span className={`badge ${current.status}`}>
                      <i />
                      {current.status === "active" ? "使用中" : "已退役"}
                    </span>
                    <div className="detail-actions">
                      <button
                        onClick={() =>
                          openModal({ type: "edit", asset: current })
                        }
                      >
                        编辑资产
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label="预览删除资产"
                        onClick={() =>
                          run(
                            () =>
                              command<DeletePlan>("delete_plan", {
                                id: current.id,
                              }),
                            (p) => openModal({ type: "delete", plan: p }),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {["device", "storage", "server"].includes(current.kind) && (
                      <div className="usage-summary">
                        <h3>当前使用</h3>
                        <p>{usageLabel(current, snapshot)}</p>
                        <button
                          onClick={() =>
                            openModal({
                              type: "edit",
                              asset: {
                                id: uid(),
                                kind: "assignment",
                                name: `${current.name} · 使用记录`,
                                status: "active",
                                fields: {
                                  asset_id: current.id,
                                  starts_on: today(),
                                  usage_role: "primary",
                                },
                              },
                            })
                          }
                        >
                          分配使用人
                        </button>
                      </div>
                    )}
                    {current.kind === "assignment" &&
                      !current.fields.ends_on &&
                      current.status === "active" && (
                        <button
                          onClick={() =>
                            openModal({
                              type: "edit",
                              transferFrom: current.id,
                              asset: {
                                ...structuredClone(current),
                                id: uid(),
                                name: `${snapshot.assets.find((a) => a.id === current.fields.asset_id)?.name || "资产"} · 交接`,
                                fields: {
                                  ...current.fields,
                                  person_id: "",
                                  starts_on: today(),
                                  ends_on: "",
                                },
                              },
                            })
                          }
                        >
                          交接给另一位成员
                        </button>
                      )}
                    {current.kind === "course" && (
                      <div className="usage-summary">
                        剩余课时：
                        {Number(current.fields.lessons_total || 0) -
                          Number(current.fields.lessons_used || 0)}{" "}
                        / {current.fields.lessons_total || "未填写"}
                      </div>
                    )}
                    {current.kind === "subscription" && (
                      <Cost asset={current} />
                    )}
                    <dl>
                      {fields[current.kind]
                        .filter((f) => current.fields[f.key])
                        .map((f) => (
                          <div key={f.key}>
                            <dt>{f.label}</dt>
                            <dd>
                              {f.ref ? (
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    const target = snapshot.assets.find(
                                      (a) => a.id === current.fields[f.key],
                                    );
                                    if (target) goAsset(target);
                                  }}
                                >
                                  {snapshot.assets.find(
                                    (a) => a.id === current.fields[f.key],
                                  )?.name || "引用缺失"}
                                  <ArrowUpRight size={12} />
                                </button>
                              ) : (
                                f.options?.find(
                                  ([v]) => v === current.fields[f.key],
                                )?.[1] || current.fields[f.key]
                              )}
                            </dd>
                          </div>
                        ))}
                      {current.fields.notes && (
                        <div>
                          <dt>备注</dt>
                          <dd>{current.fields.notes}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="relation-heading">
                      <h3>关系拓扑（双向追踪）</h3>
                    </div>
                    {["device", "storage", "server", "person"].includes(
                      current.kind,
                    ) && (
                      <RecordList
                        listKey={`usage-history.${current.kind}`}
                        label="使用历史"
                        items={snapshot.assets.filter(
                          (a) =>
                            a.kind === "assignment" &&
                            (a.fields.asset_id === current.id ||
                              a.fields.person_id === current.id),
                        )}
                        search={(a) =>
                          `${a.name} ${snapshot.assets.find((p) => p.id === a.fields.person_id)?.name || ""}`
                        }
                        sortFields={[
                          {
                            key: "starts_on",
                            label: "开始日期",
                            value: (a) => a.fields.starts_on,
                          },
                          { key: "name", label: "名称", value: (a) => a.name },
                        ]}
                        empty="尚无使用记录"
                      >
                        {(rows) =>
                          rows.map((a) => (
                            <div className="usage-summary" key={a.id}>
                              <button
                                className="text-button"
                                onClick={() => goAsset(a)}
                              >
                                {
                                  snapshot.assets.find(
                                    (p) => p.id === a.fields.person_id,
                                  )?.name
                                }{" "}
                                ·{" "}
                                {
                                  snapshot.assets.find(
                                    (p) => p.id === a.fields.asset_id,
                                  )?.name
                                }
                              </button>
                              <p>
                                {a.fields.starts_on} →{" "}
                                {a.fields.ends_on || "持续使用"}
                              </p>
                              <small>
                                {
                                  fields.assignment
                                    .find((f) => f.key === "usage_role")
                                    ?.options?.find(
                                      (o) => o[0] === a.fields.usage_role,
                                    )?.[1]
                                }
                              </small>
                            </div>
                          ))
                        }
                      </RecordList>
                    )}
                    <div className="relation-heading">
                      <h3>
                        关联资产{" "}
                        <span>{connections(current, snapshot).length}</span>
                      </h3>
                      <button
                        className="icon-button"
                        aria-label="新增关联"
                        onClick={() =>
                          openModal({ type: "link", asset: current })
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <div className="relations">
                      <RecordList
                        listKey={`relations.${current.kind}`}
                        dimensions={[
                          {
                            key: "relation",
                            label: "关系用途",
                            value: (r) => r.label,
                          },
                        ]}
                        label="关联资产"
                        items={connections(current, snapshot)}
                        search={(r) =>
                          `${snapshot.assets.find((a) => a.id === r.id)?.name || ""} ${r.label}`
                        }
                        sortFields={[
                          {
                            key: "name",
                            label: "资产名称",
                            value: (r) =>
                              snapshot.assets.find((a) => a.id === r.id)
                                ?.name || "",
                          },
                          {
                            key: "relation",
                            label: "关系用途",
                            value: (r) => r.label,
                          },
                        ]}
                        empty="还没有关联。连接账号、设备或配置，让信息更完整。"
                      >
                        {(rows) => (
                          <>
                            {rows.map((r, i) => {
                              const target = snapshot.assets.find(
                                (a) => a.id === r.id,
                              );
                              return (
                                target && (
                                  <div
                                    className="relation"
                                    key={`${r.id}-${i}`}
                                  >
                                    <button onClick={() => goAsset(target)}>
                                      <Icon kind={target.kind} size={17} />
                                      <span>
                                        <strong>{target.name}</strong>
                                        <small>{r.label}</small>
                                      </span>
                                      <ArrowUpRight size={13} />
                                    </button>
                                    {r.linkId && (
                                      <button
                                        className="icon-button"
                                        aria-label={`移除与 ${target.name} 的关联`}
                                        onClick={() =>
                                          mutate(
                                            "remove_link",
                                            { id: r.linkId },
                                            "关联已移除",
                                          )
                                        }
                                      >
                                        <X size={13} />
                                      </button>
                                    )}
                                  </div>
                                )
                              );
                            })}
                          </>
                        )}
                      </RecordList>
                    </div>
                    <div className="asset-id">ID · {current.id}</div>
                  </aside>
                )}
              </div>
              {view === "overview" && (
                <div className="bottom-note">
                  <ShieldCheck size={15} />
                  <span>资产元数据在这里，配置内容在原处，凭据在保险库。</span>
                  <button
                    className="text-button"
                    onClick={() => navigate("settings")}
                  >
                    了解数据管理
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            SSOT Hub <span>你的数字资产，有序可循。</span>
            <span className="footer-right">
              <span className="online-dot" />
              {busy ? "正在处理…" : "本地工作空间"}
            </span>
          </footer>
        </main>
      </div>
      {modal?.type === "edit" && (
        <AssetEditor
          key={modal.asset.id}
          asset={modal.asset}
          assets={snapshot.assets}
          busy={busy}
          error={error}
          close={() => !busy && setModal(null)}
          save={(a) =>
            modal.transferFrom
              ? mutate(
                  "transfer_asset",
                  { id: modal.transferFrom, next: a },
                  "交接完成，旧使用历史已保留",
                )
              : mutate("save_asset", { asset: a }, "资产已保存")
          }
        />
      )}
      {modal?.type === "link" && (
        <ModalFrame title="关联资产" close={() => !busy && setModal(null)}>
          <RelationshipForm
            asset={modal.asset}
            assets={snapshot.assets}
            busy={busy}
            error={error}
            submit={(to, relation) =>
              mutate(
                "save_link",
                { link: { id: uid(), from: modal.asset.id, to, relation } },
                "关联已建立",
              )
            }
          />
        </ModalFrame>
      )}
      {modal?.type === "import" && (
        <ModalFrame title="导入软件清单" close={() => !busy && setModal(null)}>
          <ScanForm
            assets={snapshot.assets}
            revision={snapshot.revision}
            busy={busy}
            error={error}
            apply={(assets, revision) =>
              mutate("apply_import", { assets, revision }, "软件清单已导入")
            }
          />
        </ModalFrame>
      )}
      {modal?.type === "network" && (
        <ModalFrame title="网络发现候选" close={() => !busy && setModal(null)}>
          <NetworkImport
            snapshot={snapshot}
            apply={(assets) =>
              mutate(
                "apply_import",
                { assets },
                "已登记所选候选；请补充型号、产权和使用人",
              )
            }
            busy={busy}
            error={error}
          />
        </ModalFrame>
      )}
      {modal?.type === "delete" && (
        <ModalFrame title="删除预览" close={() => !busy && setModal(null)}>
          <p>
            将删除「<strong>{modal.plan.asset.name}</strong>
            」的台账登记，应用前自动备份。软件和配置文件不会被删除。
          </p>
          {modal.plan.blockers.length ? (
            <div className="blockers">
              <h3>请先处理以下引用</h3>
              <RecordList
                listKey="delete.blockers"
                label="引用"
                items={modal.plan.blockers}
                search={(s) => s}
                sortFields={[
                  { key: "reference", label: "引用", value: (s) => s },
                ]}
              >
                {(rows) =>
                  rows.map((s, i) => (
                    <p key={i}>
                      <Link2 size={14} />
                      {s}
                    </p>
                  ))
                }
              </RecordList>
            </div>
          ) : (
            <div className="banner">
              <ShieldCheck size={18} />
              没有引用阻塞，可以执行删除。
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="destructive"
              disabled={busy || !!modal.plan.blockers.length}
              onClick={() => {
                const p = modal.plan;
                void run(
                  () =>
                    command<Snapshot>("delete_asset", {
                      id: p.asset.id,
                      revision: p.revision,
                    }),
                  (s) => {
                    setSnapshot(s);
                    setModal(null);
                    setSelected(null);
                    setNotice("已先备份，再删除资产登记。");
                  },
                );
              }}
            >
              备份并删除登记
            </button>
          </div>
        </ModalFrame>
      )}
      {modal?.type === "restore" && (
        <ModalFrame title="恢复快照预览" close={() => !busy && setModal(null)}>
          <p>快照已通过结构与引用校验。</p>
          <div className="metrics-inline">
            <span>{modal.snapshot.assets.length} 项资产</span>
            <span>{modal.snapshot.links.length} 条关系</span>
            <span>{modal.snapshot.events.length} 条变更</span>
          </div>
          {(snapshot.assets.length > 0 || snapshot.events.length > 0) && (
            <p className="form-error">
              当前台账非空。请先在「数据与备份」创建空工作空间，再重新载入快照。
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={
                busy || snapshot.assets.length > 0 || snapshot.events.length > 0
              }
              onClick={() =>
                mutate(
                  "restore_snapshot",
                  { snapshot: modal.snapshot },
                  "快照已恢复，请核对资产与关系",
                )
              }
            >
              恢复到空台账
            </button>
          </div>
        </ModalFrame>
      )}
      {modal?.type === "new" && (
        <ModalFrame
          title="创建空工作空间"
          close={() => !busy && setModal(null)}
        >
          <p>
            当前台账会先备份，原数据库继续保留。随后切换到全新空台账，可用于接手其他机器的快照。
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="dialog-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(
                  () => command<Snapshot>("new_workspace"),
                  (s) => {
                    try {
                      for (const key of Object.keys(localStorage))
                        if (key.startsWith("ssot.sync.hash."))
                          localStorage.removeItem(key);
                    } catch {
                      /* Local data has already been safely backed up. */
                    }
                    setSnapshot(s);
                    setSelected(null);
                    setModal(null);
                    void command<string>("data_path").then(setPath);
                    setNotice("已备份并切换到空工作空间");
                  },
                )
              }
            >
              备份并创建
            </button>
          </div>
        </ModalFrame>
      )}
      {modal?.type === "demo" && (
        <ModalFrame
          title="体验示例工作空间"
          close={() => !busy && setModal(null)}
        >
          <p>
            载入 6
            项虚构资产，展示设备、账号、软件、配置和订阅如何关联。所有邮箱与地址均为示例。
          </p>
          <p className="small">
            示例写入当前空台账，不会扫描你的设备。体验后可在数据管理中创建新的空工作空间。
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                mutate(
                  "restore_snapshot",
                  { snapshot: demo() },
                  "虚构示例已载入",
                );
              }}
            >
              载入虚构示例
            </button>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
