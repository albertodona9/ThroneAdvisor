// Accounts: everyone starts anonymous (zero friction); signing in with Google *links* the
// Google login to that same Firebase user, so the uid, and therefore every review already
// written, stays theirs and survives a cleared browser or a new phone. Reviews keep
// showing the generated nickname, never the Google name or email.
import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase.js";
import { loadProfile } from "./actions.js";
import { clearCache } from "./cache.js";
import { setCheckIn, state, update } from "./store.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function toAccount(user) {
  if (!user) return null;
  const info = user.providerData[0]; // displayName/photoURL can be empty on the user right after linking
  return {
    uid: user.uid,
    anonymous: user.isAnonymous,
    name: user.displayName ?? info?.displayName ?? null,
    email: user.email ?? info?.email ?? null,
    photoURL: user.photoURL ?? info?.photoURL ?? null,
  };
}

/** Keeps `state.uid` / `state.account` in sync with Firebase Auth. Call once at startup. */
export function initAccount() {
  onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? null;
    if (state.uid && uid !== state.uid) {
      // Signed out or switched to another user: nothing cached for the previous one applies.
      state.myReviews.clear();
      if (state.checkIn) setCheckIn(null);
      clearCache(`profile.${state.uid}`); // don't leave their profile on a shared phone
      state.profile = null;
    }
    update({ uid, account: toAccount(user) });
    // Users who already have an account get their profile (name, avatar, history) loaded: one read.
    if (uid && !state.profile) loadProfile().catch((e) => console.warn("profile load failed", e));
  });
}

/**
 * Anonymous user -> link Google to it (keeps the uid). No user yet -> plain Google sign-in.
 * If that Google account already belongs to another ThroneAdvisor profile, `confirmSwitch()`
 * decides whether to switch to it. Resolves to what happened.
 */
export async function saveWithGoogle({ confirmSwitch }) {
  const user = auth.currentUser;
  try {
    if (user?.isAnonymous) {
      await linkWithPopup(user, provider);
      update({ account: toAccount(auth.currentUser) }); // linking doesn't fire onAuthStateChanged
      return "linked";
    }
    await signInWithPopup(auth, provider);
    return "signed-in";
  } catch (e) {
    if (e.code === "auth/credential-already-in-use") {
      const credential = GoogleAuthProvider.credentialFromError(e);
      if (credential && (await confirmSwitch())) {
        await signInWithCredential(auth, credential);
        return "switched";
      }
      return "cancelled";
    }
    throw e;
  }
}

/** "I already saved an account": sign in to it, leaving this device's anonymous profile behind. */
export async function signInToExisting() {
  await signInWithPopup(auth, provider);
}

export const logOut = () => signOut(auth);

/** Friendly message for an auth error, or null when the user simply closed the popup. */
export function authErrorMessage(e) {
  switch (e?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return null;
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.";
    case "auth/operation-not-allowed":
      return "Google sign-in isn't switched on for this project yet.";
    case "auth/unauthorized-domain":
      return "Sign-in isn't allowed from this address.";
    case "auth/network-request-failed":
      return "You seem to be offline.";
    default:
      return "Couldn't sign in. Please try again.";
  }
}
