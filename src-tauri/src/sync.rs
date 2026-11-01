use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct Response {
    status: u16,
    body: String,
    etag: Option<String>,
}
fn validate_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "WebDAV URL 无效")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().contains("/SSOT-Hub/")
    {
        return Err("只允许专用 SSOT-Hub 目录的无凭据 HTTPS 地址".into());
    }
    Ok(url)
}
#[tauri::command]
pub async fn dav_request(
    url: String,
    method: String,
    username: String,
    password: String,
    body: Option<String>,
    condition: Option<(String, String)>,
) -> Result<Response, String> {
    let url = validate_url(&url)?;
    if !["GET", "PUT", "MKCOL"].contains(&method.as_str()) {
        return Err("不允许的 WebDAV 方法".into());
    }
    if body.as_ref().is_some_and(|v| v.len() > 20 * 1024 * 1024) {
        return Err("载荷过大".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "网络客户端初始化失败")?;
    let mut request = client
        .request(
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "无效方法")?,
            url,
        )
        .basic_auth(username, Some(password));
    if let Some((name, value)) = condition {
        if !["If-Match", "If-None-Match"].contains(&name.as_str()) {
            return Err("不允许的条件头".into());
        }
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "WebDAV 请求失败，请检查网络、HTTPS 和地址")?;
    let status = response.status().as_u16();
    let etag = response
        .headers()
        .get("ETag")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    if response
        .content_length()
        .is_some_and(|n| n > 20 * 1024 * 1024)
    {
        return Err("云端文件过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "WebDAV 响应读取失败")? {
        if bytes.len() + chunk.len() > 20 * 1024 * 1024 {
            return Err("云端文件过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "WebDAV 响应不是 UTF-8")?;
    Ok(Response { status, body, etag })
}
