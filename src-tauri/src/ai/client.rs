//! Minimal chat and model-list calls for OpenAI-compatible and Anthropic APIs.
use super::config::{ApiKind, Provider};
use serde_json::{Value, json};
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// An image already encoded for the request.
pub struct Image {
    pub media_type: String,
    pub base64: String,
}

pub struct Chat<'a> {
    pub system: &'a str,
    pub user: &'a str,
    pub images: &'a [Image],
}

fn client(timeout: u64) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "网络客户端初始化失败".into())
}

fn authorize(
    request: reqwest::RequestBuilder,
    provider: &Provider,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    match (provider.api, key) {
        (ApiKind::Openai, Some(k)) => request.bearer_auth(k),
        (ApiKind::Anthropic, Some(k)) => request
            .header("x-api-key", k)
            .header("anthropic-version", ANTHROPIC_VERSION),
        (ApiKind::Anthropic, None) => request.header("anthropic-version", ANTHROPIC_VERSION),
        (ApiKind::Openai, None) => request,
    }
}

async fn read(mut response: reqwest::Response) -> Result<(u16, String)> {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 AI 响应失败")? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_RESPONSE_BYTES {
            return Err("AI 响应过大".into());
        }
    }
    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

fn failure(status: u16, body: &str) -> String {
    let hint = match status {
        401 | 403 => "认证失败，请检查 API key",
        404 => "接口地址或模型不存在",
        408 | 504 => "AI 服务超时",
        413 => "内容过大，请减少图片或文字",
        429 => "额度不足或请求过快",
        _ => "AI 服务返回错误",
    };
    let detail: String = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.get("message"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    format!("{hint}（HTTP {status}）：{}", detail.trim())
}

fn send_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "AI 服务超时，请稍后重试".into()
    } else if e.is_connect() {
        "无法连接 AI 服务，请检查地址或本机网关是否运行".into()
    } else {
        "AI 请求失败，请检查网络".into()
    }
}

fn openai_body(provider: &Provider, chat: &Chat) -> Value {
    let user = if chat.images.is_empty() {
        json!(chat.user)
    } else {
        let mut parts = vec![json!({"type": "text", "text": chat.user})];
        parts.extend(chat.images.iter().map(|i| {
            json!({"type": "image_url", "image_url": {"url": format!("data:{};base64,{}", i.media_type, i.base64)}})
        }));
        Value::Array(parts)
    };
    json!({
        "model": provider.model,
        "temperature": 0,
        "stream": false,
        "messages": [
            {"role": "system", "content": chat.system},
            {"role": "user", "content": user},
        ],
    })
}

fn anthropic_body(provider: &Provider, chat: &Chat) -> Value {
    let mut parts: Vec<Value> = chat
        .images
        .iter()
        .map(|i| json!({"type": "image", "source": {"type": "base64", "media_type": i.media_type, "data": i.base64}}))
        .collect();
    parts.push(json!({"type": "text", "text": chat.user}));
    json!({
        "model": provider.model,
        "max_tokens": 8192,
        "temperature": 0,
        "system": chat.system,
        "messages": [{"role": "user", "content": parts}],
    })
}

/// The model's text answer.
pub fn answer_text(api: ApiKind, body: &str) -> Result<String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "AI 响应不是 JSON")?;
    let text = match api {
        ApiKind::Openai => match v.pointer("/choices/0/message/content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(parts)) => parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(""),
            _ => String::new(),
        },
        ApiKind::Anthropic => v
            .get("content")
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter(|p| p.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default(),
    };
    if text.trim().is_empty() {
        return Err("AI 没有返回内容".into());
    }
    Ok(text)
}

pub async fn chat(provider: &Provider, key: Option<&str>, chat: &Chat<'_>) -> Result<String> {
    let (path, body) = match provider.api {
        ApiKind::Openai => ("chat/completions", openai_body(provider, chat)),
        ApiKind::Anthropic => ("messages", anthropic_body(provider, chat)),
    };
    let request = client(180)?
        .post(format!("{}/{path}", provider.base_url))
        .header("Content-Type", "application/json")
        .body(serde_json::to_vec(&body).map_err(|e| e.to_string())?);
    let response = authorize(request, provider, key)
        .send()
        .await
        .map_err(send_error)?;
    let (status, text) = read(response).await?;
    if !(200..300).contains(&status) {
        return Err(failure(status, &text));
    }
    answer_text(provider.api, &text)
}

pub fn model_ids(body: &str) -> Result<Vec<String>> {
    let v: Value = serde_json::from_str(body).map_err(|_| "模型列表不是 JSON")?;
    let mut ids: Vec<String> = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or("模型列表格式无法识别")?
        .iter()
        .filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from))
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

pub async fn models(provider: &Provider, key: Option<&str>) -> Result<Vec<String>> {
    let request = client(20)?.get(format!("{}/models", provider.base_url));
    let response = authorize(request, provider, key)
        .send()
        .await
        .map_err(send_error)?;
    let (status, text) = read(response).await?;
    if !(200..300).contains(&status) {
        return Err(failure(status, &text));
    }
    model_ids(&text)
}

/// Whether the address answers like a Magpie gateway (its index lists the APIs it serves).
pub async fn is_magpie(origin: &str) -> bool {
    let Ok(c) = client(5) else { return false };
    let Ok(response) = c.get(format!("{origin}/")).send().await else {
        return false;
    };
    let Ok((200, body)) = read(response).await else {
        return false;
    };
    serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("apis").cloned())
        .and_then(|apis| apis.as_array().cloned())
        .is_some_and(|apis| apis.iter().any(|a| a == "/v1/chat/completions"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Serve one canned HTTP response and hand back the raw request.
    fn serve(status: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut buf = [0u8; 65536];
            loop {
                let n = socket.read(&mut buf).unwrap();
                request.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&request).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            socket.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&request).to_string()
        });
        (format!("http://{addr}/v1"), handle)
    }

    fn provider(api: ApiKind, base_url: String) -> Provider {
        Provider {
            id: "p".into(),
            name: "t".into(),
            api,
            base_url,
            model: "m-1".into(),
            has_key: true,
            source: None,
        }
    }

    #[test]
    fn openai_chat_sends_images_and_bearer_key() {
        let (url, server) = serve("200 OK", r#"{"choices":[{"message":{"content":"{\"assets\":[]}"}}]}"#);
        let images = [Image { media_type: "image/png".into(), base64: "AAAA".into() }];
        let chat_request = Chat { system: "sys", user: "hello", images: &images };
        let answer = tauri::async_runtime::block_on(chat(&provider(ApiKind::Openai, url), Some("sk-1"), &chat_request)).unwrap();
        let request = server.join().unwrap();
        assert_eq!(answer, r#"{"assets":[]}"#);
        assert!(request.starts_with("POST /v1/chat/completions"));
        assert!(request.to_ascii_lowercase().contains("authorization: bearer sk-1"));
        assert!(request.contains("data:image/png;base64,AAAA") && request.contains("\"model\":\"m-1\""));
    }

    #[test]
    fn anthropic_chat_uses_messages_api() {
        let (url, server) = serve("200 OK", r#"{"content":[{"type":"text","text":"ok"}]}"#);
        let chat_request = Chat { system: "sys", user: "hi", images: &[] };
        let answer = tauri::async_runtime::block_on(chat(&provider(ApiKind::Anthropic, url), Some("ak"), &chat_request)).unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert_eq!(answer, "ok");
        assert!(request.starts_with("post /v1/messages") && request.contains("x-api-key: ak"));
        assert!(request.contains("anthropic-version"));
    }

    #[test]
    fn errors_name_the_cause_and_models_parse() {
        let (url, server) = serve("401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);
        let e = tauri::async_runtime::block_on(models(&provider(ApiKind::Openai, url), None)).unwrap_err();
        server.join().unwrap();
        assert!(e.contains("认证失败") && e.contains("bad key"));
        assert_eq!(model_ids(r#"{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}"#).unwrap(), vec!["a", "b"]);
    }
}
