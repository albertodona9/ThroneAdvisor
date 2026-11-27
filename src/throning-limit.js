import { readCache, writeCache } from "./cache.js";

export const THRONING_INTERVAL_MS = 30 * 60_000;
const LAST_THRONING_KEY = "last-throning";

export class ThroningCooldownError extends Error {
  constructor(remainingMs) {
    super("There is no way you are so stinky.");
    this.name = "ThroningCooldownError";
    this.remainingMs = remainingMs;
  }
}

export function throningCooldownRemaining(lastAt, now = Date.now()) {
  return Math.max(0, Math.ceil((lastAt + THRONING_INTERVAL_MS - now)));
}

export function assertThroningAllowed(now = Date.now()) {
  const cached = readCache(LAST_THRONING_KEY, THRONING_INTERVAL_MS, { now });
  const lastAt = cached?.at ?? 0;
  const remainingMs = throningCooldownRemaining(lastAt, now);
  if (remainingMs > 0) throw new ThroningCooldownError(remainingMs);
}

export function recordThroning(now = Date.now()) {
  writeCache(LAST_THRONING_KEY, true, { now });
}

export function cooldownLabel(remainingMs) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
