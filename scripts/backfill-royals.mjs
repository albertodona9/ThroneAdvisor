// One-off: credit the visits people made BEFORE the royals leaderboard existed.
//
// The app can't do this itself: the security rules only let a record's `n` move +1 together with a counted
// visit, which is exactly what stops people from giving themselves a score. This script uses the Admin SDK,
// which bypasses the rules, and trusts each user's own visit history (`vs` in `users/{uid}`, written in the
// same batch as every counted visit). It fills the ALL-TIME board only: the weekly one can't be backfilled,
// because past visits have no dates.
//
// For every user with visits it sets `campuses/{campus}/royals/{uid}.n` to the total of their `vs`:
//   - no record yet       -> creates it (name, avatar, title from the profile; birth date = account creation)
//   - record with a lower n -> raises n (a visit counted after the launch is in `vs` too, so nothing is counted twice)
//   - record already >= vs  -> left alone
// It also fills the "toilets tried" set of the record (`ts`, and its size `x`) from the toilets in `vs`, because the
// rules and the app treat a toilet that is in a user's history but not in their record's `ts` as a mismatch.
// Skip that with --no-tried. It is idempotent (it SETS n, never adds), so running it twice changes nothing the second time.
//
// DRY RUN BY DEFAULT: it only prints what it would do. Pass --apply to write.
//
//   npm i --no-save firebase-admin
//   gcloud auth application-default login          # your own login; never put a service-account key in the repo
//   node scripts/backfill-royals.mjs --project throneadvisor-0            # dry run
//   node scripts/backfill-royals.mjs --project throneadvisor-0 --apply    # write
//
// Against the emulators (no credentials needed), start them and set FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST.
//
// Cost: reads every document in `users` once (one read per user) plus the royals records, and writes one per user.
// Run it when the app is quiet: a visit counted between its read and its write would be missed (re-run to catch up).
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { nickname } from "../src/nickname.js";
import { EMOJIS } from "../src/profile.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const APPLY = flag("apply");
const CAMPUS = option("campus", "dtu-lyngby");
const PROJECT = option("project", process.env.GCLOUD_PROJECT);
const EMULATOR = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const TRIED = !flag("no-tried");
const MAX_TRIED = 1000; // the rules refuse a record whose `ts` has more entries than this

if (!PROJECT) {
  console.error("Say which Firebase project to use: --project <id> (see .firebaserc). Nothing was read or written.");
  process.exit(1);
}

initializeApp({ projectId: PROJECT, ...(EMULATOR ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
const auth = getAuth();

// Same limits as validRoyal() / validIdentity() in firestore.rules, so the records look like the app's own.
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,28}[\p{L}\p{N}]$/u;
const OLDEST_BORN_MS = Date.UTC(2024, 0, 1);

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** The toilets a profile has a counted visit at, most visited first, as the `ts` map {toiletId: true}. */
function triedSet(vs) {
  const ids = Object.entries(vs ?? {})
    .filter(([, n]) => Number.isInteger(Number(n)) && Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, MAX_TRIED)
    .map(([id]) => id);
  return Object.fromEntries(ids.map((id) => [id, true]));
}

/** Total of a profile's visits map ({toiletId: count}). Anything that isn't a positive whole number is ignored. */
function totalVisits(vs) {
  return Object.values(vs ?? {})
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .reduce((a, b) => a + b, 0);
}

console.log(`${APPLY ? "APPLYING to" : "DRY RUN on"} project "${PROJECT}"${EMULATOR ? " (emulator)" : ""}, campus "${CAMPUS}".`);

// 1. Everyone with a visit history.
const usersSnap = await db.collection("users").select("name", "emoji", "title", "vs").get();
const candidates = usersSnap.docs
  .map((d) => ({ uid: d.id, profile: d.data(), sessions: totalVisits(d.data().vs) }))
  .filter((u) => u.sessions > 0);
console.log(`${usersSnap.size} profiles read, ${candidates.length} with at least one counted visit.`);

// 2. Their existing royal records (n only), and their account creation dates (for the birth date).
const royalRef = (uid) => db.collection("campuses").doc(CAMPUS).collection("royals").doc(uid);
const existing = new Map();
for (const part of chunk(candidates, 300)) {
  const snaps = await db.getAll(...part.map((u) => royalRef(u.uid)), { fieldMask: ["n", "ts"] });
  for (const s of snaps) if (s.exists) existing.set(s.id, { n: s.data().n, ts: s.data().ts ?? {} });
}

const created = new Map(); // uid -> account creation time (ms)
for (const part of chunk(candidates, 100)) {
  const { users } = await auth.getUsers(part.map((u) => ({ uid: u.uid })));
  for (const u of users) created.set(u.uid, Date.parse(u.metadata.creationTime));
}

// 3. Decide what to do for each.
const plan = { create: [], raise: [], same: [], noAccount: [] };
for (const u of candidates) {
  const record = existing.get(u.uid);
  if (record) {
    // Keep what the record already has, and add the toilets from the history.
    const ts = TRIED ? { ...triedSet(u.profile.vs), ...record.ts } : record.ts;
    const raiseN = record.n < u.sessions;
    const raiseTried = TRIED && Object.keys(ts).length > Object.keys(record.ts).length;
    (raiseN || raiseTried ? plan.raise : plan.same).push({ ...u, had: record.n, update: { ...(raiseN ? { n: u.sessions } : {}), ...(raiseTried ? { ts, x: Object.keys(ts).length } : {}) } });
    continue;
  }
  const bornMs = created.get(u.uid);
  if (!Number.isFinite(bornMs)) {
    plan.noAccount.push(u); // the account no longer exists: don't put a ghost on the leaderboard
    continue;
  }
  const p = u.profile;
  plan.create.push({
    ...u,
    record: {
      name: typeof p.name === "string" && NAME_RE.test(p.name) ? p.name : nickname(u.uid),
      ...(EMOJIS.includes(p.emoji) ? { emoji: p.emoji } : {}),
      ...(p.title === "king" || p.title === "queen" ? { title: p.title } : {}),
      born: Timestamp.fromMillis(Math.min(Math.max(bornMs, OLDEST_BORN_MS), Date.now() - 1000)),
      n: u.sessions,
      ...(TRIED ? { ts: triedSet(p.vs), x: Object.keys(triedSet(p.vs)).length } : {}),
    },
  });
}

const sessionsAdded =
  plan.create.reduce((a, u) => a + u.sessions, 0) + plan.raise.reduce((a, u) => a + (u.update.n ? u.sessions - u.had : 0), 0);
console.log(`
  new records to create:    ${plan.create.length}
  records to raise:         ${plan.raise.length}
  already up to date:       ${plan.same.length}
  skipped (no account):     ${plan.noAccount.length}
  sessions that would be credited: ${sessionsAdded}
`);

const top = [...plan.create, ...plan.raise]
  .sort((a, b) => b.sessions - a.sessions)
  .slice(0, 10)
  .map((u) => `  ${String(u.sessions).padStart(5)}  ${u.record?.name ?? u.profile.name ?? nickname(u.uid)}${u.had !== undefined ? `  (record says ${u.had})` : ""}`);
if (top.length) console.log(`Biggest credits:\n${top.join("\n")}\n`);

if (!APPLY) {
  console.log("Nothing was written. Run again with --apply to write these.");
  process.exit(0);
}

// 4. Write, 400 per batch (the limit is 500).
const writes = [
  ...plan.create.map((u) => ({ ref: royalRef(u.uid), run: (b) => b.set(royalRef(u.uid), u.record) })),
  ...plan.raise.map((u) => ({ ref: royalRef(u.uid), run: (b) => b.update(royalRef(u.uid), u.update) })),
];
for (const part of chunk(writes, 400)) {
  const batch = db.batch();
  for (const w of part) w.run(batch);
  await batch.commit();
}
console.log(`Done: ${writes.length} records written.`);
