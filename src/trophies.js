// The trophy shelf: three kinds of trophy, all kept in the public royal record by the owner's own phone (no server).
//   Verdict trophies   a review of yours reached 10 / 50 / 100 likes (`lt`, the best one earned).
//   Streaks            consecutive days on the all-time podium, one for the sessions board and one for the explorers
//                      board (`st` = {s, e, d}). A shared daily snapshot (`days/{day}`, created by the first phone that
//                      opens the app that day) says who was on the podium, so the boards are read once per day for the
//                      whole campus. A day nobody opened the app has no snapshot and simply pauses the streak.
//   Season badges      gold / silver / bronze for finishing a finished week on a weekly podium, tallied per quarter
//                      (`wq`: {"2026Q4": {s1: 2, e3: 1}}: board s/e + place, how many weeks: the "x2"). `wl` is the
//                      last week counted. The weekly podium of a finished week is a shared snapshot too (`podiums/{week}`).
// This file is the pure logic (tested); trophy-check.js is the part that talks to Firestore, at most once a day per phone.
export const LIKE_TROPHIES = [
  { threshold: 10, name: "Applauded Verdict", caption: "a verdict with 10 likes" },
  { threshold: 50, name: "Acclaimed Verdict", caption: "a verdict with 50 likes" },
  { threshold: 100, name: "Legendary Verdict", caption: "a verdict with 100 likes" },
];

/** The highest verdict trophy earned by a review with `likes` likes: 0 (none), 10, 50 or 100. */
export const likeTier = (likes) => LIKE_TROPHIES.findLast((t) => likes >= t.threshold)?.threshold ?? 0;

/**
 * The streaks after the daily snapshots `days` (each {d, s: [uid], e: [uid]}, any order; ones already counted are
 * skipped): each snapshot with the user in it adds a day to that board's streak, one without them ends it.
 */
export function stepStreaks(st, days, uid) {
  let { s, e, d } = st ?? { s: 0, e: 0, d: 0 };
  for (const day of [...days].sort((a, b) => a.d - b.d)) {
    if (day.d <= d) continue;
    s = day.s?.includes(uid) ? s + 1 : 0;
    e = day.e?.includes(uid) ? e + 1 : 0;
    d = day.d;
  }
  return { s, e, d };
}

const WEEK_MS = 7 * 86_400_000;
const WEEK_OFFSET_MS = 4 * 86_400_000;

/** "2026Q4": the quarter a leaderboard week belongs to (the one its Monday falls in). */
export function seasonKey(week) {
  const monday = new Date(week * WEEK_MS + WEEK_OFFSET_MS);
  return `${monday.getUTCFullYear()}Q${Math.floor(monday.getUTCMonth() / 3) + 1}`;
}

export const SEASONS = {
  1: { name: "Winter", icon: "❄️" },
  2: { name: "Spring", icon: "🌱" },
  3: { name: "Summer", icon: "🌻" },
  4: { name: "Autumn", icon: "🍂" },
};

/** "2026Q4" -> { year: 2026, quarter: 4, ...SEASONS[4] }. */
export const parseSeason = (key) => ({ year: Number(key.slice(0, 4)), quarter: Number(key.slice(5)), ...SEASONS[Number(key.slice(5))] });

/** The season tally after the weekly podiums `podiums` (each {w, s: [uid], e: [uid]}): s1 = weeks won on the sessions board, etc. */
export function tallySeasons(wq, podiums, uid) {
  const out = structuredClone(wq ?? {});
  for (const p of podiums) {
    for (const board of ["s", "e"]) {
      const place = (p[board] ?? []).indexOf(uid) + 1;
      if (place < 1 || place > 3) continue;
      const season = (out[seasonKey(p.w)] ??= {});
      season[`${board}${place}`] = (season[`${board}${place}`] ?? 0) + 1;
    }
  }
  return out;
}

/** The earned season badges, newest season first: [{key, year, quarter, name, icon, badges: [{board, place, count}]}]. */
export function seasonBadges(wq) {
  return Object.entries(wq ?? {})
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, tally]) => ({
      key,
      ...parseSeason(key),
      badges: Object.entries(tally)
        .filter(([, count]) => count > 0)
        .map(([id, count]) => ({ board: id[0] === "s" ? "sessions" : "explorers", place: Number(id[1]), count }))
        .sort((a, b) => a.place - b.place || (a.board < b.board ? 1 : -1)),
    }))
    .filter((s) => s.badges.length);
}
