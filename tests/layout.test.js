import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { displayPosition, metersBetween, spreadAmount, spreadOverlaps } from "../src/layout.js";

const at = (id, lng, lat, z = 1) => ({ id, lng, lat, z, b: "1", f: "S", n: id });
const real = JSON.parse(readFileSync("src/data/toilets-dtu-lyngby.json", "utf8")).toilets;

const display = (t) => ({ lng: t.mlng, lat: t.mlat });
const truth = (t) => ({ lng: t.lng, lat: t.lat });

describe("spreadOverlaps", () => {
  it("leaves isolated toilets exactly where they are", () => {
    const out = spreadOverlaps([at("a", 12.52, 55.786), at("b", 12.521, 55.787)]);
    expect(out.map((t) => [t.mlng, t.mlat])).toEqual([
      [12.52, 55.786],
      [12.521, 55.787],
    ]);
  });

  it("separates toilets on identical coordinates", () => {
    const out = spreadOverlaps([at("a", 12.52, 55.786), at("b", 12.52, 55.786), at("c", 12.52, 55.786)]);
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
      expect(metersBetween(display(out[i]), display(out[j]))).toBeGreaterThan(3.5);
    }
  });

  it("does not mix floors: the same spot on another floor is not an overlap", () => {
    const out = spreadOverlaps([at("a", 12.52, 55.786, 1), at("b", 12.52, 55.786, 2)]);
    expect(out[0].mlng).toBe(12.52);
    expect(out[1].mlat).toBe(55.786);
  });

  it("never moves a toilet further than maxMove and never changes the true position", () => {
    const out = spreadOverlaps(real);
    expect(out).toHaveLength(real.length);
    for (const t of out) {
      expect(metersBetween(display(t), truth(t))).toBeLessThanOrEqual(8.05);
      expect(t.lng).toBe(real.find((r) => r.id === t.id).lng);
    }
  });

  it("untangles the real campus data: far fewer overlapping pairs", () => {
    const overlapping = (list, get) => {
      let pairs = 0;
      const byFloor = Map.groupBy(list, (t) => t.z);
      for (const floor of byFloor.values())
        for (let i = 0; i < floor.length; i++)
          for (let j = i + 1; j < floor.length; j++)
            if (metersBetween(get(floor[i]), get(floor[j])) < 3) pairs++;
      return pairs;
    };
    const before = overlapping(real, truth);
    const after = overlapping(spreadOverlaps(real), display);
    expect(before).toBeGreaterThan(200);
    expect(after).toBeLessThan(before * 0.15);
  });

  it("is deterministic", () => {
    expect(spreadOverlaps(real)).toEqual(spreadOverlaps(real));
  });
});

describe("zoom-dependent spread", () => {
  it("is fully spread zoomed out and on the true positions zoomed in", () => {
    expect(spreadAmount(15)).toBe(1);
    expect(spreadAmount(17.5)).toBe(1);
    expect(spreadAmount(20)).toBe(0);
    expect(spreadAmount(22)).toBe(0);
  });

  it("eases monotonically in between", () => {
    let prev = 1;
    for (let z = 17.5; z <= 20; z += 0.1) {
      const a = spreadAmount(z);
      expect(a).toBeLessThanOrEqual(prev);
      prev = a;
    }
  });

  it("places a bubble between its true and spread spots", () => {
    const [t] = spreadOverlaps([at("a", 12.52, 55.786), at("b", 12.52, 55.786)]);
    expect(displayPosition(t, 1)).toEqual([t.mlng, t.mlat]);
    expect(displayPosition(t, 0)).toEqual([t.lng, t.lat]);
    const [mx] = displayPosition(t, 0.5);
    expect(mx).toBeCloseTo((t.lng + t.mlng) / 2, 9);
  });
});
