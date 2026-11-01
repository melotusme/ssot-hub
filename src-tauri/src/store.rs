use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
const KINDS: &[&str] = &[
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
];
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub fields: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    pub id: String,
    pub from: String,
    pub to: String,
    pub relation: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub id: String,
    pub at: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    pub revision: u64,
    pub assets: Vec<Asset>,
    pub links: Vec<Link>,
    pub events: Vec<Event>,
}
#[derive(Serialize)]
pub struct DeletePlan {
    pub revision: u64,
    pub asset: Asset,
    pub blockers: Vec<String>,
}

pub fn now() -> String {
    Utc::now().to_rfc3339()
}
pub fn uid() -> String {
    Uuid::new_v4().to_string()
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn actor() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "local-desktop".into())
        })
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(error)?;
    }
    if !path.exists() {
        private_write(path, b"")?;
    }
    let c = Connection::open(path).map_err(error)?;
    c.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(error)?;
    c.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);",
    )
    .map_err(error)?;
    let empty = Snapshot {
        version: 2,
        revision: 0,
        assets: vec![],
        links: vec![],
        events: vec![],
    };
    c.execute(
        "INSERT OR IGNORE INTO state VALUES(1,?1)",
        [serde_json::to_string(&empty).map_err(error)?],
    )
    .map_err(error)?;
    Ok(c)
}
pub fn read(c: &Connection) -> Result<Snapshot> {
    let s: String = c
        .query_row("SELECT body FROM state WHERE id=1", [], |r| r.get(0))
        .map_err(error)?;
    let mut snapshot: Snapshot = serde_json::from_str(&s).map_err(error)?;
    validate(&snapshot)?;
    snapshot.version = 2;
    Ok(snapshot)
}
fn check_revision(s: &Snapshot, revision: u64) -> Result<()> {
    if s.revision != revision {
        return Err("数据已更新，请刷新后重试。".into());
    }
    Ok(())
}
fn event(s: &mut Snapshot, action: &str, detail: String) {
    s.events.push(Event {
        id: uid(),
        at: now(),
        actor: actor(),
        action: action.into(),
        detail,
    });
}
fn persist(c: &Connection, s: &mut Snapshot) -> Result<()> {
    s.revision += 1;
    c.execute(
        "UPDATE state SET body=?1 WHERE id=1",
        [serde_json::to_string(s).map_err(error)?],
    )
    .map_err(error)?;
    Ok(())
}
fn allowed(kind: &str) -> Vec<&str> {
    let mut keys = vec!["notes", "purpose", "secret_ref", "expires_on"];
    keys.extend(match kind {
        "device" => vec![
            "platform",
            "device_kind",
            "model",
            "owner_id",
            "location",
            "serial",
            "mac",
            "ip",
            "observed_at",
            "evidence",
            "purchased_on",
        ],
        "environment" => vec![
            "os",
            "version",
            "device_id",
            "host_id",
            "role",
            "storage_id",
            "partition",
            "mac",
            "ip",
            "observed_at",
            "evidence",
        ],
        "software" => vec![
            "environment_id",
            "source",
            "manager",
            "package_kind",
            "version",
            "commit",
            "branch",
            "path",
            "repository",
            "subscription_id",
            "config_id",
            "license_ref",
        ],
        "config" => vec!["authority", "authority_ref", "forbidden_sync"],
        "account" => vec!["provider", "login_hint", "email", "tags", "owner_id"],
        "phone" => vec!["number", "carrier", "country", "owner"],
        "esim" => vec![
            "carrier",
            "channel",
            "plan",
            "country",
            "device_id",
            "account_id",
            "phone_id",
        ],
        "subscription" => vec![
            "category",
            "provider",
            "owner_id",
            "account_id",
            "channel",
            "price",
            "currency",
            "billing_period",
            "exchange_rate",
            "base_currency",
            "rate_date",
            "auto_renew",
        ],
        "person" => vec!["person_kind", "relationship"],
        "storage" => vec![
            "storage_kind",
            "model",
            "serial",
            "capacity",
            "interface",
            "device_id",
            "owner_id",
            "location",
            "health",
            "backup_ref",
        ],
        "domain" => vec![
            "hostname",
            "registrar",
            "account_id",
            "server_id",
            "subscription_id",
            "dns_provider",
        ],
        "server" => vec![
            "provider",
            "region",
            "ip",
            "spec",
            "os",
            "account_id",
            "subscription_id",
            "owner_id",
        ],
        "agent" => vec![
            "provider",
            "environment_id",
            "server_id",
            "account_id",
            "subscription_id",
            "config_id",
            "endpoint",
        ],
        "course" => vec![
            "person_id",
            "institution",
            "subject",
            "teacher",
            "schedule",
            "location",
            "starts_on",
            "lessons_total",
            "lessons_used",
            "price",
            "currency",
            "account_id",
        ],
        "assignment" => vec![
            "asset_id",
            "person_id",
            "usage_role",
            "starts_on",
            "ends_on",
            "location",
        ],
        _ => vec![],
    });
    keys
}
fn ref_kind(key: &str) -> Option<&'static str> {
    match key {
        "device_id" => Some("device"),
        "host_id" | "environment_id" => Some("environment"),
        "account_id" => Some("account"),
        "phone_id" => Some("phone"),
        "subscription_id" => Some("subscription"),
        "config_id" => Some("config"),
        "owner_id" | "person_id" => Some("person"),
        "storage_id" => Some("storage"),
        "server_id" => Some("server"),
        "asset_id" => Some("assignable"),
        _ => None,
    }
}
pub fn validate(s: &Snapshot) -> Result<()> {
    if ![1, 2].contains(&s.version) {
        return Err("不支持的快照版本".into());
    }
    let mut ids = HashSet::new();
    for a in &s.assets {
        if a.id.is_empty()
            || !ids.insert(a.id.clone())
            || !KINDS.contains(&a.kind.as_str())
            || a.name.trim().is_empty()
        {
            return Err("资产 ID、名称或类型无效/重复".into());
        }
        if a.name.len() > 500 || !["active", "retired"].contains(&a.status.as_str()) {
            return Err("名称过长或资产状态无效".into());
        }
        let keys = allowed(&a.kind);
        for (k, v) in &a.fields {
            if !keys.contains(&k.as_str()) {
                return Err(format!("不支持的字段：{k}（请勿录入密码或令牌）"));
            }
            if v.len() > 20000 {
                return Err("字段内容过长".into());
            }
            if v.is_empty() {
                continue;
            }
            if ["secret_ref", "license_ref"].contains(&k.as_str())
                && !["op://", "1password://", "vault://", "keychain://", "bw://"]
                    .iter()
                    .any(|p| v.starts_with(p))
            {
                return Err("凭据仅允许保险库引用".into());
            }
            if [
                "expires_on",
                "rate_date",
                "starts_on",
                "ends_on",
                "purchased_on",
            ]
            .contains(&k.as_str())
                && chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d").is_err()
            {
                return Err("日期应为有效的 YYYY-MM-DD".into());
            }
            if let Some(kind) = ref_kind(k)
                && (a.id == *v
                    || !s.assets.iter().any(|t| {
                        t.id == *v
                            && (t.kind == kind
                                || kind == "assignable"
                                    && ["device", "storage", "server"].contains(&t.kind.as_str()))
                    }))
            {
                return Err(format!("{k} 引用无效"));
            }
            if ["price", "exchange_rate"].contains(&k.as_str()) {
                let n = v
                    .parse::<rust_decimal::Decimal>()
                    .map_err(|_| "金额与汇率必须是十进制数字")?;
                if n.is_sign_negative() || (k == "exchange_rate" && n.is_zero()) {
                    return Err("金额不可为负，汇率必须大于零".into());
                }
            }
            if ["currency", "base_currency"].contains(&k.as_str())
                && (v.len() != 3 || !v.bytes().all(|c| c.is_ascii_uppercase()))
            {
                return Err("币种应为三位大写代码，如 CNY".into());
            }
            if k == "auto_renew" && !["yes", "no"].contains(&v.as_str()) {
                return Err("自动续费状态无效".into());
            }
            if k == "source" && !["brew", "git", "app", "other"].contains(&v.as_str()) {
                return Err("软件来源无效".into());
            }
            if k == "authority" && !["git", "dav", "vendor", "local"].contains(&v.as_str()) {
                return Err("配置权威类型无效".into());
            }
            if k == "billing_period" && !["month", "year", "once"].contains(&v.as_str()) {
                return Err("计费周期无效".into());
            }
            if ["repository", "authority_ref", "endpoint", "backup_ref"].contains(&k.as_str())
                && (v.contains('@') && v.contains("://")
                    || v.contains("token=")
                    || v.contains("password="))
            {
                return Err("地址不能包含凭据".into());
            }
        }
        if a.kind == "software" && a.fields.get("environment_id").is_none_or(|v| v.is_empty()) {
            return Err("软件安装必须选择系统环境".into());
        }
        if a.kind == "course" {
            if a.fields.get("person_id").is_none_or(|v| v.is_empty()) {
                return Err("课程必须选择上课成员".into());
            }
            let number = |key: &str| -> Result<u32> {
                a.fields
                    .get(key)
                    .filter(|v| !v.is_empty())
                    .map(|v| v.parse::<u32>().map_err(|_| "课时必须是非负整数".into()))
                    .unwrap_or(Ok(0))
            };
            let used = number("lessons_used")?;
            let total = number("lessons_total")?;
            if used > total {
                return Err("已用课时不能超过购买课时".into());
            }
            if let (Some(start), Some(end)) =
                (a.fields.get("starts_on"), a.fields.get("expires_on"))
            {
                if !end.is_empty() && end < start {
                    return Err("课程到期不能早于开始".into());
                }
            }
        }
        if a.kind == "assignment" {
            for key in ["asset_id", "person_id", "starts_on", "usage_role"] {
                if a.fields.get(key).is_none_or(|v| v.is_empty()) {
                    return Err(format!("使用记录缺少 {key}"));
                }
            }
            if !["primary", "backup", "shared", "loan"].contains(&a.fields["usage_role"].as_str()) {
                return Err("使用角色无效".into());
            }
            if a.fields
                .get("ends_on")
                .is_some_and(|v| !v.is_empty() && v <= &a.fields["starts_on"])
            {
                return Err("使用结束日期必须晚于开始日期".into());
            }
            if a.status == "active" {
                for b in &s.assets {
                    if b.id == a.id
                        || b.kind != "assignment"
                        || b.status != "active"
                        || b.fields.get("asset_id") != a.fields.get("asset_id")
                    {
                        continue;
                    }
                    let a_end = a
                        .fields
                        .get("ends_on")
                        .filter(|v| !v.is_empty())
                        .map(String::as_str)
                        .unwrap_or("9999-12-31");
                    let b_end = b
                        .fields
                        .get("ends_on")
                        .filter(|v| !v.is_empty())
                        .map(String::as_str)
                        .unwrap_or("9999-12-31");
                    let b_start = b.fields.get("starts_on").map(String::as_str).unwrap_or("");
                    if a.fields["starts_on"].as_str() < b_end
                        && b_start < a_end
                        && (a.fields.get("person_id") == b.fields.get("person_id")
                            || a.fields["usage_role"] != "shared"
                            || b.fields.get("usage_role").is_none_or(|v| v != "shared"))
                    {
                        return Err(
                            "使用区间重叠：请交接或结束旧记录；多人同时使用须均为共用".into()
                        );
                    }
                }
            }
        }
        // A host chain cannot contain a cycle.
        let mut seen = HashSet::new();
        let mut cursor = Some(a);
        while let Some(node) = cursor {
            if !seen.insert(&node.id) {
                return Err("系统环境宿主关系存在循环".into());
            }
            cursor = node
                .fields
                .get("host_id")
                .and_then(|id| s.assets.iter().find(|t| t.id == *id));
        }
    }
    let mut triples = HashSet::new();
    for l in &s.links {
        if l.id.is_empty()
            || !ids.insert(l.id.clone())
            || l.from == l.to
            || l.relation.trim().is_empty()
            || !s.assets.iter().any(|a| a.id == l.from)
            || !s.assets.iter().any(|a| a.id == l.to)
            || !triples.insert((&l.from, &l.to, &l.relation))
        {
            return Err("关系端点、用途或 ID 无效/重复".into());
        }
    }
    let mut event_ids = HashSet::new();
    for e in &s.events {
        if e.id.is_empty() || !event_ids.insert(&e.id) {
            return Err("审计事件 ID 重复".into());
        }
    }
    Ok(())
}
pub fn save_asset(c: &mut Connection, a: Asset, revision: u64) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let before = s.assets.iter().find(|x| x.id == a.id).cloned();
    if before.as_ref().is_some_and(|old| old.kind != a.kind) {
        return Err("不能改变资产类型".into());
    }
    s.assets.retain(|x| x.id != a.id);
    s.assets.push(a.clone());
    s.assets.sort_by(|a, b| a.id.cmp(&b.id));
    validate(&s)?;
    event(
        &mut s,
        if before.is_some() { "update" } else { "create" },
        serde_json::json!({"before":before,"after":a}).to_string(),
    );
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}
/// End exactly one active interval and start its successor in one revision.
pub fn transfer(c: &mut Connection, id: &str, next: Asset, revision: u64) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    if next.kind != "assignment" || s.assets.iter().any(|a| a.id == next.id) {
        return Err("新使用记录无效".into());
    }
    let old = s
        .assets
        .iter_mut()
        .find(|a| a.id == id && a.kind == "assignment")
        .ok_or("使用记录不存在")?;
    if old.status != "active"
        || old.fields.get("ends_on").is_some_and(|v| !v.is_empty())
        || old.fields.get("asset_id") != next.fields.get("asset_id")
    {
        return Err("只能交接同一资产的持续使用记录".into());
    }
    let before = old.clone();
    old.fields.insert(
        "ends_on".into(),
        next.fields.get("starts_on").ok_or("缺少交接日期")?.clone(),
    );
    s.assets.push(next.clone());
    validate(&s)?;
    event(
        &mut s,
        "transfer",
        serde_json::json!({"before":before,"next":next}).to_string(),
    );
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}
pub fn save_link(c: &mut Connection, l: Link, revision: u64) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    if s.links.iter().any(|x| x.id == l.id) {
        return Err("关系 ID 已存在".into());
    }
    s.links.push(l.clone());
    validate(&s)?;
    event(&mut s, "link", serde_json::to_string(&l).map_err(error)?);
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}
pub fn remove_link(c: &mut Connection, id: &str, revision: u64) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let l = s
        .links
        .iter()
        .find(|l| l.id == id)
        .cloned()
        .ok_or("关系不存在")?;
    s.links.retain(|l| l.id != id);
    event(&mut s, "unlink", serde_json::to_string(&l).map_err(error)?);
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}
pub fn plan(s: &Snapshot, id: &str) -> Result<DeletePlan> {
    let asset = s
        .assets
        .iter()
        .find(|a| a.id == id)
        .cloned()
        .ok_or("资产不存在")?;
    let mut blockers = vec![];
    for a in &s.assets {
        for (k, v) in &a.fields {
            if ref_kind(k).is_some() && v == id {
                blockers.push(format!("{} · {}", a.name, k));
            }
        }
    }
    for l in &s.links {
        if l.from == id || l.to == id {
            blockers.push(format!("关系：{}", l.relation));
        }
    }
    Ok(DeletePlan {
        revision: s.revision,
        asset,
        blockers,
    })
}
pub fn private_write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options.open(path).map_err(error)?;
    f.write_all(bytes).map_err(error)?;
    f.sync_all().map_err(error)?;
    Ok(())
}
pub fn backup(s: &Snapshot, dir: &Path) -> Result<PathBuf> {
    fs::create_dir_all(dir).map_err(error)?;
    let p = dir.join(format!(
        "ssot-{}-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S"),
        uid()
    ));
    private_write(&p, &serde_json::to_vec_pretty(s).map_err(error)?)?;
    Ok(p)
}
pub fn delete(c: &mut Connection, id: &str, revision: u64, dir: &Path) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let p = plan(&s, id)?;
    if !p.blockers.is_empty() {
        return Err("仍有引用，请先处理关联关系".into());
    }
    backup(&s, dir)?;
    s.assets.retain(|a| a.id != id);
    event(
        &mut s,
        "delete",
        serde_json::to_string(&p.asset).map_err(error)?,
    );
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}
pub fn import_snapshot(
    c: &mut Connection,
    mut incoming: Snapshot,
    revision: u64,
) -> Result<Snapshot> {
    validate(&incoming)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let current = read(&tx)?;
    check_revision(&current, revision)?;
    if !current.assets.is_empty() || !current.links.is_empty() || !current.events.is_empty() {
        return Err("恢复仅允许空台账；请先切换到新的数据文件".into());
    }
    incoming.revision = current.revision;
    incoming.version = 2;
    event(
        &mut incoming,
        "restore",
        "从快照恢复（兼容版本 1 / 2）".into(),
    );
    persist(&tx, &mut incoming)?;
    tx.commit().map_err(error)?;
    Ok(incoming)
}
pub fn replace_snapshot(
    c: &mut Connection,
    mut incoming: Snapshot,
    revision: u64,
    dir: &Path,
) -> Result<Snapshot> {
    validate(&incoming)?;
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let current = read(&tx)?;
    check_revision(&current, revision)?;
    backup(&current, dir)?;
    incoming.version = 2;
    incoming.revision = current.revision;
    event(
        &mut incoming,
        "sync_download",
        "应用同步快照，旧台账已备份".into(),
    );
    persist(&tx, &mut incoming)?;
    tx.commit().map_err(error)?;
    Ok(incoming)
}
pub fn apply_batch(c: &mut Connection, assets: Vec<Asset>, revision: u64) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let before = s.assets.clone();
    for incoming in assets {
        if let Some(existing) = s.assets.iter_mut().find(|a| a.id == incoming.id) {
            if existing.kind != incoming.kind {
                return Err("导入 ID 与已有类型冲突".into());
            }
            // Importers only provide discovered fields; retain human notes and associations.
            existing.fields.extend(incoming.fields);
        } else {
            s.assets.push(incoming);
        }
    }
    validate(&s)?;
    let detail = serde_json::json!({"before": before, "after": s.assets}).to_string();
    event(&mut s, "scan_import", detail);
    persist(&tx, &mut s)?;
    tx.commit().map_err(error)?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE state(id INTEGER PRIMARY KEY, body TEXT);")
            .unwrap();
        let s = Snapshot {
            version: 1,
            revision: 0,
            assets: vec![],
            links: vec![],
            events: vec![],
        };
        c.execute(
            "INSERT INTO state VALUES(1,?1)",
            rusqlite::params![serde_json::to_string(&s).unwrap()],
        )
        .unwrap();
        c
    }
    fn asset(id: &str, kind: &str) -> Asset {
        Asset {
            id: id.into(),
            kind: kind.into(),
            name: id.into(),
            status: "active".into(),
            fields: BTreeMap::new(),
        }
    }
    #[test]
    fn persists_across_connections_and_failed_backup_keeps_record() {
        let dir = std::env::temp_dir().join(uid());
        let path = dir.join("workspace.sqlite3");
        let mut c = open(&path).unwrap();
        save_asset(&mut c, asset("persist", "device"), 0).unwrap();
        drop(c);
        let mut reopened = open(&path).unwrap();
        assert_eq!(read(&reopened).unwrap().assets[0].id, "persist");
        let blocked = dir.join("not-a-directory");
        fs::write(&blocked, b"file").unwrap();
        assert!(delete(&mut reopened, "persist", 1, &blocked).is_err());
        assert_eq!(read(&reopened).unwrap().revision, 1);
        assert_eq!(read(&reopened).unwrap().assets.len(), 1);
        drop(reopened);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn revision_and_rollback() {
        let mut c = db();
        save_asset(&mut c, asset("a", "account"), 0).unwrap();
        assert!(save_asset(&mut c, asset("b", "account"), 0).is_err());
        assert_eq!(read(&c).unwrap().assets.len(), 1);
        let mut a = asset("b", "account");
        a.fields.insert("password".into(), "bad".into());
        assert!(save_asset(&mut c, a, 1).is_err());
        assert_eq!(read(&c).unwrap().revision, 1);
    }
    #[test]
    fn refs_and_cleanup_backup() {
        let mut c = db();
        save_asset(&mut c, asset("a", "account"), 0).unwrap();
        let mut sub = asset("s", "subscription");
        sub.fields.insert("account_id".into(), "a".into());
        save_asset(&mut c, sub, 1).unwrap();
        assert_eq!(plan(&read(&c).unwrap(), "a").unwrap().blockers.len(), 1);
        let dir = std::env::temp_dir().join(uid());
        assert!(delete(&mut c, "a", 2, &dir).is_err());
        delete(&mut c, "s", 2, &dir).unwrap();
        let p = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        let snap: Snapshot = serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap();
        assert_eq!(snap.assets.len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn restore_and_import_preserves_manual_fields() {
        let mut c = db();
        let mut a = asset("a", "environment");
        a.fields.insert("notes".into(), "manual".into());
        save_asset(&mut c, a, 0).unwrap();
        let mut incoming = asset("a", "environment");
        incoming.fields.insert("version".into(), "2".into());
        let s = apply_batch(&mut c, vec![incoming], 1).unwrap();
        assert_eq!(s.assets[0].fields["notes"], "manual");
        let mut other = db();
        import_snapshot(&mut other, s.clone(), 0).unwrap();
        assert!(import_snapshot(&mut other, s, 1).is_err());
    }
    #[test]
    fn rejects_dangling_links_cycles_and_bad_money() {
        let mut c = db();
        assert!(
            save_link(
                &mut c,
                Link {
                    id: uid(),
                    from: "x".into(),
                    to: "y".into(),
                    relation: "uses".into()
                },
                0
            )
            .is_err()
        );
        let mut a = asset("a", "subscription");
        a.fields.insert("exchange_rate".into(), "0".into());
        assert!(save_asset(&mut c, a, 0).is_err());
        let mut s = read(&c).unwrap();
        let mut a = asset("a", "environment");
        let mut b = asset("b", "environment");
        a.fields.insert("host_id".into(), "b".into());
        b.fields.insert("host_id".into(), "a".into());
        s.assets = vec![a, b];
        assert!(validate(&s).is_err());
    }
    fn assignment(id: &str, person: &str, start: &str) -> Asset {
        let mut a = asset(id, "assignment");
        for (k, v) in [
            ("asset_id", "laptop"),
            ("person_id", person),
            ("starts_on", start),
            ("usage_role", "primary"),
        ] {
            a.fields.insert(k.into(), v.into());
        }
        a
    }
    #[test]
    fn transfer_is_atomic_preserves_history_and_rejects_stale_writes() {
        let mut c = db();
        let s = apply_batch(
            &mut c,
            vec![
                asset("me", "person"),
                asset("child", "person"),
                asset("laptop", "device"),
                assignment("old", "me", "2025-01-01"),
            ],
            0,
        )
        .unwrap();
        let next = assignment("new", "child", "2026-10-01");
        let s = transfer(&mut c, "old", next.clone(), s.revision).unwrap();
        assert_eq!(
            s.assets.iter().find(|a| a.id == "old").unwrap().fields["ends_on"],
            "2026-10-01"
        );
        assert_eq!(
            s.assets.iter().find(|a| a.id == "new").unwrap().fields["person_id"],
            "child"
        );
        assert_eq!(s.events.last().unwrap().action, "transfer");
        assert!(transfer(&mut c, "old", next, 1).is_err());
        assert_eq!(read(&c).unwrap().revision, s.revision);
        assert!(
            save_asset(
                &mut c,
                assignment("overlap", "me", "2026-11-01"),
                s.revision
            )
            .is_err()
        );
    }
    #[test]
    fn shared_use_course_counts_and_storage_references() {
        let mut c = db();
        let mut first = assignment("first", "me", "2025-01-01");
        first.fields.insert("usage_role".into(), "shared".into());
        let mut second = assignment("second", "child", "2026-01-01");
        second.fields.insert("usage_role".into(), "shared".into());
        let s = apply_batch(
            &mut c,
            vec![
                asset("me", "person"),
                asset("child", "person"),
                asset("laptop", "device"),
                first,
                second,
            ],
            0,
        )
        .unwrap();
        let mut course = asset("math", "course");
        for (k, v) in [
            ("person_id", "child"),
            ("lessons_total", "20"),
            ("lessons_used", "21"),
        ] {
            course.fields.insert(k.into(), v.into());
        }
        assert!(save_asset(&mut c, course.clone(), s.revision).is_err());
        course.fields.insert("lessons_used".into(), "2".into());
        let s = save_asset(&mut c, course, s.revision).unwrap();
        let mut disk = asset("disk", "storage");
        disk.fields.insert("device_id".into(), "laptop".into());
        let mut os = asset("linux", "environment");
        os.fields.insert("storage_id".into(), "disk".into());
        let s = apply_batch(&mut c, vec![disk, os], s.revision).unwrap();
        assert!(!plan(&s, "disk").unwrap().blockers.is_empty());
    }
    #[test]
    fn replacement_backs_up_and_failed_backup_never_replaces() {
        let mut c = db();
        let s = save_asset(&mut c, asset("real", "device"), 0).unwrap();
        let mut replacement = s.clone();
        replacement.assets = vec![asset("incoming", "person")];
        let dir = std::env::temp_dir().join(uid());
        std::fs::create_dir_all(&dir).unwrap();
        let invalid = dir.join("file");
        private_write(&invalid, b"x").unwrap();
        assert!(replace_snapshot(&mut c, replacement.clone(), s.revision, &invalid).is_err());
        assert_eq!(read(&c).unwrap().assets[0].id, "real");
        let s = replace_snapshot(&mut c, replacement, s.revision, &dir.join("backups")).unwrap();
        assert_eq!(s.assets[0].id, "incoming");
        let path = std::fs::read_dir(dir.join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let backup: Snapshot =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(backup.assets[0].id, "real");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
