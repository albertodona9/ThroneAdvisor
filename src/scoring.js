import { UNRATED_COLOR, tierFor } from "./tiers.js";

// Scores are integers 1–10. Stats keep SUMS (not averages) so they can be updated with
// atomic increments and validated by the security rules.

/** Overall score of a toilet (mean of the three category means), or null when unrated. */
export function overallScore(e) {
  if (!e || !e.n) return null;
  return (e.p + e.c + e.k) / (3 * e.n);
}

export function categoryScores(e) {
  if (!e || !e.n) return null;
  return { privacy: e.p / e.n, cleanliness: e.c / e.n, comfort: e.k / e.n };
}

/** Overall score of a single review. */
export function reviewScore(r) {
  return (r.p + r.c + r.k) / 3;
}

/**
 * Ranking score: pulls toilets with very few reviews toward the middle so a single 10
 * doesn't beat a toilet with fifty 9s. The displayed score stays the plain average.
 */
export function rankScore(e) {
  const avg = overallScore(e);
  if (avg == null) return null;
  const PRIOR_MEAN = 6.5;
  const PRIOR_WEIGHT = 2;
  return (avg * e.n + PRIOR_MEAN * PRIOR_WEIGHT) / (e.n + PRIOR_WEIGHT);
}

export function formatScore(score) {
  return score == null ? "–" : score.toFixed(1);
}

/** Colour of a score: the colour of its tier (src/tiers.js). Grey when nobody has rated it yet. */
export function scoreColor(score) {
  return tierFor(score)?.color ?? UNRATED_COLOR;
}
