import { describe, expect, it } from "vitest";
import { shouldExpand } from "../src/sheet-swipe.js";

const COLLAPSED = 186;
const EXPANDED = 440;
const MID = (COLLAPSED + EXPANDED) / 2; // 313
const decide = (height, samples, now = 1000) => shouldExpand({ height, collapsed: COLLAPSED, expanded: EXPANDED, samples, now });

describe("shouldExpand (where the sheet settles when the finger lifts)", () => {
  it("settles by position when there is no flick", () => {
    const slow = [{ y: 600, t: 0 }, { y: 590, t: 600 }]; // 10px in 600ms: ~0.02 px/ms
    expect(decide(MID + 10, slow)).toBe(true); // left more than halfway up
    expect(decide(MID - 10, slow)).toBe(false); // left less than halfway
    expect(decide(COLLAPSED + 30, slow)).toBe(false); // a small drag snaps back
    expect(decide(EXPANDED - 30, slow)).toBe(true);
  });

  it("a fast flick up expands even from a short drag", () => {
    const flickUp = [{ y: 640, t: 940 }, { y: 600, t: 990 }]; // 40px up in 50ms: 0.8 px/ms
    expect(decide(COLLAPSED + 40, flickUp, 1000)).toBe(true);
  });

  it("a fast flick down collapses even from a nearly fully open sheet", () => {
    const flickDown = [{ y: 400, t: 940 }, { y: 440, t: 990 }];
    expect(decide(EXPANDED - 20, flickDown, 1000)).toBe(false);
  });

  it("a finger that pauses before lifting is judged by position, not by the earlier speed", () => {
    const fastThenStill = [{ y: 640, t: 100 }, { y: 600, t: 150 }, { y: 600, t: 600 }]; // flick, then 850ms of rest
    expect(decide(COLLAPSED + 40, fastThenStill, 1000)).toBe(false);
  });

  it("a flick slower than the threshold does not override position", () => {
    const gentle = [{ y: 640, t: 800 }, { y: 610, t: 990 }]; // 30px in 190ms: ~0.16 px/ms
    expect(decide(COLLAPSED + 30, gentle, 1000)).toBe(false);
    expect(decide(EXPANDED - 30, gentle, 1000)).toBe(true);
  });

  it("handles a gesture with a single sample", () => {
    expect(decide(MID + 1, [{ y: 600, t: 990 }])).toBe(true);
    expect(decide(MID - 1, [{ y: 600, t: 990 }])).toBe(false);
  });
});
