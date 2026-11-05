//! AI-assisted entry: provider settings, one-click Magpie, extraction and confirmed writes.
pub mod client;
pub mod config;
pub mod extract;
pub mod plan;

use config::{AiSettings, KeyStore, Keychain, Provider};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;

const MAX_IMAGES: usize = 4;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 20000;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn update(app: &tauri::AppHandle, f: impl FnOnce(&AiSettings) -> Result<AiSettings>) -> Result<AiSettings> {
    let dir = data_dir(app)?;
    let next = f(&config::load(&dir)?)?;
    config::store(&dir, &next)?;
    Ok(next)
}

fn key_for(p: &Provider) -> Result<Option<String>> {
    if p.has_key { Keychain.get(&p.id) } else { Ok(None) }
}

/// A sensible default among a gateway's models: a general chat model, not image/video/auto.
pub fn pick_model(models: &[String]) -> Option<String> {
    let usable: Vec<&String> = models
        .iter()
        .filter(|m| {
            let m = m.to_ascii_lowercase();
            !["image", "video", "imagine", "embed", "rerank", "tts", "whisper", "auto"]
                .iter()
                .any(|bad| m.contains(bad))
        })
        .collect();
    ["sonnet", "gpt-5", "gemini", "deepseek", "claude", "gpt"]
        .iter()
        .find_map(|want| usable.iter().find(|m| m.to_ascii_lowercase().contains(want)))
        .or(usable.first())
        .map(|m| m.to_string())
}

fn load_image(path: &Path) -> Result<client::Image> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let media_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return Err(format!("不支持的图片格式：{}", path.display())),
    };
    let size = std::fs::metadata(path).map_err(|_| format!("无法读取图片：{}", path.display()))?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("图片超过 5 MB：{}", path.display()));
    }
    let bytes = std::fs::read(path).map_err(|_| format!("无法读取图片：{}", path.display()))?;
    use base64::Engine;
    Ok(client::Image {
        media_type: media_type.into(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[tauri::command]
#[specta::specta]
pub fn ai_settings(app: tauri::AppHandle) -> Result<AiSettings> {
    config::load(&data_dir(&app)?)
}

/// `api_key`: omit to keep the stored key, "" to remove it.
#[tauri::command]
#[specta::specta]
pub fn ai_save_provider(app: tauri::AppHandle, provider: Provider, api_key: Option<String>) -> Result<AiSettings> {
    update(&app, |s| config::save_provider(s, &provider, api_key.as_deref(), &Keychain))
}

#[tauri::command]
#[specta::specta]
pub fn ai_remove_provider(app: tauri::AppHandle, id: String) -> Result<AiSettings> {
    update(&app, |s| config::remove_provider(s, &id, &Keychain))
}

#[tauri::command]
#[specta::specta]
pub fn ai_set_active(app: tauri::AppHandle, id: String) -> Result<AiSettings> {
    update(&app, |s| {
        s.find(&id)?;
        Ok(AiSettings { providers: s.providers.clone(), active: Some(id.clone()) })
    })
}

/// Models offered by a saved provider; also serves as a connection test.
#[tauri::command]
#[specta::specta]
pub async fn ai_models(app: tauri::AppHandle, id: String) -> Result<Vec<String>> {
    let settings = config::load(&data_dir(&app)?)?;
    let provider = settings.find(&id)?.clone();
    let key = key_for(&provider)?;
    client::models(&provider, key.as_deref()).await
}

#[derive(Serialize, specta::Type)]
pub struct MagpieConnection {
    pub settings: AiSettings,
    pub models: Vec<String>,
}

/// One click: find the local Magpie gateway, pick a chat model and make it the active service.
/// Magpie needs no key from this machine and its own configuration is not changed.
#[tauri::command]
#[specta::specta]
pub async fn ai_connect_magpie(app: tauri::AppHandle) -> Result<MagpieConnection> {
    let origin = config::MAGPIE_BASE_URL.trim_end_matches("/v1");
    if !client::is_magpie(origin).await {
        return Err("没有在本机 127.0.0.1:3425 找到 Magpie。请先打开 Magpie 应用，或手动添加接口".into());
    }
    let dir = data_dir(&app)?;
    let current = config::load(&dir)?;
    let probe = config::magpie_provider(&current, "probe");
    let models = client::models(&probe, None).await?;
    let previous = current
        .providers
        .iter()
        .find(|p| p.source.as_deref() == Some("magpie"))
        .map(|p| p.model.clone())
        .filter(|m| models.contains(m));
    let model = previous
        .or_else(|| pick_model(&models))
        .ok_or("Magpie 没有可用的对话模型")?;
    let saved = config::save_provider(&current, &config::magpie_provider(&current, &model), None, &Keychain)?;
    let id = saved
        .providers
        .iter()
        .find(|p| p.source.as_deref() == Some("magpie"))
        .map(|p| p.id.clone());
    let settings = AiSettings { providers: saved.providers, active: id };
    config::store(&dir, &settings)?;
    Ok(MagpieConnection { settings, models })
}

/// Ask the active AI service for drafts. Sends the given text and images plus the id, type and
/// name of existing assets; nothing is written.
#[tauri::command]
#[specta::specta]
pub async fn ai_extract(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    text: String,
    images: Vec<String>,
    pasted: Option<Vec<String>>,
    kind_hint: Option<String>,
) -> Result<plan::Plan> {
    let pasted = pasted.unwrap_or_default();
    if text.trim().is_empty() && images.is_empty() && pasted.is_empty() {
        return Err("请粘贴文字或添加截图".into());
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err("文字过长，请分段录入（上限 2 万字）".into());
    }
    if images.len() + pasted.len() > MAX_IMAGES {
        return Err("一次最多 4 张图片".into());
    }
    let images = images
        .iter()
        .map(|p| load_image(Path::new(p)))
        .chain(pasted.iter().map(|d| decode_pasted(d)))
        .collect::<Result<Vec<_>>>()?;
    let settings = config::load(&data_dir(&app)?)?;
    let provider = settings.active_provider()?.clone();
    let key = key_for(&provider)?;
    let snapshot = crate::store::read(&crate::connect(&state)?)?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let system = extract::system_prompt(kind_hint.as_deref(), &today);
    let user = extract::user_prompt(&text, &snapshot, &today);
    let answer = client::chat(
        &provider,
        key.as_deref(),
        &client::Chat { system: &system, user: &user, images: &images },
    )
    .await?;
    let parsed = extract::parse_answer(&answer)?;
    let evidence = format!("AI 辅助录入 · {} · {}", provider.name, provider.model);
    Ok(plan::build(&parsed, &snapshot, &evidence, &provider.model, &today))
}

/// Apply the operations the user confirmed, all in one transaction.
#[tauri::command]
#[specta::specta]
pub fn ai_apply(
    state: tauri::State<'_, crate::AppState>,
    changes: crate::store::Changes,
    revision: u64,
) -> Result<crate::store::Snapshot> {
    crate::store::apply_changes(&mut crate::connect(&state)?, changes, revision, "ai_import")
}

/// A screenshot pasted from the clipboard, as a `data:image/...;base64,` URL.
fn decode_pasted(data_url: &str) -> Result<client::Image> {
    let (head, body) = data_url.split_once(',').ok_or("粘贴的图片格式无效")?;
    let media_type = head
        .strip_prefix("data:")
        .and_then(|h| h.strip_suffix(";base64"))
        .filter(|t| ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(t))
        .ok_or("只支持粘贴 PNG、JPEG、WebP 或 GIF 图片")?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|_| "粘贴的图片内容无效")?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("粘贴的图片超过 5 MB".into());
    }
    Ok(client::Image { media_type: media_type.into(), base64: body.into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_skips_media_and_auto_routes() {
        let models: Vec<String> = ["copilot/auto", "grok/grok-imagine-video", "x/gemini-3-flash", "y/claude-sonnet-5"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_model(&models).as_deref(), Some("y/claude-sonnet-5"));
        assert_eq!(pick_model(&models[..2]), None);
    }

    #[test]
    fn pasted_images_are_checked() {
        assert_eq!(decode_pasted("data:image/png;base64,iVBORw0K").unwrap().media_type, "image/png");
        assert!(decode_pasted("data:text/html;base64,PGI+").is_err());
        assert!(decode_pasted("data:image/png;base64,***").is_err());
    }

    #[test]
    fn images_are_typed_and_bounded() {
        let dir = std::env::temp_dir().join(format!("ssot-img-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("a.PNG");
        std::fs::write(&png, b"\x89PNG").unwrap();
        assert_eq!(load_image(&png).unwrap().media_type, "image/png");
        let txt = dir.join("a.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert!(load_image(&txt).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Real call through the local Magpie gateway with made-up text.
    /// Run with `cargo test live_magpie -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_magpie_extract() {
        tauri::async_runtime::block_on(async {
            let probe = config::magpie_provider(&AiSettings::default(), "probe");
            let models = client::models(&probe, None).await.unwrap();
            let model = std::env::var("MAGPIE_MODEL").ok().or_else(|| pick_model(&models)).unwrap();
            let provider = config::magpie_provider(&AiSettings::default(), &model);
            let snapshot = extract::tests::ledger();
            let default_text = "虚构示例：MacBook-A 以后给孩子用，我换 M4 了。另外新开了 iCloud+ 200G，每月 21 元，自动续费。";
            let owned = std::env::var("SSOT_LIVE_TEXT").unwrap_or_else(|_| default_text.into());
            let text = owned.as_str();
            let system = extract::system_prompt(None, "2026-11-05");
            let user = extract::user_prompt(text, &snapshot, "2026-11-05");
            // SSOT_LIVE_IMAGE: a screenshot sent alongside (or instead of) the text.
            let images: Vec<client::Image> = std::env::var("SSOT_LIVE_IMAGE")
                .ok()
                .map(|p| load_image(Path::new(&p)).unwrap())
                .into_iter()
                .collect();
            let answer = client::chat(&provider, None, &client::Chat { system: &system, user: &user, images: &images })
                .await
                .unwrap();
            let parsed = extract::parse_answer(&answer).unwrap();
            let e = plan::build(&parsed, &snapshot, "AI 辅助录入 · test", &model, "2026-11-05");
            println!("model={model}\n{}", serde_json::to_string_pretty(&e).unwrap());
            assert!(!e.items.is_empty());
        });
    }
}
