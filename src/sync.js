// Loading and refreshing the two aggregate documents. Each refresh is ONE document read.
import { CAMPUS, LIVE_POLL_MS, STALE_REFETCH_MS, STATS_POLL_MS } from "./config.js";
import { fetchLive, fetchStats } from "./api.js";
import { db } from "./firebase.js";
import { state, update } from "./store.js";

let started = false;

export async function refreshStats() {
  try {
    update({ stats: await fetchStats(db, CAMPUS.id), lastStatsAt: Date.now(), offline: false });
  } catch (e) {
    console.warn("stats refresh failed", e);
    update({ offline: true });
  }
}

export async function refreshLive() {
  try {
    update({ live: await fetchLive(db, CAMPUS.id), lastLiveAt: Date.now(), offline: false });
  } catch (e) {
    console.warn("live refresh failed", e);
    update({ offline: true });
  }
}

export const refreshAll = () => Promise.all([refreshStats(), refreshLive()]);

/** Polls only while the tab is visible; refetches on return if the data got old. */
export function startSync() {
  if (started) return;
  started = true;
  const visible = () => document.visibilityState === "visible";
  setInterval(() => visible() && refreshLive(), LIVE_POLL_MS);
  setInterval(() => visible() && refreshStats(), STATS_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!visible()) return;
    const now = Date.now();
    if (now - state.lastLiveAt > STALE_REFETCH_MS) refreshLive();
    if (now - state.lastStatsAt > STALE_REFETCH_MS * 2) refreshStats();
  });
}
