// Opt-in live test: synthetic data only; credentials stay in memory and source is read-only.
import { readFile } from "node:fs/promises";
import { createDecipheriv, randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { empty } from "../src/model";
import {
  browserTransport,
  davDirectory,
  encryptPayload,
  decryptPayload,
  readRemote,
  uploadRemote,
} from "../src/sync";
const source = process.argv[2];
if (!source)
  throw Error("Provide the existing Clash Verge config directory explicitly");
const raw = await readFile(join(source, "verge.yaml"), "utf8");
const key = await readFile(join(source, ".encryption_key"));
const field = (name: string) => {
  const found = raw.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
  if (!found) throw Error("Existing WebDAV connection is incomplete");
  const bytes = Buffer.from(found.replace(/^["']|["']$/g, ""), "base64");
  const decrypt = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decrypt.setAuthTag(bytes.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decrypt.update(bytes.subarray(12, -16)),
      decrypt.final(),
    ]).toString(),
  ) as string;
};
const config = {
  url: field("webdav_url"),
  username: field("webdav_username"),
  password: field("webdav_password"),
};
if (new URL(config.url).origin !== "https://dav.jianguoyun.com")
  throw Error("This opt-in test is restricted to Jianguoyun");
const root = davDirectory(config.url),
  dir = root + `verify-${randomUUID()}/`;
const passphrase = randomUUID() + randomUUID();
const authorization =
  "Basic " +
  Buffer.from(`${config.username}:${config.password}`).toString("base64");
const created = new Set<string>(),
  steps: object[] = [];
const rawTransport = browserTransport(config);
const transport: typeof rawTransport = async (url, method, body, condition) => {
  if (!url.startsWith(dir))
    throw Error("Live probe left its isolated directory");
  const r = await rawTransport(url, method, body, condition);
  steps.push({
    method,
    file: url.slice(dir.length),
    status: r.status,
    hasEtag: !!r.etag,
  });
  if (method === "PUT" && [200, 201, 204].includes(r.status)) created.add(url);
  return r;
};
const assert = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
const rootResult = await rawTransport(root, "MKCOL");
assert(
  [201, 405].includes(rootResult.status),
  "Cannot create/access dedicated app folder",
);
let directoryCreated = false;
try {
  const r = await rawTransport(dir, "MKCOL");
  assert(r.status === 201, "Probe directory is not new; refusing to touch it");
  directoryCreated = true;
  const body = await encryptPayload(
    { snapshot: structuredClone(empty), preferences: {} },
    passphrase,
  );
  const firstHash = await uploadRemote(dir, body, null, transport);
  const first = await readRemote(dir, transport);
  assert(first?.hash === firstHash, "Initial readback mismatch");
  assert(
    (await decryptPayload(first!.body, passphrase)).snapshot.assets.length ===
      0,
    "Decrypt mismatch",
  );
  let unknownRejected = false;
  try {
    await uploadRemote(dir, body, null, transport);
  } catch {
    unknownRejected = true;
  }
  assert(unknownRejected, "Unknown cloud overwritten");
  const updated = await encryptPayload(
    { snapshot: structuredClone(empty), preferences: {} },
    passphrase,
  );
  const secondHash = await uploadRemote(dir, updated, firstHash, transport);
  let staleRejected = false;
  try {
    await uploadRemote(dir, body, firstHash, transport);
  } catch {
    staleRejected = true;
  }
  assert(staleRejected, "Stale cloud overwritten");
  assert(
    (await readRemote(dir, transport))?.hash === secondHash,
    "Stale rejection changed data",
  );
  // Probe provider conditions only on our disposable file; retain the observed limitations.
  const conditionProbe = await transport(dir + "vault.json", "PUT", updated, {
    name: "If-Match",
    value: '"ssot-definitely-wrong-etag"',
  });
  const createProbe = await transport(dir + "vault.json", "PUT", updated, {
    name: "If-None-Match",
    value: "*",
  });
  console.log(
    JSON.stringify(
      {
        pass: true,
        provider: "Jianguoyun",
        scope: "synthetic isolated directory; no production vault touched",
        unknownRejected,
        staleRejected,
        ifMatchWrongStatus: conditionProbe.status,
        ifNoneMatchExistingStatus: createProbe.status,
        steps,
      },
      null,
      2,
    ),
  );
} finally {
  const failures: number[] = [];
  if (directoryCreated) {
    for (const url of [...created, dir]) {
      const r = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: authorization },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      await r.body?.cancel();
      if (![200, 204, 404].includes(r.status)) failures.push(r.status);
    }
  }
  const sourceUnchanged =
    createHash("sha256").update(raw).digest("hex") ===
    createHash("sha256")
      .update(await readFile(join(source, "verge.yaml")))
      .digest("hex");
  console.log(
    JSON.stringify({
      cleanup: failures.length ? "incomplete" : "complete",
      cleanupFailures: failures,
      sourceUnchanged,
    }),
  );
  assert(
    failures.length === 0 && sourceUnchanged,
    "Cleanup or source preservation check failed",
  );
}
