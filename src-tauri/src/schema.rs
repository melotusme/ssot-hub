//! The single source of the asset schema: kinds, fields, references and options.
//! The UI receives it through the `schema` command; validation in `store.rs` derives from it.
use serde::Serialize;
use std::sync::OnceLock;

type Options = Vec<(&'static str, &'static str)>;

#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct Field {
    pub key: &'static str,
    pub label: &'static str,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub ty: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Options>,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub refs: Option<Vec<&'static str>>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<&'static str>,
    /// `core` shows in forms by default, `more` sits under "更多信息", `system` is filled by the app.
    pub tier: Tier,
    /// Prefill for a new record: a literal, or `$today` / `$self` (the member marked as yourself).
    #[serde(rename = "default", skip_serializing_if = "Option::is_none")]
    pub default_value: Option<&'static str>,
    /// Show only when another field has a value outside `not_in` (e.g. exchange rate for non-CNY).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<When>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Core,
    More,
    System,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct When {
    pub key: &'static str,
    pub not_in: Vec<&'static str>,
}

impl Field {
    fn date(mut self) -> Self {
        self.ty = Some("date");
        self
    }
    fn textarea(mut self) -> Self {
        self.ty = Some("textarea");
        self
    }
    fn options(mut self, options: &[(&'static str, &'static str)]) -> Self {
        self.options = Some(options.to_vec());
        self
    }
    fn refs(mut self, kinds: &[&'static str]) -> Self {
        self.refs = Some(kinds.to_vec());
        self
    }
    fn required(mut self) -> Self {
        self.required = true;
        self
    }
    fn placeholder(mut self, text: &'static str) -> Self {
        self.placeholder = Some(text);
        self
    }
    pub fn is_date(&self) -> bool {
        self.ty == Some("date")
    }
}

fn f(key: &'static str, label: &'static str) -> Field {
    Field {
        key,
        label,
        ty: None,
        options: None,
        refs: None,
        required: false,
        placeholder: None,
        tier: Tier::More,
        default_value: None,
        when: None,
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct KindDef {
    pub kind: &'static str,
    pub name: &'static str,
    /// Sidebar group.
    pub group: &'static str,
    pub fields: Vec<Field>,
}

/// A typed relation between two assets, optionally with attributes and a time span.
#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct RelationDef {
    pub relation: &'static str,
    pub name: &'static str,
    pub from: Vec<&'static str>,
    pub to: Vec<&'static str>,
    pub attrs: Vec<Field>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
pub struct Schema {
    pub kinds: Vec<KindDef>,
    pub relations: Vec<RelationDef>,
    pub verification: Options,
}

/// Keys accepted on every kind for compatibility with earlier snapshots, but not shown in forms.
pub const LEGACY_KEYS: &[&str] = &["purpose", "secret_ref", "expires_on"];

const RUN_STATE: &[(&str, &str)] = &[
    ("running", "运行中"),
    ("stopped", "已停止"),
    ("unknown", "未核实"),
];
const ENABLED_STATE: &[(&str, &str)] = &[
    ("enabled", "开启"),
    ("disabled", "关闭"),
    ("unknown", "未核实"),
];
const VERIFICATION: &[(&str, &str)] = &[
    ("observed", "机器观测"),
    ("reported", "用户描述"),
    ("confirmed", "人工确认"),
    ("unknown", "待核对"),
];

fn expires() -> Field {
    f("expires_on", "到期日期").date()
}
fn secret() -> Field {
    f("secret_ref", "保险库引用").placeholder("op://Personal/条目/字段")
}
fn observed() -> [Field; 3] {
    [
        f("mac", "MAC 地址"),
        f("ip", "最近观测 IP"),
        f("observed_at", "网络观测时间"),
    ]
}

fn kind(kind: &'static str, name: &'static str, group: &'static str, fields: Vec<Field>) -> KindDef {
    KindDef {
        kind,
        name,
        group,
        fields,
    }
}

const TECHNOLOGY: &[(&str, &str)] = &[
    ("zerotier", "ZeroTier"),
    ("tailscale", "Tailscale"),
    ("frp", "FRP"),
    ("cloudflare", "Cloudflare Tunnel"),
    ("lan", "局域网"),
    ("other", "其他"),
];

fn build() -> Schema {
    let mut kinds = vec![
        kind("device", "设备", "设备", {
            let mut v = vec![
                f("device_kind", "种类").options(&[
                    ("computer", "电脑"),
                    ("laptop", "笔记本电脑"),
                    ("phone", "手机"),
                    ("tablet", "平板"),
                    ("mini_pc", "迷你主机"),
                    ("nas", "实体 NAS"),
                    ("router", "路由器 / 网络设备"),
                    ("esp32", "ESP32 / 开发板"),
                    ("projector", "投影设备 / 投影手机"),
                    ("console", "游戏主机"),
                    ("cartridge", "游戏卡 / 米格卡"),
                    ("ssd", "固态硬盘"),
                    ("hdd", "机械硬盘"),
                    ("usb", "U 盘"),
                    ("sd", "存储卡"),
                    ("enclosure", "硬盘盒"),
                    ("other", "其他"),
                ]),
                f("model", "型号"),
                f("owner_id", "所有者（产权）").refs(&["person"]),
                f("location", "所在地").placeholder("公司 / 家里 / 随身"),
                f("platform", "平台"),
                f("parent_id", "装在哪台设备 / 硬盘盒").refs(&["device"]),
                f("capacity", "容量"),
                f("interface", "接口"),
                f("serial", "序列号 / 资产编号"),
                f("health", "健康状况 / 检测日期"),
                f("backup_ref", "备份位置（无凭据）"),
            ];
            v.extend(observed());
            v.push(f("purchased_on", "购买日期").date());
            v.push(f("price", "购买价格").placeholder("2999"));
            v.push(f("currency", "币种").placeholder("CNY"));
            v
        }),
        kind("environment", "系统", "系统与软件", {
            let mut v = vec![
                f("device_id", "所在设备").refs(&["device"]),
                f("os", "操作系统"),
                f("environment_kind", "类型").options(&[
                    ("physical", "实体机系统"),
                    ("vm", "虚拟机"),
                    ("container", "容器"),
                ]),
                f("version", "系统版本"),
                f("host_id", "宿主系统（VM / 模拟器）").refs(&["environment"]),
                f("storage_id", "安装在哪块硬盘").refs(&["device"]),
                f("partition", "分区 / 卷 / 启动方式"),
                f("vmid", "虚拟机 / 容器编号"),
                f("runtime_state", "观测运行状态").options(RUN_STATE),
            ];
            v.extend(observed());
            v.push(f("role", "角色 / 用途"));
            v
        }),
        kind(
            "software",
            "软件",
            "系统与软件",
            vec![
                f("environment_id", "所在系统 *").refs(&["environment"]).required(),
                f("source", "安装来源").options(&[
                    ("brew", "Homebrew"),
                    ("git", "Git 仓库"),
                    ("app", "桌面 App"),
                    ("other", "其他包管理器"),
                ]),
                f("config_id", "配置来源").refs(&["config"]),
                f("subscription_id", "订阅 / 许可").refs(&["subscription"]),
                f("manager", "管理器"),
                f("package_kind", "包类型"),
                f("version", "版本"),
                f("commit", "Git commit"),
                f("branch", "Git 分支"),
                f("path", "安装路径 / 包标识"),
                f("repository", "仓库地址"),
                f("license_ref", "许可证保险库引用"),
                f("enabled_state", "启用 / 自启配置").options(ENABLED_STATE),
                f("runtime_state", "观测运行状态").options(RUN_STATE),
                // Scans list everything installed; only software you mark as followed shows in the main list.
                f("tracked", "关注").options(&[("yes", "关注")]),
            ],
        ),
        kind(
            "account",
            "账号",
            "账号",
            vec![
                f("account_kind", "种类").options(&[("identity", "身份账号"), ("phone", "手机号码")]),
                f("provider", "服务商 / 运营商"),
                f("login_hint", "登录标识"),
                f("owner_id", "归属成员").refs(&["person"]),
                f("email", "邮箱"),
                f("number", "号码").placeholder("+86…"),
                f("carrier", "运营商"),
                f("country", "国家 / 地区"),
                f("tags", "标签"),
                f("purpose", "用途"),
                expires(),
                secret(),
            ],
        ),
        kind(
            "subscription",
            "订阅",
            "订阅与服务",
            vec![
                f("price", "价格").placeholder("9.99"),
                f("currency", "币种").placeholder("CNY"),
                f("billing_period", "计费周期").options(&[
                    ("month", "每月"),
                    ("year", "每年"),
                    ("once", "一次性"),
                ]),
                expires(),
                f("account_id", "付费账号").refs(&["account"]),
                f("category", "类别").options(&[
                    ("software", "软件"),
                    ("ai", "AI / Claude / Grok"),
                    ("proxy", "科学上网"),
                    ("hosting", "服务器"),
                    ("cloud_storage", "网盘 / 云存储"),
                    ("telecom", "通信套餐 / eSIM"),
                    ("other", "其他"),
                ]),
                f("provider", "服务商"),
                f("owner_id", "付费 / 管理成员").refs(&["person"]),
                f("auto_renew", "自动续费").options(&[("yes", "开启"), ("no", "关闭")]),
                f("channel", "购买渠道"),
                f("exchange_rate", "汇率（1 原币 = 本币）").placeholder("7.20"),
                f("base_currency", "本币币种").placeholder("CNY"),
                f("rate_date", "汇率日期").date(),
                f("plan", "套餐"),
                f("carrier", "通信供应商"),
                f("country", "国家 / 地区"),
                f("device_id", "eSIM 安装设备").refs(&["device"]),
                f("phone_id", "关联号码").refs(&["account"]),
                secret(),
            ],
        ),
        kind(
            "service",
            "在线服务",
            "订阅与服务",
            vec![
                f("service_kind", "种类").options(&[
                    ("domain", "域名"),
                    ("server", "服务器 / VPS"),
                    ("agent", "个人 Agent"),
                    ("network", "网络与穿透"),
                    ("other", "其他"),
                ]),
                f("provider", "服务商 / 注册商"),
                expires(),
                f("subscription_id", "续费订阅").refs(&["subscription"]),
                f("account_id", "管理账号").refs(&["account"]),
                f("owner_id", "所有者").refs(&["person"]),
                f("hostname", "域名").placeholder("example.com"),
                f("registrar", "注册商"),
                f("dns_provider", "DNS 托管商"),
                f("server_id", "部署 / 指向的服务器").refs(&["service"]),
                f("region", "地域"),
                f("ip", "IP / 主机名"),
                f("spec", "CPU / 内存 / 存储"),
                f("os", "操作系统"),
                f("environment_id", "部署在哪个系统").refs(&["environment"]),
                f("config_id", "配置来源").refs(&["config"]),
                f("technology", "网络技术").options(TECHNOLOGY),
                f("network_code", "网络标识（非密钥）"),
                f("network_range", "网段"),
                f("endpoint", "访问入口（无密钥）"),
                f("purpose", "用途"),
                secret(),
            ],
        ),
        kind(
            "person",
            "成员",
            "家人",
            vec![
                f("person_kind", "类型").options(&[
                    ("self", "自己"),
                    ("family", "家人"),
                    ("child", "孩子"),
                    ("organization", "公司 / 组织"),
                ]),
                f("relationship", "称谓 / 说明"),
            ],
        ),
        kind(
            "course",
            "班课",
            "家人",
            vec![
                f("person_id", "上课孩子 *").refs(&["person"]).required(),
                f("institution", "机构"),
                f("lessons_total", "购买课时"),
                f("lessons_used", "已用课时"),
                expires(),
                f("subject", "科目 / 班级"),
                f("teacher", "老师"),
                f("schedule", "排课时间"),
                f("location", "上课地点"),
                f("starts_on", "开始日期").date(),
                f("price", "报名费用"),
                f("currency", "币种").placeholder("CNY"),
                f("account_id", "报名账号").refs(&["account"]),
            ],
        ),
        kind(
            "resource",
            "资源",
            "其他",
            vec![
                f("resource_kind", "类别").options(&[
                    ("game", "游戏 / 游戏集合"),
                    ("media", "影音"),
                    ("archive", "安装包 / 镜像"),
                    ("document", "文档"),
                    ("other", "其他"),
                ]),
                f("platform", "适用平台"),
                f("distribution", "使用方式 / 格式").options(&[
                    ("mig", "米格卡资源"),
                    ("atmosphere", "大气层安装资源"),
                    ("standard", "常规文件"),
                    ("other", "其他"),
                ]),
                f("version", "版本 / 批次"),
            ],
        ),
        kind(
            "config",
            "配置来源",
            "其他",
            vec![
                f("authority", "权威类型").options(&[
                    ("git", "Git"),
                    ("dav", "WebDAV"),
                    ("vendor", "厂商云"),
                    ("local", "本机"),
                ]),
                f("authority_ref", "权威位置").placeholder("仓库 / DAV / 厂商位置，不含凭据"),
                f("forbidden_sync", "禁止同步项").textarea(),
                secret(),
            ],
        ),
    ];
    for k in &mut kinds {
        for common in [
            f("verification", "资料依据").options(VERIFICATION),
            f("evidence", "证据 / 登记来源"),
            f("observed_at", "资料观测时间（ISO 8601）"),
            f("review_note", "待确认 / 盘点缺口").textarea(),
            f("notes", "备注").textarea(),
        ] {
            if !k.fields.iter().any(|x| x.key == common.key) {
                k.fields.push(common);
            }
        }
    }
    apply_tiers(&mut kinds);
    let mut relations = relations();
    for r in &mut relations {
        apply_relation_tiers(r);
    }
    Schema {
        kinds,
        relations,
        verification: VERIFICATION.to_vec(),
    }
}

fn relation(
    relation: &'static str,
    name: &'static str,
    from: &[&'static str],
    to: &[&'static str],
    attrs: Vec<Field>,
) -> RelationDef {
    let mut attrs = attrs;
    attrs.push(f("note", "备注").textarea());
    RelationDef {
        relation,
        name,
        from: from.to_vec(),
        to: to.to_vec(),
        attrs,
    }
}

fn relations() -> Vec<RelationDef> {
    vec![
        relation(
            "uses",
            "使用",
            &["person"],
            &["device", "service"],
            vec![
                f("usage_role", "使用角色 *")
                    .options(&[
                        ("primary", "主力"),
                        ("backup", "备用"),
                        ("shared", "共用"),
                        ("loan", "借用"),
                    ])
                    .required(),
                f("starts_on", "开始日期 *").date().required(),
                f("ends_on", "结束日期（不含当日，空为持续使用）").date(),
                f("location", "使用地点"),
            ],
        ),
        relation("logged_in", "登录于", &["account"], &["device", "environment"], vec![]),
        relation("recovery", "恢复方式", &["account"], &["account"], vec![]),
        relation(
            "config_path",
            "使用路径",
            &["config"],
            &["environment"],
            vec![f("path", "本机路径")],
        ),
        relation(
            "stored_on",
            "存放于",
            &["resource"],
            &["device", "account"],
            vec![
                f("path", "目录 / 卷 / 云端位置（不含凭据）"),
                f("copy_role", "副本用途").options(&[
                    ("source", "来源文件"),
                    ("backup", "备份副本"),
                    ("installed", "已安装内容"),
                    ("archive", "归档"),
                ]),
                f("content_state", "内容核实状态").options(&[
                    ("present", "已核实存在"),
                    ("missing", "已核实缺失"),
                    ("unknown", "尚未核实"),
                ]),
                f("environment_id", "使用 / 安装系统").refs(&["environment"]),
                f("checksum", "校验值"),
            ],
        ),
        relation(
            "joins",
            "接入网络",
            &["device", "environment"],
            &["service"],
            vec![
                f("node_address", "节点地址 / 虚拟 IP"),
                f("enabled_state", "启用配置").options(ENABLED_STATE),
                f("probe_state", "实际连通性").options(&[
                    ("reachable", "已测试可达"),
                    ("unreachable", "已测试不可达"),
                    ("untested", "未测试"),
                ]),
                f("probe_at", "连通性测试时间（ISO 8601）"),
                f("software_id", "使用的软件").refs(&["software"]),
                f("advertised_routes", "发布路由 / 内网网段"),
                f("endpoint", "访问入口（不含密钥）"),
            ],
        ),
        relation("related", "其他关联", ALL_KINDS, ALL_KINDS, vec![]),
    ]
}

pub const ALL_KINDS: &[&str] = &[
    "device",
    "environment",
    "software",
    "account",
    "subscription",
    "service",
    "person",
    "course",
    "resource",
    "config",
];

/// Fields shown by default for each kind; everything else goes under "更多信息".
const CORE: &[(&str, &[&str])] = &[
    ("device", &["device_kind", "model", "owner_id", "location"]),
    ("environment", &["device_id", "os", "environment_kind"]),
    ("software", &["environment_id", "source", "config_id"]),
    ("account", &["account_kind", "provider", "login_hint", "owner_id"]),
    ("subscription", &["price", "currency", "billing_period", "expires_on", "account_id"]),
    ("service", &["service_kind", "provider", "expires_on", "subscription_id"]),
    ("person", &["person_kind", "relationship"]),
    ("course", &["person_id", "institution", "lessons_total", "lessons_used", "expires_on"]),
    ("resource", &["resource_kind", "platform"]),
    ("config", &["authority", "authority_ref"]),
];/// Filled by the app (where the record came from), never asked in forms.
const SYSTEM: &[&str] = &["verification", "evidence", "observed_at", "tracked"];
/// Always shown: free notes.
const ALWAYS: &[&str] = &["notes"];
const DEFAULTS: &[(&str, &str)] = &[
    ("owner_id", "$self"),
    ("starts_on", "$today"),
    ("currency", "CNY"),
    ("base_currency", "CNY"),
    ("usage_role", "primary"),
];
/// Exchange-rate fields only matter when paying in a foreign currency.
const FOREIGN_CURRENCY_ONLY: &[&str] = &["exchange_rate", "base_currency", "rate_date"];

fn apply_tiers(kinds: &mut [KindDef]) {
    for k in kinds {
        let core = CORE.iter().find(|(kind, _)| *kind == k.kind).map_or(&[][..], |(_, c)| *c);
        for field in &mut k.fields {
            field.tier = if SYSTEM.contains(&field.key) {
                Tier::System
            } else if core.contains(&field.key) || ALWAYS.contains(&field.key) || field.required {
                Tier::Core
            } else {
                Tier::More
            };
            field.default_value = DEFAULTS.iter().find(|(key, _)| *key == field.key).map(|(_, v)| *v);
            if FOREIGN_CURRENCY_ONLY.contains(&field.key) {
                field.when = Some(When { key: "currency", not_in: vec!["", "CNY"] });
            }
        }
        // Core fields first, in the order listed in CORE; notes last.
        k.fields.sort_by_key(|field| match field.tier {
            Tier::Core if ALWAYS.contains(&field.key) => (1, usize::MAX),
            Tier::Core => (0, core.iter().position(|c| *c == field.key).unwrap_or(usize::MAX - 1)),
            Tier::More => (2, 0),
            Tier::System => (3, 0),
        });
    }
}

/// Relation attributes: required ones are core, the rest more; notes always shown.
fn apply_relation_tiers(r: &mut RelationDef) {
    for field in &mut r.attrs {
        field.tier = if field.required || ALWAYS.contains(&field.key) || field.key == "path" {
            Tier::Core
        } else {
            Tier::More
        };
        field.default_value = DEFAULTS.iter().find(|(key, _)| *key == field.key).map(|(_, v)| *v);
    }
}

pub fn relation_def(relation: &str) -> Option<&'static RelationDef> {
    schema().relations.iter().find(|r| r.relation == relation)
}

pub fn schema() -> &'static Schema {
    static SCHEMA: OnceLock<Schema> = OnceLock::new();
    SCHEMA.get_or_init(build)
}

pub fn kind_def(kind: &str) -> Option<&'static KindDef> {
    schema().kinds.iter().find(|k| k.kind == kind)
}

pub fn field(kind: &str, key: &str) -> Option<&'static Field> {
    kind_def(kind)?.fields.iter().find(|f| f.key == key)
}

/// Rule applied to legacy keys that are accepted but have no field definition.
pub fn legacy_is_date(key: &str) -> bool {
    key == "expires_on"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_unique_and_refs_point_to_known_kinds() {
        for k in &schema().kinds {
            let mut seen = std::collections::HashSet::new();
            for field in &k.fields {
                assert!(seen.insert(field.key), "{} 重复字段 {}", k.kind, field.key);
                for target in field.refs.iter().flatten() {
                    assert!(kind_def(target).is_some(), "{} 引用未知类型", field.key);
                }
            }
        }
    }

    #[test]
    fn every_kind_has_a_short_core_and_system_fields_are_hidden() {
        for k in &schema().kinds {
            let core = k.fields.iter().filter(|f| f.tier == Tier::Core && f.key != "notes").count();
            assert!((1..=5).contains(&core), "{} 有 {core} 个核心字段", k.kind);
            assert!(CORE.iter().any(|(kind, _)| *kind == k.kind), "{} 未列核心字段", k.kind);
            for (kind, keys) in CORE.iter().filter(|(kind, _)| *kind == k.kind) {
                for key in *keys {
                    assert!(k.fields.iter().any(|f| f.key == *key), "{kind}.{key} 不存在");
                }
            }
            assert!(k.fields.iter().filter(|f| SYSTEM.contains(&f.key)).all(|f| f.tier == Tier::System));
        }
        let rate = field("subscription", "exchange_rate").unwrap();
        assert_eq!(rate.when.as_ref().unwrap().key, "currency");
    }

    /// Frontend tests read this fixture instead of calling the backend.
    /// Refresh with `UPDATE_SCHEMA=1 cargo test schema_fixture`.
    #[test]
    fn schema_fixture_is_current() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/schema.json");
        let current = serde_json::to_string_pretty(schema()).unwrap() + "\n";
        if std::env::var("UPDATE_SCHEMA").is_ok() {
            std::fs::write(&path, &current).unwrap();
        }
        // Windows checkouts may convert line endings.
        let saved = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        assert!(
            saved == current,
            "tests/fixtures/schema.json 已过期，运行 UPDATE_SCHEMA=1 cargo test schema_fixture"
        );
    }
}
