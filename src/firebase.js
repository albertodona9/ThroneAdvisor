import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { FIREBASE_CONFIG, USE_EMULATOR } from "./config.js";

const missing = Object.entries(FIREBASE_CONFIG).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  throw new Error(`Missing Firebase config (${missing.join(", ")}). Copy .env.example to .env.production.local and fill it in.`);
}

const app = initializeApp(FIREBASE_CONFIG);
export const db = getFirestore(app);
export const auth = getAuth(app);

if (USE_EMULATOR) {
  // "localhost" can resolve to IPv6 first, where the emulators don't listen. When the app
  // is opened from a phone via the laptop's LAN address, that address is used as-is.
  const host = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
}

/** uid of a user who already has a session (no network call, no sign-in), else null. */
export async function currentUid() {
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}

let signingIn = null;
/** Anonymous sign-in, only triggered by the user's first write. The session persists. */
export async function ensureUser() {
  const existing = await currentUid();
  if (existing) return existing;
  signingIn ??= signInAnonymously(auth).finally(() => (signingIn = null));
  return (await signingIn).user.uid;
}
