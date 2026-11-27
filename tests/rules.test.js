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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { checkIn, checkOut, createDaySnapshot, createWeekPodium, fetchAllTimePodium, fetchDaysAfter, fetchPodiumsAfter, fetchWeekPodium, saveTrophies, fetchLive, fetchMyReview, fetchProfile, fetchReviews, fetchBoards, fetchMyRoyalState, fetchRoyal, fetchStats, fetchWeekRoyal, likeReview, quickThrone, saveProfile, saveReview } from "../src/api.js";
import { dayNumber, weekNumber } from "../src/profile.js";

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
    expect((await fetchStats(db, CAMPUS))[T]).toMatchObject({ n: 1, p: 8, c: 6, k: 7, v: 1, l: { u: "alice" } });
    // editing the review later can't count another visit (it could be farmed): use the quick log for that
    const first = await fetchMyReview(db, CAMPUS, T, "alice");
    await assertFails(saveReview(db, CAMPUS, "alice", T, { ...review, countVisit: true }, first));
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { ...review, p: 9, countVisit: false }, first)); // a plain edit is fine
    expect((await fetchStats(db, CAMPUS))[T].v).toBe(1);
  });

  it("does not allow a forged last-claim identity", async () => {
    const db = as("alice");
    await saveProfile(db, CAMPUS, "alice", { name: "Alice Royal" }, []);
    await assertFails(saveReview(
      db,
      CAMPUS,
      "alice",
      T,
      { ...review, countVisit: true },
      null,
      { name: "Alice Royal" },
      null,
      { u: "alice", n: "Forged Royal" },
    ));
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

describe("profiles", () => {
  const userDoc = (db, uid) => doc(db, "users", uid);
  const reviewDoc = (db, id, uid) => doc(db, "campuses", CAMPUS, "toilets", id, "reviews", uid);
  const fox = { name: "Regal Fox", emoji: "🦊" };

  it("keeps a profile private to its owner", async () => {
    await assertSucceeds(setDoc(userDoc(as("alice"), "alice"), { name: "Alice A" }));
    await assertSucceeds(getDoc(userDoc(as("alice"), "alice")));
    await assertFails(getDoc(userDoc(as("bob"), "alice")));
    await assertFails(getDoc(userDoc(anon(), "alice")));
    await assertFails(setDoc(userDoc(as("bob"), "alice"), { name: "Hacked" }));
    await assertFails(getDocs(collection(as("alice"), "users")));
  });

  it("accepts good usernames and rejects bad ones", async () => {
    const db = as("alice");
    for (const name of ["Regal Plunger", "Åse_42", "a.b-c", "Jürgen Müller", "abc", "x".repeat(20)]) {
      await assertSucceeds(setDoc(userDoc(db, "alice"), { name }));
    }
    for (const name of ["ab", "x".repeat(21), " leading", "trailing ", "bad!name", "<script>", "-dash", "emoji😀name"]) {
      await assertFails(setDoc(userDoc(db, "alice"), { name }));
    }
  });

  it("only accepts avatars from the allowed list, and no unknown fields", async () => {
    const db = as("alice");
    await assertSucceeds(setDoc(userDoc(db, "alice"), { emoji: "🦊" }));
    await assertFails(setDoc(userDoc(db, "alice"), { emoji: "💩" }));
    await assertFails(setDoc(userDoc(db, "alice"), { emoji: "not an emoji" }));
    await assertFails(setDoc(userDoc(db, "alice"), { name: "Alice A", admin: true }));
  });

  it("saves and clears frames on the profile and existing reviews without changing scores", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, review, null, { ...fox, frame: "jade" });
    expect(await fetchMyReview(db, CAMPUS, T, "alice")).toMatchObject({ em: fox.emoji, fr: "jade" });
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, review, await fetchMyReview(db, CAMPUS, T, "alice"), { ...fox, frame: "rose" }));
    expect((await fetchMyReview(db, CAMPUS, T, "alice")).fr).toBe("rose");
    const before = await fetchStats(db, CAMPUS);
    for (const frame of ["pearl", "jade", "amethyst", "rose", null]) {
      await assertSucceeds(saveProfile(db, CAMPUS, "alice", { ...fox, frame }, [T]));
      expect((await fetchProfile(db, "alice")).frame).toBe(frame);
      const mine = await fetchMyReview(db, CAMPUS, T, "alice");
      expect(mine).toMatchObject({ fr: frame, p: review.p, c: review.c, k: review.k });
      expect(await fetchStats(db, CAMPUS)).toEqual(before);
    }
  });

  it("rejects unknown and podium-only frames on profiles and reviews", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, review, null, fox);
    for (const frame of ["gold", "silver", "bronze", "custom", "", 42]) {
      await assertFails(setDoc(userDoc(db, "alice"), { ...fox, frame }));
      await assertFails(updateDoc(reviewDoc(db, T, "alice"), { fr: frame }));
      await assertFails(saveReview(db, CAMPUS, "alice", U, review, null, { ...fox, frame }));
    }
    expect((await fetchStats(db, CAMPUS))[U]).toBeUndefined();
  });

  it("records a review and its visit in the user's own history, in the same batch", async () => {
    const db = as("alice");
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { p: 8, c: 6, k: 7, countVisit: true }, null, fox));
    await assertSucceeds(saveReview(db, CAMPUS, "alice", U, { p: 5, c: 5, k: 5 }, null, fox));
    const profile = await fetchProfile(db, "alice");
    expect(profile.rv[T]).toMatchObject({ p: 8, c: 6, k: 7 });
    expect(profile.rv[U]).toMatchObject({ p: 5, c: 5, k: 5 });
    expect(profile.vs).toEqual({ [T]: 1 });
    // the public name + avatar travel on the review itself
    const mine = await fetchMyReview(db, CAMPUS, T, "alice");
    expect(mine).toMatchObject({ by: "Regal Fox", em: "🦊" });
  });

  it("counts a checked-out visit in the user's history", async () => {
    const checkedIn = () => seed((d) => updateDoc(metaDoc(d, "live"), { [`occ.${T}`]: { u: "alice", s: minutesAgo(2), d: 10 } }));
    const db = as("alice");
    await checkedIn();
    await assertSucceeds(checkOut(db, CAMPUS, T, { countVisit: true, uid: "alice" }));
    expect((await fetchProfile(db, "alice")).vs).toEqual({ [T]: 1 });
    await checkedIn();
    await assertSucceeds(checkOut(db, CAMPUS, T, { countVisit: true, uid: "alice" }));
    expect((await fetchProfile(db, "alice")).vs).toEqual({ [T]: 2 });
  });

  it("rejects a review carrying a bad username or avatar", async () => {
    const db = as("alice");
    await assertFails(saveReview(db, CAMPUS, "alice", T, { p: 5, c: 5, k: 5 }, null, { name: "<b>x</b>", emoji: null }));
    await assertFails(saveReview(db, CAMPUS, "alice", T, { p: 5, c: 5, k: 5 }, null, { name: null, emoji: "💩" }));
    expect(await fetchStats(db, CAMPUS)).toEqual({});
  });

  it("renames the user's existing reviews in one go, without touching scores or stats", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, { p: 8, c: 6, k: 7 }, null, null);
    await saveReview(db, CAMPUS, "alice", U, { p: 4, c: 4, k: 4 }, null, null);
    const before = await fetchStats(db, CAMPUS);
    await assertSucceeds(saveProfile(db, CAMPUS, "alice", fox, [T, U]));
    expect(await fetchMyReview(db, CAMPUS, T, "alice")).toMatchObject({ by: "Regal Fox", em: "🦊", p: 8, c: 6, k: 7 });
    expect(await fetchMyReview(db, CAMPUS, U, "alice")).toMatchObject({ by: "Regal Fox", em: "🦊", p: 4 });
    expect(await fetchStats(db, CAMPUS)).toEqual(before);
    expect((await fetchProfile(db, "alice")).name).toBe("Regal Fox");
    // clearing goes back to the default
    await assertSucceeds(saveProfile(db, CAMPUS, "alice", { name: null, emoji: null }, [T, U]));
    expect(await fetchMyReview(db, CAMPUS, T, "alice")).toMatchObject({ by: null, em: null });
    expect((await fetchProfile(db, "alice")).name).toBeNull();
  });

  it("rejects renaming someone else's review", async () => {
    await saveReview(as("alice"), CAMPUS, "alice", T, { p: 8, c: 6, k: 7 }, null, null);
    await assertFails(updateDoc(reviewDoc(as("mallory"), T, "alice"), { by: "Mallory Was Here" }));
  });

  it("rejects using a rename to change scores or text", async () => {
    const db = as("alice");
    await saveReview(db, CAMPUS, "alice", T, { p: 8, c: 6, k: 7 }, null, null);
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { by: "Fine Name", p: 10 }));
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { text: "sneaky" }));
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { by: "bad!name" }));
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { em: "💩" }));
  });

  it("lets a user delete their own profile, and nobody else's", async () => {
    await assertSucceeds(setDoc(userDoc(as("alice"), "alice"), { name: "Alice A" }));
    await assertFails(deleteDoc(userDoc(as("bob"), "alice")));
    await assertSucceeds(deleteDoc(userDoc(as("alice"), "alice")));
  });
});

describe("quick visits (I just throned)", () => {
  const day = dayNumber();
  const userDoc = (db, uid) => doc(db, "users", uid);
  const quick = (db, uid, id, used, d = day) => quickThrone(db, CAMPUS, uid, id, { used, day: d });

  it("allows 3 a day, counts each on the toilet and in the profile, then stops", async () => {
    const db = as("alice");
    await assertSucceeds(quick(db, "alice", T, 0));
    await assertSucceeds(quick(db, "alice", U, 1));
    await assertSucceeds(quick(db, "alice", T, 2));
    const stats = await fetchStats(db, CAMPUS);
    expect(stats[T].v).toBe(2);
    expect(stats[U].v).toBe(1);
    const profile = await fetchProfile(db, "alice");
    expect(profile.q).toEqual({ d: day, n: 3 });
    expect(profile.vs).toEqual({ [T]: 2, [U]: 1 });
    await assertFails(quick(db, "alice", T, 3)); // a fourth one
    await assertFails(quick(db, "alice", T, 0)); // ...or pretending the count is lower
    expect((await fetchStats(db, CAMPUS))[T].v).toBe(2);
  });

  it("counts each user's allowance separately", async () => {
    for (let i = 0; i < 3; i++) await assertSucceeds(quick(as("alice"), "alice", T, i));
    await assertSucceeds(quick(as("bob"), "bob", T, 0));
    expect((await fetchStats(as("bob"), CAMPUS))[T].v).toBe(4);
  });

  it("rejects bumping the counter without using up an allowance", async () => {
    const db = as("alice");
    await assertFails(updateDoc(metaDoc(db, "stats"), { [`t.${T}.v`]: increment(1), ref: T, at: serverTimestamp() }));
    // ...even if the profile is written, as long as the allowance doesn't move by exactly one
    const batch = writeBatch(db);
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(0), [`t.${T}.p`]: increment(0), [`t.${T}.c`]: increment(0),
      [`t.${T}.k`]: increment(0), [`t.${T}.v`]: increment(1), ref: T, at: serverTimestamp(),
    });
    batch.set(userDoc(db, "alice"), { q: { d: day, n: 2 } }, { merge: true }); // skips ahead by two
    await assertFails(batch.commit());
  });

  it("rejects a quick visit that claims the wrong day", async () => {
    await assertFails(quick(as("alice"), "alice", T, 0, day - 1));
    await assertFails(quick(as("alice"), "alice", T, 0, day + 1));
  });

  it("a previous day's allowance doesn't count against today", async () => {
    const yesterday = dayNumber(Date.now() - 24 * 3600_000);
    await seed((db) => setDoc(userDoc(db, "alice"), { q: { d: yesterday, n: 3 } }));
    await assertSucceeds(quick(as("alice"), "alice", T, 0));
    expect((await fetchProfile(as("alice"), "alice")).q).toEqual({ d: day, n: 1 });
  });

  it("can't reset today's allowance by rewriting or deleting the profile", async () => {
    const db = as("alice");
    await quick(db, "alice", T, 0);
    await quick(db, "alice", T, 1);
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day, n: 0 } }));
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day, n: 1 } }));
    await assertFails(setDoc(userDoc(db, "alice"), { name: "Alice A" })); // a full overwrite drops q
    await assertFails(deleteDoc(userDoc(db, "alice")));
    // normal profile changes keep working and keep the allowance
    await assertSucceeds(setDoc(userDoc(db, "alice"), { name: "Alice A" }, { merge: true }));
    expect((await fetchProfile(db, "alice")).q).toEqual({ d: day, n: 2 });
  });

  it("can delete the profile when no allowance was used today", async () => {
    const yesterday = dayNumber(Date.now() - 24 * 3600_000);
    await seed((db) => setDoc(userDoc(db, "alice"), { q: { d: yesterday, n: 3 }, name: "Alice A" }));
    await assertSucceeds(deleteDoc(userDoc(as("alice"), "alice")));
  });

  it("validates the allowance record itself", async () => {
    const db = as("alice");
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day, n: 4 } }));
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day, n: -1 } }));
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day, n: 1, extra: true } }));
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: "today", n: 1 } }));
    await assertFails(setDoc(userDoc(db, "alice"), { q: { d: day - 1, n: 0 } })); // can't be backdated on creation
    await assertSucceeds(setDoc(userDoc(db, "alice"), { q: { d: day, n: 1 } }));
  });
});

describe("likes", () => {
  const reviewDoc = (db, id, uid) => doc(db, "campuses", CAMPUS, "toilets", id, "reviews", uid);
  const likeDoc = (db, id, author, liker) => doc(db, "campuses", CAMPUS, "toilets", id, "reviews", author, "likes", liker);
  const likesOf = async (db, author = "alice") => (await fetchReviews(db, CAMPUS, T)).reviews.find((r) => r.uid === author)?.likes;

  beforeEach(async () => {
    await saveReview(as("alice"), CAMPUS, "alice", T, { p: 8, c: 6, k: 7, text: "Likeable." }, null);
  });

  it("lets someone like a review and shows the count, and remembers it in their profile", async () => {
    await assertSucceeds(likeReview(as("bob"), CAMPUS, T, "alice", "bob", true));
    expect(await likesOf(anon())).toBe(1);
    expect((await fetchProfile(as("bob"), "bob")).lk).toEqual({ [`${T}_alice`]: true });
  });

  it("counts different people separately, and un-liking takes one off", async () => {
    await likeReview(as("bob"), CAMPUS, T, "alice", "bob", true);
    await likeReview(as("carol"), CAMPUS, T, "alice", "carol", true);
    expect(await likesOf(anon())).toBe(2);
    await assertSucceeds(likeReview(as("bob"), CAMPUS, T, "alice", "bob", false));
    expect(await likesOf(anon())).toBe(1);
    expect((await fetchProfile(as("bob"), "bob")).lk).toEqual({});
  });

  it("refuses a second like from the same person, and an un-like of a like that isn't there", async () => {
    await likeReview(as("bob"), CAMPUS, T, "alice", "bob", true);
    await assertFails(likeReview(as("bob"), CAMPUS, T, "alice", "bob", true));
    expect(await likesOf(anon())).toBe(1);
    await likeReview(as("bob"), CAMPUS, T, "alice", "bob", false);
    await assertFails(likeReview(as("bob"), CAMPUS, T, "alice", "bob", false));
    await assertFails(likeReview(as("carol"), CAMPUS, T, "alice", "carol", false)); // carol never liked it
    expect(await likesOf(anon())).toBe(0);
  });

  it("doesn't let you like your own review, or like as someone else, or without signing in", async () => {
    await assertFails(likeReview(as("alice"), CAMPUS, T, "alice", "alice", true));
    await assertFails(likeReview(as("mallory"), CAMPUS, T, "alice", "bob", true));
    await assertFails(likeReview(anon(), CAMPUS, T, "alice", "bob", true));
    expect(await likesOf(anon())).toBe(0);
  });

  it("refuses to move the counter without a matching like (or the other way round)", async () => {
    const db = as("bob");
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { lk: increment(1) })); // no like document
    await assertFails(updateDoc(reviewDoc(db, T, "alice"), { lk: increment(5) }));
    const justTheDoc = writeBatch(db); // a like document without bumping the counter
    justTheDoc.set(likeDoc(db, T, "alice", "bob"), { at: serverTimestamp() });
    await assertFails(justTheDoc.commit());
    const both = writeBatch(db); // counter and document, but the counter jumps by two
    both.set(likeDoc(db, T, "alice", "bob"), { at: serverTimestamp() });
    both.update(reviewDoc(db, T, "alice"), { lk: increment(2) });
    await assertFails(both.commit());
    expect(await likesOf(anon())).toBe(0);
  });

  it("refuses a like that also changes something else on the review", async () => {
    const db = as("bob");
    const batch = writeBatch(db);
    batch.set(likeDoc(db, T, "alice", "bob"), { at: serverTimestamp() });
    batch.update(reviewDoc(db, T, "alice"), { lk: increment(1), p: 1 });
    await assertFails(batch.commit());
    const extra = writeBatch(db);
    extra.set(likeDoc(db, T, "alice", "bob"), { at: serverTimestamp(), note: "x" });
    extra.update(reviewDoc(db, T, "alice"), { lk: increment(1) });
    await assertFails(extra.commit());
  });

  it("doesn't let the author touch their own counter, but editing the review keeps the likes", async () => {
    await likeReview(as("bob"), CAMPUS, T, "alice", "bob", true);
    await assertFails(updateDoc(reviewDoc(as("alice"), T, "alice"), { lk: 99 }));
    const first = await fetchMyReview(as("alice"), CAMPUS, T, "alice");
    await assertSucceeds(saveReview(as("alice"), CAMPUS, "alice", T, { p: 9, c: 9, k: 9, text: "Edited." }, first));
    expect(await likesOf(anon())).toBe(1);
    await assertSucceeds(saveProfile(as("alice"), CAMPUS, "alice", { name: "Alice A", emoji: null }, [T]));
    expect(await likesOf(anon())).toBe(1);
  });

  it("doesn't let a new review start with likes", async () => {
    const db = as("bob");
    const batch = writeBatch(db);
    batch.set(reviewDoc(db, T, "bob"), { p: 5, c: 5, k: 5, lk: 40, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.update(metaDoc(db, "stats"), {
      [`t.${T}.n`]: increment(1), [`t.${T}.p`]: increment(5), [`t.${T}.c`]: increment(5),
      [`t.${T}.k`]: increment(5), [`t.${T}.v`]: increment(0), ref: T, at: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it("can't like a review that doesn't exist", async () => {
    await assertFails(likeReview(as("bob"), CAMPUS, T, "nobody", "bob", true));
  });
});

describe("royals: sessions and the toilets they tried (Throne Hoppers)", () => {
  const V = "777001"; // a third toilet
  const royalDoc = (db, uid) => doc(db, "campuses", CAMPUS, "royals", uid);
  const weekDoc = (db, uid, week = weekNumber()) => doc(db, "campuses", CAMPUS, "weeks", String(week), "royals", uid);
  const userDoc = (db, uid) => doc(db, "users", uid);
  const DAY = 24 * 3600_000;
  const born = Date.now() - 40 * DAY;
  const royal = (extra = {}) => ({ name: "Regal Fox", emoji: "🦊", title: "queen", bornMs: born, ...extra });

  /** What the app does before a counted visit: finds out whether this toilet is new to the user (ever / this week). */
  const flagged = async (db, uid, id, r = royal()) => {
    const mine = await fetchMyRoyalState(db, CAMPUS, uid);
    return { ...r, newAll: !mine.all?.ts?.[id], newWeek: !mine.week?.ts?.[id] };
  };
  const quickRoyal = async (db, uid, id, used, r = royal()) =>
    quickThrone(db, CAMPUS, uid, id, { used, day: dayNumber(), royal: await flagged(db, uid, id, r) });

  const identity = (extra = {}) => ({ name: "Regal Fox", born: Timestamp.fromMillis(born), ...extra });
  /** A counted visit at `id` written by hand, with `extra` in the same batch (to try what the app never does). */
  const handVisit = (db, uid, id, used, extra) => {
    const batch = writeBatch(db);
    batch.update(metaDoc(db, "stats"), {
      [`t.${id}.n`]: increment(0), [`t.${id}.p`]: increment(0), [`t.${id}.c`]: increment(0),
      [`t.${id}.k`]: increment(0), [`t.${id}.v`]: increment(1), ref: id, at: serverTimestamp(),
    });
    batch.set(userDoc(db, uid), { q: { d: dayNumber(), n: used + 1 }, vs: { [id]: increment(1) } }, { merge: true });
    extra(batch);
    return batch.commit();
  };
  const bothBoards = (db, uid, id, { all, week = all }) => (b) => {
    b.set(royalDoc(db, uid), { ...identity(), n: increment(1), ...all }, { merge: true });
    b.set(weekDoc(db, uid), { ...identity(), n: increment(1), ...week }, { merge: true });
  };
  const tried = (id, add = 1) => ({ ts: { [id]: true }, x: increment(add) });

  it("creates the public record on the first counted visit, with the toilet it was at", async () => {
    await assertSucceeds(quickRoyal(as("alice"), "alice", T, 0));
    const all = await fetchRoyal(anon(), CAMPUS, "alice");
    expect(all).toMatchObject({ name: "Regal Fox", emoji: "🦊", title: "queen", n: 1, x: 1, ts: { [T]: true } });
    expect(all.bornMs).toBe(Math.floor(born)); // the birth date is kept
    const week = await fetchWeekRoyal(anon(), CAMPUS, "alice");
    expect(week).toMatchObject({ name: "Regal Fox", n: 1, x: 1, ts: { [T]: true } });
    expect(week.bornMs).toBe(Math.floor(born)); // and is on the weekly entry too (it breaks weekly ties)
  });

  it("a new toilet adds to the tried count, a repeat visit only adds a session, whichever way it was counted", async () => {
    const db = as("alice");
    await assertSucceeds(quickRoyal(db, "alice", T, 0)); // quick log
    await assertSucceeds(saveReview(db, CAMPUS, "alice", T, { p: 5, c: 5, k: 5, countVisit: true }, null, null, await flagged(db, "alice", T))); // new review + visit, same toilet
    await seed((d) => updateDoc(metaDoc(d, "live"), { [`occ.${U}`]: { u: "alice", s: minutesAgo(2), d: 10 } }));
    await assertSucceeds(checkOut(db, CAMPUS, U, { countVisit: true, uid: "alice", royal: await flagged(db, "alice", U) })); // check-out at another toilet
    const mine = await fetchMyRoyalState(anon(), CAMPUS, "alice");
    expect(mine.all).toMatchObject({ n: 3, x: 2, ts: { [T]: true, [U]: true } });
    expect(mine.week).toMatchObject({ n: 3, x: 2 });
    // a visit that isn't counted changes nothing
    await assertSucceeds(saveReview(as("bob"), CAMPUS, "bob", T, { p: 5, c: 5, k: 5, countVisit: false }, null, null, royal()));
    expect(await fetchRoyal(anon(), CAMPUS, "bob")).toBeNull();
  });

  it("builds the four top-3 boards, breaking ties the way each one says", async () => {
    const people = [
      // name, born (days ago), toilets visited in order (each visit is a session)
      ["alice", "Alice Ace", 100, [T, T, T]], // 3 sessions, 1 toilet, the oldest
      ["bob", "Bob Bold", 50, [T, U]], // 2 sessions, 2 toilets
      ["carol", "Carol Calm", 10, [T, U, V]], // 3 sessions, 3 toilets
      ["dave", "Dave Deep", 5, [T]], // 1 session, 1 toilet, the youngest
    ];
    for (const [uid, name, daysOld, visits] of people) {
      const bornMs = Date.now() - daysOld * DAY; // one birth date per person, as with a real account
      for (const [i, id] of visits.entries()) await quickRoyal(as(uid), uid, id, i, royal({ name, bornMs }));
    }
    const b = await fetchBoards(anon(), CAMPUS);
    const names = (list) => list.map((r) => r.name);
    // this week: a tie goes to the OLDEST royal
    expect(names(b.weekSessions)).toEqual(["Alice Ace", "Carol Calm", "Bob Bold"]); // Alice and Carol tie on 3: Alice is older
    expect(names(b.weekExplorers)).toEqual(["Carol Calm", "Bob Bold", "Alice Ace"]); // Alice and Dave tie on 1: Alice is older
    // all time: a tie goes to the YOUNGEST royal
    expect(names(b.allSessions)).toEqual(["Carol Calm", "Alice Ace", "Bob Bold"]); // Carol is younger than Alice
    expect(names(b.allExplorers)).toEqual(["Carol Calm", "Bob Bold", "Dave Deep"]); // Dave is younger than Alice
    expect(b.weekSessions[0]).toMatchObject({ n: 3, x: 1 });
    expect(b.allExplorers[0]).toMatchObject({ n: 3, x: 3 });
    expect(b.week).toBe(weekNumber());
  });

  it("only ever shows three per board, and nobody with nothing in that category", async () => {
    // an older record (from before toilets tried were counted) has sessions but no x at all
    await seed((d) => setDoc(royalDoc(d, "legacy"), { name: "Old Timer", born: Timestamp.fromMillis(born), n: 9 }));
    for (const uid of ["alice", "bob", "carol", "dave"]) await quickRoyal(as(uid), uid, T, 0, royal({ name: `Royal ${uid}` }));
    const b = await fetchBoards(anon(), CAMPUS);
    expect(b.allSessions).toHaveLength(3);
    expect(b.allSessions[0].name).toBe("Old Timer"); // 9 sessions
    expect(b.allExplorers.map((r) => r.name)).not.toContain("Old Timer"); // never tried a toilet since it was counted
  });

  it("a new week starts with empty weekly boards and leaves the all-time ones alone", async () => {
    await quickRoyal(as("alice"), "alice", T, 0);
    for (const week of [weekNumber() + 1, weekNumber() - 1]) {
      const b = await fetchBoards(anon(), CAMPUS, week);
      expect([b.weekSessions, b.weekExplorers]).toEqual([[], []]);
      expect(b.allSessions).toHaveLength(1);
    }
  });

  it("caps what a client can ask for", async () => {
    for (const col of [collection(anon(), "campuses", CAMPUS, "royals"), collection(anon(), "campuses", CAMPUS, "weeks", String(weekNumber()), "royals")]) {
      await assertSucceeds(getDocs(query(col, orderBy("n", "desc"), limit(50))));
      await assertFails(getDocs(query(col, orderBy("n", "desc"), limit(51))));
      await assertFails(getDocs(col));
    }
  });

  it("the tried count can't be set to a number of your choosing", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    await quickRoyal(db, "alice", U, 1);
    const attempt = (used, id, spec) => handVisit(db, "alice", id, used, bothBoards(db, "alice", id, spec));
    // claiming a new toilet without adding it to the set
    await assertFails(attempt(2, V, { all: { x: increment(1) } }));
    // adding a different toilet than the one this visit was at
    await assertFails(attempt(2, V, { all: tried("123456") }));
    // adding two toilets at once, or jumping the count
    await assertFails(attempt(2, V, { all: { ts: { [V]: true, "123456": true }, x: increment(2) } }));
    await assertFails(attempt(2, V, { all: { ts: { [V]: true }, x: increment(5) } }));
    // a repeat toilet claiming to be new
    await assertFails(attempt(2, T, { all: { x: increment(1) } }));
    await assertFails(attempt(2, T, { all: { ts: { [T]: true }, x: increment(1) } }));
    // taking toilets out of the set
    await assertFails(attempt(2, T, { all: { ts: { [U]: deleteField() }, x: increment(-1) } }));
    // none of that went through
    expect(await fetchMyRoyalState(anon(), CAMPUS, "alice")).toMatchObject({ all: { n: 2, x: 2 }, week: { n: 2, x: 2 } });
    // the honest version works
    await assertSucceeds(attempt(2, V, { all: tried(V) }));
    expect(await fetchMyRoyalState(anon(), CAMPUS, "alice")).toMatchObject({ all: { n: 3, x: 3 }, week: { n: 3, x: 3 } });
  });

  it("not claiming a new toilet is allowed: the session counts, the toilet just doesn't count for you", async () => {
    const db = as("carol");
    await quickRoyal(db, "carol", T, 0);
    await assertSucceeds(handVisit(db, "carol", U, 1, bothBoards(db, "carol", U, { all: { x: increment(0) }, week: { x: increment(0) } })));
    expect(await fetchMyRoyalState(anon(), CAMPUS, "carol")).toMatchObject({ all: { n: 2, x: 1 }, week: { n: 2, x: 1 } });
  });

  it("the weekly tried count follows the same rules, independently of the all-time one", async () => {
    // visited T "last week" (record only on the all-time side), so this week T is new to the week but not to all time
    await seed((d) => setDoc(royalDoc(d, "alice"), { ...identity(), n: 1, x: 1, ts: { [T]: true } }));
    const db = as("alice");
    await assertSucceeds(quickRoyal(db, "alice", T, 0));
    expect(await fetchMyRoyalState(anon(), CAMPUS, "alice")).toMatchObject({ all: { n: 2, x: 1 }, week: { n: 1, x: 1, ts: { [T]: true } } });
    // and the weekly side can't claim a new toilet when the set already has it
    await assertFails(handVisit(db, "alice", T, 1, bothBoards(db, "alice", T, { all: { x: increment(0) }, week: { x: increment(1) } })));
  });

  it("n can't be set to a number of your choosing, or move without a counted visit", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    for (const doc_ of [royalDoc, weekDoc]) {
      await assertFails(setDoc(doc_(as("mallory"), "mallory"), { ...identity(), n: 50, ts: { [T]: true }, x: 1 }));
      await assertFails(setDoc(doc_(as("mallory"), "mallory"), { ...identity(), n: 1, ts: { [T]: true }, x: 1 })); // no counted visit
      await assertFails(updateDoc(doc_(db, "alice"), { n: increment(1) }));
      await assertFails(updateDoc(doc_(db, "alice"), { n: 99 }));
      await assertFails(updateDoc(doc_(db, "alice"), { n: 0 }));
    }
    await assertFails(handVisit(db, "alice", T, 1, bothBoards(db, "alice", T, { all: { n: increment(5), x: increment(0) }, week: { x: increment(0) } }))); // jumps by six
    expect((await fetchRoyal(anon(), CAMPUS, "alice")).n).toBe(1);
  });

  it("the weekly entry must carry the real birth date (an invented one could win ties), and only for the running week", async () => {
    const db = as("alice");
    const older = Timestamp.fromMillis(born - 500 * DAY);
    // a weekly entry claiming to be older than the all-time record
    await assertFails(handVisit(db, "alice", T, 0, (b) => {
      b.set(royalDoc(db, "alice"), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
      b.set(weekDoc(db, "alice"), { ...identity({ born: older }), n: increment(1), ...tried(T) }, { merge: true });
    }));
    // a weekly entry without one
    await assertFails(handVisit(db, "alice", T, 0, (b) => {
      b.set(royalDoc(db, "alice"), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
      b.set(weekDoc(db, "alice"), { name: "Regal Fox", n: increment(1), ...tried(T) }, { merge: true });
    }));
    // another week than the running one
    for (const w of [weekNumber() - 1, weekNumber() + 1]) {
      await assertFails(handVisit(db, "alice", T, 0, (b) => {
        b.set(royalDoc(db, "alice"), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
        b.set(weekDoc(db, "alice", w), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
      }));
    }
    await assertFails(handVisit(db, "alice", T, 0, (b) => {
      b.set(royalDoc(db, "alice"), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
      b.set(doc(db, "campuses", CAMPUS, "weeks", "abc", "royals", "alice"), { ...identity(), n: increment(1), ...tried(T) }, { merge: true });
    }));
    await assertSucceeds(handVisit(db, "alice", T, 0, bothBoards(db, "alice", T, { all: tried(T) })));
  });

  it("an older version of the app (which doesn't send the toilets tried) still counts sessions", async () => {
    await seed((d) => setDoc(royalDoc(d, "alice"), { name: "Regal Fox", born: Timestamp.fromMillis(born), n: 4 })); // a record from before
    const db = as("alice");
    // a returning player on an old client: just n + 1
    await assertSucceeds(handVisit(db, "alice", T, 0, (b) => b.set(royalDoc(db, "alice"), { ...identity(), n: increment(1) }, { merge: true })));
    expect((await fetchRoyal(anon(), CAMPUS, "alice")).n).toBe(5);
    // a newcomer on an old client: a record with no toilets tried
    const bob = as("bob");
    await assertSucceeds(handVisit(bob, "bob", T, 0, (b) => b.set(royalDoc(bob, "bob"), { ...identity(), n: increment(1) }, { merge: true })));
    expect((await fetchRoyal(anon(), CAMPUS, "bob")).n).toBe(1);
    // and the current app picks up from there: the old record gets its first toilet
    await assertSucceeds(quickRoyal(db, "alice", U, 1));
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ n: 6, x: 1, ts: { [U]: true } });
  });

  it("only the owner can change or delete their record, and a weekly entry can't be deleted", async () => {
    await quickRoyal(as("alice"), "alice", T, 0);
    await assertFails(updateDoc(royalDoc(as("bob"), "alice"), { name: "Bob Was Here" }));
    await assertFails(updateDoc(weekDoc(as("bob"), "alice"), { name: "Bob Was Here" }));
    await assertFails(deleteDoc(royalDoc(as("bob"), "alice")));
    await assertFails(deleteDoc(weekDoc(as("alice"), "alice")));
    await assertSucceeds(deleteDoc(royalDoc(as("alice"), "alice")));
  });

  it("keeps the birth date fixed and validates the identity", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    await assertFails(updateDoc(royalDoc(db, "alice"), { born: Timestamp.fromMillis(born - DAY) }));
    await assertFails(updateDoc(weekDoc(db, "alice"), { born: Timestamp.fromMillis(born - DAY) }));
    await assertFails(quickRoyal(as("bob"), "bob", T, 0, royal({ title: "god" })));
    await assertFails(quickRoyal(as("bob"), "bob", T, 0, royal({ name: "<b>x</b>" })));
    await assertFails(quickRoyal(as("bob"), "bob", T, 0, royal({ emoji: "💩" })));
    await assertFails(quickRoyal(as("bob"), "bob", T, 0, royal({ bornMs: Date.now() + DAY }))); // born in the future
    await assertFails(quickRoyal(as("bob"), "bob", T, 0, royal({ bornMs: Date.parse("2019-01-01") }))); // implausibly old
    await assertSucceeds(quickRoyal(as("bob"), "bob", T, 0, royal({ name: "Ceremonial Philosopher" }))); // a generated nickname is a fine public name
  });

  it("keeps the all-time name, avatar and title in step with the profile, and the weekly one from the next session on", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    const next = { name: "Queen Alice", emoji: null, title: "king" };
    await assertSucceeds(saveProfile(db, CAMPUS, "alice", next, [], next));
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ name: "Queen Alice", emoji: null, title: "king", n: 1, x: 1 });
    expect(await fetchWeekRoyal(anon(), CAMPUS, "alice")).toMatchObject({ name: "Regal Fox", title: "queen" });
    await quickRoyal(db, "alice", T, 1, royal({ name: "Queen Alice", emoji: null, title: "king" }));
    expect(await fetchWeekRoyal(anon(), CAMPUS, "alice")).toMatchObject({ name: "Queen Alice", emoji: null, title: "king", n: 2, x: 1 });
    // someone with no record yet can still save their profile
    await assertSucceeds(saveProfile(as("bob"), CAMPUS, "bob", next, [], next));
    expect(await fetchRoyal(anon(), CAMPUS, "bob")).toBeNull();
  });

  it("shows the short description and an opted-in student number on the public record, and takes them off again", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    const next = { name: "Regal Fox", emoji: "🦊", title: "queen", bio: "Third floor regular", cy: 2027, sn: "s123456", snPub: true };
    await assertSucceeds(saveProfile(db, CAMPUS, "alice", next, [], next));
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ bio: "Third floor regular", cy: 2027, sn: "s123456", n: 1 });
    expect(await fetchProfile(db, "alice")).toMatchObject({ bio: "Third floor regular", sn: "s123456", snPub: true });
    // keeping the number private: it stays in the private profile and leaves the public record
    const priv = { ...next, snPub: false };
    await assertSucceeds(saveProfile(db, CAMPUS, "alice", priv, [], { ...priv, sn: null }));
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ bio: "Third floor regular", sn: null });
    expect(await fetchProfile(db, "alice")).toMatchObject({ sn: "s123456", snPub: false });
    // a first session creates the record with them
    await assertSucceeds(quickRoyal(as("bob"), "bob", T, 0, royal({ bio: "Hello", sn: "b654321" })));
    expect(await fetchRoyal(anon(), CAMPUS, "bob")).toMatchObject({ bio: "Hello", sn: "b654321" });
  });

  it("refuses a long, multi-line or malformed description / student number, and anyone else editing them", async () => {
    const db = as("alice");
    await quickRoyal(db, "alice", T, 0);
    for (const bad of [{ bio: "x".repeat(81) }, { bio: "two\nlines" }, { bio: "" }, { sn: "s1" }, { sn: "s 123456" }, { sn: "s".repeat(13) }, { cy: 1999 }, { cy: 2100 }, { cy: "27" }]) {
      await assertFails(updateDoc(royalDoc(db, "alice"), bad));
    }
    await assertFails(updateDoc(royalDoc(as("bob"), "alice"), { bio: "Bob was here" }));
    const merge = { merge: true }; // keep the quick-visit allowance (`q`) the first session created
    await assertFails(setDoc(userDoc(db, "alice"), { bio: "x".repeat(81) }, merge));
    await assertFails(setDoc(userDoc(db, "alice"), { sn: "not valid!" }, merge));
    await assertFails(setDoc(userDoc(db, "alice"), { snPub: true }, merge)); // nothing to publish
    await assertFails(setDoc(userDoc(db, "alice"), { cy: 27 }, merge));
    await assertSucceeds(setDoc(userDoc(db, "alice"), { sn: "s123456", snPub: true, bio: "Fine", cy: 2027 }, merge));
  });

  it("stores a king / queen title in the private profile, and only those", async () => {
    const db = as("alice");
    await assertSucceeds(setDoc(doc(db, "users", "alice"), { title: "queen" }));
    await assertSucceeds(setDoc(doc(db, "users", "alice"), { title: "king" }));
    await assertFails(setDoc(doc(db, "users", "alice"), { title: "emperor" }));
  });
});

describe("trophies: the shelf on the royal record, and the daily / weekly podium snapshots", () => {
  const royalDoc = (db, uid) => doc(db, "campuses", CAMPUS, "royals", uid);
  const weekDoc = (db, uid, week = weekNumber()) => doc(db, "campuses", CAMPUS, "weeks", String(week), "royals", uid);
  const born = (daysAgo) => Timestamp.fromMillis(Date.now() - daysAgo * 24 * 3600_000);
  /** A royal record as the rules would have let a first session write it (fixture). */
  const withRecord = (uid, extra = {}) => seed((db) => setDoc(royalDoc(db, uid), { name: `Royal ${uid}`, born: born(30), n: 1, x: 1, ts: { [T]: true }, ...extra }));

  it("lets the owner keep streaks, seasons and the verdict trophy on their record, readable by everyone", async () => {
    await withRecord("alice");
    const shelf = { st: { s: 3, e: 1, d: dayNumber() }, lt: 50, wl: weekNumber() - 1, wq: { "2026Q4": { s1: 2, e3: 1 } } };
    expect(await saveTrophies(as("alice"), CAMPUS, "alice", shelf)).toBe(true);
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ ...shelf, name: "Royal alice", n: 1, x: 1 }); // the counters stay as they were
  });

  it("reads a record without a shelf as an empty one", async () => {
    await withRecord("alice");
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ st: null, lt: 0, wl: 0, wq: {} });
  });

  it("can't start a record with a shelf: a record only begins with a counted session", async () => {
    await assertFails(saveTrophies(as("alice"), CAMPUS, "alice", { lt: 10 }));
    await assertFails(setDoc(doc(as("alice"), "campuses", CAMPUS, "royals", "alice"), { name: "Regal Fox", born: born(30), n: 1, lt: 100 }));
  });

  it("only the owner can change the shelf, and it can't carry other changes with it", async () => {
    await withRecord("alice");
    await assertFails(updateDoc(royalDoc(as("bob"), "alice"), { lt: 100 }));
    await assertFails(updateDoc(royalDoc(anon(), "alice"), { lt: 100 }));
    await assertFails(updateDoc(royalDoc(as("alice"), "alice"), { lt: 100, n: 50 })); // sessions can't be set
    await assertFails(updateDoc(royalDoc(as("alice"), "alice"), { lt: 100, x: 9, ts: { [T]: true, [U]: true } }));
    await assertFails(updateDoc(royalDoc(as("alice"), "alice"), { lt: 100, born: born(900) }));
  });

  it("checks the shape of the shelf", async () => {
    await withRecord("alice");
    const db = as("alice");
    const bad = [
      { lt: 7 }, { lt: 101 }, { lt: "50" },
      { st: { s: -1, e: 0, d: 20261127 } }, { st: { s: 1.5, e: 0, d: 20261127 } }, { st: { s: 1, e: 0 } },
      { st: { s: 1, e: 0, d: 20261127, extra: 1 } }, { st: { s: 100001, e: 0, d: 20261127 } }, { st: [1, 2, 3] },
      { wl: -1 }, { wl: "12" }, { wq: [1] }, { wq: "x" },
      { wq: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`${2000 + i}Q1`, { s1: 1 }])) },
      { trophies: 5 },
    ];
    for (const patch of bad) await assertFails(updateDoc(royalDoc(db, "alice"), patch));
    await assertSucceeds(updateDoc(royalDoc(db, "alice"), { lt: 10 }));
    await assertSucceeds(updateDoc(royalDoc(db, "alice"), { lt: 100 }));
  });

  it("keeps the shelf when a profile change rewrites the name on the record", async () => {
    await withRecord("alice", { st: { s: 2, e: 0, d: 20261127 }, lt: 10 });
    const next = { name: "Queen Alice", emoji: null, title: "queen" };
    await assertSucceeds(saveProfile(as("alice"), CAMPUS, "alice", next, [], next));
    expect(await fetchRoyal(anon(), CAMPUS, "alice")).toMatchObject({ name: "Queen Alice", st: { s: 2, e: 0, d: 20261127 }, lt: 10 });
  });

  describe("daily snapshot of the all-time podium", () => {
    const podium = { s: ["alice", "bob"], e: ["bob"] };
    const dayDoc = (db, d) => doc(db, "campuses", CAMPUS, "days", String(d));

    it("is created once, by whoever gets there first, and then can't be changed", async () => {
      expect(await createDaySnapshot(as("alice"), CAMPUS, dayNumber(), podium)).toBe(true);
      expect(await createDaySnapshot(as("bob"), CAMPUS, dayNumber(), { s: ["bob"], e: [] })).toBe(false); // too late: it exists
      expect(await fetchDaysAfter(anon(), CAMPUS, 0)).toEqual([{ d: dayNumber(), ...podium }]);
      await assertFails(updateDoc(dayDoc(as("alice"), dayNumber()), { s: ["alice"] }));
      await assertFails(deleteDoc(dayDoc(as("alice"), dayNumber())));
    });

    it("is only for today, with at most three names per board, and only for signed-in users", async () => {
      expect(await createDaySnapshot(as("alice"), CAMPUS, dayNumber() - 1, podium)).toBe(false);
      expect(await createDaySnapshot(as("alice"), CAMPUS, dayNumber() + 1, podium)).toBe(false);
      expect(await createDaySnapshot(as("alice"), CAMPUS, dayNumber(), { s: ["a", "b", "c", "d"], e: [] })).toBe(false);
      expect(await createDaySnapshot(anon(), CAMPUS, dayNumber(), podium)).toBe(false);
      await assertFails(setDoc(dayDoc(as("alice"), 20200101), { d: dayNumber(), ...podium })); // the id must be the day
      await assertFails(setDoc(dayDoc(as("alice"), dayNumber()), { d: dayNumber(), ...podium, extra: 1 }));
      expect(await fetchDaysAfter(anon(), CAMPUS, 0)).toEqual([]);
    });

    it("is read after a given day, oldest first, and only in capped queries", async () => {
      await seed(async (db) => {
        for (const d of [20261125, 20261126, 20261127]) await setDoc(dayDoc(db, d), { d, s: [], e: [] });
      });
      expect((await fetchDaysAfter(anon(), CAMPUS, 20261125)).map((x) => x.d)).toEqual([20261126, 20261127]);
      await assertFails(getDocs(query(collection(anon(), "campuses", CAMPUS, "days"), limit(63))));
      await assertFails(getDocs(collection(anon(), "campuses", CAMPUS, "days")));
    });

    it("is made from the all-time boards: most sessions and most toilets tried, the youngest royal winning ties", async () => {
      await withRecord("old", { n: 5, x: 2, born: born(100) });
      await withRecord("young", { n: 5, x: 2, born: born(10) });
      await withRecord("busy", { n: 9, x: 1 });
      await withRecord("hopper", { n: 2, x: 7 });
      await withRecord("never", { n: 1, x: 0 });
      expect(await fetchAllTimePodium(anon(), CAMPUS)).toEqual({ s: ["busy", "young", "old"], e: ["hopper", "young", "old"] });
    });
  });

  describe("podium snapshot of a finished week", () => {
    const podium = { s: ["alice", "bob", "carol"], e: ["carol"] };
    const last = weekNumber() - 1;
    const podiumDoc = (db, w) => doc(db, "campuses", CAMPUS, "podiums", String(w));

    it("is created once for a finished week, and can't be changed", async () => {
      expect(await createWeekPodium(as("alice"), CAMPUS, last, podium)).toBe(true);
      expect(await createWeekPodium(as("bob"), CAMPUS, last, { s: ["bob"], e: [] })).toBe(false);
      expect(await fetchPodiumsAfter(anon(), CAMPUS, last - 1)).toEqual([{ w: last, ...podium }]);
      await assertFails(updateDoc(podiumDoc(as("alice"), last), { s: [] }));
      await assertFails(deleteDoc(podiumDoc(as("alice"), last)));
    });

    it("is refused for the running week, a future one, a mismatched id, too many names or no sign-in", async () => {
      expect(await createWeekPodium(as("alice"), CAMPUS, weekNumber(), podium)).toBe(false);
      expect(await createWeekPodium(as("alice"), CAMPUS, weekNumber() + 1, podium)).toBe(false);
      expect(await createWeekPodium(as("alice"), CAMPUS, last, { s: ["a", "b", "c", "d"], e: [] })).toBe(false);
      expect(await createWeekPodium(anon(), CAMPUS, last, podium)).toBe(false);
      await assertFails(setDoc(podiumDoc(as("alice"), last - 1), { w: last, ...podium }));
      expect(await fetchPodiumsAfter(anon(), CAMPUS, 0)).toEqual([]);
    });

    it("is made from that week's boards: the oldest royal wins a tie, and nobody with nothing counts", async () => {
      const week = weekNumber();
      await seed(async (db) => {
        const entry = (uid, n, x, daysOld) => setDoc(weekDoc(db, uid, week), { name: `Royal ${uid}`, born: born(daysOld), n, x });
        await entry("old", 4, 2, 100);
        await entry("young", 4, 2, 10);
        await entry("busy", 6, 1, 50);
        await entry("idle", 1, 0, 50);
      });
      expect(await fetchWeekPodium(anon(), CAMPUS, week)).toEqual({ s: ["busy", "old", "young"], e: ["old", "young", "busy"] });
      expect(await fetchWeekPodium(anon(), CAMPUS, week - 1)).toEqual({ s: [], e: [] }); // an empty week still gets a (empty) podium
    });
  });
});
