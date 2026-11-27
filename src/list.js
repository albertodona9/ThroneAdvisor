// Bottom list: closest thrones, top-rated thrones, and "Me" (your profile stats and reviews).
// Computed locally from the toilet registry, the stats document and your profile, so
// browsing it costs no extra reads.
import { loadProfile } from "./actions.js";
import { avatarBadge } from "./avatars.js";
import flushArt from "./assets/board-flush.svg";
import hoppersArt from "./assets/board-hoppers.svg";
import { currentWeekEntry, loadBoards, myRoyalState } from "./royals.js";
import { classBadge, openRoyalProfile } from "./royal-profile.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren } from "./dom.js";
import { distanceMeters, formatDistance, inBounds, timeAgo } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { trophyRoom } from "./trophy-shelf.js";
import { BOARDS, displayName, formatBorn, myReviewList, profileStats, titleIcon, titleLabel } from "./profile.js";
import { overallScore, rankScore } from "./scoring.js";
import { tierBadge, tierTag } from "./tiers-ui.js";
import { occupancy, state } from "./store.js";

const FLOOR_PENALTY_M = 12; // one floor away counts as 12 m extra when ranking "nearby"
const ROWS = 8;

let tab = "nearby";

function originPoint() {
  return state.position && inBounds(state.position, CAMPUS.bounds) ? state.position : null;
}

function nearby() {
  const origin = originPoint() ?? CAMPUS.center;
  return state.toilets
    .map((t) => {
      const meters = distanceMeters(origin, t);
      return { t, meters, key: meters + Math.abs(t.z - state.z) * FLOOR_PENALTY_M };
    })
    .sort((a, b) => a.key - b.key)
    .slice(0, ROWS);
}

function top() {
  const origin = originPoint();
  return state.toilets
    .map((t) => ({ t, rank: rankScore(state.stats[t.id]), meters: origin ? distanceMeters(origin, t) : null }))
    .filter((r) => r.rank != null)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, ROWS);
}

function row({ t, meters }, onPick) {
  const e = state.stats[t.id];
  const score = overallScore(e);
  const occ = occupancy(t.id);
  return h(
    "button",
    { class: "row", type: "button", onclick: () => onPick(t) },
    tierBadge(score),
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-title" }, toiletTitle(t), tierTag(score)),
      h(
        "span",
        { class: "row-sub" },
        toiletPlace(t),
        meters != null ? ` · ${formatDistance(meters)}` : "",
        e?.n ? ` · ${e.n} review${e.n === 1 ? "" : "s"}` : " · awaiting a verdict",
      ),
    ),
    occ ? h("span", { class: "dot busy", title: "Occupied" }) : null,
  );
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("strong", null, value), h("span", null, label));
}

/** Profile header, numbers and the user's own reviews. */
function meView(onPick) {
  const profile = state.profile;
  if (!state.uid) {
    return h("p", { class: "empty" }, "Rate a throne and your court begins here: your verdicts, your audiences and your favourite thrones 👑");
  }
  if (!profile) return h("p", { class: "empty" }, "Summoning your court…");

  const stats = profileStats(profile);
  const reviews = myReviewList(profile).filter((r) => state.byId.has(r.id));
  return [
    h(
      "div",
      { class: "me-head" },
      avatarBadge(profile, { size: "big" }),
      h(
        "div",
        { class: "me-name" },
        h(
          "strong",
          null,
          displayName(state.uid, profile.name),
          profile.sn ? h("span", { class: "sn", title: profile.snPub ? "Public" : "Only you see this" }, ` · ${profile.sn}`) : null,
        ),
        h("span", { class: "muted" }, `${titleIcon(profile.title)} ${titleLabel(profile.title)}${state.account?.createdMs ? ` · born ${formatBorn(state.account.createdMs)}` : ""}`),
      ),
      classBadge(profile.cy),
    ),
    profile.bio ? h("p", { class: "bio" }, profile.bio) : null,
    h(
      "div",
      { class: "stats" },
      stat(stats.reviews, "verdicts"),
      stat(stats.visits, "audiences"),
      stat(stats.toilets, "thrones"),
      stat(stats.avgGiven == null ? "–" : stats.avgGiven.toFixed(1), "avg verdict"),
    ),
    h("h3", { class: "list-title rule" }, "Your trophy room"),
    trophyRoom(state.myRoyal?.all, { own: true }),
    reviews.length
      ? [
          h("h3", { class: "list-title rule" }, "Your verdicts"),
          reviews.map((r) => {
            const t = state.byId.get(r.id);
            const visits = Number(profile.vs?.[r.id] ?? 0);
            return h(
              "button",
              { class: "row", type: "button", onclick: () => onPick(t) },
              tierBadge(r.score),
              h(
                "span",
                { class: "row-main" },
                h("span", { class: "row-title" }, toiletTitle(t), tierTag(r.score)),
                h(
                  "span",
                  { class: "row-sub" },
                  toiletPlace(t),
                  r.at ? ` · ${timeAgo(r.at)}` : "",
                  visits ? ` · ${visits} audience${visits === 1 ? "" : "s"}` : "",
                ),
              ),
            );
          }),
        ]
      : h("p", { class: "empty" }, "You haven't passed a verdict yet. Choose a throne on the map and rate it 🧻"),
  ];
}

let royalsError = false;

const BOARD_ART = { sessions: flushArt, explorers: hoppersArt };

/** One podium place: the framed avatar with its count on the corner, and the name underneath. Tap it for the profile. */
function royalPlace(r, rank, mine, board) {
  const value = r[board.field];
  return h(
    "button",
    {
      class: `podium-place place-${rank}${mine ? " mine" : ""}`,
      type: "button",
      title: `${value} ${value === 1 ? board.unit[0] : board.unit[1]}`,
      "aria-label": `${r.name}, ${value} ${value === 1 ? board.unit[0] : board.unit[1]}. Open profile`,
      onclick: () => openRoyalProfile(r, rank),
    },
    h("span", { class: "podium-avatar" }, avatarBadge(r, { size: "podium", rank }), h("span", { class: "podium-n" }, String(value))),
    h("span", { class: "podium-name" }, r.name, mine ? " (you)" : ""),
  );
}

/** One board: its name and art, and the top three standing as a podium (silver, gold, bronze), or an invitation when nobody has any yet. */
function boardCard(board, list, kind) {
  const places = list.slice(0, 3).map((r, i) => royalPlace(r, i + 1, r.uid === state.uid, board));
  return h(
    "section",
    { class: "board" },
    h(
      "h4",
      { class: "board-title" },
      h("img", { class: "board-art", src: BOARD_ART[kind], alt: "", width: 40, height: 40 }),
      h("span", null, board.title, h("small", null, board.caption)),
    ),
    places.length
      ? h("div", { class: "podium" }, [places[1], places[0], places[2]])
      : h("p", { class: "board-empty" }, "Nobody has claimed this crown yet 👑"),
  );
}

/** "You: 4 sessions · 3 thrones": where the signed-in user stands in this period, even outside the top three. */
function youLine(entry, period) {
  if (!state.uid) return null;
  const [s1, sN] = BOARDS.sessions.unit;
  const [t1, tN] = BOARDS.explorers.unit;
  return h(
    "p",
    { class: "you-line" },
    entry
      ? `You ${period}: ${entry.n} ${entry.n === 1 ? s1 : sN} · ${entry.x ?? 0} ${(entry.x ?? 0) === 1 ? t1 : tN}`
      : `You haven't held court ${period} yet. The 🚽 button is right there.`,
  );
}

/** A festive announcement: the title set on a gentle arc, higher in the middle. */
function periodTitle(text) {
  const id = `arc-${text.replace(/\W+/g, "-").toLowerCase()}`;
  const title = h("h3", { class: "period-title", "aria-label": text });
  title.innerHTML =
    `<svg viewBox="0 0 320 48" aria-hidden="true"><defs><path id="${id}" d="M12 42 Q160 14 308 42"/></defs>` +
    `<text><textPath href="#${id}" startOffset="50%" text-anchor="middle">${text}</textPath></text></svg>`;
  return title;
}

/** The Royals tab: this week's two podiums, then the all-time ones. */
function royalsView() {
  const b = state.boards;
  if (!b) return h("p", { class: "empty" }, royalsError ? "The court is out of reach. Check your connection." : "Summoning the court…");
  const mine = state.myRoyal;
  return [
    h(
      "section",
      { class: "period" },
      periodTitle("Court of the Week"),
      boardCard(BOARDS.sessions, b.weekSessions, "sessions"),
      boardCard(BOARDS.explorers, b.weekExplorers, "explorers"),
      youLine(currentWeekEntry(mine), "this week"),
    ),
    h(
      "section",
      { class: "period" },
      periodTitle("Hall of Legends"),
      boardCard(BOARDS.sessions, b.allSessions, "sessions"),
      boardCard(BOARDS.explorers, b.allExplorers, "explorers"),
      youLine(mine?.all, "ever"),
    ),
  ];
}

export function createList({ onPick, onExpand }) {
  const el = h("div", { class: "list" });

  function render() {
    const hasPosition = originPoint() != null;
    const tabs = h(
      "div",
      { class: "tabs", role: "tablist" },
      tabButton("nearby", hasPosition ? "Nearby" : "Near the keep"),
      tabButton("top", "Finest"),
      tabButton("royals", "👑 Royals"),
      tabButton("me", "My court"),
    );
    if (tab === "me") {
      replaceChildren(el, tabs, meView(onPick));
      return;
    }
    if (tab === "royals") {
      replaceChildren(el, tabs, royalsView());
      return;
    }
    const rows = tab === "nearby" ? nearby() : top();
    replaceChildren(
      el,
      tabs,
      rows.length
        ? rows.map((r) => row(r, onPick))
        : h("p", { class: "empty" }, "The court has yet to pass judgement. Be the first to review a throne 👑"),
    );
  }

  function tabButton(id, label) {
    return h(
      "button",
      {
        class: `tab ${tab === id ? "active" : ""}`,
        type: "button",
        role: "tab",
        "aria-selected": tab === id,
        onclick: () => {
          tab = id;
          if (id === "royals") {
            onExpand();
            royalsError = false;
            loadBoards().then(render, () => ((royalsError = true), render())); // the four top-3 boards: cached on the phone for 20 min
            myRoyalState().then(render, () => {}); // the "You:" lines (2 reads, kept for the session)
          }
          if (id === "me") {
            onExpand(); // the profile needs room
            loadProfile().then(render, () => {}); // one read, cached
            myRoyalState().then(render, () => {}); // the trophy shelves live on the royal record (2 reads, kept for the session)
          }
          render();
        },
      },
      label,
    );
  }

  return { el, render };
}
