// Detail view of one toilet: score, availability, check-in/out, review form, reviews.
import { fetchReviews, MAX_TEXT_LENGTH } from "./api.js";
import { avatarBadge, commentVictoryFrame } from "./avatars.js";
import { endVisit, errorMessage, hasLiked, loadMyReview, startVisit, submitReview, toggleLike } from "./actions.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren, toast } from "./dom.js";
import { timeAgo } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { displayName } from "./profile.js";
import { categoryScores, formatScore, overallScore, reviewScore, scoreColor } from "./scoring.js";
import { UNRATED_COLOR, tierFor } from "./tiers.js";
import { db } from "./firebase.js";
import { shouldPromptSave, snoozeSavePrompt } from "./account-ui.js";
import { occupancy, state } from "./store.js";
import { ThroningCooldownError } from "./throning-limit.js";

const CATEGORIES = [
  { key: "p", name: "Privacy", icon: "🚪", hint: "Walls, lock, gaps, who can hear you" },
  { key: "c", name: "Cleanliness", icon: "✨", hint: "Floor, seat, smell, paper" },
  { key: "k", name: "Comfort", icon: "🛋️", hint: "Space, temperature, seat, vibes" },
];

// Reviews already loaded this session, so reopening a toilet costs no reads.
const reviewCache = new Map(); // id -> {list, cursor, done}

export function createDetail({ onClose, onSaveAccount, onCelebrate, onThroningBlocked }) {
  const el = h("div", { class: "detail" });
  const head = h("div", { class: "detail-head" });
  const summary = h("div", { class: "summary" });
  const actions = h("div", { class: "actions" });
  const formBox = h("div", { class: "form-box" });
  const reviewsBox = h("div", { class: "reviews" });
  el.append(head, summary, actions, formBox, reviewsBox);

  let toilet = null;
  let busy = false;
  let formOpen = false;

  // ---- top part: re-rendered whenever stats / live / check-in change -----------------

  function renderHead() {
    replaceChildren(
      head,
      h(
        "div",
        { class: "titles" },
        h("h2", null, toiletTitle(toilet)),
        h("p", null, toiletPlace(toilet)),
      ),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: onClose }, "✕"),
    );
  }

  function renderSummary() {
    const e = state.stats[toilet.id];
    const score = overallScore(e);
    const cats = categoryScores(e);
    const tier = tierFor(score);
    replaceChildren(
      summary,
      h(
        "div",
        { class: "score-card" },
        tier
          ? h("img", { class: "tier-hero", src: tier.image, alt: tier.name, width: 104, height: 104 })
          : h("div", { class: "big-score", style: `background:${UNRATED_COLOR}` }, "–"),
        h(
          "div",
          { class: "score-meta" },
          h("strong", { class: "tier-name" }, tier ? tier.name : "Awaiting judgement"),
          tier ? h("span", { class: "tier-level", style: `color:${tier.color}` }, tier.tagline) : null,
          h(
            "span",
            null,
            tier
              ? [h("b", { class: "score-pill", style: `background:${tier.color}` }, formatScore(score)), ` from ${e.n} review${e.n === 1 ? "" : "s"}`]
              : "No verdicts yet",
          ),
          h("span", null, `Sat upon ${e?.v ?? 0} time${e?.v === 1 ? "" : "s"}`),
          e?.l
            ? h("span", { class: "last-claim" }, `Last claimed by ${displayName(e.l.u, e.l.n)} · ${timeAgo(e.l.at)}`)
            : null,
        ),
      ),
      h(
        "div",
        { class: "bars" },
        CATEGORIES.map((c) => {
          const v = cats ? { p: cats.privacy, c: cats.cleanliness, k: cats.comfort }[c.key] : null;
          return h(
            "div",
            { class: "bar-row" },
            h("span", { class: "bar-name" }, `${c.icon} ${c.name}`),
            h("span", { class: "bar" }, h("span", { class: "bar-fill", style: `width:${v ? v * 10 : 0}%;background:${scoreColor(v)}` })),
            h("span", { class: "bar-val" }, formatScore(v)),
          );
        }),
      ),
    );
  }

  function renderActions() {
    const occ = occupancy(toilet.id);
    const mine = state.checkIn?.id === toilet.id;
    const elsewhere = state.checkIn && !mine;

    // Checking in is optional (people mostly just review afterwards), so the neutral state
    // is "nobody has checked in", not "free".
    const status = mine
      ? h("p", { class: "status mine" }, "👑 You hold the throne. It's released by itself after 10 min.")
      : occ
        ? h("p", { class: "status busy" }, `🔴 Occupied · vacant in about ${occ.minutesLeft} min`)
        : h("p", { class: "status idle" }, "No royal has checked in here");

    const enterButton = (cls) =>
      h(
        "button",
        {
          class: `btn ${cls}`,
          type: "button",
          disabled: busy || !!occ,
          title: "Optional: lets other royals see that this throne is taken",
          onclick: enter,
        },
        elsewhere ? "Move to this throne" : "Take the throne",
      );

    const buttons = mine
      ? [
          h("button", { class: "btn primary", type: "button", disabled: busy, onclick: finish }, "Rise ✓"),
          h("button", { class: "btn ghost", type: "button", disabled: busy, onclick: cancel }, "Cancel"),
          reviewButton("secondary"),
        ]
      : [reviewButton("primary"), enterButton(formOpen ? "primary" : "secondary")];

    replaceChildren(actions, status, h("div", { class: "btn-row" }, buttons));
  }

  function reviewButton(cls) {
    if (formOpen) return null;
    const mineReview = state.myReviews.get(toilet.id);
    return h(
      "button",
      { class: `btn ${cls}`, type: "button", onclick: () => openForm() },
      mineReview ? "Amend your verdict" : "Pass your verdict",
    );
  }

  let renderedKey; // the reviews list labels "(you)" and shows your name: redraw when the user or profile changes

  function render() {
    if (!toilet) return;
    renderSummary();
    renderActions();
    const key = `${state.uid}|${state.profile?.name}|${state.profile?.emoji}|${state.profile?.frame}|${Object.keys(state.profile?.lk ?? {}).length}`;
    if (renderedKey !== key) {
      renderedKey = key;
      renderReviews();
    }
    // The prompt disappears by itself once the account has been saved.
    if (!state.account?.anonymous) formBox.querySelector(".save-prompt")?.remove();
  }

  /** Right after a review is the moment people care about not losing it. */
  function showSavePrompt() {
    if (!shouldPromptSave()) return;
    replaceChildren(
      formBox,
      h(
        "div",
        { class: "save-prompt" },
        h("strong", null, "💾 Safeguard your legacy"),
        h("p", null, "Your verdicts are bound to this browser for now. Save your account with Google and your reign follows you to any phone."),
        h(
          "div",
          { class: "btn-row" },
          h("button", { class: "btn primary", type: "button", onclick: () => onSaveAccount() }, "Save my account"),
          h(
            "button",
            {
              class: "btn ghost",
              type: "button",
              onclick: () => {
                snoozeSavePrompt();
                replaceChildren(formBox);
              },
            },
            "Later",
          ),
        ),
      ),
    );
  }

  // ---- actions ------------------------------------------------------------------------

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    renderActions();
    try {
      await fn();
    } catch (e) {
      console.warn(e);
      if (e instanceof ThroningCooldownError) onThroningBlocked(e.remainingMs);
      else toast(errorMessage(e));
    } finally {
      busy = false;
      render();
    }
  }

  const enter = () =>
    guarded(async () => {
      if (state.checkIn && state.checkIn.id !== toilet.id) await endVisit(state.checkIn.id, { cancel: true });
      await startVisit(toilet.id);
    });

  const cancel = () => guarded(() => endVisit(toilet.id, { cancel: true }));

  const finish = () =>
    guarded(async () => {
      const loggedToilet = toilet;
      const counted = await endVisit(toilet.id);
      if (counted) onCelebrate({ kind: "session", toilet: loggedToilet });
      else toast("No new audience counted. Visits under 25 s or expired check-ins don't count.");
      if (toilet?.id === loggedToilet.id) openForm({ visitCounted: counted });
    });

  // ---- review form ----------------------------------------------------------------------

  async function openForm({ visitCounted = false } = {}) {
    formOpen = true;
    renderActions();
    const id = toilet.id;
    replaceChildren(formBox, h("p", { class: "muted" }, "…"));
    let previous = null;
    try {
      previous = await loadMyReview(id);
    } catch (e) {
      console.warn(e);
    }
    if (!toilet || toilet.id !== id) return; // user navigated away meanwhile
    buildForm(previous, visitCounted);
    formBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeForm() {
    formOpen = false;
    replaceChildren(formBox);
    renderActions();
  }

  function buildForm(previous, visitCounted) {
    const values = { p: previous?.p ?? 7, c: previous?.c ?? 7, k: previous?.k ?? 7 };
    const overall = h("strong", null);
    const refreshOverall = () => (overall.textContent = ((values.p + values.c + values.k) / 3).toFixed(1));

    const sliders = CATEGORIES.map((c) => {
      const out = h("output", null, String(values[c.key]));
      const input = h("input", {
        type: "range",
        min: 1,
        max: 10,
        step: 1,
        value: values[c.key],
        "aria-label": c.name,
        oninput: (ev) => {
          values[c.key] = Number(ev.target.value);
          out.textContent = String(values[c.key]);
          refreshOverall();
        },
      });
      return h(
        "label",
        { class: "slider" },
        h("span", { class: "slider-top" }, h("span", null, `${c.icon} ${c.name}`), out),
        input,
        h("span", { class: "hint" }, c.hint),
      );
    });
    refreshOverall();

    const counter = h("span", { class: "counter" }, `${(previous?.text ?? "").length}/${MAX_TEXT_LENGTH}`);
    const text = h("textarea", {
      rows: 3,
      maxlength: MAX_TEXT_LENGTH,
      placeholder: "Anything the next royal should know? (optional)",
      oninput: (ev) => (counter.textContent = `${ev.target.value.length}/${MAX_TEXT_LENGTH}`),
    });
    text.value = previous?.text ?? "";

    // A review is also the easiest way to log a visit. Not offered when the check-out just counted one.
    const visit = h("input", { type: "checkbox", checked: !previous });
    const visitRow = visitCounted || previous
      ? null
      : h("label", { class: "check" }, visit, h("span", null, "I sat on this throne (adds to its count)"));

    const submit = h("button", { class: "btn primary", type: "submit" }, previous ? "Update verdict" : "Deliver verdict");
    const form = h(
      "form",
      {
        class: "review-form",
        onsubmit: async (ev) => {
          ev.preventDefault();
          submit.disabled = true;
          const id = toilet.id;
          const reviewedToilet = toilet;
          const countVisit = !visitCounted && !previous && visit.checked;
          try {
            await submitReview(id, { ...values, text: text.value, countVisit });
          } catch (e) {
            console.warn(e);
            if (e instanceof ThroningCooldownError) onThroningBlocked(e.remainingMs);
            else toast(errorMessage(e));
            submit.disabled = false;
            return;
          }
          upsertCachedReview(id);
          if (toilet?.id === id) {
            closeForm();
            renderReviews();
            render();
            showSavePrompt();
          }
          onCelebrate({ kind: countVisit ? "session-review" : "review", toilet: reviewedToilet, amended: !!previous });
        },
      },
      h("h3", null, previous ? "Amend your verdict" : "Your verdict"),
      sliders,
      h("div", { class: "overall" }, "Royal rating ", overall, " / 10"),
      h("div", { class: "text-wrap" }, text, counter),
      visitRow,
      h(
        "div",
        { class: "btn-row" },
        submit,
        h("button", { class: "btn ghost", type: "button", onclick: closeForm }, "Not now"),
      ),
    );
    replaceChildren(formBox, form);
  }

  // ---- reviews list ---------------------------------------------------------------------

  function upsertCachedReview(id) {
    const cache = reviewCache.get(id);
    const mineReview = state.myReviews.get(id);
    if (!cache || !mineReview) return;
    const i = cache.list.findIndex((r) => r.uid === mineReview.uid);
    if (i >= 0) cache.list[i] = mineReview;
    else cache.list.unshift(mineReview);
  }

  async function loadMore() {
    const id = toilet.id;
    let cache = reviewCache.get(id);
    if (!cache) reviewCache.set(id, (cache = { list: [], cursor: null, done: false }));
    const page = await fetchReviews(db, CAMPUS.id, id, cache.cursor);
    cache.list.push(...page.reviews.filter((r) => !cache.list.some((x) => x.uid === r.uid)));
    cache.cursor = page.cursor;
    cache.done = page.done;
  }

  function renderReviews(error = false) {
    const cache = reviewCache.get(toilet.id);
    if (error) {
      replaceChildren(reviewsBox, h("p", { class: "muted" }, "The archives are out of reach."), loadButton("Retry"));
      return;
    }
    if (!cache) {
      replaceChildren(reviewsBox, h("p", { class: "muted" }, "Consulting the archives…"));
      return;
    }
    replaceChildren(
      reviewsBox,
      h("h3", { class: "rule" }, "Verdicts of the court"),
      cache.list.length ? cache.list.map(reviewCard) : h("p", { class: "muted" }, "The court has yet to pass judgement on this throne."),
      cache.done ? null : loadButton("Show more"),
    );
  }

  function loadButton(label) {
    return h(
      "button",
      {
        class: "btn ghost",
        type: "button",
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try {
            await loadMore();
            renderReviews();
          } catch (e) {
            console.warn(e);
            renderReviews(true);
          }
        },
      },
      label,
    );
  }

  function reviewCard(card) {
    const mineCard = card.uid === state.uid;
    const victoryFrame = commentVictoryFrame(card.likes);
    // Your own reviews always show your current profile; other people's show what they chose when they posted.
    const r = {
      ...card,
      name: displayName(card.uid, mineCard && state.profile ? state.profile.name : card.by),
      emoji: mineCard && state.profile ? state.profile.emoji : card.em,
      frame: mineCard && state.profile ? state.profile.frame : card.fr,
    };
    return h(
      "article",
      {
        class: `review${victoryFrame ? ` review-victory-${victoryFrame.id}` : ""}`,
        "aria-label": victoryFrame ? `${victoryFrame.name}, ${card.likes} likes` : null,
      },
      victoryFrame
        ? h("span", { class: "review-victory-label", "aria-hidden": "true" }, victoryFrame.name)
        : null,
      h(
        "header",
        null,
        h("strong", { class: "review-author" }, avatarBadge(r, { size: "mini" }), h("span", null, r.name, mineCard ? " (you)" : "")),
        h("span", { class: "muted" }, timeAgo(r.createdMs)),
        h("span", { class: "chip", style: `background:${scoreColor(reviewScore(r))}` }, formatScore(reviewScore(r))),
      ),
      h("p", { class: "review-scores" }, `🚪 ${r.p}  ✨ ${r.c}  🛋️ ${r.k}`),
      r.text ? h("p", { class: "review-text" }, r.text) : null,
      likeControl(card, mineCard),
    );
  }

  // ---- likes ----------------------------------------------------------------------------------

  const liking = new Set(); // reviews whose like is being saved (ignore double taps)

  /** A heart with a small counter. You can't like your own review: it just shows its count. */
  function likeControl(card, mineCard) {
    const n = card.likes ?? 0;
    if (mineCard) return n ? h("footer", { class: "review-foot" }, h("span", { class: "like static" }, "♥", h("span", { class: "like-n" }, String(n)))) : null;
    const liked = hasLiked(toilet.id, card.uid);
    return h(
      "footer",
      { class: "review-foot" },
      h(
        "button",
        {
          class: `like ${liked ? "on" : ""}`,
          type: "button",
          "aria-pressed": liked,
          "aria-label": liked ? "Remove your like" : "Like this review",
          onclick: () => onLike(card),
        },
        liked ? "♥" : "♡",
        n ? h("span", { class: "like-n" }, String(n)) : null,
      ),
    );
  }

  async function onLike(card) {
    if (liking.has(card.uid)) return;
    liking.add(card.uid);
    const id = toilet.id;
    try {
      const { delta } = await toggleLike(id, card);
      const entry = reviewCache.get(id)?.list.find((x) => x.uid === card.uid);
      if (entry) entry.likes = Math.max(0, (entry.likes ?? 0) + delta);
    } catch (e) {
      console.warn(e);
      toast(errorMessage(e));
    } finally {
      liking.delete(card.uid);
      if (toilet?.id === id) renderReviews();
    }
  }

  // ---- public API ---------------------------------------------------------------------

  async function open(t) {
    toilet = t;
    busy = false;
    formOpen = false;
    replaceChildren(formBox);
    renderHead();
    render();
    renderReviews();
    el.scrollTop = 0;
    // Reviews are fetched only now, when someone actually opens a toilet.
    if (!reviewCache.get(t.id)) {
      try {
        await loadMore();
      } catch (e) {
        console.warn(e);
        if (toilet?.id === t.id) renderReviews(true);
        return;
      }
    }
    if (toilet?.id === t.id) renderReviews();
  }

  function close() {
    toilet = null;
  }

  return { el, open, close, render, review: openForm, get toiletId() { return toilet?.id ?? null; } };
}
