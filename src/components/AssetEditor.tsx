import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck, X } from "lucide-react";
import {
  defaultsFor,
  empty,
  fields,
  isVisible,
  matchesRef,
  names,
  type Asset,
  type Field,
} from "../model";

export function ModalFrame({
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
interface FieldInputProps {
  field: Field;
  values: Record<string, string>;
  assets: Asset[];
  /** The record being edited; it cannot reference itself. */
  self: string;
  change: (key: string, v: string) => void;
}
/** One schema field rendered as the matching control. */
export function FieldInput({
  field: f,
  values,
  assets,
  self,
  change,
}: FieldInputProps) {
  const current = values[f.key] || "";
  return (
    <label className={f.type === "textarea" ? "wide" : ""}>
      {f.label}
      {f.ref ? (
        <select
          required={f.required}
          value={current}
          onChange={(e) => change(f.key, e.target.value)}
        >
          <option value="">请选择（可选项可留空）</option>
          {assets
            .filter((a) => matchesRef(a.kind, f.ref) && a.id !== self)
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
          value={current}
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
          value={current}
          onChange={(e) => change(f.key, e.target.value)}
        />
      ) : (
        <input
          required={f.required}
          type={f.type || "text"}
          placeholder={f.placeholder}
          value={current}
          onChange={(e) => change(f.key, e.target.value)}
        />
      )}
    </label>
  );
}

export function AssetEditor({
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
  const visible = fields[asset.kind].filter(
    (f) => f.tier !== "system" && isVisible(f, value),
  );
  const shown = {
    core: visible.filter((f) => f.tier === "core"),
    more: visible.filter((f) => f.tier === "more"),
  };
  // Open "更多信息" only when it holds something beyond the prefilled defaults.
  const defaults = defaultsFor(asset.kind, { ...empty, assets });
  const moreHasValues =
    value.status === "retired" ||
    shown.more.some(
      (f) => !!asset.fields[f.key] && asset.fields[f.key] !== defaults[f.key],
    );
  const inputProps = { values: value.fields, assets, self: asset.id, change };
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
              maxLength={500}
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
              placeholder="给这项资产一个易于识别的名字"
            />
          </label>
          {shown.core.map((f) => (
            <FieldInput key={f.key} field={f} {...inputProps} />
          ))}
        </div>
        <details className="more-fields" open={moreHasValues}>
          <summary>更多信息（{shown.more.length + 1} 项，可不填）</summary>
          <div className="form-grid">
            {shown.more.map((f) => (
              <FieldInput key={f.key} field={f} {...inputProps} />
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
          </div>
        </details>
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
