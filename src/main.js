import "./style.css";
import { createAccountUI } from "./account-ui.js";
import { initAccount } from "./account.js";
import { CAMPUS } from "./config.js";
import { createDetail } from "./detail.js";
import { h, toast } from "./dom.js";
import { inBounds } from "./geo.js";
import { spreadOverlaps } from "./layout.js";
import { createList } from "./list.js";
import { createMap, floor, flyToUser, focusToilet, renderToilets, setSelected, showUser } from "./map.js";
import { startSync, refreshAll } from "./sync.js";
import { state, subscribe, update } from "./store.js";

// ---- layout -------------------------------------------------------------------------

const account = createAccountUI();
const detail = createDetail({ onClose: deselect, onSaveAccount: account.open });
const list = createList({ onPick: select });

const offlineChip = h("span", { class: "chip offline", hidden: true }, "offline");
const handle = h("button", {
  class: "handle",
  type: "button",
  "aria-label": "Expand or collapse list",
  onclick: () => sheet.classList.toggle("expanded"),
});
const sheet = h("aside", { class: "sheet", "data-mode": "list" }, handle, list.el, detail.el);
const locate = h(
  "button",
  { class: "fab", type: "button", "aria-label": "Show my location", onclick: onLocate },
  "◎",
);

document.getElementById("app").append(
  h("header", { class: "topbar" }, h("div", { class: "brand" }, h("span", null, "🚽"), " ThroneAdvisor"), offlineChip),
  account.button,
  locate,
  sheet,
);

// ---- selection ----------------------------------------------------------------------

function select(id) {
  const t = typeof id === "string" ? state.byId.get(id) : id;
  if (!t) return;
  update({ selectedId: t.id });
  setSelected(t.id);
  sheet.dataset.mode = "detail";
  detail.open(t);
  // The sheet is taller once reviews load, so aim for the free map area, not its current size.
  setTimeout(() => focusToilet(t, { offset: freeAreaOffset() }), 0);
}

/** Pixel offset from the map centre to the middle of the part of the map the sheet leaves free. */
function freeAreaOffset() {
  if (window.matchMedia("(min-width: 820px)").matches) return [207, 0]; // side panel on the left
  return [0, -(window.innerHeight * 0.7) / 2]; // bottom sheet takes up to 70% of the height
}

function deselect() {
  detail.close();
  update({ selectedId: null });
  setSelected(null);
  sheet.dataset.mode = "list";
}

// ---- location -----------------------------------------------------------------------

let centeredOnUser = false;

function watchPosition() {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.watchPosition(
    (pos) => {
      const position = { lng: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy };
      update({ position });
      if (!inBounds(position, CAMPUS.bounds)) return; // not on campus: leave the map where it is
      showUser(position);
      if (!centeredOnUser) {
        centeredOnUser = true;
        flyToUser(position);
      }
    },
    () => {}, // denied or unavailable: the app works fine without it
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
  );
}

function onLocate() {
  if (state.position && inBounds(state.position, CAMPUS.bounds)) flyToUser(state.position);
  else if (state.position) toast("You don't seem to be on campus right now.");
  else {
    toast("Waiting for your location… allow location access if asked.");
    watchPosition();
  }
}

// ---- boot ---------------------------------------------------------------------------

let renderTimer = 0;
subscribe((s) => {
  offlineChip.hidden = !s.offline;
  // Coalesce bursts of updates into one render. (Not requestAnimationFrame: that stops
  // entirely in background tabs, and the DOM should still be current when you come back.)
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderToilets();
    list.render();
    detail.render();
  }, 0);
});

async function boot() {
  initAccount(); // restores a saved/anonymous session and keeps state.uid / state.account current
  createMap({
    onSelect: select,
    onDeselect: () => state.selectedId && deselect(),
    onFloorChange: (z) => update({ z }),
  });

  const registry = await import("./data/toilets-dtu-lyngby.json");
  // Display positions are nudged apart where rooms overlap; distances still use the true ones.
  const toilets = spreadOverlaps(registry.default.toilets);
  update({
    toilets,
    byId: new Map(toilets.map((t) => [t.id, t])),
    z: floor(),
    loaded: true,
  });

  await refreshAll(); // two document reads for the whole campus
  startSync();
  watchPosition();
  setInterval(() => update(), 30_000); // lets "in use" flags and countdowns expire on their own
}

boot();
