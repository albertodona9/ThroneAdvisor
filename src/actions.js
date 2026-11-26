// User actions: each one talks to Firestore (api.js) and then patches the local state
// optimistically, so the UI updates without re-reading the aggregate documents.
import { checkIn, checkOut, fetchMyReview, fetchProfile, saveProfile, saveReview } from "./api.js";
import { CAMPUS } from "./config.js";
import { currentUid, db, ensureUser } from "./firebase.js";
import { setCheckIn, state, update } from "./store.js";

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

const EMPTY_PROFILE = () => ({ name: null, emoji: null, rv: {}, vs: {} });

let profileLoading = null;
/** The user's private profile: one read, then cached for the session. Not signed in: an empty one. */
export async function loadProfile() {
  if (state.profile) return state.profile;
  const uid = state.uid ?? (await currentUid());
  if (!uid) return EMPTY_PROFILE();
  profileLoading ??= fetchProfile(db, uid)
    .then((profile) => {
      if (!state.uid || state.uid === uid) update({ profile }); // ignore if the user changed meanwhile
      return profile;
    })
    .finally(() => (profileLoading = null));
  return profileLoading;
}

/** Save the chosen username / avatar (null = default) and carry it over to the user's reviews. */
export async function updateProfile({ name, emoji }) {
  const uid = await ensureUser();
  update({ uid });
  const profile = await loadProfile();
  await saveProfile(db, CAMPUS.id, uid, { name, emoji }, Object.keys(profile.rv));
  update({ profile: { ...profile, name, emoji } });
}

export async function startVisit(id) {
  const uid = await ensureUser();
  update({ uid });
  await checkIn(db, CAMPUS.id, uid, id);
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
  if (countVisit && state.profile) {
    const vs = { ...state.profile.vs, [id]: (state.profile.vs[id] ?? 0) + 1 };
    update({ profile: { ...state.profile, vs } });
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
  update({ profile: { ...profile, rv: { ...profile.rv, [id]: { p: scores.p, c: scores.c, k: scores.k, at: Date.now() } }, vs } });
  state.myReviews.set(id, { uid, p: scores.p, c: scores.c, k: scores.k, text: (scores.text ?? "").trim(), createdMs: previous?.createdMs ?? Date.now() });
}
