// User actions: each one talks to Firestore (api.js) and then patches the local state
// optimistically, so the UI updates without re-reading the aggregate documents.
import { checkIn, checkOut, fetchMyReview, saveReview } from "./api.js";
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
    await checkOut(db, CAMPUS.id, id, { countVisit });
  } catch (e) {
    // Our check-in expired and someone else took the toilet: nothing left to leave.
    if (e?.code !== "permission-denied") throw e;
  }
  const { [id]: _gone, ...live } = state.live;
  const stats = { ...state.stats };
  if (countVisit) stats[id] = { ...(stats[id] ?? { n: 0, p: 0, c: 0, k: 0, v: 0 }), v: (stats[id]?.v ?? 0) + 1 };
  update({ live, stats });
  setCheckIn(null);
  return countVisit;
}

export async function submitReview(id, scores) {
  const uid = await ensureUser();
  update({ uid });
  const previous = await loadMyReview(id);
  await saveReview(db, CAMPUS.id, uid, id, scores, previous);

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
  state.myReviews.set(id, { uid, p: scores.p, c: scores.c, k: scores.k, text: (scores.text ?? "").trim(), createdMs: previous?.createdMs ?? Date.now() });
}
