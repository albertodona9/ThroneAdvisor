// Bottom list: closest thrones, top-rated thrones, and "Me" (your profile stats and reviews).
// Computed locally from the toilet registry, the stats document and your profile, so
// browsing it costs no extra reads.
import { loadProfile } from "./actions.js";
import { currentWeekEntry, loadBoards, myRoyalState } from "./royals.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren } from "./dom.js";
import { distanceMeters, formatDistance, inBounds, timeAgo } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { BOARDS, displayName, formatBorn, medal, myReviewList, profileStats, titleIcon, titleLabel, weekLabel } from "./profile.js";
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
function meView(onPick, onEditProfile) {
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
      h("span", { class: "avatar big initial" }, profile.emoji ?? "🚽"),
      h("div", { class: "me-name" }, h("strong", null, displayName(state.uid, profile.name)), h("span", { class: "muted" }, `${titleIcon(profile.title)} ${titleLabel(profile.title)}${state.account?.createdMs ? ` · born ${formatBorn(state.account.createdMs)}` : ""}`)),
      h("button", { class: "btn secondary small", type: "button", onclick: onEditProfile }, "Edit"),
    ),
    h(
      "div",
      { class: "stats" },
      stat(stats.reviews, "verdicts"),
      stat(stats.visits, "audiences"),
      stat(stats.toilets, "thrones"),
      stat(stats.avgGiven == null ? "–" : stats.avgGiven.toFixed(1), "avg verdict"),
    ),
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

/** One podium place: medal, avatar, name + title, birth date, and the number the board is ranked by. */
function royalRow(r, rank, mine, board) {
  const value = r[board.field];
  return h(
    "div",
    { class: `row royal ${mine ? "mine" : ""}` },
    h("span", { class: "rank" }, medal(rank)),
    h("span", { class: "royal-avatar" }, r.emoji ?? titleIcon(r.title)),
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-title" }, r.name, mine ? " (you)" : "", h("span", { class: "tier-tag" }, ` · ${titleLabel(r.title)}`)),
      h("span", { class: "row-sub" }, r.bornMs ? `Born ${formatBorn(r.bornMs)}` : ""),
    ),
    h("span", { class: "royal-n" }, h("strong", null, String(value)), h("small", null, value === 1 ? board.unit[0] : board.unit[1])),
  );
}

/** One board: its name, what it ranks, and the top three (or an invitation when nobody has any yet). */
function boardCard(board, list) {
  return h(
    "section",
    { class: "board" },
    h("h4", { class: "board-title" }, `${board.icon} ${board.title}`, h("small", null, board.caption)),
    list.length
      ? list.map((r, i) => royalRow(r, i + 1, r.uid === state.uid, board))
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

/** The Royals tab: this week's two podiums, then the all-time ones. */
function royalsView() {
  const b = state.boards;
  if (!b) return h("p", { class: "empty" }, royalsError ? "The court is out of reach. Check your connection." : "Summoning the court…");
  const mine = state.myRoyal;
  return [
    h(
      "section",
      { class: "period" },
      h("h3", { class: "period-title" }, "Court of the Week", h("small", null, `${weekLabel(b.week)} · starts over every Monday · a tie goes to the oldest royal`)),
      boardCard(BOARDS.sessions, b.weekSessions),
      boardCard(BOARDS.explorers, b.weekExplorers),
      youLine(currentWeekEntry(mine), "this week"),
    ),
    h(
      "section",
      { class: "period" },
      h("h3", { class: "period-title" }, "Hall of Legends", h("small", null, "a tie goes to the youngest royal, so the crown keeps changing hands")),
      boardCard(BOARDS.sessions, b.allSessions),
      boardCard(BOARDS.explorers, b.allExplorers),
      youLine(mine?.all, "ever"),
    ),
  ];
}

export function createList({ onPick, onEditProfile, onExpand }) {
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
      replaceChildren(el, tabs, meView(onPick, onEditProfile));
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
          }
          render();
        },
      },
      label,
    );
  }

  return { el, render };
}
