# 0.2.2 预览发布回读

日期：2026-11-01。

- Release：<https://github.com/melotusme/ssot-hub/releases/tag/v0.2.2-preview.1>，已发布的 prerelease，非 draft。仓库仍为私有。
- 三个平台固定源码 `61bc3a3f56029d56eeff128d9d79494ee999c39f`。CI <https://github.com/melotusme/ssot-hub/actions/runs/41321699152> 的 Web、macOS ARM64、Windows x64 均成功。
- 从 Actions 下载后核对：macOS 可执行文件为 Mach-O ARM64，Info.plist 为 0.2.2，`codesign --verify --deep --strict` 通过，仍仅 ad-hoc 签名。Windows 安装器为 NSIS（stub 为 PE32）；CI 对内部应用 PE machine `0x8664` 检查通过。Web 包 Service Worker 缓存为 `ssot-shell-v0.2.2`。
- 上传后重新下载三个包和 `SHA256SUMS`，`shasum -a 256 -c` 全部通过。
- 本轮没有替换本机已安装应用。安装命令见 [INSTALL.md](INSTALL.md)。没有 Homebrew tap、没有应用内更新。

| 发布资产 | SHA-256 |
| --- | --- |
| SSOT.Hub.macos.arm64.tar.gz | 4dcffc813a544c255feb256f556414f851820be77875c3a06315fdabc424d125 |
| SSOT.Hub.windows.x64.exe | 1a8db7347dcc321c3666000cf1dd58b5c3194a39140f08feb7feed0cb8b91e5e |
| SSOT.Hub.web.zip | 86e2051f2108833754581f1529f735545c80c82185c1e3a5e3a4dd779a5f075d |

本地前端 24 项测试通过。本机 Cargo 因 crates 镜像 404 未能离线复跑；CI 的 `cargo test --locked` 已通过。
