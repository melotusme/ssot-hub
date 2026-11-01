import { empty } from "../src/model.ts";
import {
  browserTransport,
  encryptPayload,
  decryptPayload,
  readRemote,
  uploadRemote,
} from "../src/sync.ts";
const base = "http://127.0.0.1:4019/webdav/";
const dir = base + "SSOT-Hub/";
// Loopback is a test fixture only; application config always requires HTTPS.
const transport = browserTransport({
  url: base,
  username: "test",
  password: "test",
});
const assert = (condition: unknown, message: string) => {
  if (!condition) throw Error(message);
};
await fetch(base + "reset", { method: "POST" });
const payload = { snapshot: empty, preferences: {} };
const body = await encryptPayload(payload, "local-test-password-2026");
const hash = await uploadRemote(dir, body, null, transport);
const remote = await readRemote(dir, transport);
assert(remote?.hash === hash, "roundtrip hash mismatch");
assert(
  (await decryptPayload(remote!.body, "local-test-password-2026")).snapshot
    .version === 3,
  "decrypt mismatch",
);
let rejected = false;
try {
  await uploadRemote(dir, body, null, transport);
} catch {
  rejected = true;
}
assert(rejected, "unknown version was overwritten");
const updated = await encryptPayload(payload, "local-test-password-2026");
await uploadRemote(dir, updated, hash, transport);
rejected = false;
try {
  await uploadRemote(dir, body, hash, transport);
} catch {
  rejected = true;
}
assert(rejected, "stale hash accepted");
await fetch(base + "fail", { method: "POST" });
rejected = false;
try {
  await readRemote(dir, transport);
} catch {
  rejected = true;
}
assert(rejected, "503 not surfaced");
console.log(
  "PASS: real app transport + encryption, initial PUT/GET, unknown/stale conflict, backup-before-write, update/readback, HTTP 503",
);
