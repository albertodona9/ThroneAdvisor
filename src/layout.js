// MazeMap places many toilet rooms only a metre or two apart (e.g. 034A–E), so their
// bubbles would sit on top of each other. This nudges overlapping toilets on the same
// floor apart for *display only* (`mlng`/`mlat`); `lng`/`lat` stay the true position and
// are what distances are computed from.
//
// Deterministic relaxation: every pair closer than `minSep` pushes each other apart a
// little, repeated until things settle. Isolated toilets never move, and nothing moves
// further than `maxMove` from its true position.

const M_PER_DEG_LAT = 111_320;

export function spreadOverlaps(toilets, { minSep = 4.2, maxMove = 8, iterations = 80 } = {}) {
  if (!toilets.length) return [];
  const lat0 = toilets[0].lat;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);

  const byFloor = new Map();
  toilets.forEach((t, i) => {
    if (!byFloor.has(t.z)) byFloor.set(t.z, []);
    byFloor.get(t.z).push(i);
  });

  const out = toilets.map((t) => ({ ...t, mlng: t.lng, mlat: t.lat }));

  for (const indices of byFloor.values()) {
    const n = indices.length;
    const x0 = indices.map((i) => (toilets[i].lng - toilets[0].lng) * mPerDegLng);
    const y0 = indices.map((i) => (toilets[i].lat - lat0) * M_PER_DEG_LAT);
    const x = [...x0];
    const y = [...y0];

    for (let it = 0; it < iterations; it++) {
      const dx = new Array(n).fill(0);
      const dy = new Array(n).fill(0);
      let moved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          let vx = x[b] - x[a];
          let vy = y[b] - y[a];
          let d = Math.hypot(vx, vy);
          if (d >= minSep) continue;
          if (d < 1e-6) {
            // exactly on top of each other: pick a stable, well-spread direction
            const angle = (a + b * 7) * 2.399963; // golden angle
            vx = Math.cos(angle);
            vy = Math.sin(angle);
            d = 1;
          }
          const push = ((minSep - Math.min(d, minSep)) / 2) * 0.5;
          dx[a] -= (vx / d) * push;
          dy[a] -= (vy / d) * push;
          dx[b] += (vx / d) * push;
          dy[b] += (vy / d) * push;
          moved = true;
        }
      }
      if (!moved) break;
      for (let k = 0; k < n; k++) {
        x[k] += dx[k];
        y[k] += dy[k];
        const ox = x[k] - x0[k];
        const oy = y[k] - y0[k];
        const dist = Math.hypot(ox, oy);
        if (dist > maxMove) {
          x[k] = x0[k] + (ox / dist) * maxMove;
          y[k] = y0[k] + (oy / dist) * maxMove;
        }
      }
    }

    indices.forEach((i, k) => {
      if (x[k] === x0[k] && y[k] === y0[k]) return; // untouched: keep the exact original
      out[i].mlng = round6(toilets[0].lng + x[k] / mPerDegLng);
      out[i].mlat = round6(lat0 + y[k] / M_PER_DEG_LAT);
    });
  }
  return out;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// The spread only exists to keep bubbles legible when they are big relative to the map. Zoomed
// out it applies in full; by `TRUE_ZOOM` the bubbles are small relative to the rooms and sit on
// the real positions.
const FULL_SPREAD_ZOOM = 17.5;
const TRUE_ZOOM = 20;

/** 1 = fully spread, 0 = true positions; steps of 0.05 so the map isn't redrawn on every pixel of zoom. */
export function spreadAmount(zoom) {
  const t = Math.min(1, Math.max(0, (zoom - FULL_SPREAD_ZOOM) / (TRUE_ZOOM - FULL_SPREAD_ZOOM)));
  return Math.round((1 - t) * 20) / 20;
}

/** Where to draw a toilet at a given spread amount: between its true spot and its spread spot. */
export function displayPosition(t, amount) {
  return [t.lng + (t.mlng - t.lng) * amount, t.lat + (t.mlat - t.lat) * amount];
}

/** Metres between two points; only used by tests, equirectangular is plenty at campus scale. */
export function metersBetween(a, b, lat0 = a.lat) {
  const dx = (a.lng - b.lng) * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}
