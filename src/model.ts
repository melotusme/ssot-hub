export type Kind =
  | "device"
  | "environment"
  | "software"
  | "account"
  | "subscription"
  | "service"
  | "person"
  | "course"
  | "resource"
  | "config";
export interface Asset {
  id: string;
  kind: Kind;
  name: string;
  status: "active" | "retired";
  fields: Record<string, string>;
}
/** A typed relation; `type` is one of the schema's relations (uses, logged_in, …). */
export interface Link {
  id: string;
  type: string;
  from: string;
  to: string;
  attrs: Record<string, string>;
}
export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}
export interface Snapshot {
  version: number;
  revision: number;
  assets: Asset[];
  links: Link[];
  events: AuditEvent[];
}
export interface DeletePlan {
  revision: number;
  asset: Asset;
  blockers: string[];
}
export interface Field {
  key: string;
  label: string;
  type?: "date" | "textarea";
  options?: [string, string][];
  ref?: Kind[];
  /** core: shown by default; more: under "更多信息"; system: filled by the app. */
  tier: "core" | "more" | "system";
  /** A literal, or $today / $self. */
  default?: string;
  /** Shown only when `key` has a value outside `not_in`. */
  when?: { key: string; not_in: string[] };
  required?: boolean;
  placeholder?: string;
}
export interface KindDef {
  kind: Kind;
  name: string;
  /** Sidebar group. */
  group: string;
  fields: Field[];
}
export interface RelationDef {
  relation: string;
  name: string;
  from: Kind[];
  to: Kind[];
  attrs: Field[];
}
/** Schema served by the desktop backend (`schema` command); the only definition of kinds and fields. */
export interface Schema {
  kinds: KindDef[];
  relations: RelationDef[];
  verification: [string, string][];
}
// Live bindings: filled once by installSchema() before the UI renders.
export let kinds: Kind[] = [];
export let names = {} as Record<Kind, string>;
export let fields = {} as Record<Kind, Field[]>;
export let verificationNames: Record<string, string> = {};
export let relations: RelationDef[] = [];
/** Sidebar groups in schema order, each with its kinds. */
export let groups: { name: string; kinds: Kind[] }[] = [];
export function installSchema(schema: Schema) {
  kinds = schema.kinds.map((k) => k.kind);
  names = Object.fromEntries(
    schema.kinds.map((k) => [k.kind, k.name]),
  ) as Record<Kind, string>;
  fields = Object.fromEntries(
    schema.kinds.map((k) => [k.kind, k.fields]),
  ) as Record<Kind, Field[]>;
  verificationNames = Object.fromEntries(schema.verification);
  relations = schema.relations;
  groups = [];
  for (const k of schema.kinds) {
    const g = groups.find((x) => x.name === k.group);
    if (g) g.kinds.push(k.kind);
    else groups.push({ name: k.group, kinds: [k.kind] });
  }
}
export function relationDef(type: string): RelationDef | undefined {
  return relations.find((r) => r.relation === type);
}
/** The label of an option value, or the value itself. */
export function optionLabel(f: Field | undefined, v: string): string {
  return f?.options?.find(([k]) => k === v)?.[1] || v;
}
export const matchesRef = (kind: Kind, ref: Field["ref"]) =>
  !!ref?.includes(kind);
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** `uses` relations of an asset that are in effect on `date`. */
export function currentUses(s: Snapshot, id: string, date = today()): Link[] {
  return s.links.filter(
    (l) =>
      l.type === "uses" &&
      l.to === id &&
      (l.attrs.starts_on || "") <= date &&
      (!l.attrs.ends_on || l.attrs.ends_on > date),
  );
}
/** Who uses an asset now, e.g. "孩子 · 主力". */
export function usageLabel(a: Asset, s: Snapshot): string {
  const role = relationDef("uses")?.attrs.find((f) => f.key === "usage_role");
  return (
    currentUses(s, a.id)
      .map(
        (l) =>
          `${s.assets.find((p) => p.id === l.from)?.name || "未知成员"} · ${optionLabel(role, l.attrs.usage_role || "")}`,
      )
      .join("、") || "未分配"
  );
}
/** Kinds that can be handed to a member. */
export const usable = (k: Kind) => !!relationDef("uses")?.to.includes(k);
export const empty: Snapshot = {
  version: 4,
  revision: 0,
  assets: [],
  links: [],
  events: [],
};
export function connections(asset: Asset, s: Snapshot) {
  const out: { id: string; label: string; linkId?: string }[] = [];
  for (const a of s.assets)
    for (const field of fields[a.kind])
      if (field.ref && a.fields[field.key]) {
        if (a.id === asset.id)
          out.push({ id: a.fields[field.key], label: field.label });
        else if (a.fields[field.key] === asset.id)
          out.push({ id: a.id, label: `${names[a.kind]} · ${field.label}` });
      }
  for (const l of s.links) {
    const name = relationDef(l.type)?.name || l.type;
    const detail = l.attrs.note || l.attrs.path || "";
    const label = detail ? `${name}：${detail}` : name;
    if (l.from === asset.id) out.push({ id: l.to, label, linkId: l.id });
    else if (l.to === asset.id)
      out.push({ id: l.from, label: `${label}（反向）`, linkId: l.id });
  }
  return out;
}
export function dueDays(date?: string): number | null {
  if (!date) return null;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil(
    (new Date(date + "T00:00:00Z").getTime() - today) / 86400000,
  );
}
export function primary(a: Asset, s: Snapshot): string {
  const x = a.fields;
  const ref =
    x.holder_id ||
    x.node_id ||
    x.environment_id ||
    x.host_id ||
    x.account_id ||
    x.device_id;
  return (
    s.assets.find((t) => t.id === ref)?.name ||
    x.provider ||
    x.authority_ref ||
    x.number ||
    x.platform ||
    x.os ||
    x.carrier ||
    "尚未补充"
  );
}
export function uid() {
  return crypto.randomUUID();
}
export function demo(): Snapshot {
  const d: Asset = {
    id: uid(),
    kind: "device",
    name: "示例 · 工作电脑",
    status: "active",
    fields: {
      platform: "macOS",
      device_kind: "computer",
      notes: "虚构示例，可随时删除",
    },
  };
  const e: Asset = {
    id: uid(),
    kind: "environment",
    name: "示例 · macOS 工作环境",
    status: "active",
    fields: { os: "macOS", device_id: d.id },
  };
  const a: Asset = {
    id: uid(),
    kind: "account",
    name: "示例 · Google 个人",
    status: "active",
    fields: {
      provider: "Google",
      email: "demo@example.invalid",
      secret_ref: "op://Demo/Google/password",
    },
  };
  const c: Asset = {
    id: uid(),
    kind: "config",
    name: "示例 · 编辑器配置",
    status: "active",
    fields: {
      authority: "git",
      authority_ref: "https://example.invalid/config",
      forbidden_sync: "缓存、凭据",
    },
  };
  const sub: Asset = {
    id: uid(),
    kind: "subscription",
    name: "示例 · 云端会员",
    status: "active",
    fields: {
      account_id: a.id,
      price: "9.99",
      currency: "USD",
      billing_period: "month",
      exchange_rate: "7.20",
      base_currency: "CNY",
      rate_date: new Date().toLocaleDateString("en-CA"),
      expires_on: new Date(Date.now() + 14 * 86400000).toLocaleDateString(
        "en-CA",
      ),
      auto_renew: "no",
    },
  };
  const sw: Asset = {
    id: uid(),
    kind: "software",
    name: "示例 · 编辑器",
    status: "active",
    fields: {
      environment_id: e.id,
      source: "app",
      version: "1.0",
      config_id: c.id,
      subscription_id: sub.id,
    },
  };
  const me: Asset = {
    id: uid(),
    kind: "person",
    name: "示例 · 我",
    status: "active",
    fields: { person_kind: "self" },
  };
  d.fields.owner_id = me.id;
  sw.fields.tracked = "yes";
  return {
    ...empty,
    assets: [me, d, e, a, c, sub, sw],
    links: [
      {
        id: uid(),
        type: "uses",
        from: me.id,
        to: d.id,
        attrs: { usage_role: "primary", starts_on: today() },
      },
      { id: uid(), type: "logged_in", from: a.id, to: d.id, attrs: {} },
      {
        id: uid(),
        type: "config_path",
        from: c.id,
        to: e.id,
        attrs: { path: "~/.config/editor" },
      },
    ],
  };
}

/** An AI-proposed asset, already checked against the schema by the backend. */
export interface AiDraft {
  asset: Asset;
  warnings: string[];
  /** Required fields are filled. */
  ready: boolean;
}
export interface AiExtraction {
  drafts: AiDraft[];
  notes: string[];
  model: string;
}
/** Required fields that are still empty. */
export function missingRequired(a: Asset): string[] {
  return fields[a.kind]
    .filter((f) => f.required && !a.fields[f.key])
    .map((f) => f.label.replace(/ \*$/, ""));
}

/** Whether a field applies given the record's other values (e.g. exchange rate only for foreign currency). */
export function isVisible(f: Field, a: Asset): boolean {
  return !f.when || !f.when.not_in.includes(a.fields[f.when.key] || "");
}
/** Prefilled fields for a new record of `kind`: today's date, yourself as owner, CNY… */
export function defaultsFor(kind: Kind, s: Snapshot): Record<string, string> {
  const me = s.assets.find(
    (a) =>
      a.kind === "person" &&
      a.status === "active" &&
      a.fields.person_kind === "self",
  );
  const out: Record<string, string> = {};
  for (const f of fields[kind]) {
    const v =
      f.default === "$today"
        ? today()
        : f.default === "$self"
          ? me?.id
          : f.default;
    if (v) out[f.key] = v;
  }
  return out;
}
