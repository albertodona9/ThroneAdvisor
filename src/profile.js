// Profile logic shared by the UI: what makes a valid username, the avatar choices, and the
// numbers shown on the profile. Mirrors `validName` / `allowedEmoji` in firestore.rules,
// which is what actually enforces them.
import { nickname } from "./nickname.js";

export const EMOJIS = ["🚽", "👑", "🧻", "🦆", "🐢", "🦉", "🐙", "🦄", "🌵", "🍕", "🎩", "🦊", "🐸", "☕", "🚀", "🦔"];

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u;

/** Returns null when the name is fine, else a short reason. Empty means "use the default nickname". */
export function nameProblem(name) {
  const n = (name ?? "").trim();
  if (!n) return null;
  if (n.length < 3) return "Use at least 3 characters.";
  if (n.length > 20) return "Use at most 20 characters.";
  if (!NAME_RE.test(n)) return "Letters, numbers, spaces, _ . - only, starting and ending with a letter or number.";
  return null;
}

/** What to show for a user: their chosen name, else the generated nickname. */
export function displayName(uid, chosen) {
  return chosen || nickname(uid);
}

/** The numbers on the "Me" tab, from the profile's review and visit maps. */
export function profileStats(profile) {
  const reviews = Object.values(profile?.rv ?? {});
  const visits = Object.values(profile?.vs ?? {}).map(Number).filter((n) => n > 0);
  const scoreOf = (r) => (r.p + r.c + r.k) / 3;
  return {
    reviews: reviews.length,
    visits: visits.reduce((a, b) => a + b, 0),
    toilets: new Set([...Object.keys(profile?.rv ?? {}), ...Object.keys(profile?.vs ?? {})]).size,
    avgGiven: reviews.length ? reviews.reduce((a, r) => a + scoreOf(r), 0) / reviews.length : null,
  };
}

/** The user's reviews, newest first, as [{id, p, c, k, at, score}]. */
export function myReviewList(profile) {
  return Object.entries(profile?.rv ?? {})
    .map(([id, r]) => ({ id, ...r, score: (r.p + r.c + r.k) / 3 }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
