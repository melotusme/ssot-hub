//! Turns free text or screenshots into asset drafts. The model only proposes; every draft is
//! checked against the schema here, and nothing is written until the user confirms.
use crate::schema::{self, Field};
use crate::store::{Asset, Snapshot};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

type Result<T> = std::result::Result<T, String>;

/// Fields the backend fills itself; the model is not asked for them.
const SYSTEM_FIELDS: &[&str] = &["verification", "evidence", "observed_at"];
const SECRET_FIELDS: &[&str] = &["secret_ref", "license_ref"];
const VAULT_PREFIXES: &[&str] = &["op://", "1password://", "vault://", "keychain://", "bw://"];
const CONTEXT_LIMIT: usize = 800;
const NEW_PREFIX: &str = "new:";

#[derive(Debug, Serialize, specta::Type)]
pub struct Draft {
    pub asset: Asset,
    pub warnings: Vec<String>,
    /// Required fields are filled; false drafts need editing before they can be saved.
    pub ready: bool,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct Extraction {
    pub drafts: Vec<Draft>,
    pub notes: Vec<String>,
    pub model: String,
}

fn describe_field(f: &Field) -> String {
    let mut s = format!("{}({})", f.key, f.label.trim_end_matches(" *"));
    if f.required {
        s.push_str(" 必填");
    }
    if f.is_date() {
        s.push_str(" YYYY-MM-DD");
    }
    if let Some(options) = &f.options {
        let values: Vec<_> = options.iter().map(|(v, l)| format!("{v}={l}")).collect();
        s.push_str(&format!(" 取值:{}", values.join("/")));
    }
    if let Some(refs) = &f.refs {
        s.push_str(&format!(" 引用:{}", refs.join("|")));
    }
    s
}

pub fn system_prompt(kind_hint: Option<&str>, today: &str) -> String {
    let mut kinds = String::new();
    for k in &schema::schema().kinds {
        let fields: Vec<_> = k
            .fields
            .iter()
            .filter(|f| !SYSTEM_FIELDS.contains(&f.key))
            .map(describe_field)
            .collect();
        kinds.push_str(&format!("- {}（{}）：{}\n", k.kind, k.name, fields.join("；")));
    }
    let hint = kind_hint
        .and_then(schema::kind_def)
        .map(|k| format!("用户说明这些内容主要是「{}」({})。\n", k.name, k.kind))
        .unwrap_or_default();
    format!(
        "你是个人与家庭资产台账的录入助手。根据用户提供的文字或截图，提取值得登记的资产，按下面的类型和字段输出。今天是 {today}。\n\
{hint}\n\
## 类型与字段\n{kinds}\n\
## 规则\n\
1. 只填写材料里明确出现或能直接推出的信息；不确定的不填，写进该条的 review_note。\n\
2. 取值类字段只能用列出的英文取值；日期用 YYYY-MM-DD；金额只写数字；币种用三位大写代码。\n\
3. 引用字段填「已有资产」里的 id；引用本次新建的条目时填 \"new:<temp_id>\"。找不到就不填，并在 review_note 说明。\n\
4. 绝不输出密码、验证码、API key、token、激活码。secret_ref 只能是 op:// 等保险库引用，否则不填。\n\
5. 已有资产里已经存在的东西不要重复新建。\n\
6. 只输出一个 JSON 对象，不要输出其他文字：\n\
{{\"assets\":[{{\"temp_id\":\"a1\",\"kind\":\"device\",\"name\":\"简短名称\",\"fields\":{{\"字段\":\"值\"}}}}],\"notes\":\"给用户的简短说明（可空）\"}}\n"
    )
}

/// Existing assets the model may reference: id, kind and name only, no other fields.
pub fn context(s: &Snapshot) -> String {
    let mut rows: Vec<&Asset> = s.assets.iter().filter(|a| a.status == "active").collect();
    // Hundreds of scanned packages would crowd out everything else.
    rows.sort_by_key(|a| (a.kind == "software", a.kind.clone(), a.name.clone()));
    let total = rows.len();
    let mut out: Vec<String> = rows
        .iter()
        .take(CONTEXT_LIMIT)
        .map(|a| format!("{} | {} | {}", a.id, a.kind, a.name))
        .collect();
    if total > CONTEXT_LIMIT {
        out.push(format!("（另有 {} 项未列出）", total - CONTEXT_LIMIT));
    }
    if out.is_empty() {
        "（台账为空）".into()
    } else {
        out.join("\n")
    }
}

pub fn user_prompt(text: &str, s: &Snapshot) -> String {
    format!(
        "## 已有资产（id | 类型 | 名称）\n{}\n\n## 用户材料\n{}",
        context(s),
        if text.trim().is_empty() { "（见截图）" } else { text.trim() }
    )
}

/// The JSON object in the answer, tolerating code fences and surrounding prose.
pub fn parse_answer(answer: &str) -> Result<Value> {
    let start = answer.find('{').ok_or("AI 没有返回可识别的 JSON")?;
    let end = answer.rfind('}').ok_or("AI 没有返回可识别的 JSON")?;
    if end < start {
        return Err("AI 没有返回可识别的 JSON".into());
    }
    serde_json::from_str(&answer[start..=end]).map_err(|_| "AI 返回的 JSON 无法解析，请重试或换一个模型".into())
}

fn scalar(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
    .filter(|s| !s.is_empty())
}

struct Raw {
    temp_id: String,
    kind: &'static schema::KindDef,
    name: String,
    fields: serde_json::Map<String, Value>,
}

fn resolve_option(f: &Field, v: &str) -> Option<String> {
    let options = f.options.as_ref()?;
    options
        .iter()
        .find(|(value, label)| value.eq_ignore_ascii_case(v) || *label == v)
        .map(|(value, _)| value.to_string())
}

fn is_date(v: &str) -> bool {
    chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_ok()
}

fn is_decimal(v: &str) -> bool {
    v.parse::<rust_decimal::Decimal>().is_ok_and(|d| !d.is_sign_negative())
}

/// Check the model's proposal against the schema and the ledger. Keeps what is valid,
/// drops the rest with a warning, and gives every draft a fresh id.
pub fn sanitize(answer: &Value, s: &Snapshot, evidence: &str, model: &str) -> Extraction {
    let mut notes = Vec::new();
    if let Some(n) = answer.get("notes").and_then(scalar) {
        notes.push(n);
    }
    let items = answer.get("assets").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut raws = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        let Some(def) = schema::kind_def(kind) else {
            notes.push(format!("第 {} 条类型「{kind}」不受支持，已跳过", i + 1));
            continue;
        };
        let name: String = item.get("name").and_then(scalar).unwrap_or_default().chars().take(500).collect();
        if name.is_empty() {
            notes.push(format!("第 {} 条没有名称，已跳过", i + 1));
            continue;
        }
        raws.push(Raw {
            temp_id: item.get("temp_id").and_then(scalar).unwrap_or_else(|| format!("#{i}")),
            kind: def,
            name,
            fields: item.get("fields").and_then(Value::as_object).cloned().unwrap_or_default(),
        });
    }
    let ids: Vec<String> = raws.iter().map(|_| uuid::Uuid::new_v4().to_string()).collect();
    let new_ids: HashMap<&str, (usize, &str)> = raws
        .iter()
        .enumerate()
        .map(|(i, r)| (r.temp_id.as_str(), (i, r.kind.kind)))
        .collect();
    let existing: HashMap<&str, &Asset> = s.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    let resolve_ref = |targets: &[&str], v: &str, own: usize| -> Option<String> {
        if let Some(a) = existing.get(v) {
            return targets.contains(&a.kind.as_str()).then(|| a.id.clone());
        }
        let temp = v.strip_prefix(NEW_PREFIX).unwrap_or(v);
        if let Some((i, kind)) = new_ids.get(temp) {
            return (*i != own && targets.contains(kind)).then(|| ids[*i].clone());
        }
        // A unique name match among existing assets of the right kind.
        let mut by_name = s
            .assets
            .iter()
            .filter(|a| targets.contains(&a.kind.as_str()) && a.name == v);
        match (by_name.next(), by_name.next()) {
            (Some(a), None) => Some(a.id.clone()),
            _ => None,
        }
    };

    let mut drafts = Vec::new();
    for (i, raw) in raws.iter().enumerate() {
        let mut fields = std::collections::BTreeMap::new();
        let mut warnings = Vec::new();
        for (key, value) in &raw.fields {
            let Some(v) = scalar(value) else { continue };
            let Some(f) = raw.kind.fields.iter().find(|f| f.key == key) else {
                warnings.push(format!("忽略不支持的字段 {key}"));
                continue;
            };
            if SYSTEM_FIELDS.contains(&f.key) {
                continue;
            }
            let label = f.label.trim_end_matches(" *");
            let accepted = if SECRET_FIELDS.contains(&f.key) {
                let ok = VAULT_PREFIXES.iter().any(|p| v.starts_with(p));
                if !ok {
                    warnings.push(format!("{label}不是保险库引用，已丢弃（台账不保存密码或密钥）"));
                }
                ok.then_some(v)
            } else if let Some(targets) = &f.refs {
                let r = resolve_ref(targets, &v, i);
                if r.is_none() {
                    warnings.push(format!("{label}「{v}」没有找到对应资产，未关联"));
                }
                r
            } else if f.options.is_some() {
                let r = resolve_option(f, &v);
                if r.is_none() {
                    warnings.push(format!("{label}「{v}」不是可选值，未填写"));
                }
                r
            } else if f.is_date() {
                let ok = is_date(&v);
                if !ok {
                    warnings.push(format!("{label}「{v}」不是有效日期，未填写"));
                }
                ok.then_some(v)
            } else if ["price", "exchange_rate"].contains(&f.key) {
                let ok = is_decimal(&v);
                if !ok {
                    warnings.push(format!("{label}「{v}」不是数字，未填写"));
                }
                ok.then_some(v)
            } else if ["currency", "base_currency"].contains(&f.key) {
                let upper = v.to_ascii_uppercase();
                let ok = upper.len() == 3 && upper.bytes().all(|c| c.is_ascii_uppercase());
                if !ok {
                    warnings.push(format!("{label}「{v}」不是三位币种代码，未填写"));
                }
                ok.then_some(upper)
            } else {
                Some(v.chars().take(20000).collect())
            };
            if let Some(v) = accepted {
                fields.insert(f.key.to_string(), v);
            }
        }
        fields.insert("verification".into(), "reported".into());
        fields.insert("evidence".into(), evidence.into());
        let missing: Vec<&str> = raw
            .kind
            .fields
            .iter()
            .filter(|f| f.required && !fields.contains_key(f.key))
            .map(|f| f.label.trim_end_matches(" *"))
            .collect();
        if !missing.is_empty() {
            warnings.push(format!("缺少必填：{}，请编辑后再登记", missing.join("、")));
        }
        drafts.push(Draft {
            asset: Asset {
                id: ids[i].clone(),
                kind: raw.kind.kind.into(),
                name: raw.name.clone(),
                status: "active".into(),
                fields,
            },
            warnings,
            ready: missing.is_empty(),
        });
    }
    if drafts.is_empty() && notes.is_empty() {
        notes.push("没有识别出可以登记的资产".into());
    }
    Extraction {
        drafts,
        notes,
        model: model.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn ledger() -> Snapshot {
        let asset = |id: &str, kind: &str, name: &str| Asset {
            id: id.into(),
            kind: kind.into(),
            name: name.into(),
            status: "active".into(),
            fields: BTreeMap::new(),
        };
        Snapshot {
            version: 3,
            revision: 0,
            assets: vec![asset("me", "person", "我"), asset("mac", "device", "MacBook-A"), asset("env", "environment", "macOS")],
            links: vec![],
            events: vec![],
        }
    }

    #[test]
    fn prompt_lists_schema_and_only_names_of_existing_assets() {
        let p = system_prompt(Some("subscription"), "2026-11-05");
        assert!(p.contains("billing_period(计费周期) 取值:month=每月/year=每年/once=一次性"));
        assert!(p.contains("「订阅与许可」") && !p.contains("observed_at("));
        let mut s = ledger();
        s.assets[1].fields.insert("serial".into(), "SECRET-SERIAL".into());
        let u = user_prompt("新买的 iPad", &s);
        assert!(u.contains("mac | device | MacBook-A") && !u.contains("SECRET-SERIAL"));
    }

    #[test]
    fn parses_fenced_answers() {
        let v = parse_answer("好的：\n```json\n{\"assets\":[],\"notes\":\"无\"}\n```").unwrap();
        assert_eq!(v["notes"], "无");
        assert!(parse_answer("没有 JSON").is_err());
    }

    #[test]
    fn sanitize_resolves_refs_and_drops_unsafe_values() {
        let answer = serde_json::json!({
            "assets": [
                {"temp_id": "a1", "kind": "account", "name": "Google 个人",
                 "fields": {"provider": "Google", "owner_id": "我", "secret_ref": "hunter2", "color": "red"}},
                {"temp_id": "s1", "kind": "subscription", "name": "Google One",
                 "fields": {"account_id": "new:a1", "billing_period": "每年", "price": 99, "currency": "cny",
                            "expires_on": "2027-02-30", "owner_id": "nobody"}},
                {"temp_id": "x", "kind": "spaceship", "name": "?"},
                {"temp_id": "sw", "kind": "software", "name": "Raycast", "fields": {"source": "app"}}
            ],
            "notes": "从截图识别"
        });
        let e = sanitize(&answer, &ledger(), "AI 辅助录入 · test", "m");
        assert_eq!(e.drafts.len(), 3);
        assert!(e.notes.iter().any(|n| n.contains("spaceship")));
        let account = &e.drafts[0];
        assert_eq!(account.asset.fields["owner_id"], "me");
        assert!(!account.asset.fields.contains_key("secret_ref") && !account.asset.fields.contains_key("color"));
        assert_eq!(account.asset.fields["verification"], "reported");
        let sub = &e.drafts[1].asset.fields;
        assert_eq!(sub["account_id"], account.asset.id);
        assert_eq!(sub["billing_period"], "year");
        assert_eq!(sub["price"], "99");
        assert_eq!(sub["currency"], "CNY");
        assert!(!sub.contains_key("expires_on") && !sub.contains_key("owner_id"));
        let software = &e.drafts[2];
        assert!(!software.ready && software.warnings.iter().any(|w| w.contains("所属系统环境")));
        assert!(e.drafts.iter().all(|d| d.asset.id.len() == 36));
    }
}
