// Fills the LOCAL emulator with believable demo data (never touches production):
//   npm run emulators      (in one terminal)
//   npm run seed           (in another)
// Writes bypass the security rules, but produce exactly the documents the app writes.
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { weekNumber } from "../src/profile.js";

const CAMPUS = "dtu-lyngby";
const registry = JSON.parse(readFileSync("src/data/toilets-dtu-lyngby.json", "utf8"));

const env = await initializeTestEnvironment({
  projectId: "throneadvisor-0",
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
});

// Deterministic pseudo-random so reseeding gives the same demo data.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const TEXTS = [
  "Spotless and quiet. Would sit again.",
  "Lock is a bit wobbly but otherwise great.",
  "Heated seat?! In THIS economy?",
  "Never enough paper after 2 pm.",
  "Hidden gem. Nobody ever comes here.",
  "You can hear the whole corridor. Choose wisely.",
  "Smells like exam week.",
  "Spacious stall, good hooks for the backpack.",
  "Clean, bright, fast. 10/10 would flush again.",
  "Cold. Very cold. But private!",
];

// Toilets near the middle of campus get demo ratings so the map isn't empty at the start.
const centre = { lng: 12.5195, lat: 55.7863 };
const near = registry.toilets
  .map((t) => ({ t, d: Math.hypot((t.lng - centre.lng) * 0.56, t.lat - centre.lat) }))
  .sort((a, b) => a.d - b.d)
  .slice(0, 90)
  .map((x) => x.t);

const stats = {};
const reviews = [];
for (const t of near) {
  if (rand() < 0.25) continue; // leave some unrated
  const n = int(1, 9);
  const base = int(3, 9);
  const e = { n, p: 0, c: 0, k: 0, v: n * int(2, 12) };
  for (let i = 0; i < n; i++) {
    const clamp = (x) => Math.max(1, Math.min(10, x));
    const r = { p: clamp(base + int(-2, 2)), c: clamp(base + int(-2, 2)), k: clamp(base + int(-2, 2)) };
    e.p += r.p; e.c += r.c; e.k += r.k;
    reviews.push({ id: t.id, uid: `demo-user-${int(1, 400)}-${i}`, ...r, text: rand() < 0.6 ? pick(TEXTS) : null, ageMin: int(5, 60 * 24 * 40) });
  }
  stats[t.id] = e;
}

const occ = {};
for (const t of near.slice(0, 6)) {
  if (rand() < 0.6) occ[t.id] = { u: "demo-occupant", s: Timestamp.fromMillis(Date.now() - int(0, 5) * 60_000), d: 10 };
}

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "campuses", CAMPUS, "meta", "stats"), { t: stats });
  await setDoc(doc(db, "campuses", CAMPUS, "meta", "live"), { occ });
  for (const r of reviews) {
    const at = Timestamp.fromMillis(Date.now() - r.ageMin * 60_000);
    await setDoc(doc(db, "campuses", CAMPUS, "toilets", r.id, "reviews", r.uid), {
      p: r.p, c: r.c, k: r.k, ...(r.text ? { text: r.text } : {}), ...(r.text && rand() < 0.5 ? { lk: int(1, 7) } : {}),
      createdAt: at, updatedAt: at,
    });
  }

  // A demo leaderboard of kings and queens (the app creates these records itself as people throne).
  const ROYALS = [
    ["Ceremonial Countess", "queen", "👑"], ["Silent Baron", "king", "🎩"], ["Regal Plunger", "king", null],
    ["Porcelain Duke", "king", "🦉"], ["Gentle Monarch", "queen", "🦄"], ["Humble Squire", "king", null],
    ["Noble Pilgrim", "queen", "🌵"], ["Swift Regent", null, "🚀"], ["Brave Sitter", "king", "🦊"],
    ["Thoughtful Captain", "queen", null], ["Mighty Wizard", "king", "🐸"], ["Calm Scholar", "queen", "☕"],
  ];
  // Each has an all-time record and an entry on this week's board; `ts` is the set of toilets they have tried
  // and `x` its size (what "Throne Hoppers" ranks by), `n` their sessions (what "The Royal Flush" ranks by).
  const ids = registry.toilets.map((t) => t.id);
  const toiletSet = (k) => Object.fromEntries([...ids].sort(() => rand() - 0.5).slice(0, k).map((id) => [id, true]));
  for (const [i, [name, title, emoji]] of ROYALS.entries()) {
    const base = {
      name, ...(emoji ? { emoji } : {}), ...(title ? { title } : {}),
      born: Timestamp.fromMillis(Date.now() - int(10, 300) * 86_400_000),
    };
    const n = 60 - i * 4 - int(0, 3);
    const x = Math.min(n, int(3, 40));
    await setDoc(doc(db, "campuses", CAMPUS, "royals", `demo-royal-${i}`), { ...base, n, x, ts: toiletSet(x) });
    const weekN = int(1, 9);
    const weekX = Math.min(weekN, int(1, 6));
    await setDoc(doc(db, "campuses", CAMPUS, "weeks", String(weekNumber()), "royals", `demo-royal-${i}`), { ...base, n: weekN, x: weekX, ts: toiletSet(weekX) });
  }
});
await env.cleanup();
console.log(`Seeded ${Object.keys(stats).length} rated toilets, ${reviews.length} reviews, ${Object.keys(occ).length} in use.`);
