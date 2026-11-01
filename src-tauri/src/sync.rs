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
    use_verge: Option<bool>,
) -> Result<Response, String> {
    let url = validate_url(&url)?;
    let password = if use_verge.unwrap_or(false) {
        let connection = crate::dav_connection::load()?;
        crate::dav_connection::authorize(&connection, &url, &username)?;
        connection.password
    } else {
        password
    };
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Explicit opt-in: real existing Jianguoyun connection, disposable file only"]
    fn live_native_reused_connection_roundtrip() {
        assert_eq!(std::env::var("SSOT_LIVE_DAV").as_deref(), Ok("1"));
        tauri::async_runtime::block_on(async {
            let connection = crate::dav_connection::load().expect("load encrypted connection");
            let root = reqwest::Url::parse(&connection.url).unwrap();
            assert_eq!(
                root.origin().ascii_serialization(),
                "https://dav.jianguoyun.com"
            );
            let url = format!(
                "{}/SSOT-Hub/verify-native-{}.json",
                connection.url.trim_end_matches('/'),
                uuid::Uuid::new_v4()
            );
            let body = serde_json::json!({"test":"SSOT synthetic native transport", "nonce":uuid::Uuid::new_v4().to_string()}).to_string();
            let mut created = false;
            let result: Result<(), String> = async {
                let initial = dav_request(
                    url.clone(),
                    "GET".into(),
                    connection.username.clone(),
                    String::new(),
                    None,
                    None,
                    Some(true),
                )
                .await?;
                if initial.status != 404 {
                    return Err("Probe file unexpectedly exists".into());
                }
                let written = dav_request(
                    url.clone(),
                    "PUT".into(),
                    connection.username.clone(),
                    String::new(),
                    Some(body.clone()),
                    Some(("If-None-Match".into(), "*".into())),
                    Some(true),
                )
                .await?;
                if written.status != 201 {
                    return Err(format!("Probe write status {}", written.status));
                }
                created = true;
                let read = dav_request(
                    url.clone(),
                    "GET".into(),
                    connection.username.clone(),
                    String::new(),
                    None,
                    None,
                    Some(true),
                )
                .await?;
                if read.status != 200 || read.body != body {
                    return Err("Native readback mismatch".into());
                }
                Ok(())
            }
            .await;
            // The exact UUID path belongs exclusively to this test; never delete a vault or directory.
            if created {
                let cleanup = reqwest::Client::builder()
                    .timeout(Duration::from_secs(20))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap()
                    .delete(&url)
                    .basic_auth(&connection.username, Some(&connection.password))
                    .send()
                    .await
                    .expect("cleanup request");
                assert!(
                    [200, 204, 404].contains(&cleanup.status().as_u16()),
                    "cleanup failed"
                );
            }
            result.expect("native live roundtrip failed");
            println!(
                "PASS native dav_request: encrypted connection reuse, GET 404, PUT 201, GET 200/readback, disposable file deleted"
            );
        });
    }
}
