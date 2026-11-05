mod ai;
mod dav_connection;
mod importers;
mod migrate;
mod schema;
mod shortcuts;
mod store;
mod sync;
mod validate;
use std::{path::PathBuf, sync::Mutex};
use store::{Asset, DeletePlan, Link, Snapshot};
use tauri::Manager;
struct AppState {
    path: Mutex<PathBuf>,
}
type Result<T> = std::result::Result<T, String>;
fn connect(state: &AppState) -> Result<rusqlite::Connection> {
    store::open(&state.path.lock().map_err(|e| e.to_string())?)
}
#[tauri::command]
#[specta::specta]
fn schema() -> schema::Schema {
    schema::schema().clone()
}
/// Validate a decrypted or file snapshot before the UI previews it.
#[tauri::command]
#[specta::specta]
fn check_snapshot(snapshot: serde_json::Value) -> Result<Snapshot> {
    // Older versions arrive from sync files too; upgrade them before the preview.
    store::parse(&snapshot.to_string())
}
#[tauri::command]
#[specta::specta]
fn load(state: tauri::State<AppState>) -> Result<Snapshot> {
    store::read(&connect(&state)?)
}
#[tauri::command]
#[specta::specta]
fn save_asset(state: tauri::State<AppState>, asset: Asset, revision: u64) -> Result<Snapshot> {
    store::save_asset(&mut connect(&state)?, asset, revision)
}
#[tauri::command]
#[specta::specta]
/// End the open `uses` relation `id` and start one for `person_id` on `starts_on`.
fn transfer_use(
    state: tauri::State<AppState>,
    id: String,
    person_id: String,
    starts_on: String,
    usage_role: Option<String>,
    revision: u64,
) -> Result<Snapshot> {
    store::transfer_use(&mut connect(&state)?, &id, &person_id, &starts_on, usage_role, revision)
}
#[tauri::command]
#[specta::specta]
fn save_link(state: tauri::State<AppState>, link: Link, revision: u64) -> Result<Snapshot> {
    store::save_link(&mut connect(&state)?, link, revision)
}
#[tauri::command]
#[specta::specta]
fn remove_link(state: tauri::State<AppState>, id: String, revision: u64) -> Result<Snapshot> {
    store::remove_link(&mut connect(&state)?, &id, revision)
}
#[tauri::command]
#[specta::specta]
fn delete_plan(state: tauri::State<AppState>, id: String) -> Result<DeletePlan> {
    store::plan(&store::read(&connect(&state)?)?, &id)
}
#[tauri::command]
#[specta::specta]
fn delete_asset(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    id: String,
    revision: u64,
) -> Result<Snapshot> {
    store::delete(
        &mut connect(&state)?,
        &id,
        revision,
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups"),
    )
}
#[tauri::command]
#[specta::specta]
fn backup(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<String> {
    Ok(store::backup(
        &store::read(&connect(&state)?)?,
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups"),
    )?
    .to_string_lossy()
    .into_owned())
}
#[tauri::command]
#[specta::specta]
fn list_backups(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !id.starts_with("ssot-") || !id.ends_with(".json") {
            continue;
        }
        let s = preview_snapshot(entry.path().to_string_lossy().to_string())?;
        let at = entry
            .metadata()
            .map_err(|e| e.to_string())?
            .modified()
            .map_err(|e| e.to_string())?;
        out.push(serde_json::json!({"id":id,"at":chrono::DateTime::<chrono::Utc>::from(at).to_rfc3339(),"count":s.assets.len()}));
    }
    Ok(out)
}
#[tauri::command]
#[specta::specta]
fn read_backup(app: tauri::AppHandle, id: String) -> Result<Snapshot> {
    if !id.starts_with("ssot-")
        || !id.ends_with(".json")
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
    {
        return Err("备份标识无效".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups")
        .join(id);
    if std::fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("不允许符号链接".into());
    }
    preview_snapshot(path.to_string_lossy().to_string())
}
#[tauri::command]
#[specta::specta]
fn export_snapshot(state: tauri::State<AppState>, path: String) -> Result<()> {
    let s = store::read(&connect(&state)?)?;
    store::private_write(
        &PathBuf::from(path),
        &serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
#[specta::specta]
fn preview_snapshot(path: String) -> Result<Snapshot> {
    store::parse(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
}
#[tauri::command]
#[specta::specta]
fn restore_snapshot(
    state: tauri::State<AppState>,
    snapshot: Snapshot,
    revision: u64,
) -> Result<Snapshot> {
    store::import_snapshot(&mut connect(&state)?, snapshot, revision)
}
#[tauri::command]
#[specta::specta]
fn replace_snapshot(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    snapshot: Snapshot,
    revision: u64,
) -> Result<Snapshot> {
    store::replace_snapshot(
        &mut connect(&state)?,
        snapshot,
        revision,
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups"),
    )
}
#[tauri::command]
#[specta::specta]
fn write_encrypted(path: String, content: String) -> Result<()> {
    if content.len() > 20 * 1024 * 1024 {
        return Err("载荷过大".into());
    }
    let v: serde_json::Value = serde_json::from_str(&content).map_err(|_| "加密载荷无效")?;
    if v["format"] != "ssot-encrypted-v1" {
        return Err("仅允许加密快照".into());
    }
    store::private_write(&PathBuf::from(path), content.as_bytes())
}
#[tauri::command]
#[specta::specta]
fn read_encrypted(path: String) -> Result<String> {
    if std::fs::metadata(&path).map_err(|_| "无法读取文件")?.len() > 20 * 1024 * 1024 {
        return Err("文件过大".into());
    }
    std::fs::read_to_string(path).map_err(|_| "无法读取加密快照".into())
}
#[tauri::command]
#[specta::specta]
fn new_workspace(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<Snapshot> {
    let mut p = state.path.lock().map_err(|e| e.to_string())?;
    let existing = store::read(&store::open(&p)?)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    store::backup(&existing, &dir.join("backups"))?;
    let next = dir.join(format!("workspace-{}.sqlite3", store::uid()));
    let s = store::read(&store::open(&next)?)?;
    // Persist active pointer atomically; never overwrite an existing database.
    let temp = dir.join(format!("active-{}.tmp", store::uid()));
    store::private_write(
        &temp,
        next.file_name().unwrap().to_string_lossy().as_bytes(),
    )?;
    std::fs::rename(temp, dir.join("active-workspace")).map_err(|e| e.to_string())?;
    *p = next;
    Ok(s)
}
#[tauri::command]
#[specta::specta]
fn data_path(state: tauri::State<AppState>) -> Result<String> {
    Ok(state
        .path
        .lock()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned())
}
#[tauri::command]
#[specta::specta]
async fn preview_brew(
    state: tauri::State<'_, AppState>,
    path: String,
    environment: String,
) -> Result<Vec<Asset>> {
    let s = store::read(&connect(&state)?)?;
    let assets = importers::brew(
        &std::fs::read_to_string(path).map_err(|e| e.to_string())?,
        &environment,
    )?;
    importers::validate_preview(&s, &assets)?;
    Ok(assets)
}
#[tauri::command]
#[specta::specta]
async fn preview_git(
    state: tauri::State<'_, AppState>,
    path: String,
    depth: u32,
    environment: String,
) -> Result<Vec<Asset>> {
    let s = store::read(&connect(&state)?)?;
    let assets = tauri::async_runtime::spawn_blocking(move || {
        importers::git(&PathBuf::from(path), depth, &environment)
    })
    .await
    .map_err(|e| e.to_string())??;
    importers::validate_preview(&s, &assets)?;
    Ok(assets)
}
#[tauri::command]
#[specta::specta]
fn apply_import(
    state: tauri::State<AppState>,
    assets: Vec<Asset>,
    revision: u64,
) -> Result<Snapshot> {
    store::apply_batch(&mut connect(&state)?, assets, revision)
}
#[tauri::command]
#[specta::specta]
fn cycle_cost(price: String, rate: String) -> Result<String> {
    use rust_decimal::Decimal;
    let p = price.parse::<Decimal>().map_err(|e| e.to_string())?;
    let r = rate.parse::<Decimal>().map_err(|e| e.to_string())?;
    p.checked_mul(r)
        .map(|v| v.round_dp(2).to_string())
        .ok_or("金额超出范围".into())
}
#[tauri::command]
#[specta::specta]
fn shortcut_source(path: Option<String>) -> Result<shortcuts::Source> {
    let p = path.map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default(),
        )
        .join(".hammerspoon/hotkeys.lua")
    });
    shortcuts::read(&p)
}
#[tauri::command]
#[specta::specta]
fn shortcut_preview(
    path: String,
    revision: String,
    change: shortcuts::Change,
) -> Result<shortcuts::Preview> {
    shortcuts::preview(&PathBuf::from(path), &revision, &change)
}
#[tauri::command]
#[specta::specta]
fn shortcut_save(
    app: tauri::AppHandle,
    path: String,
    revision: String,
    change: shortcuts::Change,
) -> Result<shortcuts::Source> {
    shortcuts::save(
        &PathBuf::from(path),
        &revision,
        &change,
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("backups/shortcuts"),
    )
}
#[tauri::command]
#[specta::specta]
fn shortcut_create_ahk(path: String) -> Result<shortcuts::Source> {
    shortcuts::create_ahk(&PathBuf::from(path))
}
#[tauri::command]
#[specta::specta]
fn shortcut_application(path: String) -> Result<(String, String)> {
    shortcuts::application(&PathBuf::from(path))
}
/// Every IPC command, registered once for both the invoke handler and the TS bindings.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .function_casing(tauri_specta::Casing::SnakeCase)
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        // Revisions and sizes stay far below 2^53.
        .dangerously_cast_bigints_to_number()
        .commands(tauri_specta::collect_commands![
            schema,
            check_snapshot,
            load,
            save_asset,
            transfer_use,
            save_link,
            remove_link,
            delete_plan,
            delete_asset,
            backup,
            list_backups,
            read_backup,
            export_snapshot,
            preview_snapshot,
            restore_snapshot,
            replace_snapshot,
            write_encrypted,
            read_encrypted,
            sync::dav_request,
            dav_connection::verge_dav_profile,
            new_workspace,
            data_path,
            preview_brew,
            preview_git,
            apply_import,
            cycle_cost,
            shortcut_source,
            shortcut_preview,
            shortcut_save,
            shortcut_create_ahk,
            shortcut_application,
            ai::ai_settings,
            ai::ai_save_provider,
            ai::ai_remove_provider,
            ai::ai_set_active,
            ai::ai_models,
            ai::ai_connect_magpie,
            ai::ai_extract,
            ai::ai_apply,
        ])
}
#[cfg(any(debug_assertions, test))]
fn bindings_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts")
}
#[cfg(any(debug_assertions, test))]
fn export_bindings(builder: &tauri_specta::Builder<tauri::Wry>, path: &std::path::Path) -> Result<()> {
    builder
        .export(
            specta_typescript::Typescript::default()
                .header("// Generated by tauri-specta from src-tauri. Do not edit; run `cargo test bindings`.\n// @ts-nocheck"),
            path,
        )
        .map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();
    #[cfg(debug_assertions)]
    export_bindings(&builder, &bindings_path()).expect("无法导出 src/bindings.ts");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let name = std::fs::read_to_string(dir.join("active-workspace"))
                .unwrap_or_else(|_| "ssot.sqlite3".into());
            if PathBuf::from(&name).components().count() != 1 || !name.ends_with(".sqlite3") {
                return Err("invalid workspace pointer".into());
            }
            let path = dir.join(name);
            store::open(&path).map_err(std::io::Error::other)?;
            app.manage(AppState {
                path: Mutex::new(path),
            });
            Ok(())
        })
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("SSOT Hub 启动失败");
}

#[cfg(test)]
mod tests {
    /// Keeps src/bindings.ts in step with the Rust commands. Refresh with `UPDATE_BINDINGS=1 cargo test bindings`.
    #[test]
    fn bindings_are_current() {
        let fresh = std::env::temp_dir().join(format!("ssot-bindings-{}.ts", std::process::id()));
        super::export_bindings(&super::specta_builder(), &fresh).unwrap();
        let generated = std::fs::read_to_string(&fresh).unwrap();
        std::fs::remove_file(&fresh).ok();
        let path = super::bindings_path();
        if std::env::var("UPDATE_BINDINGS").is_ok() {
            std::fs::write(&path, &generated).unwrap();
        }
        assert!(
            // Windows checkouts may convert line endings.
            std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n")
                == generated.replace("\r\n", "\n"),
            "src/bindings.ts 已过期，运行 UPDATE_BINDINGS=1 cargo test bindings"
        );
    }
}
