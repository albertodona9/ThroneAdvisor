// Tiny reactive store: one state object, subscribers are called after every change.
import { CHECK_IN_MINUTES } from "./api.js";

const CHECKIN_KEY = "throneadvisor.checkin";

function loadCheckIn() {
  try {
    return JSON.parse(localStorage.getItem(CHECKIN_KEY)) ?? null;
  } catch {
    return null;
  }
}

export const state = {
  toilets: [], // static registry
  byId: new Map(),
  stats: {}, // { id: {n,p,c,k,v} }
  live: {}, // { id: {u,s,d} }
  uid: null,
  account: null, // {uid, anonymous, name, email, photoURL} | null (never wrote anything yet)
  profile: null, // {name, emoji, rv, vs} once loaded (one read), else null
  position: null, // {lng, lat, accuracy}
  z: 1, // floor shown on the map
  selectedId: null,
  checkIn: loadCheckIn(), // {id, at} — the toilet *this* user is currently in
  myReviews: new Map(), // id -> own review (or null), cached for the session
  lastStatsAt: 0,
  lastLiveAt: 0,
  loaded: false,
  offline: false,
};

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function update(patch = {}) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function setCheckIn(checkIn) {
  if (checkIn) localStorage.setItem(CHECKIN_KEY, JSON.stringify(checkIn));
  else localStorage.removeItem(CHECKIN_KEY);
  update({ checkIn });
}

/** Someone is (still) in this toilet according to the last live snapshot. */
export function occupancy(id, now = Date.now()) {
  const o = state.live[id];
  if (!o) return null;
  const until = o.s + (o.d ?? CHECK_IN_MINUTES) * 60_000;
  if (until <= now) return null; // expired: a forgotten check-in frees itself
  return { mine: o.u === state.uid, until, minutesLeft: Math.max(1, Math.ceil((until - now) / 60_000)) };
}
