// Every Firestore read/write the app does lives here, so the cost profile of the app is
// readable in one place. Functions take `db` (and `uid`) explicitly so the rules tests
// run the exact same code paths as the browser.
//
// Reads per user session, typical:  stats (1) + live (1, repeated by polling)
//                                   + reviews of an opened toilet (<= 10 per page) + own review (1)
// Writes: a review is one batch of 2 docs, a visit is one batch of 2 docs, a check-in is 1 doc.
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

export const REVIEW_PAGE_SIZE = 10;
export const MAX_TEXT_LENGTH = 280;
export const CHECK_IN_MINUTES = 10;

const statsRef = (db, campus) => doc(db, "campuses", campus, "meta", "stats");
const liveRef = (db, campus) => doc(db, "campuses", campus, "meta", "live");
const reviewRef = (db, campus, toiletId, uid) =>
  doc(db, "campuses", campus, "toilets", toiletId, "reviews", uid);

// ---- reads ---------------------------------------------------------------

/** { [toiletId]: {n, p, c, k, v} } — one read for the whole campus. */
export async function fetchStats(db, campus) {
  const snap = await getDoc(statsRef(db, campus));
  return snap.exists() ? (snap.data().t ?? {}) : {};
}

/** { [toiletId]: {u, s, d} } — one read for the whole campus. `s` is converted to millis. */
export async function fetchLive(db, campus) {
  const snap = await getDoc(liveRef(db, campus));
  const occ = snap.exists() ? (snap.data().occ ?? {}) : {};
  const out = {};
  for (const [id, o] of Object.entries(occ)) {
    out[id] = { u: o.u, s: o.s?.toMillis?.() ?? Date.now(), d: o.d };
  }
  return out;
}

function toReview(snap) {
  const r = snap.data();
  return {
    uid: snap.id,
    p: r.p,
    c: r.c,
    k: r.k,
    text: r.text ?? "",
    createdAt: r.createdAt,
    createdMs: r.createdAt?.toMillis?.() ?? Date.now(),
  };
}

/** Newest-first page of reviews. Pass the returned `cursor` to get the next page. */
export async function fetchReviews(db, campus, toiletId, cursor = null) {
  const col = collection(db, "campuses", campus, "toilets", toiletId, "reviews");
  const q = cursor
    ? query(col, orderBy("createdAt", "desc"), startAfter(cursor), limit(REVIEW_PAGE_SIZE))
    : query(col, orderBy("createdAt", "desc"), limit(REVIEW_PAGE_SIZE));
  const snap = await getDocs(q);
  return {
    reviews: snap.docs.map(toReview),
    cursor: snap.docs.at(-1) ?? null,
    done: snap.docs.length < REVIEW_PAGE_SIZE,
  };
}

export async function fetchMyReview(db, campus, toiletId, uid) {
  const snap = await getDoc(reviewRef(db, campus, toiletId, uid));
  return snap.exists() ? toReview(snap) : null;
}

// ---- writes --------------------------------------------------------------

/**
 * The aggregate docs must exist before they can be updated. They are created lazily on
 * the first write ever made on a campus; on every other write this costs nothing.
 */
async function withBootstrap(db, campus, run) {
  try {
    return await run();
  } catch (e) {
    if (e.code !== "not-found" && e.code !== "permission-denied") throw e;
    // setDoc on an existing doc is rejected by the rules, so this can't clobber data.
    await Promise.allSettled([
      setDoc(statsRef(db, campus), { t: {} }),
      setDoc(liveRef(db, campus), { occ: {} }),
    ]);
    return run();
  }
}

const commitWithBootstrap = (db, campus, build) =>
  withBootstrap(db, campus, () => build().commit());

function statsDelta(toiletId, { n = 0, p = 0, c = 0, k = 0, v = 0 }) {
  return {
    [`t.${toiletId}.n`]: increment(n),
    [`t.${toiletId}.p`]: increment(p),
    [`t.${toiletId}.c`]: increment(c),
    [`t.${toiletId}.k`]: increment(k),
    [`t.${toiletId}.v`]: increment(v),
    ref: toiletId,
    at: serverTimestamp(),
  };
}

/**
 * Create or edit the user's review (one per user per toilet) and fold the change into the
 * campus stats, atomically. `previous` is the user's existing review, or null.
 * With `countVisit` the same write also adds one visit to the toilet's usage counter.
 */
export function saveReview(db, campus, uid, toiletId, { p, c, k, text, countVisit = false }, previous) {
  const trimmed = (text ?? "").trim();
  return commitWithBootstrap(db, campus, () => {
    const batch = writeBatch(db);
    const ref = reviewRef(db, campus, toiletId, uid);
    if (previous) {
      batch.update(ref, {
        p,
        c,
        k,
        text: trimmed ? trimmed : deleteField(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        p,
        c,
        k,
        ...(trimmed ? { text: trimmed } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.update(
      statsRef(db, campus),
      statsDelta(toiletId, {
        n: previous ? 0 : 1,
        p: p - (previous?.p ?? 0),
        c: c - (previous?.c ?? 0),
        k: k - (previous?.k ?? 0),
        v: countVisit ? 1 : 0,
      }),
    );
    return batch;
  });
}

/** Mark a toilet as in use. It frees itself after `minutes` even if the user forgets. */
export function checkIn(db, campus, uid, toiletId, minutes = CHECK_IN_MINUTES) {
  return withBootstrap(db, campus, () =>
    updateDoc(liveRef(db, campus), {
      [`occ.${toiletId}`]: { u: uid, s: serverTimestamp(), d: minutes },
      ref: toiletId,
      at: serverTimestamp(),
    }),
  );
}

/** Leave the toilet. With `countVisit` the visit is added to the toilet's usage counter. */
export function checkOut(db, campus, toiletId, { countVisit }) {
  return commitWithBootstrap(db, campus, () => {
    const batch = writeBatch(db);
    batch.update(liveRef(db, campus), {
      [`occ.${toiletId}`]: deleteField(),
      ref: toiletId,
      at: serverTimestamp(),
    });
    if (countVisit) batch.update(statsRef(db, campus), statsDelta(toiletId, { v: 1 }));
    return batch;
  });
}
