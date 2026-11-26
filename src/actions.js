// User actions: each one talks to Firestore (api.js) and then patches the local state
// optimistically, so the UI updates without re-reading the aggregate documents.
import { checkIn, checkOut, fetchMyReview, fetchProfile, quickThrone, saveProfile, saveReview } from "./api.js";
import { readCache, writeCache } from "./cache.js";
import { CAMPUS, PROFILE_MAX_AGE_MS } from "./config.js";
import { currentUid, db, ensureUser } from "./firebase.js";
import { dayNumber, quickUsage } from "./profile.js";
import { setCheckIn, state, update } from "./store.js";
import { invalidateLive, invalidateStats } from "./sync.js";

const MIN_VISIT_MS = 25_000; // rules reject visits under 20 s; keep a margin for clock skew

export function errorMessage(e) {
  if (e?.code === "permission-denied") return "That was rejected by the server. Try again in a moment.";
  if (e?.code === "unavailable") return "You seem to be offline.";
  return "Something went wrong. Please try again.";
}

/** The user's own review of a toilet; cached so the sheet only pays this read once. */
export async function loadMyReview(id) {
  if (state.myReviews.has(id)) return state.myReviews.get(id);
  const uid = state.uid ?? (await currentUid());
  if (!uid) return null; // never signed in: can't have reviewed anything
  update({ uid });
  const review = await fetchMyReview(db, CAMPUS.id, id, uid);
  state.myReviews.set(id, review);
  return review;
}

const EMPTY_PROFILE = () => ({ name: null, emoji: null, rv: {}, vs: {}, q: null });

const profileKey = (uid) => `profile.${uid}`;

/** Keep the profile in the state and a copy on the phone (so the next app open needs no read). */
function setProfile(profile) {
  update({ profile });
  if (state.uid) writeCache(profileKey(state.uid), profile);
}

let profileLoading = null;
/**
 * The user's private profile. Reused from the phone's copy when it is younger than
 * PROFILE_MAX_AGE_MS, otherwise one read. `fresh` skips the copy (used before a rename, which
 * must know every review). Not signed in: an empty profile.
 */
export async function loadProfile({ fresh = false } = {}) {
  if (state.profile && !fresh) return state.profile;
  const uid = state.uid ?? (await currentUid());
  if (!uid) return EMPTY_PROFILE();
  if (!fresh) {
    const hit = readCache(profileKey(uid), PROFILE_MAX_AGE_MS);
    if (hit) {
      update({ profile: hit.value });
      return hit.value;
    }
  }
  profileLoading ??= fetchProfile(db, uid)
    .then((profile) => {
      if (!state.uid || state.uid === uid) {
        update({ profile }); // ignore if the user changed meanwhile
        writeCache(profileKey(uid), profile);
      }
      return profile;
    })
    .finally(() => (profileLoading = null));
  return profileLoading;
}

/** Save the chosen username / avatar (null = default) and carry it over to the user's reviews. */
export async function updateProfile({ name, emoji }) {
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile({ fresh: true }); // another device may have added reviews
  await saveProfile(db, CAMPUS.id, uid, { name, emoji }, Object.keys(profile.rv));
  setProfile({ ...profile, name, emoji });
}

export async function startVisit(id) {
  const uid = await ensureUser();
  update({ uid });
  await checkIn(db, CAMPUS.id, uid, id);
  invalidateLive();
  const now = Date.now();
  update({ live: { ...state.live, [id]: { u: uid, s: now, d: 10 } } });
  setCheckIn({ id, at: now });
}

/** Leave the toilet. Returns true if the visit was counted. */
export async function endVisit(id, { cancel = false } = {}) {
  const elapsed = Date.now() - (state.checkIn?.at ?? 0);
  const countVisit = !cancel && elapsed >= MIN_VISIT_MS;
  try {
    await checkOut(db, CAMPUS.id, id, { countVisit, uid: state.uid });
  } catch (e) {
    // Our check-in expired and someone else took the toilet: nothing left to leave.
    if (e?.code !== "permission-denied") throw e;
  }
  const { [id]: _gone, ...live } = state.live;
  const stats = { ...state.stats };
  if (countVisit) stats[id] = { ...(stats[id] ?? { n: 0, p: 0, c: 0, k: 0, v: 0 }), v: (stats[id]?.v ?? 0) + 1 };
  update({ live, stats });
  invalidateLive(); // the phone's copies no longer match the server: read fresh next time
  if (countVisit) invalidateStats();
  if (countVisit && state.profile) {
    const vs = { ...state.profile.vs, [id]: (state.profile.vs[id] ?? 0) + 1 };
    setProfile({ ...state.profile, vs });
  }
  setCheckIn(null);
  return countVisit;
}

export async function submitReview(id, scores) {
  const uid = await ensureUser();
  update({ uid });
  const previous = await loadMyReview(id);
  const profile = await loadProfile();
  await saveReview(db, CAMPUS.id, uid, id, scores, previous, profile);

  const prev = previous ?? { p: 0, c: 0, k: 0 };
  const e = state.stats[id] ?? { n: 0, p: 0, c: 0, k: 0, v: 0 };
  update({
    stats: {
      ...state.stats,
      [id]: {
        ...e,
        n: e.n + (previous ? 0 : 1),
        p: e.p + scores.p - prev.p,
        c: e.c + scores.c - prev.c,
        k: e.k + scores.k - prev.k,
        v: e.v + (scores.countVisit ? 1 : 0),
      },
    },
  });
  const vs = scores.countVisit ? { ...profile.vs, [id]: (profile.vs[id] ?? 0) + 1 } : profile.vs;
  setProfile({ ...profile, rv: { ...profile.rv, [id]: { p: scores.p, c: scores.c, k: scores.k, at: Date.now() } }, vs });
  invalidateStats(); // so the next app open reads the new totals instead of a copy from before our review
  state.myReviews.set(id, { uid, p: scores.p, c: scores.c, k: scores.k, text: (scores.text ?? "").trim(), createdMs: previous?.createdMs ?? Date.now() });
}

/** Thrown when today's quick visits are used up (checked on the phone first, then by the rules). */
export class QuickLimitError extends Error {}

/** "I just throned": add one visit at toilet `id` to its counter and to the user's profile. */
export async function quickVisit(id) {
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile();
  const { used, left } = quickUsage(profile);
  if (left <= 0) throw new QuickLimitError();
  const day = dayNumber();
  try {
    await quickThrone(db, CAMPUS.id, uid, id, { used, day });
  } catch (e) {
    if (e?.code === "permission-denied") {
      // Most likely today's allowance was already used up on another phone: re-read it, so the
      // counter on this phone catches up.
      await loadProfile({ fresh: true }).catch(() => {});
      throw new QuickLimitError();
    }
    throw e;
  }
  const e = state.stats[id] ?? { n: 0, p: 0, c: 0, k: 0, v: 0 };
  update({ stats: { ...state.stats, [id]: { ...e, v: e.v + 1 } } });
  setProfile({ ...profile, q: { d: day, n: used + 1 }, vs: { ...profile.vs, [id]: (profile.vs[id] ?? 0) + 1 } });
  invalidateStats();
}
