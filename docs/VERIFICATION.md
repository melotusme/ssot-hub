# Tauri 重建验证记录

日期：2026-10-29。平台：本机 macOS / Apple Silicon。

## 自动验证

| 检查                                    | 结果                   |
| --------------------------------------- | ---------------------- |
| TypeScript + Vite 发布构建              | 通过                   |
| Vitest                                  | 2 个文件，3 项测试通过 |
| Rust 单元 / 数据层测试                  | 7 项通过               |
| Clippy（all-targets，警告视为错误）     | 通过                   |
| Prettier 检查                           | 通过                   |
| 隔离 Cargo runner shell 语法与 metadata | 通过                   |
| Tauri release app bundle                | 成功，约 5.92 MiB      |

Rust 测试覆盖事务失败回滚、过期修订号、引用校验与宿主循环、金额校验、删除前备份、备份失败不删除、关闭连接再打开的持久化、空库恢复、导入保留人工字段、Homebrew 稳定 ID、Git 扫描只读行为。

界面测试使用模拟 IPC，覆盖空状态、新增、刷新读回、搜索与详情；不将其作为原生 IPC 运行证据。

## 浏览器布局检查

通过 ego-browser 访问本地 Vite 页面，主动载入虚构示例，检查资产列表与详情跳转。960px 与 390px 视口的文档宽度均未超出视口。浏览器预览明确标注不能执行桌面数据操作，未使用 localStorage。

## 原生运行检查

- 启动发布版 `SSOT Hub.app`，确认加载 `tauri://localhost` 且没有浏览器预览提示。
- 在原生界面登记虚构设备，编辑为「验收示例 · 桌面持久化」，平台为 `macOS test`。
- 保存后退出应用并重新启动，原生列表读回相同中文名称与平台，修订号为 2。
- 在数据管理页确认本机 SQLite 路径。
- 通过「备份并创建」切换到空工作空间，界面确认 0 项资产、0 条关系、修订 0。
- 独立读取活动空间及备份，确认当前库为空，备份包含上述虚构登记。旧验收数据库保留。
- 交付时应用保持打开，显示空台账总览。

中文输入检查使用粘贴，避开 UI 自动化按键合成对中文输入的限制；本次未专项验证所有输入法的组合输入。

## 边界

Windows / Linux 原生构建、真实 Homebrew 安装清单、多机实际 Git 交接、系统文件对话框的完整导入导出流程未在本次逐项操作验收。导入解析、恢复与关系约束由上述自动测试覆盖。没有扫描用户真实软件与账号，没有修改现有同步工具或系统配置。

旧工程备份：`$HOME/Documents/ssot-hub-legacy-20261029-123411`。旧 Python 数据格式与新版不兼容，未自动迁移。

## 2026-10-30 应用快捷键增量

- TypeScript 编译与 Vite 发布构建通过。
- Vitest：4 个文件、9 项测试通过。包含源码预览后确认写回、外部 revision 更新拦截旧草稿、全量筛选后分页、分页排序独立持久化，以及原有资产登记流程。IPC 在这些界面测试中为 mock。
- 系统 Node 26.12.1 下 Vitest 卡在模块加载；本机已有 Node 24.22.1 执行相同套件正常。Bun 直接运行 Vitest 时 mock 行为不一致，不将该结果当作验收证据。
- Rust：15 项测试通过（原有 7 项 + 快捷键 8 项），覆盖真实 launcher fixture 无变化保真、局部字段写回、带尾部注释新增、AHK2 字符串往返、重复组合、过期 revision、备份原文。
- LuaJIT 对 launcher fixture 做字节码语法检查通过，未运行 Hammerspoon API。
- 测试不写入真实 `~/.hammerspoon/hotkeys.lua`；实际保存验收使用临时源码副本。Windows AHK v2 执行环境不可用，运行时行为未验收。

- Clippy `--all-targets -- -D warnings` 通过。

### 本次发布与原生验收

- 原有 release 缓存先出现长时间读盘，再在 Rust 读取依赖 metadata 时 SIGBUS。保留该缓存，改用 `CARGO_TARGET_DIR=/tmp/ssot-hub-target-20261030 CARGO_BUILD_JOBS=2` 全新构建，2m41s 完成 optimized release，成功生成 6.01 MiB `.app`。
- 新包复制回标准交付路径 `src-tauri/target/release/bundle/macos/SSOT Hub.app`，旧包保留为相邻 `SSOT Hub-before-shortcuts-20261030.app`。
- 原生 `tauri://localhost` 页面直接读出真实 Hammerspoon 的 23 项快捷键。默认20条，末页21–23条，搜索对全量生效。
- 使用 `/tmp/ssot-hub-native-hotkeys-20261030.lua` 完整源码副本，通过原生文件对话框选 Calculator.app，自动读到 `com.apple.calculator`，修改键为F12，预览后确认写回；原生列表读回 `Ctrl + Command + F12`。
- 独立文本 diff 确认仅目标声明行改变，所有其他原文逐字一致。应用数据目录 `backups/shortcuts/` 中的备份与原源码完全一致，修改后的完整副本通过 LuaJIT 语法检查。
- 编辑草稿打开后，从外部修改临时副本，点击预览实际收到“源码已被外部修改”错误，未覆盖。
- 原生新建 `/tmp/ssot-launchers-native-20261030.ahk`，新增 `Ctrl+Alt+E` / `C:\Windows\notepad.exe` / `ahk_exe notepad.exe`，预览并确认后文件与列表读回一致。未执行 Windows 脚本。
- 最后重新打开真实 Hammerspoon 源码，停留在第1页；SHA256 对照验收前记录一致。未重载 Hammerspoon、未执行任何新快捷键，资产台账仍为空。

- 标准交付包清理构建产物附带的扩展属性后完成本地 ad-hoc 签名，`codesign --verify --deep --strict` 通过。签名后退出再启动，应用快捷键页仍直接读回真实源码的23项，首页1–20条。该签名供本机使用，未做 Apple 公证或 Windows 签名。
