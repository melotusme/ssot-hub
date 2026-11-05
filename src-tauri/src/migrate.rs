//! Upgrade snapshots v1–v3 (19 kinds, free-text links) to v4 (10 kinds, typed relations).
//! Works on raw JSON so old files load even though the link shape changed. IDs are kept, so
//! every existing reference stays valid; old files on disk are never rewritten here.
use crate::validate::SNAPSHOT_VERSION;
use serde_json::{Map, Value, json};

type Result<T> = std::result::Result<T, String>;
type Fields = Map<String, Value>;

/// Kinds that became a variant of another kind: (old kind, new kind, kind field, value).
const MERGED: &[(&str, &str, &str, &str)] = &[
    ("phone", "account", "account_kind", "phone"),
    ("esim", "subscription", "category", "telecom"),
    ("domain", "service", "service_kind", "domain"),
    ("server", "service", "service_kind", "server"),
    ("agent", "service", "service_kind", "agent"),
    ("network", "service", "service_kind", "network"),
];
/// Keys carried from a former record kind into the notes of the new relation.
const NOTE_KEYS: &[&str] = &["notes", "review_note"];

fn text(fields: &Fields, key: &str) -> Option<String> {
    fields.get(key).and_then(Value::as_str).filter(|v| !v.is_empty()).map(String::from)
}

fn take(fields: &mut Fields, key: &str) -> Option<String> {
    fields.remove(key).and_then(|v| v.as_str().map(String::from)).filter(|v| !v.is_empty())
}

fn append_note(fields: &mut Fields, line: String) {
    let next = match text(fields, "notes") {
        Some(old) => format!("{old}\n{line}"),
        None => line,
    };
    fields.insert("notes".into(), json!(next));
}

fn note_from(fields: &Fields) -> Option<String> {
    let parts: Vec<String> = NOTE_KEYS.iter().filter_map(|k| text(fields, k)).collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn attrs(fields: &mut Fields, keys: &[&str]) -> Fields {
    let mut out = Map::new();
    for key in keys {
        if let Some(v) = take(fields, key) {
            out.insert((*key).into(), json!(v));
        }
    }
    if let Some(note) = note_from(fields) {
        out.insert("note".into(), json!(note));
    }
    out
}

fn link(id: &Value, kind: &str, from: Option<String>, to: Option<String>, attrs: Fields) -> Option<Value> {
    Some(json!({"id": id, "type": kind, "from": from?, "to": to?, "attrs": attrs}))
}

fn next_day(date: &str) -> Option<String> {
    let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    Some((d + chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
}

/// A former record kind becomes a relation; returns None for ordinary assets.
fn as_relation(asset: &Value) -> Option<Option<Value>> {
    let kind = asset.get("kind")?.as_str()?;
    let id = asset.get("id")?;
    let mut fields = asset.get("fields")?.as_object()?.clone();
    let retired = asset.get("status").and_then(Value::as_str) == Some("retired");
    Some(match kind {
        "assignment" => {
            let from = take(&mut fields, "person_id");
            let to = take(&mut fields, "asset_id");
            let mut a = attrs(&mut fields, &["usage_role", "starts_on", "ends_on", "location"]);
            // A retired record without an end date is closed the day after it started.
            if retired && !a.contains_key("ends_on") {
                if let Some(end) = a.get("starts_on").and_then(Value::as_str).and_then(next_day) {
                    a.insert("ends_on".into(), json!(end));
                }
                let note = "迁移：原使用记录已退役，结束日期未知";
                let merged = a.get("note").and_then(Value::as_str).map_or(note.to_string(), |n| format!("{n}\n{note}"));
                a.insert("note".into(), json!(merged));
            }
            link(id, "uses", from, to, a)
        }
        "copy" => {
            let from = take(&mut fields, "resource_id");
            let to = take(&mut fields, "holder_id");
            let a = attrs(&mut fields, &["path", "copy_role", "environment_id", "content_state", "checksum"]);
            link(id, "stored_on", from, to, a)
        }
        "connection" => {
            let to = take(&mut fields, "network_id");
            let from = take(&mut fields, "node_id");
            let a = attrs(
                &mut fields,
                &["software_id", "enabled_state", "node_address", "advertised_routes", "endpoint", "probe_state", "probe_at"],
            );
            link(id, "joins", from, to, a)
        }
        _ => return None,
    })
}

fn upgrade_asset(asset: &mut Value) {
    let Some(obj) = asset.as_object_mut() else { return };
    let kind = obj.get("kind").and_then(Value::as_str).unwrap_or_default().to_string();
    let mut fields = obj.remove("fields").and_then(|f| f.as_object().cloned()).unwrap_or_default();
    let mut new_kind = kind.clone();
    if kind == "storage" {
        if let Some(k) = take(&mut fields, "storage_kind") {
            fields.insert("device_kind".into(), json!(k));
        }
        if let Some(parent) = take(&mut fields, "device_id") {
            fields.insert("parent_id".into(), json!(parent));
        }
        new_kind = "device".into();
    } else if let Some((_, merged, key, value)) = MERGED.iter().find(|(old, ..)| *old == kind) {
        fields.insert((*key).into(), json!(value));
        if kind == "phone"
            && let Some(owner) = take(&mut fields, "owner")
        {
            append_note(&mut fields, format!("归属：{owner}"));
        }
        new_kind = (*merged).into();
    } else if kind == "account" {
        fields.entry("account_kind").or_insert_with(|| json!("identity"));
    }
    if kind == "software" && text(&fields, "verification").as_deref() != Some("observed") {
        // Software someone entered by hand is software they care about.
        fields.insert("tracked".into(), json!("yes"));
    }
    obj.insert("kind".into(), json!(new_kind));
    obj.insert("fields".into(), Value::Object(fields));
}

/// Old free-text links become typed relations when the wording and both ends fit.
fn upgrade_link(l: &Value, kinds: &Map<String, Value>) -> Option<Value> {
    let id = l.get("id")?;
    let from = l.get("from")?.as_str()?.to_string();
    let to = l.get("to")?.as_str()?.to_string();
    let words = l.get("relation").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let kind_of = |x: &str| kinds.get(x).and_then(Value::as_str).unwrap_or_default().to_string();
    let (fk, tk) = (kind_of(&from), kind_of(&to));
    if fk.is_empty() || tk.is_empty() {
        return None;
    }
    let typed = |relation: &str, attrs: Fields| link(id, relation, Some(from.clone()), Some(to.clone()), attrs);
    let fits = |relation: &str| {
        crate::schema::relation_def(relation)
            .is_some_and(|d| d.from.contains(&fk.as_str()) && d.to.contains(&tk.as_str()))
    };
    if words == "登录于" && fits("logged_in") {
        return typed("logged_in", Map::new());
    }
    if words.starts_with("恢复") && fits("recovery") {
        return typed("recovery", Map::new());
    }
    if let Some(path) = words.strip_prefix("使用路径：").or_else(|| words.strip_prefix("使用路径:"))
        && fits("config_path")
    {
        let mut a = Map::new();
        a.insert("path".into(), json!(path.trim()));
        return typed("config_path", a);
    }
    let mut a = Map::new();
    a.insert("note".into(), json!(if words.is_empty() { "关联".into() } else { words }));
    typed("related", a)
}

pub fn upgrade(mut v: Value) -> Result<Value> {
    let version = v.get("version").and_then(Value::as_u64).ok_or("快照缺少版本号")?;
    if version == u64::from(SNAPSHOT_VERSION) {
        return Ok(v);
    }
    if !(1..=3).contains(&version) {
        return Err(format!("不支持的快照版本：{version}"));
    }
    let obj = v.as_object_mut().ok_or("快照不是对象")?;
    let old_assets = obj.remove("assets").and_then(|a| a.as_array().cloned()).ok_or("快照缺少资产列表")?;
    let old_links = obj.remove("links").and_then(|a| a.as_array().cloned()).unwrap_or_default();
    let mut assets = Vec::new();
    let mut links = Vec::new();
    for mut a in old_assets {
        match as_relation(&a) {
            Some(Some(l)) => links.push(l),
            // A former record with a missing end is dropped rather than kept half-formed.
            Some(None) => {}
            None => {
                upgrade_asset(&mut a);
                assets.push(a);
            }
        }
    }
    let kinds: Map<String, Value> = assets
        .iter()
        .filter_map(|a| Some((a.get("id")?.as_str()?.to_string(), a.get("kind")?.clone())))
        .collect();
    links.extend(old_links.iter().filter_map(|l| upgrade_link(l, &kinds)));
    obj.insert("assets".into(), Value::Array(assets));
    obj.insert("links".into(), Value::Array(links));
    obj.insert("version".into(), json!(SNAPSHOT_VERSION));
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v3() -> Value {
        json!({
            "version": 3, "revision": 7, "events": [],
            "assets": [
                {"id": "me", "kind": "person", "name": "我", "status": "active", "fields": {"person_kind": "self"}},
                {"id": "kid", "kind": "person", "name": "孩子", "status": "active", "fields": {}},
                {"id": "mac", "kind": "device", "name": "Mac", "status": "active", "fields": {}},
                {"id": "ssd", "kind": "storage", "name": "SSD", "status": "active", "fields": {"storage_kind": "ssd", "device_id": "mac", "capacity": "2T"}},
                {"id": "osx", "kind": "environment", "name": "macOS", "status": "active", "fields": {"device_id": "mac", "storage_id": "ssd"}},
                {"id": "num", "kind": "phone", "name": "主号", "status": "active", "fields": {"number": "+86 1", "owner": "我"}},
                {"id": "gg", "kind": "account", "name": "Google", "status": "active", "fields": {}},
                {"id": "esim", "kind": "esim", "name": "旅行 eSIM", "status": "active", "fields": {"plan": "10G", "device_id": "mac", "phone_id": "num"}},
                {"id": "vps", "kind": "server", "name": "VPS", "status": "active", "fields": {"region": "东京"}},
                {"id": "dom", "kind": "domain", "name": "example.com", "status": "active", "fields": {"server_id": "vps"}},
                {"id": "zt", "kind": "network", "name": "ZeroTier", "status": "active", "fields": {"technology": "zerotier"}},
                {"id": "game", "kind": "resource", "name": "游戏", "status": "active", "fields": {}},
                {"id": "cfg", "kind": "config", "name": "编辑器配置", "status": "active", "fields": {}},
                {"id": "a1", "kind": "assignment", "name": "Mac 给我", "status": "active",
                 "fields": {"asset_id": "mac", "person_id": "me", "usage_role": "primary", "starts_on": "2025-01-01", "ends_on": "2026-01-01", "notes": "旧"}},
                {"id": "a2", "kind": "assignment", "name": "Mac 给孩子", "status": "active",
                 "fields": {"asset_id": "mac", "person_id": "kid", "usage_role": "backup", "starts_on": "2026-01-01"}},
                {"id": "c1", "kind": "copy", "name": "游戏在 SSD", "status": "active",
                 "fields": {"resource_id": "game", "holder_id": "ssd", "path": "/Games", "copy_role": "backup"}},
                {"id": "n1", "kind": "connection", "name": "Mac 入网", "status": "active",
                 "fields": {"network_id": "zt", "node_id": "mac", "node_address": "10.0.0.2"}}
            ],
            "links": [
                {"id": "l1", "from": "gg", "to": "mac", "relation": "登录于"},
                {"id": "l2", "from": "cfg", "to": "osx", "relation": "使用路径：~/.config/editor"},
                {"id": "l3", "from": "gg", "to": "num", "relation": "恢复号码"},
                {"id": "l4", "from": "game", "to": "gg", "relation": "朋友借的"}
            ]
        })
    }

    #[test]
    fn upgrades_every_old_kind_and_validates() {
        let up = upgrade(v3()).unwrap();
        let s: crate::store::Snapshot = serde_json::from_value(up).unwrap();
        crate::validate::validate(&s).unwrap();
        assert_eq!(s.version, 4);
        assert_eq!(s.revision, 7);
        let a = |id: &str| s.assets.iter().find(|a| a.id == id).unwrap();
        assert_eq!(a("ssd").kind, "device");
        assert_eq!(a("ssd").fields["device_kind"], "ssd");
        assert_eq!(a("ssd").fields["parent_id"], "mac");
        assert_eq!(a("num").kind, "account");
        assert!(a("num").fields["notes"].contains("归属：我"));
        assert_eq!(a("esim").fields["category"], "telecom");
        assert_eq!(a("dom").kind, "service");
        assert_eq!(a("dom").fields["server_id"], "vps");
        assert_eq!(a("zt").fields["service_kind"], "network");
        assert!(s.assets.iter().all(|a| !["assignment", "copy", "connection"].contains(&a.kind.as_str())));
        let l = |id: &str| s.links.iter().find(|l| l.id == id).unwrap();
        assert_eq!((l("a1").kind.as_str(), l("a1").from.as_str(), l("a1").to.as_str()), ("uses", "me", "mac"));
        assert_eq!(l("a1").attrs["note"], "旧");
        assert_eq!(l("a2").attrs["usage_role"], "backup");
        assert_eq!(l("c1").kind, "stored_on");
        assert_eq!(l("c1").attrs["path"], "/Games");
        assert_eq!((l("n1").kind.as_str(), l("n1").from.as_str()), ("joins", "mac"));
        assert_eq!(l("l1").kind, "logged_in");
        assert_eq!(l("l2").attrs["path"], "~/.config/editor");
        assert_eq!(l("l3").kind, "recovery");
        assert_eq!((l("l4").kind.as_str(), l("l4").attrs["note"].as_str()), ("related", "朋友借的"));
    }

    #[test]
    fn retired_open_assignment_is_closed_and_v4_passes_through() {
        let mut old = v3();
        let a2 = &mut old["assets"].as_array_mut().unwrap()[14];
        a2["status"] = json!("retired");
        let up = upgrade(old).unwrap();
        let a2 = up["links"].as_array().unwrap().iter().find(|l| l["id"] == "a2").unwrap();
        assert_eq!(a2["attrs"]["ends_on"], "2026-01-02");
        assert!(a2["attrs"]["note"].as_str().unwrap().contains("已退役"));
        assert_eq!(upgrade(up.clone()).unwrap(), up);
        assert!(upgrade(json!({"version": 9})).is_err());
    }

    /// Reads the machine's real ledgers and backups (copied to a scratch folder) without writing.
    /// Run with `SSOT_MIGRATE_DIR=<dir> cargo test real_files -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_files_upgrade_cleanly() {
        let dir = std::env::var("SSOT_MIGRATE_DIR").unwrap();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let s = crate::store::parse(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            println!("{}: v4 ok, {} assets, {} links", path.display(), s.assets.len(), s.links.len());
        }
    }
}
