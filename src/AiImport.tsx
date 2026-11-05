import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, LoaderCircle, Sparkles, X, Zap } from "lucide-react";
import { chooseImages, commands } from "./api";
import { RecordList } from "./components/RecordList";
import { AssetEditor } from "./components/AssetEditor";
import { blockedBy, canApply, planToChanges, type Changes } from "./ai-plan";
import {
  kinds,
  missingRequired,
  names,
  type AiPlan,
  type Asset,
  type Kind,
  type PlanItem,
  type Snapshot,
} from "./model";
import type { AiSettings_Serialize as AiSettings } from "./bindings";

const MAX_IMAGES = 4;
const opNames: Record<PlanItem["op"], string> = {
  create: "新建",
  update: "修改",
  relate: "使用 / 关联",
  retire: "退役",
};

/** Screenshots pasted from the clipboard become data URLs sent with the request. */
export async function pastedImages(e: ClipboardEvent): Promise<string[]> {
  const files = Array.from(e.clipboardData?.items ?? [])
    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
  return Promise.all(
    files.map(
      (f) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(Error("无法读取粘贴的图片"));
          r.readAsDataURL(f);
        }),
    ),
  );
}

interface AiImportProps {
  snapshot: Snapshot;
  busy: boolean;
  error: string;
  apply: (changes: Changes) => void;
  openSettings: () => void;
  /** Prefilled from the overview's quick input; runs right away when given. */
  initialText?: string;
  initialPasted?: string[];
}

export default function AiImport({
  snapshot,
  busy,
  error,
  apply,
  openSettings,
  initialText = "",
  initialPasted = [],
}: AiImportProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [text, setText] = useState(initialText);
  const [images, setImages] = useState<string[]>([]);
  const [pasted, setPasted] = useState<string[]>(initialPasted);
  const [hint, setHint] = useState<Kind | "">("");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PlanItem | null>(null);
  const [working, setWorking] = useState(false);
  const [localError, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    commands.ai_settings().then(setSettings, (e) => setError(String(e)));
  }, []);
  const active = settings?.providers.find((p) => p.id === settings.active);
  const items = plan?.items ?? [];
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
  const run = (material = text) =>
    attempt(async () => {
      const r = await commands.ai_extract(
        material,
        images,
        pasted,
        hint || null,
      );
      setPlan(r);
      setSelected(new Set(r.items.filter((i) => i.ready).map((i) => i.key)));
    });
  useEffect(() => {
    // Material handed over from the overview runs once the service is known.
    if (
      active &&
      !started.current &&
      (initialText.trim() || initialPasted.length)
    ) {
      started.current = true;
      void run();
    }
  }, [active]);
  const answer = (question: string, option: string) => {
    const next = `${text.trim()}\n补充：${question} ${option}`;
    setText(next);
    void run(next);
  };
  const toggle = (key: string, on: boolean) =>
    setSelected((old) => {
      const next = new Set(old);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const saveEdit = (a: Asset) => {
    if (!editing) return;
    const gaps = missingRequired(a);
    setPlan(
      (p) =>
        p && {
          ...p,
          items: p.items.map((i) =>
            i.key === editing.key
              ? {
                  ...i,
                  asset: a,
                  title: `${opNames[i.op]}${names[a.kind]}「${a.name}」`,
                  ready: gaps.length === 0,
                  warnings: gaps.length ? [`缺少必填：${gaps.join("、")}`] : [],
                }
              : i,
          ),
        },
    );
    if (!gaps.length) toggle(editing.key, true);
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
  const changes = planToChanges(items, selected);
  const count =
    changes.create.length + changes.update.length + changes.link.length;
  const imageCount = images.length + pasted.length;
  return (
    <>
      <p className="muted">
        说一句或贴截图：新买的东西、续费变化、谁在用什么、什么不用了都可以。AI
        只提出操作，你勾选确认后一次写入。将发送给
        {active ? ` ${active.name}（${active.model}）` : " AI 服务"}
        ：你的材料，以及已有资产的名称、核心字段和使用人。不要粘贴密码或验证码。
      </p>
      <label>
        材料
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={async (e) => {
            const got = await pastedImages(e);
            if (got.length)
              setPasted((old) =>
                [...old, ...got].slice(0, MAX_IMAGES - images.length),
              );
          }}
          placeholder="例如：MacBook-A 以后给孩子用，我换 M4 了；iCloud 涨到每月 25 元。截图可以直接粘贴进来。"
        />
      </label>
      <div className="ai-inputs">
        <button
          type="button"
          disabled={working || imageCount >= MAX_IMAGES}
          onClick={() =>
            void attempt(async () => {
              const picked = await chooseImages();
              setImages((old) =>
                [...new Set([...old, ...picked])].slice(
                  0,
                  MAX_IMAGES - pasted.length,
                ),
              );
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
      {imageCount > 0 && (
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
          {pasted.map((d, i) => (
            <li key={d.slice(-32)}>
              <img src={d} alt={`粘贴的截图 ${i + 1}`} />
              <button
                type="button"
                className="icon-button"
                aria-label={`移除粘贴的截图 ${i + 1}`}
                onClick={() => setPasted(pasted.filter((x) => x !== d))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="primary"
        disabled={working || busy || (!text.trim() && !imageCount)}
        onClick={() => void run()}
      >
        {working ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {working ? "AI 正在整理…" : plan ? "重新整理" : "交给 AI 整理"}
      </button>
      {plan?.notes.map((n) => (
        <p className="small" key={n}>
          {n}
        </p>
      ))}
      {plan?.questions.map((q) => (
        <div className="ai-question" key={q.text}>
          <strong>{q.text}</strong>
          <div>
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={working}
                onClick={() => answer(q.text, o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ))}
      {items.length > 0 && (
        <RecordList
          listKey="ai.plan"
          label="AI 建议的操作"
          items={items}
          search={(i) => `${i.title} ${i.details.join(" ")}`}
          sortFields={[
            { key: "order", label: "建议顺序", value: (i) => items.indexOf(i) },
            { key: "title", label: "名称", value: (i) => i.title },
          ]}
          dimensions={[
            { key: "op", label: "操作", value: (i) => opNames[i.op] },
            {
              key: "ready",
              label: "状态",
              value: (i) => (i.ready ? "可应用" : "需补充"),
            },
          ]}
        >
          {(page) =>
            page.map((i) => {
              const blockers = blockedBy(i, selected, items);
              const ok = canApply(i, selected, items);
              return (
                <div className={`ai-draft-row op-${i.op}`} key={i.key}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!ok}
                      checked={ok && selected.has(i.key)}
                      onChange={(e) => toggle(i.key, e.target.checked)}
                    />
                    <span className="badge neutral">{opNames[i.op]}</span>
                    <strong>{i.title}</strong>
                  </label>
                  {i.details.map((d) => (
                    <small key={d}>{d}</small>
                  ))}
                  {i.warnings.map((w) => (
                    <small className="warning-text" key={w}>
                      {w}
                    </small>
                  ))}
                  {blockers.map((b) => (
                    <small className="warning-text" key={b.key}>
                      需要先勾选：{b.title}
                    </small>
                  ))}
                  {i.asset && i.op !== "retire" && (
                    <button type="button" onClick={() => setEditing(i)}>
                      编辑
                    </button>
                  )}
                </div>
              );
            })
          }
        </RecordList>
      )}
      {(localError || error) && (
        <p role="alert" className="form-error">
          {localError || error}
        </p>
      )}
      {items.length > 0 && (
        <div className="dialog-foot">
          <span>
            将应用{" "}
            {
              items.filter(
                (i) => selected.has(i.key) && canApply(i, selected, items),
              ).length
            }{" "}
            / {items.length} 项（跨分页保留）
          </span>
          <button
            className="primary"
            disabled={busy || !count}
            onClick={() => apply(changes)}
          >
            确认并写入
          </button>
        </div>
      )}
      {editing?.asset && (
        <AssetEditor
          asset={editing.asset}
          assets={[
            ...snapshot.assets.filter((a) => a.id !== editing.asset!.id),
            ...items
              .filter(
                (i) => i.op === "create" && i.asset && i.key !== editing.key,
              )
              .map((i) => i.asset!),
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
