// Bottom list: closest thrones and top-rated thrones. Computed locally from the toilet
// registry + the stats document, so browsing it costs no reads.
import { CAMPUS } from "./config.js";
import { h, replaceChildren } from "./dom.js";
import { distanceMeters, formatDistance, inBounds } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { formatScore, overallScore, rankScore, scoreColor } from "./scoring.js";
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
    h("span", { class: "bubble", style: `background:${scoreColor(score)}` }, formatScore(score)),
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-title" }, toiletTitle(t)),
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

export function createList({ onPick }) {
  const el = h("div", { class: "list" });

  function render() {
    const rows = tab === "nearby" ? nearby() : top();
    const hasPosition = originPoint() != null;
    replaceChildren(
      el,
      h(
        "div",
        { class: "tabs", role: "tablist" },
        tabButton("nearby", hasPosition ? "Near you" : "Near campus centre"),
        tabButton("top", "Top rated"),
      ),
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
          render();
        },
      },
      label,
    );
  }

  return { el, render };
}
