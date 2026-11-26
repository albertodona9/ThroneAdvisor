// Bottom list: closest thrones, top-rated thrones, and "Me" (your profile stats and reviews).
// Computed locally from the toilet registry, the stats document and your profile, so
// browsing it costs no extra reads.
import { loadProfile } from "./actions.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren } from "./dom.js";
import { distanceMeters, formatDistance, inBounds, timeAgo } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { displayName, myReviewList, profileStats } from "./profile.js";
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
        e?.n ? ` · ${e.n} review${e.n === 1 ? "" : "s"}` : " · not rated yet",
      ),
    ),
    occ ? h("span", { class: "dot busy", title: "In use" }) : null,
  );
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("strong", null, value), h("span", null, label));
}

/** Profile header, numbers and the user's own reviews. */
function meView(onPick, onEditProfile) {
  const profile = state.profile;
  if (!state.uid) {
    return h("p", { class: "empty" }, "Rate a toilet and your profile starts here: your reviews, your visits and your favourite thrones 👑");
  }
  if (!profile) return h("p", { class: "empty" }, "Loading your profile…");

  const stats = profileStats(profile);
  const reviews = myReviewList(profile).filter((r) => state.byId.has(r.id));
  return [
    h(
      "div",
      { class: "me-head" },
      h("span", { class: "avatar big initial" }, profile.emoji ?? "🚽"),
      h("div", { class: "me-name" }, h("strong", null, displayName(state.uid, profile.name)), h("span", { class: "muted" }, "Your profile")),
      h("button", { class: "btn secondary small", type: "button", onclick: onEditProfile }, "✏️ Edit"),
    ),
    h(
      "div",
      { class: "stats" },
      stat(stats.reviews, "reviews"),
      stat(stats.visits, "visits"),
      stat(stats.toilets, "toilets"),
      stat(stats.avgGiven == null ? "–" : stats.avgGiven.toFixed(1), "avg score"),
    ),
    reviews.length
      ? [
          h("h3", { class: "list-title" }, "Your reviews"),
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
                  visits ? ` · ${visits} visit${visits === 1 ? "" : "s"}` : "",
                ),
              ),
            );
          }),
        ]
      : h("p", { class: "empty" }, "You haven't reviewed a toilet yet. Pick one on the map and rate it 🧻"),
  ];
}

export function createList({ onPick, onEditProfile, onExpand }) {
  const el = h("div", { class: "list" });

  function render() {
    const hasPosition = originPoint() != null;
    const tabs = h(
      "div",
      { class: "tabs", role: "tablist" },
      tabButton("nearby", hasPosition ? "Near you" : "Near campus centre"),
      tabButton("top", "Top rated"),
      tabButton("me", "Me"),
    );
    if (tab === "me") {
      replaceChildren(el, tabs, meView(onPick, onEditProfile));
      return;
    }
    const rows = tab === "nearby" ? nearby() : top();
    replaceChildren(
      el,
      tabs,
      rows.length
        ? rows.map((r) => row(r, onPick))
        : h("p", { class: "empty" }, "No ratings yet. Be the first to review a throne 👑"),
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
