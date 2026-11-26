// Generates public/maskable-512x512.png from public/android-chrome-512x512.png.
//
// A "maskable" icon is cropped by the phone's launcher to a circle / squircle / etc., so the
// artwork must sit inside the central safe zone (a circle with 80% of the icon's diameter) on a
// full-bleed background. This measures the artwork, then scales and centres it to fit.
//   npm i --no-save playwright-core && node scripts/make-maskable.mjs
// (uses the Chrome/Edge already installed on the machine as the image tool.)
import { readFile, writeFile } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => {
  console.error("Needs playwright-core: npm i --no-save playwright-core");
  process.exit(1);
});

const SOURCE = "public/android-chrome-512x512.png";
const OUTPUT = "public/maskable-512x512.png";
const SIZE = 512;
const SAFE_RADIUS = SIZE * 0.4; // the safe zone defined by the maskable-icon spec
const FILL = 0.96; // use 96% of it, so the artwork doesn't touch the edge of the safe circle
const BACKGROUND = "#ffffff"; // the artwork is black line art on white

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${(await readFile(SOURCE)).toString("base64")}`;

const { png, report } = await page.evaluate(
  async ({ src, SIZE, SAFE_RADIUS, FILL, BACKGROUND }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const probe = document.createElement("canvas");
    probe.width = img.width;
    probe.height = img.height;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    pctx.drawImage(img, 0, 0);
    const { data } = pctx.getImageData(0, 0, img.width, img.height);

    // Bounding box of everything that isn't (near) white.
    const isInk = (o) => data[o + 3] > 128 && (data[o] + data[o + 1] + data[o + 2]) / 3 < 235;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (isInk((y * img.width + x) * 4)) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Radius of the smallest circle around that centre containing all the ink.
    let radius = 0;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (isInk((y * img.width + x) * 4)) radius = Math.max(radius, Math.hypot(x - cx, y - cy));

    const scale = (SAFE_RADIUS * FILL) / radius;
    const out = document.createElement("canvas");
    out.width = out.height = SIZE;
    const ctx = out.getContext("2d");
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.imageSmoothingQuality = "high";
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    ctx.drawImage(img, 0, 0);
    return {
      png: out.toDataURL("image/png").split(",")[1],
      report: { artBox: { minX, minY, maxX, maxY }, centre: [cx, cy], radius: Math.round(radius), scale: +scale.toFixed(3) },
    };
  },
  { src: dataUrl, SIZE, SAFE_RADIUS, FILL, BACKGROUND },
);

await writeFile(OUTPUT, Buffer.from(png, "base64"));
console.log("wrote", OUTPUT, JSON.stringify(report));
await browser.close();
