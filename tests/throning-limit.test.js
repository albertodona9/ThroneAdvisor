import { describe, expect, it } from "vitest";
import { THRONING_INTERVAL_MS, cooldownLabel, throningCooldownRemaining } from "../src/throning-limit.js";

describe("local throning cooldown", () => {
  it("requires the full 30 minutes between counted sessions", () => {
    const lastAt = 1_000_000;
    expect(throningCooldownRemaining(lastAt, lastAt)).toBe(THRONING_INTERVAL_MS);
    expect(throningCooldownRemaining(lastAt, lastAt + THRONING_INTERVAL_MS - 1)).toBe(1);
    expect(throningCooldownRemaining(lastAt, lastAt + THRONING_INTERVAL_MS)).toBe(0);
  });

  it("rounds the wait up to a human-readable minute", () => {
    expect(cooldownLabel(1)).toBe("1 minute");
    expect(cooldownLabel(60_001)).toBe("2 minutes");
    expect(cooldownLabel(29 * 60_000)).toBe("29 minutes");
  });
});
