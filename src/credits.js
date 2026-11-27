// "About" pop-up, opened by tapping the ThroneAdvisor pill.
import { h } from "./dom.js";

export const REPO_URL = "https://github.com/albertodona9/ThroneAdvisor";

export function createCredits() {
  const card = h(
    "div",
    { class: "modal-card credits", role: "dialog", "aria-modal": "true", "aria-label": "About ThroneAdvisor" },
    h("button", { class: "icon-btn credits-close", type: "button", "aria-label": "Close", onclick: close }, "✕"),
    h("img", { class: "credits-logo", src: "/android-chrome-192x192.png", alt: "", width: 96, height: 96 }),
    h("h2", null, "ThroneAdvisor"),
    h("p", { class: "credits-tag" }, "Rating the thrones of the realm"),
    h("p", { class: "credits-love" }, "Made with love by a fellow DTU student and his loyal horse Claude 🐴"),
    h("p", null, "ThroneAdvisor is open source (MIT licence). Take a look under the hood, report a problem or send an improvement:"),
    h("a", { class: "btn secondary credits-link", href: REPO_URL, target: "_blank", rel: "noopener noreferrer" }, "View the code on GitHub ↗"),
    h("p", { class: "fineprint" }, "Indoor maps and toilet locations by MazeMap."),
  );
  const overlay = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === overlay && close() }, card);
  document.body.append(overlay);
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());

  function open() {
    overlay.hidden = false;
  }
  function close() {
    overlay.hidden = true;
  }
  return { open, close };
}
