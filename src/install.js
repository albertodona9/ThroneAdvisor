// "Install app" chip. Chrome/Edge/Android fire `beforeinstallprompt`, which we hold on to and
// trigger from our own button. iPhone/iPad Safari has no such API, so we show the
// "Add to Home Screen" steps instead. Nothing is shown once the app is installed (opened
// standalone) and the chip can be dismissed (it comes back after two weeks).
import { h, replaceChildren } from "./dom.js";

const DISMISSED_KEY = "throneadvisor.installDismissedAt";
const SNOOZE_MS = 14 * 24 * 3600 * 1000;

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // we show our own button instead of the browser's mini-infobar
  deferredPrompt = e;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  notify();
});

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function snoozed() {
  return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < SNOOZE_MS;
}

/** "native" (we can trigger the install), "ios" (show the steps) or null (nothing to offer). */
export function installMode() {
  if (isStandalone() || snoozed()) return null;
  if (deferredPrompt) return "native";
  if (isIos()) return "ios";
  return null;
}

export function createInstallChip() {
  const chip = h("div", { class: "chip install", hidden: true });
  const steps = h("div", { class: "modal", hidden: true, onclick: (e) => e.target === steps && (steps.hidden = true) });
  document.body.append(steps);

  async function onInstall() {
    if (installMode() === "native") {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice; // accepted -> `appinstalled` hides the chip; dismissed -> keep it
      deferredPrompt = null;
      sync();
    } else {
      replaceChildren(
        steps,
        h(
          "div",
          { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "Install ThroneAdvisor" },
          h("div", { class: "modal-head" }, h("h2", null, "Install ThroneAdvisor"), h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => (steps.hidden = true) }, "✕")),
          h("ol", { class: "install-steps" },
            h("li", null, "Tap the ", h("strong", null, "Share"), " button (the square with an arrow) in Safari's toolbar."),
            h("li", null, "Scroll down and choose ", h("strong", null, "Add to Home Screen"), "."),
            h("li", null, "Tap ", h("strong", null, "Add"), ". ThroneAdvisor now opens like an app and remembers you for longer."),
          ),
          h("p", { class: "fineprint" }, "This only works in Safari; if you're in another browser, open this page in Safari first."),
        ),
      );
      steps.hidden = false;
    }
  }

  function sync() {
    const mode = installMode();
    chip.hidden = !mode;
    if (!mode) return;
    replaceChildren(
      chip,
      h("button", { class: "install-go", type: "button", onclick: onInstall }, "📲 Install app"),
      h("button", { class: "install-x", type: "button", "aria-label": "Hide", onclick: () => { localStorage.setItem(DISMISSED_KEY, String(Date.now())); sync(); } }, "✕"),
    );
  }

  listeners.add(sync);
  sync();
  return chip;
}
