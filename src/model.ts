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
  ref?: Kind | Kind[];
  required?: boolean;
  placeholder?: string;
}
export const kinds: Kind[] = [
  "device",
  "environment",
  "software",
  "config",
  "account",
  "phone",
  "esim",
  "subscription",
  "person",
  "storage",
  "domain",
  "server",
  "agent",
  "course",
  "assignment",
  "resource",
  "copy",
  "network",
  "connection",
];
export const names: Record<Kind, string> = {
  device: "设备",
  environment: "系统环境",
  software: "软件安装",
  config: "配置来源",
  account: "身份账号",
  phone: "手机号码",
  esim: "eSIM 套餐",
  subscription: "订阅与许可",
  person: "家庭成员与组织",
  storage: "硬盘与存储",
  domain: "域名",
  server: "服务器 / VPS",
  agent: "个人 Agent",
  course: "孩子的班课",
  assignment: "使用与交接",
  resource: "资源目录",
  copy: "资源副本与位置",
  network: "网络与穿透",
  connection: "节点接入",
};
const f = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
  key,
  label,
  ...extra,
});
const expires = f("expires_on", "到期日期", { type: "date" });
const secret = f("secret_ref", "保险库引用", {
  placeholder: "op://Personal/条目/字段",
});
export const fields: Record<Kind, Field[]> = {
  device: [
    f("device_kind", "设备类型", {
      options: [
        ["computer", "电脑"],
        ["phone", "手机"],
        ["tablet", "平板"],
        ["laptop", "笔记本电脑"],
        ["mini_pc", "迷你主机"],
        ["esp32", "ESP32 / 开发板"],
        ["projector", "投影设备 / 投影手机"],
        ["router", "路由器 / 网络设备"],
        ["enclosure", "硬盘盒"],
        ["nas", "实体 NAS"],
        ["console", "游戏主机"],
        ["cartridge", "游戏卡 / 米格卡"],
        ["other", "其他"],
      ],
    }),
    f("platform", "平台"),
    f("model", "型号"),
    f("owner_id", "所有者（产权）", { ref: "person" }),
    f("location", "所在地", { placeholder: "公司 / 家里 / 随身" }),
    f("serial", "序列号 / 资产编号"),
    f("mac", "MAC 地址"),
    f("ip", "最近观测 IP"),
    f("observed_at", "网络观测时间"),
    f("evidence", "登记来源"),
    f("purchased_on", "购买日期", { type: "date" }),
  ],
  environment: [
    f("environment_kind", "环境类型", { options: [["physical", "实体机系统"], ["vm", "虚拟机"], ["container", "容器"]] }),
    f("vmid", "虚拟机 / 容器编号"),
    f("runtime_state", "观测运行状态", { options: [["running", "运行中"], ["stopped", "已停止"], ["unknown", "未核实"]] }),
    f("os", "操作系统"),
    f("version", "系统版本"),
    f("device_id", "所在设备", { ref: "device" }),
    f("host_id", "宿主环境（VM / 模拟器）", { ref: "environment" }),
    f("storage_id", "安装硬盘", { ref: "storage" }),
    f("partition", "分区 / 卷 / 启动方式"),
    f("mac", "MAC 地址"),
    f("ip", "最近观测 IP"),
    f("observed_at", "网络观测时间"),
    f("evidence", "登记来源"),
    f("role", "角色 / 用途"),
  ],
  software: [
    f("environment_id", "所属系统环境 *", { ref: "environment" }),
    f("source", "安装来源", {
      options: [
        ["brew", "Homebrew"],
        ["git", "Git 仓库"],
        ["app", "桌面 App"],
        ["other", "其他包管理器"],
      ],
    }),
    f("manager", "管理器"),
    f("package_kind", "包类型"),
    f("version", "版本"),
    f("commit", "Git commit"),
    f("branch", "Git 分支"),
    f("path", "安装路径 / 包标识"),
    f("repository", "仓库地址"),
    f("subscription_id", "订阅 / 许可", { ref: "subscription" }),
    f("config_id", "配置来源", { ref: "config" }),
    f("license_ref", "许可证保险库引用"),
    f("enabled_state", "启用 / 自启配置", { options: [["enabled", "开启"], ["disabled", "关闭"], ["unknown", "未核实"]] }),
    f("runtime_state", "观测运行状态", { options: [["running", "运行中"], ["stopped", "已停止"], ["unknown", "未核实"]] }),
  ],
  config: [
    f("authority", "权威类型", {
      options: [
        ["git", "Git"],
        ["dav", "WebDAV"],
        ["vendor", "厂商云"],
        ["local", "本机"],
      ],
    }),
    f("authority_ref", "权威位置", {
      placeholder: "仓库 / DAV / 厂商位置，不含凭据",
    }),
    f("forbidden_sync", "禁止同步项", { type: "textarea" }),
    secret,
  ],
  account: [
    f("provider", "服务商"),
    f("owner_id", "账号归属成员", { ref: "person" }),
    f("login_hint", "登录标识"),
    f("email", "邮箱"),
    f("tags", "标签"),
    f("purpose", "用途"),
    secret,
  ],
  phone: [
    f("number", "号码", { placeholder: "+86…" }),
    f("carrier", "运营商"),
    f("country", "国家 / 地区"),
    f("owner", "归属"),
    f("purpose", "用途"),
    expires,
  ],
  esim: [
    f("carrier", "供应商"),
    f("channel", "购买渠道"),
    f("plan", "套餐"),
    f("country", "国家 / 地区"),
    expires,
    f("device_id", "安装设备", { ref: "device" }),
    f("account_id", "供应商账号", { ref: "account" }),
    f("phone_id", "关联号码（可空）", { ref: "phone" }),
    secret,
  ],
  subscription: [
    f("category", "订阅类别", {
      options: [
        ["software", "软件"],
        ["ai", "AI / Claude / Grok"],
        ["proxy", "科学上网"],
        ["hosting", "服务器"],
        ["cloud_storage", "网盘 / 云存储"],
        ["other", "其他"],
      ],
    }),
    f("provider", "服务商"),
    f("owner_id", "付费 / 管理成员", { ref: "person" }),
    f("account_id", "权益持有账号", { ref: "account" }),
    f("channel", "购买渠道"),
    f("price", "原币价格", { placeholder: "9.99" }),
    f("currency", "原币币种", { placeholder: "USD" }),
    f("billing_period", "计费周期", {
      options: [
        ["month", "每月"],
        ["year", "每年"],
        ["once", "一次性"],
      ],
    }),
    expires,
    f("auto_renew", "自动续费", {
      options: [
        ["yes", "开启"],
        ["no", "关闭"],
      ],
    }),
    f("exchange_rate", "汇率（1 原币 = 本币）", { placeholder: "7.20" }),
    f("base_currency", "本币币种", { placeholder: "CNY" }),
    f("rate_date", "汇率日期", { type: "date" }),
    secret,
  ],
  person: [
    f("person_kind", "成员类型", {
      options: [
        ["self", "自己"],
        ["family", "家人"],
        ["child", "孩子"],
        ["organization", "公司 / 组织"],
      ],
    }),
    f("relationship", "家庭称谓 / 组织说明"),
  ],
  storage: [
    f("storage_kind", "介质类型", {
      options: [
        ["ssd", "固态硬盘"],
        ["hdd", "机械硬盘"],
        ["usb", "U 盘"],
        ["sd", "存储卡"],
      ],
    }),
    f("model", "型号"),
    f("serial", "序列号"),
    f("capacity", "容量"),
    f("interface", "接口"),
    f("device_id", "安装设备 / 硬盘盒", { ref: "device" }),
    f("owner_id", "所有者（产权）", { ref: "person" }),
    f("location", "所在地"),
    f("health", "健康状况 / 检测日期"),
    f("backup_ref", "备份位置（无凭据）"),
  ],
  domain: [
    f("hostname", "域名", { placeholder: "example.com" }),
    f("registrar", "注册商"),
    f("account_id", "注册账号", { ref: "account" }),
    f("server_id", "指向服务器", { ref: "server" }),
    f("subscription_id", "续费记录", { ref: "subscription" }),
    f("dns_provider", "DNS 托管商"),
    expires,
  ],
  server: [
    f("provider", "服务商"),
    f("region", "地域"),
    f("ip", "IP / 主机名"),
    f("spec", "CPU / 内存 / 存储"),
    f("os", "操作系统"),
    f("account_id", "购买账号", { ref: "account" }),
    f("subscription_id", "续费订阅", { ref: "subscription" }),
    f("owner_id", "所有者", { ref: "person" }),
    expires,
    secret,
  ],
  agent: [
    f("provider", "服务 / 框架"),
    f("environment_id", "部署环境", { ref: "environment" }),
    f("server_id", "部署服务器", { ref: "server" }),
    f("account_id", "运行账号", { ref: "account" }),
    f("subscription_id", "使用订阅", { ref: "subscription" }),
    f("config_id", "配置来源", { ref: "config" }),
    f("endpoint", "访问入口（无密钥）"),
    f("purpose", "用途"),
    secret,
  ],
  course: [
    f("person_id", "上课孩子 *", { ref: "person", required: true }),
    f("institution", "机构"),
    f("subject", "科目 / 班级"),
    f("teacher", "老师"),
    f("schedule", "排课时间"),
    f("location", "上课地点"),
    f("starts_on", "开始日期", { type: "date" }),
    expires,
    f("lessons_total", "购买课时"),
    f("lessons_used", "已用课时"),
    f("price", "报名费用"),
    f("currency", "币种", { placeholder: "CNY" }),
    f("account_id", "报名账号", { ref: "account" }),
  ],
  assignment: [
    f("asset_id", "使用资产 *", {
      ref: ["device", "storage", "server"],
      required: true,
    }),
    f("person_id", "使用成员 *", { ref: "person", required: true }),
    f("usage_role", "使用角色 *", {
      options: [
        ["primary", "主力"],
        ["backup", "备用"],
        ["shared", "共用"],
        ["loan", "借用"],
      ],
      required: true,
    }),
    f("starts_on", "开始日期 *", { type: "date", required: true }),
    f("ends_on", "结束日期（不含当日，空为持续使用）", { type: "date" }),
    f("location", "使用地点"),
  ],
  resource: [
    f("resource_kind", "资源类别", {options:[["game", "游戏 / 游戏集合"], ["media", "影音"], ["archive", "安装包 / 镜像"], ["document", "文档"], ["other", "其他"]]}),
    f("platform", "适用平台"),
    f("distribution", "使用方式 / 格式", {options:[["mig", "米格卡资源"], ["atmosphere", "大气层安装资源"], ["standard", "常规文件"], ["other", "其他"]]}),
    f("version", "版本 / 批次"),
  ],
  copy: [
    f("resource_id", "对应资源 *", {ref:"resource", required:true}),
    f("holder_id", "存放载体 / NAS / 网盘账号 *", {ref:["storage", "device", "account"], required:true}),
    f("path", "目录 / 卷 / 云端位置（不含凭据）"),
    f("copy_role", "副本用途", {options:[["source", "来源文件"], ["backup", "备份副本"], ["installed", "已安装内容"], ["archive", "归档"]]}),
    f("environment_id", "使用 / 安装环境", {ref:"environment"}),
    f("content_state", "内容核实状态", {options:[["present", "已核实存在"], ["missing", "已核实缺失"], ["unknown", "尚未核实"]]}),
    f("checksum", "校验值（可空）"),
  ],
  network: [
    f("technology", "网络技术", {options:[["zerotier", "ZeroTier"], ["tailscale", "Tailscale"], ["frp", "FRP"], ["cloudflare", "Cloudflare Tunnel"], ["lan", "局域网"], ["other", "其他"]]}),
    f("network_code", "网络标识（非密钥）"),
    f("network_range", "网段"),
    f("account_id", "管理账号", {ref:"account"}),
    f("config_id", "配置来源", {ref:"config"}),
    f("subscription_id", "相关订阅", {ref:"subscription"}),
  ],
  connection: [
    f("network_id", "所属网络 *", {ref:"network", required:true}),
    f("node_id", "实际接入节点 *", {ref:["device", "environment"], required:true}),
    f("software_id", "使用的软件安装", {ref:"software"}),
    f("enabled_state", "启用配置", {options:[["enabled", "开启"], ["disabled", "关闭"], ["unknown", "未核实"]]}),
    f("node_address", "节点地址 / 虚拟 IP"),
    f("advertised_routes", "发布路由 / 内网网段"),
    f("endpoint", "访问入口（不含密钥）"),
    f("probe_state", "实际连通性", {options:[["reachable", "已测试可达"], ["unreachable", "已测试不可达"], ["untested", "未测试"]]}),
    f("probe_at", "连通性测试时间（ISO 8601）"),
  ],
};
export const verificationNames: Record<string, string> = {observed:"机器观测", reported:"用户描述", confirmed:"人工确认", unknown:"待核对"};
for (const kind of kinds) {
  for (const item of [
    f("verification", "资料依据", {options:Object.entries(verificationNames)}),
    f("evidence", "证据 / 登记来源"),
    f("observed_at", "资料观测时间（ISO 8601）"),
    f("review_note", "待确认 / 盘点缺口", {type:"textarea"}),
  ]) if (!fields[kind].some(existing=>existing.key===item.key)) fields[kind].push(item);
}
export const matchesRef = (kind: Kind, ref: Field["ref"]) =>
  Array.isArray(ref) ? ref.includes(kind) : ref === kind;
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
  const ref = x.holder_id || x.node_id || x.environment_id || x.host_id || x.account_id || x.device_id;
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
