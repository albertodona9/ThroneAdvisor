// Account button (top right) and the account modal.
import { authErrorMessage, logOut, saveWithGoogle, signInToExisting } from "./account.js";
import { h, replaceChildren, toast } from "./dom.js";
import { nickname } from "./nickname.js";
import { state, subscribe } from "./store.js";

const GOOGLE_G = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;

const PROMPT_KEY = "throneadvisor.savePromptDismissedAt";
const PROMPT_SNOOZE_MS = 7 * 24 * 3600 * 1000;

function googleButton(label, onclick, disabled) {
  const icon = h("span", { class: "gicon" });
  icon.innerHTML = GOOGLE_G; // static, trusted markup
  return h("button", { class: "btn google", type: "button", disabled, onclick }, icon, label);
}

export function createAccountUI() {
  let busy = false;
  const avatar = h("button", { class: "account-btn", type: "button", "aria-label": "Account", onclick: open });
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "Account" });
  const overlay = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === overlay && close() }, card);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  function open() {
    overlay.hidden = false;
    render();
  }
  function close() {
    overlay.hidden = true;
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    render();
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      const message = authErrorMessage(e);
      if (message) toast(message);
    } finally {
      busy = false;
      render();
    }
  }

  const confirmSwitch = async () =>
    window.confirm(
      "This Google account already has a ThroneAdvisor profile.\n\nSwitch to it? Reviews you made on this device without an account stay with the old anonymous profile.",
    );

  const save = () =>
    run(async () => {
      const result = await saveWithGoogle({ confirmSwitch });
      if (result === "linked") toast("Account saved. Your reviews are now safe 🎉");
      else if (result === "switched" || result === "signed-in") toast("Signed in. Welcome back 👑");
      if (result !== "cancelled") close();
    });

  const signInExisting = () =>
    run(async () => {
      await signInToExisting();
      toast("Signed in. Welcome back 👑");
      close();
    });

  const signOutNow = () =>
    run(async () => {
      await logOut();
      toast("Signed out");
      close();
    });

  function render() {
    const a = state.account;
    const closeBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "✕");

    if (a && !a.anonymous) {
      replaceChildren(
        card,
        h("div", { class: "modal-head" }, h("h2", null, "Your account"), closeBtn),
        h(
          "div",
          { class: "profile" },
          avatarImage(a, "big"),
          h("div", null, h("strong", null, a.name ?? "Signed in"), h("p", { class: "muted" }, a.email ?? "")),
        ),
        h(
          "p",
          { class: "note" },
          `Your reviews appear as “${nickname(a.uid)}”. Your Google name and email are never shown to anyone else, and your reviews stay with you on any phone you sign in on.`,
        ),
        h("button", { class: "btn ghost", type: "button", disabled: busy, onclick: signOutNow }, "Sign out"),
      );
      return;
    }

    const anonymous = !!a;
    replaceChildren(
      card,
      h("div", { class: "modal-head" }, h("h2", null, anonymous ? "Save your account" : "Sign in"), closeBtn),
      anonymous
        ? h(
            "p",
            { class: "note" },
            `You're using ThroneAdvisor without an account, as “${nickname(a.uid)}”. Your reviews are tied to this browser: clear its data or switch phones and you'd lose them. Save them to a Google account and they follow you everywhere.`,
          )
        : h("p", { class: "note" }, "Sign in to keep your reviews across devices. You can also just rate toilets without an account."),
      googleButton(anonymous ? "Save my account with Google" : "Continue with Google", save, busy),
      anonymous
        ? h(
            "button",
            { class: "linklike", type: "button", disabled: busy, onclick: signInExisting },
            "I already saved an account on another device",
          )
        : null,
      h("p", { class: "fineprint" }, "We only use Google to recognise you. Nobody else sees your name or email."),
    );
  }

  const sync = () => {
    const a = state.account;
    replaceChildren(avatar, a && !a.anonymous && a.photoURL ? avatarImage(a, "small") : "👤");
    avatar.classList.toggle("needs-save", !!a?.anonymous); // dot: reviews not saved to an account yet
    if (!overlay.hidden) render();
  };
  subscribe(sync);
  sync();

  document.body.append(overlay);
  return { button: avatar, open };
}

function avatarImage(account, size) {
  return account.photoURL
    ? h("img", { class: `avatar ${size}`, src: account.photoURL, alt: "", referrerpolicy: "no-referrer" })
    : h("span", { class: `avatar ${size} initial` }, (account.name ?? "?").slice(0, 1).toUpperCase());
}

/** Whether to nudge an anonymous user to save their account (snoozed for a week after "Later"). */
export function shouldPromptSave() {
  if (!state.account?.anonymous) return false;
  const dismissed = Number(localStorage.getItem(PROMPT_KEY) ?? 0);
  return Date.now() - dismissed > PROMPT_SNOOZE_MS;
}

export function snoozeSavePrompt() {
  localStorage.setItem(PROMPT_KEY, String(Date.now()));
}
