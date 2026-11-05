# SSOT Hub

个人与家庭资产台账。Tauri 2 桌面应用（Rust + SQLite + React 界面），保留旧版数据与快捷键源码编辑。自 2026-11-05 起只在桌面编辑：字段、校验和业务规则只在 Rust 实现一份，Web/PWA 版已移除。

## 0.2 家庭资产

- 家庭成员与组织独立登记，设备产权与使用人分开。设备类型涵盖电脑、手机、平板、笔记本、迷你主机、ESP32、投影设备、路由器、硬盘盒。
- 使用记录关联成员和设备，标识主力 / 备用 / 共用 / 借用，保存 `[开始日期, 结束日期)`。详情「交接给另一位成员」原子结束旧记录并创建新记录。拒绝重叠独占、重复成员、无效引用；日期精度为天，交接日须晚于原开始日。
- 硬盘独立登记容量、接口、序列号与所在设备 / 硬盘盒；系统环境关联硬盘与分区，支持多系统。VM 与物理设备分开。
- 域名登记注册商、DNS、账号、服务器、续费；VPS 登记地域、配置与续费；Muse / Grok BOT 等个人 Agent 关联环境、账号、服务器、订阅和配置。
- Telegram、GitHub、Google、WhatsApp、Facebook、Meta AI、邮箱均按身份账号登记；「登录于」建立账号到多台设备的关系。订阅按软件 / AI / 科学上网 / 服务器分类，密钥只存保险库引用。
- 班课关联孩子，记录机构、科目、老师、排课、课时、费用和有效期；剩余课时自动计算。
- 路由器清单导入支持 dnsmasq leases / 爱快 JSON 数组：先预览、跨页多选、按 MAC 去重、VM 提示、保留人工信息。网络观测不是硬件型号或使用人证明，离线设备须补录。

先登记成员 → 设备 / 存储 → 分配使用人 → 系统 / 账号 / 服务 → 课程。详情支持双向关系跳转、使用历史；全部列表共用筛选、排序、分页及独立偏好。

## 多端与加密同步

桌面用系统应用目录里的 SQLite，不自动移动或覆盖原数据库。v1 / v2 快照向前兼容，写入 v3 后不要用旧客户端编辑。字段定义在 `src-tauri/src/schema.rs`，界面启动时通过 `schema` 命令取回；前端调用类型 `src/bindings.ts` 由 tauri-specta 从 Rust 命令生成。

「数据与备份」支持加密文件交接、手动 WebDAV 上传 / 下载、下载预览、冲突检测、远端写前备份及写后回读、本地恢复点。AES-256-GCM + PBKDF2 口令至少 12 字符，口令和 WebDAV 应用密码仅在内存。丢失口令不能找回。连接 URL / 用户名留本机；列表分页与排序可同步；快捷键源码和文件选择路径不随快照同步。

WebDAV 需要 HTTPS，请求由 Rust 后端发出。0.2.1 新增「复用本机 Clash Verge WebDAV」，后端只读解密原客户端连接，密码不返回页面，调用绑定原账号 / 站点 / SSOT-Hub 目录。已有坚果云连接已用临时测试文件验证真实加密读写，正式台账未自动上传。一次只在一端编辑，不自动合并并发分叉；服务端不执行条件头时无法保证原子多写者安全。详见 [同步契约](docs/SYNC-CONTRACT.md)。

Windows / macOS 有 Tauri 构建流水线。不提供手机端；以后可能增加"导出只读页面"供手机查看（见 [重构设计](docs/REDESIGN.md)）。

## 开发与构建

私有源码：[melotusme/ssot-hub](https://github.com/melotusme/ssot-hub)。预览版的下载、校验、安装和平台边界见 [安装说明](docs/INSTALL.md)。发布仅包含代码和空台账，不包含本机设备、账号或数据库。

需要 Node.js 22.12+（或 Bun）、Rust stable、系统 Tauri 开发依赖。macOS 需要 Command Line Tools。

```sh
bun install
bun run tauri dev
```

```sh
bun run build
bun run test
cargo test --manifest-path src-tauri/Cargo.toml
bun run tauri build --bundles app
```

`bun run tauri dev` 启动桌面版。`bun run dev` 只启动前端开发服务器，单独在浏览器打开会提示只能在桌面运行。改了 Rust 命令或 schema 后运行 `UPDATE_BINDINGS=1 UPDATE_SCHEMA=1 cargo test`（或 `sh scripts/cargo-isolated.sh test`）刷新 `src/bindings.ts` 与 `src-tauri/tests/fixtures/schema.json`，CI 会检查它们是否最新。

## 当前能力

- 原有八类资产与新增七类家庭 / 服务记录共用完整 CRUD、审计、引用保护。
- 新建、编辑、退役、搜索、状态与 30 天内到期筛选。
- 详情面板查询双向结构化引用和手工关联，可继续跳转；配置使用关系可以记录各环境的本地路径。
- 订阅保留原币、周期、汇率和日期；Rust Decimal 计算单周期本币费用，不混加月付与年付。
- SQLite 事务保存，写入校验修订号，过期视图拒绝写入；变更记录保留时间、来源与前后值。
- Homebrew JSON 导入、指定目录 Git 扫描：先预览，再确认整批写入，稳定 ID 去重，保留人工字段，不自动删除缺项。
- 删除预览、引用阻塞、先备份后删除；台账删除不操作真实软件或配置文件。
- JSON 备份、导出、预览与空库恢复。新工作空间创建前自动备份，旧数据库保留；活动空间指针跨重启保留。
- 默认空台账，可主动载入六项虚构示例。

## 应用快捷键：代码为唯一 SSOT

侧栏「应用快捷键」直接读取 Hammerspoon Lua 或 AutoHotkey v2 源码；快捷键不写入 SQLite，也不另存 JSON 配置。localStorage 记录上次文件路径、列表偏好，以及不含密码的同步连接信息；资产本身存于 SQLite。

- macOS 默认读取 `~/.hammerspoon/hotkeys.lua` 的 `app_shortcuts` 与 `default_mods` 字面量表；支持新增到已有分类、修改按键和选择 `.app`。
- 现有 Codex Cockpit、Chrome profile 等高级启动字段与函数原样保留。包含高级字段的条目只允许改快捷键；启动参数继续在源码维护。
- Windows 使用 **AutoHotkey v2**。「新建 AHK v2」生成 `ssot_launchers` 声明与 `SSOT_LaunchOrFocus` 函数：窗口存在则激活，否则启动应用。已有任意 AHK 脚本需人工整理成此声明格式，不会执行脚本来解析配置。
- 所有修改先预览，再确认写回同一文件。写入前校验 SHA256 修订、备份旧源码并原子替换；外部修改会拦截旧草稿。切回窗口会重新读取，仍可手动刷新。
- 备份位于应用数据目录 `backups/shortcuts/`，不会放进 Hammerspoon 加载目录。恢复时可手工用备份替换源码。
- 保存后 Hammerspoon 用现有 `⌘ Ctrl Shift R` 重载；AHK v2 重新运行脚本。应用不会自动执行或重载用户脚本。

当前 GUI 主键支持字母、数字与命名键（如 F1、space），至少一个修饰键。同文件声明重复与可识别的 Lua 字面量绑定会阻止保存；其他文件、动态注册及系统快捷键需自行核对。源码中的未知字段与注释保留；动态表达式安全拒绝编辑。

所有记录列表共用筛选、排序和分页组件，默认每页 20 条，可选 10 / 20 / 50 / 100；每个列表单独记住页大小与排序。当前台账为完整本地快照，筛选排序作用于全部记录后再分页。

## 登记顺序

1. 登记实体设备。
2. 登记系统环境并关联设备；VM / 模拟器可关联宿主环境。
3. 在对应环境登记软件或导入清单。
4. 补充账号、号码、eSIM、订阅、配置权威源。
5. 在详情中建立“登录于”“恢复号码”“使用路径”等关系。

同一软件的不同机器安装分别登记。同一配置权威源可以被多项软件引用，机器使用路径通过配置与环境的关系表达。

## 导入清单

在目标机器生成：

```sh
brew info --json=v2 --installed > brew.json
```

桌面端选择「导入清单」，选择所属系统环境，载入 JSON 预览后确认。`brew://` 是包标识，不是物理安装路径。

Git 扫描只读取用户所选目录，深度 0–5，跳过隐藏目录、符号链接、node_modules、vendor、target；只读取 HEAD 与分支，不读 remote，不联网，不修改仓库。扫描发现仓库后不继续向其内部递归。无提交或读取失败时整批报错。

## 数据位置与恢复

macOS 默认 `~/Library/Application Support/com.ssothub.desktop/`。其他平台使用 Tauri 的系统应用数据目录。当前数据库路径见「数据与备份」。

- `ssot.sqlite3`：初始工作空间。
- `workspace-<UUID>.sqlite3`：后来创建的工作空间。
- `active-workspace`：活动空间文件名；切换后重启继续使用。
- `backups/ssot-<时间>-<UUID>.json`：自动和手动备份。

推荐加密文件 / WebDAV 交接，真实资产数据不要提交源码仓库。普通 JSON 导出仍用于兼容恢复；一次只在一台机器编辑。不自动合并分叉。旧 Python 数据格式不兼容，不自动迁移。

导出使用新文件，已有路径不会被覆盖；如文件已存在，请重新选择名称。恢复要求资产、关系和审计均为空，避免误覆盖旧历史。

## 数据边界

仅管理元数据。密码、访问令牌、许可证明文与 eSIM 激活码应放保险库，本系统只保存 `op://`、`vault://` 等引用。备注没有自动秘密检测能力。数据库与快照未加密；Unix 新文件权限为 0600。删除当前登记不会抹除历史和旧备份。

## 尚未实现

后台自动双向同步、账号登录操作、软件卸载、后台续费提醒、并发合并、Windows / Linux 自动安装清单采集、旧 Python 库迁移、Android APK / iOS IPA。最新验证边界见 [0.2 验证记录](docs/VERIFICATION-0.2.md)。

产品目标见 [BRIEF.md](BRIEF.md)，实现约定见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

## 本机 Cargo 镜像兼容

本次构建发现用户全局 USTC Cargo 源返回 404。项目提供可选隔离 runner，仅复用 registry 缓存并使用独立 Cargo 配置，不修改全局设置：

```sh
bun run tauri dev --runner "$PWD/scripts/cargo-isolated.sh"
bun run tauri build --bundles app --runner "$PWD/scripts/cargo-isolated.sh"
```

默认应用构建位置：`src-tauri/target/release/bundle/macos/SSOT Hub.app`。
