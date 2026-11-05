//! Checks the model's proposed operations against the schema and the ledger and turns them
//! into a plan the user reviews. Invalid values are dropped with a warning; nothing is written.
use crate::schema::{self, Field, Tier};
use crate::store::{Asset, Link, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

const SECRET_FIELDS: &[&str] = &["secret_ref", "license_ref"];
const VAULT_PREFIXES: &[&str] = &["op://", "1password://", "vault://", "keychain://", "bw://"];
const NEW_PREFIX: &str = "new:";
const MAX_QUESTIONS: usize = 3;
const MAX_OPTIONS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Create,
    Update,
    Relate,
    Retire,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct PlanItem {
    /// Stable key for selection in the UI.
    pub key: String,
    pub op: Op,
    pub title: String,
    /// Readable lines: "种类：平板", "所有者：我 → 孩子".
    pub details: Vec<String>,
    pub warnings: Vec<String>,
    /// Complete enough to apply; incomplete creates need editing first.
    pub ready: bool,
    /// Create: the new asset. Update / retire: the asset after the change.
    pub asset: Option<Asset>,
    /// Relate: the new relation.
    pub link: Option<Link>,
    /// Relate (uses): the open use that ends when this one starts.
    pub ends: Option<String>,
    /// Keys of create items this item refers to.
    pub needs: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct Question {
    pub text: String,
    pub options: Vec<String>,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct Plan {
    pub items: Vec<PlanItem>,
    pub questions: Vec<Question>,
    pub notes: Vec<String>,
    pub model: String,
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

fn items<'a>(answer: &'a Value, key: &str) -> Vec<&'a Value> {
    answer.get(key).and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

fn label(f: &Field) -> &'static str {
    f.label.trim_end_matches(" *")
}

/// Assets known to this plan: existing ones and the ones it creates (by temp id).
struct Scope<'a> {
    snapshot: &'a Snapshot,
    existing: HashMap<&'a str, &'a Asset>,
    /// temp id → (new id, kind, plan key)
    created: HashMap<String, (String, String, String)>,
    names: HashMap<String, String>,
}

impl Scope<'_> {
    /// Resolve an id, `new:<temp>` or a unique name to an asset id of one of `kinds`.
    fn resolve(&self, kinds: &[&str], v: &str) -> Option<(String, Option<String>)> {
        if let Some(a) = self.existing.get(v) {
            return kinds.contains(&a.kind.as_str()).then(|| (a.id.clone(), None));
        }
        let temp = v.strip_prefix(NEW_PREFIX).unwrap_or(v);
        if let Some((id, kind, key)) = self.created.get(temp) {
            return kinds.contains(&kind.as_str()).then(|| (id.clone(), Some(key.clone())));
        }
        let mut by_name = self
            .snapshot
            .assets
            .iter()
            .filter(|a| a.status == "active" && kinds.contains(&a.kind.as_str()) && a.name == v);
        match (by_name.next(), by_name.next()) {
            (Some(a), None) => Some((a.id.clone(), None)),
            _ => None,
        }
    }
    fn name(&self, id: &str) -> String {
        self.names.get(id).cloned().unwrap_or_else(|| id.to_string())
    }
}

fn resolve_option(f: &Field, v: &str) -> Option<String> {
    f.options
        .as_ref()?
        .iter()
        .find(|(value, label)| value.eq_ignore_ascii_case(v) || *label == v)
        .map(|(value, _)| value.to_string())
}

/// One proposed value against its field. Returns the cleaned value and plan keys it depends on.
fn clean_value(f: &Field, v: &str, scope: &Scope, warnings: &mut Vec<String>) -> Option<(String, Option<String>)> {
    let l = label(f);
    let fail = |warnings: &mut Vec<String>, why: &str| {
        warnings.push(format!("{l}「{v}」{why}"));
        None
    };
    if SECRET_FIELDS.contains(&f.key) {
        if VAULT_PREFIXES.iter().any(|p| v.starts_with(p)) {
            return Some((v.into(), None));
        }
        warnings.push(format!("{l}不是保险库引用，已丢弃（台账不保存密码或密钥）"));
        return None;
    }
    if let Some(targets) = &f.refs {
        return scope.resolve(targets, v).or_else(|| fail(warnings, "没有找到对应资产，未关联"));
    }
    if f.options.is_some() {
        return resolve_option(f, v).map(|o| (o, None)).or_else(|| fail(warnings, "不是可选值，未填写"));
    }
    if f.is_date() {
        return chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d")
            .ok()
            .map(|_| (v.into(), None))
            .or_else(|| fail(warnings, "不是有效日期，未填写"));
    }
    if ["price", "exchange_rate"].contains(&f.key) {
        let ok = v.parse::<rust_decimal::Decimal>().is_ok_and(|d| !d.is_sign_negative());
        return ok.then(|| (v.into(), None)).or_else(|| fail(warnings, "不是数字，未填写"));
    }
    if ["currency", "base_currency"].contains(&f.key) {
        let upper = v.to_ascii_uppercase();
        let ok = upper.len() == 3 && upper.bytes().all(|c| c.is_ascii_uppercase());
        return ok.then_some((upper, None)).or_else(|| fail(warnings, "不是三位币种代码，未填写"));
    }
    Some((v.chars().take(20000).collect(), None))
}

/// Clean a map of proposed values against `defs`, skipping system fields.
fn clean_map(
    defs: &[Field],
    raw: Option<&Map<String, Value>>,
    scope: &Scope,
    warnings: &mut Vec<String>,
    needs: &mut Vec<String>,
) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (key, value) in raw.into_iter().flatten() {
        let Some(v) = scalar(value) else { continue };
        let Some(f) = defs.iter().find(|f| f.key == key) else {
            warnings.push(format!("忽略不支持的字段 {key}"));
            continue;
        };
        if f.tier == Tier::System {
            continue;
        }
        if let Some((clean, need)) = clean_value(f, &v, scope, warnings) {
            out.insert(f.key.to_string(), clean);
            needs.extend(need);
        }
    }
    out
}

fn shown(f: &Field, v: &str, scope: &Scope) -> String {
    if f.refs.is_some() {
        scope.name(v)
    } else {
        f.options
            .as_ref()
            .and_then(|o| o.iter().find(|(k, _)| *k == v))
            .map_or(v.to_string(), |(_, l)| l.to_string())
    }
}

fn missing(defs: &[Field], values: &BTreeMap<String, String>) -> Vec<&'static str> {
    defs.iter().filter(|f| f.required && !values.contains_key(f.key)).map(label).collect()
}

fn create_items(answer: &Value, scope: &mut Scope, evidence: &str, notes: &mut Vec<String>) -> Vec<(Value, PlanItem)> {
    let mut raws = vec![];
    // "assets" is the earlier answer format.
    for (i, item) in items(answer, "create").into_iter().chain(items(answer, "assets")).enumerate() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        let Some(def) = schema::kind_def(kind) else {
            notes.push(format!("第 {} 条新建的类型「{kind}」不受支持，已跳过", i + 1));
            continue;
        };
        let name: String = item.get("name").and_then(scalar).unwrap_or_default().chars().take(500).collect();
        if name.is_empty() {
            notes.push(format!("第 {} 条新建没有名称，已跳过", i + 1));
            continue;
        }
        let temp = item.get("temp_id").and_then(scalar).unwrap_or_else(|| format!("#{i}"));
        let id = uuid::Uuid::new_v4().to_string();
        let key = format!("create:{id}");
        scope.created.insert(temp, (id.clone(), def.kind.to_string(), key.clone()));
        scope.names.insert(id.clone(), name.clone());
        raws.push((item.clone(), def, id, key, name));
    }
    raws.into_iter()
        .map(|(item, def, id, key, name)| {
            let mut warnings = vec![];
            let mut needs = vec![];
            let mut fields = clean_map(&def.fields, item.get("fields").and_then(Value::as_object), scope, &mut warnings, &mut needs);
            fields.insert("verification".into(), "reported".into());
            fields.insert("evidence".into(), evidence.into());
            if def.kind == "software" {
                fields.insert("tracked".into(), "yes".into());
            }
            let gaps = missing(&def.fields, &fields);
            if !gaps.is_empty() {
                warnings.push(format!("缺少必填：{}，请编辑后再登记", gaps.join("、")));
            }
            let details = def
                .fields
                .iter()
                .filter(|f| f.tier == Tier::Core && f.key != "notes")
                .filter_map(|f| fields.get(f.key).map(|v| format!("{}：{}", label(f), shown(f, v, scope))))
                .collect();
            needs.retain(|n| *n != key);
            let item_value = item.clone();
            (
                item_value,
                PlanItem {
                    key,
                    op: Op::Create,
                    title: format!("新建{}「{name}」", def.name),
                    details,
                    warnings,
                    ready: gaps.is_empty(),
                    asset: Some(Asset { id, kind: def.kind.into(), name, status: "active".into(), fields }),
                    link: None,
                    ends: None,
                    needs,
                },
            )
        })
        .collect()
}

fn find_existing<'a>(scope: &Scope<'a>, v: &str) -> Option<&'a Asset> {
    scope.existing.get(v).copied().or_else(|| {
        let mut m = scope.snapshot.assets.iter().filter(|a| a.name == v);
        match (m.next(), m.next()) {
            (Some(a), None) => Some(a),
            _ => None,
        }
    })
}

fn update_items(answer: &Value, scope: &Scope, notes: &mut Vec<String>) -> Vec<PlanItem> {
    let mut out = vec![];
    for item in items(answer, "update") {
        let id = item.get("id").and_then(scalar).unwrap_or_default();
        let Some(old) = find_existing(scope, &id) else {
            notes.push(format!("要修改的「{id}」没有找到，已跳过"));
            continue;
        };
        let def = schema::kind_def(&old.kind).expect("validated kind");
        let mut warnings = vec![];
        let mut needs = vec![];
        let proposed = clean_map(&def.fields, item.get("fields").and_then(Value::as_object), scope, &mut warnings, &mut needs);
        let mut after = old.clone();
        let mut details = vec![];
        for (k, v) in proposed {
            if old.fields.get(&k) == Some(&v) {
                continue;
            }
            let f = def.fields.iter().find(|f| f.key == k).expect("cleaned key");
            let before = old.fields.get(&k).map_or("（空）".into(), |o| shown(f, o, scope));
            details.push(format!("{}：{before} → {}", label(f), shown(f, &v, scope)));
            after.fields.insert(k, v);
        }
        if let Some(name) = item.get("name").and_then(scalar).filter(|n| *n != old.name) {
            details.push(format!("名称：{} → {name}", old.name));
            after.name = name.chars().take(500).collect();
        }
        if details.is_empty() {
            notes.push(format!("「{}」没有需要修改的内容", old.name));
            continue;
        }
        out.push(PlanItem {
            key: format!("update:{}", old.id),
            op: Op::Update,
            title: format!("修改{}「{}」", def.name, old.name),
            details,
            warnings,
            ready: true,
            asset: Some(after),
            link: None,
            ends: None,
            needs,
        });
    }
    out
}

fn retire_items(answer: &Value, scope: &Scope, notes: &mut Vec<String>) -> Vec<PlanItem> {
    let mut out = vec![];
    for item in items(answer, "retire") {
        let id = item.get("id").and_then(scalar).unwrap_or_default();
        let Some(old) = find_existing(scope, &id) else {
            notes.push(format!("要退役的「{id}」没有找到，已跳过"));
            continue;
        };
        if old.status == "retired" {
            notes.push(format!("「{}」已经是退役状态", old.name));
            continue;
        }
        let def = schema::kind_def(&old.kind).expect("validated kind");
        let mut after = old.clone();
        after.status = "retired".into();
        let reason = item.get("reason").and_then(scalar);
        out.push(PlanItem {
            key: format!("retire:{}", old.id),
            op: Op::Retire,
            title: format!("退役{}「{}」", def.name, old.name),
            details: reason.into_iter().map(|r| format!("原因：{r}")).collect(),
            warnings: vec![],
            ready: true,
            asset: Some(after),
            link: None,
            ends: None,
            needs: vec![],
        });
    }
    out
}

fn open_use<'a>(s: &'a Snapshot, asset: &str) -> Vec<&'a Link> {
    s.links
        .iter()
        .filter(|l| l.kind == "uses" && l.to == asset && l.attrs.get("ends_on").is_none_or(|e| e.is_empty()))
        .collect()
}

fn relate_items(answer: &Value, scope: &Scope, today: &str, notes: &mut Vec<String>) -> Vec<PlanItem> {
    let mut out = vec![];
    for item in items(answer, "relate") {
        let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
        let Some(def) = schema::relation_def(kind) else {
            notes.push(format!("关系类型「{kind}」不受支持，已跳过"));
            continue;
        };
        let raw_from = item.get("from").and_then(scalar).unwrap_or_default();
        let raw_to = item.get("to").and_then(scalar).unwrap_or_default();
        let ends = |a: &str, b: &str| Some((scope.resolve(&def.from, a)?, scope.resolve(&def.to, b)?));
        // Accept the two ends in either order when only one order fits.
        let Some(((from, need_a), (to, need_b))) = ends(&raw_from, &raw_to).or_else(|| ends(&raw_to, &raw_from)) else {
            notes.push(format!("「{raw_from}」{}「{raw_to}」两端找不到或类型不符，已跳过", def.name));
            continue;
        };
        let mut warnings = vec![];
        let mut needs: Vec<String> = need_a.into_iter().chain(need_b).collect();
        let mut attrs = clean_map(&def.attrs, item.get("attrs").and_then(Value::as_object), scope, &mut warnings, &mut needs);
        for f in &def.attrs {
            let default = match f.default_value {
                Some("$today") => Some(today.to_string()),
                Some(v) if !v.starts_with('$') => Some(v.to_string()),
                _ => None,
            };
            if let Some(d) = default {
                attrs.entry(f.key.to_string()).or_insert(d);
            }
        }
        let snapshot = scope.snapshot;
        if def.relation != "uses" && def.relation != "related"
            && snapshot.links.iter().any(|l| l.kind == def.relation && l.from == from && l.to == to)
        {
            notes.push(format!("{} {} {} 已经存在", scope.name(&from), def.name, scope.name(&to)));
            continue;
        }
        let mut ended = None;
        let mut details: Vec<String> = def
            .attrs
            .iter()
            .filter_map(|f| attrs.get(f.key).map(|v| format!("{}：{}", label(f), shown(f, v, scope))))
            .collect();
        if def.relation == "uses" {
            let start = attrs.get("starts_on").cloned().unwrap_or_else(|| today.into());
            let current = open_use(snapshot, &to);
            if current.iter().any(|l| l.from == from) {
                notes.push(format!("{} 已经在使用 {}", scope.name(&from), scope.name(&to)));
                continue;
            }
            let shared = attrs.get("usage_role").is_some_and(|r| r == "shared");
            if let Some(old) = current.iter().find(|l| !(shared && l.attrs.get("usage_role").is_some_and(|r| r == "shared"))) {
                if old.attrs.get("starts_on").is_some_and(|s| s.as_str() >= start.as_str()) {
                    warnings.push(format!("开始日期须晚于 {} 的使用开始日", scope.name(&old.from)));
                }
                details.push(format!("交接：{} 的使用在 {start} 结束，历史保留", scope.name(&old.from)));
                ended = Some(old.id.clone());
            }
        }
        if def.relation == "related" && !attrs.contains_key("note") {
            warnings.push("其他关联需要写明是什么关系".into());
        }
        let gaps = missing(&def.attrs, &attrs);
        if !gaps.is_empty() {
            warnings.push(format!("缺少：{}", gaps.join("、")));
        }
        let ready = warnings.iter().all(|w| !w.starts_with("开始日期") && !w.starts_with("缺少") && !w.starts_with("其他关联"));
        out.push(PlanItem {
            key: format!("relate:{}", out.len()),
            op: Op::Relate,
            title: format!("{} {} {}", scope.name(&from), def.name, scope.name(&to)),
            details,
            warnings,
            ready,
            asset: None,
            link: Some(Link { id: uuid::Uuid::new_v4().to_string(), kind: def.relation.into(), from, to, attrs }),
            ends: ended,
            needs,
        });
    }
    out
}

fn questions(answer: &Value) -> Vec<Question> {
    items(answer, "questions")
        .into_iter()
        .filter_map(|q| {
            let text = q.get("text").and_then(scalar)?;
            let options = q
                .get("options")
                .and_then(Value::as_array)
                .map(|o| o.iter().filter_map(scalar).take(MAX_OPTIONS).collect())
                .unwrap_or_default();
            Some(Question { text, options })
        })
        .take(MAX_QUESTIONS)
        .collect()
}

pub fn build(answer: &Value, s: &Snapshot, evidence: &str, model: &str, today: &str) -> Plan {
    let mut notes: Vec<String> = answer.get("notes").and_then(scalar).into_iter().collect();
    let mut scope = Scope {
        snapshot: s,
        existing: s.assets.iter().map(|a| (a.id.as_str(), a)).collect(),
        created: HashMap::new(),
        names: s.assets.iter().map(|a| (a.id.clone(), a.name.clone())).collect(),
    };
    let created = create_items(answer, &mut scope, evidence, &mut notes);
    let mut plan_items: Vec<PlanItem> = created.into_iter().map(|(_, i)| i).collect();
    plan_items.extend(update_items(answer, &scope, &mut notes));
    plan_items.extend(relate_items(answer, &scope, today, &mut notes));
    plan_items.extend(retire_items(answer, &scope, &mut notes));
    let questions = questions(answer);
    if plan_items.is_empty() && questions.is_empty() && notes.is_empty() {
        notes.push("没有识别出需要记录的内容".into());
    }
    Plan { items: plan_items, questions, notes, model: model.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ledger() -> Snapshot {
        crate::ai::extract::tests::ledger()
    }
    fn plan(answer: Value) -> Plan {
        build(&answer, &ledger(), "AI · test", "m", "2026-11-05")
    }

    #[test]
    fn creates_resolve_refs_and_drop_unsafe_values() {
        let p = plan(json!({
            "create": [
                {"temp_id": "a1", "kind": "account", "name": "Google 个人",
                 "fields": {"provider": "Google", "owner_id": "我", "secret_ref": "hunter2", "color": "red"}},
                {"temp_id": "s1", "kind": "subscription", "name": "Google One",
                 "fields": {"account_id": "new:a1", "billing_period": "每年", "price": 99, "currency": "cny", "expires_on": "2027-02-30"}},
                {"kind": "spaceship", "name": "?"},
                {"temp_id": "sw", "kind": "software", "name": "Raycast", "fields": {"source": "app"}}
            ]
        }));
        assert_eq!(p.items.len(), 3);
        assert!(p.notes.iter().any(|n| n.contains("spaceship")));
        let account = p.items[0].asset.as_ref().unwrap();
        assert_eq!(account.fields["owner_id"], "me");
        assert!(!account.fields.contains_key("secret_ref") && !account.fields.contains_key("color"));
        let sub = &p.items[1];
        let f = &sub.asset.as_ref().unwrap().fields;
        assert_eq!(f["account_id"], account.id);
        assert_eq!((f["billing_period"].as_str(), f["price"].as_str(), f["currency"].as_str()), ("year", "99", "CNY"));
        assert!(!f.contains_key("expires_on"));
        assert_eq!(sub.needs, vec![p.items[0].key.clone()]);
        assert!(sub.details.iter().any(|d| d == "付费账号：Google 个人"));
        let software = &p.items[2];
        assert!(!software.ready && software.asset.as_ref().unwrap().fields["tracked"] == "yes");
    }

    #[test]
    fn handover_ends_the_current_use_automatically() {
        let p = plan(json!({"relate": [{"type": "uses", "from": "孩子", "to": "mac", "attrs": {"usage_role": "主力"}}]}));
        let item = &p.items[0];
        let link = item.link.as_ref().unwrap();
        assert_eq!((link.from.as_str(), link.to.as_str()), ("kid", "mac"));
        assert_eq!((link.attrs["usage_role"].as_str(), link.attrs["starts_on"].as_str()), ("primary", "2026-11-05"));
        assert_eq!(item.ends.as_deref(), Some("u1"));
        assert!(item.ready && item.details.iter().any(|d| d.contains("我 的使用在 2026-11-05 结束")));
        // Reversed ends are accepted; the same person again is not a new use.
        let again = plan(json!({"relate": [{"type": "uses", "from": "mac", "to": "me"}]}));
        assert!(again.items.is_empty() && again.notes.iter().any(|n| n.contains("已经在使用")));
    }

    #[test]
    fn updates_show_changes_and_retire_marks_status() {
        let p = plan(json!({
            "update": [{"id": "mac", "fields": {"location": "家里", "device_kind": "laptop"}}],
            "retire": [{"id": "MacBook-A", "reason": "换了 M4"}],
            "questions": [{"text": "M4 谁在用？", "options": ["我", "孩子"]}]
        }));
        let update = &p.items[0];
        assert_eq!(update.op, Op::Update);
        assert_eq!(update.details, vec!["所在地：（空） → 家里"]);
        assert_eq!(update.asset.as_ref().unwrap().fields["location"], "家里");
        let retire = &p.items[1];
        assert_eq!((retire.op, retire.asset.as_ref().unwrap().status.as_str()), (Op::Retire, "retired"));
        assert_eq!(p.questions[0].options, vec!["我", "孩子"]);
        assert!(plan(json!({"update": [{"id": "mac", "fields": {"device_kind": "laptop"}}]})).items.is_empty());
    }
}
