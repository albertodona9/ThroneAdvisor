import { describe, expect, it } from "vitest";
import { EMOJIS, QUICK_PER_DAY, dayNumber, displayName, myReviewList, nameProblem, profileStats, quickUsage } from "../src/profile.js";

describe("quick-visit allowance", () => {
  it("rolls the day over one hour after UTC midnight (about midnight in Denmark)", () => {
    expect(dayNumber(Date.parse("2026-11-26T22:59:59Z"))).toBe(20261126);
    expect(dayNumber(Date.parse("2026-11-26T23:00:00Z"))).toBe(20261127);
    expect(dayNumber(Date.parse("2026-12-31T23:30:00Z"))).toBe(20270101); // across a year boundary
    expect(dayNumber(Date.parse("2026-02-28T23:00:00Z"))).toBe(20260301); // across a month boundary
  });

  it("counts today's quick visits and what is left", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(quickUsage(null, now)).toEqual({ used: 0, left: QUICK_PER_DAY });
    expect(quickUsage({ q: { d: 20261126, n: 2 } }, now)).toEqual({ used: 2, left: 1 });
    expect(quickUsage({ q: { d: 20261126, n: 3 } }, now)).toEqual({ used: 3, left: 0 });
  });

  it("forgets yesterday's quick visits", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(quickUsage({ q: { d: 20261125, n: 3 } }, now)).toEqual({ used: 0, left: QUICK_PER_DAY });
  });

  it("never reports a negative number left", () => {
    expect(quickUsage({ q: { d: dayNumber(), n: 9 } }).left).toBe(0);
  });
});

describe("nameProblem", () => {
  it("accepts empty (default nickname) and good names", () => {
    for (const n of ["", "   ", "Regal Plunger", "Åse_42", "Jürgen Müller", "abc"]) expect(nameProblem(n)).toBeNull();
  });
  it("explains bad names", () => {
    expect(nameProblem("ab")).toMatch(/at least 3/);
    expect(nameProblem("x".repeat(21))).toMatch(/at most 20/);
    for (const n of ["bad!name", "<b>hi</b>", "-dash", "dot.", "emoji😀name"]) expect(nameProblem(n)).toMatch(/only/);
  });
  it("trims before checking", () => expect(nameProblem("  Alice  ")).toBeNull());
});

describe("avatars", () => {
  it("offers 16 distinct emojis", () => {
    expect(new Set(EMOJIS).size).toBe(16);
  });
});

describe("displayName", () => {
  it("prefers the chosen name, else a stable generated nickname", () => {
    expect(displayName("u1", "Fox")).toBe("Fox");
    expect(displayName("u1", null)).toBe(displayName("u1", ""));
    expect(displayName("u1", null)).toMatch(/\w+ \w+/);
  });
});

describe("profileStats / myReviewList", () => {
  const profile = {
    rv: { 1: { p: 9, c: 9, k: 9, at: 100 }, 2: { p: 3, c: 6, k: 6, at: 300 } },
    vs: { 1: 4, 3: 2 },
  };
  it("counts reviews, visits, distinct toilets and the average score given", () => {
    const s = profileStats(profile);
    expect(s).toMatchObject({ reviews: 2, visits: 6, toilets: 3 });
    expect(s.avgGiven).toBeCloseTo((9 + 5) / 2);
  });
  it("is safe on an empty / missing profile", () => {
    expect(profileStats(null)).toEqual({ reviews: 0, visits: 0, toilets: 0, avgGiven: null });
    expect(profileStats({ rv: {}, vs: {} }).avgGiven).toBeNull();
  });
  it("lists reviews newest first", () => {
    expect(myReviewList(profile).map((r) => r.id)).toEqual(["2", "1"]);
  });
});
