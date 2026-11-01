# 0.2.0 预览版安装

私有仓库：<https://github.com/melotusme/ssot-hub>。使用有权访问该仓库的 GitHub CLI 会话下载，不需要把 Token 写进应用。发行记录：<https://github.com/melotusme/ssot-hub/releases/tag/v0.2.0-preview.1>。

这是桌面 / Web 预览版，不是五平台正式版。升级前在旧版「数据与备份」保存备份；v2 写入后不要用旧版修改数据。没有应用内自动更新。

## macOS Apple Silicon

`SSOT.Hub.macos.arm64.tar.gz` 包含 `.app`，不支持 Intel 原生运行。仅 ad-hoc 签名，未 Apple 公证；首次打开可能被 Gatekeeper 拦截。核对校验值和来源后，按 macOS「隐私与安全性」的单应用提示处理，不关闭全局安全保护。

```sh
gh release download v0.2.0-preview.1 --repo melotusme/ssot-hub \
  --pattern SSOT.Hub.macos.arm64.tar.gz --pattern SHA256SUMS \
  --dir ssot-hub-0.2.0-mac
cd ssot-hub-0.2.0-mac
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
gh release download v0.2.0-preview.1 --repo melotusme/ssot-hub --pattern SSOT.Hub.windows.x64.exe --pattern SHA256SUMS --dir $ssotDir
if ($LASTEXITCODE -ne 0) { throw '下载失败' }
$lines = @(Get-Content (Join-Path $ssotDir 'SHA256SUMS') | Where-Object { $_ -match '^([0-9a-f]{64})  SSOT\.Hub\.windows\.x64\.exe$' })
if ($lines.Count -ne 1) { throw '缺少唯一校验值' }
$expected = ($lines[0] -split '\s+')[0]
$setup = Join-Path $ssotDir 'SSOT.Hub.windows.x64.exe'
if ((Get-FileHash $setup -Algorithm SHA256).Hash -ne $expected) { throw 'SHA-256 不匹配' }
Start-Process -FilePath $setup -Wait
```

按安装器完成安装。上述命令未在用户实体 Windows 上执行；CI 成功不等于实体设备验收。

## Web、Android、iOS

`SSOT.Hub.web.zip` 是静态站点，可部署到选定的私有 HTTPS 站点**根目录**。不要双击 `index.html` 使用，不要将真实数据、口令或 WebDAV 密码写进静态文件。源码仓库私有并不代表任意 Web 托管自动私有；部署前配置访问控制。

Android / iOS 目前走响应式 Web/PWA，可在站点开放后添加到主屏幕；无 APK / IPA，未真机验收。首次联网加载成功才有机会离线使用；浏览器清除数据会删除本地 IndexedDB 和恢复点。不同域名、浏览器、桌面版的数据彼此隔离，需显式同步。

## 同步

「数据与备份」→ 设置至少 12 字符加密口令 → 加密导出 / 导入，或填写 WebDAV HTTPS 目录和应用密码。先下载预览再确认替换；本机替换前保存恢复点。WebDAV 的 URL / 用户名留本机，密码与加密口令只保留在当前运行内存。

当前仅手动串行交接，不自动合并多人同时修改。Web 端需要服务商允许 CORS；如不支持，可用桌面端或加密文件交接。真实云端尚未连接或验收。
