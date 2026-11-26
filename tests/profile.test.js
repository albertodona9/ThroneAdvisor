import { describe, expect, it } from "vitest";
import { EMOJIS, displayName, myReviewList, nameProblem, profileStats } from "../src/profile.js";

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
