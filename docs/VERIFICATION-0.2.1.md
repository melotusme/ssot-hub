# 0.2.1 已有 WebDAV 与家庭资产验收

日期：2026-11-01。使用用户授权的本机已有坚果云连接、指定路由器，只读采集；个人清单在 Git 忽略的 `private/`，不入源码或发布包。

## 实际完成

- ego lite 中完成虚构设备从 A 的主力机交接给 B 的备用机，刷新后读回 B；设备详情保留 A 的 `2026-10-01 → 2026-11-01` 及 B 的持续使用记录。同日零长度交接被拒绝。日期控件的 CLI fill 未触发 React 状态时，改用标准 DOM input/change 事件后完成；没有修改 IndexedDB 来冒充界面操作。
- ego lite 375×812 纵屏和 812×375 横屏检查，文档宽度分别等于 375/812，无页面横向溢出；截图确认当前用途与历史可读。模拟断网、刷新后 Service Worker 接管，页面仍显示 B 的备用用途。不是 Android/iOS 真机或系统安装验收。
- 刷新到 0.2.1 后，在 ego lite 完成虚构台账的加密文件导出 → 文件选择器读取 → 5 项资产 / 7 条历史预览 → 备份后确认替换；修订由 7 变为 8，恢复点列表出现原 5 项台账，刷新后 B 的备用用途仍在。导出文件只有 format/salt/iv/ciphertext，没有明文测试资产或口令。
- 实际路由器候选文件在 ego lite 解析为 57 条，默认每页 20 条 / 3 页、已选 0 项；关键字筛选可定位单条记录，PVE / 随机 MAC 警示保留。仅预览后取消，没有把真实候选混入虚构测试台账；验收 TaskSpace 已关闭。
- 本机 Clash Verge 2.5.8 已有 AES-256-GCM WebDAV 配置只读解密，PROPFIND 返回 207。应用密码没有输出、进入 Git、回传桌面前端或另存 SSOT 文件；原配置哈希未变化。
- `scripts/verify-jianguoyun.ts` 用真实应用加密 / 同步函数，对唯一临时目录验证创建、首次 PUT/GET、解密、未知 / 过期指纹拒绝、写前备份、更新回读。错误 If-Match 返回 412；已有文件的 If-None-Match:* 返回 204，仍不支持原子多写者保证。测试文件和目录已清理。
- Rust `sync::tests::live_native_reused_connection_roundtrip` 显式启用后通过：实际 `dav_request` 后端读取已有加密凭据，临时路径 GET 404 → PUT 201 → GET 200 内容相同，临时文件删除。该测试默认 ignored，不在 CI 访问个人账户。
- 浏览器对坚果云请求失败；独立 OPTIONS 返回 401，无 Access-Control-Allow-Origin。保留浏览器安全限制，不增加绕过代理；Web/PWA 目前使用加密文件交接。
- 路由器只读取系统信息、DHCP 租约、静态绑定、LAN 邻居和 LAN MAC；没有改配置、重启或安装软件。候选清单区分各来源、未观测状态、虚拟 / 随机 MAC 提示，不推断实际型号、使用人或主备用途。
- 本地 24 项前端测试、20 项 Rust 常规测试和 Clippy 通过；另有 1 项显式真实云端 Rust 测试通过。

## 交付变化

桌面增加「复用本机 Clash Verge WebDAV」：返回非秘密连接元数据；每次请求后端读取密码并绑定原账号、站点和专用目录，拒绝路径逃逸。修改 URL / 用户名 / 密码即退出复用模式。浏览器不能读取本机客户端密钥，也不会显示这个入口。

新增只读路由器采集脚本（使用已有 SSH 会话，不存密码）及显式真实 WebDAV 验证脚本。路由器清单预览保留来源备注，并提示 PVE 常见 MAC 和本地管理地址；提示不等于实体 / VM 身份确认。

## 明确保留的边界

- 正式 `SSOT-Hub/vault.json` 没有初始化或覆盖。用户仍需在应用里设置至少 12 字符独立加密口令并确认实际资产；不能使用路由器弱密码作为同步口令。
- 没有把网络候选直接批量确认为实体设备，没有给家人编造归属；真实使用关系待用户确认。
- 新增桌面按钮有 UI 集成测试与真实原生后端测试，但本轮没有用原生桌面 UI 工具点击验收；Windows 本机已有 Clash Verge 的路径 / 凭据复用尚无实体机器验证。
- 无 APK / IPA、无手机真机安装、无私有 HTTPS Web 托管、无后台自动并发同步。签名 / 公证边界沿用预览版。

## 私有发布回读

- Release：<https://github.com/melotusme/ssot-hub/releases/tag/v0.2.1-preview.1>，已发布的 prerelease，非 draft，不设置 latest。
- 三个平台固定源码 `d7ecd7617bd86bb221c133aa4dad5e8b53f95f19`；tag 指向同一提交。CI <https://github.com/melotusme/ssot-hub/actions/runs/41312345373> 的 Web、macOS ARM64、Windows x64 均成功。
- 从 Actions 下载后检查包内容、版本和架构，再上传草稿并发布；随后重新下载 Release 的三个包和 SHA256SUMS，逐个 SHA-256 验证通过，清单与上传前一致。
- macOS 可执行文件为 Mach-O ARM64，Info.plist 版本 0.2.1，`codesign --verify --deep --strict` 通过，仍仅 ad-hoc 签名。Windows 是含 0.2.1 版本资源的 NSIS 安装器；安装器 stub 为 32 位，CI 对内部应用 PE machine 的 `0x8664` 检查通过。Web 包的 Service Worker 缓存版本为 0.2.1。
- 本轮没有替换用户已安装的应用；安装 / 升级命令见 [INSTALL.md](INSTALL.md)。本机验收预览服务及 ego lite TaskSpace 已停止，私有观测文件和恢复点保留。

| 发布资产 | SHA-256 |
| --- | --- |
| SSOT.Hub.macos.arm64.tar.gz | a8503cc49d5eee1903dc44f47dc041a5954ce70acd47d062a1a2d97aab29a14c |
| SSOT.Hub.windows.x64.exe | e228a5a57dcd0f0934f2964d96769faecc2ebd7ca1a982547ba63d74e2eadd3d |
| SSOT.Hub.web.zip | 68e02fe8e47f9b0ca229a3e55a5cfb381b22ed2f1915bc6d6c8e07404609cb3b |

## 复现入口

```sh
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
# 仅明确授权后运行。读取指定本机连接，临时测试数据，自动清理，不动正式台账。
bun scripts/verify-jianguoyun.ts '/path/to/existing/clash-verge-config'
SSOT_LIVE_DAV=1 cargo test --manifest-path src-tauri/Cargo.toml live_native_reused_connection_roundtrip -- --ignored --nocapture
# router 必须已经有可用的 SSH 认证 / ControlMaster；输出目录必须是新的私有目录。
node scripts/collect-router-inventory.mjs user@router /path/to/control-socket private/router-observation
```
