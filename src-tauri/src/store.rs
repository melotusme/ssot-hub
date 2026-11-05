use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;


type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub status: String,
    pub fields: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Link {
    pub id: String,
    /// A relation type from the schema (`uses`, `logged_in`, …).
    #[serde(rename = "type")]
    pub kind: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub attrs: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub id: String,
    pub at: String,
    pub actor: String,
    pub action: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    pub revision: u64,
    pub assets: Vec<Asset>,
    pub links: Vec<Link>,
    pub events: Vec<Event>,
}
#[derive(Serialize, specta::Type)]
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
        version: crate::validate::SNAPSHOT_VERSION,
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
    parse(&s)
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
pub use crate::validate::validate;

/// Parse stored or imported JSON, upgrading older snapshot versions first.
pub fn parse(text: &str) -> Result<Snapshot> {
    let raw: serde_json::Value = serde_json::from_str(text).map_err(|_| "快照不是有效的 JSON")?;
    let snapshot: Snapshot = serde_json::from_value(crate::migrate::upgrade(raw)?).map_err(error)?;
    validate(&snapshot)?;
    Ok(snapshot)
}
pub fn save_asset(c: &mut Connection, mut a: Asset, revision: u64) -> Result<Snapshot> {
    // Entered by hand: the user vouches for it unless a source was already recorded.
    a.fields
        .entry("verification".into())
        .or_insert_with(|| "confirmed".into());
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
/// Hand an asset to someone else: end the open `uses` relation and start a new one the same day.
pub fn transfer_use(
    c: &mut Connection,
    id: &str,
    person_id: &str,
    starts_on: &str,
    usage_role: Option<String>,
    revision: u64,
) -> Result<Snapshot> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let old = s
        .links
        .iter_mut()
        .find(|l| l.id == id && l.kind == "uses")
        .ok_or("使用记录不存在")?;
    if old.attrs.get("ends_on").is_some_and(|v| !v.is_empty()) {
        return Err("这条使用记录已经结束，不能再交接".into());
    }
    let before = old.clone();
    old.attrs.insert("ends_on".into(), starts_on.into());
    let mut attrs = BTreeMap::from([
        (
            "usage_role".to_string(),
            usage_role.unwrap_or_else(|| before.attrs.get("usage_role").cloned().unwrap_or_else(|| "primary".into())),
        ),
        ("starts_on".to_string(), starts_on.to_string()),
    ]);
    if let Some(location) = before.attrs.get("location") {
        attrs.insert("location".into(), location.clone());
    }
    let next = Link {
        id: uid(),
        kind: "uses".into(),
        from: person_id.into(),
        to: before.to.clone(),
        attrs,
    };
    s.links.push(next.clone());
    validate(&s)?;
    event(
        &mut s,
        "transfer",
        serde_json::json!({"before": before, "next": next}).to_string(),
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
    // Saving an existing relation updates its attributes (e.g. an end date).
    let before = s.links.iter().find(|x| x.id == l.id).cloned();
    if before.as_ref().is_some_and(|b| b.kind != l.kind || b.from != l.from || b.to != l.to) {
        return Err("关系的类型和两端不能修改，请删除后重建".into());
    }
    s.links.retain(|x| x.id != l.id);
    s.links.push(l.clone());
    validate(&s)?;
    event(
        &mut s,
        if before.is_some() { "relink" } else { "link" },
        serde_json::json!({"before": before, "after": l}).to_string(),
    );
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
    Ok(DeletePlan {
        revision: s.revision,
        asset,
        blockers: crate::validate::references(s, id),
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

/// A confirmed set of changes: new assets, changed assets, new relations and uses to end.
#[derive(Debug, Default, Serialize, Deserialize, specta::Type)]
pub struct Changes {
    pub create: Vec<Asset>,
    pub update: Vec<Asset>,
    pub link: Vec<Link>,
    /// (open `uses` relation id, end date)
    pub end_uses: Vec<(String, String)>,
}

/// Apply `Changes` in one transaction; any invalid part refuses the whole set.
pub fn apply_changes(c: &mut Connection, changes: Changes, revision: u64, action: &str) -> Result<Snapshot> {
    if changes.create.is_empty() && changes.update.is_empty() && changes.link.is_empty() && changes.end_uses.is_empty() {
        return Err("没有选择要应用的操作".into());
    }
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut s = read(&tx)?;
    check_revision(&s, revision)?;
    let mut summary = vec![];
    for a in changes.create {
        if s.assets.iter().any(|x| x.id == a.id) {
            return Err("条目已存在，不能重复登记".into());
        }
        summary.push(format!("新建 {}", a.name));
        s.assets.push(a);
    }
    for a in changes.update {
        let old = s.assets.iter_mut().find(|x| x.id == a.id).ok_or("要修改的资产不存在")?;
        if old.kind != a.kind {
            return Err("不能改变资产类型".into());
        }
        summary.push(format!("修改 {}", a.name));
        *old = a;
    }
    for (id, ends_on) in changes.end_uses {
        let l = s
            .links
            .iter_mut()
            .find(|l| l.id == id && l.kind == "uses")
            .ok_or("要结束的使用记录不存在")?;
        if l.attrs.get("ends_on").is_some_and(|v| !v.is_empty()) {
            return Err("这条使用记录已经结束".into());
        }
        l.attrs.insert("ends_on".into(), ends_on);
    }
    for l in changes.link {
        if s.links.iter().any(|x| x.id == l.id) {
            return Err("关系已存在".into());
        }
        summary.push(format!("关系 {}", l.kind));
        s.links.push(l);
    }
    validate(&s)?;
    event(&mut s, action, serde_json::json!({ "applied": summary }).to_string());
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
                    kind: "uses".into(),
                    from: "x".into(),
                    to: "y".into(),
                    attrs: BTreeMap::new(),
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
    fn uses(id: &str, person: &str, start: &str) -> Link {
        Link {
            id: id.into(),
            kind: "uses".into(),
            from: person.into(),
            to: "laptop".into(),
            attrs: BTreeMap::from([
                ("starts_on".to_string(), start.to_string()),
                ("usage_role".to_string(), "primary".to_string()),
            ]),
        }
    }
    fn family(c: &mut Connection) -> Snapshot {
        apply_batch(
            c,
            vec![asset("me", "person"), asset("child", "person"), asset("laptop", "device")],
            0,
        )
        .unwrap()
    }
    fn with(mut a: Asset, fields: &[(&str, &str)]) -> Asset {
        for (k, v) in fields {
            a.fields.insert((*k).into(), (*v).into());
        }
        a
    }
    fn snapshot(assets: Vec<Asset>) -> Snapshot {
        Snapshot {
            version: 4,
            revision: 0,
            assets,
            links: vec![],
            events: vec![],
        }
    }
    #[test]
    fn schema_rules_cover_options_required_secrets_and_dates() {
        let me = asset("me", "person");
        assert!(validate(&snapshot(vec![me.clone()])).is_ok());
        let bad_option = with(asset("d", "device"), &[("device_kind", "toaster")]);
        assert!(validate(&snapshot(vec![bad_option])).unwrap_err().contains("选项"));
        let unknown = with(asset("d", "device"), &[("password", "x")]);
        assert!(validate(&snapshot(vec![unknown])).unwrap_err().contains("不支持的字段"));
        let missing = asset("c", "course");
        assert!(validate(&snapshot(vec![missing])).unwrap_err().contains("请填写"));
        let plain_secret = with(asset("a", "account"), &[("secret_ref", "hunter2")]);
        assert!(validate(&snapshot(vec![plain_secret])).unwrap_err().contains("保险库"));
        let bad_date = with(asset("d", "device"), &[("purchased_on", "2026-02-30")]);
        assert!(validate(&snapshot(vec![bad_date])).unwrap_err().contains("YYYY-MM-DD"));
        let wrong_kind = with(asset("d", "device"), &[("owner_id", "d2")]);
        let d2 = asset("d2", "device");
        assert!(validate(&snapshot(vec![wrong_kind, d2])).unwrap_err().contains("引用无效"));
        let mut zero = uses("z", "me", "2026-01-01");
        zero.attrs.insert("ends_on".into(), "2026-01-01".into());
        let mut s = snapshot(vec![me.clone(), asset("laptop", "device")]);
        s.links = vec![zero];
        assert!(validate(&s).unwrap_err().contains("晚于"));
        // Legacy keys accepted on any kind, and 500-character Chinese names fit.
        let legacy = Asset {
            name: "名".repeat(500),
            ..with(asset("d", "device"), &[("expires_on", "2027-01-01"), ("purpose", "x")])
        };
        assert!(validate(&snapshot(vec![legacy])).is_ok());
    }
    #[test]
    fn apply_changes_hands_over_and_is_all_or_nothing() {
        let mut c = db();
        let s = family(&mut c);
        let s = save_link(&mut c, uses("old", "me", "2025-01-01"), s.revision).unwrap();
        let mut ipad = asset("ipad", "device");
        ipad.fields.insert("owner_id".into(), "me".into());
        let mut laptop = s.assets.iter().find(|a| a.id == "laptop").unwrap().clone();
        laptop.fields.insert("location".into(), "家里".into());
        let changes = Changes {
            create: vec![ipad],
            update: vec![laptop],
            link: vec![uses("new", "child", "2026-11-05")],
            end_uses: vec![("old".into(), "2026-11-05".into())],
        };
        let s = apply_changes(&mut c, changes, s.revision, "ai_import").unwrap();
        assert_eq!(s.links.iter().find(|l| l.id == "old").unwrap().attrs["ends_on"], "2026-11-05");
        assert!(s.assets.iter().any(|a| a.id == "ipad"));
        assert_eq!(s.assets.iter().find(|a| a.id == "laptop").unwrap().fields["location"], "家里");
        // A second handover without ending the open use overlaps, so nothing is written.
        let bad = Changes { link: vec![uses("third", "me", "2026-12-01")], create: vec![asset("x", "person")], ..Default::default() };
        assert!(apply_changes(&mut c, bad, s.revision, "ai_import").is_err());
        assert!(!read(&c).unwrap().assets.iter().any(|a| a.id == "x"));
    }
    #[test]
    fn transfer_is_atomic_preserves_history_and_rejects_stale_writes() {
        let mut c = db();
        let s = family(&mut c);
        let s = save_link(&mut c, uses("old", "me", "2025-01-01"), s.revision).unwrap();
        let s = transfer_use(&mut c, "old", "child", "2026-10-01", None, s.revision).unwrap();
        let old = s.links.iter().find(|l| l.id == "old").unwrap();
        assert_eq!(old.attrs["ends_on"], "2026-10-01");
        let new = s.links.iter().find(|l| l.kind == "uses" && l.from == "child").unwrap();
        assert_eq!((new.to.as_str(), new.attrs["usage_role"].as_str()), ("laptop", "primary"));
        assert_eq!(s.events.last().unwrap().action, "transfer");
        // Stale revision and an already-ended record are both refused.
        assert!(transfer_use(&mut c, "old", "me", "2026-11-01", None, 1).is_err());
        assert!(transfer_use(&mut c, "old", "me", "2026-11-01", None, s.revision).is_err());
        // Someone else using it at the same time needs both marked shared.
        assert!(save_link(&mut c, uses("overlap", "me", "2026-11-01"), s.revision).is_err());
        // The same day as the start is not a valid handover.
        let id = new.id.clone();
        assert!(transfer_use(&mut c, &id, "me", "2026-10-01", None, s.revision).is_err());
    }
    #[test]
    fn shared_use_course_counts_and_storage_references() {
        let mut c = db();
        let s = family(&mut c);
        let mut first = uses("first", "me", "2025-01-01");
        first.attrs.insert("usage_role".into(), "shared".into());
        let mut second = uses("second", "child", "2026-01-01");
        second.attrs.insert("usage_role".into(), "shared".into());
        let s = save_link(&mut c, first, s.revision).unwrap();
        let s = save_link(&mut c, second.clone(), s.revision).unwrap();
        // The same person twice is still an overlap.
        second.id = "again".into();
        second.from = "me".into();
        assert!(save_link(&mut c, second, s.revision).is_err());
        let mut course = asset("math", "course");
        for (k, v) in [("person_id", "child"), ("lessons_total", "20"), ("lessons_used", "21")] {
            course.fields.insert(k.into(), v.into());
        }
        assert!(save_asset(&mut c, course.clone(), s.revision).is_err());
        course.fields.insert("lessons_used".into(), "2".into());
        let s = save_asset(&mut c, course, s.revision).unwrap();
        let mut disk = asset("disk", "device");
        disk.fields.insert("parent_id".into(), "laptop".into());
        let mut os = asset("linux", "environment");
        os.fields.insert("storage_id".into(), "disk".into());
        let s = apply_batch(&mut c, vec![disk, os], s.revision).unwrap();
        assert!(plan(&s, "disk").unwrap().blockers.iter().any(|b| b.contains("安装在哪块硬盘")));
        assert!(plan(&s, "laptop").unwrap().blockers.iter().any(|b| b.contains("使用")));
    }
    #[test]
    fn relation_ends_must_fit_and_attrs_are_checked() {
        let mut c = db();
        let s = family(&mut c);
        let mut wrong = uses("w", "laptop", "2026-01-01");
        wrong.to = "me".into();
        assert!(save_link(&mut c, wrong, s.revision).unwrap_err().contains("两端类型"));
        let mut odd = uses("o", "me", "2026-01-01");
        odd.attrs.insert("color".into(), "red".into());
        assert!(save_link(&mut c, odd, s.revision).unwrap_err().contains("不支持的属性"));
        let related = Link {
            id: "r".into(),
            kind: "related".into(),
            from: "me".into(),
            to: "laptop".into(),
            attrs: BTreeMap::new(),
        };
        assert!(save_link(&mut c, related, s.revision).unwrap_err().contains("写明"));
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
