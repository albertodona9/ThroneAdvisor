import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { checkIn, checkOut, fetchLive, fetchMyReview, fetchReviews, fetchStats, saveReview } from "../src/api.js";

const CAMPUS = "test";
const T = "255568"; // a toilet id
const U = "999001"; // another toilet id

let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Write documents bypassing the rules (test fixtures). */
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const metaDoc = (db, name) => doc(db, "campuses", CAMPUS, "meta", name);

const minutesAgo = (m) => Timestamp.fromMillis(Date.now() - m * 60_000);

beforeAll(async () => {
  setLogLevel("silent"); // denied writes are expected here; don't spam the console
  env = await initializeTestEnvironment({
    projectId: "demo-throneadvisor-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    await setDoc(metaDoc(db, "stats"), { t: {} });
    await setDoc(metaDoc(db, "live"), { occ: {} });
  });
});

const review = { p: 8, c: 6, k: 7, text: "Surprisingly regal." };

describe("reading", () => {
  it("lets anyone read the aggregate docs", async () => {
    await assertSucceeds(getDoc(metaDoc(anon(), "stats")));
    await assertSucceeds(getDoc(metaDoc(anon(), "live")));
  });

  it("only allows paged review queries", async () => {
    const col = collection(anon(), "campuses", CAMPUS, "toilets", T, "reviews");
    await assertSucceeds(getDocs(query(col, limit(10))));
    await assertSucceeds(getDocs(query(col, limit(25))));
    await assertFails(getDocs(query(col, limit(26))));
    await assertFails(getDocs(col));
  });

  it("does not allow listing the meta collection", async () => {
    await assertFails(getDocs(collection(anon(), "campuses", CAMPUS, "meta")));
  });
});

describe("reviews", () => {
  it("creates a review and updates the stats atomically", async () => {
    const db = as("alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, review, null));
    expect(await fetchStats(db, CAMPUS)).toEqual({ [T]: { n: 1, p: 8, c: 6, k: 7, v: 0 } });
    const mine = await fetchMyReview(db, CAMPUS, T, "alice");
    expect(mine).toMatchObject({ p: 8, c: 6, k: 7, text: "Surprisingly regal." });
  });

  it("works on a campus whose aggregate docs do not exist yet", async () => {
    await env.clearFirestore();
    const db = as("alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, review, null));
    expect((await fetchStats(db, CAMPUS))[T].n).toBe(1);
  });

  it("sums reviews from different users", async () => {
    await assertSucceeds(saveReview(as("alice"), CAMPUS, "alice", T, review, null));
    await assertSucceeds(saveReview(as("bob"), CAMPUS, "bob", T, { p: 2, c: 4, k: 3 }, null));
    expect((await fetchStats(as("bob"), CAMPUS))[T]).toEqual({ n: 2, p: 10, c: 10, k: 10, v: 0 });
  });

  it("applies the delta when a user edits their review, and keeps createdAt", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, review, null);
    const first = await fetchMyReview(db, CAMPUS, T, "alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { p: 3, c: 3, k: 3 }, first));
    expect((await fetchStats(db, CAMPUS))[T]).toEqual({ n: 1, p: 3, c: 3, k: 3, v: 0 });
    const edited = await fetchMyReview(db, CAMPUS, T, "alice");
    expect(edited.text).toBe(""); // text removed
    expect(edited.createdMs).toBe(first.createdMs);
  });

  it("returns reviews newest first", async () => {
    await saveReview(as("alice"), CAMPUS, "alice", T, { p: 5, c: 5, k: 5, text: "first" }, null);
    await saveReview(as("bob"), CAMPUS, "bob", T, { p: 5, c: 5, k: 5, text: "second" }, null);
    const page = await fetchReviews(anon(), CAMPUS, T);
    expect(page.reviews.map((r) => r.text)).toEqual(["second", "first"]);
    expect(page.done).toBe(true);
  });

  it("rejects anonymous writes", async () => {
    await assertFails(saveReview(anon(), CAMPUS, "alice", T, review, null));
  });

  it("rejects out-of-range scores and oversized text", async () => {
    const db = as("alice");
    await assertFails(saveReview(db, CAMPUS, "alice", T, { p: 11, c: 5, k: 5 }, null));
    await assertFails(saveReview(db, CAMPUS, "alice", T, { p: 0, c: 5, k: 5 }, null));
    await assertFails(saveReview(db, CAMPUS, "alice", T, { p: 5, c: 5, k: 5, text: "x".repeat(281) }, null));
    expect(await fetchStats(db, CAMPUS)).toEqual({});
  });

  it("rejects a review without a matching stats update", async () => {
    const db = as("alice");
    await assertFails(
      setDoc(doc(db, "campuses", CAMPUS, "toilets", T, "reviews", "alice"), {
        p: 10, c: 10, k: 10, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
    );
  });

  it("rejects writing a review as someone else", async () => {
    await assertFails(saveReview(as("mallory"), CAMPUS, "alice", T, review, null));
  });

  it("rejects stats that do not match the review (inflated score)", async () => {
    const db = as("mallory");
    const batch = writeBatch(db);
    batch.set(doc(db, "campuses", CAMPUS, "toilets", T, "reviews", "mallory"), {
      p: 1, c: 1, k: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(1), [`t.${T}.p`]: increment(10), [`t.${T}.c`]: increment(10),
      [`t.${T}.k`]: increment(10), [`t.${T}.v`]: increment(0), ref: T, at: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("rejects direct tampering with the stats doc", async () => {
    const db = as("mallory");
    await assertFails(updateDoc(metaDoc(db, "stats"), { [`t.${T}.v`]: increment(100), ref: T, at: serverTimestamp() }));
    await assertFails(setDoc(metaDoc(db, "stats"), { t: { [T]: { n: 1, p: 10, c: 10, k: 10, v: 0 } } }));
  });

  it("rejects a stats change that touches two toilets at once", async () => {
    const db = as("alice");
    const batch = writeBatch(db);
    batch.set(doc(db, "campuses", CAMPUS, "toilets", T, "reviews", "alice"), {
      p: 5, c: 5, k: 5, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(1), [`t.${T}.p`]: increment(5), [`t.${T}.c`]: increment(5),
      [`t.${T}.k`]: increment(5), [`t.${T}.v`]: increment(0),
      [`t.${U}.n`]: increment(1), [`t.${U}.p`]: increment(5), [`t.${U}.c`]: increment(5),
      [`t.${U}.k`]: increment(5), [`t.${U}.v`]: increment(0),
      ref: T, at: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("does not allow deleting a review", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, review, null);
    await assertFails(deleteDoc(doc(db, "campuses", CAMPUS, "toilets", T, "reviews", "alice")));
  });

  it("lets a review count as a visit, without any check-in", async () => {
    const db = as("alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { ...review, countVisit: true }, null));
    expect((await fetchStats(db, CAMPUS))[T]).toEqual({ n: 1, p: 8, c: 6, k: 7, v: 1 });
    // coming back later: edit the review and count another visit
    const first = await fetchMyReview(db, CAMPUS, T, "alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { ...review, countVisit: true }, first));
    expect((await fetchStats(db, CAMPUS))[T].v).toBe(2);
  });

  it("rejects a review that adds more than one visit", async () => {
    const db = as("mallory");
    const batch = writeBatch(db);
    batch.set(doc(db, "campuses", CAMPUS, "toilets", T, "reviews", "mallory"), {
      p: 5, c: 5, k: 5, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(1), [`t.${T}.p`]: increment(5), [`t.${T}.c`]: increment(5),
      [`t.${T}.k`]: increment(5), [`t.${T}.v`]: increment(2), ref: T, at: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });
});

describe("live availability", () => {
  it("lets a user check in and out", async () => {
    const db = as("alice");
    await assertSucceeds(checkIn(db, CAMPUS, "alice", T));
    const live = await fetchLive(anon(), CAMPUS);
    expect(live[T]).toMatchObject({ u: "alice", d: 10 });
    await assertSucceeds(checkOut(db, CAMPUS, T, { countVisit: false }));
    expect(await fetchLive(anon(), CAMPUS)).toEqual({});
    expect(await fetchStats(db, CAMPUS)).toEqual({}); // no visit counted
  });

  it("works on a campus whose aggregate docs do not exist yet", async () => {
    await env.clearFirestore();
    await assertSucceeds(checkIn(as("alice"), CAMPUS, "alice", T));
    expect(Object.keys(await fetchLive(anon(), CAMPUS))).toEqual([T]);
  });

  it("rejects anonymous check-ins", async () => {
    await assertFails(checkIn(anon(), CAMPUS, "alice", T));
  });

  it("rejects checking in as someone else", async () => {
    await assertFails(checkIn(as("mallory"), CAMPUS, "alice", T));
  });

  it("rejects an occupied toilet, but allows it once the check-in expired", async () => {
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(1), d: 10 } }));
    await assertFails(checkIn(as("bob"), CAMPUS, "bob", T));
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(11), d: 10 } }));
    await assertSucceeds(checkIn(as("bob"), CAMPUS, "bob", T));
    expect((await fetchLive(anon(), CAMPUS))[T].u).toBe("bob");
  });

  it("rejects absurd check-in durations", async () => {
    await assertFails(checkIn(as("alice"), CAMPUS, "alice", T, 600));
    await assertFails(checkIn(as("alice"), CAMPUS, "alice", T, 0));
  });

  it("rejects checking someone else out", async () => {
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(1), d: 10 } }));
    await assertFails(checkOut(as("mallory"), CAMPUS, T, { countVisit: false }));
  });
});

describe("visits", () => {
  it("counts a visit when the user checks out after checking in", async () => {
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(2), d: 10 } }));
    const db = as("alice");
    await assertSucceeds(checkOut(db, CAMPUS, T, { countVisit: true }));
    expect((await fetchStats(db, CAMPUS))[T]).toEqual({ n: 0, p: 0, c: 0, k: 0, v: 1 });
    expect(await fetchLive(db, CAMPUS)).toEqual({});
  });

  it("rejects counting a visit without checking in", async () => {
    await assertFails(checkOut(as("alice"), CAMPUS, T, { countVisit: true }));
    const db = as("mallory");
    await assertFails(updateDoc(metaDoc(db, "stats"), { [`t.${T}.v`]: increment(1), ref: T, at: serverTimestamp() }));
  });

  it("rejects counting a visit that lasted less than 20 seconds", async () => {
    await checkIn(as("alice"), CAMPUS, "alice", T);
    await assertFails(checkOut(as("alice"), CAMPUS, T, { countVisit: true }));
  });

  it("rejects counting a visit for someone else's check-in", async () => {
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(2), d: 10 } }));
    await assertFails(checkOut(as("mallory"), CAMPUS, T, { countVisit: true }));
  });

  it("rejects counting more than one visit per check-in", async () => {
    await seed((db) => updateDoc(metaDoc(db, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(2), d: 10 } }));
    const db = as("alice");
    const batch = writeBatch(db);
    batch.update(metaDoc(db, "live"), { [`occ.${T}`]: deleteField(), ref: T, at: serverTimestamp() });
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(0), [`t.${T}.p`]: increment(0), [`t.${T}.c`]: increment(0),
      [`t.${T}.k`]: increment(0), [`t.${T}.v`]: increment(5), ref: T, at: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });
});
