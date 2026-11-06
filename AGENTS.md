# AGENTS.md

项目背景见 [BRIEF.md](BRIEF.md) 和 [GLOSSARY.md](GLOSSARY.md)。

## GitHub Actions 额度约束（必须遵守）

账户是 GitHub Free，私有仓库每月只有 $12 的 Actions 额度，用完后 Actions 会被暂停（预算为 $0，不会扣费）。macOS runner 单价约为 Linux 的 10 倍，是主要开销。

- **macOS 版本只在本机构建**：构建、测试、签名、打包、上传都在本机 Mac 上做。不要在私有仓库的工作流里使用 `macos-*` runner，检查、测试、发布工作流都一样。
- **不要定时任务**：不要添加 `schedule` / cron 触发的工作流，发布只能手动触发。
- 新增或修改工作流前，先确认不会加回 macOS runner 或定时触发；拿不准就先问用户。
- 公开仓库的 Actions 免费，不受以上额度限制。
- 本项目现状：`verify.yml` 只在 push 时跑 Linux 前端检查和 Windows 打包；macOS 包用本机 `bun run tauri build --bundles app` 构建。
