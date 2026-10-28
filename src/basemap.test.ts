import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { basemapKey, loadBasemap, overpassQuery, parseOverpass } from "./basemap";

const B = { south: 32.776, west: 34.96, north: 32.858, east: 35.162 };
const OSM = { elements: [
  { tags: { natural: "coastline" }, geometry: [{ lat: 32.83, lon: 35.05 }, { lat: 32.80, lon: 35.03 }] },
  { tags: { highway: "motorway" }, geometry: [{ lat: 32.79, lon: 35.06 }, { lat: 32.81, lon: 35.11 }] },
  { tags: { highway: "residential" }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },     // not drawn
  { tags: { landuse: "industrial" }, geometry: [{ lat: 32.79, lon: 35.06 }, { lat: 32.80, lon: 35.07 }, { lat: 32.79, lon: 35.06 }] },
] };

test("the query asks for the coast well beyond the frame, the rest within it", () => {
  const q = overpassQuery(B);
  expect(q).toContain('way["natural"="coastline"](32.694,34.758,32.94,35.364)');
  expect(q).toContain('way["highway"~"^(motorway|trunk|primary|secondary)$"](32.776,34.96,32.858,35.162)');
  expect(basemapKey(B)).toBe("32.776_34.960_32.858_35.162");
});

test("Overpass JSON → only what the map draws", () => {
  expect(parseOverpass(OSM).map((f) => f.kind)).toEqual(["coast", "motorway", "industry"]);
  expect(parseOverpass(null)).toEqual([]);
});

test("busy Overpass is retried, the result cached, and the cache used next time", async () => {
  const dir = mkdtempSync(`${tmpdir()}/basemap-`);
  let calls = 0;
  const flaky = (async () => (++calls === 1 ? new Response("busy", { status: 504 }) : Response.json(OSM))) as unknown as typeof fetch;
  const first = await loadBasemap(B, dir, flaky, [0, 0]);
  expect(first).toHaveLength(3);
  expect(calls).toBe(2);
  expect(readdirSync(dir)).toEqual([`${basemapKey(B)}.json`]);
  expect(await loadBasemap(B, dir, flaky, [0, 0])).toEqual(first);
  expect(calls).toBe(2);                                         // from cache
});

test("a refusal is not hammered, and no data means no basemap", async () => {
  let calls = 0;
  const refuse = (async () => { calls++; return new Response("no", { status: 400 }); }) as unknown as typeof fetch;
  expect(await loadBasemap(B, mkdtempSync(`${tmpdir()}/basemap-`), refuse, [0, 0])).toBeNull();
  expect(calls).toBe(1);
});
