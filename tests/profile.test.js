import { describe, expect, it } from "vitest";
import { BOARDS, EMOJIS, QUICK_PER_DAY, dayNumber, displayName, formatBorn, likeKey, medal, myReviewList, nameProblem, profileStats, quickUsage, royalIdentity, titleIcon, titleLabel, weekLabel, weekNumber, weekStartMs } from "../src/profile.js";

describe("weekly leaderboard weeks", () => {
  // Monday 2026-11-23 00:00 in Denmark (winter, UTC+1) is Sunday 23:00 UTC.
  const monday = Date.parse("2026-11-22T23:00:00Z");

  it("starts a new week on Monday at about midnight in Denmark", () => {
    expect(weekNumber(monday)).toBe(weekNumber(monday - 1) + 1);
    expect(weekNumber(monday + 7 * 86_400_000 - 1)).toBe(weekNumber(monday)); // up to the next Monday
    expect(weekNumber(monday + 7 * 86_400_000)).toBe(weekNumber(monday) + 1);
  });

  it("keeps Monday to Sunday in one week", () => {
    const w = weekNumber(monday);
    for (let d = 0; d < 7; d++) expect(weekNumber(monday + d * 86_400_000 + 3600_000)).toBe(w);
  });

  it("gives the start of a week back", () => {
    const w = weekNumber(monday + 3 * 86_400_000);
    expect(weekStartMs(w)).toBe(monday);
    expect(weekNumber(weekStartMs(w))).toBe(w);
    expect(weekNumber(weekStartMs(w) - 1)).toBe(w - 1);
  });
});

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

describe("kings and queens", () => {
  it("labels titles, with a neutral default for someone who hasn't chosen", () => {
    expect(titleLabel("king")).toBe("King");
    expect(titleLabel("queen")).toBe("Queen");
    expect(titleLabel(null)).toBe("Royal");
    expect(titleLabel("emperor")).toBe("Royal");
    expect(titleIcon("king")).not.toBe(titleIcon("queen"));
    expect(titleIcon(null)).toBe("👑");
  });

  it("formats a birth date as day, short month and year, and tolerates a missing one", () => {
    expect(formatBorn(Date.UTC(2026, 10, 26, 12))).toBe("26 Nov 2026");
    expect(formatBorn(Date.UTC(2027, 0, 5, 12))).toBe("5 Jan 2027");
    expect(formatBorn(null)).toBe("");
  });

  it("builds the key of a liked review from the toilet and the review's author", () => {
    expect(likeKey("255568", "abc")).toBe("255568_abc");
  });

  it("describes a user for the leaderboard: chosen name, else a generated nickname, plus avatar, title and birth", () => {
    const born = Date.UTC(2026, 10, 1);
    expect(royalIdentity({ uid: "u1", profile: { name: "Queen Alice", emoji: "🦊", title: "queen" }, bornMs: born })).toEqual({ name: "Queen Alice", emoji: "🦊", title: "queen", bornMs: born });
    const anon = royalIdentity({ uid: "u1", profile: null, bornMs: born });
    expect(anon.name).toBe(displayName("u1", null));
    expect(anon).toMatchObject({ emoji: null, title: null, bornMs: born });
  });

  it("generated nicknames are always acceptable public names (letters and spaces, at most 30)", () => {
    for (let i = 0; i < 500; i++) {
      const name = displayName(`user-${i}`, null);
      expect(name).toMatch(/^[A-Za-z][A-Za-z ]{1,28}[A-Za-z]$/);
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it("describes the two kinds of board: what they're called and which field they rank by", () => {
    expect(BOARDS.sessions).toMatchObject({ title: "The Royal Flush", field: "n" });
    expect(BOARDS.explorers).toMatchObject({ title: "Throne Hoppers", field: "x" });
    for (const b of Object.values(BOARDS)) {
      expect(b.unit).toHaveLength(2); // [singular, plural]
      expect(b.caption.length).toBeGreaterThan(5);
    }
  });

  it("labels a leaderboard week with its Monday and its Sunday, whatever the viewer's time zone", () => {
    // the week of Monday 23 Nov 2026 to Sunday 29 Nov 2026 (26 Nov 2026 is a Thursday)
    const week = weekNumber(Date.UTC(2026, 10, 26, 12));
    expect(weekLabel(week)).toBe("23 Nov – 29 Nov");
    expect(weekLabel(week + 1)).toBe("30 Nov – 6 Dec"); // across a month boundary
    expect(weekLabel(weekNumber(Date.UTC(2026, 11, 29, 12)))).toBe("28 Dec – 3 Jan"); // across a year boundary
  });

  it("gives medals to the first three and plain numbers after that", () => {
    expect([1, 2, 3, 4, 10].map(medal)).toEqual(["🥇", "🥈", "🥉", "4", "10"]);
  });
});
