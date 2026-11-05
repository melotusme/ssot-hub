//! Whole-snapshot validation. Every rule derives from `schema.rs`; values on assets and on
//! relation attributes go through the same checks.
use crate::schema::{self, Field};
use crate::store::{Asset, Link, Snapshot};
use std::collections::{HashMap, HashSet};

type Result<T> = std::result::Result<T, String>;

pub const SNAPSHOT_VERSION: u32 = 4;
const NAME_MAX_CHARS: usize = 500;
const VALUE_MAX_CHARS: usize = 20000;
const VAULT_PREFIXES: &[&str] = &["op://", "1password://", "vault://", "keychain://", "bw://"];
const OPEN_END: &str = "9999-12-31";

type Index<'a> = HashMap<&'a str, &'a Asset>;

/// One value against its field definition. `owner` names the record in messages.
fn check_value(
    field: Option<&Field>,
    key: &str,
    v: &str,
    owner: &str,
    self_id: &str,
    by_id: &Index,
) -> Result<()> {
    if v.chars().count() > VALUE_MAX_CHARS {
        return Err(format!("{owner}：字段内容过长"));
    }
    if v.is_empty() {
        return Ok(());
    }
    let label = field.map_or(key, |f| f.label.trim_end_matches(" *"));
    if ["secret_ref", "license_ref"].contains(&key) && !VAULT_PREFIXES.iter().any(|p| v.starts_with(p)) {
        return Err(format!("{owner}：凭据仅允许保险库引用"));
    }
    let is_date = field.map_or(schema::legacy_is_date(key), |f| f.is_date());
    if is_date && chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_err() {
        return Err(format!("{owner}：{label}应为有效的 YYYY-MM-DD"));
    }
    if let Some(targets) = field.and_then(|f| f.refs.as_ref())
        && (self_id == v || !by_id.get(v).is_some_and(|t| targets.contains(&t.kind.as_str())))
    {
        return Err(format!("{owner}：{label} 引用无效"));
    }
    if let Some(options) = field.and_then(|f| f.options.as_ref())
        && !options.iter().any(|(value, _)| *value == v)
    {
        return Err(format!("{owner}：{label} 选项无效：{v}"));
    }
    if ["price", "exchange_rate"].contains(&key) {
        let n = v
            .parse::<rust_decimal::Decimal>()
            .map_err(|_| format!("{owner}：金额与汇率必须是十进制数字"))?;
        if n.is_sign_negative() || (key == "exchange_rate" && n.is_zero()) {
            return Err(format!("{owner}：金额不可为负，汇率必须大于零"));
        }
    }
    if ["currency", "base_currency"].contains(&key)
        && (v.len() != 3 || !v.bytes().all(|c| c.is_ascii_uppercase()))
    {
        return Err(format!("{owner}：币种应为三位大写代码，如 CNY"));
    }
    if ["repository", "authority_ref", "endpoint", "backup_ref", "path"].contains(&key)
        && (v.contains('@') && v.contains("://") || v.contains("token=") || v.contains("password="))
    {
        return Err(format!("{owner}：地址不能包含凭据"));
    }
    if key == "probe_at" && chrono::DateTime::parse_from_rfc3339(v).is_err() {
        return Err(format!("{owner}：{label}应为 ISO 8601 时间"));
    }
    Ok(())
}

fn required(fields: &[Field], values: &std::collections::BTreeMap<String, String>, owner: &str) -> Result<()> {
    for f in fields.iter().filter(|f| f.required) {
        if values.get(f.key).is_none_or(|v| v.is_empty()) {
            return Err(format!("请填写{}（{owner}）", f.label.trim_end_matches(" *")));
        }
    }
    Ok(())
}

fn check_asset(a: &Asset, by_id: &Index) -> Result<()> {
    let Some(def) = schema::kind_def(&a.kind) else {
        return Err(format!("不支持的资产类型：{}", a.kind));
    };
    if a.name.trim().is_empty() {
        return Err("资产名称不能为空".into());
    }
    if a.name.chars().count() > NAME_MAX_CHARS || !["active", "retired"].contains(&a.status.as_str()) {
        return Err(format!("{}：名称过长或状态无效", a.name));
    }
    for (k, v) in &a.fields {
        let field = def.fields.iter().find(|f| f.key == k);
        if field.is_none() && !schema::LEGACY_KEYS.contains(&k.as_str()) {
            return Err(format!("{}：不支持的字段 {k}（请勿录入密码或令牌）", a.name));
        }
        check_value(field, k, v, &a.name, &a.id, by_id)?;
    }
    required(&def.fields, &a.fields, &a.name)?;
    if a.kind == "course" {
        let number = |key: &str| -> Result<u32> {
            a.fields
                .get(key)
                .filter(|v| !v.is_empty())
                .map(|v| v.parse::<u32>().map_err(|_| "课时必须是非负整数".to_string()))
                .unwrap_or(Ok(0))
        };
        if number("lessons_used")? > number("lessons_total")? {
            return Err("已用课时不能超过购买课时".into());
        }
        if let (Some(start), Some(end)) = (a.fields.get("starts_on"), a.fields.get("expires_on"))
            && !end.is_empty()
            && end < start
        {
            return Err("课程到期不能早于开始".into());
        }
    }
    // A host chain cannot contain a cycle.
    let mut seen = HashSet::new();
    let mut cursor = Some(a);
    while let Some(node) = cursor {
        if !seen.insert(&node.id) {
            return Err("系统宿主关系存在循环".into());
        }
        cursor = node.fields.get("host_id").and_then(|id| by_id.get(id.as_str()).copied());
    }
    Ok(())
}

fn span(l: &Link) -> (&str, &str) {
    let start = l.attrs.get("starts_on").map_or("", String::as_str);
    let end = l.attrs.get("ends_on").filter(|v| !v.is_empty()).map_or(OPEN_END, String::as_str);
    (start, end)
}

fn check_link(l: &Link, by_id: &Index) -> Result<()> {
    let def = schema::relation_def(&l.kind).ok_or_else(|| format!("不支持的关系类型：{}", l.kind))?;
    let (Some(from), Some(to)) = (by_id.get(l.from.as_str()), by_id.get(l.to.as_str())) else {
        return Err(format!("{}：关系两端必须是已有资产", def.name));
    };
    let owner = format!("{} → {}（{}）", from.name, to.name, def.name);
    if l.from == l.to || !def.from.contains(&from.kind.as_str()) || !def.to.contains(&to.kind.as_str()) {
        return Err(format!("{owner}：两端类型不符合这种关系"));
    }
    for (k, v) in &l.attrs {
        let field = def.attrs.iter().find(|f| f.key == k);
        if field.is_none() {
            return Err(format!("{owner}：不支持的属性 {k}"));
        }
        check_value(field, k, v, &owner, "", by_id)?;
    }
    required(&def.attrs, &l.attrs, &owner)?;
    match l.kind.as_str() {
        "uses" => {
            let (start, end) = span(l);
            if end <= start {
                return Err(format!("{owner}：结束日期必须晚于开始日期"));
            }
        }
        "joins" => {
            if to.fields.get("service_kind").is_some_and(|k| k != "network") {
                return Err(format!("{owner}：只能接入「网络与穿透」类服务"));
            }
            if l.attrs.get("probe_state").is_some_and(|v| !v.is_empty() && v != "untested")
                && l.attrs.get("probe_at").is_none_or(|v| v.is_empty())
            {
                return Err(format!("{owner}：标记连通性必须填写测试时间，配置存在不等于连通"));
            }
            if let Some(software) = l.attrs.get("software_id").filter(|v| !v.is_empty()) {
                let env = by_id
                    .get(software.as_str())
                    .and_then(|s| s.fields.get("environment_id"))
                    .and_then(|id| by_id.get(id.as_str()));
                let env_device = env.and_then(|e| e.fields.get("device_id")).map(String::as_str);
                if Some(l.from.as_str()) != env.map(|e| e.id.as_str()) && Some(l.from.as_str()) != env_device {
                    return Err(format!("{owner}：节点与软件所在系统不一致，不能混淆宿主和客户机"));
                }
            }
        }
        "related" => {
            if l.attrs.get("note").is_none_or(|v| v.trim().is_empty()) {
                return Err(format!("{owner}：其他关联需要写明是什么关系"));
            }
        }
        _ => {}
    }
    Ok(())
}

/// Two people cannot use one asset at the same time unless both mark it shared.
fn check_overlaps(links: &[Link]) -> Result<()> {
    let mut by_asset: HashMap<&str, Vec<&Link>> = HashMap::new();
    for l in links.iter().filter(|l| l.kind == "uses") {
        by_asset.entry(l.to.as_str()).or_default().push(l);
    }
    for uses in by_asset.values() {
        for (i, a) in uses.iter().enumerate() {
            for b in &uses[i + 1..] {
                let ((a0, a1), (b0, b1)) = (span(a), span(b));
                let shared = |l: &Link| l.attrs.get("usage_role").is_some_and(|r| r == "shared");
                if a0 < b1 && b0 < a1 && (a.from == b.from || !shared(a) || !shared(b)) {
                    return Err("使用区间重叠：请交接或结束旧的使用记录；多人同时使用须都标为共用".into());
                }
            }
        }
    }
    Ok(())
}

pub fn validate(s: &Snapshot) -> Result<()> {
    if s.version != SNAPSHOT_VERSION {
        return Err("快照版本不是 4，请通过迁移读取".into());
    }
    let mut by_id: Index = HashMap::with_capacity(s.assets.len());
    for a in &s.assets {
        if a.id.is_empty() || by_id.insert(a.id.as_str(), a).is_some() {
            return Err("资产 ID 无效/重复".into());
        }
    }
    for a in &s.assets {
        check_asset(a, &by_id)?;
    }
    let mut ids: HashSet<&str> = by_id.keys().copied().collect();
    let mut pairs = HashSet::new();
    for l in &s.links {
        if l.id.is_empty() || !ids.insert(l.id.as_str()) {
            return Err("关系 ID 无效/重复".into());
        }
        check_link(l, &by_id)?;
        // A timed relation can repeat over time; any other relation exists once per pair.
        if l.kind != "uses" && l.kind != "related" && !pairs.insert((&l.kind, &l.from, &l.to)) {
            return Err("同样的关系已经存在".into());
        }
    }
    check_overlaps(&s.links)?;
    let mut event_ids = HashSet::new();
    for e in &s.events {
        if e.id.is_empty() || !event_ids.insert(&e.id) {
            return Err("审计事件 ID 重复".into());
        }
    }
    Ok(())
}

/// Fields and relations that point at `id`, as readable reasons it cannot be deleted yet.
pub fn references(s: &Snapshot, id: &str) -> Vec<String> {
    let mut out = vec![];
    for a in &s.assets {
        for (k, v) in &a.fields {
            if v == id
                && let Some(f) = schema::field(&a.kind, k).filter(|f| f.refs.is_some())
            {
                out.push(format!("{} · {}", a.name, f.label.trim_end_matches(" *")));
            }
        }
    }
    let name = |x: &str| s.assets.iter().find(|a| a.id == x).map_or("?", |a| a.name.as_str());
    for l in s.links.iter().filter(|l| l.from == id || l.to == id) {
        let def = schema::relation_def(&l.kind).map_or(l.kind.as_str(), |d| d.name);
        out.push(format!("关系：{} → {}（{def}）", name(&l.from), name(&l.to)));
    }
    out
}
