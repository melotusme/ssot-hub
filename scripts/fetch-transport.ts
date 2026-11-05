// Node fetch transport for the WebDAV verification scripts only.
// The app itself talks to WebDAV through the Rust `dav_request` command.
import type { DavConfig, Transport } from "../src/sync.ts";
const maxBytes = 20 * 1024 * 1024;
const encode = (b: Uint8Array) => Buffer.from(b).toString("base64");
export function browserTransport(config: DavConfig): Transport {
  const authorization =
    "Basic " +
    encode(new TextEncoder().encode(config.username + ":" + config.password));
  return async (url, method, body, condition) => {
    try {
      const r = await fetch(url, {
        method,
        body,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: authorization,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(condition ? { [condition.name]: condition.value } : {}),
        },
      });
      if (Number(r.headers.get("Content-Length")) > maxBytes)
        throw Error("云端文件超过 20 MB");
      const reader = r.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > maxBytes) {
            await reader.cancel();
            throw Error("云端文件超过 20 MB");
          }
          chunks.push(part.value);
        }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      return {
        status: r.status,
        body: new TextDecoder().decode(bytes),
        etag: r.headers.get("ETag"),
      };
    } catch {
      throw Error("WebDAV 请求失败：请检查 HTTPS、网络与 CORS；检查测试服务器");
    }
  };
}
