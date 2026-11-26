// Detail view of one toilet: score, availability, check-in/out, review form, reviews.
import { fetchReviews, MAX_TEXT_LENGTH } from "./api.js";
import { endVisit, errorMessage, loadMyReview, startVisit, submitReview } from "./actions.js";
import { CAMPUS } from "./config.js";
import { h, replaceChildren, toast } from "./dom.js";
import { timeAgo } from "./geo.js";
import { toiletPlace, toiletTitle } from "./labels.js";
import { displayName } from "./profile.js";
import { categoryScores, formatScore, overallScore, reviewScore, scoreColor } from "./scoring.js";
import { TIERS, UNRATED_COLOR, tierFor } from "./tiers.js";
import { db } from "./firebase.js";
import { shouldPromptSave, snoozeSavePrompt } from "./account-ui.js";
import { occupancy, state } from "./store.js";

const CATEGORIES = [
  { key: "p", name: "Privacy", icon: "🚪", hint: "Walls, lock, gaps, who can hear you" },
  { key: "c", name: "Cleanliness", icon: "✨", hint: "Floor, seat, smell, paper" },
  { key: "k", name: "Comfort", icon: "🛋️", hint: "Space, temperature, seat, vibes" },
];

// Reviews already loaded this session, so reopening a toilet costs no reads.
const reviewCache = new Map(); // id -> {list, cursor, done}

export function createDetail({ onClose, onSaveAccount }) {
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
          h("strong", { class: "tier-name" }, tier ? tier.name : "Not rated yet"),
          tier ? h("span", { class: "tier-level", style: `color:${tier.color}` }, `Level ${tier.level} of ${TIERS.length} · ${tier.tagline}`) : null,
          h(
            "span",
            null,
            tier
              ? [h("b", { class: "score-pill", style: `background:${tier.color}` }, formatScore(score)), ` from ${e.n} review${e.n === 1 ? "" : "s"}`]
              : "No reviews yet",
          ),
          h("span", null, `Used ${e?.v ?? 0} time${e?.v === 1 ? "" : "s"}`),
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
      ? h("p", { class: "status mine" }, "🚽 You're in here. It frees up by itself after 10 min.")
      : occ
        ? h("p", { class: "status busy" }, `🔴 In use · free in about ${occ.minutesLeft} min`)
        : h("p", { class: "status idle" }, "Nobody has checked in here");

    const enterButton = (cls) =>
      h(
        "button",
        {
          class: `btn ${cls}`,
          type: "button",
          disabled: busy || !!occ,
          title: "Optional: lets others see that this toilet is taken",
          onclick: enter,
        },
        elsewhere ? "Move here, I'm going in" : "I'm going in",
      );

    const buttons = mine
      ? [
          h("button", { class: "btn primary", type: "button", disabled: busy, onclick: finish }, "I'm done ✓"),
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
      mineReview ? "Edit your review" : "Rate this toilet",
    );
  }

  let renderedKey; // the reviews list labels "(you)" and shows your name: redraw when the user or profile changes

  function render() {
    if (!toilet) return;
    renderSummary();
    renderActions();
    const key = `${state.uid}|${state.profile?.name}|${state.profile?.emoji}`;
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
        h("strong", null, "💾 Keep your reviews safe"),
        h("p", null, "They're tied to this browser right now. Save your account with Google and they follow you to any phone."),
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
      toast(errorMessage(e));
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
      const counted = await endVisit(toilet.id);
      toast(counted ? "Visit logged. Hope it went well! 🎉" : "That was quick! Visits under 25 s don't count.");
      openForm({ visitCounted: counted });
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
      placeholder: "Anything the next person should know? (optional)",
      oninput: (ev) => (counter.textContent = `${ev.target.value.length}/${MAX_TEXT_LENGTH}`),
    });
    text.value = previous?.text ?? "";

    // A review is also the easiest way to log a visit. Not offered when the check-out just counted one.
    const visit = h("input", { type: "checkbox", checked: !previous });
    const visitRow = visitCounted
      ? null
      : h("label", { class: "check" }, visit, h("span", null, "I used this toilet (adds to its usage count)"));

    const submit = h("button", { class: "btn primary", type: "submit" }, previous ? "Update review" : "Post review");
    const form = h(
      "form",
      {
        class: "review-form",
        onsubmit: async (ev) => {
          ev.preventDefault();
          submit.disabled = true;
          const id = toilet.id;
          try {
            await submitReview(id, { ...values, text: text.value, countVisit: !visitCounted && visit.checked });
            toast("Thanks! Your review is in 🧻");
            upsertCachedReview(id);
            closeForm();
            renderReviews();
            render();
            showSavePrompt();
          } catch (e) {
            console.warn(e);
            toast(errorMessage(e));
            submit.disabled = false;
          }
        },
      },
      h("h3", null, previous ? "Edit your review" : "How was it?"),
      sliders,
      h("div", { class: "overall" }, "Overall ", overall, " / 10"),
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
      replaceChildren(reviewsBox, h("p", { class: "muted" }, "Couldn't load reviews."), loadButton("Retry"));
      return;
    }
    if (!cache) {
      replaceChildren(reviewsBox, h("p", { class: "muted" }, "Loading reviews…"));
      return;
    }
    replaceChildren(
      reviewsBox,
      h("h3", null, "Reviews"),
      cache.list.length ? cache.list.map(reviewCard) : h("p", { class: "muted" }, "Nobody has reviewed this throne yet."),
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
    // Your own reviews always show your current profile; other people's show what they chose when they posted.
    const r = {
      ...card,
      name: displayName(card.uid, mineCard && state.profile ? state.profile.name : card.by),
      emoji: mineCard && state.profile ? state.profile.emoji : card.em,
    };
    return h(
      "article",
      { class: "review" },
      h(
        "header",
        null,
        h("strong", null, r.emoji ? `${r.emoji} ` : "", r.name, mineCard ? " (you)" : ""),
        h("span", { class: "muted" }, timeAgo(r.createdMs)),
        h("span", { class: "chip", style: `background:${scoreColor(reviewScore(r))}` }, formatScore(reviewScore(r))),
      ),
      h("p", { class: "review-scores" }, `🚪 ${r.p}  ✨ ${r.c}  🛋️ ${r.k}`),
      r.text ? h("p", { class: "review-text" }, r.text) : null,
    );
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

  return { el, open, close, render, get toiletId() { return toilet?.id ?? null; } };
}
