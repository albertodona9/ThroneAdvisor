// The whole daily trophy check (checkTrophies) against the rules emulator: the real code path of a phone that opens
// the app, with only the Firebase handle, the profile loader and the first-week constant swapped.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { fetchDaysAfter, fetchPodiumsAfter, fetchRoyal } from "../src/api.js";
import { dayNumber, weekNumber } from "../src/profile.js";
import { seasonKey } from "../src/trophies.js";

const held = vi.hoisted(() => ({ db: null, profile: { rv: {} } }));
vi.mock("../src/firebase.js", () => ({ get db() { return held.db; }, currentUid: async () => "alice" }));
vi.mock("../src/actions.js", () => ({ loadProfile: async () => held.profile }));
vi.mock("../src/config.js", async (original) => {
  const { weekNumber: week } = await import("../src/profile.js");
  return { ...(await original()), ROYALS_FIRST_WEEK: week() - 3 };
});

const { checkTrophies } = await import("../src/trophy-check.js");
const { state } = await import("../src/store.js");

const CAMPUS = "dtu-lyngby"; // the app's own campus id
const DAY = 24 * 3600_000;
let env;
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const born = (daysAgo) => Timestamp.fromMillis(Date.now() - daysAgo * DAY);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-throneadvisor-trophies", // its own project, so it can run beside rules.test.js without clearing its data,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  held.db = env.authenticatedContext("alice").firestore();
  held.profile = { rv: { 255568: { p: 5, c: 5, k: 5, at: 1 }, 999001: { p: 5, c: 5, k: 5, at: 2 } } };
  Object.assign(state, { uid: "alice", myRoyal: null });
  await seed(async (db) => {
    await setDoc(doc(db, "campuses", CAMPUS, "royals", "alice"), { name: "Regal Fox", born: born(30), n: 5, x: 3, ts: { 1: true, 2: true, 3: true } });
    await setDoc(doc(db, "campuses", CAMPUS, "royals", "bob"), { name: "Bob", born: born(20), n: 9, x: 1, ts: { 1: true } });
    await setDoc(doc(db, "campuses", CAMPUS, "toilets", "255568", "reviews", "alice"), { p: 5, c: 5, k: 5, lk: 12 });
    await setDoc(doc(db, "campuses", CAMPUS, "toilets", "999001", "reviews", "alice"), { p: 5, c: 5, k: 5, lk: 3 });
  });
});

describe("the daily trophy check", () => {
  it("creates today's snapshot, starts the streaks, awards the verdict trophy and counts the finished weeks", async () => {
    const week = weekNumber();
    await seed(async (db) => {
      // a finished week whose podium someone already made (alice first), and one nobody made yet (alice second)
      await setDoc(doc(db, "campuses", CAMPUS, "podiums", String(week - 2)), { w: week - 2, s: ["alice"], e: [] });
      await setDoc(doc(db, "campuses", CAMPUS, "weeks", String(week - 1), "royals", "zed"), { name: "Zed", born: born(90), n: 8, x: 1 });
      await setDoc(doc(db, "campuses", CAMPUS, "weeks", String(week - 1), "royals", "alice"), { name: "Regal Fox", born: born(30), n: 4, x: 3 });
    });

    await checkTrophies();

    const alice = await fetchRoyal(env.unauthenticatedContext().firestore(), CAMPUS, "alice");
    expect(alice.st).toEqual({ s: 1, e: 1, d: dayNumber() }); // on both all-time podiums today (bob 9 sessions, alice 5; alice 3 thrones, bob 1)
    expect(alice.lt).toBe(10); // her best review has 12 likes
    expect(alice.wl).toBe(week - 1);
    const tally = { [seasonKey(week - 2)]: { s1: 1 } };
    tally[seasonKey(week - 1)] = { ...tally[seasonKey(week - 1)], s2: 1, e1: 1 };
    expect(alice.wq).toEqual(tally);
    expect(state.myRoyal.all).toMatchObject({ st: alice.st, lt: 10, wl: week - 1 }); // the screen is updated without another read

    const anon = env.unauthenticatedContext().firestore();
    expect(await fetchDaysAfter(anon, CAMPUS, 0)).toEqual([{ d: dayNumber(), s: ["bob", "alice"], e: ["alice", "bob"] }]);
    const made = await fetchPodiumsAfter(anon, CAMPUS, 0);
    expect(made.map((p) => p.w)).toEqual([week - 3, week - 2, week - 1]); // every finished week since the first one has its snapshot now
    expect(made.find((p) => p.w === week - 1)).toMatchObject({ s: ["zed", "alice"], e: ["alice", "zed"] });
  });

  it("doesn't count the same days or weeks twice, and doesn't write when nothing changed", async () => {
    await checkTrophies();
    const anon = env.unauthenticatedContext().firestore();
    const first = await fetchRoyal(anon, CAMPUS, "alice");
    state.myRoyal = null; // a new app open: the phone reads its record again
    await checkTrophies();
    expect(await fetchRoyal(anon, CAMPUS, "alice")).toEqual(first);
  });

  it("carries a saved streak on across days, and ends it on a day she wasn't on the podium", async () => {
    const yesterday = dayNumber() - 1; // a day number just before today (the month boundary doesn't matter: it is only compared)
    await seed(async (db) => {
      await setDoc(doc(db, "campuses", CAMPUS, "royals", "alice"), { name: "Regal Fox", born: born(30), n: 5, x: 3, ts: { 1: true, 2: true, 3: true }, st: { s: 4, e: 2, d: yesterday - 1 } });
      await setDoc(doc(db, "campuses", CAMPUS, "days", String(yesterday)), { d: yesterday, s: ["alice"], e: ["bob"] });
    });
    await checkTrophies();
    // yesterday: on sessions (4 -> 5), off explorers (2 -> 0); today: on both (6 and 1)
    expect((await fetchRoyal(env.unauthenticatedContext().firestore(), CAMPUS, "alice")).st).toEqual({ s: 6, e: 1, d: dayNumber() });
  });

  it("gives someone with no record nothing, and leaves the daily snapshot for the next phone", async () => {
    Object.assign(state, { uid: "alice", myRoyal: null });
    await env.clearFirestore();
    await checkTrophies();
    expect(await fetchDaysAfter(env.unauthenticatedContext().firestore(), CAMPUS, 0)).toEqual([]);
  });
});
