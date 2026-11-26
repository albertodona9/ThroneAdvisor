import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreColor } from "../src/scoring.js";
import { TIERS, UNRATED_COLOR, tierFor } from "../src/tiers.js";

const name = (score) => tierFor(score)?.name;

describe("tierFor", () => {
  it("has the five tiers in order, with the agreed names", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["Peasant's Pot", "Commoner's Loo", "Noble's Rest", "Highness's Throne", "The King's Loo"]);
    expect(TIERS.map((t) => t.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it("maps the ranges: up to 2 / 2.1-4 / 4.1-6 / 6.1-8 / 8.1-10", () => {
    expect(name(1)).toBe("Peasant's Pot");
    expect(name(2)).toBe("Peasant's Pot");
    expect(name(2.1)).toBe("Commoner's Loo");
    expect(name(4)).toBe("Commoner's Loo");
    expect(name(4.1)).toBe("Noble's Rest");
    expect(name(6)).toBe("Noble's Rest");
    expect(name(6.1)).toBe("Highness's Throne");
    expect(name(8)).toBe("Highness's Throne");
    expect(name(8.1)).toBe("The King's Loo");
    expect(name(10)).toBe("The King's Loo");
  });

  it("follows the score as displayed (one decimal), so the label never disagrees with the number", () => {
    expect(name(2.04)).toBe("Peasant's Pot"); // shows 2.0
    expect(name(2.06)).toBe("Commoner's Loo"); // shows 2.1
    expect(name(4.0 + 0.04)).toBe("Commoner's Loo"); // shows 4.0
    expect(name(7.96)).toBe("Highness's Throne"); // shows 8.0
    expect(name(8.04)).toBe("Highness's Throne"); // shows 8.0
    expect(name(8.05 + 0.0001)).toBe("The King's Loo"); // shows 8.1
  });

  it("has no tier for an unrated toilet", () => {
    expect(tierFor(null)).toBeNull();
    expect(tierFor(undefined)).toBeNull();
    expect(tierFor(NaN)).toBeNull();
  });

  it("is safe outside the nominal range", () => {
    expect(name(0)).toBe("Peasant's Pot");
    expect(name(11)).toBe("The King's Loo");
  });

  it("covers every score a toilet can really have, with each tier's colour and image", () => {
    // scores are averages of integers 1-10, in thirds and more: sweep the whole range finely
    const seen = new Set();
    for (let s = 1; s <= 10; s += 0.01) seen.add(tierFor(s).level);
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
    for (const t of TIERS) {
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof t.image).toBe("string");
      expect(t.image.length).toBeGreaterThan(0);
    }
    expect(new Set(TIERS.map((t) => t.image)).size).toBe(5); // five different pictures
  });

  it("only ever moves up as the score goes up", () => {
    let last = 0;
    for (let s = 1; s <= 10; s += 0.05) {
      const level = tierFor(s).level;
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });
});

describe("scoreColor", () => {
  it("is the colour of the tier, grey when unrated", () => {
    expect(scoreColor(null)).toBe(UNRATED_COLOR);
    expect(scoreColor(1.5)).toBe(TIERS[0].color);
    expect(scoreColor(9.5)).toBe(TIERS[4].color);
  });
});

describe("artwork files", () => {
  it("the source art and the shipped icons both exist for every level", () => {
    for (let n = 1; n <= 5; n++) {
      expect(existsSync(`art/levels/level_${n}.png`), `art/levels/level_${n}.png`).toBe(true);
      expect(existsSync(`src/assets/levels/level-${n}.webp`), `src/assets/levels/level-${n}.webp`).toBe(true);
    }
  });
});
