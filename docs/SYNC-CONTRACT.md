# 同步契约 v1

## 载荷与边界

跨端共用 Snapshot v2；v1 在读取时升级，ID、字段、关系、审计保留。桌面使用 SQLite，Web/PWA 使用 IndexedDB。所有修改使用本地 revision 乐观锁，失败不写入；交接在一个事务内结束旧区间并创建新区间。

同步载荷为 `{snapshot, preferences}`。preferences 仅允许 `ssot.list.*` 的分页/排序设置，不包含快捷键文件选择路径、浏览器会话、主机凭据或快捷键源码。台账中人工登记的安装路径属于资产元数据，会加密同步。密码/Token/eSIM 激活码只允许保险库引用。

## 加密

使用 WebCrypto PBKDF2-SHA256（310000 次、随机 16 字节盐）派生 AES-256-GCM 密钥，随机 12 字节 nonce。加密格式 `{format:"ssot-encrypted-v1", salt, iv, ciphertext}`，字节按 Base64 编码。口令至少 12 字符，口令和 WebDAV 应用密码只在当前页面内存，不持久化、不回显。丢失口令不能恢复。HTTPS 不代替内容加密。

## WebDAV 适配

仅 HTTPS，无 URL 内嵌凭据/查询串/片段。使用用户指定根目录下 `SSOT-Hub/`：MKCOL 建目录；GET/PUT `vault.json`，写前 GET 取得内容指纹和 ETag。未知已有云端禁止覆盖，先预览下载；已知云端改变时报冲突。上传旧云端到独立 `backup-<UUID>.json` 后，PUT 主文件（If-Match / If-None-Match），随后 GET 验证内容一致。401/403、404、412、超时与非 JSON 单独报错。20 MB 上限，30 秒超时，禁止重定向携带凭据。

不假定服务端执行 ETag 条件头，不提供自动双向合并或原子多写者保证；默认手动上传/下载，一次只在一端编辑。下载必须先解密、校验并预览，明确确认后本地备份再替换。失败保留旧台账。离线继续本地编辑。

Web 端直接请求需要服务端允许 CORS（GET/PUT/MKCOL、Authorization、If-Match、If-None-Match，暴露 ETag）；不提供绕过浏览器安全限制的代理。无 CORS 可用桌面端或加密文件交接。真实存储位置由用户选择后接入，不默认上传数据。

## 验收

资产/课程/区间/引用校验、v1 读取、过期 revision 拒绝、跨 tab 事务、错误口令/篡改拒绝、下载失败不改库、备份恢复、WebDAV 冲突与写后核对分别测试。模拟服务不等于真实坚果云验证；构建不等于实体手机/Windows 安装验证。
