// MazeMap integration: toilet bubbles (one GeoJSON source, filtered by floor), the user's
// blue dot, and camera helpers. The bubbles are WebGL layers, so hundreds of them are cheap.
import { CAMPUS } from "./config.js";
import { displayPosition, spreadAmount } from "./layout.js";
import { formatScore, overallScore, scoreColor } from "./scoring.js";
import { occupancy, state } from "./store.js";

const SOURCE = "toilets";
const FONT = ["Open Sans Semibold", "Arial Unicode MS Bold"];
const HIT_LAYERS = ["toilet-circle"];

let map;
let blueDot;
let ready = false;
let pendingData = null;
let pendingPosition = null; // a GPS fix can arrive before the map has finished loading
let current = null; // the GeoJSON last handed to the source, so zooming can move its points
let amount = 1; // how far the bubbles are spread right now (see spreadAmount)

export function createMap({ onSelect, onDeselect, onFloorChange }) {
  map = new Mazemap.Map({
    container: "map",
    campuses: CAMPUS.mazemapId,
    center: CAMPUS.center,
    zoom: CAMPUS.zoom,
    zLevel: CAMPUS.defaultZ,
    scrollZoom: true,
    // Our own location button and list replace MazeMap's default chrome clutter.
    attributionControl: true,
  });

  map.on("load", () => {
    if (import.meta.env.DEV) window.__map = map; // handy for poking around in the console
    map.addSource(SOURCE, { type: "geojson", data: emptyCollection() });
    addLayers(map.zLevel ?? CAMPUS.defaultZ);

    blueDot = new Mazemap.BlueDot({ map }).setZLevel(map.zLevel ?? CAMPUS.defaultZ);

    map.on("click", (e) => {
      const box = [
        [e.point.x - 12, e.point.y - 12],
        [e.point.x + 12, e.point.y + 12],
      ];
      const hit = map.queryRenderedFeatures(box, { layers: HIT_LAYERS })[0];
      if (hit) onSelect(String(hit.properties.id));
      else onDeselect();
    });
    map.on("mousemove", (e) => {
      const over = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS }).length > 0;
      map.getCanvas().style.cursor = over ? "pointer" : "";
    });
    map.on("zoom", respread);
    map.on("zlevel", () => {
      applyFloor(map.zLevel);
      onFloorChange(map.zLevel);
    });

    ready = true;
    if (pendingData) setData(pendingData);
    if (pendingPosition) showUser(pendingPosition);
  });

  return map;
}

const emptyCollection = () => ({ type: "FeatureCollection", features: [] });

function addLayers(z) {
  const onFloor = ["==", ["get", "z"], z];
  // Rooms are only a few metres apart, so bubbles grow with zoom: small enough not to pile
  // up when zoomed out, big enough to carry the score once you are looking at a building.
  const radius = ["interpolate", ["linear"], ["zoom"], 15, 4, 16.5, 8, 17.5, 11, 18.5, 14, 20, 22];
  const ringRadius = ["interpolate", ["linear"], ["zoom"], 15, 8, 16.5, 12, 17.5, 15, 18.5, 19, 20, 29];

  map.addLayer({
    id: "toilet-busy-ring",
    type: "circle",
    source: SOURCE,
    minzoom: 15,
    filter: ["all", onFloor, ["==", ["get", "busy"], 1]],
    paint: {
      "circle-radius": ringRadius,
      "circle-color": "#ef4444",
      "circle-opacity": 0.25,
      "circle-stroke-color": "#ef4444",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "toilet-selected-ring",
    type: "circle",
    source: SOURCE,
    filter: ["all", onFloor, ["==", ["get", "id"], ""]],
    paint: {
      "circle-radius": ringRadius,
      "circle-color": "#ffffff",
      "circle-opacity": 0,
      "circle-stroke-color": "#c9971c",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "toilet-circle",
    type: "circle",
    source: SOURCE,
    minzoom: 15,
    filter: onFloor,
    paint: {
      "circle-radius": radius,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "toilet-label",
    type: "symbol",
    source: SOURCE,
    minzoom: 17,
    filter: onFloor,
    layout: {
      "text-field": ["get", "label"],
      "text-font": FONT,
      "text-size": ["interpolate", ["linear"], ["zoom"], 17, 9, 18.5, 12, 20, 15],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
}

function applyFloor(z) {
  for (const id of ["toilet-busy-ring", "toilet-circle", "toilet-label"]) {
    const base = id === "toilet-busy-ring" ? [["==", ["get", "busy"], 1]] : [];
    map.setFilter(id, ["all", ["==", ["get", "z"], z], ...base]);
  }
  setSelected(state.selectedId);
  blueDot?.setZLevel(z);
}

/** Rebuild every bubble from the current stats + live occupancy. */
export function renderToilets() {
  const now = Date.now();
  amount = spreadAmount(map?.getZoom() ?? CAMPUS.zoom);
  const features = state.toilets.map((t) => {
    const score = overallScore(state.stats[t.id]);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: displayPosition(t, amount) },
      properties: {
        id: t.id,
        z: t.z,
        label: formatScore(score),
        color: scoreColor(score),
        busy: occupancy(t.id, now) ? 1 : 0,
      },
    };
  });
  setData({ type: "FeatureCollection", features });
}

/** Zooming in eases the bubbles from their spread spots back onto the real rooms. */
function respread() {
  const next = spreadAmount(map.getZoom());
  if (next === amount || !current) return;
  amount = next;
  for (const f of current.features) {
    f.geometry.coordinates = displayPosition(state.byId.get(f.properties.id), amount);
  }
  setData(current);
}

function setData(data) {
  current = data;
  if (!ready) {
    pendingData = data;
    return;
  }
  map.getSource(SOURCE).setData(data);
}

export function setSelected(id) {
  if (!ready) return;
  const z = map.zLevel;
  map.setFilter("toilet-selected-ring", ["all", ["==", ["get", "z"], z], ["==", ["get", "id"], id ?? ""]]);
}

export function floor() {
  return map?.zLevel ?? CAMPUS.defaultZ;
}

export function setFloor(z) {
  if (!map) return; // the map library didn't load (offline)
  if (map.zLevel !== z) map.setZLevel(z);
}

/**
 * Show the toilet: switch to its floor and bring it into view. `offset` is where, relative
 * to the map centre in pixels, the toilet should land (so it isn't hidden by the sheet).
 */
export function focusToilet(t, { offset = [0, 0] } = {}) {
  if (!map) return;
  setFloor(t.z);
  const zoom = Math.max(map.getZoom(), 18.5);
  map.flyTo({
    center: displayPosition(t, spreadAmount(zoom)), // where its bubble will be once we arrive
    zoom,
    offset,
    duration: 700,
  });
}

export function showUser(position) {
  pendingPosition = position;
  if (!blueDot || !position) return;
  blueDot.setLngLat({ lng: position.lng, lat: position.lat });
  if (position.accuracy) blueDot.setAccuracy(position.accuracy);
  blueDot.show();
}

export function flyToUser(position) {
  if (!map) return;
  map.flyTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 18), duration: 900 });
}

export function resize() {
  map?.resize();
}
