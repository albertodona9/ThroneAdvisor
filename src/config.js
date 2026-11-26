// Firebase web config, read from environment variables (see .env.example).
//
// These values are NOT secret: they identify the project and ship to every visitor's
// browser. What protects the data is firestore.rules (and, in the Google Cloud console,
// the API key's HTTP-referrer restriction and App Check). They still live in git-ignored
// env files so the repo stays free of key-shaped strings and forks use their own project.
const env = import.meta.env;
export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const USE_EMULATOR = env.VITE_USE_EMULATOR === "true";

// App Check (reCAPTCHA). The site key is public. "enterprise" or "v3" must match what was
// registered under Firebase console -> App Check.
export const APPCHECK = {
  siteKey: env.VITE_APPCHECK_SITE_KEY,
  provider: env.VITE_APPCHECK_PROVIDER === "enterprise" ? "enterprise" : "v3",
};

export const CAMPUS = {
  id: "dtu-lyngby",
  mazemapId: 89,
  center: { lng: 12.5195, lat: 55.7863 },
  zoom: 16,
  defaultZ: 1, // ground floor ("S")
  // Rough campus box (+ margin). A GPS fix outside it is ignored for centering the map.
  bounds: { west: 12.505, east: 12.534, south: 55.775, north: 55.797 },
};

// Cost knobs. Every poll is exactly one Firestore document read per client, and only
// runs while the tab is visible. Live availability is optional and rarely used for now,
// so it is polled slowly; tighten LIVE_POLL_MS when check-ins become common.
export const LIVE_POLL_MS = 120_000; // who is in which toilet
export const STATS_POLL_MS = 5 * 60_000; // scores and visit counters
export const STALE_REFETCH_MS = 60_000; // refetch when the tab becomes visible again after this
