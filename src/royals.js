// The leaderboards of kings and queens (see fetchBoards in api.js): four top-3 boards, read together (12
// document reads) and kept on the phone for ROYALS_MAX_AGE_MS. A new week has its own key, so the weekly
// boards start over by themselves on Monday. Also the user's own entries (2 reads, kept in memory), which
// tell the app which toilets they have already tried, so it knows whether a visit adds to "Throne Hoppers".
import { fetchBoards, fetchMyRoyalState } from "./api.js";
import { clearCache, readCache, writeCache } from "./cache.js";
import { CAMPUS, ROYALS_MAX_AGE_MS } from "./config.js";
import { db } from "./firebase.js";
import { weekNumber } from "./profile.js";
import { state, update } from "./store.js";

const boardsKey = (week) => `boards.${CAMPUS.id}.${week}`;

/** Forget the saved boards: call after our own counted visit or profile change, so the next look is fresh. */
export function invalidateRoyals() {
  clearCache(boardsKey(weekNumber()));
}

/** The four boards: from the phone's copy when it's young enough, else 12 reads. */
export async function loadBoards({ force = false } = {}) {
  const week = weekNumber();
  if (!force) {
    const hit = readCache(boardsKey(week), ROYALS_MAX_AGE_MS);
    if (hit) {
      update({ boards: { ...hit.value, at: hit.at } });
      return hit.value;
    }
  }
  try {
    const boards = await fetchBoards(db, CAMPUS.id, week);
    writeCache(boardsKey(week), boards);
    update({ boards: { ...boards, at: Date.now() } });
    return boards;
  } catch (e) {
    // Offline or blocked: show the last boards we saw, however old.
    const stale = readCache(boardsKey(week), Infinity);
    if (stale && !state.boards) update({ boards: { ...stale.value, at: stale.at } });
    throw e;
  }
}

// ---- my own entries ------------------------------------------------------------------------------

/** { uid, all, week } where all = my all-time record and week = this week's entry (each with its set of toilets `ts`). */
export async function myRoyalState({ force = false } = {}) {
  const uid = state.uid;
  if (!uid) return null;
  if (!force && state.myRoyal?.uid === uid) return state.myRoyal;
  const week = weekNumber();
  const fetched = await fetchMyRoyalState(db, CAMPUS.id, uid, week);
  const value = { uid, all: fetched.all, week: fetched.week ? { w: week, ...fetched.week } : null };
  update({ myRoyal: value });
  return value;
}

/** This week's entry, or null if it belongs to an earlier week (a new week starts empty). */
export const currentWeekEntry = (mine) => (mine?.week?.w === weekNumber() ? mine.week : null);

/** Fold one counted visit at toilet `id` into what we know about our own entries. */
export function recordSession(id, { newAll, newWeek }) {
  const mine = state.myRoyal;
  if (!mine) return;
  const all = mine.all ?? { n: 0, x: 0, ts: {} };
  const week = currentWeekEntry(mine) ?? { w: weekNumber(), n: 0, x: 0, ts: {} };
  update({
    myRoyal: {
      ...mine,
      all: { ...all, n: all.n + 1, x: all.x + (newAll ? 1 : 0), ts: { ...all.ts, [id]: true } },
      week: { ...week, w: weekNumber(), n: week.n + 1, x: week.x + (newWeek ? 1 : 0), ts: { ...week.ts, [id]: true } },
    },
  });
}
