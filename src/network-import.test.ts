import { it, expect } from "vitest";
import { networkCandidates, candidateAsset } from "./network-import";
import { empty } from "./model";
it("路由器候选去重、VM 区分、保留人工标识", () => {
  const [c] = networkCandidates(
    '[{"mac":"02-00-00-00-00-01","ip_addr":"192.168.1.2","comment":"Omarchy%20(VM%20144)"},{"mac":"02:00:00:00:00:01","ip":"192.168.1.2","name":"Omarchy (VM 144)"}]',
  );
  expect(c.suggestedKind).toBe("environment");
  expect(c.mac).toBe("02:00:00:00:00:01");
  const a = candidateAsset(
    c,
    "environment",
    empty,
    "2026-11-01T00:00:00Z",
    "test",
  );
  expect(a.fields).not.toHaveProperty("owner_id");
  expect(
    candidateAsset(
      c,
      "environment",
      { ...empty, assets: [{ ...a, id: "manual-id" }] },
      "2026-11-01T00:00:00Z",
      "test",
    ).id,
  ).toBe("manual-id");
  expect(() =>
    candidateAsset(c, "device", { ...empty, assets: [a] }, "now", "test"),
  ).toThrow();
});
it("dnsmasq 清单与无效地址边界", () => {
  expect(
    networkCandidates("123 02:00:00:00:00:01 192.168.1.3 tablet *")[0].name,
  ).toBe("tablet");
  expect(() => networkCandidates('[{"mac":"invalid"}]')).toThrow(/MAC/);
  expect(() =>
    networkCandidates('[{"mac":"02:00:00:00:00:01","ip":"999.1.1.1"}]'),
  ).toThrow(/IPv4/);
});
