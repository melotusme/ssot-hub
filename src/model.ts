export type Kind =
  | "device"
  | "environment"
  | "software"
  | "config"
  | "account"
  | "phone"
  | "esim"
  | "subscription"
  | "person"
  | "storage"
  | "domain"
  | "server"
  | "agent"
  | "course"
  | "assignment"
  | "resource"
  | "copy"
  | "network"
  | "connection";
export interface Asset {
  id: string;
  kind: Kind;
  name: string;
  status: "active" | "retired";
  fields: Record<string, string>;
}
export interface Link {
  id: string;
  from: string;
  to: string;
  relation: string;
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
  required?: boolean;
  placeholder?: string;
}
export interface KindDef {
  kind: Kind;
  name: string;
  fields: Field[];
}
/** Schema served by the desktop backend (`schema` command); the only definition of kinds and fields. */
export interface Schema {
  kinds: KindDef[];
  verification: [string, string][];
}
// Live bindings: filled once by installSchema() before the UI renders.
export let kinds: Kind[] = [];
export let names = {} as Record<Kind, string>;
export let fields = {} as Record<Kind, Field[]>;
export let verificationNames: Record<string, string> = {};
export function installSchema(schema: Schema) {
  kinds = schema.kinds.map((k) => k.kind);
  names = Object.fromEntries(
    schema.kinds.map((k) => [k.kind, k.name]),
  ) as Record<Kind, string>;
  fields = Object.fromEntries(
    schema.kinds.map((k) => [k.kind, k.fields]),
  ) as Record<Kind, Field[]>;
  verificationNames = Object.fromEntries(schema.verification);
}
export const matchesRef = (kind: Kind, ref: Field["ref"]) =>
  !!ref?.includes(kind);
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function currentAssignments(s: Snapshot, id: string, date = today()) {
  return s.assets.filter(
    (a) =>
      a.kind === "assignment" &&
      a.status === "active" &&
      a.fields.asset_id === id &&
      a.fields.starts_on <= date &&
      (!a.fields.ends_on || a.fields.ends_on > date),
  );
}
export function usageLabel(a: Asset, s: Snapshot) {
  return (
    currentAssignments(s, a.id)
      .map(
        (r) =>
          `${s.assets.find((p) => p.id === r.fields.person_id)?.name || "未知成员"} · ${fields.assignment.find((f) => f.key === "usage_role")?.options?.find((o) => o[0] === r.fields.usage_role)?.[1] || ""}`,
      )
      .join("、") || "未分配"
  );
}
export const empty: Snapshot = {
  version: 3,
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
    if (l.from === asset.id)
      out.push({ id: l.to, label: l.relation, linkId: l.id });
    else if (l.to === asset.id)
      out.push({ id: l.from, label: l.relation, linkId: l.id });
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
  return {
    ...empty,
    assets: [d, e, a, c, sub, sw],
    links: [
      { id: uid(), from: a.id, to: d.id, relation: "登录于" },
      {
        id: uid(),
        from: c.id,
        to: e.id,
        relation: "使用路径：~/.config/editor",
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
