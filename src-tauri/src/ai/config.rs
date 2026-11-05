//! AI provider settings. Non-secret settings live in the app data directory (never in the
//! ledger or sync payload); API keys live in the OS keychain.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;

pub const MAGPIE_BASE_URL: &str = "http://127.0.0.1:3425/v1";
const KEYCHAIN_SERVICE: &str = "com.ssothub.desktop.ai";
const SETTINGS_FILE: &str = "ai-settings.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ApiKind {
    /// OpenAI-compatible Chat Completions: OpenAI, Magpie, DeepSeek, OpenRouter, Ollama…
    Openai,
    /// Anthropic Messages API.
    Anthropic,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api: ApiKind,
    /// Includes the version path, e.g. `https://api.openai.com/v1`.
    pub base_url: String,
    pub model: String,
    /// Set by the backend; a key stored in the keychain.
    #[serde(default)]
    pub has_key: bool,
    /// `magpie` for the one-click local gateway.
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct AiSettings {
    pub providers: Vec<Provider>,
    pub active: Option<String>,
}

impl AiSettings {
    pub fn active_provider(&self) -> Result<&Provider> {
        let id = self.active.as_deref().ok_or("尚未选择 AI 服务，请先在「AI 助手」中接入")?;
        self.find(id)
    }
    pub fn find(&self, id: &str) -> Result<&Provider> {
        self.providers
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "AI 服务不存在".into())
    }
}

/// Where secrets are kept. The keychain in the app; memory in tests.
pub trait KeyStore {
    fn get(&self, id: &str) -> Result<Option<String>>;
    fn set(&self, id: &str, key: &str) -> Result<()>;
    fn delete(&self, id: &str) -> Result<()>;
}

pub struct Keychain;
impl Keychain {
    fn entry(id: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, id).map_err(|e| format!("无法访问系统钥匙串：{e}"))
    }
}
impl KeyStore for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>> {
        match Self::entry(id)?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("读取钥匙串失败：{e}")),
        }
    }
    fn set(&self, id: &str, key: &str) -> Result<()> {
        Self::entry(id)?
            .set_password(key)
            .map_err(|e| format!("写入钥匙串失败：{e}"))
    }
    fn delete(&self, id: &str) -> Result<()> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("删除钥匙串条目失败：{e}")),
        }
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "[::1]" | "::1")
}

/// HTTPS everywhere except a gateway on this machine; no credentials, query or fragment.
pub fn normalize_base_url(raw: &str) -> Result<String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "接口地址无效")?;
    let host = url.host_str().unwrap_or_default();
    let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && is_loopback(host));
    if !scheme_ok
        || host.is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("接口地址须为 HTTPS（本机网关可用 http://127.0.0.1），且不能包含账号、密钥或查询参数".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

pub fn validate_provider(p: &Provider) -> Result<Provider> {
    let name = p.name.trim();
    let model = p.model.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err("名称不能为空，且不超过 60 字".into());
    }
    if model.is_empty() || model.chars().count() > 200 {
        return Err("请填写模型名称".into());
    }
    Ok(Provider {
        id: if p.id.trim().is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            p.id.trim().to_string()
        },
        name: name.to_string(),
        api: p.api,
        base_url: normalize_base_url(&p.base_url)?,
        model: model.to_string(),
        has_key: p.has_key,
        source: p.source.clone().filter(|s| s == "magpie"),
    })
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join(SETTINGS_FILE)
}

pub fn load(dir: &Path) -> Result<AiSettings> {
    match std::fs::read_to_string(settings_path(dir)) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| "AI 设置文件损坏".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(AiSettings::default()),
        Err(e) => Err(format!("读取 AI 设置失败：{e}")),
    }
}

pub fn store(dir: &Path, settings: &AiSettings) -> Result<()> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!("ai-settings-{}.tmp", uuid::Uuid::new_v4()));
    let body = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    crate::store::private_write(&temp, &body)?;
    std::fs::rename(&temp, settings_path(dir)).map_err(|e| e.to_string())
}

/// Save a provider. `api_key`: None keeps the stored key, "" removes it, otherwise replaces it.
pub fn save_provider(
    settings: &AiSettings,
    provider: &Provider,
    api_key: Option<&str>,
    keys: &dyn KeyStore,
) -> Result<AiSettings> {
    let mut next = validate_provider(provider)?;
    let existing = settings.providers.iter().find(|p| p.id == next.id);
    next.has_key = existing.is_some_and(|p| p.has_key);
    match api_key.map(str::trim) {
        Some("") => {
            keys.delete(&next.id)?;
            next.has_key = false;
        }
        Some(k) => {
            if k.chars().count() > 4096 || k.chars().any(char::is_whitespace) {
                return Err("API key 格式无效".into());
            }
            keys.set(&next.id, k)?;
            next.has_key = true;
        }
        None => {}
    }
    let mut providers: Vec<Provider> = settings
        .providers
        .iter()
        .filter(|p| p.id != next.id)
        .cloned()
        .collect();
    let active = settings.active.clone().or_else(|| Some(next.id.clone()));
    providers.push(next);
    providers.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(AiSettings { providers, active })
}

pub fn remove_provider(settings: &AiSettings, id: &str, keys: &dyn KeyStore) -> Result<AiSettings> {
    settings.find(id)?;
    keys.delete(id)?;
    let providers: Vec<Provider> = settings.providers.iter().filter(|p| p.id != id).cloned().collect();
    let active = match settings.active.as_deref() {
        Some(a) if a == id => providers.first().map(|p| p.id.clone()),
        other => other.map(String::from),
    };
    Ok(AiSettings { providers, active })
}

pub fn magpie_provider(settings: &AiSettings, model: &str) -> Provider {
    let existing = settings
        .providers
        .iter()
        .find(|p| p.source.as_deref() == Some("magpie"));
    Provider {
        id: existing.map(|p| p.id.clone()).unwrap_or_default(),
        name: "Magpie（本机）".into(),
        api: ApiKind::Openai,
        base_url: MAGPIE_BASE_URL.into(),
        model: model.into(),
        has_key: false,
        source: Some("magpie".into()),
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashMap};

    #[derive(Default)]
    pub struct MemoryKeys(pub RefCell<HashMap<String, String>>);
    impl KeyStore for MemoryKeys {
        fn get(&self, id: &str) -> Result<Option<String>> {
            Ok(self.0.borrow().get(id).cloned())
        }
        fn set(&self, id: &str, key: &str) -> Result<()> {
            self.0.borrow_mut().insert(id.into(), key.into());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<()> {
            self.0.borrow_mut().remove(id);
            Ok(())
        }
    }

    fn provider(url: &str) -> Provider {
        Provider {
            id: String::new(),
            name: "OpenAI".into(),
            api: ApiKind::Openai,
            base_url: url.into(),
            model: "gpt-x".into(),
            has_key: true,
            source: None,
        }
    }

    #[test]
    fn base_url_requires_https_except_loopback() {
        assert_eq!(normalize_base_url("https://api.openai.com/v1/").unwrap(), "https://api.openai.com/v1");
        assert!(normalize_base_url("http://127.0.0.1:3425/v1").is_ok());
        assert!(normalize_base_url("http://example.com/v1").is_err());
        assert!(normalize_base_url("https://user:pw@example.com/v1").is_err());
        assert!(normalize_base_url("https://example.com/v1?key=x").is_err());
    }

    #[test]
    fn keys_go_to_store_and_never_into_settings() {
        let keys = MemoryKeys::default();
        let s = save_provider(&AiSettings::default(), &provider("https://api.openai.com/v1"), Some("sk-test"), &keys).unwrap();
        let p = &s.providers[0];
        assert!(p.has_key && !p.id.is_empty());
        assert_eq!(s.active.as_deref(), Some(p.id.as_str()));
        assert!(!serde_json::to_string(&s).unwrap().contains("sk-test"));
        assert_eq!(keys.get(&p.id).unwrap().as_deref(), Some("sk-test"));
        // Saving without a key keeps it; an empty key removes it.
        let kept = save_provider(&s, p, None, &keys).unwrap();
        assert!(kept.providers[0].has_key);
        let cleared = save_provider(&s, p, Some(""), &keys).unwrap();
        assert!(!cleared.providers[0].has_key && keys.get(&p.id).unwrap().is_none());
        let removed = remove_provider(&s, &p.id, &keys).unwrap();
        assert!(removed.providers.is_empty() && removed.active.is_none());
    }

    #[test]
    fn settings_round_trip_on_disk() {
        let dir = std::env::temp_dir().join(format!("ssot-ai-{}", uuid::Uuid::new_v4()));
        assert!(load(&dir).unwrap().providers.is_empty());
        let s = save_provider(&AiSettings::default(), &provider("https://api.openai.com/v1"), None, &MemoryKeys::default()).unwrap();
        store(&dir, &s).unwrap();
        assert_eq!(load(&dir).unwrap().providers[0].name, "OpenAI");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
