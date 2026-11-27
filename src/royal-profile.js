// The public profile window: opened from a podium avatar, laid out like "My court". It shows what a royal made
// public: portrait, name, title, birth date, short description, student number (only if they chose to publish
// it), their sessions / thrones this week and all time, and their trophy room. Reads their two royal records (2 reads), kept for a few
// minutes so reopening the same profile is free.
import { fetchMyRoyalState } from "./api.js";
import { avatarBadge } from "./avatars.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren } from "./dom.js";
import { db } from "./firebase.js";
import { classYearShort, formatBorn, titleIcon, titleLabel, weekNumber } from "./profile.js";
import { state } from "./store.js";
import { trophyRoom } from "./trophy-shelf.js";

const CACHE_MS = 5 * 60_000;
const cache = new Map(); // uid -> { at, value: { all, week } }

let overlay = null;
let card = null;
let shown = 0; // which opening is on screen, so a slow read can't paint over a newer window

function ensureOverlay() {
  if (overlay) return;
  card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "Royal profile" });
  overlay = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === overlay && close() }, card);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
  document.body.append(overlay);
}

function close() {
  if (overlay) overlay.hidden = true;
  shown++;
}

function stat(value, label) {
  return h("div", { class: "stat" }, h("strong", null, value), h("span", null, label));
}

async function loadRecords(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_MS && uid !== state.uid) return hit.value;
  const value = await fetchMyRoyalState(db, CAMPUS.id, uid, weekNumber());
  cache.set(uid, { at: Date.now(), value });
  return value;
}

export function classBadge(cy) {
  return cy ? h("div", { class: "class-badge", title: `Class of ${cy}` }, h("small", null, "Class of"), h("strong", null, classYearShort(cy))) : null;
}

function render(royal, rank, records) {
  const all = records?.all;
  const week = records?.week;
  const shownRoyal = all ? { ...royal, ...all } : royal; // the fresh record wins over the leaderboard's copy
  const number = (v) => (!records ? "…" : records.failed ? "–" : String(v ?? 0));
  replaceChildren(
    card,
    h("div", { class: "modal-head bare" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "✕")),
    h(
      "div",
      { class: "me-head" },
      avatarBadge(shownRoyal, { size: "big", rank }),
      h(
        "div",
        { class: "me-name" },
        h("strong", null, shownRoyal.name, shownRoyal.uid === state.uid ? " (you)" : "", shownRoyal.sn ? h("span", { class: "sn" }, ` · ${shownRoyal.sn}`) : null),
        h("span", { class: "muted" }, `${titleIcon(shownRoyal.title)} ${titleLabel(shownRoyal.title)}${shownRoyal.bornMs ? ` · born ${formatBorn(shownRoyal.bornMs)}` : ""}`),
      ),
      classBadge(shownRoyal.cy),
    ),
    shownRoyal.bio ? h("p", { class: "bio" }, shownRoyal.bio) : null,
    h("h3", { class: "list-title rule" }, "This week"),
    h("div", { class: "stats two" }, stat(number(week?.n), "sessions"), stat(number(week?.x), "thrones")),
    h("h3", { class: "list-title rule" }, "All time"),
    h("div", { class: "stats two" }, stat(number(all?.n), "sessions"), stat(number(all?.x), "thrones")),
    records && !records.failed ? [h("h3", { class: "list-title rule" }, "Trophy room"), trophyRoom(all)] : null,
  );
}

/** Open the window for `royal` (a leaderboard entry: uid, name, emoji, title, bornMs, ...). `rank` frames the avatar. */
export async function openRoyalProfile(royal, rank = null) {
  ensureOverlay();
  const mine = ++shown;
  overlay.hidden = false;
  render(royal, rank, null);
  try {
    const records = await loadRecords(royal.uid);
    if (mine === shown) render(royal, rank, records);
  } catch (e) {
    console.warn("royal profile read failed", e);
    if (mine === shown) {
      render(royal, rank, { failed: true });
      card.append(h("p", { class: "problem" }, "The court archives are out of reach. Check your connection."));
    }
  }
}
