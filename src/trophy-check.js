// Keeps the signed-in user's trophy shelf (see trophies.js) up to date from public data, at most once a day per phone.
import {
  createDaySnapshot,
  createWeekPodium,
  fetchAllTimePodium,
  fetchDaysAfter,
  fetchMyReview,
  fetchPodiumsAfter,
  fetchWeekPodium,
  saveTrophies,
} from "./api.js";
import { loadProfile } from "./actions.js";
import { readCache, writeCache } from "./cache.js";
import { CAMPUS, ROYALS_FIRST_WEEK } from "./config.js";
import { currentUid, db } from "./firebase.js";
import { dayNumber, weekNumber } from "./profile.js";
import { myRoyalState } from "./royals.js";
import { state, update } from "./store.js";
import { LIKE_TROPHIES, likeTier, stepStreaks, tallySeasons } from "./trophies.js";

const MAX_NEW_PODIUMS = 12; // snapshots one phone creates in one go (6 reads each); the rest wait for the next day

async function streakPatch(rec, uid) {
  const today = dayNumber();
  if ((rec.st?.d ?? 0) >= today) return null;
  // A newcomer starts from today's snapshot: nobody has history from before the feature existed.
  const after = rec.st ? rec.st.d : today - 1;
  let days = await fetchDaysAfter(db, CAMPUS.id, after);
  if (!days.some((x) => x.d === today)) {
    const made = await createDaySnapshot(db, CAMPUS.id, today, await fetchAllTimePodium(db, CAMPUS.id));
    if (made || !days.length) days = await fetchDaysAfter(db, CAMPUS.id, after); // ours (or a rival's) is there now
  }
  const st = stepStreaks(rec.st, days, uid);
  if (!rec.st && !st.s && !st.e) return null; // nothing to show yet: no need to write a record of zeros
  return st.s === rec.st?.s && st.e === rec.st?.e && st.d === rec.st?.d ? null : { st };
}

async function seasonPatch(rec, uid) {
  const last = weekNumber() - 1; // the latest finished week
  const from = Math.max((rec.wl || ROYALS_FIRST_WEEK - 1) + 1, last - 59);
  if (from > last) return null;
  const podiums = (await fetchPodiumsAfter(db, CAMPUS.id, from - 1)).filter((p) => p.w <= last);
  const have = new Set(podiums.map((p) => p.w));
  let created = 0;
  for (let w = from; w <= last; w++) {
    if (have.has(w)) continue;
    if (created++ >= MAX_NEW_PODIUMS) return null; // finish next time; wl hasn't moved, so nothing is skipped
    const podium = await fetchWeekPodium(db, CAMPUS.id, w); // a finished week never changes, so a rival's copy is the same
    await createWeekPodium(db, CAMPUS.id, w, podium);
    podiums.push({ w, ...podium });
  }
  return { wl: last, wq: tallySeasons(rec.wq, podiums, uid) };
}

async function likesPatch(rec, uid, profile) {
  if ((rec.lt ?? 0) >= LIKE_TROPHIES.at(-1).threshold) return null;
  let best = 0;
  const ids = Object.keys(profile?.rv ?? {});
  for (let i = 0; i < ids.length; i += 10) {
    const reviews = await Promise.all(ids.slice(i, i + 10).map((id) => fetchMyReview(db, CAMPUS.id, id, uid)));
    for (const r of reviews) best = Math.max(best, r?.likes ?? 0);
  }
  const tier = likeTier(best);
  return tier > (rec.lt ?? 0) ? { lt: tier } : null;
}

const checkedKey = (uid) => `trophies.${uid}`;
let running = null;

/**
 * Bring the signed-in user's shelf up to date (at most once a day per phone; later calls cost nothing). Needs the
 * user's royal record, so someone who hasn't thrown a counted visit yet has no shelf. A failure is only logged:
 * the next app open tries again.
 */
export function checkTrophies() {
  running ??= (async () => {
    const uid = state.uid ?? (await currentUid());
    if (!uid) return;
    const today = dayNumber();
    if (readCache(checkedKey(uid), Infinity)?.value === today) return;
    const mine = await myRoyalState();
    const rec = mine?.all;
    if (rec) {
      const profile = await loadProfile();
      const patches = await Promise.all([streakPatch(rec, uid), seasonPatch(rec, uid), likesPatch(rec, uid, profile)]);
      const patch = Object.assign({}, ...patches);
      if (Object.keys(patch).length && (await saveTrophies(db, CAMPUS.id, uid, patch))) {
        update({ myRoyal: { ...state.myRoyal, all: { ...state.myRoyal.all, ...patch } } });
      }
    }
    writeCache(checkedKey(uid), today);
  })()
    .catch((e) => console.warn("trophy check failed; will retry on the next open", e))
    .finally(() => (running = null));
  return running;
}
