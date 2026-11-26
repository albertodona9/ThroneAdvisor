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
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { weekNumber } from "./profile.js";

export const REVIEW_PAGE_SIZE = 10;
export const MAX_TEXT_LENGTH = 280;
export const CHECK_IN_MINUTES = 10;

const statsRef = (db, campus) => doc(db, "campuses", campus, "meta", "stats");
const liveRef = (db, campus) => doc(db, "campuses", campus, "meta", "live");
const reviewRef = (db, campus, toiletId, uid) =>
  doc(db, "campuses", campus, "toilets", toiletId, "reviews", uid);
const userRef = (db, uid) => doc(db, "users", uid);
const royalRef = (db, campus, uid) => doc(db, "campuses", campus, "royals", uid);
const weekRoyalRef = (db, campus, week, uid) => doc(db, "campuses", campus, "weeks", String(week), "royals", uid);
const likeRef =(db, campus, toiletId, authorUid, likerUid) =>
  doc(db, "campuses", campus, "toilets", toiletId, "reviews", authorUid, "likes", likerUid);

export const BOARD_TOP = 3; // each of the four boards shows (and reads) this many kings and queens

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
    likes: r.lk ?? 0, // how many people liked it
    by: r.by ?? null, // chosen username (absent: show the generated nickname)
    em: r.em ?? null, // chosen avatar emoji
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

/**
 * The user's private profile: { name, emoji, rv: {toiletId: {p,c,k,at}}, vs: {toiletId: count} }.
 * One read. A user who never wrote anything has no document: that is an empty profile.
 */
export async function fetchProfile(db, uid) {
  const snap = await getDoc(userRef(db, uid));
  const d = snap.exists() ? snap.data() : {};
  return { name: d.name ?? null, emoji: d.emoji ?? null, title: d.title ?? null, rv: d.rv ?? {}, vs: d.vs ?? {}, q: d.q ?? null, lk: d.lk ?? {} };
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
 * `profile` ({name, emoji}) is copied onto the review so other people see the chosen
 * username without any extra read. The user's own profile history is updated in the same batch.
 */
/**
 * Adds one throning session to the user's public royal record (created by the first one), and to their entry on
 * the running week's board. Always used in the same batch as the counted visit, which is what lets the rules
 * accept it. `royal` = {name, emoji, title, bornMs, newAll, newWeek}: what the boards show, plus whether this is
 * the first time at this toilet ever (`newAll`) / this week (`newWeek`), which decides whether the "toilets tried"
 * count (x) goes up by one. The rules check that claim against the stored set, so it can't be made up.
 */
function addSession(batch, db, campus, uid, toiletId, royal) {
  const identity = {
    name: royal.name,
    born: Timestamp.fromMillis(royal.bornMs),
    n: increment(1),
  };
  batch.set(
    royalRef(db, campus, uid),
    {
      ...identity,
      ...(royal.emoji ? { emoji: royal.emoji } : {}),
      ...(royal.title ? { title: royal.title } : {}),
      ts: { [toiletId]: true },
      x: increment(royal.newAll === false ? 0 : 1),
    },
    { merge: true },
  );
  // The week's entry carries the name too, and (unlike the all-time one) always rewrites emoji and title,
  // so a change of avatar shows from the next session without a separate update.
  batch.set(
    weekRoyalRef(db, campus, weekNumber(), uid),
    {
      ...identity,
      emoji: royal.emoji ?? deleteField(),
      title: royal.title ?? deleteField(),
      ts: { [toiletId]: true },
      x: increment(royal.newWeek === false ? 0 : 1),
    },
    { merge: true },
  );
}

export function saveReview(db, campus, uid, toiletId, { p, c, k, text, countVisit = false }, previous, profile = null, royal = null) {
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
        by: profile?.name ?? deleteField(),
        em: profile?.emoji ?? deleteField(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        p,
        c,
        k,
        ...(trimmed ? { text: trimmed } : {}),
        ...(profile?.name ? { by: profile.name } : {}),
        ...(profile?.emoji ? { em: profile.emoji } : {}),
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
    batch.set(
      userRef(db, uid),
      {
        rv: { [toiletId]: { p, c, k, at: Date.now() } },
        ...(countVisit ? { vs: { [toiletId]: increment(1) } } : {}),
      },
      { merge: true },
    );
    if (countVisit && royal) addSession(batch, db, campus, uid, toiletId, royal);
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

/** Leave the toilet. With `countVisit` the visit is added to the toilet's counter (and to `uid`'s profile). */
export function checkOut(db, campus, toiletId, { countVisit, uid = null, royal = null }) {
  return commitWithBootstrap(db, campus, () => {
    const batch = writeBatch(db);
    batch.update(liveRef(db, campus), {
      [`occ.${toiletId}`]: deleteField(),
      ref: toiletId,
      at: serverTimestamp(),
    });
    if (countVisit) {
      batch.update(statsRef(db, campus), statsDelta(toiletId, { v: 1 }));
      if (uid) batch.set(userRef(db, uid), { vs: { [toiletId]: increment(1) } }, { merge: true });
      if (uid && royal) addSession(batch, db, campus, uid, toiletId, royal);
    }
    return batch;
  });
}

/**
 * "I just throned": one visit at a toilet, with no review and no check-in. The rules allow at most
 * 3 a day per user, tracked in `q` of the user's own profile, which is bumped in this same batch.
 * `used` is how many the client thinks were used on `day` (src/profile.js dayNumber).
 */
export function quickThrone(db, campus, uid, toiletId, { used, day, royal = null }) {
  return commitWithBootstrap(db, campus, () => {
    const batch = writeBatch(db);
    batch.update(statsRef(db, campus), statsDelta(toiletId, { v: 1 }));
    batch.set(
      userRef(db, uid),
      { q: { d: day, n: used + 1 }, vs: { [toiletId]: increment(1) } },
      { merge: true },
    );
    if (royal) addSession(batch, db, campus, uid, toiletId, royal);
    return batch;
  });
}

/**
 * Save the username / avatar (null clears one back to the default) and carry it over to the
 * user's existing reviews, which is how other people see it. `reviewIds` are the toilets the
 * user has reviewed (the keys of their profile's `rv`).
 */
export async function saveProfile(db, campus, uid, { name, emoji, title = null }, reviewIds, royal = null) {
  const BATCH = 400; // Firestore allows 500 writes per batch
  const chunks = [];
  for (let i = 0; i < reviewIds.length; i += BATCH) chunks.push(reviewIds.slice(i, i + BATCH));
  if (!chunks.length) chunks.push([]);
  for (const [i, ids] of chunks.entries()) {
    const batch = writeBatch(db);
    if (i === 0) {
      batch.set(userRef(db, uid), { name: name ?? deleteField(), emoji: emoji ?? deleteField(), title: title ?? deleteField() }, { merge: true });
    }
    for (const id of ids) {
      batch.update(reviewRef(db, campus, id, uid), { by: name ?? deleteField(), em: emoji ?? deleteField() });
    }
    await batch.commit();
  }
  // The public leaderboard record (if this user has one yet) shows the same name, avatar and title.
  if (royal) {
    try {
      await updateDoc(royalRef(db, campus, uid), {
        name: royal.name,
        emoji: royal.emoji ?? deleteField(),
        title: royal.title ?? deleteField(),
      });
    } catch (e) {
      if (e?.code !== "not-found" && e?.code !== "permission-denied") throw e; // no royal record yet: nothing to update
    }
  }
}

// ---- likes ---------------------------------------------------------------------------------

/**
 * Like (`like = true`) or un-like a review. One batch: the like document, the review's counter, and a
 * note in the liker's own profile of what they liked (so the app can show filled hearts without reading
 * anything extra). The rules only accept the counter moving together with the like document.
 */
export function likeReview(db, campus, toiletId, authorUid, likerUid, like) {
  const batch = writeBatch(db);
  const ref = likeRef(db, campus, toiletId, authorUid, likerUid);
  if (like) batch.set(ref, { at: serverTimestamp() });
  else batch.delete(ref);
  batch.update(reviewRef(db, campus, toiletId, authorUid), { lk: increment(like ? 1 : -1) });
  batch.set(userRef(db, likerUid), { lk: { [`${toiletId}_${authorUid}`]: like ? true : deleteField() } }, { merge: true });
  return batch.commit();
}

// ---- royals (the leaderboards) ------------------------------------------------------------------
// Four boards, each showing the top BOARD_TOP:
//   this week (a collection per week, so nothing ever has to be reset): most sessions / most toilets tried,
//             a tie goes to the OLDEST royal
//   all time:   most sessions / most toilets tried, a tie goes to the YOUNGEST royal, so nobody stays on top
//             forever by being first. Ties are broken in the database (composite indexes on the royal's
//             birth date, see firestore.indexes.json) so that the top BOARD_TOP is exact however many tie.
// Weeks are numbered by weekNumber() (src/profile.js).

const toRoyal = (snap, { withTs = false } = {}) => {
  const r = snap.data();
  return {
    uid: snap.id,
    name: r.name,
    emoji: r.emoji ?? null,
    title: r.title ?? null,
    n: r.n,
    x: r.x ?? 0,
    bornMs: r.born?.toMillis?.() ?? null,
    ...(withTs ? { ts: r.ts ?? {} } : {}),
  };
};

/** The top of one board: `field` is "n" (sessions) or "x" (toilets tried); `ties` is "oldest" or "youngest" first. */
async function topBoard(col, field, ties) {
  const snap = await getDocs(
    query(col, orderBy(field, "desc"), orderBy("born", ties === "oldest" ? "asc" : "desc"), limit(BOARD_TOP)),
  );
  return snap.docs.map((d) => toRoyal(d)).filter((r) => r[field] > 0);
}

/** All four boards for week `week`: 4 queries of at most BOARD_TOP documents, so at most 4 x BOARD_TOP reads. */
export async function fetchBoards(db, campus, week = weekNumber()) {
  const allTime = collection(db, "campuses", campus, "royals");
  const thisWeek = collection(db, "campuses", campus, "weeks", String(week), "royals");
  const [weekSessions, weekExplorers, allSessions, allExplorers] = await Promise.all([
    topBoard(thisWeek, "n", "oldest"),
    topBoard(thisWeek, "x", "oldest"),
    topBoard(allTime, "n", "youngest"),
    topBoard(allTime, "x", "youngest"),
  ]);
  return { week, weekSessions, weekExplorers, allSessions, allExplorers };
}

/** One user's all-time record (1 read), with the set of toilets they have tried, or null. */
export async function fetchRoyal(db, campus, uid) {
  const snap = await getDoc(royalRef(db, campus, uid));
  return snap.exists() ? toRoyal(snap, { withTs: true }) : null;
}

/** One user's entry for week `week` (1 read), with the set of toilets tried that week, or null. */
export async function fetchWeekRoyal(db, campus, uid, week = weekNumber()) {
  const snap = await getDoc(weekRoyalRef(db, campus, week, uid));
  return snap.exists() ? toRoyal(snap, { withTs: true }) : null;
}

/** A user's own entries on both boards (2 reads): what the app needs to know which toilets they've already tried. */
export async function fetchMyRoyalState(db, campus, uid, week = weekNumber()) {
  const [all, wk] = await Promise.all([fetchRoyal(db, campus, uid), fetchWeekRoyal(db, campus, uid, week)]);
  return { all, week: wk };
}
