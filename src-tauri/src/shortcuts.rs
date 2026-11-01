//! Lossless, non-executing edits of declarative Lua / AutoHotkey v2 launcher tables.
use crate::store;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
type Result<T> = std::result::Result<T, String>;
static WRITE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Copy, PartialEq)]
enum Engine {
    Lua,
    Ahk,
}
#[derive(Clone, Debug)]
struct Token {
    text: String,
    start: usize,
    end: usize,
    string: Option<String>,
}
#[derive(Clone, Debug)]
struct Node {
    start: usize,
    end: usize,
    string: Option<String>,
    entries: Vec<Entry>,
}
#[derive(Clone, Debug)]
struct Entry {
    name: Option<String>,
    node: Node,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Shortcut {
    pub id: String,
    pub group: String,
    pub key: String,
    pub mods: Vec<String>,
    pub app: String,
    pub bundle_id: String,
    pub match_window: String,
    pub advanced: bool,
    pub line: usize,
}
#[derive(Serialize)]
pub struct Source {
    pub path: String,
    pub engine: String,
    pub revision: String,
    pub groups: Vec<String>,
    pub shortcuts: Vec<Shortcut>,
    pub reserved: Vec<String>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub id: Option<String>,
    pub group: String,
    pub key: String,
    pub mods: Vec<String>,
    pub app: String,
    pub bundle_id: String,
    pub match_window: String,
}
#[derive(Serialize)]
pub struct Preview {
    pub revision: String,
    pub before: String,
    pub after: String,
    pub path: String,
}
struct Parsed {
    groups: Vec<(String, Node)>,
    rows: Vec<(Shortcut, Node)>,
    reserved: Vec<String>,
}
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn engine(p: &Path) -> Result<Engine> {
    match p.extension().and_then(|s| s.to_str()) {
        Some("lua") => Ok(Engine::Lua),
        Some("ahk") => Ok(Engine::Ahk),
        _ => Err("请选择 .lua 或 AutoHotkey v2 .ahk 源码".into()),
    }
}
fn long_end(s: &str, start: usize) -> Option<(usize, usize)> {
    let b = s.as_bytes();
    if b.get(start) != Some(&b'[') {
        return None;
    }
    let mut i = start + 1;
    while b.get(i) == Some(&b'=') {
        i += 1;
    }
    if b.get(i) != Some(&b'[') {
        return None;
    }
    let close = format!("]{}]", "=".repeat(i - start - 1));
    let end = s[i + 1..].find(&close)? + i + 1;
    Some((i + 1, end + close.len()))
}
fn lex(s: &str, e: Engine) -> Result<Vec<Token>> {
    let b = s.as_bytes();
    let mut i = 0;
    let mut out = vec![];
    while i < b.len() {
        if b[i].is_ascii_whitespace() || (i == 0 && s.starts_with('\u{feff}')) {
            i += if i == 0 && s.starts_with('\u{feff}') {
                3
            } else {
                1
            };
            continue;
        }
        if (e == Engine::Lua && s[i..].starts_with("--")) || (e == Engine::Ahk && b[i] == b';') {
            if e == Engine::Lua
                && let Some((_, end)) = long_end(s, i + 2)
            {
                i = end;
                continue;
            }
            i = s[i..].find('\n').map(|n| i + n).unwrap_or(b.len());
            continue;
        }
        if e == Engine::Ahk && s[i..].starts_with("/*") {
            let n = s[i + 2..].find("*/").ok_or("未闭合 AHK 注释")?;
            i += n + 4;
            continue;
        }
        let start = i;
        if b[i] == b'"' || (e == Engine::Lua && b[i] == b'\'') {
            let q = b[i];
            i += 1;
            let mut value = String::new();
            let mut closed = false;
            while i < b.len() {
                if b[i] == q {
                    i += 1;
                    closed = true;
                    break;
                }
                if (e == Engine::Lua && b[i] == b'\\') || (e == Engine::Ahk && b[i] == b'`') {
                    i += 1;
                    let c = *b.get(i).ok_or("未闭合转义")?;
                    match c {
                        b'n' => value.push('\n'),
                        b'r' => value.push('\r'),
                        b't' => value.push('\t'),
                        b'\\' if e == Engine::Lua => value.push('\\'),
                        b'"' => value.push('"'),
                        b'\'' if e == Engine::Lua => value.push('\''),
                        b'`' if e == Engine::Ahk => value.push('`'),
                        _ => return Err("不支持的字符串转义，请在代码中保留该写法".into()),
                    }
                    i += 1;
                } else {
                    let c = s[i..].chars().next().unwrap();
                    value.push(c);
                    i += c.len_utf8();
                }
            }
            if !closed {
                return Err("字符串未闭合".into());
            }
            out.push(Token {
                text: s[start..i].into(),
                start,
                end: i,
                string: Some(value),
            });
            continue;
        }
        if e == Engine::Lua
            && let Some((content, end)) = long_end(s, i)
        {
            let closing_len = content - i;
            let value = s[content..end - closing_len].to_string();
            i = end;
            out.push(Token {
                text: s[start..i].into(),
                start,
                end: i,
                string: Some(value),
            });
            continue;
        }
        if b[i].is_ascii_alphanumeric() || b[i] == b'_' {
            i += 1;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
        } else {
            i += s[i..].chars().next().unwrap().len_utf8();
        }
        out.push(Token {
            text: s[start..i].into(),
            start,
            end: i,
            string: None,
        });
    }
    Ok(out)
}
fn node(tokens: &[Token], pos: &mut usize) -> Result<Node> {
    let first = tokens.get(*pos).ok_or("源码不完整")?;
    let start = first.start;
    if ["{", "["].contains(&first.text.as_str()) && first.string.is_none() {
        let closing = if first.text == "{" { "}" } else { "]" };
        *pos += 1;
        let mut entries = vec![];
        while tokens.get(*pos).is_some_and(|t| t.text != closing) {
            if [",", ";"].contains(&tokens[*pos].text.as_str()) {
                *pos += 1;
                continue;
            }
            let named = tokens
                .get(*pos + 1)
                .is_some_and(|t| ["=", ":"].contains(&t.text.as_str()));
            let name = if named {
                let n = tokens[*pos].text.clone();
                *pos += 2;
                Some(n)
            } else {
                None
            };
            let value = node(tokens, pos)?;
            entries.push(Entry { name, node: value });
            if tokens
                .get(*pos)
                .is_some_and(|t| t.text != closing && t.text != "," && t.text != ";")
            {
                return Err("声明表包含不支持的动态语法；请在代码中调整".into());
            }
        }
        let end = tokens.get(*pos).ok_or("声明表未闭合")?.end;
        *pos += 1;
        return Ok(Node {
            start,
            end,
            string: None,
            entries,
        });
    }
    let mut nesting = 0i32;
    let mut end = first.end;
    let mut count = 0;
    while let Some(t) = tokens.get(*pos) {
        if nesting == 0 && t.string.is_none() && [",", ";", "}", "]"].contains(&t.text.as_str()) {
            break;
        }
        if t.string.is_none() {
            if ["(", "[", "{"].contains(&t.text.as_str()) {
                nesting += 1;
            }
            if [")", "]", "}"].contains(&t.text.as_str()) {
                nesting -= 1;
            }
            if nesting < 0 {
                return Err("不支持的声明表达式".into());
            }
        }
        end = t.end;
        count += 1;
        *pos += 1;
    }
    if count == 0 {
        return Err("缺少声明值".into());
    }
    Ok(Node {
        start,
        end,
        string: if count == 1 {
            first.string.clone()
        } else {
            None
        },
        entries: vec![],
    })
}
fn assigned(tokens: &[Token], name: &str, e: Engine) -> Result<Node> {
    let matches = tokens
        .iter()
        .enumerate()
        .filter(|(i, t)| {
            t.text == name
                && t.string.is_none()
                && tokens
                    .get(i + 1)
                    .is_some_and(|t| t.text == if e == Engine::Lua { "=" } else { ":" })
        })
        .map(|(i, _)| i)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(format!(
            "需要唯一的 {} 声明表；暂不解析任意脚本执行逻辑",
            name
        ));
    }
    let mut p = matches[0] + if e == Engine::Lua { 2 } else { 3 };
    node(tokens, &mut p)
}
fn field<'a>(n: &'a Node, key: &str) -> Option<&'a Node> {
    n.entries
        .iter()
        .find(|x| x.name.as_deref() == Some(key))
        .map(|x| &x.node)
}
fn string(n: &Node, key: &str) -> Result<String> {
    field(n, key)
        .and_then(|n| n.string.clone())
        .ok_or_else(|| format!("{key} 必须是字符串字面量，动态表达式请继续在代码中维护"))
}
fn mods(n: &Node) -> Result<Vec<String>> {
    n.entries
        .iter()
        .map(|x| {
            x.node
                .string
                .as_deref()
                .ok_or("修饰键必须是字符串列表".into())
                .and_then(normal_mod)
        })
        .collect()
}
fn normal_mod(s: &str) -> Result<String> {
    match s.to_ascii_lowercase().as_str() {
        "cmd" | "command" | "⌘" | "win" => Ok("cmd".into()),
        "ctrl" | "control" | "⌃" => Ok("ctrl".into()),
        "shift" | "⇧" => Ok("shift".into()),
        "alt" | "option" | "⌥" => Ok("alt".into()),
        _ => Err(format!("不支持的修饰键：{s}")),
    }
}
fn combo(mods: &[String], key: &str) -> String {
    let mut m = mods.to_vec();
    m.sort();
    m.dedup();
    format!("{}+{}", m.join("+"), key.to_ascii_uppercase())
}
fn parse(s: &str, e: Engine) -> Result<Parsed> {
    let t = lex(s, e)?;
    let root = assigned(
        &t,
        if e == Engine::Lua {
            "app_shortcuts"
        } else {
            "ssot_launchers"
        },
        e,
    )?;
    let defaults = if e == Engine::Lua {
        mods(&assigned(&t, "default_mods", e)?)?
    } else {
        vec![]
    };
    let groups = if e == Engine::Lua {
        root.entries
            .iter()
            .map(|x| Ok((x.name.clone().ok_or("分类需要具名字段")?, x.node.clone())))
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![("launchers".into(), root)]
    };
    let mut rows = vec![];
    for (group, table) in &groups {
        for item in &table.entries {
            let n = &item.node;
            if n.entries.is_empty() {
                return Err("应用条目必须是字面量声明表".into());
            }
            let raw_key = string(n, "key")?;
            let (m, key) = if e == Engine::Lua {
                (
                    field(n, "mods")
                        .map(mods)
                        .transpose()?
                        .unwrap_or_else(|| defaults.clone()),
                    raw_key,
                )
            } else {
                let mut m = vec![];
                let mut offset = 0;
                for c in raw_key.chars() {
                    let name = match c {
                        '^' => "ctrl",
                        '!' => "alt",
                        '+' => "shift",
                        '#' => "cmd",
                        _ => break,
                    };
                    m.push(name.into());
                    offset += 1;
                }
                (m, raw_key[offset..].into())
            };
            let advanced = n.entries.iter().any(|f| {
                f.name
                    .as_deref()
                    .is_none_or(|k| !["key", "app", "bundleID", "mods", "match"].contains(&k))
            });
            rows.push((
                Shortcut {
                    id: format!("{group}:{}", n.start),
                    group: group.clone(),
                    key,
                    mods: m,
                    app: string(n, "app")?,
                    bundle_id: field(n, "bundleID")
                        .map(|_| string(n, "bundleID"))
                        .transpose()?
                        .unwrap_or_default(),
                    match_window: field(n, "match")
                        .map(|_| string(n, "match"))
                        .transpose()?
                        .unwrap_or_default(),
                    advanced,
                    line: s[..n.start].bytes().filter(|c| *c == b'\n').count() + 1,
                },
                n.clone(),
            ));
        }
    }
    let mut reserved = vec![];
    if e == Engine::Lua {
        for (i, x) in t.iter().enumerate() {
            if x.text == "bind"
                && t.get(i + 1).is_some_and(|x| x.text == "(")
                && t.get(i + 2).is_some_and(|x| x.text == "{")
            {
                let mut p = i + 2;
                if let Ok(n) = node(&t, &mut p)
                    && let Ok(m) = mods(&n)
                    && let Some(key) = t.get(p + 1).and_then(|x| x.string.clone())
                {
                    reserved.push(combo(&m, &key));
                }
            }
        }
    }
    Ok(Parsed {
        groups,
        rows,
        reserved,
    })
}
pub fn read(path: &Path) -> Result<Source> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let e = engine(&path)?;
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let p = parse(&s, e)?;
    let mut seen = HashSet::new();
    let mut warnings = vec![];
    for (r, _) in &p.rows {
        let c = combo(&r.mods, &r.key);
        if !seen.insert(c.clone()) || p.reserved.contains(&c) {
            warnings.push(format!("快捷键重复：{c}"));
        }
    }
    Ok(Source {
        path: path.to_string_lossy().into_owned(),
        engine: if e == Engine::Lua {
            "hammerspoon"
        } else {
            "ahk_v2"
        }
        .into(),
        revision: digest(&s),
        groups: p.groups.into_iter().map(|(g, _)| g).collect(),
        shortcuts: p.rows.into_iter().map(|(r, _)| r).collect(),
        reserved: p.reserved,
        warnings,
    })
}
fn quote(s: &str, e: Engine) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str(if e == Engine::Lua { "\\\"" } else { "`\"" }),
            '\\' if e == Engine::Lua => out.push_str("\\\\"),
            '`' if e == Engine::Ahk => out.push_str("``"),
            '\n' => out.push_str(if e == Engine::Lua { "\\n" } else { "`n" }),
            '\r' => out.push_str(if e == Engine::Lua { "\\r" } else { "`r" }),
            '\t' => out.push_str(if e == Engine::Lua { "\\t" } else { "`t" }),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}
fn encoded_key(change: &Change, e: Engine) -> String {
    if e == Engine::Lua {
        return change.key.clone();
    }
    let mut out = String::new();
    for (m, c) in [("ctrl", '^'), ("alt", '!'), ("shift", '+'), ("cmd", '#')] {
        if change.mods.iter().any(|x| x == m) {
            out.push(c);
        }
    }
    out.push_str(&change.key.to_ascii_lowercase());
    out
}
fn changed(s: &str, e: Engine, c: &Change) -> Result<String> {
    let p = parse(s, e)?;
    if c.key.is_empty()
        || c.key.len() > 20
        || !c.key.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ')
    {
        return Err("主键仅支持字母、数字和命名键（如 F1、space）".into());
    }
    if c.mods.is_empty() {
        return Err("至少选择一个修饰键".into());
    }
    let mut unique = HashSet::new();
    for m in &c.mods {
        if normal_mod(m)? != *m || !unique.insert(m) {
            return Err("修饰键无效或重复".into());
        }
    }
    if c.app.trim().is_empty() || c.app.contains(['\n', '\r', '\0']) || c.app.len() > 4096 {
        return Err("请选择有效的应用路径".into());
    }
    if e == Engine::Lua && !c.app.trim_end_matches('/').ends_with(".app") {
        return Err("Hammerspoon 应用应为 .app 路径".into());
    }
    if e == Engine::Ahk && c.match_window.trim().is_empty() {
        return Err("AHK v2 需要窗口匹配条件，例如 ahk_exe Code.exe".into());
    }
    let target_combo = combo(&c.mods, &c.key);
    if p.rows
        .iter()
        .any(|(r, _)| Some(&r.id) != c.id.as_ref() && combo(&r.mods, &r.key) == target_combo)
        || p.reserved.contains(&target_combo)
    {
        return Err("快捷键已被应用或其他函数占用".into());
    }
    let mut edits: Vec<(usize, usize, String)> = vec![];
    let mut extra_fields: Vec<String> = vec![];
    if let Some(id) = &c.id {
        let (r, n) = p
            .rows
            .iter()
            .find(|(r, _)| r.id == *id)
            .ok_or("条目不存在，请刷新源码")?;
        if r.group != c.group {
            return Err("现有条目分类请在源码中调整".into());
        }
        if r.advanced
            && (r.app != c.app || r.bundle_id != c.bundle_id || r.match_window != c.match_window)
        {
            return Err(
                "该条目包含高级启动逻辑，GUI 仅允许调整快捷键；应用与启动参数请在代码中维护".into(),
            );
        }
        for (key, value) in [
            ("key", encoded_key(c, e)),
            ("app", c.app.clone()),
            (
                if e == Engine::Lua {
                    "bundleID"
                } else {
                    "match"
                },
                if e == Engine::Lua {
                    c.bundle_id.clone()
                } else {
                    c.match_window.clone()
                },
            ),
        ] {
            if let Some(f) = field(n, key) {
                if f.string.as_deref() != Some(value.as_str()) {
                    edits.push((f.start, f.end, quote(&value, e)));
                }
            } else if !value.is_empty() {
                let sep = if e == Engine::Lua { " = " } else { ": " };
                extra_fields.push(format!("{key}{sep}{}", quote(&value, e)));
            }
        }
        if e == Engine::Lua && combo(&r.mods, "") != combo(&c.mods, "") {
            let value = format!(
                "{{ {} }}",
                c.mods
                    .iter()
                    .map(|x| quote(x, e))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            if let Some(f) = field(n, "mods") {
                edits.push((f.start, f.end, value));
            } else {
                extra_fields.push(format!("mods = {value}"));
            }
        }
        if !extra_fields.is_empty() {
            // Insert before existing fields, so trailing comments/separators stay intact.
            edits.push((
                n.start + 1,
                n.start + 1,
                format!(" {}, ", extra_fields.join(", ")),
            ));
        }
    } else {
        let (_, table) = p
            .groups
            .iter()
            .find(|(g, _)| g == &c.group)
            .ok_or("请选择已有分类")?;
        let newline = if s.contains("\r\n") { "\r\n" } else { "\n" };
        let value = if e == Engine::Lua {
            format!(
                "        {{ key = {}, mods = {{ {} }}, app = {}{} }}",
                quote(&c.key, e),
                c.mods
                    .iter()
                    .map(|m| quote(m, e))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote(&c.app, e),
                if c.bundle_id.is_empty() {
                    String::new()
                } else {
                    format!(", bundleID = {}", quote(&c.bundle_id, e))
                }
            )
        } else {
            format!(
                "    {{ key: {}, app: {}, match: {} }}",
                quote(&encoded_key(c, e), e),
                quote(&c.app, e),
                quote(&c.match_window, e)
            )
        };
        // Prepend within the declaration, keeping trailing comments byte-for-byte.
        let comma = if e == Engine::Lua || !table.entries.is_empty() {
            ","
        } else {
            ""
        };
        edits.push((
            table.start + 1,
            table.start + 1,
            format!("{newline}{value}{comma}{newline}"),
        ));
    }
    // Right-to-left span edits preserve comments, advanced fields, functions and line endings.
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut after = s.to_string();
    for (start, end, value) in edits {
        after.replace_range(start..end, &value);
    }
    let parsed = parse(&after, e)?;
    let mut seen = HashSet::new();
    for (r, _) in parsed.rows {
        if !seen.insert(combo(&r.mods, &r.key)) {
            return Err("修改后出现重复快捷键".into());
        }
    }
    Ok(after)
}
pub fn preview(path: &Path, revision: &str, change: &Change) -> Result<Preview> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let e = engine(&path)?;
    let before = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if digest(&before) != revision {
        return Err("源码已被外部修改，请重新读取后再编辑".into());
    }
    let after = changed(&before, e, change)?;
    Ok(Preview {
        revision: revision.into(),
        before,
        after,
        path: path.to_string_lossy().into_owned(),
    })
}
pub fn save(path: &Path, revision: &str, change: &Change, backup_dir: &Path) -> Result<Source> {
    let _lock = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let p = preview(path, revision, change)?;
    if p.before == p.after {
        return read(path);
    }
    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let backup = backup_dir.join(format!(
        "shortcut-{}-{}.{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        store::uid(),
        path.extension().unwrap().to_string_lossy()
    ));
    store::private_write(&backup, p.before.as_bytes())?;
    let path = PathBuf::from(&p.path);
    let temp = path.with_file_name(format!(".ssot-{}.tmp", store::uid()));
    store::private_write(&temp, p.after.as_bytes())?;
    let result = (|| {
        fs::set_permissions(
            &temp,
            fs::metadata(&path)
                .map_err(|e| e.to_string())?
                .permissions(),
        )
        .map_err(|e| e.to_string())?;
        if digest(&fs::read_to_string(&path).map_err(|e| e.to_string())?) != revision {
            return Err("保存期间源码已改变，未覆盖；请重新读取".into());
        }
        fs::rename(&temp, &path).map_err(|e| e.to_string())?;
        read(&path)
    })();
    if temp.exists() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub const AHK_TEMPLATE: &str = r#"#Requires AutoHotkey v2.0
#SingleInstance Force

; Source of truth: edit this table in code or SSOT Hub.
; ^ Ctrl / ! Alt / + Shift / # Win
ssot_launchers := [
]

for item in ssot_launchers
    Hotkey(item.key, SSOT_LaunchOrFocus.Bind(item.app, item.match))

SSOT_LaunchOrFocus(appPath, windowMatch, *) {
    if hwnd := WinExist(windowMatch)
        WinActivate("ahk_id " hwnd)
    else
        Run(Chr(34) appPath Chr(34))
}
"#;
pub fn create_ahk(path: &Path) -> Result<Source> {
    if engine(path)? != Engine::Ahk {
        return Err("新建文件必须使用 .ahk 扩展名".into());
    }
    store::private_write(path, AHK_TEMPLATE.as_bytes())?;
    read(path)
}
pub fn application(path: &Path) -> Result<(String, String)> {
    let p = path.canonicalize().map_err(|e| e.to_string())?;
    if !p.is_dir() || p.extension().and_then(|x| x.to_str()) != Some("app") {
        return Err("请选择 macOS .app 应用包".into());
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Print :CFBundleIdentifier"])
            .arg(p.join("Contents/Info.plist"))
            .output()
            .map_err(|e| e.to_string())?;
        let bundle = if output.status.success() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else {
            String::new()
        };
        Ok((p.to_string_lossy().into_owned(), bundle))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok((p.to_string_lossy().into_owned(), String::new()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const LUA: &str = r#"-- heading
local app_shortcuts = {
 ide = {
 -- { key = "C", app = "ignored.app" },
 { key = "E", app = "/Applications/Editor.app" },
 { key = "X", app = "/Applications/ChatGPT.app", bundleID = "com.openai.codex", cockpitManagedCodex = true },
 },
 tools = {},
}
local function untouched() return "function,{} text" end
local default_mods = { "cmd", "ctrl" }
hs.hotkey.bind({"cmd","ctrl"}, "F", function() return 1 end)
"#;
    fn change() -> Change {
        Change {
            id: Some("ide:94".into()),
            group: "ide".into(),
            key: "K".into(),
            mods: vec!["cmd".into(), "ctrl".into()],
            app: "/Applications/Editor.app".into(),
            bundle_id: String::new(),
            match_window: String::new(),
        }
    }
    #[test]
    fn preserves_comments_functions_and_special_logic() {
        let parsed = parse(LUA, Engine::Lua).unwrap();
        assert_eq!(parsed.rows.len(), 2);
        let mut c = change();
        c.id = Some(parsed.rows[0].0.id.clone());
        let after = changed(LUA, Engine::Lua, &c).unwrap();
        assert_eq!(after, LUA.replacen("key = \"E\"", "key = \"K\"", 1));
        c.id = Some(parsed.rows[1].0.id.clone());
        assert!(changed(LUA, Engine::Lua, &c).is_err());
    }
    #[test]
    fn adds_mods_and_bundle_without_damaging_other_fields() {
        let p = parse(LUA, Engine::Lua).unwrap();
        let mut c = change();
        c.id = Some(p.rows[0].0.id.clone());
        c.mods.push("shift".into());
        c.bundle_id = "com.editor".into();
        let after = changed(LUA, Engine::Lua, &c).unwrap();
        let p = parse(&after, Engine::Lua).unwrap();
        assert_eq!(p.rows[0].0.mods.len(), 3);
        assert_eq!(p.rows[0].0.bundle_id, "com.editor");
        assert!(after.contains("cockpitManagedCodex = true"));
    }
    #[test]
    fn conflicts_and_stale_source_blocked() {
        let p = parse(LUA, Engine::Lua).unwrap();
        let mut c = change();
        c.id = Some(p.rows[0].0.id.clone());
        c.key = "F".into();
        assert!(changed(LUA, Engine::Lua, &c).is_err());
        let dir = std::env::temp_dir().join(store::uid());
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("hotkeys.lua");
        fs::write(&path, LUA).unwrap();
        let rev = digest(LUA);
        c.key = "K".into();
        fs::write(&path, format!("{LUA}\n-- external edit")).unwrap();
        assert!(save(&path, &rev, &c, &dir.join("backups")).is_err());
        assert!(fs::read_to_string(&path).unwrap().contains("external edit"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn ahk_v2_roundtrip_and_quoting() {
        let mut c = change();
        c.id = None;
        c.group = "launchers".into();
        c.app = r#"C:\Program Files\Editor\editor.exe"#.into();
        c.match_window = "ahk_exe editor.exe".into();
        let after = changed(AHK_TEMPLATE, Engine::Ahk, &c).unwrap();
        let p = parse(&after, Engine::Ahk).unwrap();
        assert_eq!(p.rows[0].0.app, c.app);
        assert_eq!(combo(&p.rows[0].0.mods, ""), combo(&c.mods, ""));
        assert_eq!(p.rows[0].0.key, "k");
        assert_eq!(p.rows[0].0.match_window, c.match_window);
    }
    #[test]
    fn inserts_without_disturbing_trailing_comments() {
        let s = LUA.replace(
            "app = \"/Applications/Editor.app\" }",
            "app = \"/Applications/Editor.app\" -- keep comment\n }",
        );
        let p = parse(&s, Engine::Lua).unwrap();
        let mut c = change();
        c.id = Some(p.rows[0].0.id.clone());
        c.mods.push("shift".into());
        let after = changed(&s, Engine::Lua, &c).unwrap();
        assert!(after.contains("-- keep comment\n }"));
        c.id = None;
        let after = changed(&s, Engine::Lua, &c).unwrap();
        assert_eq!(parse(&after, Engine::Lua).unwrap().rows.len(), 3);
        assert!(after.contains("-- keep comment\n }"));
        let mut ahk = change();
        ahk.id = None;
        ahk.group = "launchers".into();
        ahk.match_window = "ahk_exe Editor.exe".into();
        let first = changed(AHK_TEMPLATE, Engine::Ahk, &ahk).unwrap();
        assert!(!first.contains("},"));
        ahk.key = "L".into();
        let second = changed(&first, Engine::Ahk, &ahk).unwrap();
        assert_eq!(parse(&second, Engine::Ahk).unwrap().rows.len(), 2);
    }
    #[test]
    fn rejects_dynamic_fields_and_handles_long_comments() {
        let s = LUA.replace("-- heading", "--[=[ { key = \"Z\" } ]=]");
        assert_eq!(parse(&s, Engine::Lua).unwrap().rows.len(), 2);
        assert!(
            parse(
                &LUA.replace(
                    "app = \"/Applications/Editor.app\"",
                    "app = os.getenv(\"APP\")"
                ),
                Engine::Lua
            )
            .is_err()
        );
    }
    #[test]
    fn source_save_creates_backup_and_changes_only_expected_bytes() {
        let dir = std::env::temp_dir().join(store::uid());
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("hotkeys.lua");
        fs::write(&file, LUA).unwrap();
        let p = read(&file).unwrap();
        let mut c = change();
        c.id = Some(p.shortcuts[0].id.clone());
        let next = save(&file, &p.revision, &c, &dir.join("backups")).unwrap();
        assert_eq!(next.shortcuts[0].key, "K");
        let b = fs::read_dir(dir.join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(fs::read_to_string(b).unwrap(), LUA);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn parses_real_fixture_and_keeps_full_source() {
        let s = include_str!("../tests/fixtures/hotkeys.lua");
        let p = parse(s, Engine::Lua).unwrap();
        assert!(p.rows.len() > 20);
        let row = &p.rows[0].0;
        let c = Change {
            id: Some(row.id.clone()),
            group: row.group.clone(),
            key: row.key.clone(),
            mods: row.mods.clone(),
            app: row.app.clone(),
            bundle_id: row.bundle_id.clone(),
            match_window: row.match_window.clone(),
        };
        assert_eq!(changed(s, Engine::Lua, &c).unwrap(), s);
    }
}
