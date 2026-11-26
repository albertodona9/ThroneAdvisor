// Swipe the bottom list sheet: drag up to expand it, drag down to collapse it. The sheet follows the
// finger and then snaps to the nearer state (or the direction of a quick flick). Touch only, and only
// in the phone layout (on wide screens the list is a side panel). Tapping the handle still toggles it.
//
// What counts as a sheet drag, so it never fights with scrolling the list:
//   - starting on the handle or the tabs row: always
//   - collapsed (the list can't scroll then): from anywhere on the sheet
//   - expanded: only a downward drag while the list is scrolled to its very top
// Anything else is left alone, so the list scrolls normally.

const MOVE_THRESHOLD = 8; // px of movement before a touch becomes a drag
const FLICK_VELOCITY = 0.35; // px per ms: a flick this fast decides the direction on its own
const VELOCITY_WINDOW_MS = 120; // speed is measured over the last stretch before the finger lifts
const SNAP_MS = 220;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where should the sheet settle when the finger lifts? A flick (fast over the last stretch) decides
 * by its direction; otherwise whichever state is nearer to where the sheet was left.
 * `samples` are the touch positions [{y, t}] of the gesture, `height` the sheet's current height.
 */
export function shouldExpand({ height, collapsed, expanded, samples, now }) {
  const recent = samples.filter((p) => now - p.t <= VELOCITY_WINDOW_MS);
  const vy = recent.length >= 2 ? (recent.at(-1).y - recent[0].y) / Math.max(1, recent.at(-1).t - recent[0].t) : 0;
  if (Math.abs(vy) > FLICK_VELOCITY) return vy < 0; // flicked up (negative) expands, down collapses
  return height > (collapsed + expanded) / 2;
}

/** Pixel heights of the two states, read from the CSS variables (they use vh, so they change with the screen). */
function stateHeights() {
  const measure = (value) => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:${value}`;
    document.body.append(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return px;
  };
  return { collapsed: measure("var(--list-collapsed)"), expanded: measure("var(--list-expanded)") };
}

export function enableSheetSwipe({ sheet, list }) {
  const phone = window.matchMedia("(max-width: 819px)");
  let g = null; // the gesture in progress

  sheet.addEventListener(
    "touchstart",
    (e) => {
      if (!phone.matches || sheet.dataset.mode !== "list" || e.touches.length !== 1) return;
      const expanded = sheet.classList.contains("expanded");
      const heights = stateHeights();
      const t = e.touches[0];
      g = {
        x0: t.clientX,
        y0: t.clientY,
        samples: [{ y: t.clientY, t: performance.now() }],
        expanded,
        heights,
        startH: expanded ? heights.expanded : heights.collapsed,
        h: expanded ? heights.expanded : heights.collapsed,
        fromHeader: !!e.target.closest(".handle, .tabs"),
        dragging: false,
      };
    },
    { passive: true },
  );

  sheet.addEventListener(
    "touchmove",
    (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dy = t.clientY - g.y0;
      if (!g.dragging) {
        if (Math.abs(dy) < MOVE_THRESHOLD) return;
        const down = dy > 0;
        const mostlyVertical = Math.abs(dy) > Math.abs(t.clientX - g.x0);
        const allowed = mostlyVertical && (g.fromHeader || !g.expanded || (down && list.scrollTop <= 0));
        if (!allowed) {
          g = null; // not ours: let the browser scroll the list
          return;
        }
        g.dragging = true;
        list.style.transition = "none";
        list.style.overflow = "hidden"; // no inner scrolling while the sheet itself moves
      }
      e.preventDefault(); // stop the page / list from scrolling along
      g.h = clamp(g.startH - dy, g.heights.collapsed, g.heights.expanded);
      list.style.maxHeight = `${g.h}px`;
      g.samples.push({ y: t.clientY, t: performance.now() });
    },
    { passive: false },
  );

  const finish = () => {
    const gesture = g;
    g = null;
    if (!gesture?.dragging) return;
    const { collapsed, expanded } = gesture.heights;
    const expand = shouldExpand({ height: gesture.h, collapsed, expanded, samples: gesture.samples, now: performance.now() });
    list.style.transition = `max-height ${SNAP_MS}ms ease`;
    list.style.maxHeight = `${expand ? expanded : collapsed}px`;
    setTimeout(() => {
      // hand control back to the stylesheet: the class gives exactly the height we animated to
      sheet.classList.toggle("expanded", expand);
      list.style.transition = "";
      list.style.maxHeight = "";
      list.style.overflow = "";
    }, SNAP_MS + 20);
  };
  sheet.addEventListener("touchend", finish);
  sheet.addEventListener("touchcancel", finish);
}
