// The 💩 button (bottom right): a quick "I just throned" log. Pick the throne you used, confirm,
// and it adds one visit to that toilet's counter and to your profile. At most 3 a day per user;
// the limit lives in the user's profile and is enforced by firestore.rules, and the phone shows
// how many are left.
import { QuickLimitError, errorMessage, loadProfile, quickVisit } from "./actions.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren, toast } from "./dom.js";
import { distanceMeters, formatDistance, inBounds } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { QUICK_PER_DAY, quickUsage } from "./profile.js";
import { overallScore } from "./scoring.js";
import { tierBadge, tierTag } from "./tiers-ui.js";
import { state, subscribe } from "./store.js";

const FLOOR_PENALTY_M = 12; // same "nearby" ranking as the list: one floor away counts as 12 m
const NEARBY_ROWS = 8;
const SEARCH_ROWS = 30;

export function createQuickUI({ onRate }) {
  let step = "pick"; // "pick" | "confirm" | "done"
  let query = "";
  let chosen = null;
  let busy = false;

  const badge = h("span", { class: "fab-badge" });
  const fab = h("button", { class: "fab throne", type: "button", "aria-label": "I just throned", onclick: open }, "💩", badge);
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "I just throned" });
  const overlay = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === overlay && close() }, card);
  document.body.append(overlay);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  function open() {
    step = "pick";
    query = "";
    chosen = null;
    overlay.hidden = false;
    render();
    loadProfile().then(() => !overlay.hidden && step === "pick" && render(), () => {}); // today's count, if not loaded yet
  }
  function close() {
    overlay.hidden = true;
  }

  function candidates() {
    const origin = state.position && inBounds(state.position, CAMPUS.bounds) ? state.position : CAMPUS.center;
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = tokens.length
      ? state.toilets.filter((t) => {
          const hay = `${t.n} ${t.n2 ?? ""} building ${t.b} floor ${t.f}`.toLowerCase();
          return tokens.every((k) => hay.includes(k));
        })
      : state.toilets;
    return pool
      .map((t) => {
        const meters = distanceMeters(origin, t);
        return { t, meters, key: meters + Math.abs(t.z - state.z) * FLOOR_PENALTY_M };
      })
      .sort((a, b) => a.key - b.key)
      .slice(0, tokens.length ? SEARCH_ROWS : NEARBY_ROWS);
  }

  const closeBtn = () => h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "✕");
  const leftText = (left) => (left > 0 ? `${left} of ${QUICK_PER_DAY} left today` : `All ${QUICK_PER_DAY} used today`);
  const rowFor = ({ t, meters }) => {
    const score = overallScore(state.stats[t.id]);
    return h(
      "button",
      { class: "row", type: "button", onclick: () => { chosen = t; step = "confirm"; render(); } },
      tierBadge(score),
      h("span", { class: "row-main" }, h("span", { class: "row-title" }, toiletTitle(t), tierTag(score)), h("span", { class: "row-sub" }, `${toiletPlace(t)} · ${formatDistance(meters)}`)),
    );
  };

  function render() {
    const { left } = quickUsage(state.profile);

    if (step === "done") {
      replaceChildren(
        card,
        h("div", { class: "modal-head" }, h("h2", null, "Logged 💩"), closeBtn()),
        h("p", { class: "note" }, h("strong", null, `+1 at ${toiletTitle(chosen)}`), ` · ${leftText(left)}`),
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary", type: "button", onclick: () => { close(); onRate(chosen); } }, "Rate it too"),
          h("button", { class: "btn ghost", type: "button", onclick: close }, "Done"),
        ),
      );
      return;
    }

    if (step === "confirm") {
      replaceChildren(
        card,
        h("div", { class: "modal-head" }, h("h2", null, "Log this visit?"), closeBtn()),
        h("div", { class: "confirm-throne" }, h("strong", null, toiletTitle(chosen)), h("span", { class: "muted" }, toiletPlace(chosen))),
        h("p", { class: "fineprint" }, `${leftText(left)}. This counts as one use of this throne.`),
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary", type: "button", disabled: busy, onclick: confirm }, "Yes, I just throned 💩"),
          h("button", { class: "btn ghost", type: "button", disabled: busy, onclick: () => { step = "pick"; render(); } }, "Back"),
        ),
      );
      return;
    }

    // step === "pick"
    if (left <= 0) {
      replaceChildren(
        card,
        h("div", { class: "modal-head" }, h("h2", null, "I just throned 💩"), closeBtn()),
        h("p", { class: "note" }, `You've used all ${QUICK_PER_DAY} quick logs for today. The throne will be waiting tomorrow 👑`),
        h("p", { class: "fineprint" }, "You can still rate any toilet from the map, as often as you like."),
        h("button", { class: "btn ghost", type: "button", onclick: close }, "Close"),
      );
      return;
    }

    const list = h("div", { class: "pick-list" });
    const fill = () => {
      const rows = candidates();
      replaceChildren(list, rows.length ? rows.map(rowFor) : h("p", { class: "empty" }, "No toilet matches that. Try a building number or room."));
    };
    const search = h("input", {
      type: "search",
      class: "search",
      placeholder: "Find the throne you used (building, room…)",
      "aria-label": "Search toilets",
      autocomplete: "off",
      oninput: (e) => { query = e.target.value; fill(); },
    });
    search.value = query;
    replaceChildren(
      card,
      h("div", { class: "modal-head" }, h("h2", null, "I just throned 💩"), closeBtn()),
      h("p", { class: "fineprint left" }, `${leftText(left)} · ${query.trim() ? "search results" : "closest to you"}`),
      search,
      list,
    );
    fill();
  }

  async function confirm() {
    if (busy) return;
    busy = true;
    render();
    try {
      await quickVisit(chosen.id);
      step = "done";
    } catch (e) {
      step = "pick";
      if (e instanceof QuickLimitError) toast("You've used today's 3 quick logs. Back tomorrow 👑", 4500);
      else {
        console.warn(e);
        toast(errorMessage(e));
      }
    } finally {
      busy = false;
      render();
    }
  }

  // The badge on the button shows how many are left today.
  const sync = () => {
    const { left } = quickUsage(state.profile);
    badge.textContent = String(left);
    badge.classList.toggle("empty", left === 0);
    fab.title = leftText(left);
  };
  subscribe(sync);
  sync();

  return { button: fab, open };
}
