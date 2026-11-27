// The trophy room: three shelves (verdicts, streaks, seasons) drawn from a royal record's trophy fields
// (see trophies.js). Used on "My court" (with the unearned ones shown as empty slots) and on a royal's public
// profile (earned ones only). The art is painted (src/assets/trophies/, 160px webp with transparency, shown at 56px
// so it stays sharp on 3x screens); the three draw functions below (cup, shield, medal) put it on the shelf.
import flushArt from "./assets/board-flush.svg";
import hoppersArt from "./assets/board-hoppers.svg";
import cupBronze from "./assets/trophies/cup-bronze.webp";
import cupGold from "./assets/trophies/cup-gold.webp";
import cupSilver from "./assets/trophies/cup-silver.webp";
import medalBronze from "./assets/trophies/medal-bronze.webp";
import medalGold from "./assets/trophies/medal-gold.webp";
import medalSilver from "./assets/trophies/medal-silver.webp";
import seasonAutumn from "./assets/trophies/season-autumn.webp";
import seasonSpring from "./assets/trophies/season-spring.webp";
import seasonSummer from "./assets/trophies/season-summer.webp";
import seasonWinter from "./assets/trophies/season-winter.webp";
import shieldGold from "./assets/trophies/shield-gold.webp";
import { h } from "./dom.js";
import { LIKE_TROPHIES, seasonBadges } from "./trophies.js";

const METAL_NAME = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
const PLACE_METAL = { 1: "gold", 2: "silver", 3: "bronze" };
const CUP_ART = { gold: cupGold, silver: cupSilver, bronze: cupBronze, locked: cupSilver };
const MEDAL_ART = { gold: medalGold, silver: medalSilver, bronze: medalBronze };
const SEASON_ART = { 1: seasonWinter, 2: seasonSpring, 3: seasonSummer, 4: seasonAutumn };
const BOARD_ART = { sessions: flushArt, explorers: hoppersArt };
const BOARD_NAME = { sessions: "Royal Flush", explorers: "Throne Hoppers" };

const art = (src) => h("img", { class: "trophy-img", src, alt: "", width: 56, height: 56, loading: "lazy", decoding: "async" });

/** A cup, for the verdict trophies: bigger likes, finer metal. */
const cup = (metal) => art(CUP_ART[metal]);

/** A shield, for the streaks; the board's own emblem sits in it and the day count under it. */
function shield(metal, board) {
  return [
    art(shieldGold),
    h("img", { class: `trophy-emblem${metal === "locked" ? " dim" : ""}`, src: BOARD_ART[board], alt: "", width: 24, height: 24 }),
  ];
}

/** A medal in gold, silver or bronze with the board's emblem inside it. */
function medal(metal, board) {
  return [art(MEDAL_ART[metal]), h("img", { class: "trophy-emblem medal-emblem", src: BOARD_ART[board], alt: "", width: 22, height: 22 })];
}

function slot({ art, label, sub, count = null, locked = false, title }) {
  return h(
    "div",
    { class: `trophy${locked ? " locked" : ""}`, title, role: "img", "aria-label": title },
    h("span", { class: "trophy-art" }, art, count != null ? h("span", { class: "trophy-count" }, count) : null),
    label ? h("strong", null, label) : null,
    sub ? h("small", null, sub) : null,
  );
}

const shelf = (title, items, empty, kind = "") =>
  h(
    "section",
    { class: `shelf ${kind}` },
    h("h4", { class: "shelf-title" }, title),
    items.length ? h("div", { class: "shelf-row" }, items) : h("p", { class: "shelf-empty" }, empty),
    h("div", { class: "shelf-plank" }),
  );

function verdictShelf(rec, own) {
  const have = rec?.lt ?? 0;
  const items = LIKE_TROPHIES.filter((t) => own || have >= t.threshold).map((t, i) => {
    const earned = have >= t.threshold;
    const metal = earned ? ["bronze", "silver", "gold"][i] : "locked";
    return slot({ art: cup(metal), label: earned ? t.name : "Unearned", sub: `${t.threshold} likes`, locked: !earned, title: `${t.name}: ${t.caption}` });
  });
  return shelf("Verdicts", items, "No verdict has won the crowd yet.");
}

function streakShelf(rec, own) {
  const st = rec?.st ?? { s: 0, e: 0 };
  const items = ["sessions", "explorers"]
    .map((board) => ({ board, days: board === "sessions" ? st.s : st.e }))
    .filter((x) => own || x.days > 0)
    .map(({ board, days }) =>
      slot({
        art: shield(days > 0 ? "gold" : "locked", board),
        count: days > 0 ? String(days) : null,
        locked: days === 0,
        title: `${BOARD_NAME[board]} streak: ${days} ${days === 1 ? "day" : "days"} on the all-time podium`,
      }),
    );
  return shelf("Hall of Legends streaks", items, "Not in the Hall of Legends yet.", "streaks");
}

function seasonShelf(rec) {
  const seasons = seasonBadges(rec?.wq);
  const groups = seasons.map((s) =>
    h(
      "div",
      { class: "season" },
      h(
        "div",
        { class: "season-head" },
        h("img", { class: "season-art", src: SEASON_ART[s.quarter], alt: "", width: 32, height: 32, loading: "lazy", decoding: "async" }),
        h("span", { class: "season-name" }, `${s.name} ${s.year}`),
      ),
      h(
        "div",
        { class: "shelf-row" },
        // one medal per week won (the row wraps onto more shelves when there are many); no caption: the metal and the
        // emblem say it, and the tooltip / screen-reader label spells it out
        s.badges.flatMap((b) =>
          Array.from({ length: b.count }, () =>
            slot({
              art: medal(PLACE_METAL[b.place], b.board),
              title: `${METAL_NAME[PLACE_METAL[b.place]]} ${BOARD_NAME[b.board]} medal, ${s.name} ${s.year}`,
            }),
          ),
        ),
      ),
    ),
  );
  return h(
    "section",
    { class: "shelf" },
    h("h4", { class: "shelf-title" }, "Seasons of the Court"),
    groups.length ? groups : h("p", { class: "shelf-empty" }, "Finish a week on the podium to win a medal."),
    h("div", { class: "shelf-plank" }),
  );
}

/**
 * The trophy room of the royal record `rec` (null: none yet). `own` shows the unearned trophies as empty slots, so
 * the owner can see what is left to win; other people only see what was earned.
 */
export function trophyRoom(rec, { own = false } = {}) {
  return h("div", { class: "trophy-room" }, verdictShelf(rec, own), streakShelf(rec, own), seasonShelf(rec));
}
