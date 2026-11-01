# 0.2 验证与边界

日期：2026-11-01。本次保留原 SQLite、旧工作空间、快捷键源码逻辑，不导入真实家庭资料。

## 已完成

- TypeScript + Vite 构建通过。
- Vitest 22 项、9 个文件通过：新增模型、日期区间、共用、产权分离、课时、硬盘引用、网络候选 MAC 去重 / VM 提示、加密随机性 / 错误口令 / 篡改、IndexedDB 重开与并发事务、同步坏快照回滚；原有列表 / 快捷键 / 登记回归。UI → IndexedDB 集成测试覆盖家人 A 交接给 B、B 的备用用途、旧区间保留及重新挂载读回（fake-indexeddb，不代替真机 UI）。
- Rust 18 项通过：含真实 SQLite 原子交接、过期 revision 拒绝、区间冲突、课程、存储引用、同步替换前备份 / 备份失败不写库；原有快捷键源码测试不改实际文件。
- Postman CLI 1.74.0 本地 HTTP 模拟：真实 `browserTransport` + 加密函数执行创建目录、首次 PUT/GET、未知/旧云端版本拒绝、远端写前备份、更新回读及 HTTP 503。没有使用真实云端凭据。复现：启动 `postman simulation run postman/simulations/webdav.sim.yaml --port 4019 --no-history`，另一终端 `bun scripts/verify-sync.ts`。
- ego-browser 真实浏览器：登记虚构家庭笔记本，刷新读回，证实 Web IndexedDB 持久化，不是内存演示。
- Rust Clippy 全目标 `-D warnings` 通过。本地 macOS ARM64 `.app` 构建、ad-hoc 签名和严格验签通过，未覆盖已安装旧版；这不是 Apple Developer ID 签名或公证。
- 私有仓库 `melotusme/ssot-hub` 已创建并核实 `isPrivate: true`。首轮 [Actions 41284884819](https://github.com/melotusme/ssot-hub/actions/runs/41284884819) 的 Web、macOS、Windows 测试与打包全部成功，源码为 `c2c798adc61e6aac5730a29e126fbd054d1f2188`。最终预览包采用后续同一提交的全绿构建，见 Release 记录。
- 源码发布前扫描常见密钥格式未命中；排除 SQLite、真实清单、.serena、环境文件和依赖缓存。样例仅测试资料。

## 尚未核实

- 真实 WebDAV / 坚果云账号、CORS 与条件写语义。当前是手动串行同步，不自动双向合并，不承诺原子多端并发。
- 家庭主路由器 SSH 可连接但当前密钥认证被拒绝；未获取当前硬件清单，也未修改任何网络配置。旧 DHCP 文件不当作当前硬件清单导入。
- Android / iOS 当前为 Web/PWA 方案，无 APK/IPA、无商店发布、无真机安装验证。私有 HTTPS Web 托管未选择。
- 浏览器验收任务空间中途消失，已停止浏览器操作并请求用户允许重建；手机布局、离线 PWA 和真实浏览器完整交接暂未完成。不会用自动化集成测试冒充这些结果。
- Apple 公证、Windows Authenticode、应用内签名更新尚未配置；CI 构建不等于实体设备安装验收。

## 构建环境

旧 node_modules 与 Cargo target 在 macOS 读文件时卡住。旧依赖保留为 `node_modules.pre-assets-20261101/`，已从 Git/Vite/Vitest 排除；全新依赖与隔离 Cargo target 构建通过，不改全局配置。Node 26 与 jsdom 的 localStorage 冲突通过仅限测试的 Storage 实现隔离；IndexedDB 测试采用 fake-indexeddb，浏览器持久化另做真实验证。

更改前源码压缩备份位于本机临时目录，不入仓库。当前数据和普通 JSON 备份仍未静态加密；同步导出才加密。备注不能自动识别所有秘密，请勿填写密码或 Token。
