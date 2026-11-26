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

// ---- "I just throned": the quick-visit allowance ---------------------------------------------

export const QUICK_PER_DAY = 3;

// A "day" is UTC shifted by one hour, so it rolls over at about midnight in Denmark. Must match
// dayNumber() in firestore.rules, which is what really enforces the limit.
const DAY_SHIFT_MS = 3600_000;

/** yyyymmdd of the allowance day containing `ms`. */
export function dayNumber(ms = Date.now()) {
  const d = new Date(ms + DAY_SHIFT_MS);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + (d.getUTCDate());
}

// The weekly leaderboard: a week runs Monday to Sunday on the same shifted clock as dayNumber(). Must match
// weekNumber() in firestore.rules, which decides which week a counted visit lands in.
const WEEK_MS = 7 * 86_400_000;
const WEEK_OFFSET_MS = 4 * 86_400_000; // 1970-01-01 was a Thursday; the first Monday is 4 days later

/** Number of the week containing `ms` (whole weeks since Monday 1970-01-05). It is the id of the week's board. */
export function weekNumber(ms = Date.now()) {
  return Math.floor((ms + DAY_SHIFT_MS - WEEK_OFFSET_MS) / WEEK_MS);
}

/** When week `week` starts (ms): Monday about midnight in Denmark. The next week starts at `weekStartMs(week + 1)`. */
export const weekStartMs = (week) => week * WEEK_MS + WEEK_OFFSET_MS - DAY_SHIFT_MS;

/** How many quick visits the profile has used today, and how many are left. */
export function quickUsage(profile, ms = Date.now()) {
  const q = profile?.q;
  const used = q && q.d === dayNumber(ms) ? q.n : 0;
  return { used, left: Math.max(0, QUICK_PER_DAY - used) };
}

// ---- kings and queens --------------------------------------------------------------------------

export const TITLES = {
  king: { label: "King", icon: "🤴" },
  queen: { label: "Queen", icon: "👸" },
};

/** "King", "Queen", or "Royal" for someone who hasn't chosen. */
export const titleLabel = (title) => TITLES[title]?.label ?? "Royal";
export const titleIcon = (title) => TITLES[title]?.icon ?? "👑";

/** "26 Nov 2026": a king's or queen's birth date (the day their account was created). */
export function formatBorn(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Key of a liked review in the profile's mirror of what the user liked. */
export const likeKey = (toiletId, authorUid) => `${toiletId}_${authorUid}`;

/**
 * What the public leaderboard shows about a user: their name (chosen, else the generated nickname), avatar,
 * title and birth date.
 */
export function royalIdentity({ uid, profile, bornMs }) {
  return {
    name: displayName(uid, profile?.name),
    emoji: profile?.emoji ?? null,
    title: profile?.title ?? null,
    bornMs,
  };
}

/** The two kinds of board, in the app's voice. `field` is what the board is ranked by on a royal's record. */
export const BOARDS = {
  sessions: { field: "n", title: "The Royal Flush", icon: "🧻", caption: "most throning sessions", unit: ["session", "sessions"] },
  explorers: { field: "x", title: "Throne Hoppers", icon: "🗺️", caption: "most different thrones tried", unit: ["throne", "thrones"] },
};

/** "24 Nov – 30 Nov": the Monday and the Sunday of leaderboard week `week`. */
export function weekLabel(week) {
  const monday = week * WEEK_MS + WEEK_OFFSET_MS; // 00:00 UTC on that Monday
  const day = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${day(monday)} – ${day(monday + 6 * 86_400_000)}`;
}

export const medal = (rank) => ({ 1: "🥇", 2: "🥈", 3: "🥉" })[rank] ?? String(rank);
