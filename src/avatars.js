import { h } from "./dom.js";
import { EMOJIS } from "./profile.js";

const NAMES = [
  "Amber King", "Violet Queen", "Sage King", "Pearl Queen",
  "Sunstone King", "Golden Queen", "Onyx King", "Braided Queen",
  "Jade King", "Lotus Queen", "Imperial King", "Orchid Queen",
  "Turquoise King", "Quetzal Queen", "Feathered King", "Marigold Queen",
];

// Keep the existing stored identifiers so profiles and old reviews need no migration.
export const AVATARS = EMOJIS.map((id, index) => ({ id, name: NAMES[index], index }));
export const FRAMES = [
  { id: null, name: "Unframed" },
  { id: "pearl", name: "Pearl", index: 0 },
  { id: "jade", name: "Jade", index: 1 },
  { id: "amethyst", name: "Amethyst", index: 2 },
  { id: "rose", name: "Rose", index: 3 },
];

export const COMMENT_VICTORY_FRAMES = [
  { threshold: 10, id: "feathered", name: "Feathered verdict" },
  { threshold: 25, id: "gilded", name: "Gilded verdict" },
  { threshold: 50, id: "royal", name: "Royal decree" },
];

export function commentVictoryFrame(likes = 0) {
  const count = Number(likes) || 0;
  return [...COMMENT_VICTORY_FRAMES].reverse().find((frame) => count >= frame.threshold) ?? null;
}

export function avatarFrame(frame, rank = null) {
  return ({ 1: "gold", 2: "silver", 3: "bronze" })[rank]
    ?? FRAMES.find((f) => f.id === frame)?.id
    ?? null;
}

const position = (index, columns) => `${(index % columns) * 100 / (columns - 1)}% ${Math.floor(index / columns) * 100 / (columns - 1)}%`;

export function avatarBadge(profile = {}, { size = "small", rank = null } = {}) {
  const portrait = AVATARS.find((a) => a.id === profile.emoji) ?? AVATARS[profile.title === "queen" ? 1 : 0];
  const frame = avatarFrame(profile.frame, rank);
  const ornament = FRAMES.find((f) => f.id === frame);
  const photo = !profile.emoji && profile.photoURL;
  return h(
    "span",
    {
      class: `court-avatar ${size}${frame ? ` frame-${frame}` : ""}`,
      role: "img",
      "aria-label": `${photo ? "Profile photo" : portrait.name}${frame ? `, ${frame} frame` : ""}`,
    },
    photo
      ? h("img", { class: "court-portrait", src: photo, alt: "", referrerpolicy: "no-referrer" })
      : h("span", { class: "court-portrait", style: `background-position:${position(portrait.index, 4)}` }),
    ornament?.index != null
      ? h("span", { class: "court-frame", style: `background-position:${position(ornament.index, 2)}` })
      : null,
  );
}
