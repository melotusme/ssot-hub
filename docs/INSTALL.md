# 0.2.2 预览版安装（preview.2 起由 CI 构建）

公开仓库：<https://github.com/melotusme/ssot-hub>，不需要 GitHub 登录。发行记录：<https://github.com/melotusme/ssot-hub/releases/tag/v0.2.2-preview.2>。

0.2.2 把快照写成版本 3，并增加资源副本、网络节点和盘点依据；旧的版本 1/2 快照仍可打开。升级前在旧版「数据与备份」保存备份。

这是桌面预览版（macOS / Windows），不是正式版。升级前在旧版「数据与备份」保存备份；v2 写入后不要用旧版修改数据。没有应用内自动更新。

## macOS Apple Silicon

`SSOT.Hub.macos.arm64.tar.gz` 包含 `.app`，不支持 Intel 原生运行。仅 ad-hoc 签名，未 Apple 公证；首次打开可能被 Gatekeeper 拦截。核对校验值和来源后，按 macOS「隐私与安全性」的单应用提示处理，不关闭全局安全保护。

```sh
base=https://github.com/melotusme/ssot-hub/releases/download/v0.2.2-preview.2
mkdir ssot-hub-0.2.2-mac && cd ssot-hub-0.2.2-mac
curl -fsSLO "$base/SSOT.Hub.macos.arm64.tar.gz" && curl -fsSLO "$base/SHA256SUMS"
grep '  SSOT.Hub.macos.arm64.tar.gz$' SHA256SUMS | shasum -a 256 -c -
tar -xzf SSOT.Hub.macos.arm64.tar.gz
codesign --verify --deep --strict 'SSOT Hub.app'
```

校验通过后退出旧版，将 `.app` 放入所选应用目录；若已有同名应用，先保存旧版副本。数据继续保留在 `~/Library/Application Support/com.ssothub.desktop/`。下载或启动临时包不等于本机已安装版本升级。

## Windows x64

`SSOT.Hub.windows.x64.exe` 为当前用户 NSIS 安装器。无 Authenticode 签名，可能显示 SmartScreen 提示；首次安装可能需要下载 WebView2。没有 Windows ARM64 原生包。

```powershell
$ssotDir = Join-Path $env:TEMP ('ssot-hub-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $ssotDir | Out-Null
$base = 'https://github.com/melotusme/ssot-hub/releases/download/v0.2.2-preview.2'
Invoke-WebRequest "$base/SSOT.Hub.windows.x64.exe" -OutFile (Join-Path $ssotDir 'SSOT.Hub.windows.x64.exe')
Invoke-WebRequest "$base/SHA256SUMS" -OutFile (Join-Path $ssotDir 'SHA256SUMS')
$lines = @(Get-Content (Join-Path $ssotDir 'SHA256SUMS') | Where-Object { $_ -match '^([0-9a-f]{64})  SSOT\.Hub\.windows\.x64\.exe$' })
if ($lines.Count -ne 1) { throw '缺少唯一校验值' }
$expected = ($lines[0] -split '\s+')[0]
$setup = Join-Path $ssotDir 'SSOT.Hub.windows.x64.exe'
if ((Get-FileHash $setup -Algorithm SHA256).Hash -ne $expected) { throw 'SHA-256 不匹配' }
Start-Process -FilePath $setup -Wait
```

按安装器完成安装。上述命令未在用户实体 Windows 上执行；CI 成功不等于实体设备验收。

## Web、Android、iOS

自 2026-11-05 起只在桌面编辑，`SSOT.Hub.web.zip` 和 Web/PWA 已不再提供。0.2.2 及更早的 Web 版若录入过数据，请先在旧 Web 版「数据与备份」导出快照，再在桌面版恢复。手机查看计划以"桌面导出只读页面"的方式提供，尚未实现。

## 同步

「数据与备份」→ 设置至少 12 字符加密口令 → 加密导出 / 导入，或填写 WebDAV HTTPS 目录和应用密码。先下载预览再确认替换；本机替换前保存恢复点。WebDAV 的 URL / 用户名留本机，密码与加密口令只保留在当前运行内存。

桌面可点击「复用本机 Clash Verge WebDAV」，只读取该客户端已有的 AES-GCM 加密连接。密码不返回页面，不复制到 SSOT 配置，不修改原客户端。每次请求限制在原账号、原 HTTPS 站点的 `SSOT-Hub/` 目录。连接来源标记留在本机，不同步给其他设备；没有 Clash Verge 的设备可手动填应用密码。

坚果云已使用独立临时文件完成真实加密读写、冲突、备份、回读与清理；正式 `vault.json` 没有初始化。首次正式上传还需要你在应用中设置独立的至少 12 字符同步口令，请不要使用路由器弱密码。

当前仅手动串行交接，不自动合并多人同时修改。坚果云实测不严格执行首次创建条件 `If-None-Match: *`，因此仍不可多端同时上传。WebDAV 请求由桌面后端发出，不受浏览器 CORS 限制。
