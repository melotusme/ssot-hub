import { describe, it, expect } from "vitest";
import { empty } from "./model";
import {
  encryptPayload,
  decryptPayload,
  davDirectory,
  validatePreferences,
} from "./sync";
describe("加密同步安全边界", () => {
  const pass = "test-only-passphrase-2026";
  it("跨端加解密、随机密文、错误口令和篡改拒绝", async () => {
    const payload = {
      snapshot: empty,
      preferences: {
        "ssot.list.assets.device": JSON.stringify({
          pageSize: 20,
          sort: "name",
          direction: "asc",
        }),
      },
    };
    const text = await encryptPayload(payload, pass);
    expect(text).not.toContain("preferences");
    expect(await decryptPayload(text, pass)).toEqual(payload);
    expect(await encryptPayload(payload, pass)).not.toBe(text);
    await expect(decryptPayload(text, "wrong-test-passphrase")).rejects.toThrow(
      /解密失败/,
    );
    const changed = JSON.parse(text);
    changed.ciphertext = "AA" + changed.ciphertext.slice(2);
    await expect(
      decryptPayload(JSON.stringify(changed), pass),
    ).rejects.toThrow();
  });
  it("短口令、本机路径偏好、URL 凭据拒绝", async () => {
    await expect(
      encryptPayload({ snapshot: empty, preferences: {} }, "short"),
    ).rejects.toThrow(/12/);
    expect(() =>
      validatePreferences({ "ssot.shortcuts.path": "private" }),
    ).toThrow();
    for (const url of [
      "http://example.com/",
      "https://user:pass@example.com/",
      "https://example.com/?token=x",
    ])
      expect(() => davDirectory(url)).toThrow();
    expect(davDirectory("https://example.com/dav")).toBe(
      "https://example.com/dav/SSOT-Hub/",
    );
  });
});
