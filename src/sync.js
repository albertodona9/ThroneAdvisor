// Loading and refreshing the two aggregate documents. Each real refresh is ONE document read.
//
// The last copy of each document is kept on the phone (src/cache.js). Opening the app within
// the cache's max age reuses it and reads nothing; the periodic polls always fetch (that is
// their point), and offline the last copy is shown however old it is.
import {
  CAMPUS,
  LIVE_MAX_AGE_MS,
  LIVE_POLL_MS,
  STALE_REFETCH_MS,
  STATS_MAX_AGE_MS,
  STATS_POLL_MS,
} from "./config.js";
import { fetchLive, fetchStats } from "./api.js";
import { clearCache, readCache, writeCache } from "./cache.js";
import { db } from "./firebase.js";
import { state, update } from "./store.js";

let started = false;

const statsKey = () => `stats.${CAMPUS.id}`;
const liveKey = () => `live.${CAMPUS.id}`;

/** Forget the cached copies: call after our own writes so the next open reads the truth. */
export const invalidateStats = () => clearCache(statsKey());
export const invalidateLive = () => clearCache(liveKey());

async function refresh({ key, maxAge, fetcher, field, stampField, force }) {
  if (!force) {
    const hit = readCache(key, maxAge);
    if (hit) {
      update({ [field]: hit.value, [stampField]: hit.at });
      return;
    }
  }
  try {
    const value = await fetcher(db, CAMPUS.id);
    writeCache(key, value);
    update({ [field]: value, [stampField]: Date.now(), offline: false });
  } catch (e) {
    console.warn(`${field} refresh failed`, e);
    // Offline or blocked: show the last copy we have, however old, rather than an empty map.
    const stale = readCache(key, Infinity);
    update(stale && !Object.keys(state[field]).length ? { [field]: stale.value, offline: true } : { offline: true });
  }
}

export const refreshStats = ({ force = false } = {}) =>
  refresh({ key: statsKey(), maxAge: STATS_MAX_AGE_MS, fetcher: fetchStats, field: "stats", stampField: "lastStatsAt", force });

export const refreshLive = ({ force = false } = {}) =>
  refresh({ key: liveKey(), maxAge: LIVE_MAX_AGE_MS, fetcher: fetchLive, field: "live", stampField: "lastLiveAt", force });

export const refreshAll = () => Promise.all([refreshStats(), refreshLive()]);

/** Polls only while the tab is visible; refetches on return if the data got old. */
export function startSync() {
  if (started) return;
  started = true;
  const visible = () => document.visibilityState === "visible";
  setInterval(() => visible() && refreshLive({ force: true }), LIVE_POLL_MS);
  setInterval(() => visible() && refreshStats({ force: true }), STATS_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!visible()) return;
    const now = Date.now();
    if (now - state.lastLiveAt > STALE_REFETCH_MS) refreshLive(); // reuses a cached copy that is still young enough
    if (now - state.lastStatsAt > STALE_REFETCH_MS * 2) refreshStats();
  });
}
