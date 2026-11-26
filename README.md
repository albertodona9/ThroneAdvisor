# 🚽 ThroneAdvisor

Find a free toilet on campus and rate how nice it is to sit in. Built for DTU Lyngby on top of
[MazeMap](https://www.mazemap.com), hosted on Firebase.

- Toilets show up as bubbles on the indoor map, one set per floor, coloured and labelled with their score.
- Each toilet is rated on **privacy**, **cleanliness** and **comfort** (1–10 sliders); the bubble shows the overall average.
- Each toilet has a usage counter, text reviews, and an optional live status.
- **Nobody has to check in.** Most people will just review afterwards: posting a review can also count as a visit
  ("I used this toilet" checkbox). "I'm going in" / "I'm done" still exists as an optional live status, the groundwork
  for a future live "which toilets are taken" notification.
- No account: users get an anonymous Firebase session on their first write and a made-up nickname ("Regal Plunger").

## Run it locally

Needs Node 20+, Java 11+ (for the Firestore emulator) and the Firebase CLI (`npm i -g firebase-tools`).

```bash
npm install
npm run emulators   # terminal 1: Firestore + Auth emulators (UI at http://127.0.0.1:4000)
npm run seed        # terminal 2: demo ratings, reviews and a few "in use" toilets
npm run dev         # terminal 2: http://localhost:5173 (also reachable from a phone on the same Wi-Fi)
```

In dev mode the app talks to the emulators, never to the real project (`.env.development`).
To point a dev build at the real project instead, put `VITE_USE_EMULATOR=false` and the real values (see `.env.example`) in `.env.development.local`.

```bash
npm run test:rules  # security-rules tests (starts its own emulator; stop `npm run emulators` first)
npm run toilets:fetch  # re-download the toilet list from MazeMap
```

## How it keeps Firestore cheap

Firestore bills per document read, so the whole design is about reading few documents.

| What | Where | Cost |
| --- | --- | --- |
| Toilet locations, names, floors (876 toilets) | Static JSON bundled with the app (`src/data/`) | **0 reads** |
| Every toilet's score sums + visit counter | One document: `campuses/{campus}/meta/stats` | 1 read per refresh |
| Who is in which toilet right now | One document: `campuses/{campus}/meta/live` | 1 read per refresh |
| Reviews | `campuses/{campus}/toilets/{id}/reviews/{uid}` | ≤ 10 reads, only when someone opens that toilet (cached for the session) |

Opening the app costs **2 reads**, regardless of how many toilets exist. While the tab is visible it
re-reads `live` every 2 min and `stats` every 5 min (see `src/config.js`; `live` is polled slowly because few people check in
for now); hidden tabs don't poll. A user checking one toilet's reviews adds ≤ 10 reads. A busy day with 1,000 sessions of
~10 minutes each is roughly 1,000 × (2 + 5 + 2 + 10) ≈ 19k reads, inside the 50k/day free tier.
There are no real-time listeners on purpose: a listener is billed one read per change per connected client.

Scores are stored as **sums** (`n` reviews, `p`/`c`/`k` sums, `v` visits), so they can be updated with
atomic increments and validated by the security rules. Review lists are capped at 25 documents per query by the rules.

### No Cloud Functions

Aggregates are updated by the client in the same batch as the review, and
[`firestore.rules`](firestore.rules) verifies every aggregate change against the review / check-in that
comes with it. Nobody can write an arbitrary score or visit count. This is covered by `tests/rules.test.js`.
The "in use" state expires by itself (10 min) so a forgotten check-in never blocks a toilet.

### Known limits

- Anonymous sessions are free to create, so a determined person can still stuff the ballot with many accounts.
  Turn on **Firebase App Check** before the public launch.
- `stats` and `live` are single documents: Firestore sustains about 1 write/second per document, and a document is limited
  to 1 MiB (≈ 10,000 toilets). Both are fine for a campus; shard by building if a campus ever outgrows that.
- Reviews can be edited but not deleted yet (deleting would need the aggregate to be decremented, which the rules don't allow yet).

## Credentials and safety

- **Nothing in this repo is a secret.** The Firebase web config (API key, app id, ...) is read from environment variables:
  `.env.development` has fake values for the emulator and is committed; the real ones go in `.env.production.local`
  (git-ignored, template in `.env.example`). The web API key is not confidential (it ships in the JavaScript every visitor
  downloads), so access control is done by `firestore.rules`, plus the two console settings below.
- Your Firebase CLI login lives in your user profile, never in the project. There are no service-account keys here; never add any
  (nothing in this app needs them).
- **Restrict the API key** (Google Cloud console -> APIs & Services -> Credentials -> the "Browser key" Firebase created):
  *Application restrictions* -> Websites -> `https://throneadvisor-0.web.app/*` and `https://throneadvisor-0.firebaseapp.com/*`.
- **Turn on App Check** (Firebase console -> App Check -> register the web app with reCAPTCHA, then enforce it for Firestore and
  Authentication) so only your real site can talk to the project, not scripts that copied the config.

## Deploying

The Firebase project is `throneadvisor-0` (`.firebaserc`), on the free Spark plan: stay inside the free quota
(50k reads / 20k writes per day) and nothing is billed. Its `(default)` Firestore database (europe-north2) is in use;
the old prototype's `toilets` / `toilets_geo` collections were deleted.

Status: **live at https://throneadvisor-0.web.app** (Hosting + Firestore rules/indexes deployed, Anonymous sign-in enabled).
The deployed rules and the app's write paths were smoke-tested against the real project.

To publish a new version: `npm run deploy` (builds, then deploys hosting + Firestore).

To redeploy only the rules: `firebase deploy --only firestore`. The `stats` and `live` documents are created by the first
write; no seeding is needed (never run `npm run seed` against production, it only targets the emulator).

## Project layout

```
src/
  main.js      app shell: wires map, list, detail sheet, geolocation
  map.js       MazeMap: bubbles (GeoJSON layers per floor), blue dot, camera
  api.js       every Firestore read/write (shared with the rules tests)
  actions.js   user actions: check in/out, review; optimistic local updates
  store.js     tiny reactive state; sync.js: polling; scoring.js: score maths
  layout.js    nudges overlapping toilet bubbles apart (display only)
  list.js, detail.js, dom.js, style.css
  data/        generated toilet registry (npm run toilets:fetch)
scripts/       fetch-toilets.mjs (MazeMap -> JSON), seed-emulator.mjs
tests/         security-rules tests
firestore.rules  firebase.json  firestore.indexes.json
_legacy/       the previous prototype, safe to delete
```

## License

[MIT](LICENSE). Toilet and map data come from [MazeMap](https://www.mazemap.com) and are subject to its terms.
