import { describe, expect, it } from "vitest";
import { clearCache, readCache, writeCache } from "../src/cache.js";

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
};

describe("cache", () => {
  it("returns a value younger than the limit, with the time it was written", () => {
    const storage = fakeStorage();
    writeCache("stats", { a: 1 }, { now: 1_000, storage });
    expect(readCache("stats", 5_000, { now: 4_000, storage })).toEqual({ value: { a: 1 }, at: 1_000 });
  });

  it("ignores entries older than the limit", () => {
    const storage = fakeStorage();
    writeCache("stats", { a: 1 }, { now: 1_000, storage });
    expect(readCache("stats", 5_000, { now: 6_001, storage })).toBeNull();
    expect(readCache("stats", 5_000, { now: 6_000, storage })).not.toBeNull(); // exactly at the limit still counts
  });

  it("ignores entries from the future (clock was changed)", () => {
    const storage = fakeStorage();
    writeCache("stats", 1, { now: 10 * 60_000, storage });
    expect(readCache("stats", 60_000, { now: 1_000, storage })).toBeNull();
  });

  it("returns null for missing, corrupt or malformed entries instead of throwing", () => {
    const storage = fakeStorage();
    expect(readCache("nope", 1000, { storage })).toBeNull();
    storage.setItem("throneadvisor.v1.bad", "{not json");
    expect(readCache("bad", 1000, { storage })).toBeNull();
    storage.setItem("throneadvisor.v1.odd", JSON.stringify({ v: 1 }));
    expect(readCache("odd", 1000, { storage })).toBeNull();
  });

  it("can be cleared", () => {
    const storage = fakeStorage();
    writeCache("stats", 1, { storage });
    clearCache("stats", { storage });
    expect(readCache("stats", 1e9, { storage })).toBeNull();
  });

  it("never throws when storage is unavailable or full", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => writeCache("k", 1, { storage: broken })).not.toThrow();
    expect(readCache("k", 1000, { storage: broken })).toBeNull();
    expect(() => clearCache("k", { storage: broken })).not.toThrow();
    expect(readCache("k", 1000, { storage: null })).toBeNull();
  });

  it("keeps entries separate per key", () => {
    const storage = fakeStorage();
    writeCache("stats.dtu", 1, { storage });
    writeCache("profile.alice", 2, { storage });
    expect(readCache("stats.dtu", 1e9, { storage }).value).toBe(1);
    expect(readCache("profile.alice", 1e9, { storage }).value).toBe(2);
  });
});
