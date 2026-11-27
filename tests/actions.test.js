import { beforeEach, describe, expect, it, vi } from "vitest";
import { endVisit, quickVisit, submitReview } from "../src/actions.js";
import { checkOut, quickThrone, saveReview } from "../src/api.js";
import { readCache } from "../src/cache.js";
import { ensureUser } from "../src/firebase.js";
import { state } from "../src/store.js";

vi.mock("../src/firebase.js", () => ({ db: {}, auth: { currentUser: null }, currentUid: vi.fn(), ensureUser: vi.fn() }));
vi.mock("../src/api.js", () => ({
  checkIn: vi.fn(), checkOut: vi.fn(), fetchMyReview: vi.fn(), fetchProfile: vi.fn(),
  likeReview: vi.fn(), quickThrone: vi.fn(), saveProfile: vi.fn(), saveReview: vi.fn(),
}));
vi.mock("../src/cache.js", () => ({ readCache: vi.fn(), writeCache: vi.fn() }));
vi.mock("../src/sync.js", () => ({ invalidateLive: vi.fn(), invalidateStats: vi.fn() }));
vi.mock("../src/royals.js", () => ({
  currentWeekEntry: vi.fn(), invalidateRoyals: vi.fn(), myRoyalState: vi.fn(), recordSession: vi.fn(),
}));
vi.mock("../src/store.js", () => {
  const state = {};
  return {
    state,
    update: (patch) => Object.assign(state, patch),
    setCheckIn: (checkIn) => { state.checkIn = checkIn; },
  };
});

beforeEach(() => {
  vi.mocked(readCache).mockReset().mockReturnValue(null);
  vi.mocked(ensureUser).mockReset().mockResolvedValue("alice");
  vi.mocked(checkOut).mockReset().mockResolvedValue();
  vi.mocked(quickThrone).mockReset().mockResolvedValue();
  vi.mocked(saveReview).mockReset().mockResolvedValue();
  Object.assign(state, {
    uid: "alice",
    account: null,
    checkIn: { id: "throne", at: Date.now() - 60_000 },
    live: { throne: { u: "alice" } },
    stats: { throne: { n: 1, p: 7, c: 7, k: 7, v: 2 } },
    profile: { rv: {}, vs: { throne: 2 } },
    myReviews: new Map(),
  });
});

describe("check-out celebration eligibility", () => {
  it("returns a counted session only when the write succeeds", async () => {
    expect(await endVisit("throne")).toBe(true);
    expect(state.stats.throne.v).toBe(3);
    expect(state.profile.vs.throne).toBe(3);
  });

  it("does not claim or locally count a rejected, expired check-out", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(checkOut).mockRejectedValue({ code: "permission-denied" });
    try {
      expect(await endVisit("throne")).toBe(false);
      expect(state.stats.throne.v).toBe(2);
      expect(state.profile.vs.throne).toBe(2);
      expect(state.checkIn).toBeNull();
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it("releases a throne without counting it during the local cooldown", async () => {
    vi.mocked(readCache).mockReturnValue({ at: Date.now() - 18 * 60_000, value: true });
    await expect(endVisit("throne")).rejects.toMatchObject({ name: "ThroningCooldownError", remainingMs: expect.any(Number) });
    expect(checkOut).toHaveBeenCalledWith(expect.anything(), expect.anything(), "throne", expect.objectContaining({ countVisit: false }));
    expect(state.stats.throne.v).toBe(2);
    expect(state.checkIn).toBeNull();
  });
});

describe("throning cooldown entry points", () => {
  it("blocks quick logging and a review that also logs a visit", async () => {
    vi.mocked(readCache).mockReturnValue({ at: Date.now() - 60_000, value: true });
    await expect(quickVisit("throne")).rejects.toMatchObject({ name: "ThroningCooldownError" });
    await expect(submitReview("throne", { p: 7, c: 7, k: 7, text: "Blocked visit", countVisit: true }))
      .rejects.toMatchObject({ name: "ThroningCooldownError" });
    expect(quickThrone).not.toHaveBeenCalled();
    expect(saveReview).not.toHaveBeenCalled();
  });

  it("still allows review-only submissions during the cooldown", async () => {
    vi.mocked(readCache).mockReturnValue({ at: Date.now() - 60_000, value: true });
    await submitReview("throne", { p: 7, c: 7, k: 7, text: "Just a review", countVisit: false });
    expect(saveReview).toHaveBeenCalledOnce();
    expect(state.stats.throne.v).toBe(2);
  });
});
