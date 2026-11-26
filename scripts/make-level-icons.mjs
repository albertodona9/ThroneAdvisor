// Turns the source art in art/levels/level_N.png (large transparent canvases, 1408x768, with the
// throne somewhere in the middle) into the small icons the app ships: src/assets/levels/level-N.webp.
// For each image: crop to the artwork's bounding box (+ a little air), centre it on a square
// transparent canvas, scale to SIZE px and save as WebP with alpha.
//   npm i --no-save playwright-core && node scripts/make-level-icons.mjs
// (uses the Chrome/Edge already installed on the machine as the image tool.) Re-run if the art changes.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => {
  console.error("Needs playwright-core: npm i --no-save playwright-core");
  process.exit(1);
});

const LEVELS = 5;
const SIZE = 256; // shown at ~48px in lists and ~110px in the detail view, so this covers 2x-3x screens
const PADDING = 0.04; // empty margin around the artwork, as a share of the square
const QUALITY = 0.9;
const ALPHA_THRESHOLD = 24; // ignore near-invisible fringe pixels when measuring the artwork

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await mkdir("src/assets/levels", { recursive: true });

for (let n = 1; n <= LEVELS; n++) {
  const src = `data:image/png;base64,${(await readFile(`art/levels/level_${n}.png`)).toString("base64")}`;
  const { webp, box } = await page.evaluate(
    async ({ src, SIZE, PADDING, QUALITY, ALPHA_THRESHOLD }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const probe = document.createElement("canvas");
      probe.width = img.width;
      probe.height = img.height;
      const pctx = probe.getContext("2d", { willReadFrequently: true });
      pctx.drawImage(img, 0, 0);
      const { data } = pctx.getImageData(0, 0, img.width, img.height);
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++)
          if (data[(y * img.width + x) * 4 + 3] > ALPHA_THRESHOLD) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const inner = SIZE * (1 - 2 * PADDING);
      const scale = inner / Math.max(w, h);
      const out = document.createElement("canvas");
      out.width = out.height = SIZE;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, minX, minY, w, h, (SIZE - w * scale) / 2, (SIZE - h * scale) / 2, w * scale, h * scale);
      return { webp: out.toDataURL("image/webp", QUALITY).split(",")[1], box: { w, h } };
    },
    { src, SIZE, PADDING, QUALITY, ALPHA_THRESHOLD },
  );
  const buf = Buffer.from(webp, "base64");
  await writeFile(`src/assets/levels/level-${n}.webp`, buf);
  console.log(`level-${n}.webp  art ${box.w}x${box.h} -> ${SIZE}px  ${(buf.length / 1024).toFixed(1)} KB`);
}
await browser.close();
