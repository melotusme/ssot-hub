//! Read-only reuse of the user's local Clash Verge 2.5.x encrypted connection.
//! No password is returned to the WebView, copied to app files, or sent to another origin.
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub struct Connection {
    pub url: String,
    pub username: String,
    pub password: String,
}
#[derive(Serialize, specta::Type)]
pub struct Profile {
    pub url: String,
    pub username: String,
}
fn directory() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let path = PathBuf::from(std::env::var("HOME").map_err(|_| "找不到用户目录")?)
        .join("Library/Application Support/io.github.clash-verge-rev.clash-verge-rev");
    #[cfg(target_os = "windows")]
    let path = PathBuf::from(std::env::var("APPDATA").map_err(|_| "找不到用户目录")?)
        .join("io.github.clash-verge-rev.clash-verge-rev");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("当前平台暂不支持本机 Clash Verge 连接复用，请手动填写".into());
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    Ok(path)
}
fn decode_field(raw: &str, key: &[u8], field: &str) -> Result<String, String> {
    let prefix = format!("{field}:");
    let values: Vec<_> = raw
        .lines()
        .filter_map(|line| line.strip_prefix(&prefix))
        .collect();
    if values.len() != 1 {
        return Err("Clash Verge WebDAV 配置缺失或重复".into());
    }
    let encoded = values[0].trim().trim_matches(['\'', '"']);
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Clash Verge 配置格式不兼容")?;
    if bytes.len() < 28 || bytes.len() > 16384 {
        return Err("Clash Verge 加密字段长度无效".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "Clash Verge 本机密钥长度无效")?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..])
        .map_err(|_| "Clash Verge 配置无法解密，请在原客户端核对连接")?;
    let value: String =
        serde_json::from_slice(&plaintext).map_err(|_| "Clash Verge 配置格式不兼容")?;
    if value.is_empty() || value.contains(['\r', '\n', '\0']) {
        return Err("Clash Verge 连接字段无效".into());
    }
    Ok(value)
}
fn read(dir: &Path) -> Result<Connection, String> {
    let path = dir.join("verge.yaml");
    if std::fs::metadata(&path)
        .map_err(|_| "未找到本机 Clash Verge WebDAV 配置")?
        .len()
        > 1024 * 1024
    {
        return Err("Clash Verge 配置过大".into());
    }
    let raw = std::fs::read_to_string(path).map_err(|_| "无法读取 Clash Verge 配置")?;
    let key = std::fs::read(dir.join(".encryption_key"))
        .map_err(|_| "无法读取 Clash Verge 本机加密密钥")?;
    let connection = Connection {
        url: decode_field(&raw, &key, "webdav_url")?,
        username: decode_field(&raw, &key, "webdav_username")?,
        password: decode_field(&raw, &key, "webdav_password")?,
    };
    root(&connection.url)?;
    Ok(connection)
}
fn root(raw: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(raw).map_err(|_| "WebDAV 地址无效")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("仅允许不含凭据的 HTTPS WebDAV 根目录".into());
    }
    let path = format!("{}/SSOT-Hub/", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url)
}
pub fn load() -> Result<Connection, String> {
    read(&directory()?)
}
pub fn authorize(
    connection: &Connection,
    url: &reqwest::Url,
    username: &str,
) -> Result<(), String> {
    let root = root(&connection.url)?;
    if username != connection.username
        || url.origin() != root.origin()
        || !url.path().starts_with(root.path())
        || ["%2e", "%2f", "%5c", "%25"]
            .iter()
            .any(|part| url.path().to_lowercase().contains(part))
    {
        return Err("复用连接仅允许原账号的 SSOT-Hub 目录；地址或账号已变化，请重新读取".into());
    }
    Ok(())
}
#[tauri::command]
#[specta::specta]
pub fn verge_dav_profile() -> Result<Profile, String> {
    let connection = load()?;
    Ok(Profile {
        url: connection.url,
        username: connection.username,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decrypt_json_strings_and_reject_bad_keys() {
        let key = [7u8; 32];
        let nonce = [3u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce), br#""test-password""#.as_ref())
            .unwrap();
        let encoded = STANDARD.encode([nonce.as_slice(), &encrypted].concat());
        let raw = format!("webdav_password: {encoded}\n");
        assert_eq!(
            decode_field(&raw, &key, "webdav_password").unwrap(),
            "test-password"
        );
        assert!(decode_field(&raw, &[0; 32], "webdav_password").is_err());
        assert!(decode_field(&(raw.clone() + &raw), &key, "webdav_password").is_err());
    }
    #[test]
    fn reused_credentials_bound_to_original_origin_account_and_folder() {
        let c = Connection {
            url: "https://dav.example.com/dav/".into(),
            username: "test".into(),
            password: "test".into(),
        };
        assert!(
            authorize(
                &c,
                &"https://dav.example.com/dav/SSOT-Hub/vault.json"
                    .parse()
                    .unwrap(),
                "test"
            )
            .is_ok()
        );
        for url in [
            "https://other.example.com/dav/SSOT-Hub/vault.json",
            "https://dav.example.com/dav/else/SSOT-Hub/vault.json",
            "https://dav.example.com/dav/SSOT-Hub/../outside",
            "https://dav.example.com/dav/SSOT-Hub/%2foutside",
        ] {
            assert!(authorize(&c, &url.parse().unwrap(), "test").is_err());
        }
        assert!(
            authorize(
                &c,
                &"https://dav.example.com/dav/SSOT-Hub/vault.json"
                    .parse()
                    .unwrap(),
                "other"
            )
            .is_err()
        );
        let serialized = serde_json::to_value(Profile {
            url: c.url,
            username: c.username,
        })
        .unwrap();
        assert!(serialized.get("password").is_none());
    }
}
