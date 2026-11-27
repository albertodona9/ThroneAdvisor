// User actions: each one talks to Firestore (api.js) and then patches the local state
// optimistically, so the UI updates without re-reading the aggregate documents.
import { checkIn, checkOut, fetchMyReview, fetchProfile, likeReview, quickThrone, saveProfile, saveReview } from "./api.js";
import { readCache, writeCache } from "./cache.js";
import { CAMPUS, PROFILE_MAX_AGE_MS } from "./config.js";
import { auth, currentUid, db, ensureUser } from "./firebase.js";
import { dayNumber, likeKey, quickUsage, royalIdentity } from "./profile.js";
import { currentWeekEntry, invalidateRoyals, myRoyalState, recordSession } from "./royals.js";
import { setCheckIn, state, update } from "./store.js";
import { invalidateLive, invalidateStats } from "./sync.js";
import { assertThroningAllowed, recordThroning, ThroningCooldownError } from "./throning-limit.js";

const MIN_VISIT_MS = 25_000; // rules reject visits under 20 s; keep a margin for clock skew

function publicClaim(uid, profile = state.profile) {
  return {
    u: uid,
    ...(profile?.name ? { n: profile.name } : {}),
    ...(profile?.emoji ? { em: profile.emoji } : {}),
    ...(profile?.title ? { ti: profile.title } : {}),
  };
}

function localClaim(uid, profile = state.profile) {
  return { ...publicClaim(uid, profile), at: Date.now() };
}

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

const EMPTY_PROFILE = () => ({ name: null, emoji: null, title: null, frame: null, rv: {}, vs: {}, q: null, lk: {} });

/**
 * Runs a write that counts one visit at toilet `id`, giving it the leaderboard identity plus whether this toilet is
 * new to the user (ever / this week), which decides if "Throne Hoppers" goes up. If the rules refuse, most often
 * because our idea of which toilets were already tried was out of date (another phone), we re-read it and try once more.
 */
async function countedVisit(id, run, profile = state.profile) {
  const flags = (mine) => ({ newAll: !mine?.all?.ts?.[id], newWeek: !currentWeekEntry(mine)?.ts?.[id] });
  const identity = currentRoyal(profile);
  if (!identity) return run(null); // no birth date to show: count the visit, skip the leaderboards
  let used = flags(await myRoyalState());
  try {
    await run({ ...identity, ...used });
  } catch (e) {
    if (e?.code !== "permission-denied") throw e;
    console.warn("counted visit refused; re-reading which toilets were tried and trying once more:", e.message);
    used = flags(await myRoyalState({ force: true }));
    await run({ ...identity, ...used });
  }
  recordSession(id, used);
}

/** What the public leaderboard shows about the current user (name, avatar, title, birth date). */
function currentRoyal(profile = state.profile) {
  // The birth date is the account's creation time, from Firebase's server. It must be exactly the same on every
  // visit (the rules refuse a changed one) and it is always in the past, so nothing here may depend on the clock
  // or on how far the app has got with signing in: read it straight from the signed-in user.
  const created = auth.currentUser?.metadata?.creationTime ? Date.parse(auth.currentUser.metadata.creationTime) : state.account?.createdMs;
  if (!Number.isFinite(created)) return null; // unknown: the visit still counts, it just stays off the leaderboards
  return royalIdentity({ uid: state.uid, profile, bornMs: created });
}

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
export async function updateProfile({ name, emoji, title = null, frame = null, bio = null, cy = null, sn = null, snPub = false }) {
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile({ fresh: true }); // another device may have added reviews
  const next = { ...profile, name, emoji, title, frame, bio, cy, sn, snPub: !!sn && snPub };
  await saveProfile(db, CAMPUS.id, uid, { name, emoji, title, frame, bio, cy, sn, snPub: next.snPub }, Object.keys(profile.rv), currentRoyal(next));
  setProfile(next);
  invalidateRoyals();
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
  let countVisit = !cancel && elapsed >= MIN_VISIT_MS;
  let cooldownError = null;
  if (countVisit) {
    try {
      assertThroningAllowed();
    } catch (e) {
      if (!(e instanceof ThroningCooldownError)) throw e;
      cooldownError = e;
      countVisit = false;
    }
  }
  try {
    if (countVisit) await countedVisit(id, (royal) => checkOut(db, CAMPUS.id, id, { countVisit: true, uid: state.uid, royal, claim: publicClaim(state.uid) }));
    else await checkOut(db, CAMPUS.id, id, { countVisit: false, uid: state.uid });
  } catch (e) {
    // Our check-in expired and someone else took the toilet: nothing left to leave.
    if (e?.code !== "permission-denied") throw e;
    console.warn("check-out no longer available; session not counted", e);
    countVisit = false;
  }
  const { [id]: _gone, ...live } = state.live;
  const stats = { ...state.stats };
  if (countVisit) stats[id] = { ...(stats[id] ?? { n: 0, p: 0, c: 0, k: 0, v: 0 }), v: (stats[id]?.v ?? 0) + 1, l: localClaim(state.uid) };
  update({ live, stats });
  invalidateLive(); // the phone's copies no longer match the server: read fresh next time
  if (countVisit) {
    invalidateStats();
    invalidateRoyals();
  }
  if (countVisit && state.profile) {
    const vs = { ...state.profile.vs, [id]: (state.profile.vs[id] ?? 0) + 1 };
    setProfile({ ...state.profile, vs });
  }
  setCheckIn(null);
  if (cooldownError) throw cooldownError;
  if (countVisit) recordThroning();
  return countVisit;
}

export async function submitReview(id, scores) {
  if (scores.countVisit) assertThroningAllowed();
  const uid = await ensureUser();
  update({ uid });
  const previous = await loadMyReview(id);
  const profile = await loadProfile();
  if (scores.countVisit) await countedVisit(id, (royal) => saveReview(db, CAMPUS.id, uid, id, scores, previous, profile, royal, publicClaim(uid, profile)), profile);
  else await saveReview(db, CAMPUS.id, uid, id, scores, previous, profile, null);

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
        ...(scores.countVisit ? { l: localClaim(uid, profile) } : {}),
      },
    },
  });
  const vs = scores.countVisit ? { ...profile.vs, [id]: (profile.vs[id] ?? 0) + 1 } : profile.vs;
  setProfile({ ...profile, rv: { ...profile.rv, [id]: { p: scores.p, c: scores.c, k: scores.k, at: Date.now() } }, vs });
  invalidateStats(); // so the next app open reads the new totals instead of a copy from before our review
  if (scores.countVisit) invalidateRoyals();
  state.myReviews.set(id, {
    uid,
    p: scores.p,
    c: scores.c,
    k: scores.k,
    text: (scores.text ?? "").trim(),
    likes: previous?.likes ?? 0,
    createdMs: previous?.createdMs ?? Date.now(),
  });
  if (scores.countVisit) recordThroning();
}

/** Thrown when today's quick visits are used up (checked on the phone first, then by the rules). */
export class QuickLimitError extends Error {}

/** "I just throned": add one visit at toilet `id` to its counter and to the user's profile. */
export async function quickVisit(id) {
  assertThroningAllowed();
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile();
  const { used, left } = quickUsage(profile);
  if (left <= 0) throw new QuickLimitError();
  const day = dayNumber();
  try {
    await countedVisit(id, (royal) => quickThrone(db, CAMPUS.id, uid, id, { used, day, royal, claim: publicClaim(uid, profile) }), profile);
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
  update({ stats: { ...state.stats, [id]: { ...e, v: e.v + 1, l: localClaim(uid, profile) } } });
  setProfile({ ...profile, q: { d: day, n: used + 1 }, vs: { ...profile.vs, [id]: (profile.vs[id] ?? 0) + 1 } });
  invalidateStats();
  invalidateRoyals();
  recordThroning();
}

/** Has the signed-in user liked this review? (From their profile: no read.) */
export const hasLiked = (toiletId, authorUid) => !!state.profile?.lk?.[likeKey(toiletId, authorUid)];

const withKey = (map, key, on) => {
  const { [key]: _old, ...rest } = map ?? {};
  return on ? { ...rest, [key]: true } : rest;
};

/**
 * Like or un-like a review. Resolves to {liked, delta}: the new state and how much the count moved (0 if
 * the server says it was already that way, e.g. liked earlier from another phone: the heart just catches up).
 */
export async function toggleLike(toiletId, review) {
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile();
  const key = likeKey(toiletId, review.uid);
  const want = !profile.lk?.[key];
  try {
    await likeReview(db, CAMPUS.id, toiletId, review.uid, uid, want);
  } catch (e) {
    if (e?.code !== "permission-denied") throw e;
    setProfile({ ...profile, lk: withKey(profile.lk, key, want) });
    return { liked: want, delta: 0 };
  }
  setProfile({ ...profile, lk: withKey(profile.lk, key, want) });
  return { liked: want, delta: want ? 1 : -1 };
}
