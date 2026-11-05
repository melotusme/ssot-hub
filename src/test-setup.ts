// Node 26's experimental global localStorage shadows jsdom's Window property.
// Bind the actual jsdom implementation in DOM tests only.
if (typeof window !== "undefined") {
  const storage = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        values.set(k, String(v));
      },
      removeItem: (k) => {
        values.delete(k);
      },
      key: (i) => Array.from(values.keys())[i] ?? null,
    };
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage(),
  });
}

// Frontend tests use the schema the Rust backend serves (kept current by a cargo test).
import { installSchema, type Schema } from "./model";
import schema from "../src-tauri/tests/fixtures/schema.json";
installSchema(schema as unknown as Schema);
