import { uid, type Snapshot } from "./model";
export interface SyncPayload {
  snapshot: Snapshot;
  preferences: Record<string, string>;
}
export interface Envelope {
  format: "ssot-encrypted-v1";
  salt: string;
  iv: string;
  ciphertext: string;
}
const maxBytes = 20 * 1024 * 1024;
const encode = (b: Uint8Array) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  if (passphrase.length < 12)
    throw Error("同步口令至少 12 字符，请保存在密码管理器");
  if (!globalThis.crypto?.subtle)
    throw Error("加密需要 HTTPS 或 localhost 安全环境");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export function validatePreferences(
  preferences: unknown,
): asserts preferences is Record<string, string> {
  if (
    !preferences ||
    typeof preferences !== "object" ||
    Array.isArray(preferences)
  )
    throw Error("列表偏好格式无效");
  for (const [k, v] of Object.entries(preferences)) {
    if (
      !/^ssot\.list\.[\w.-]+$/.test(k) ||
      typeof v !== "string" ||
      v.length > 500
    )
      throw Error("同步包含不允许的本机配置");
    const p = JSON.parse(v);
    if (
      ![10, 20, 50, 100].includes(p.pageSize) ||
      !["asc", "desc"].includes(p.direction) ||
      typeof p.sort !== "string" ||
      !/^[\w.-]+$/.test(p.sort) ||
      Object.keys(p).some((k) => !["pageSize", "sort", "direction"].includes(k))
    )
      throw Error("列表偏好内容无效");
  }
}
export async function encryptPayload(
  payload: SyncPayload,
  passphrase: string,
): Promise<string> {
  validatePreferences(payload.preferences);
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  if (raw.length > maxBytes * 0.7) throw Error("快照过大，不能同步");
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(passphrase, salt),
    raw,
  );
  return JSON.stringify({
    format: "ssot-encrypted-v1",
    salt: encode(salt),
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  } satisfies Envelope);
}
export async function decryptPayload(
  text: string,
  passphrase: string,
): Promise<SyncPayload> {
  if (text.length > maxBytes) throw Error("同步文件超过 20 MB");
  const e = JSON.parse(text) as Envelope;
  if (
    e.format !== "ssot-encrypted-v1" ||
    ![e.salt, e.iv, e.ciphertext].every((s) => typeof s === "string")
  )
    throw Error("不是受支持的加密快照");
  const salt = decode(e.salt),
    iv = decode(e.iv);
  if (salt.length !== 16 || iv.length !== 12) throw Error("加密参数损坏");
  const k = await key(passphrase, salt);
  let raw;
  try {
    raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      k,
      decode(e.ciphertext),
    );
  } catch {
    throw Error("解密失败：口令不正确或文件被篡改，本地数据未更改");
  }
  const payload = JSON.parse(new TextDecoder().decode(raw)) as SyncPayload;
  validatePreferences(payload.preferences);
  return payload;
}
export async function fingerprint(text: string) {
  return encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  );
}
export interface DavConfig {
  url: string;
  username: string;
  password: string;
  source?: "clash-verge";
}
export interface DavResponse {
  status: number;
  body: string;
  etag: string | null;
}
export type Transport = (
  url: string,
  method: string,
  body?: string,
  condition?: { name: string; value: string },
) => Promise<DavResponse>;
export function davDirectory(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error("WebDAV 仅允许不含凭据、查询串的 HTTPS 目录");
  return u.href.replace(/\/?$/, "/") + "SSOT-Hub/";
}
function ok(r: DavResponse, statuses: number[]) {
  if (statuses.includes(r.status)) return;
  throw Error(
    [401, 403].includes(r.status)
      ? "WebDAV 认证或权限失败"
      : r.status === 412
        ? "云端版本冲突，请先下载核对"
        : `WebDAV 返回 HTTP ${r.status}`,
  );
}
export async function readRemote(dir: string, transport: Transport) {
  const r = await transport(dir + "vault.json", "GET");
  ok(r, [200, 404]);
  if (r.status === 404) return null;
  if (r.body.length > maxBytes) throw Error("云端文件过大");
  const e = JSON.parse(r.body);
  if (e.format !== "ssot-encrypted-v1")
    throw Error("云端不是 SSOT 加密快照，禁止覆盖");
  return { ...r, hash: await fingerprint(r.body) };
}
export async function uploadRemote(
  dir: string,
  text: string,
  knownHash: string | null,
  transport: Transport,
) {
  const create = await transport(dir, "MKCOL");
  ok(create, [200, 201, 204, 405]);
  const previous = await readRemote(dir, transport);
  if ((previous && previous.hash !== knownHash) || (!previous && knownHash))
    throw Error("云端已变化或尚未核对，请先下载预览；不会覆盖未知版本");
  if (previous) {
    const backup = await transport(
      dir + `backup-${uid()}.json`,
      "PUT",
      previous.body,
      { name: "If-None-Match", value: "*" },
    );
    ok(backup, [200, 201, 204]);
  }
  const condition =
    previous?.etag && !previous.etag.startsWith("W/")
      ? { name: "If-Match", value: previous.etag }
      : !previous
        ? { name: "If-None-Match", value: "*" }
        : undefined;
  ok(
    await transport(dir + "vault.json", "PUT", text, condition),
    [200, 201, 204],
  );
  const verify = await readRemote(dir, transport);
  if (!verify || verify.hash !== (await fingerprint(text)))
    throw Error("上传后回读不一致，可能有并发修改；请保留本地数据并核对云端");
  return verify.hash;
}
