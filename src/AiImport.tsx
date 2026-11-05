import { useEffect, useState } from "react";
import { ImagePlus, LoaderCircle, Sparkles, X, Zap } from "lucide-react";
import { chooseImages, commands } from "./api";
import { RecordList } from "./components/RecordList";
import { AssetEditor } from "./components/AssetEditor";
import {
  fields,
  kinds,
  missingRequired,
  names,
  type AiDraft,
  type Asset,
  type Kind,
  type Snapshot,
} from "./model";
import type { AiSettings_Serialize as AiSettings } from "./bindings";

interface AiImportProps {
  snapshot: Snapshot;
  busy: boolean;
  error: string;
  apply: (assets: Asset[]) => void;
  openSettings: () => void;
}

const SHOWN_FIELDS = 4;

/** A short "label: value" summary; references show the target's name. */
function summary(a: Asset, lookup: Map<string, Asset>): string {
  return fields[a.kind]
    .filter(
      (f) => a.fields[f.key] && !["verification", "evidence"].includes(f.key),
    )
    .slice(0, SHOWN_FIELDS)
    .map((f) => {
      const v = a.fields[f.key];
      const shown = f.ref
        ? lookup.get(v)?.name || v
        : f.options?.find(([k]) => k === v)?.[1] || v;
      return `${f.label.replace(/ \*$/, "")}：${shown}`;
    })
    .join(" · ");
}

/** Drop references to drafts that are not being registered, so the batch stays valid. */
export function detachUnselected(chosen: Asset[], all: AiDraft[]): Asset[] {
  const dropped = new Set(
    all.map((d) => d.asset.id).filter((id) => !chosen.some((a) => a.id === id)),
  );
  return chosen.map((a) => ({
    ...a,
    fields: Object.fromEntries(
      Object.entries(a.fields).filter(([, v]) => !dropped.has(v)),
    ),
  }));
}

export default function AiImport({
  snapshot,
  busy,
  error,
  apply,
  openSettings,
}: AiImportProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [hint, setHint] = useState<Kind | "">("");
  const [drafts, setDrafts] = useState<AiDraft[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Asset | null>(null);
  const [working, setWorking] = useState(false);
  const [localError, setError] = useState("");
  useEffect(() => {
    commands.ai_settings().then(setSettings, (e) => setError(String(e)));
  }, []);
  const active = settings?.providers.find((p) => p.id === settings.active);
  const lookup = new Map(
    [...snapshot.assets, ...drafts.map((d) => d.asset)].map((a) => [a.id, a]),
  );
  const attempt = async (fn: () => Promise<void>) => {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const extract = () =>
    attempt(async () => {
      const r = await commands.ai_extract(text, images, hint || null);
      setDrafts(r.drafts);
      setNotes(r.notes);
      setSelected(
        new Set(r.drafts.filter((d) => d.ready).map((d) => d.asset.id)),
      );
    });
  const toggle = (id: string, on: boolean) =>
    setSelected((old) => {
      const next = new Set(old);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const saveEdit = (a: Asset) => {
    const missing = missingRequired(a);
    setDrafts((old) =>
      old.map((d) =>
        d.asset.id === a.id
          ? {
              asset: a,
              ready: missing.length === 0,
              warnings: missing.length
                ? [`缺少必填：${missing.join("、")}`]
                : [],
            }
          : d,
      ),
    );
    if (!missing.length) toggle(a.id, true);
    setEditing(null);
  };
  if (settings && !active)
    return (
      <div className="empty">
        <Sparkles />
        <h3>还没有接入 AI 服务</h3>
        <p className="muted">
          本机运行 Magpie 时可以一键接入，也可以填写其他 OpenAI 兼容或 Anthropic
          接口。
        </p>
        <div className="empty-actions">
          <button
            className="primary"
            disabled={working}
            onClick={() =>
              void attempt(async () =>
                setSettings((await commands.ai_connect_magpie()).settings),
              )
            }
          >
            <Zap size={16} /> 一键接入 Magpie
          </button>
          <button onClick={openSettings}>去设置其他服务</button>
        </div>
        {localError && (
          <p role="alert" className="form-error">
            {localError}
          </p>
        )}
      </div>
    );
  const chosen = drafts.filter((d) => selected.has(d.asset.id) && d.ready);
  return (
    <>
      <p className="muted">
        粘贴订单、账单邮件、设备说明或聊天记录，也可以添加截图。AI
        只生成草稿，勾选确认后才登记。将发送给
        {active ? ` ${active.name}（${active.model}）` : " AI 服务"}
        ：你提供的材料，以及已有资产的 id、类型和名称。不要粘贴密码或验证码。
      </p>
      <label>
        材料
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：11 月 3 日在京东买了 iPad Air 11 寸 256G，给孩子上网课用，序列号 F9X…"
        />
      </label>
      <div className="ai-inputs">
        <button
          type="button"
          disabled={working || images.length >= 4}
          onClick={() =>
            void attempt(async () => {
              const picked = await chooseImages();
              setImages((old) => [...new Set([...old, ...picked])].slice(0, 4));
            })
          }
        >
          <ImagePlus size={16} /> 添加截图（最多 4 张）
        </button>
        <label>
          主要类型（可选）
          <select
            value={hint}
            onChange={(e) => setHint(e.target.value as Kind | "")}
          >
            <option value="">自动判断</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {names[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {images.length > 0 && (
        <ul className="ai-images">
          {images.map((p) => (
            <li key={p}>
              <code>{p.split(/[\\/]/).at(-1)}</code>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除 ${p}`}
                onClick={() => setImages(images.filter((x) => x !== p))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="primary"
        disabled={working || busy || (!text.trim() && !images.length)}
        onClick={() => void extract()}
      >
        {working ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {working ? "AI 正在识别…" : "用 AI 生成草稿"}
      </button>
      {notes.map((n) => (
        <p className="small" key={n}>
          {n}
        </p>
      ))}
      {drafts.length > 0 && (
        <RecordList
          listKey="ai.drafts"
          label="AI 草稿"
          items={drafts}
          search={(d) =>
            `${d.asset.name} ${names[d.asset.kind]} ${summary(d.asset, lookup)}`
          }
          sortFields={[
            { key: "kind", label: "类型", value: (d) => names[d.asset.kind] },
            { key: "name", label: "名称", value: (d) => d.asset.name },
          ]}
          dimensions={[
            { key: "kind", label: "类型", value: (d) => names[d.asset.kind] },
            {
              key: "ready",
              label: "状态",
              value: (d) => (d.ready ? "可登记" : "需补充"),
            },
          ]}
        >
          {(page) =>
            page.map((d) => (
              <div className="ai-draft-row" key={d.asset.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!d.ready}
                    checked={d.ready && selected.has(d.asset.id)}
                    onChange={(e) => toggle(d.asset.id, e.target.checked)}
                  />
                  <span className="badge neutral">{names[d.asset.kind]}</span>
                  <strong>{d.asset.name}</strong>
                </label>
                <small>{summary(d.asset, lookup) || "只有名称"}</small>
                {d.warnings.map((w) => (
                  <small className="warning-text" key={w}>
                    {w}
                  </small>
                ))}
                <button type="button" onClick={() => setEditing(d.asset)}>
                  编辑
                </button>
              </div>
            ))
          }
        </RecordList>
      )}
      {(localError || error) && (
        <p role="alert" className="form-error">
          {localError || error}
        </p>
      )}
      {drafts.length > 0 && (
        <div className="dialog-foot">
          <span>
            已选 {chosen.length} / {drafts.length} 项（跨分页保留）
          </span>
          <button
            className="primary"
            disabled={busy || !chosen.length}
            onClick={() =>
              apply(
                detachUnselected(
                  chosen.map((d) => d.asset),
                  drafts,
                ),
              )
            }
          >
            登记所选 {chosen.length} 项
          </button>
        </div>
      )}
      {editing && (
        <AssetEditor
          asset={editing}
          assets={[
            ...snapshot.assets,
            ...drafts.map((d) => d.asset).filter((a) => a.id !== editing.id),
          ]}
          save={saveEdit}
          close={() => setEditing(null)}
          busy={false}
          error=""
        />
      )}
    </>
  );
}
