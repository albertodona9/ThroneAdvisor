// The picture of a toilet's tier, with its score on a small tag: used in every toilet row.
import { h } from "./dom.js";
import { formatScore } from "./scoring.js";
import { UNRATED_COLOR, tierFor } from "./tiers.js";

/** Tier artwork + score tag. Unrated toilets get the plain grey "–" bubble (there is no tier to show yet). */
export function tierBadge(score, { size = 46 } = {}) {
  const tier = tierFor(score);
  if (!tier) return h("span", { class: "bubble", style: `background:${UNRATED_COLOR}`, title: "Not rated yet" }, "–");
  return h(
    "span",
    { class: "tier-badge", style: `--size:${size}px`, title: `${tier.name} · Level ${tier.level} of 5` },
    h("img", { src: tier.image, alt: tier.name, width: size, height: size, decoding: "async" }),
    h("span", { class: "tier-score", style: `background:${tier.color}` }, formatScore(score)),
  );
}

/** " · Noble's Rest" style tag for a row title, or nothing when unrated. */
export function tierTag(score) {
  const tier = tierFor(score);
  return tier ? h("span", { class: "tier-tag" }, ` · ${tier.name}`) : null;
}
