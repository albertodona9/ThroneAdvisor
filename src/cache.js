// Tiny TTL cache on top of localStorage, used to skip Firestore reads: the aggregate documents
// (scores, live status) and the user's profile are kept on the phone and reused while they
// are younger than a limit chosen by the caller. Works in a normal tab too; an installed
// PWA just keeps it longer (Safari clears the storage of ordinary sites after ~7 days).
// Everything is best-effort: private mode, a full disk or corrupt data simply mean "no cache".

const PREFIX = "throneadvisor.v1.";

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null; // accessing it can throw (blocked storage)
  } catch {
    return null;
  }
}

/** { value, at } if there is an entry younger than maxAgeMs, else null. */
export function readCache(key, maxAgeMs, { now = Date.now(), storage = defaultStorage() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw);
    if (typeof at !== "number") return null;
    if (at > now + 60_000) return null; // written "in the future": the clock was changed, don't trust it
    if (now - at > maxAgeMs) return null;
    return { value: v, at };
  } catch {
    return null;
  }
}

export function writeCache(key, value, { now = Date.now(), storage = defaultStorage() } = {}) {
  if (!storage) return;
  try {
    storage.setItem(PREFIX + key, JSON.stringify({ at: now, v: value }));
  } catch {
    // quota exceeded / blocked: caching is an optimisation, never a requirement
  }
}

export function clearCache(key, { storage = defaultStorage() } = {}) {
  try {
    storage?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
