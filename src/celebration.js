import { avatarBadge } from "./avatars.js";
import { h, replaceChildren } from "./dom.js";
import { toiletTitle } from "./labels.js";
import { state } from "./store.js";
import { cooldownLabel } from "./throning-limit.js";

const COPY = {
  session: {
    title: "A royal relief!",
    messages: [
      "The kingdom breathes easier. Your noble sitting has been entered in the annals!",
      "Another successful audience! The throne is relieved of its duties. As are you.",
      "Sound the trumpets! Your contribution to the royal flush shall not be forgotten.",
    ],
  },
  "session-review": {
    title: "Relief AND a royal decree!",
    messages: [
      "An audience held and a verdict delivered. Truly, a monarch who finishes the paperwork.",
      "You came, you sat, you rated. The royal scribes salute your thoroughness!",
      "One noble sitting, one mighty opinion. The kingdom has never been so well informed.",
    ],
  },
  review: {
    title: "Your decree has been delivered!",
    messages: [
      "The scribes have filed your verdict. Finally, an opinion worth the parchment it is written on.",
      "Hear ye! Your wisdom now guides the next royal in search of a worthy throne.",
      "Your verdict is in the royal archives. Historians will call this a moving contribution.",
    ],
  },
};

export function celebrationCopy(kind, { amended = false, sequence = 0 } = {}) {
  const copy = COPY[kind];
  if (!copy) throw new Error(`Unknown celebration: ${kind}`);
  return {
    title: kind === "review" && amended ? "Royal decree amended!" : copy.title,
    message: copy.messages[sequence % copy.messages.length],
  };
}

function trumpet(side) {
  const el = h("span", { class: `celebration-trumpet ${side}`, "aria-hidden": "true" });
  el.innerHTML = `<svg viewBox="0 0 140 120" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M55 50H122V60H55L18 80V30Z" fill="#e6c97a" stroke="#91631d" stroke-width="3"/>
    <ellipse cx="18" cy="55" rx="9" ry="26" fill="#b8892b" stroke="#91631d" stroke-width="3"/>
    <ellipse cx="18" cy="55" rx="4" ry="17" fill="#55321d"/>
    <path d="M63 60V82C63 98 103 98 103 82V60" stroke="#91631d" stroke-width="12"/>
    <path d="M63 60V82C63 98 103 98 103 82V60" stroke="#e6c97a" stroke-width="7"/>
    <path d="M76 61H108V113L92 103L76 113Z" fill="#6d1f3a" stroke="#b8892b" stroke-width="2"/>
    <path d="M92 74L95 82L104 82L97 88L100 97L92 92L84 97L87 88L80 82L89 82Z" fill="#e6c97a"/>
    <path d="M121 47H133V63H121Z" fill="#e6c97a" stroke="#91631d" stroke-width="3"/>
    <path d="M29 45L49 51M61 53H115" stroke="#fff2b7" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
  return el;
}

export function createCelebration({ audio }) {
  let sequence = 0;
  let previousFocus = null;
  let background = [];
  const card = h("div", { class: "modal-card celebration-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "celebration-title" });
  const stage = h("div", { class: "celebration-stage" }, trumpet("left"), card, trumpet("right"));
  const confetti = h("div", { class: "court-confetti", "aria-hidden": "true" });
  const overlay = h("div", { class: "modal celebration", hidden: true, onclick: (e) => e.target === overlay && close() }, confetti, stage);
  document.body.append(overlay);

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    audio.stopFanfare();
    replaceChildren(confetti);
    for (const { el, inert } of background) el.inert = inert;
    background = [];
    const target = previousFocus?.isConnected && previousFocus.getClientRects().length
      ? previousFocus : document.querySelector(".account-btn");
    target?.focus();
  }

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const buttons = [...card.querySelectorAll("button:not([disabled])")];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  function show({ kind, toilet, amended = false, detail = "", onReview = null }) {
    const copy = celebrationCopy(kind, { amended, sequence: sequence++ });
    if (!overlay.hidden) close();
    previousFocus = document.activeElement;
    background = [...document.querySelectorAll("#app, #map, body > .modal")]
      .filter((el) => el !== overlay)
      .map((el) => ({ el, inert: el.inert }));
    for (const { el } of background) el.inert = true;
    const closeBtn = h("button", { class: "icon-btn celebration-close", type: "button", "aria-label": "Close celebration", onclick: close }, "✕");
    replaceChildren(
      card,
      closeBtn,
      h("p", { class: "celebration-herald" }, "Hear ye, hear ye!"),
      avatarBadge(state.profile ?? {}, { size: "big" }),
      h("h2", { id: "celebration-title" }, copy.title),
      h("p", { class: "celebration-message" }, copy.message),
      h("p", { class: "celebration-record" }, kind === "review" ? "Verdict sealed" : kind === "session-review" ? "+1 audience · Verdict sealed" : "+1 audience", toilet ? ` · ${toiletTitle(toilet)}` : ""),
      detail ? h("p", { class: "fineprint" }, detail) : null,
      h(
        "div", { class: "celebration-actions" },
        onReview ? h("button", { class: "btn primary", type: "button", onclick: () => { close(); onReview(); } }, "Pass your verdict") : null,
        h("button", { class: `btn ${onReview ? "ghost" : "primary"}`, type: "button", onclick: close }, "Long may I reign!"),
      ),
    );
    replaceChildren(confetti, Array.from({ length: 36 }, (_, i) => h("span", {
      class: `court-confetti-piece ${i % 3 === 0 ? "star" : ""}`,
      style: `--x:${(i * 37) % 100}%;--delay:${(i % 9) * 0.09}s;--drift:${(i % 7 - 3) * 26}px;--color:${["#e6c97a", "#6d1f3a", "#a884bf", "#fbf6ea"][i % 4]}`,
    })));
    overlay.hidden = false;
    closeBtn.focus();
    void audio.fanfare();
  }

  function tooSoon(remainingMs) {
    if (!overlay.hidden) close();
    previousFocus = document.activeElement;
    background = [...document.querySelectorAll("#app, #map, body > .modal")]
      .filter((el) => el !== overlay)
      .map((el) => ({ el, inert: el.inert }));
    for (const { el } of background) el.inert = true;
    const closeBtn = h("button", { class: "icon-btn celebration-close", type: "button", "aria-label": "Close", onclick: close }, "✕");
    replaceChildren(
      card,
      closeBtn,
      h("div", { class: "kingdom-clown", "aria-hidden": "true" }, h("span", { class: "kingdom-clown-crown" }, "♛"), "🤡"),
      h("h2", { id: "celebration-title" }, "There is no way you are so stinky."),
      h("p", { class: "celebration-message" }, "The court allows only one logged throning every 30 minutes."),
      h("p", { class: "celebration-record" }, `The royal chamber reopens in ${cooldownLabel(remainingMs)}.`),
      h("div", { class: "celebration-actions" }, h("button", { class: "btn primary", type: "button", onclick: close }, "My apologies, court")),
    );
    replaceChildren(confetti);
    overlay.hidden = false;
    closeBtn.focus();
  }

  return { show, tooSoon, close };
}
