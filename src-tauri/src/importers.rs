use crate::store::{Asset, Snapshot, validate};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path, process::Command};
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
fn stable(s: &str) -> String {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, s.as_bytes()).to_string()
}
fn asset(
    env: &str,
    source: &str,
    key: &str,
    name: &str,
    mut fields: BTreeMap<String, String>,
) -> Asset {
    fields.insert("environment_id".into(), env.into());
    fields.insert("source".into(), source.into());
    Asset {
        id: stable(&format!("{env}/{source}/{key}")),
        kind: "software".into(),
        name: name.into(),
        status: "active".into(),
        fields,
    }
}
pub fn brew(text: &str, env: &str) -> Result<Vec<Asset>> {
    let v: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if !v.get("formulae").is_some_and(Value::is_array)
        || !v.get("casks").is_some_and(Value::is_array)
    {
        return Err("请选择 brew info --json=v2 --installed 生成的 JSON".into());
    }
    let mut out = vec![];
    for (group, kind) in [("formulae", "formula"), ("casks", "cask")] {
        for item in v[group].as_array().unwrap() {
            let token = item[if kind == "formula" {
                "full_name"
            } else {
                "token"
            }]
            .as_str()
            .ok_or("缺少包名")?;
            let installed = &item["installed"];
            let versions = if let Some(items) = installed.as_array() {
                items
                    .iter()
                    .filter_map(|v| v["version"].as_str().or_else(|| v.as_str()))
                    .map(String::from)
                    .collect::<Vec<_>>()
            } else {
                installed
                    .as_str()
                    .map(|s| vec![s.to_string()])
                    .unwrap_or_default()
            };
            if versions.is_empty() {
                continue;
            }
            let fields = BTreeMap::from([
                ("version".into(), versions.join(", ")),
                ("manager".into(), "homebrew".into()),
                ("package_kind".into(), kind.into()),
                ("path".into(), format!("brew://{kind}/{token}")),
            ]);
            out.push(asset(
                env,
                "brew",
                &format!("{kind}/{token}"),
                token,
                fields,
            ));
        }
    }
    Ok(out)
}
pub fn git(root: &Path, depth: u32, env: &str) -> Result<Vec<Asset>> {
    if depth > 5 {
        return Err("扫描深度上限为 5".into());
    }
    if !root.is_dir()
        || root
            .symlink_metadata()
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("请选择有效的非符号链接目录".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut out = vec![];
    let mut visited = 0;
    walk(&root, depth, env, &mut out, &mut visited)?;
    Ok(out)
}
fn walk(p: &Path, depth: u32, env: &str, out: &mut Vec<Asset>, visited: &mut usize) -> Result<()> {
    *visited += 1;
    if *visited > 20000 {
        return Err("目录过多，请缩小扫描范围".into());
    }
    if p.join(".git").exists() {
        let run = |args: &[&str]| -> Result<String> {
            let o = Command::new("git")
                .arg("--no-optional-locks")
                .arg("-C")
                .arg(p)
                .args(args)
                .output()
                .map_err(|e| e.to_string())?;
            if !o.status.success() {
                return Err(format!("无法读取 Git 仓库：{}", p.display()));
            }
            Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
        };
        let fields = BTreeMap::from([
            ("commit".into(), run(&["rev-parse", "HEAD"])?),
            (
                "branch".into(),
                run(&["rev-parse", "--abbrev-ref", "HEAD"])?,
            ),
            ("path".into(), p.to_string_lossy().into_owned()),
            ("manager".into(), "git".into()),
        ]);
        out.push(asset(
            env,
            "git",
            &p.to_string_lossy(),
            &p.file_name().unwrap_or_default().to_string_lossy(),
            fields,
        ));
        return Ok(());
    }
    if depth == 0 {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(p)
        .map_err(|e| e.to_string())?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || ["node_modules", "vendor", "target", "__pycache__"].contains(&name.as_str())
        {
            continue;
        }
        if e.file_type().map_err(|e| e.to_string())?.is_dir() {
            walk(&e.path(), depth - 1, env, out, visited)?;
        }
    }
    Ok(())
}
pub fn validate_preview(s: &Snapshot, assets: &[Asset]) -> Result<()> {
    let mut combined = s.clone();
    for a in assets {
        combined.assets.retain(|x| x.id != a.id);
        combined.assets.push(a.clone());
    }
    validate(&combined)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn brew_versions_and_stability() {
        let text = r#"{"formulae":[{"full_name":"git","installed":[{"version":"2.5"}]}],"casks":[{"token":"test","installed":"1.0"}]}"#;
        let a = brew(text, "env").unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[1].fields["version"], "1.0");
        assert_eq!(a[0].id, brew(text, "env").unwrap()[0].id);
        assert_ne!(a[0].id, brew(text, "other").unwrap()[0].id);
        assert!(brew("{}", "env").is_err());
    }
    #[test]
    fn git_scan_does_not_modify_repo() {
        let dir = std::env::temp_dir().join(Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(&dir)
                    .args(args)
                    .output()
                    .unwrap()
                    .status
                    .success()
            );
        };
        run(&["init"]);
        run(&[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "initial",
        ]);
        let a = git(&dir, 1, "e").unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].fields["commit"].len(), 40);
        run(&["diff", "--exit-code"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
