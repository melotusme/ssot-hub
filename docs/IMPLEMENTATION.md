# Tauri 重建计划

> 2026-11-01 更新：桌面 SQLite 写入口保持不变；Web/PWA 新增 IndexedDB 事务入口，已不再是预览。Snapshot v2 兼容 v1 读取，新增成员、使用记录、存储、域名、VPS、Agent、课程。当前模型见 GLOSSARY.md，当前同步见 SYNC-CONTRACT.md。下文保留原桌面实现说明。

技术栈：Tauri 2 + React + TypeScript + Rust + SQLite。使用官方 create-tauri-app 初始化。

## 数据与边界

- 桌面端 Rust 为唯一写入入口，SQLite 位于系统应用数据目录。
- 设备、系统环境、软件安装、配置、账号、号码、eSIM、订阅以稳定 UUID 登记。
- 结构化引用与显式关系统一校验；引用阻止删除，退役保留历史。
- 每次写入资产、关系和审计在同一事务完成；写入携带修订号，拒绝覆盖过期视图。
- 备份与导出使用带版本号的 JSON 快照，恢复在空台账完成，旧数据先备份。
- 导入预览与写入分离。Git 扫描范围由用户选择，不拉取远端。
- 不存明文凭据；仅应用快捷键模块按用户确认写回所选源码，不自动改系统配置。浏览器预览只用于界面查看，不冒充桌面持久化。

## 界面

采用浅色桌面工作台：左侧分类导航，中间列表与统计，右侧资产详情。青绿色为主色，系统字体，无在线字体依赖。表单使用可见标签与分组；空状态明确，无预置真实数据。键盘可操作，错误就地展示，原生文件对话框用于快照与扫描。

## 交付与验证

以 Rust 数据层测试、TypeScript 编译、前端构建、Tauri 原生构建与桌面启动作为验证。旧 Python 代码和数据库移出工作目录保存在同级 legacy 备份。原始 BRIEF 保留，README 重写，现有实现与目标差距如实记录。

## 快捷键源码模块

`src-tauri/src/shortcuts.rs` 用非执行 lexer 与 span 解析声明表。编辑只替换标量或插入字段，不重排整个文件。所有快捷键 IPC 都返回错误字符串供界面展示；路径规范化后以 SHA256 检查读写版本。保存采用进程内锁、私有备份、同目录临时文件与 rename，保持原权限。外部进程仍可能在最后检查和 rename 的极短窗口竞争；本功能不宣称提供跨进程文件锁。

### Tauri IPC 契约

| 命令                   | 参数                     | 返回 / 行为                                                                                           |
| ---------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `shortcut_source`      | `path: string或null`     | Source：path、engine、revision、groups、shortcuts、reserved、warnings；null 读取默认 Hammerspoon 文件 |
| `shortcut_preview`     | `path, revision, change` | Preview：path、revision、before、after；零写入，版本不符报错                                          |
| `shortcut_save`        | `path, revision, change` | Source；版本校验、备份再写回；无变化不写文件                                                          |
| `shortcut_create_ahk`  | `path`                   | Source；以 create_new 写入 AHK v2 模板，已有文件拒绝覆盖                                              |
| `shortcut_application` | `path`                   | `[规范化app路径, bundleID]`；macOS 只读应用包元数据，不启动应用                                       |

`Change` 为 `{id: string或null, group, key, mods: string[], app, bundle_id, match_window}`。id=null 新增，非空修改原声明；id 是当前源码位置标识，只能搭配读取时的 revision 使用。`Source.shortcuts` 每项另有 advanced、line。高级条目禁止变更 app / bundle_id。

Lua 使用 `local app_shortcuts = { group = { {key="E", app="/Applications/Editor.app"} } }` 与 `local default_mods = {"cmd","ctrl"}`。AHK2 使用 `ssot_launchers := [ {key: "^!e", app: "C:\Editor\editor.exe", match: "ahk_exe editor.exe"} ]`。解析不运行用户脚本；动态字段安全拒绝，其他逻辑保留。GUI 不自动重载脚本。快捷键不进入 SQLite 或资产快照；跨机配置同步由源码仓库承担。

`RecordList` 负责关键字搜索、维度筛选接入、排序、每页10/20/50/100、完整分页与独立偏好恢复。资产、关联、导入预览、变更历史、快捷键和删除引用均接入。当前本地台账整体载入，按完整快照筛选排序后分页。
