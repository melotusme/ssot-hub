import { useEffect, useState } from "react";
import { Bot, Check, KeyRound, Zap } from "lucide-react";
import { commands } from "./api";
import { RecordList } from "./components/RecordList";
import type {
  AiSettings_Serialize as AiSettings,
  ApiKind,
  Provider_Serialize as Provider,
} from "./bindings";

interface Preset {
  name: string;
  api: ApiKind;
  base_url: string;
  model: string;
}
/** Common services; any other OpenAI-compatible address works too. */
export const presets: Preset[] = [
  {
    name: "OpenAI",
    api: "openai",
    base_url: "https://api.openai.com/v1",
    model: "",
  },
  {
    name: "Anthropic",
    api: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    model: "",
  },
  {
    name: "DeepSeek",
    api: "openai",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    name: "OpenRouter",
    api: "openai",
    base_url: "https://openrouter.ai/api/v1",
    model: "",
  },
  {
    name: "Ollama（本机）",
    api: "openai",
    base_url: "http://127.0.0.1:11434/v1",
    model: "",
  },
];
const apiNames: Record<ApiKind, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
};
const blank = (): Provider => ({
  id: "",
  name: "",
  api: "openai",
  base_url: "",
  model: "",
  has_key: false,
  source: null,
});

/** Edit one provider: address, model and a key that goes straight to the OS keychain. */
function ProviderForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Provider;
  busy: boolean;
  onSave: (p: Provider, key: string | null) => Promise<Provider | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<Provider>(initial);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const magpie = value.source === "magpie";
  const save = async (test: boolean) => {
    const saved = await onSave(value, clearKey ? "" : key || null);
    if (!saved) return;
    setValue(saved);
    setKey("");
    setClearKey(false);
    if (!test) return;
    try {
      setStatus("正在连接…");
      const list = await commands.ai_models(saved.id);
      setModels(list);
      setStatus(`连接成功，可用模型 ${list.length} 个`);
    } catch (e) {
      setStatus(String(e));
    }
  };
  return (
    <form
      className="ai-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {!value.id && (
        <label>
          常用服务
          <select
            value=""
            onChange={(e) => {
              const p = presets.find((x) => x.name === e.target.value);
              if (p) setValue({ ...value, ...p });
            }}
          >
            <option value="">选择后自动填写地址…</option>
            {presets.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label>
          名称
          <input
            required
            maxLength={60}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          接口类型
          <select
            disabled={magpie}
            value={value.api}
            onChange={(e) =>
              setValue({ ...value, api: e.target.value as ApiKind })
            }
          >
            <option value="openai">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label className="wide">
          接口地址（含 /v1）
          <input
            required
            disabled={magpie}
            placeholder="https://api.example.com/v1"
            value={value.base_url}
            onChange={(e) => setValue({ ...value, base_url: e.target.value })}
          />
        </label>
        <label className="wide">
          模型
          <input
            required
            list="ai-model-options"
            value={value.model}
            onChange={(e) => setValue({ ...value, model: e.target.value })}
          />
          <datalist id="ai-model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        {!magpie && (
          <label className="wide">
            API key（只存系统钥匙串，不进台账、不同步）
            <input
              type="password"
              autoComplete="off"
              disabled={clearKey}
              placeholder={value.has_key ? "已保存；留空不修改" : "sk-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
        )}
        {!magpie && value.has_key && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(e) => setClearKey(e.target.checked)}
            />
            清除已保存的 key
          </label>
        )}
      </div>
      {status && (
        <p role="status" className="small">
          {status}
        </p>
      )}
      <div className="dialog-foot">
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button type="button" disabled={busy} onClick={() => void save(true)}>
          保存并测试连接
        </button>
        <button className="primary" disabled={busy}>
          保存
        </button>
      </div>
    </form>
  );
}

export default function AiPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [confirmRemove, setConfirmRemove] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    commands.ai_settings().then(setSettings, (e) => setError(String(e)));
  }, []);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const connectMagpie = () =>
    run(async () => {
      const r = await commands.ai_connect_magpie();
      setSettings(r.settings);
      const p = r.settings.providers.find((x) => x.id === r.settings.active);
      setMessage(
        `已接入 Magpie，当前模型 ${p?.model}（可在编辑中从 ${r.models.length} 个模型里换）。没有修改 Magpie 的任何配置。`,
      );
    });
  const save = (p: Provider, key: string | null) =>
    run(async () => {
      const next = await commands.ai_save_provider(p, key);
      setSettings(next);
      const saved =
        next.providers.find((x) => x.id === p.id) ??
        next.providers.find(
          (x) =>
            x.name === p.name.trim() &&
            x.base_url.startsWith(p.base_url.trim().replace(/\/$/, "")),
        ) ??
        null;
      setMessage("已保存");
      return saved;
    });
  const providers = settings?.providers ?? [];
  return (
    <section className="panel settings-card wide ai-panel">
      <span className="section-icon">
        <Bot />
      </span>
      <h2>AI 助手</h2>
      <p>
        用 AI
        把粘贴的文字或截图整理成资产草稿，你确认后才会登记。会发送你提供的材料，以及已有资产的
        id、类型和名称；不发送其他字段。API key 只存系统钥匙串。
      </p>
      <div className="head-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void connectMagpie()}
        >
          <Zap size={16} /> 一键接入 Magpie
        </button>
        <button disabled={busy} onClick={() => setEditing(blank())}>
          添加其他服务
        </button>
      </div>
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {editing && (
        <ProviderForm
          key={editing.id || "new"}
          initial={editing}
          busy={busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      <RecordList
        listKey="ai.providers"
        label="AI 服务"
        items={providers}
        search={(p) => `${p.name} ${p.model} ${p.base_url}`}
        sortFields={[
          { key: "name", label: "名称", value: (p) => p.name },
          { key: "model", label: "模型", value: (p) => p.model },
        ]}
        dimensions={[
          { key: "api", label: "接口类型", value: (p) => apiNames[p.api] },
        ]}
        empty="还没有接入 AI 服务。本机运行 Magpie 时可一键接入。"
      >
        {(page) =>
          page.map((p) => (
            <div className="ai-provider-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                {settings?.active === p.id && (
                  <span className="badge active">
                    <Check size={11} /> 当前使用
                  </span>
                )}
                <small>
                  {apiNames[p.api]} · {p.model}
                  {p.has_key && (
                    <>
                      {" "}
                      · <KeyRound size={11} /> 已存钥匙串
                    </>
                  )}
                </small>
                <code>{p.base_url}</code>
              </div>
              <div className="ai-provider-actions">
                {settings?.active !== p.id && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setSettings(await commands.ai_set_active(p.id)),
                      )
                    }
                  >
                    设为当前
                  </button>
                )}
                <button disabled={busy} onClick={() => setEditing(p)}>
                  编辑
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (confirmRemove !== p.id) return setConfirmRemove(p.id);
                    setConfirmRemove("");
                    void run(async () =>
                      setSettings(await commands.ai_remove_provider(p.id)),
                    );
                  }}
                >
                  {confirmRemove === p.id ? "确认删除" : "删除"}
                </button>
              </div>
            </div>
          ))
        }
      </RecordList>
    </section>
  );
}
