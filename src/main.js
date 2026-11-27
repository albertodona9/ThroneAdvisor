import "./style.css";
import { createAccountUI } from "./account-ui.js";
import { initAccount } from "./account.js";
import { CAMPUS } from "./config.js";
import { createCredits } from "./credits.js";
import { createDetail } from "./detail.js";
import { createInstallChip } from "./install.js";
import { h, toast } from "./dom.js";
import { inBounds } from "./geo.js";
import { spreadOverlaps } from "./layout.js";
import { createList } from "./list.js";
import { enableSheetSwipe } from "./sheet-swipe.js";
import { createQuickUI } from "./quick-ui.js";
import { createMap, floor, flyToUser, focusToilet, renderToilets, setSelected, showUser } from "./map.js";
import { startSync, refreshAll } from "./sync.js";
import { state, subscribe, update } from "./store.js";

// ---- layout -------------------------------------------------------------------------

const account = createAccountUI();
const credits = createCredits();
const detail = createDetail({ onClose: deselect, onSaveAccount: account.open });
const list = createList({
  onPick: select,
  onEditProfile: () => account.open("personalize"),
  onExpand: () => sheet.classList.add("expanded"),
});

const quick = createQuickUI({ onRate: (t) => select(t) });
const offlineChip = h("span", { class: "chip offline", hidden: true }, "offline");
const installChip = createInstallChip();
const handle = h("button", {
  class: "handle",
  type: "button",
  "aria-label": "Expand or collapse list",
  onclick: () => sheet.classList.toggle("expanded"),
});
const sheet = h("aside", { class: "sheet", "data-mode": "list" }, handle, list.el, detail.el);
enableSheetSwipe({ sheet, list: list.el });
const locate = h(
  "button",
  { class: "fab", type: "button", "aria-label": "Show my location", onclick: onLocate },
  "◎",
);

document.getElementById("app").append(
  h(
    "header",
    { class: "topbar" },
    h(
      "button",
      { class: "brand", type: "button", "aria-label": "About ThroneAdvisor", onclick: credits.open },
      h("img", { class: "brand-logo", src: "/android-chrome-192x192.png", alt: "", width: 28, height: 28 }),
      "ThroneAdvisor",
    ),
    offlineChip,
    installChip,
  ),
  account.button,
  locate,
  quick.button,
  sheet,
);

// The 🚽 button sits just above the bottom sheet, whatever height the sheet has right now.
const placeAboveSheet = () => document.documentElement.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
new ResizeObserver(placeAboveSheet).observe(sheet);
placeAboveSheet();

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
  try {
    createMap({
      onSelect: select,
      onDeselect: () => state.selectedId && deselect(),
      onFloorChange: (z) => update({ z }),
    });
  } catch (e) {
    // The map library comes from MazeMap's CDN: offline, it is simply missing. The lists still work.
    console.warn("map failed to load", e);
    toast("The map couldn't load. Check your connection; the lists still work.", 6000);
  }

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

// Installable app + offline app shell (see public/sw.js). Production only: in dev a service worker
// would serve stale files and get in the way of hot reload.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker not registered", e));
  });
}
