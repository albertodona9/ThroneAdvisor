// Account button (top right), the account modal, and its profile personalization view.
import { errorMessage, loadProfile, updateProfile } from "./actions.js";
import { authErrorMessage, logOut, saveWithGoogle, signInToExisting } from "./account.js";
import { AVATARS, FRAMES, avatarBadge } from "./avatars.js";
import { h, replaceChildren, toast } from "./dom.js";
import { BIO_MAX, TITLES, bioProblem, classYearOptions, displayName, formatBorn, nameProblem, studentNumberProblem, titleIcon, titleLabel } from "./profile.js";
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
  let view = "main"; // "main" | "personalize"
  let draft = null; // {name, emoji, title, frame} while personalizing

  const avatar = h("button", { class: "account-btn", type: "button", "aria-label": "Account", onclick: () => open() });
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "Account" });
  const overlay = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === overlay && close() }, card);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  function open(which = "main") {
    view = which;
    draft = null;
    overlay.hidden = false;
    render();
    // The profile (name, avatar) is one read, cached; render again once it is in.
    loadProfile().then(() => !overlay.hidden && render(), () => {});
  }
  function close() {
    overlay.hidden = true;
  }

  async function run(fn, describeError = authErrorMessage) {
    if (busy) return;
    busy = true;
    render();
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      const message = describeError(e);
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
      if (result === "linked") toast("Account saved. Your legacy is secure 🎉");
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
      toast("You have left the court");
      close();
    });

  const closeButton = () => h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "✕");
  const shownName = () => displayName(state.uid ?? "", state.profile?.name);
  /** "🤴 King · born 26 Nov 2026": the birth date is the day the account was created. */
  const royalLine = () =>
    h("p", { class: "royal-line" }, `${titleIcon(state.profile?.title)} ${titleLabel(state.profile?.title)}${state.account?.createdMs ? ` · born ${formatBorn(state.account.createdMs)}` : ""}`);

  function render() {
    if (view === "personalize") return renderPersonalize();
    const a = state.account;

    const personalize = h(
      "button",
      { class: "btn secondary", type: "button", disabled: busy, onclick: () => ((view = "personalize"), (draft = null), render()) },
      "✏️ Personalize your court profile",
    );

    if (a && !a.anonymous) {
      replaceChildren(
        card,
        h("div", { class: "modal-head" }, h("h2", null, "Your royal account"), closeButton()),
        h(
          "div",
          { class: "profile" },
          avatarFor(a, "big"),
          h("div", null, h("strong", null, shownName()), h("p", { class: "muted" }, a.email ?? ""), royalLine()),
        ),
        h(
          "p",
          { class: "note" },
          `Your verdicts are signed “${shownName()}”. Your Google name and email are never shown to anyone else, and your reign follows you to any phone you sign in on.`,
        ),
        personalize,
        h("button", { class: "btn ghost", type: "button", disabled: busy, onclick: signOutNow }, "Leave the court"),
      );
      return;
    }

    const anonymous = !!a;
    replaceChildren(
      card,
      h("div", { class: "modal-head" }, h("h2", null, anonymous ? "Secure your crown" : "Enter the court"), closeButton()),
      anonymous
        ? h(
            "p",
            { class: "note" },
            `You're reigning incognito as “${shownName()}”. Your verdicts are bound to this browser: clear its data or switch phones and your reign would be lost. Save it to a Google account and it follows you everywhere.`,
          )
        : h("p", { class: "note" }, "Sign in to keep your reign across devices. You can also rate thrones without an account."),
      anonymous ? royalLine() : null,
      googleButton(anonymous ? "Save my account with Google" : "Continue with Google", save, busy),
      anonymous
        ? h(
            "button",
            { class: "linklike", type: "button", disabled: busy, onclick: signInExisting },
            "I already saved an account on another device",
          )
        : null,
      personalize,
      h("p", { class: "fineprint" }, "We only use Google to recognise you. Nobody else sees your name or email."),
    );
  }

  // ---- personalization -----------------------------------------------------------------

  function renderPersonalize() {
    const current = state.profile ?? { name: null, emoji: null };
    draft ??= {
      name: current.name ?? "",
      emoji: current.emoji ?? null,
      title: current.title ?? null,
      frame: current.frame ?? null,
      bio: current.bio ?? "",
      sn: current.sn ?? "",
      cy: current.cy ?? null,
      snPub: !!current.snPub,
    };
    const generated = displayName(state.uid ?? "", null);

    const preview = h("p", { class: "preview" });
    const problem = h("p", { class: "problem", "aria-live": "polite" });
    const saveBtn = h("button", { class: "btn primary", type: "button", onclick: onSave }, "Save profile");
    const input = h("input", {
      type: "text",
      maxlength: 20,
      autocomplete: "off",
      spellcheck: "false",
      placeholder: state.uid ? generated : "Choose a username",
      "aria-label": "Username",
      oninput: (e) => {
        draft.name = e.target.value;
        refresh();
      },
    });
    input.value = draft.name;

    const bioNote = h("p", { class: "hint", "aria-live": "polite" });
    const bioInput = h("input", {
      type: "text",
      maxlength: BIO_MAX,
      autocomplete: "off",
      placeholder: "A line about you",
      "aria-label": "Short description",
      oninput: (e) => {
        draft.bio = e.target.value;
        refresh();
      },
    });
    bioInput.value = draft.bio;

    const snProblemEl = h("p", { class: "problem", "aria-live": "polite" });
    const snInput = h("input", {
      type: "text",
      maxlength: 12,
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "s123456",
      "aria-label": "Student number",
      oninput: (e) => {
        draft.sn = e.target.value;
        refresh();
      },
    });
    snInput.value = draft.sn;
    const snPubInput = h("input", {
      type: "checkbox",
      onchange: (e) => {
        draft.snPub = e.target.checked;
        refresh();
      },
    });
    snPubInput.checked = draft.snPub;

    const cyInput = h(
      "select",
      {
        "aria-label": "Class of",
        onchange: (e) => {
          draft.cy = e.target.value ? Number(e.target.value) : null;
          refresh();
        },
      },
      h("option", { value: "" }, "Not shown"),
      [...new Set([...classYearOptions(), ...(draft.cy ? [draft.cy] : [])])].sort().map((y) => h("option", { value: String(y) }, `Class of ${y}`)),
    );
    cyInput.value = draft.cy ? String(draft.cy) : "";

    const titleRow = h(
      "div",
      { class: "title-picker", role: "group", "aria-label": "Title" },
      Object.entries(TITLES).map(([key, t]) =>
        h(
          "button",
          {
            class: `title-opt ${draft.title === key ? "picked" : ""}`,
            type: "button",
            "aria-pressed": String(draft.title === key),
            "data-title": key,
            onclick: () => {
              draft.title = draft.title === key ? null : key; // tap again to go back to plain "Royal"
              [...titleRow.children].forEach((b) => {
                const on = b.dataset.title === draft.title;
                b.classList.toggle("picked", on);
                b.setAttribute("aria-pressed", String(on));
              });
              refresh();
            },
          },
          `${t.icon} ${t.label}`,
        ),
      ),
    );

    const grid = h(
      "div",
      { class: "avatar-grid", role: "group", "aria-label": "Avatar" },
      AVATARS.map((a) =>
        h(
          "button",
          {
            class: `avatar-option ${draft.emoji === a.id ? "picked" : ""}`,
            type: "button",
            "aria-label": a.name,
            "aria-pressed": String(draft.emoji === a.id),
            "data-avatar": a.id,
            onclick: () => {
              draft.emoji = draft.emoji === a.id ? null : a.id;
              [...grid.children].forEach((b) => {
                const on = b.dataset.avatar === draft.emoji;
                b.classList.toggle("picked", on);
                b.setAttribute("aria-pressed", String(on));
              });
              refresh();
            },
          },
          avatarBadge({ emoji: a.id }),
        ),
      ),
    );

    const frameGrid = h(
      "div",
      { class: "frame-grid", role: "group", "aria-label": "Avatar frame" },
      FRAMES.map((f) => h(
        "button",
        {
          class: `frame-option ${draft.frame === f.id ? "picked" : ""}`,
          type: "button",
          "aria-label": f.id ? `${f.name} frame` : f.name,
          "aria-pressed": String(draft.frame === f.id),
          "data-frame": f.id ?? "",
          onclick: () => {
            draft.frame = f.id;
            [...frameGrid.children].forEach((b) => {
              const on = b.dataset.frame === (draft.frame ?? "");
              b.classList.toggle("picked", on);
              b.setAttribute("aria-pressed", String(on));
            });
            refresh();
          },
        },
        avatarBadge({ ...draft, frame: f.id }),
        h("span", null, f.name),
      )),
    );

    function refresh() {
      const bad = nameProblem(draft.name);
      problem.textContent = bad ?? "";
      const badBio = bioProblem(draft.bio);
      bioNote.textContent = badBio ?? `${[...draft.bio.trim()].length}/${BIO_MAX}`;
      bioNote.className = badBio ? "problem" : "hint";
      const badSn = studentNumberProblem(draft.sn);
      snProblemEl.textContent = badSn ?? "";
      snPubInput.disabled = !draft.sn.trim();
      const shown = draft.name.trim() || generated;
      const shownProfile = { ...draft, photoURL: state.account?.anonymous ? null : state.account?.photoURL };
      replaceChildren(preview, avatarBadge(shownProfile, { size: "big" }), h("strong", null, shown), h("span", null, `${titleLabel(draft.title)} · Your verdicts are signed with this profile`));
      [...frameGrid.children].forEach((b) => b.replaceChild(avatarBadge({ ...shownProfile, frame: b.dataset.frame || null }), b.firstChild));
      const clean = (v) => (v ?? "").trim() || null;
      const changed =
        (draft.name.trim() || null) !== (current.name ?? null) ||
        (draft.emoji ?? null) !== (current.emoji ?? null) ||
        (draft.title ?? null) !== (current.title ?? null) ||
        (draft.frame ?? null) !== (current.frame ?? null) ||
        clean(draft.bio) !== clean(current.bio) ||
        clean(draft.sn) !== clean(current.sn) ||
        (draft.cy ?? null) !== (current.cy ?? null) ||
        (!!clean(draft.sn) && draft.snPub) !== !!current.snPub;
      saveBtn.disabled = busy || !!bad || !!badBio || !!badSn || !changed;
    }

    function onSave() {
      run(
        async () => {
          const sn = draft.sn.trim() || null;
          await updateProfile({
            name: draft.name.trim() || null,
            emoji: draft.emoji,
            title: draft.title,
            frame: draft.frame,
            bio: draft.bio.trim() || null,
            cy: draft.cy ?? null,
            sn,
            snPub: !!sn && draft.snPub,
          });
          toast("Decree sealed ✓");
          view = "main";
          draft = null;
        },
        (e) => (e?.code === "permission-denied" ? "Couldn't save this profile. Check your selections and try again." : errorMessage(e)),
      );
    }

    replaceChildren(
      card,
      h(
        "div",
        { class: "modal-head" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Back", onclick: () => ((view = "main"), (draft = null), render()) }, "←"),
        h("h2", null, "Your court profile"),
        closeButton(),
      ),
      h("label", { class: "field" }, h("span", null, "Username"), input, problem),
      h("button", { class: "linklike", type: "button", onclick: () => ((draft.name = ""), (input.value = ""), refresh()) }, "Use my royal name"),
      h("div", { class: "field" }, h("span", null, "Title"), titleRow, h("span", { class: "hint" }, "Shown on the Royals leaderboard. Tap again to go back to plain “Royal”.")),
      h("label", { class: "field" }, h("span", null, "About you"), bioInput, bioNote),
      h("label", { class: "field" }, h("span", null, "Class"), cyInput, h("span", { class: "hint" }, "Optional. Shown as a “Class of” badge on your profile.")),
      h(
        "div",
        { class: "field" },
        h("label", { class: "field" }, h("span", null, "Student number"), snInput, snProblemEl),
        h("label", { class: "check" }, snPubInput, h("span", null, "Show it on my public profile")),
        h("span", { class: "hint" }, "Always visible to you in My court. Anyone who opens your profile from the leaderboard can see it only if you tick this."),
      ),
      h("div", { class: "field" }, h("span", null, "Royal portrait"), grid, h("span", { class: "hint" }, "Fictional royals in culturally inspired regalia. Tap your selection again to use the default.")),
      h("div", { class: "field" }, h("span", null, "Portrait frame"), frameGrid, h("span", { class: "hint" }, "Your choice appears on your profile and verdicts. Podiums use gold, silver and bronze instead.")),
      preview,
      saveBtn,
    );
    refresh();
  }

  // ---- the top-right button -----------------------------------------------------------

  const sync = () => {
    const a = state.account;
    replaceChildren(avatar, avatarFor(a, "small"));
    avatar.classList.toggle("needs-save", !!a?.anonymous); // dot: reviews not saved to an account yet
    if (!overlay.hidden && !busy && view === "main") render();
  };
  subscribe(sync);
  sync();

  document.body.append(overlay);
  return { button: avatar, open };
}

/** Chosen portrait, else the Google photo or a default royal, with the saved frame. */
function avatarFor(account, size) {
  return avatarBadge({ ...state.profile, photoURL: account?.anonymous ? null : account?.photoURL }, { size });
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
