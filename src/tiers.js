// The five rating tiers. A toilet's overall score (1-10) maps to one of them, and the tier decides
// its name, picture and colour everywhere in the app. Ranges are "up to and including":
//   up to 2.0 Peasant's Pot · 2.1-4.0 Commoner's Loo · 4.1-6.0 Noble's Rest ·
//   6.1-8.0 Highness's Throne · 8.1-10 The King's Loo
// The artwork is in art/levels (sources) and src/assets/levels (what ships, see scripts/make-level-icons.mjs).
import level1 from "./assets/levels/level-1.webp";
import level2 from "./assets/levels/level-2.webp";
import level3 from "./assets/levels/level-3.webp";
import level4 from "./assets/levels/level-4.webp";
import level5 from "./assets/levels/level-5.webp";

export const TIERS = [
  { level: 1, name: "Peasant's Pot", max: 2, color: "#dc2626", image: level1, tagline: "Hold your breath and your nerve" },
  { level: 2, name: "Commoner's Loo", max: 4, color: "#ea8a0c", image: level2, tagline: "It does the job" },
  { level: 3, name: "Noble's Rest", max: 6, color: "#65a30d", image: level3, tagline: "Perfectly respectable" },
  { level: 4, name: "Highness's Throne", max: 8, color: "#16a34a", image: level4, tagline: "Fit for royalty" },
  { level: 5, name: "The King's Loo", max: 10, color: "#b7791f", image: level5, tagline: "Sit like a monarch" },
];

export const UNRATED_COLOR = "#9ca3af";

/**
 * The tier for an overall score, or null when nobody has rated it yet. The tier follows the score
 * as it is *displayed* (one decimal), so a toilet showing 2.0 is never already a Commoner's Loo.
 */
export function tierFor(score) {
  if (score == null || Number.isNaN(score)) return null;
  const shown = Number(score.toFixed(1));
  return TIERS.find((t) => shown <= t.max) ?? TIERS[TIERS.length - 1];
}
