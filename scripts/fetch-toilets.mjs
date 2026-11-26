// Downloads every toilet POI (type 484) of a MazeMap campus and writes a compact
// static registry to src/data/. The registry is bundled with the app, so toilet
// locations never cost a Firestore read. Re-run when MazeMap data changes:
//   npm run toilets:fetch
import { writeFile, mkdir } from "node:fs/promises";

const CAMPUS_ID = 89; // DTU Lyngby
const CAMPUS_SLUG = "dtu-lyngby";
const TOILET_TYPE_ID = 484;
const PAGE_LIMIT = 2000;

async function fetchAll() {
  const pois = [];
  let fromId = 0;
  for (;;) {
    const url = `https://api.mazemap.com/api/campus/${CAMPUS_ID}/pois/?typeid=${TOILET_TYPE_ID}&fromid=${fromId}&srid=4326&limit=${PAGE_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MazeMap returned ${res.status} for ${url}`);
    const page = await res.json();
    pois.push(...page.pois);
    if (page.pois.length < PAGE_LIMIT) return pois;
    fromId = Math.max(...page.pois.map((p) => p.poiId)) + 1;
  }
}

const round = (n) => Math.round(n * 1e6) / 1e6;

const pois = (await fetchAll()).filter((p) => !p.deleted && p.point);
const toilets = pois
  .map((p) => {
    const names = [...new Set(p.infos.map((i) => i.name).filter(Boolean))];
    const title = p.title || names[0] || String(p.poiId);
    const extra = names.find((n) => n !== title);
    const t = {
      id: String(p.poiId),
      lng: round(p.point.coordinates[0]),
      lat: round(p.point.coordinates[1]),
      z: p.z,
      b: p.buildingName ?? "",
      f: p.floorName ?? "",
      n: title,
    };
    if (extra) t.n2 = extra; // e.g. canteen toilets: title "HOVEDKANTINE", room "4.935A"
    return t;
  })
  .sort((a, b) => a.b.localeCompare(b.b, "en", { numeric: true }) || a.z - b.z || a.n.localeCompare(b.n, "en", { numeric: true }));

await mkdir("src/data", { recursive: true });
const file = `src/data/toilets-${CAMPUS_SLUG}.json`;
await writeFile(file, JSON.stringify({ campus: CAMPUS_SLUG, mazemapCampusId: CAMPUS_ID, toilets }) + "\n");
console.log(`Wrote ${toilets.length} toilets to ${file}`);
