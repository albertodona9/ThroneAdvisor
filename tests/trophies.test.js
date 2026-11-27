import { describe, expect, it } from "vitest";
import { weekNumber } from "../src/profile.js";
import { likeTier, seasonBadges, seasonKey, stepStreaks, tallySeasons } from "../src/trophies.js";

describe("verdict trophies", () => {
  it("awards the highest of 10 / 50 / 100 likes reached", () => {
    expect([0, 9, 10, 49, 50, 99, 100, 5000].map(likeTier)).toEqual([0, 0, 10, 10, 50, 50, 100, 100]);
  });
});

describe("streaks on the all-time podium", () => {
  const day = (d, s = [], e = []) => ({ d, s, e });

  it("starts at one on the first snapshot with you in it, and counts each snapshot after", () => {
    const days = [day(20261127, ["me"]), day(20261128, ["me", "x"], ["me"]), day(20261129, ["x", "me"], ["me"])];
    expect(stepStreaks(null, days, "me")).toEqual({ s: 3, e: 2, d: 20261129 });
  });

  it("keeps the two boards apart and ends a streak when you are not in a snapshot", () => {
    const days = [day(20261127, ["me"], ["me"]), day(20261128, ["me"], []), day(20261129, [], ["me"])];
    expect(stepStreaks(null, days, "me")).toEqual({ s: 0, e: 1, d: 20261129 });
  });

  it("carries on from the saved streak, ignores snapshots already counted, and handles any order", () => {
    const saved = { s: 4, e: 0, d: 20261127 };
    const days = [day(20261129, ["me"]), day(20261127, []), day(20261128, ["me"])];
    expect(stepStreaks(saved, days, "me")).toEqual({ s: 6, e: 0, d: 20261129 });
  });

  it("a day nobody opened the app has no snapshot, so it pauses the streak instead of breaking it", () => {
    const saved = { s: 2, e: 0, d: 20261127 };
    expect(stepStreaks(saved, [day(20261130, ["me"])], "me")).toEqual({ s: 3, e: 0, d: 20261130 });
  });

  it("changes nothing when there is nothing new", () => {
    const saved = { s: 2, e: 1, d: 20261127 };
    expect(stepStreaks(saved, [], "me")).toEqual(saved);
    expect(stepStreaks(saved, [day(20261127, [])], "me")).toEqual(saved);
  });
});

describe("season badges", () => {
  it("puts a week in the quarter its Monday falls in", () => {
    expect(seasonKey(2968)).toBe("2026Q4"); // Monday 23 Nov 2026
    expect(seasonKey(weekNumber(Date.parse("2026-03-30T12:00:00Z")))).toBe("2026Q1"); // Monday 30 Mar
    expect(seasonKey(weekNumber(Date.parse("2026-06-29T12:00:00Z")))).toBe("2026Q2"); // Monday 29 Jun
    expect(seasonKey(weekNumber(Date.parse("2026-12-28T12:00:00Z")))).toBe("2026Q4"); // Monday 28 Dec, the week that ends in 2027
    expect(seasonKey(weekNumber(Date.parse("2027-01-04T12:00:00Z")))).toBe("2027Q1");
  });

  it("counts the weeks finished on each place of each board, with a multiplier for repeats", () => {
    const podiums = [
      { w: 2967, s: ["me", "a", "b"], e: ["a", "me"] },
      { w: 2968, s: ["me"], e: [] },
      { w: 2969, s: ["a", "b", "c"], e: ["a"] },
    ];
    expect(tallySeasons({}, podiums, "me")).toEqual({ "2026Q4": { s1: 2, e2: 1 } });
  });

  it("adds to what was already counted and never changes the input", () => {
    const before = { "2026Q4": { s1: 1 } };
    const after = tallySeasons(before, [{ w: 2968, s: ["me"], e: ["x", "y", "me"] }], "me");
    expect(after).toEqual({ "2026Q4": { s1: 2, e3: 1 } });
    expect(before).toEqual({ "2026Q4": { s1: 1 } });
  });

  it("lists the earned badges newest season first, best places first", () => {
    const list = seasonBadges({ "2026Q3": { e3: 1 }, "2026Q4": { s1: 2, e2: 1, s3: 0 } });
    expect(list.map((s) => s.key)).toEqual(["2026Q4", "2026Q3"]);
    expect(list[0]).toMatchObject({ year: 2026, quarter: 4, name: "Autumn" });
    expect(list[0].badges).toEqual([
      { board: "sessions", place: 1, count: 2 },
      { board: "explorers", place: 2, count: 1 },
    ]);
    expect(seasonBadges({})).toEqual([]);
    expect(seasonBadges(undefined)).toEqual([]);
  });
});
