# 🚽 ThroneAdvisor

_Link: https://throneadvisor-0.web.app/_

_TODO_

[X] Add possibility to install webapp
[X] Add info page with credits for developers
[X] Make kings/queens tab with users stats
[X] Make app a bit "less nice" with poops ratings based on the overalls (stinky, medium, excellent etc.), add colors and decorations
[X] trophies for reviewers, add weekly leaderboards and yearly throne kings and queens
[X] Add the thropies room for each user with all time streak number and with badges for the weekly all time
I am thinking of something like every season gets its own badge (based on crops or something like that) and the frame is either gold, silver or bronze based on the position.
[X] login options and cache storing on the phone so no need to login each time
[ ] Personal Heat (Kingdom) Map of campus
[X] Ironic message like "congrats on your throning" when registering a throne session, with some confetti and trumpets sounds and drapes
[ ] battles of the families, each player can play alone or join a family, and start conquering campus by being the last one to have pooped in a bathroom

Find a free toilet on campus and rate how nice it is to sit in. Built for DTU Lyngby on top of
[MazeMap](https://www.mazemap.com), hosted on Firebase.

- Toilets show up as bubbles on the indoor map, one set per floor, coloured and labelled with their score.
- Each toilet is rated on **privacy**, **cleanliness** and **comfort** (1–10 sliders); the bubble shows the overall average.
- Each toilet has a usage counter, text reviews, and an optional live status.
- **Nobody has to check in.** Most people will just review afterwards: posting a review can also count as a visit
  ("I used this toilet" checkbox). "I'm going in" / "I'm done" still exists as an optional live status, the groundwork
  for a future live "which toilets are taken" notification.
- **Accounts that survive a lost phone.** Everyone starts anonymous (an anonymous Firebase session on their first write, plus a
  made-up nickname like "Regal Plunger"). After their first review they are offered to **save their account with Google**, which
  links the Google login to that same user: the uid, and so every review already written, stays theirs and follows them to a new
  phone. Reviews show the username (a generated nickname unless they chose one), never the Google name or email.
- **Profiles.** The top-right button opens the account window, where "Personalize profile" sets a username and an avatar. The **Me** tab in
  the bottom sheet shows your numbers (reviews, visits, toilets, average score) and every review you wrote.
  Choose from 16 Magnific-illustrated fictional kings and queens with varied skin tones and European-, African-, East Asian- and
  Aztec-inspired regalia. Portraits are independent of your leaderboard title. Pick a **Pearl**, **Jade**, **Amethyst** or **Rose** frame,
  or leave the portrait unframed. Your saved frame appears on your account, My court and reviews; leaderboard podiums temporarily
  replace it with **gold**, **silver** or **bronze** for places 1–3, without changing your choice.
- **"I just throned" 🚽.** The round button at the bottom right logs a quick visit: pick the toilet you used (closest first, or search),
  confirm, and it adds one to that toilet's usage counter and to your profile. At most **3 a day** per user; the badge shows how many are left.
- **Hear ye, hear ye!** Successful sessions get a humorous royal congratulations pop-up with side trumpets and a shower of gold stars
  and parchment confetti. A review that counts a visit celebrates both; review-only submissions and amendments celebrate the decree
  instead, without claiming another visit. Following a quick log with "Pass your verdict" does not count that sitting twice.
  Reduced-motion settings disable the animated confetti and trumpet entrance.
- **Court musicians.** The supplied `medieval_background.mp3` loops quietly after the first tap or key press (browsers block unsolicited
  audio). `tadaa.mp3` plays once per celebration. The **♪ On/Off** button mutes both and remembers your choice on this browser.
  Music pauses when the tab is hidden and resumes when you return; interrupted fanfares are not replayed.
  Both tracks are bundled locally, with no external music service.
- **Credits.** Tapping the ThroneAdvisor logo opens a pop-up with who made it and a link to this repository.
- **Rating tiers.** A toilet's overall score decides its tier, which has a name and a picture shown in every list and in the detail view:
  up to 2.0 **Peasant's Pot** · 2.1-4.0 **Commoner's Loo** · 4.1-6.0 **Noble's Rest** · 6.1-8.0 **Highness's Throne** · 8.1-10 **The King's Loo**.
  The tier follows the score as displayed (one decimal), and the map bubbles use the tier's colour. Toilets nobody has rated yet have no tier
  and show a grey "–". The ranges, names, colours and pictures all live in `src/tiers.js`.
- **Likes.** Every review has a heart with a small counter. One like per person per review (you can't like your own), and you can take it back.
- **Royals 👑.** A tab with two stacked sections, **This week** (starts over every Monday) and **All time**, each with a **top 3** in two categories:
  🧻 **The Royal Flush** (the royals who expel the most: most throning sessions, i.e. counted visits: a quick log, a check-out, or a new review
  with "I used this toilet") and 🗺️ **Throne Hoppers** (the royals who explore the most: most _different_ toilets used). Ties: in the weekly
  boards the **oldest** royal wins, in the all-time boards the **youngest**, so nobody stays on top forever. Below each section your own
  numbers are shown. In "Personalize profile" you choose to be a **King** or a **Queen** (or stay a plain "Royal"). Each royal also has a
  **birth date**: the day their account was created, shown in the account window and on the Me tab (it is also what breaks ties).
  Tap anyone on a podium to open their **royal profile** window, laid out like My court: portrait, name, title, birth date, short
  description, student number (only if they published it), and their sessions and thrones this week and all time.
  In "Personalize profile" you can add a short one-line **description** (up to 80 characters), a **student number**
  (4-12 letters or digits) and a **class** year, shown as a "Class of 27" badge in a column at the right of the profile header.
  All show on your own My court (the student number appears right after your name). The description and class are public; the student
  number is private unless you tick "Show it on my public profile".
- **Swipe the bottom sheet.** Drag the list up to expand it and down to collapse it (it follows your finger and snaps; a quick flick decides the
  direction). It never fights with scrolling the list. Tapping the handle still works.
- **Underline tabs.** The sheet's sections are serif labels resting on a thin gold rule; the selected one is burgundy with a
  burgundy-and-gold underline. On narrow screens the tabs scroll horizontally.

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

| What                                                   | Where                                                         | Cost                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Toilet locations, names, floors (876 toilets)          | Static JSON bundled with the app (`src/data/`)                | **0 reads**                                                                        |
| Every toilet's score sums + visit counter              | One document: `campuses/{campus}/meta/stats`                  | 1 read per refresh                                                                 |
| Who is in which toilet right now                       | One document: `campuses/{campus}/meta/live`                   | 1 read per refresh                                                                 |
| Reviews                                                | `campuses/{campus}/toilets/{id}/reviews/{uid}`                | ≤ 10 reads, only when someone opens that toilet (cached for the session)           |
| A user's profile: name, avatar, own reviews and visits | `users/{uid}` (private to its owner)                          | 1 read per session, only for users who have an account/session                     |
| Royals boards (4 top-3 lists: weekly and all-time)     | `campuses/{campus}/royals/{uid}`, `weeks/{week}/royals/{uid}` | 12 reads (+2 for your own two entries), only when the tab is opened, cached 20 min |
| A royal's profile window (tap a podium avatar)         | the same two documents for that one user                      | 2 reads, only on tap, cached 5 min per user                                        |
| Trophy room (streaks, season medals, verdict trophies) | fields on the royal record, plus `days/{day}`, `podiums/{week}` | once a day per phone, see **Trophies** below                                       |

Opening the app costs **2 reads** (**3** for a returning user, whose profile is loaded too), regardless of how many toilets exist. While the tab is visible it
re-reads `live` every 2 min and `stats` every 5 min (see `src/config.js`; `live` is polled slowly because few people check in
for now); hidden tabs don't poll. A user checking one toilet's reviews adds ≤ 10 reads. A busy day with 1,000 sessions of
~10 minutes each is roughly 1,000 × (3 + 5 + 2 + 10) ≈ 20k reads, inside the 50k/day free tier.
There are no real-time listeners on purpose: a listener is billed one read per change per connected client.

**Profiles.** `users/{uid}` holds the chosen username and avatar plus the user's own history (`rv`: the scores they gave per toilet,
`vs`: their visits per toilet), which is what the "Me" tab shows without reading any other document. It is written in the same batch
as the review or visit it records. Only the username and avatar are ever public, and only by being copied onto the user's review
documents (`by`, `em`), so other people's names on a toilet's reviews cost no extra reads. The rules constrain both (3-20
letters/digits/spaces/`_.-`, 16 allowed avatars and 4 optional frames). The existing `emoji` / `em` values now identify illustrated
portraits, so old selections remain valid without a migration. The optional `frame` on a profile is copied as `fr` onto reviews.
The two Magnific sprite sheets are bundled from `src/assets/`, with no runtime image-service requests.
The optional `bio` (one line, ≤ 80 characters), `cy` class year (2000-2099) and `sn` student number (4-12 letters/digits) live in the private profile too; `snPub`
says whether the number may be public. The royal record (`campuses/{campus}/royals/{uid}`) carries a copy of `bio`, `cy` and, only with `snPub`,
of `sn`, written in the batches that already write the profile or count a session, so they cost no extra writes.
Renaming or changing a portrait/frame rewrites the user's own reviews in one batch; the rules allow that
without touching scores or stats. Reviews written before profiles existed aren't in `rv`, so they don't appear in "Me" until the
review is edited.

**Likes.** A like is a tiny document `campuses/{campus}/toilets/{id}/reviews/{author}/likes/{liker}`, and the review carries a counter `lk` that is
shown for free with the reviews. The rules only let `lk` move by +1 together with the creation of the liker's own like document in the same batch
(and by -1 with its deletion), so a second like is impossible (it would be a write to an existing document) and a count can't be set. Your profile
keeps a mirror of what you liked (`lk`), so hearts are filled in without any extra reads. A like costs 3 writes (like, counter, your profile).

**Royals.** The boards need public data, and profiles are private, so each king or queen has one small public record,
`campuses/{campus}/royals/{uid}` = `{name, emoji?, title?, born, n, ts?, x?}`: `n` is the number of throning sessions, `ts` the set of toilets they have
used (`{toiletId: true}`) and `x` its size. It is written in the same batch as every counted visit, and the rules accept `n` +1 **only** if that batch also
counted exactly one visit in the campus stats, and `x` +1 **only** if `ts` gains exactly the toilet of that visit (once; nothing can be removed), so neither
number can be set to a figure of your choosing. The birth date can't change afterwards and comes from the Firebase account's creation time.
A record holds at most 1,000 toilets. Limits, so nobody is surprised: records start counting from the day this shipped (earlier visits are in your Me tab
but not on the boards; see the backfill script below); a new account can be made for free, so the boards are best-effort fair, not tamper-proof (App Check
keeps scripts out); counted visits can also come from check-in/out (at least 20 s apart) which has no daily cap yet; and editing a review no longer adds
a visit (only a new review can). "Tried" means any logged session at that toilet, not only reviewed ones.

**Weekly royals.** The same record per week, `campuses/{campus}/weeks/{week}/royals/{uid}` = `{name, emoji?, title?, born, n, ts?, x?}`, written in the same
batch as the all-time one (so one more write per counted visit, and no extra reads). The weekly `born` must equal the all-time one (the rules check it),
because it breaks the weekly ties too. `{week}` is `weekNumber()` (whole weeks since Monday 1970-01-05, shifted like the daily limit so a week starts at
about Monday midnight in Denmark; `src/profile.js`, mirrored in `firestore.rules`). The rules compute the current week from the server time and refuse
writes to any other, so **nothing has to be reset**: a new week is simply a new, empty collection, and finished weeks are frozen. Limit: a phone whose
clock is more than a few seconds off around the Sunday-night boundary (or days off) computes the wrong week, and the rules then refuse the whole counted visit.

**Reading the boards.** Each board is one query (`orderBy(n or x, desc)`, then `orderBy(born)`, `limit(3)`), so the database does the ranking and the
tie-break: weekly boards sort `born` ascending (oldest first), all-time boards descending (youngest first). That is four queries of 3 reads = 12 reads
(`fetchBoards` in `src/api.js`, cached 20 minutes by `src/royals.js`; your own visits refresh it), plus 2 reads for your own two entries when you
aren't on a podium. These queries need **four composite indexes** (`royals`, collection-group, fields `n`/`x` descending + `born` ascending/descending),
declared in `firestore.indexes.json`; `npm run deploy` creates them, and the tab shows an error until they have finished building in production
(the emulator doesn't need them).

**Trophies.** Each royal record also carries a trophy shelf, shown on "My court" and on the public royal profile (no extra reads: it is the same
document). There is no server, so the owner's own phone keeps it up to date, at most once a day (a note in `localStorage`), from public data. Code: `src/trophies.js`
(the logic, tested), `src/trophy-check.js` (the daily check), `src/trophy-shelf.js` (the shelves, with the art drawn as small SVGs; swap the three draw functions for
painted images when there are some).
- **Verdict trophies** (`lt` = 10 / 50 / 100): the best like count among your own reviews. The check reads your reviews (one read per reviewed toilet) and stops for good once
  you have the top one. A milestone is awarded at the next daily check, not the moment of the like, and likes taken back before it are missed.
- **Streaks** (`st` = {s, e, d}: days in a row on the all-time sessions / explorers podium, and the last day counted). `campuses/{campus}/days/{yyyymmdd}` = `{d, s: [uid], e: [uid]}`
  is the "has today been checked yet" flag: the first phone with a royal record that opens the app on a new day reads the two all-time boards (6 reads) and creates it. The rules
  only accept a create for today, so a second phone's create is refused and it just reads the snapshot instead. Everyone then moves their own streak from the snapshots newer
  than their last counted day: in the list = +1, not in it = back to 0. A day nobody opened the app has no snapshot and just pauses the streak. A newcomer starts from today.
  Streaks are public like the rest of the record, and so are the snapshots, so anyone can recompute them. About 6 reads a day for the whole campus plus one query per user.
- **Season medals** (`wq` = {"2026Q4": {s1: 2, e3: 1}}, `wl` = last week counted): a gold / silver / bronze medal for each finished week you stood on a weekly podium, grouped by
  quarter (the one the week's Monday falls in) and shown as one medal per week won (no multiplier). `campuses/{campus}/podiums/{week}` = `{w, s, e}` is the frozen podium of a finished
  week, created once by the first phone that needs it (6 reads, only for weeks before the running one; a finished week can't change, so the result is exact even if it is made
  late). A phone catches up on the weeks since `wl` (at most 60), starting no earlier than `ROYALS_FIRST_WEEK` in `src/config.js`. About 6 reads per finished week for the whole campus, plus one query per user per week.
- **Trust.** The rules only check the *shape* of the shelf (valid tiers, non-negative numbers, one board per snapshot, at most three names) and that only the owner writes it, plus that
  snapshots are created once and for the right day / a finished week. They cannot check that the numbers are true, so someone with a modified app could write any shelf. That is
  accepted here (like App Check, it is a campus app); `n`, `x` and the boards themselves stay protected as before. A user without a royal record (no counted visit yet) has no shelf.
- The earlier comment frames in the review list (10 / 25 / 50 likes) are separate from the 10 / 50 / 100 verdict trophies.

**Quick logs and the daily limit.** A quick log is one batch of two writes (the toilet's counter in `stats`, plus your profile), so it costs
nothing beyond a normal review. The limit of 3 a day is kept in your own profile as `q: {d: day, n: used}` and **enforced by the security
rules**, not just by the phone: a counter increment is only accepted if the same batch also raises `q.n` by exactly one for today, `q.n`
can't go above 3, and `q` can't be lowered or reset (including by deleting the profile). This adds only a couple of tiny rule lookups per log,
at most 3 a day per user. The phone also shows how many are left (and falls back to the server's answer if another phone used some).
A "day" rolls over at about midnight in Denmark (UTC shifted by one hour, in `dayNumber()` in `firestore.rules` and `src/profile.js`).
Limits: anonymous accounts are free, so someone creating many accounts gets 3 a day each; App Check is what keeps scripts out.

**A copy on the phone saves reads.** The last `stats`, `live` and profile documents are kept in `localStorage` (`src/cache.js`).
Opening the app while the copy is younger than its limit reuses it and reads **nothing**: scores 5 min, live status 90 s, profile
6 h (`STATS_MAX_AGE_MS` etc. in `src/config.js`; higher means fewer reads but older numbers). The periodic polls while the tab is open
still fetch. A user's own writes drop the affected copy so they never see their change missing, and a rename re-reads the profile
first. Offline (or if a read fails) the last copy is shown however old it is, with the "offline" chip. This works in any browser tab;
installing the app just makes the phone keep it longer, because Safari erases storage of ordinary sites after about a week without a
visit. The saving depends on how often people reopen the app within those windows, so treat it as "up to 2-3 reads per open".

## Installing the app (PWA)

The app is installable: `public/manifest.webmanifest`, the icons, and a small service worker (`public/sw.js`, registered in
production only). The service worker serves the app itself (HTML, JS, CSS, icons) from the phone, which opens it instantly and offline
and spares hosting bandwidth; it never touches Firestore, Auth, App Check or MazeMap, and it leaves Firebase Hosting's `/__/` URLs
(Google sign-in) alone. An "Install app" chip appears next to the logo where the browser allows it (Android / desktop Chrome and
Edge); on iPhone it opens the "Share -> Add to Home Screen" steps. The chip can be dismissed and returns after two weeks.
The MazeMap map itself still needs a connection. The app icons (`public/android-chrome-*.png`, `apple-touch-icon.png`, `favicon*`) come
from the project's artwork; the **maskable** icon (`public/maskable-512x512.png`, which launchers crop to a circle or squircle) is
generated from it: it measures the artwork, scales it into the 80% safe zone on a white background and writes the file
(`npm i --no-save playwright-core && node scripts/make-maskable.mjs`). Re-run it if the 512px icon changes.

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
- Firestore also allows at most 40,000 index entries per document, and map fields are indexed by default. Each toilet that has been reviewed or
  visited adds about 6 fields to `stats` (twice that in index entries, ascending and descending), so `stats` may hit that limit at roughly
  3,000 active toilets, before the 1 MiB one. This is an estimate and hasn't been tested. A single-field index exemption on `meta/stats`
  and `meta/live` (in `firestore.indexes.json`) should lift it; sharding by area (e.g. geohash cells) avoids it for good.
- **No Cloud Functions on purpose.** They need the pay-as-you-go **Blaze** plan (a card on file, and no hard spending cap: a budget alert only
  emails). Anything that "has to run on a schedule" is designed away instead: the weekly leaderboard resets by switching to a new `weeks/{week}`
  collection, and the all-time board is kept up by the client under the rules. What this can't do is anything that needs trusted server
  code, such as crowning a winner, sending notifications or moderating user-added toilets. If you need that, either move to Blaze with a budget
  alert, or run a scheduled GitHub Actions job with the Admin SDK (free for public repos; use keyless Workload Identity Federation, never a key in the repo).
- Going city-wide: the single `stats` / `live` documents would hit the write-rate and size limits, so they would have to be split by area
  (e.g. geohash cells, loading only the cells in view, which is a few reads instead of two). User-added toilets would also need moderation,
  which these rules alone can't do (an "unconfirmed until a second user confirms it" state and a report button are the usual first steps).
- Reviews can be edited but not deleted yet (deleting would need the aggregate to be decremented, which the rules don't allow yet).

## Accounts

Why not just rely on the phone? The anonymous session lives in browser storage, which Safari erases after about a week without a
visit and which is lost with a cleared browser or a new phone. Linking Google fixes that at no cost (Firebase Auth is free at this
scale). Code: `src/account.js` (auth logic), `src/account-ui.js` (button, account window, personalization) and `src/profile.js`
(username rules, avatars, the numbers on the Me tab).

**One-time setup:** Firebase console -> Authentication -> Sign-in method -> **Google -> Enable** (pick a support email).
`throneadvisor-0.web.app` and `throneadvisor-0.firebaseapp.com` are authorised sign-in domains by default; add your own domain under
Authentication -> Settings if you use one. Locally the Auth emulator provides a fake Google popup, so it works without any setup.

Not built yet: Microsoft sign-in (DTU students have Microsoft accounts; needs an Azure app registration), a public profile page (a user's
own numbers are private; only the name, avatar, title and session counts on the royals boards are public), and moderation
of usernames (they are validated for format only, not for content).

## Credentials and safety

- **Nothing in this repo is a secret.** The Firebase web config (API key, app id, ...) is read from environment variables:
  `.env.development` has fake values for the emulator and is committed; the real ones go in `.env.production.local`
  (git-ignored, template in `.env.example`). The web API key is not confidential (it ships in the JavaScript every visitor
  downloads), so access control is done by `firestore.rules`, plus the two console settings below.
- Your Firebase CLI login lives in your user profile, never in the project. There are no service-account keys here; never add any
  (nothing in this app needs them).
- **Restrict the API key** (Google Cloud console -> APIs & Services -> Credentials -> the "Browser key" Firebase created):
  _Application restrictions_ -> Websites -> `https://throneadvisor-0.web.app/*` and `https://throneadvisor-0.firebaseapp.com/*`.
- **App Check** (Firebase console -> App Check -> register the web app with reCAPTCHA, then enforce it for Firestore and
  Authentication) means only your real site can talk to the project, not scripts that copied the config. The app side is in
  `src/firebase.js`: put the public reCAPTCHA _site_ key in `VITE_APPCHECK_SITE_KEY` (and `VITE_APPCHECK_PROVIDER=enterprise` if you
  registered reCAPTCHA Enterprise) in `.env.production.local`. **Don't enforce App Check before a build with the key is deployed:**
  enforced requests without a token are rejected and the site shows nothing. For `npm run dev` against a real project, register the
  debug token the SDK prints in the console (Apps -> Manage debug tokens). The emulators skip App Check.

## Deploying

The Firebase project is `throneadvisor-0` (`.firebaserc`), on the free Spark plan: stay inside the free quota
(50k reads / 20k writes per day) and nothing is billed. Its `(default)` Firestore database (europe-north2) is in use;
the old prototype's `toilets` / `toilets_geo` collections were deleted.

Status: **live at https://throneadvisor-0.web.app** (Hosting + Firestore rules/indexes deployed, Anonymous sign-in enabled).
The deployed rules and the app's write paths were smoke-tested against the real project.

To publish a new version: `npm run deploy` (builds, then deploys hosting + Firestore).

To redeploy only the rules: `firebase deploy --only firestore`. The `stats` and `live` documents are created by the first
write; no seeding is needed (never run `npm run seed` against production, it only targets the emulator).

### Crediting visits from before the leaderboards (one-off)

Reviews, scores and profiles need no migration: their structure didn't change (`lk` on a review and `title` on a profile are optional). The
leaderboards simply start empty, because the rules only let a record's `n` grow by one together with a counted visit, so the app can't credit
old ones. `scripts/backfill-royals.mjs` does it once with the Admin SDK (which bypasses the rules), trusting each user's own visit history (`vs` in
`users/{uid}`). It fills the **all-time** board only (past visits have no dates, so the weekly board can't be backfilled).

```bash
npm i --no-save firebase-admin
gcloud auth application-default login      # your own login; never put a service-account key in the repo
node scripts/backfill-royals.mjs --project throneadvisor-0            # DRY RUN: prints what it would do, writes nothing
node scripts/backfill-royals.mjs --project throneadvisor-0 --apply    # write it
```

- For everyone with visits it **sets** `royals/{uid}.n` to the total of their `vs`: it creates the record if there is none (name, avatar and title from the
  profile, falling back to the generated nickname; birth date = the account's creation date), raises a lower `n`, and leaves a record that is already
  high enough alone. Accounts that no longer exist are skipped. It sets rather than adds, so it is safe to run again (a second run changes nothing).
- It also fills the record's set of toilets tried (`ts`, and its size `x`) from the toilets in `vs`. Without that, the next visit to a toilet the user
  used before the backfill is **refused by the rules** (checked in the emulator): the record would claim the toilet is new while their history says it
  isn't. Pass `--no-tried` only if you know you don't want it.
- Deploy the new rules and app **first**, then backfill: visits made on the old app between the backfill and the deploy would otherwise be missed (they
  are in `vs`, but not on the board), while a backfill after the deploy picks up everything in `vs`. It reads every
  `users` document once (one read per user) and writes one record per user, so it is a small, one-time cost on the free plan. Run it when the app is quiet: a
  visit counted between its read and its write would be missed (running it again catches up).
- Not covered: users who visited before profiles kept a `vs` history have nothing to read, and `vs` is each user's own bookkeeping, not verified by
  the rules, so this is a one-time goodwill import.

## Project layout

```
src/
  main.js      app shell: wires map, list, detail sheet, geolocation
  map.js       MazeMap: bubbles (GeoJSON layers per floor), blue dot, camera
  api.js       every Firestore read/write (shared with the rules tests)
  actions.js   user actions: check in/out, review; optimistic local updates
  store.js     tiny reactive state; sync.js: polling; scoring.js: score maths
  layout.js    nudges overlapping toilet bubbles apart (display only)
  account.js, account-ui.js, profile.js   Google linking, account window + personalization, profile maths
  cache.js, install.js   phone copy of documents (saves reads); "Install app" chip
  credits.js, quick-ui.js   the credits pop-up; the 🚽 "I just throned" button and picker
  tiers.js, tiers-ui.js   the five rating tiers (ranges, names, colours, pictures) and the badge shown in rows
  trophies.js, trophy-check.js, trophy-shelf.js   the trophy room: logic, the daily check against Firestore, and the shelves
  sheet-swipe.js   swipe gestures for the bottom sheet
  royals.js   loads the four Royals boards and keeps your own entries (cached on the phone)
  list.js (Near you / Top rated / Me), detail.js, dom.js, style.css
  data/        generated toilet registry (npm run toilets:fetch)
scripts/       fetch-toilets.mjs (MazeMap -> JSON), seed-emulator.mjs, backfill-royals.mjs (one-off), make-maskable.mjs, make-level-icons.mjs
art/levels/    source artwork of the five tiers (large transparent PNGs, not shipped)
src/assets/levels/  the shipped tier icons: trimmed, square, 256px WebP (~15 KB each), made by `make-level-icons.mjs`
public/         manifest, icons, service worker (copied as-is into the build)
tests/         security-rules tests, layout and profile unit tests
firestore.rules  firebase.json  firestore.indexes.json
_legacy/       the previous prototype, safe to delete
```

## License

[MIT](LICENSE). Toilet and map data come from [MazeMap](https://www.mazemap.com) and are subject to its terms.
