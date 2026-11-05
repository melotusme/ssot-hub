//! Prompt and context for AI-assisted entry. The model only proposes operations; `plan.rs`
//! checks every one against the schema and the ledger before the user sees it.
use crate::schema::{self, Field, Tier};
use crate::store::{Asset, Snapshot};
use serde_json::Value;

type Result<T> = std::result::Result<T, String>;

const CONTEXT_LIMIT: usize = 800;

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

fn describe_fields(fields: &[Field]) -> String {
    fields
        .iter()
        .filter(|f| f.tier != Tier::System)
        .map(describe_field)
        .collect::<Vec<_>>()
        .join("；")
}

pub fn system_prompt(kind_hint: Option<&str>, today: &str) -> String {
    let schema = schema::schema();
    let mut kinds = String::new();
    for k in &schema.kinds {
        kinds.push_str(&format!("- {}（{}）：{}\n", k.kind, k.name, describe_fields(&k.fields)));
    }
    let mut relations = String::new();
    for r in &schema.relations {
        relations.push_str(&format!(
            "- {}（{}）：from {} → to {}；属性：{}\n",
            r.relation,
            r.name,
            r.from.join("|"),
            r.to.join("|"),
            describe_fields(&r.attrs)
        ));
    }
    let hint = kind_hint
        .and_then(schema::kind_def)
        .map(|k| format!("用户说明这些内容主要是「{}」({})。\n", k.name, k.kind))
        .unwrap_or_default();
    format!(
        "你是个人与家庭资产台账的录入助手。根据用户的文字或截图，给出对台账的操作。今天是 {today}。\n\
{hint}\n\
## 资产类型与字段\n{kinds}\n\
## 关系类型\n{relations}\n\
## 规则\n\
1. 新东西用 create；已有资产的信息变了用 update（只写变化的字段）；不再使用、不续费、卖掉的用 retire。\n\
2. 谁在用某个设备或服务用 relate，type=uses，from=成员，to=设备/服务。交接给别人也只写新的 uses，系统会自动结束旧的使用记录。\n\
3. 只写材料里明确出现或能直接推出的信息；不确定的不填，写进该条的 review_note。\n\
4. 关键信息不确定时（比如不知道是谁在用、是哪台设备），不要猜，放进 questions，每个问题给 2 到 6 个候选答案（优先用已有成员或资产的名称）。最多 3 个问题。\n\
5. 取值类字段只能用列出的英文取值；日期用 YYYY-MM-DD；金额只写数字；币种用三位大写代码。\n\
6. 引用填「已有资产」里的 id；引用本次新建的条目填 \"new:<temp_id>\"。\n\
7. 绝不输出密码、验证码、API key、token、激活码；secret_ref 只能是 op:// 等保险库引用。\n\
8. 已经存在的东西不要重复新建。\n\
9. 只输出一个 JSON 对象，不要输出其他文字：\n\
{{\"create\":[{{\"temp_id\":\"a1\",\"kind\":\"device\",\"name\":\"简短名称\",\"fields\":{{}}}}],\
\"update\":[{{\"id\":\"已有 id\",\"fields\":{{}}}}],\
\"relate\":[{{\"type\":\"uses\",\"from\":\"id 或 new:a1\",\"to\":\"id 或 new:a1\",\"attrs\":{{}}}}],\
\"retire\":[{{\"id\":\"已有 id\",\"reason\":\"原因\"}}],\
\"questions\":[{{\"text\":\"问题\",\"options\":[\"候选\"]}}],\
\"notes\":\"给用户的简短说明（可空）\"}}\n"
    )
}

fn name_of<'a>(s: &'a Snapshot, id: &'a str) -> &'a str {
    s.assets.iter().find(|a| a.id == id).map_or(id, |a| a.name.as_str())
}

/// Core fields of an existing asset, references shown by name.
fn core_summary(a: &Asset, s: &Snapshot) -> String {
    let Some(def) = schema::kind_def(&a.kind) else { return String::new() };
    def.fields
        .iter()
        .filter(|f| f.tier == Tier::Core && f.key != "notes")
        .filter_map(|f| {
            let v = a.fields.get(f.key).filter(|v| !v.is_empty())?;
            let shown = if f.refs.is_some() { name_of(s, v).to_string() } else { v.clone() };
            Some(format!("{}={shown}", f.key))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn current_users(a: &Asset, s: &Snapshot, today: &str) -> String {
    let users: Vec<String> = s
        .links
        .iter()
        .filter(|l| {
            l.kind == "uses"
                && l.to == a.id
                && l.attrs.get("starts_on").is_some_and(|d| d.as_str() <= today)
                && l.attrs.get("ends_on").is_none_or(|d| d.is_empty() || d.as_str() > today)
        })
        .map(|l| format!("{}({})", name_of(s, &l.from), l.attrs.get("usage_role").map_or("", String::as_str)))
        .collect();
    if users.is_empty() { String::new() } else { format!(" | 在用：{}", users.join("、")) }
}

/// Existing assets the model may reference or change: id, kind, name, core fields and who
/// uses it now. Scanned software you have not followed is left out.
pub fn context(s: &Snapshot, today: &str) -> String {
    let mut rows: Vec<&Asset> = s
        .assets
        .iter()
        .filter(|a| a.status == "active")
        .filter(|a| a.kind != "software" || a.fields.get("tracked").is_some_and(|t| t == "yes"))
        .collect();
    rows.sort_by_key(|a| (a.kind == "software", a.kind.clone(), a.name.clone()));
    let total = rows.len();
    let mut out: Vec<String> = rows
        .iter()
        .take(CONTEXT_LIMIT)
        .map(|a| {
            let core = core_summary(a, s);
            format!(
                "{} | {} | {}{}{}",
                a.id,
                a.kind,
                a.name,
                if core.is_empty() { String::new() } else { format!(" | {core}") },
                current_users(a, s, today)
            )
        })
        .collect();
    if total > CONTEXT_LIMIT {
        out.push(format!("（另有 {} 项未列出）", total - CONTEXT_LIMIT));
    }
    if out.is_empty() { "（台账为空）".into() } else { out.join("\n") }
}

pub fn user_prompt(text: &str, s: &Snapshot, today: &str) -> String {
    format!(
        "## 已有资产（id | 类型 | 名称 | 核心字段 | 在用）\n{}\n\n## 用户材料\n{}",
        context(s, today),
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

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::store::Link;
    use std::collections::BTreeMap;

    pub fn ledger() -> Snapshot {
        let asset = |id: &str, kind: &str, name: &str, fields: &[(&str, &str)]| Asset {
            id: id.into(),
            kind: kind.into(),
            name: name.into(),
            status: "active".into(),
            fields: fields.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        };
        Snapshot {
            version: 4,
            revision: 0,
            assets: vec![
                asset("me", "person", "我", &[("person_kind", "self")]),
                asset("kid", "person", "孩子", &[("person_kind", "child")]),
                asset("mac", "device", "MacBook-A", &[("device_kind", "laptop"), ("owner_id", "me"), ("serial", "SECRET-SERIAL")]),
                asset("env", "environment", "macOS", &[("device_id", "mac")]),
                asset("brew", "software", "wget", &[("environment_id", "env")]),
                asset("claude", "subscription", "Claude Pro", &[("price", "20"), ("currency", "USD"), ("billing_period", "month"), ("auto_renew", "yes")]),
                asset("icloud", "subscription", "iCloud+ 200G", &[("price", "21"), ("currency", "CNY"), ("billing_period", "month")]),
            ],
            links: vec![Link {
                id: "u1".into(),
                kind: "uses".into(),
                from: "me".into(),
                to: "mac".into(),
                attrs: BTreeMap::from([("usage_role".into(), "primary".into()), ("starts_on".into(), "2025-01-01".into())]),
            }],
            events: vec![],
        }
    }

    #[test]
    fn prompt_lists_kinds_relations_and_operations() {
        let p = system_prompt(Some("subscription"), "2026-11-05");
        assert!(p.contains("billing_period(计费周期) 取值:month=每月/year=每年/once=一次性"));
        assert!(p.contains("「订阅」") && !p.contains("observed_at(") && !p.contains("tracked("));
        assert!(p.contains("uses（使用）：from person → to device|service"));
        assert!(p.contains("\"retire\"") && p.contains("\"questions\""));
    }

    #[test]
    fn context_has_core_fields_and_users_but_not_details_or_scans() {
        let u = user_prompt("MacBook-A 给孩子用了", &ledger(), "2026-11-05");
        assert!(u.contains("mac | device | MacBook-A | device_kind=laptop, owner_id=我 | 在用：我(primary)"));
        assert!(!u.contains("SECRET-SERIAL"), "more-tier fields are not sent");
        assert!(!u.contains("wget"), "scanned software is not sent");
    }

    #[test]
    fn parses_fenced_answers() {
        let v = parse_answer("好的：\n```json\n{\"create\":[],\"notes\":\"无\"}\n```").unwrap();
        assert_eq!(v["notes"], "无");
        assert!(parse_answer("没有 JSON").is_err());
    }
}
