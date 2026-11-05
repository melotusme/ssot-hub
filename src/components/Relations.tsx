import { useState } from "react";
import { ArrowRightLeft, UserPlus } from "lucide-react";
import { FieldInput } from "./AssetEditor";
import { RecordList } from "./RecordList";
import {
  currentUses,
  isVisible,
  names,
  optionLabel,
  relationDef,
  relations,
  today,
  uid,
  type Asset,
  type Link,
  type RelationDef,
  type Snapshot,
} from "../model";

/** Relation types this asset can take part in, and on which side. */
interface Choice {
  def: RelationDef;
  anchorIsFrom: boolean;
}
function choicesFor(anchor: Asset): Choice[] {
  return relations.flatMap((def): Choice[] => {
    if (def.from.includes(anchor.kind)) return [{ def, anchorIsFrom: true }];
    if (def.to.includes(anchor.kind)) return [{ def, anchorIsFrom: false }];
    return [];
  });
}

function prefill(def: RelationDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of def.attrs) {
    const v =
      f.default === "$today"
        ? today()
        : f.default?.startsWith("$")
          ? ""
          : f.default;
    if (v) out[f.key] = v;
  }
  return out;
}

interface RelationFormProps {
  anchor: Asset;
  assets: Asset[];
  /** Preselect a relation type, e.g. "uses" for "给谁用". */
  initialType?: string;
  submit: (link: Link) => void;
  busy: boolean;
  error: string;
}

/** Create a typed relation from or to `anchor`; attributes follow the schema. */
export function RelationForm({
  anchor,
  assets,
  initialType,
  submit,
  busy,
  error,
}: RelationFormProps) {
  const choices = choicesFor(anchor);
  const [type, setType] = useState(
    choices.find((c) => c.def.relation === initialType)?.def.relation ||
      choices[0]?.def.relation ||
      "",
  );
  const choice = choices.find((c) => c.def.relation === type);
  const [target, setTarget] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>(() =>
    choice ? prefill(choice.def) : {},
  );
  if (!choice) return <p className="muted">这类资产暂时没有可建立的关系。</p>;
  const { def, anchorIsFrom } = choice;
  const targetKinds = anchorIsFrom ? def.to : def.from;
  const holder: Asset = { ...anchor, fields: attrs };
  const visible = def.attrs.filter((f) => isVisible(f, holder));
  const core = visible.filter((f) => f.tier === "core");
  const more = visible.filter((f) => f.tier !== "core");
  const change = (key: string, v: string) =>
    setAttrs((a) => ({ ...a, [key]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const kept = Object.fromEntries(
          Object.entries(attrs).filter(([, v]) => v),
        );
        submit({
          id: uid(),
          type,
          from: anchorIsFrom ? anchor.id : target,
          to: anchorIsFrom ? target : anchor.id,
          attrs: kept,
        });
      }}
    >
      <div className="form-grid">
        {!initialType && (
          <label>
            关系
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setTarget("");
                const next = relationDef(e.target.value);
                setAttrs(next ? prefill(next) : {});
              }}
            >
              {choices.map((c) => (
                <option key={c.def.relation} value={c.def.relation}>
                  {c.def.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {anchorIsFrom
            ? `「${anchor.name}」${def.name}`
            : `谁${def.name}「${anchor.name}」`}
          <select
            autoFocus
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">请选择</option>
            {assets
              .filter((a) => a.id !== anchor.id && targetKinds.includes(a.kind))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {names[a.kind]} · {a.name}
                </option>
              ))}
          </select>
        </label>
        {core.map((f) => (
          <FieldInput
            key={f.key}
            field={f}
            values={attrs}
            assets={assets}
            self={anchor.id}
            change={change}
          />
        ))}
      </div>
      {more.length > 0 && (
        <details className="more-fields">
          <summary>更多信息（{more.length} 项，可不填）</summary>
          <div className="form-grid">
            {more.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                values={attrs}
                assets={assets}
                self={anchor.id}
                change={change}
              />
            ))}
          </div>
        </details>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        <button className="primary" disabled={busy}>
          保存
        </button>
      </div>
    </form>
  );
}

interface TransferFormProps {
  link: Link;
  snapshot: Snapshot;
  submit: (personId: string, startsOn: string) => void;
  busy: boolean;
  error: string;
}

/** Hand an asset to another member: the old use ends the day the new one starts. */
export function TransferForm({
  link,
  snapshot,
  submit,
  busy,
  error,
}: TransferFormProps) {
  const [person, setPerson] = useState("");
  const [date, setDate] = useState(today());
  const name = (id: string) =>
    snapshot.assets.find((a) => a.id === id)?.name || "?";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(person, date);
      }}
    >
      <p className="muted">
        「{name(link.to)}」目前由 {name(link.from)}{" "}
        使用。交接后旧记录在交接日结束，历史保留。
      </p>
      <div className="form-grid">
        <label>
          交给谁
          <select
            autoFocus
            required
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">请选择成员</option>
            {snapshot.assets
              .filter(
                (a) =>
                  a.kind === "person" &&
                  a.status === "active" &&
                  a.id !== link.from,
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          从哪天开始
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        <button className="primary" disabled={busy}>
          确认交接
        </button>
      </div>
    </form>
  );
}

interface UsagePanelProps {
  asset: Asset;
  snapshot: Snapshot;
  onAssign: () => void;
  onTransfer: (link: Link) => void;
  onOpen: (id: string) => void;
}

/** Who uses an asset now, with one-click assign and handover, plus the history. */
export function UsagePanel({
  asset,
  snapshot,
  onAssign,
  onTransfer,
  onOpen,
}: UsagePanelProps) {
  const isPerson = asset.kind === "person";
  const role = relationDef("uses")?.attrs.find((f) => f.key === "usage_role");
  const name = (id: string) =>
    snapshot.assets.find((a) => a.id === id)?.name || "?";
  const history = snapshot.links.filter(
    (l) =>
      l.type === "uses" && (isPerson ? l.from === asset.id : l.to === asset.id),
  );
  const now = isPerson ? [] : currentUses(snapshot, asset.id);
  return (
    <div className="usage-panel">
      {!isPerson && (
        <div className="usage-summary">
          <h3>现在谁在用</h3>
          {now.length === 0 && <p>还没有分配</p>}
          {now.map((l) => (
            <p key={l.id}>
              {name(l.from)} · {optionLabel(role, l.attrs.usage_role || "")}
              {!l.attrs.ends_on && (
                <button className="text-button" onClick={() => onTransfer(l)}>
                  <ArrowRightLeft size={12} /> 换人
                </button>
              )}
            </p>
          ))}
          <button onClick={onAssign}>
            <UserPlus size={14} /> 给谁用
          </button>
        </div>
      )}
      {history.length > 0 && (
        <RecordList
          listKey={`usage-history.${isPerson ? "person" : "asset"}`}
          label="使用历史"
          items={history}
          search={(l) => `${name(l.from)} ${name(l.to)}`}
          sortFields={[
            {
              key: "starts_on",
              label: "开始日期",
              value: (l) => l.attrs.starts_on || "",
            },
            {
              key: "who",
              label: "名称",
              value: (l) => name(isPerson ? l.to : l.from),
            },
          ]}
          empty="尚无使用记录"
        >
          {(rows) =>
            rows.map((l) => (
              <div className="usage-summary" key={l.id}>
                <button
                  className="text-button"
                  onClick={() => onOpen(isPerson ? l.to : l.from)}
                >
                  {name(l.from)} · {name(l.to)}
                </button>
                <p>
                  {l.attrs.starts_on} → {l.attrs.ends_on || "持续使用"}
                </p>
                <small>{optionLabel(role, l.attrs.usage_role || "")}</small>
              </div>
            ))
          }
        </RecordList>
      )}
    </div>
  );
}
